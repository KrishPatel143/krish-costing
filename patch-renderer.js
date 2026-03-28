const fs = require('fs');
const path = require('path');

let html = fs.readFileSync(path.join(__dirname, 'renderer', 'index.html'), 'utf8');

// 1. Update title
html = html.replace('<title>Pouch Costing Calculator</title>', '<title>Krish-CRM — Pouch Costing Calculator</title>');

// 2. Update app header
html = html.replace(
  '<h1>Pouch Costing Calculator</h1>',
  '<h1>Krish-CRM</h1>'
);
html = html.replace(
  '<p>Paper &amp; flexible packaging cost estimation for industrial use</p>',
  '<p>Pouch Costing Calculator &nbsp;·&nbsp; <span id="db-path-label" style="font-size:11px;color:var(--color-text-tertiary)">Loading…</span></p>'
);

// 3. Add History tab button
html = html.replace(
  '<button class="p-tab" onclick="switchTab(\'rates\', this)">Material Rates</button>',
  '<button class="p-tab" onclick="switchTab(\'rates\', this)">Material Rates</button>\n      <button class="p-tab" onclick="switchTab(\'history\', this)">History</button>'
);

// 4. Add History tab content (before closing card div)
const historyTab = `
    <!-- ══ TAB: HISTORY ══ -->
    <div id="tab-history" class="tab-content" style="padding:22px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px">
        <div>
          <div style="font-size:14px;font-weight:600;color:var(--color-text-primary)">Calculation History</div>
          <div style="font-size:12px;color:var(--color-text-tertiary);margin-top:2px">Last 200 calculations saved locally</div>
        </div>
        <button class="p-btn p-btn-danger" onclick="clearHistory()">Clear All History</button>
      </div>
      <div id="history-list"></div>
    </div>
`;
html = html.replace('</div><!-- end card -->', historyTab + '\n  </div><!-- end card -->');

// 5. Replace localStorage persistence functions with async IPC versions
const newPersistenceFns = `
/* ═══════════════════════════════════════════════════════
   IPC-BASED PERSISTENCE (replaces localStorage)
═══════════════════════════════════════════════════════ */
let _ratesCache = null;
let _flexRatesCache = null;

async function loadRatesAsync() {
  if (!_ratesCache) _ratesCache = await window.krish.getRates();
  return Object.assign({}, DEFAULT_RATES, _ratesCache);
}
function loadRates() {
  // sync fallback using cache (populated on init)
  return Object.assign({}, DEFAULT_RATES, _ratesCache || {});
}

async function loadFlexRatesAsync() {
  if (!_flexRatesCache) _flexRatesCache = await window.krish.getFlexRates();
  return Object.assign({}, DEFAULT_FLEX_RATES, _flexRatesCache);
}
function loadFlexRates() {
  return Object.assign({}, DEFAULT_FLEX_RATES, _flexRatesCache || {});
}

function getRatesFromInputs() {
  const rates = {};
  Object.keys(DEFAULT_RATES).forEach(key => {
    const el = document.getElementById('rate-' + key);
    rates[key] = el ? (parseFloat(el.value) || DEFAULT_RATES[key]) : DEFAULT_RATES[key];
  });
  return rates;
}

async function saveRates() {
  const rates = getRatesFromInputs();
  _ratesCache = rates;
  await window.krish.saveRates(rates);
  showToast('success', '✓ Paper rates saved successfully.');
}

async function resetRates() {
  const defaults = await window.krish.resetRates();
  _ratesCache = {};
  Object.keys(DEFAULT_RATES).forEach(key => {
    const el = document.getElementById('rate-' + key);
    if (el) el.value = DEFAULT_RATES[key];
  });
  showToast('info', '↺ Paper rates reset to defaults.');
}

function getFlexRatesFromInputs() {
  const rates = {};
  Object.keys(DEFAULT_FLEX_RATES).forEach(key => {
    const el = document.getElementById('flex-rate-' + key);
    rates[key] = el ? (parseFloat(el.value) || DEFAULT_FLEX_RATES[key]) : DEFAULT_FLEX_RATES[key];
  });
  return rates;
}

async function saveFlexRates() {
  const rates = getFlexRatesFromInputs();
  _flexRatesCache = rates;
  await window.krish.saveFlexRates(rates);
  showToast('success', '✓ Flexible film rates saved successfully.');
}

async function resetFlexRates() {
  await window.krish.resetFlexRates();
  _flexRatesCache = {};
  Object.keys(DEFAULT_FLEX_RATES).forEach(key => {
    const el = document.getElementById('flex-rate-' + key);
    if (el) el.value = DEFAULT_FLEX_RATES[key];
  });
  showToast('info', '↺ Film rates reset to defaults.');
}
`;

