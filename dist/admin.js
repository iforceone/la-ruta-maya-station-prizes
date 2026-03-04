let csrfToken = '';
let currentData = null;
let currentSheetKey = null;

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function api(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  if (csrfToken && ['POST', 'PUT', 'DELETE'].includes((options.method || 'GET').toUpperCase())) {
    headers['X-CSRF-Token'] = csrfToken;
  }

  const res = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers,
  });

  let body = {};
  try {
    body = await res.json();
  } catch {
    body = {};
  }

  if (!res.ok) {
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return body;
}

function getCurrentSheet() {
  return (currentData?.sheets || []).find((s) => s.key === currentSheetKey) || currentData?.sheets?.[0] || null;
}

function renderTabs() {
  const tabs = document.getElementById('tabs');
  tabs.innerHTML = '';
  const order = ['DAY 1', 'DAY 2', 'DAY 3', 'DAY 4', 'OVERALL'];
  currentData.sheets.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));

  currentData.sheets.forEach((sheet, i) => {
    if (!currentSheetKey && i === 0) currentSheetKey = sheet.key;
    const btn = document.createElement('button');
    btn.className = `tab-btn${sheet.key === currentSheetKey ? ' active' : ''}`;
    btn.textContent = `${sheet.name} (${sheet.prizes.length})`;
    btn.onclick = () => {
      currentSheetKey = sheet.key;
      renderTabs();
      renderTable();
    };
    tabs.appendChild(btn);
  });
}

function renderTable() {
  const tbody = document.getElementById('table-body');
  const sheet = getCurrentSheet();
  if (!sheet) {
    tbody.innerHTML = '<tr><td colspan="9">No records found.</td></tr>';
    return;
  }

  tbody.innerHTML = sheet.prizes.map((p) => `
    <tr data-id="${escapeHtml(p.id)}">
      <td><input data-field="location" value="${escapeHtml(p.location)}" /></td>
      <td><input data-field="place" value="${escapeHtml(p.place)}" /></td>
      <td><input data-field="categoryCode" value="${escapeHtml(p.categoryCode)}" /></td>
      <td><input data-field="prizeValue" value="${escapeHtml(p.prizeValue)}" /></td>
      <td><input data-field="prizeSponsor" value="${escapeHtml(p.prizeSponsor)}" /></td>
      <td><input data-field="winnerTeamName" value="${escapeHtml(p.winnerTeamName)}" /></td>
      <td><input data-field="winnerTeamNumber" value="${escapeHtml(p.winnerTeamNumber)}" /></td>
      <td><input data-field="notes" value="${escapeHtml(p.notes)}" /></td>
      <td>
        <button class="primary" data-action="save">Save</button>
        <button class="warn" data-action="delete">Delete</button>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('button[data-action="save"]').forEach((btn) => {
    btn.onclick = async (e) => {
      const row = e.target.closest('tr');
      const id = row.dataset.id;
      const payload = {
        sheetName: sheet.name,
      };
      row.querySelectorAll('input[data-field]').forEach((input) => {
        payload[input.dataset.field] = input.value;
      });

      try {
        await api(`/api/admin/prizes/${id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        await loadData();
      } catch (err) {
        alert(err.message);
      }
    };
  });

  tbody.querySelectorAll('button[data-action="delete"]').forEach((btn) => {
    btn.onclick = async (e) => {
      if (!confirm('Delete this prize record?')) return;
      const row = e.target.closest('tr');
      const id = row.dataset.id;
      try {
        await api(`/api/admin/prizes/${id}`, { method: 'DELETE' });
        await loadData();
      } catch (err) {
        alert(err.message);
      }
    };
  });
}

async function loadData() {
  currentData = await api('/api/admin/prizes');
  renderTabs();
  renderTable();
}

async function trySession() {
  try {
    const me = await api('/api/auth/me');
    csrfToken = me.csrfToken;
    document.getElementById('admin-user').textContent = `Logged in as ${me.username}`;
    document.getElementById('login-card').style.display = 'none';
    document.getElementById('admin-card').style.display = 'block';
    await loadData();
  } catch {
    document.getElementById('login-card').style.display = 'block';
    document.getElementById('admin-card').style.display = 'none';
  }
}

document.getElementById('login-btn').onclick = async () => {
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const msg = document.getElementById('login-msg');
  msg.textContent = '';

  try {
    const result = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    csrfToken = result.csrfToken;
    await trySession();
  } catch (err) {
    msg.textContent = err.message;
  }
};

document.getElementById('logout-btn').onclick = async () => {
  await api('/api/auth/logout', { method: 'POST' });
  csrfToken = '';
  currentData = null;
  currentSheetKey = null;
  await trySession();
};

document.getElementById('refresh-btn').onclick = () => loadData();

document.getElementById('create-form').onsubmit = async (e) => {
  e.preventDefault();
  const payload = {
    sheetName: document.getElementById('new-sheet').value,
    location: document.getElementById('new-location').value,
    place: document.getElementById('new-place').value,
    categoryCode: document.getElementById('new-code').value,
    prizeValue: document.getElementById('new-prize').value,
    prizeSponsor: document.getElementById('new-sponsor').value,
    winnerTeamName: document.getElementById('new-winner').value,
    winnerTeamNumber: document.getElementById('new-team-number').value,
    notes: document.getElementById('new-notes').value,
  };

  const msg = document.getElementById('create-msg');
  msg.textContent = '';

  try {
    await api('/api/admin/prizes', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    document.getElementById('create-form').reset();
    msg.textContent = 'Added.';
    await loadData();
  } catch (err) {
    msg.textContent = err.message;
  }
};

trySession();
