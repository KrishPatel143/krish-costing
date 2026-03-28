/**
 * @file flexCalc.js
 * @description Flexible Pouch calculator UI — layer rows, form reading, calc, render.
 */

import { FLEX_MATERIALS, MATERIALS, LAYER_NAMES } from '../data/materials.js';
import { getRatesSync, getFlexRatesSync } from '../db.js';
import { addHistory } from './history.js';
import { calcFlexiblePouch } from '../lib/calculator.js';
import { buildResultsHTML } from './resultsBuilder.js';
import { showToast } from './toast.js';
import { toggleSection } from './tabs.js';
import { fmt, fmtNum } from '../lib/formatter.js';

// ─── State ────────────────────────────────────────────────────────────────────
let layerCount = 2;
let qtyMode    = 'pouches';

// ─── Layer UI ─────────────────────────────────────────────────────────────────

function buildMaterialOptions() {
  return Object.entries(FLEX_MATERIALS)
    .map(([key, mat]) => `<option value="${key}">${mat.label} (d=${mat.density})</option>`)
    .join('');
}

function updateGsmPreview(idx) {
  const matKey   = document.getElementById(`f-mat-${idx}`)?.value;
  const mic      = parseFloat(document.getElementById(`f-mic-${idx}`)?.value);
  const preview  = document.getElementById(`f-gsm-${idx}`);
  if (!preview) return;
  if (matKey && mic > 0) {
    preview.textContent = `GSM = ${(mic * FLEX_MATERIALS[matKey].density).toFixed(3)}`;
    preview.className   = 'gsm-preview';
  } else {
    preview.textContent = 'GSM = ?';
    preview.className   = 'gsm-preview empty';
  }
}

export function renderLayerRows(count) {
  const container = document.getElementById('layers-container');
  if (!container) return;
  const opts = buildMaterialOptions();

  // Preserve current values before re-rendering
  const prev = Array.from({ length: 3 }, (_, i) => ({
    mat: document.getElementById(`f-mat-${i}`)?.value ?? '',
    mic: document.getElementById(`f-mic-${i}`)?.value ?? '',
  }));

  container.innerHTML = Array.from({ length: count }, (_, i) => `
    <div class="layer-row">
      <div class="layer-label">${LAYER_NAMES[i]}</div>
      <div>
        <label class="p-label" style="margin-bottom:4px">Film material</label>
        <select class="p-select" id="f-mat-${i}" style="width:100%;max-width:280px" data-layer="${i}">${opts}</select>
      </div>
      <div>
        <label class="p-label" style="margin-bottom:4px">Micron (µm)</label>
        <div style="display:flex;align-items:center;gap:6px">
          <input class="p-input" type="number" id="f-mic-${i}" placeholder="e.g. 12" min="0.1" step="0.1" style="width:90px" data-layer="${i}"/>
          <span id="f-gsm-${i}" class="gsm-preview empty">GSM = ?</span>
        </div>
      </div>
    </div>`).join('');

  // Restore previous values and attach events
  for (let i = 0; i < count; i++) {
    const matEl = document.getElementById(`f-mat-${i}`);
    const micEl = document.getElementById(`f-mic-${i}`);
    if (prev[i].mat && matEl) matEl.value = prev[i].mat;
    if (prev[i].mic && micEl) { micEl.value = prev[i].mic; updateGsmPreview(i); }
    matEl?.addEventListener('change', () => updateGsmPreview(i));
    micEl?.addEventListener('input',  () => updateGsmPreview(i));
  }
}

