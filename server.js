const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { URL } = require('url');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');
const ADMIN_FILE = path.join(DATA_DIR, 'admin.json');
const EXTRACT_SCRIPT = path.join(ROOT, 'scripts', 'extractWorkbookData.ps1');
const PORT = Number(process.env.PORT || 3000);
const TOKEN_SECRET = process.env.APP_SECRET || 'replace-this-secret-in-production';
const SESSION_TTL_SECONDS = 60 * 60 * 12;

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJsonSafe(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(filePath, data) {
  const temp = `${filePath}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(temp, filePath);
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function parseCookies(req) {
  const source = req.headers.cookie || '';
  return source.split(';').reduce((acc, part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return acc;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) acc[key] = decodeURIComponent(val);
    return acc;
  }, {});
}

function jsonResponse(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let data = '';
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      data += chunk;
    });
    req.on('end', () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function signToken(payload) {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify(payload));
  const sig = base64url(
    crypto.createHmac('sha256', TOKEN_SECRET).update(`${header}.${body}`).digest()
  );
  return `${header}.${body}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [header, body, sig] = parts;
  const expected = base64url(
    crypto.createHmac('sha256', TOKEN_SECRET).update(`${header}.${body}`).digest()
  );

  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64').toString('utf8'));
    const now = Math.floor(Date.now() / 1000);
    if (!payload.exp || payload.exp < now) return null;
    return payload;
  } catch {
    return null;
  }
}

function hashPassword(password, saltHex = crypto.randomBytes(16).toString('hex'), iterations = 210000) {
  const salt = Buffer.from(saltHex, 'hex');
  const hash = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256').toString('hex');
  return { saltHex, hash, iterations };
}

function verifyPassword(password, adminRecord) {
  const { hash } = hashPassword(password, adminRecord.saltHex, adminRecord.iterations);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(adminRecord.hash, 'hex'));
}

function findWorkbookPath() {
  const files = fs.readdirSync(ROOT).filter((f) => /\.xlsx$/i.test(f));
  if (!files.length) {
    throw new Error('No .xlsx file found in project root.');
  }
  return path.join(ROOT, files[0]);
}

function asNumberOrEmpty(value) {
  if (value === null || value === undefined) return '';
  const text = String(value).trim();
  if (!text) return '';
  if (/^-?\d+(\.\d+)?$/.test(text)) return text;
  return '';
}