// Replace the old persistence block
html = html.replace(/\/\* ═+\s*PAPER RATES PERSISTENCE[\s\S]*?\/\* ═+\s*RENDER RATES TABLES/, newPersistenceFns + '\n/* ═══════════════════════════════════════════════════════\n   RENDER RATES TABLES');

// 6. Update calculate() to save history after rendering
html = html.replace(
  'section.scrollIntoView({ behavior: \'smooth\', block: \'start\' });\n}\n\nfunction clearResults()',
  `section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  // Save to history
  window.krish.addHistory({
    type: 'paper',
    label: d.pouchType.label,
    height: d.height, width: d.width, quantity: d.quantity,
    finalPerPouch: d.finalPerPouch, finalTotal: d.finalTotal,
    inkCoverage: d.inkCoverage
  });
}

function clearResults()`
);

// 7. Update flexRenderResults() to save history
html = html.replace(
  'section.scrollIntoView({ behavior: \'smooth\', block: \'start\' });\n}\n\nfunction flexClearResults()',
  `section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  // Save to history
  window.krish.addHistory({
    type: 'flexible',
    label: d.layerCalcs.length + '-Layer Flexible Pouch',
    height: d.height, width: d.width, quantity: d.quantity,
    finalPerPouch: d.finalPerPouch, finalTotal: d.finalTotal,
    inkCoverage: d.inkCoverage
  });
}

function flexClearResults()`
);

// 8. Update INIT block to use async loading + load history  
html = html.replace(
  `document.addEventListener('DOMContentLoaded', () => {
  renderRatesTable();
  renderFlexRatesTable();
  renderLayerRows(flexLayerCount);
});`,
  `async function renderHistory() {
  const history = await window.krish.getHistory();
  const el = document.getElementById('history-list');
  if (!history || history.length === 0) {
    el.innerHTML = '<div class="p-alert info" style="font-size:13px"><span>ℹ</span><span>No calculations saved yet. Run a calculation to see it here.</span></div>';
    return;
  }
  el.innerHTML = history.map(h => {
    const badge = h.type === 'flexible' ? '<span class="p-badge info">Flexible</span>' : '<span class="p-badge neutral">Paper</span>';
    const d = new Date(h.savedAt);
    const dateStr = d.toLocaleDateString('en-IN', {day:'2-digit',month:'short',year:'numeric'}) + ' ' + d.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'});
    return \`<div class="card" style="flex-direction:row;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;padding:14px 18px">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        \${badge}
        <span style="font-size:13px;font-weight:500;color:var(--color-text-primary)">\${h.label}</span>
        <span style="font-size:12px;color:var(--color-text-tertiary)">\${h.height}×\${h.width}mm &nbsp;·&nbsp; Qty: \${h.quantity.toLocaleString('en-IN')}</span>
      </div>
      <div style="display:flex;gap:24px;align-items:center">
        <div style="text-align:right">
          <div style="font-size:11px;color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:.06em">Per Pouch</div>
          <div style="font-family:'IBM Plex Mono',monospace;font-size:14px;font-weight:600;color:#185FA5">₹\${h.finalPerPouch.toFixed(2)}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:11px;color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:.06em">Total</div>
          <div style="font-family:'IBM Plex Mono',monospace;font-size:14px;font-weight:600;color:var(--color-text-primary)">₹\${h.finalTotal.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
        </div>
        <div style="font-size:11px;color:var(--color-text-tertiary);text-align:right">\${dateStr}</div>
      </div>
    </div>\`;
  }).join('');
}

async function clearHistory() {
  await window.krish.clearHistory();
  renderHistory();
  showToast('info', '↺ History cleared.');
}

document.addEventListener('DOMContentLoaded', async () => {
  // Load rates from LowDB into caches
  _ratesCache     = await window.krish.getRates();
  _flexRatesCache = await window.krish.getFlexRates();

  renderRatesTable();
  renderFlexRatesTable();
  renderLayerRows(flexLayerCount);

  // Show DB path
  const dbPath = await window.krish.getDbPath();
  const dbEl = document.getElementById('db-path-label');
  if (dbEl && dbPath) dbEl.textContent = dbPath;
});`
);

fs.writeFileSync(path.join(__dirname, 'renderer', 'index.html'), html, 'utf8');
console.log('✅ renderer/index.html patched successfully');
