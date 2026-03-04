const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const DIST_DIR = path.join(ROOT, 'dist');
const STORE_FILE = path.join(ROOT, 'data', 'store.json');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function rimraf(target) {
  if (!fs.existsSync(target)) return;
  fs.rmSync(target, { recursive: true, force: true });
}

function copyFile(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function groupedResponse(store) {
  const groups = {};
  for (const item of store.prizes || []) {
    const key = item.sheetKey || String(item.sheetName || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    if (!groups[key]) {
      groups[key] = { key, name: item.sheetName, prizes: [] };
    }
    groups[key].prizes.push(item);
  }

  return {
    metadata: store.metadata || {},
    sheets: Object.values(groups).map((g) => ({
      ...g,
      prizes: g.prizes.sort((a, b) => (a.rowNumber || 99999) - (b.rowNumber || 99999)),
    })),
  };
}

function main() {
  if (!fs.existsSync(STORE_FILE)) {
    throw new Error('data/store.json not found. Run `npm start` once first to seed data.');
  }

  const store = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
  const publicData = groupedResponse(store);

  rimraf(DIST_DIR);
  ensureDir(DIST_DIR);

  copyFile(path.join(PUBLIC_DIR, 'index.html'), path.join(DIST_DIR, 'index.html'));
  copyFile(path.join(PUBLIC_DIR, 'styles.css'), path.join(DIST_DIR, 'styles.css'));
  copyFile(path.join(PUBLIC_DIR, 'app.js'), path.join(DIST_DIR, 'app.js'));

  fs.writeFileSync(path.join(DIST_DIR, 'data.json'), JSON.stringify(publicData, null, 2), 'utf8');

  console.log(`Static build complete: ${DIST_DIR}`);
  console.log('Upload dist contents to SiteGround public_html.');
}

main();