function setLayerCount(n, btn) {
  layerCount = n;
  document.querySelectorAll('#layer-count-toggle button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderLayerRows(n);
}

function setQtyMode(mode, btn) {
  qtyMode = mode;
  document.querySelectorAll('#qty-mode-toggle button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('qty-pouches-field').style.display = mode === 'pouches' ? '' : 'none';
  document.getElementById('qty-kg-field').style.display      = mode === 'kg'      ? '' : 'none';
}

// ─── Form reading ─────────────────────────────────────────────────────────────

function showError(msg) {
  const el = document.getElementById('flex-calc-error');
  const msgEl = document.getElementById('flex-calc-error-msg');
  if (el) el.style.display = 'block';
  if (msgEl) msgEl.textContent = msg;
}
function hideError() {
  const el = document.getElementById('flex-calc-error');
  if (el) el.style.display = 'none';
}

// ─── Calculate ────────────────────────────────────────────────────────────────

async function flexCalculate() {
  const height      = parseFloat(document.getElementById('f-height').value);
  const width       = parseFloat(document.getElementById('f-width').value);
  const inkCoverage = document.querySelector('input[name="f-ink"]:checked')?.value ?? 'half';
  const printType    = document.querySelector('input[name="f-print-type"]:checked')?.value ?? 'one_side';

  if (!height || !width || height <= 0 || width <= 0) return showError('Please enter valid Height and Width.');

  const layers = [];
  for (let i = 0; i < layerCount; i++) {
    const matKey = document.getElementById(`f-mat-${i}`)?.value;
    const mic    = parseFloat(document.getElementById(`f-mic-${i}`)?.value);
    if (!matKey || !mic || mic <= 0) return showError(`Please enter micron for ${LAYER_NAMES[i]} layer.`);
    layers.push({ matKey, mic });
  }
  hideError();

  const rates      = getFlexRatesSync();
  const paperRates = getRatesSync();
  let quantity     = parseInt(document.getElementById('f-quantity').value) || 1;
  let targetKg     = undefined;

  if (qtyMode === 'kg') {
    targetKg = parseFloat(document.getElementById('f-kg').value);
    if (!targetKg || targetKg <= 0) return showError('Please enter a valid target weight in KG.');
  }

  const result = calcFlexiblePouch({ height, width, inkCoverage, printType, layers, quantity, rates, paperRates, targetKg });

  if (result.quantity < 1) {
    return showError(`${targetKg} kg is not enough for even 1 pouch.`);
  }

  flexRenderResults(result);

  await addHistory({
    type: 'flexible',
    label: `${layerCount}-Layer Flexible Pouch`,
    height, width, quantity: result.quantity, inkCoverage,
    finalPerPouch: result.finalPerPouch,
    finalTotal:    result.finalTotal,
  });
}

// ─── Render ───────────────────────────────────────────────────────────────────

function flexRenderResults(d) {
  const section = document.getElementById('flex-results-section');
  if (!section) return;
  section.style.display = 'flex';

  const layerRowsHTML = d.layerCalcs.map((lc, i) => `
    <tr>
      <td>${LAYER_NAMES[i]}</td>
      <td>${FLEX_MATERIALS[lc.matKey].label}</td>
      <td style="font-family:var(--mono);font-size:12px">${lc.mic}</td>
      <td style="font-family:var(--mono);font-size:12px">${lc.density}</td>
      <td style="font-family:var(--mono);font-size:12px">${lc.gsm.toFixed(3)}</td>
      <td style="font-family:var(--mono);font-size:12px">₹${lc.ratePerKg.toLocaleString('en-IN')}</td>
      <td style="font-family:var(--mono);font-size:12px">${fmtNum(lc.baseKg, 6)}</td>
      <td style="font-family:var(--mono);font-size:12px">${fmtNum(lc.wastageKg, 6)}</td>
      <td style="font-family:var(--mono);font-size:12px">${fmtNum(d.qtyLayerKg[i], 4)}</td>
      <td style="font-family:var(--mono);font-size:12px">${fmt(lc.costPerPouch, 4)}</td>
      <td style="font-family:var(--mono);font-size:12px">${fmt(d.qtyLayerCost[i], 2)}</td>
    </tr>`).join('') + `
    <tr>
      <td>Ink</td><td>${MATERIALS[d.inkKey].label}</td>
      <td style="font-family:var(--mono);font-size:12px">—</td>
      <td style="font-family:var(--mono);font-size:12px">—</td>
      <td style="font-family:var(--mono);font-size:12px">${MATERIALS[d.inkKey].gsm}</td>
      <td style="font-family:var(--mono);font-size:12px">₹${d.paperRates[d.inkKey].toLocaleString('en-IN')}</td>
      <td style="font-family:var(--mono);font-size:12px">${fmtNum(d.inkCalc.baseKg, 6)}</td>
      <td style="font-family:var(--mono);font-size:12px">${fmtNum(d.inkCalc.wastageKg, 6)}</td>
      <td style="font-family:var(--mono);font-size:12px">${fmtNum(d.qtyTotals.inkKg, 4)}</td>
      <td style="font-family:var(--mono);font-size:12px">${fmt(d.inkCalc.costPerPouch, 4)}</td>
      <td style="font-family:var(--mono);font-size:12px">${fmt(d.qtyTotals.inkCost, 2)}</td>
    </tr>`;

  section.innerHTML = buildResultsHTML({
    breakdownId: 'flex-breakdown-body', summaryId: 'flex-summary-body',
    finalPerPouch: d.finalPerPouch,  finalTotal:  d.finalTotal,
    quantity:      d.quantity,
    qtyLabel:      `${d.quantity.toLocaleString('en-IN')} Pouch${d.quantity !== 1 ? 'es' : ''}`,
    qtySubLabel:   `${fmt(d.finalPerPouch, 4)} × ${d.quantity.toLocaleString('en-IN')}`,
    metaLine: `Area: <span style="font-family:var(--mono)">${d.areaSqM.toFixed(6)} m²</span> · ${d.layerCalcs.length} layers · Ink: ${d.inkCoverage === 'half' ? 'Half' : 'Full'} · ${d.printType.replace('_', ' ')} · Qty: ${d.quantity.toLocaleString('en-IN')}`,
    tableHeaders: ['Layer','Material','Mic (µm)','Density','GSM','Rate/kg','Base (kg/pouch)','+3% Wastage','Total (kg×qty)','Cost/pouch','Cost×qty'],
    tableColspan: 9, matRowsHTML: layerRowsHTML,
    totalMatCostPerPouch: d.totalMatCostPerPouch, qtyMatCost: d.qtyTotals.matCost,
    profitPerPouch: d.profitPerPouch,  qtyProfit: d.qtyTotals.profit,
    labourPerPouch: d.labourPerPouch,  qtyLabour: d.qtyTotals.labour,
    labourBadgeText: d.labourExtra > 0 ? `+₹0.05 (${d.labourReason})` : 'Standard',
    kgInfoLine: d.kgInfoLine,
  });

  section.querySelectorAll('[data-toggle]').forEach(btn => {
    btn.addEventListener('click', () => toggleSection(btn.dataset.toggle, btn));
  });

  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function flexClearResults() {
  const s = document.getElementById('flex-results-section');
  if (!s) return;
  s.style.display = 'none';
  s.innerHTML = '';
  hideError();
}

/** Wire all flexible calc controls. Call once on DOMContentLoaded. */
export function initFlexCalc() {
  document.getElementById('btn-flex-calculate')?.addEventListener('click', flexCalculate);
  document.getElementById('btn-flex-clear')?.addEventListener('click', flexClearResults);

  document.querySelectorAll('#layer-count-toggle button').forEach(btn => {
    btn.addEventListener('click', () => setLayerCount(parseInt(btn.dataset.count), btn));
  });
  document.querySelectorAll('#qty-mode-toggle button').forEach(btn => {
    btn.addEventListener('click', () => setQtyMode(btn.dataset.mode, btn));
  });

  renderLayerRows(layerCount);
}
