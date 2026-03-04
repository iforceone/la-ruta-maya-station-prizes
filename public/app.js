let allSheets = [];
let selectedSheetKey = '';

async function fetchData() {
  if (window.__PRIZE_DATA__) {
    return window.__PRIZE_DATA__;
  }

  try {
    const res = await fetch('/api/public/prizes');
    if (res.ok) {
      return res.json();
    }
  } catch {}

  const staticRes = await fetch('./data.json');
  if (!staticRes.ok) {
    throw new Error(`Failed to load data (${staticRes.status})`);
  }
  return staticRes.json();
}

function text(value) {
  return value === null || value === undefined ? '' : String(value);
}

function formatPrizeValue(value) {
  const raw = text(value).trim();
  if (!raw) return '';

  if (/^-?\d+(\.\d+)?$/.test(raw)) {
    const num = Number(raw);
    return `$${num.toFixed(2)}`;
  }

  return raw;
}

function renderRows(prizes) {
  const tbody = document.getElementById('table-body');
  tbody.innerHTML = prizes.map((p, i) => {
    const isWinner = !!text(p.winnerTeamName).trim();
    return `
      <tr class="${isWinner ? 'winner-row' : ''} fade-in-row" style="animation-delay: ${Math.min(i * 0.03, 1.5)}s">
        <td>${escapeHtml(text(p.location))}</td>
        <td>${escapeHtml(text(p.place))}</td>
        <td><span class="badge ${text(p.categoryCode).toLowerCase()}">${escapeHtml(text(p.categoryCode))}</span></td>
        <td class="prize-value">${escapeHtml(formatPrizeValue(p.prizeValue))}</td>
        <td>${escapeHtml(text(p.prizeSponsor))}</td>
        <td class="winner-name">${isWinner ? '🏆 ' + escapeHtml(text(p.winnerTeamName)) : ''}</td>
        <td class="team-number">${isWinner ? escapeHtml(text(p.winnerTeamNumber)) : ''}</td>
        <td class="notes">${escapeHtml(text(p.notes))}</td>
      </tr>
    `;
  }).join('');
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderTabs(sheets, onSelect) {
  const tabs = document.getElementById('tabs');
  tabs.innerHTML = '';
  sheets.forEach((sheet, idx) => {
    const btn = document.createElement('button');
    const isActive = (selectedSheetKey && selectedSheetKey === sheet.key) || (!selectedSheetKey && idx === 0);
    btn.className = `tab-btn${isActive ? ' active' : ''}`;
    btn.textContent = `${sheet.name} (${sheet.prizes.length})`;
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      selectedSheetKey = sheet.key;
      onSelect(sheet);
    });
    tabs.appendChild(btn);
  });
}

function applyData(data) {
  const sheets = (data.sheets || []).sort((a, b) => a.name.localeCompare(b.name));

  const order = ['DAY 1', 'DAY 2', 'DAY 3', 'DAY 4', 'OVERALL'];
  sheets.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));

  allSheets = sheets;

  if (!selectedSheetKey && sheets[0]) {
    selectedSheetKey = sheets[0].key;
  }

  renderTabs(sheets, (sheet) => renderRows(sheet.prizes));

  const selected = sheets.find((s) => s.key === selectedSheetKey) || sheets[0];
  if (selected) {
    renderRows(selected.prizes);
  }
}

async function refreshBoard() {
  try {
    const data = await fetchData();
    applyData(data);
  } catch (error) {
    const tbody = document.getElementById('table-body');
    tbody.innerHTML = `<tr><td colspan="8">${escapeHtml(error.message)}</td></tr>`;
  }
}

(async () => {
  await refreshBoard();
  setInterval(refreshBoard, 30000);
})();