function seedFromWorkbook() {
  const workbookPath = findWorkbookPath();
  const output = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', EXTRACT_SCRIPT, '-WorkbookPath', workbookPath],
    { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
  );

  const extracted = JSON.parse(output);
  const prizes = [];
  let nextId = 1;

  for (const sheet of extracted.sheets || []) {
    const isDay = /^DAY\s*\d+/i.test(sheet.name || '');
    const isOverall = /^OVERALL$/i.test(sheet.name || '');
    const sheetKey = slugify(sheet.name);
    let currentLocation = '';
    let headerSeen = false;

    for (const row of sheet.rows || []) {
      const a = (row.a || '').trim();
      const b = (row.b || '').trim();
      const c = (row.c || '').trim();
      const d = (row.d || '').trim();
      const e = (row.e || '').trim();
      const f = (row.f || '').trim();

      if (isDay) {
        const headerLike = /^LOCAT/i.test(a.toUpperCase()) && b.toUpperCase() === 'PLACE';
        if (!headerSeen && headerLike) {
          headerSeen = true;
          continue;
        }
        if (!headerSeen) continue;

        if (/^SUBTOTAL\s+DAY/i.test(a)) continue;

        const isSectionHeading = a && !b && !c && !d && !e && !f;
        if (isSectionHeading) {
          currentLocation = a;
          continue;
        }

        if (a) currentLocation = a;

        const hasPrizeData = Boolean(b || c || d || e || f);
        if (!hasPrizeData) continue;

        prizes.push({
          id: `P${nextId++}`,
          sheetName: sheet.name,
          sheetKey,
          rowNumber: row.rowNumber,
          location: a || currentLocation || '',
          place: b,
          categoryCode: c,
          prizeValue: d,
          prizeSponsor: e,
          winnerTeamName: '',
          winnerTeamNumber: f,
          notes: '',
          isOverall: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        continue;
      }

      if (isOverall) {
        if (row.rowNumber < 8) continue;
        if (!a && !b && !c && !d && !e && !f) continue;

        const combined = `${a} ${b} ${c} ${d} ${e}`.trim();
        if (!combined) continue;

        const likelyNoteOnly = !b && !c && !e && d && !/\d/.test(d) && !/(courtesy|gift|total|race|team|paddler|1st|2nd|3rd|4th|5th|6th|7th|8th|9th|10th)/i.test(d);
        if (likelyNoteOnly) continue;

        const prizeValue = asNumberOrEmpty(c) || asNumberOrEmpty(d) || asNumberOrEmpty(b);
        const derivedSponsor = e || (!prizeValue && d ? d : '');
        const note = prizeValue && d && d !== prizeValue ? d : '';

        prizes.push({
          id: `P${nextId++}`,
          sheetName: sheet.name,
          sheetKey,
          rowNumber: row.rowNumber,
          location: a,
          place: b,
          categoryCode: c && !/^\d/.test(c) ? c : '',
          prizeValue,
          prizeSponsor: derivedSponsor,
          winnerTeamName: '',
          winnerTeamNumber: f,
          notes: note,
          isOverall: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
    }
  }

  return {
    metadata: {
      title: 'Belikin La Ruta Maya Belize River Challenge Prizes',
      workbookPath,
      seededAt: new Date().toISOString(),
    },
    lastId: nextId,
    prizes,
  };
}

function loadStore() {
  ensureDataDir();
  if (!fs.existsSync(STORE_FILE)) {
    const seeded = seedFromWorkbook();
    writeJsonAtomic(STORE_FILE, seeded);
    return seeded;
  }
  return readJsonSafe(STORE_FILE, { metadata: {}, lastId: 1, prizes: [] });
}

function saveStore(store) {
  writeJsonAtomic(STORE_FILE, store);
}

function setCookie(res, name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  if (options.path) parts.push(`Path=${options.path}`);
  if (typeof options.maxAge === 'number') parts.push(`Max-Age=${options.maxAge}`);
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearCookie(res, name) {
  res.setHeader('Set-Cookie', `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
}

function requireAuth(req, res) {
  const cookies = parseCookies(req);
  const token = cookies.session;
  const payload = verifyToken(token);
  if (!payload) {
    jsonResponse(res, 401, { error: 'Unauthorized' });
    return null;
  }
  return payload;
}

function sanitizePrizeInput(input) {
  return {
    sheetName: String(input.sheetName || '').trim(),
    sheetKey: slugify(input.sheetName || input.sheetKey || ''),
    location: String(input.location || '').trim(),
    place: String(input.place || '').trim(),
    categoryCode: String(input.categoryCode || '').trim(),
    prizeValue: String(input.prizeValue || '').trim(),
    prizeSponsor: String(input.prizeSponsor || '').trim(),
    winnerTeamName: String(input.winnerTeamName || '').trim(),
    winnerTeamNumber: String(input.winnerTeamNumber || '').trim(),
    notes: String(input.notes || '').trim(),
  };
}

function groupedResponse(store) {
  const groups = {};
  for (const item of store.prizes) {
    const key = item.sheetKey || slugify(item.sheetName);
    if (!groups[key]) {
      groups[key] = {
        key,
        name: item.sheetName,
        prizes: [],
      };
    }
    groups[key].prizes.push(item);
  }

  return {
    metadata: store.metadata,
    sheets: Object.values(groups).map((g) => ({
      ...g,
      prizes: g.prizes.sort((a, b) => (a.rowNumber || 99999) - (b.rowNumber || 99999)),
    })),
  };
}

function serveStatic(req, res, pathname) {
  const filePath = pathname === '/'
    ? path.join(PUBLIC_DIR, 'index.html')
    : pathname === '/admin'
      ? path.join(PUBLIC_DIR, 'admin.html')
      : path.join(PUBLIC_DIR, pathname.replace(/^\//, ''));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    jsonResponse(res, 403, { error: 'Forbidden' });
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    jsonResponse(res, 404, { error: 'Not found' });
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
  }[ext] || 'application/octet-stream';

  const body = fs.readFileSync(filePath);
  res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': body.length });
  res.end(body);
}

function initAdminFromArgs() {
  const args = process.argv.slice(2);
  if (!args.includes('--init-admin')) return false;

  const usernameIdx = args.indexOf('--username');
  const passwordIdx = args.indexOf('--password');
  const username = usernameIdx >= 0 ? args[usernameIdx + 1] : 'admin';
  let password = passwordIdx >= 0 ? args[passwordIdx + 1] : process.env.ADMIN_PASSWORD;

  if (!password) {
    password = crypto.randomBytes(12).toString('base64url');
    console.log(`Generated admin password: ${password}`);
  }

  const hashed = hashPassword(password);
  const record = {
    username,
    saltHex: hashed.saltHex,
    hash: hashed.hash,
    iterations: hashed.iterations,
    createdAt: new Date().toISOString(),
  };

  ensureDataDir();
  writeJsonAtomic(ADMIN_FILE, record);
  console.log(`Admin user initialized: ${username}`);
  return true;
}

if (initAdminFromArgs()) {
  process.exit(0);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || `localhost:${PORT}`}`);
    const { pathname } = url;

    if (pathname.startsWith('/api/')) {
      const store = loadStore();

      if (pathname === '/api/public/prizes' && req.method === 'GET') {
        jsonResponse(res, 200, groupedResponse(store));
        return;
      }

      if (pathname === '/api/auth/login' && req.method === 'POST') {
        const body = await readBody(req);
        const admin = readJsonSafe(ADMIN_FILE, null);
        if (!admin) {
          jsonResponse(res, 503, { error: 'Admin account not initialized. Run: npm run init-admin -- --username admin --password "<strong-password>"' });
          return;
        }

        if (!body.username || !body.password) {
          jsonResponse(res, 400, { error: 'username and password are required' });
          return;
        }

        if (body.username !== admin.username || !verifyPassword(String(body.password), admin)) {
          jsonResponse(res, 401, { error: 'Invalid credentials' });
          return;
        }

        const csrf = crypto.randomBytes(18).toString('base64url');
        const now = Math.floor(Date.now() / 1000);
        const token = signToken({
          sub: admin.username,
          role: 'admin',
          csrf,
          iat: now,
          exp: now + SESSION_TTL_SECONDS,
        });

        setCookie(res, 'session', token, {
          httpOnly: true,
          secure: process.env.COOKIE_SECURE === 'true',
          sameSite: 'Lax',
          path: '/',
          maxAge: SESSION_TTL_SECONDS,
        });

        jsonResponse(res, 200, { ok: true, username: admin.username, csrfToken: csrf });
        return;
      }

      if (pathname === '/api/auth/logout' && req.method === 'POST') {
        clearCookie(res, 'session');
        jsonResponse(res, 200, { ok: true });
        return;
      }

      if (pathname === '/api/auth/me' && req.method === 'GET') {
        const payload = requireAuth(req, res);
        if (!payload) return;
        jsonResponse(res, 200, { ok: true, username: payload.sub, csrfToken: payload.csrf });
        return;
      }

      if (pathname === '/api/admin/prizes' && req.method === 'GET') {
        const payload = requireAuth(req, res);
        if (!payload) return;
        jsonResponse(res, 200, groupedResponse(store));
        return;
      }

      if (pathname === '/api/admin/prizes' && req.method === 'POST') {
        const payload = requireAuth(req, res);
        if (!payload) return;

        const csrfHeader = req.headers['x-csrf-token'];
        if (!csrfHeader || csrfHeader !== payload.csrf) {
          jsonResponse(res, 403, { error: 'Invalid CSRF token' });
          return;
        }

        const body = sanitizePrizeInput(await readBody(req));
        if (!body.sheetName || !body.location || !body.place) {
          jsonResponse(res, 400, { error: 'sheetName, location, and place are required' });
          return;
        }

        const newPrize = {
          id: `P${store.lastId++}`,
          sheetName: body.sheetName,
          sheetKey: body.sheetKey || slugify(body.sheetName),
          rowNumber: 999999,
          location: body.location,
          place: body.place,
          categoryCode: body.categoryCode,
          prizeValue: body.prizeValue,
          prizeSponsor: body.prizeSponsor,
          winnerTeamName: body.winnerTeamName,
          winnerTeamNumber: body.winnerTeamNumber,
          notes: body.notes,
          isOverall: /^overall$/i.test(body.sheetName),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        store.prizes.push(newPrize);
        saveStore(store);
        jsonResponse(res, 201, { ok: true, prize: newPrize });
        return;
      }

      if (pathname.startsWith('/api/admin/prizes/') && (req.method === 'PUT' || req.method === 'DELETE')) {
        const payload = requireAuth(req, res);
        if (!payload) return;

        const csrfHeader = req.headers['x-csrf-token'];
        if (!csrfHeader || csrfHeader !== payload.csrf) {
          jsonResponse(res, 403, { error: 'Invalid CSRF token' });
          return;
        }

        const id = pathname.split('/').pop();
        const index = store.prizes.findIndex((p) => p.id === id);
        if (index < 0) {
          jsonResponse(res, 404, { error: 'Prize not found' });
          return;
        }

        if (req.method === 'DELETE') {
          const [deleted] = store.prizes.splice(index, 1);
          saveStore(store);
          jsonResponse(res, 200, { ok: true, deletedId: deleted.id });
          return;
        }

        const body = sanitizePrizeInput(await readBody(req));
        const existing = store.prizes[index];
        const updated = {
          ...existing,
          ...body,
          sheetKey: body.sheetKey || existing.sheetKey || slugify(body.sheetName || existing.sheetName),
          updatedAt: new Date().toISOString(),
        };

        store.prizes[index] = updated;
        saveStore(store);
        jsonResponse(res, 200, { ok: true, prize: updated });
        return;
      }

      jsonResponse(res, 404, { error: 'Not found' });
      return;
    }

    if (req.method !== 'GET') {
      jsonResponse(res, 405, { error: 'Method not allowed' });
      return;
    }

    serveStatic(req, res, pathname);
  } catch (error) {
    jsonResponse(res, 500, { error: error.message || 'Internal server error' });
  }
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
