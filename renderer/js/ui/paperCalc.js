/**
 * @file paperCalc.js
 * @description Paper Pouch calculator UI — reads form, calls pure calc, renders results.
 */

import { MATERIALS, POUCH_TYPES } from '../data/materials.js';
import { getRatesSync } from '../db.js';
import { addHistory } from './history.js';
import { calcPaperPouch } from '../lib/calculator.js';
import { buildResultsHTML } from './resultsBuilder.js';
import { showToast } from './toast.js';
import { fmt, fmtNum } from '../lib/formatter.js';
import { toggleSection } from './tabs.js';

// ─── Form readers ─────────────────────────────────────────────────────────────

function readForm() {
  return {
    pouchTypeKey: document.getElementById('pouch-type').value,
    height:       parseFloat(document.getElementById('height').value),
    width:        parseFloat(document.getElementById('width').value),
    inkCoverage:  document.querySelector('input[name="ink"]:checked')?.value ?? 'half',
    printType:    document.querySelector('input[name="print-type"]:checked')?.value ?? 'one_side',
    quantity:     parseInt(document.getElementById('quantity').value) || 1,
  };
}

function showError(msg) {
  const el = document.getElementById('calc-error');
  const msgEl = document.getElementById('calc-error-msg');
  if (el) el.style.display = 'block';
  if (msgEl) msgEl.textContent = msg;
}

function hideError() {
  const el = document.getElementById('calc-error');
  if (el) el.style.display = 'none';
}

// ─── Calculate ────────────────────────────────────────────────────────────────

async function calculate() {
  const { pouchTypeKey, height, width, inkCoverage, printType, quantity } = readForm();

  if (!height || !width || height <= 0 || width <= 0) {
    return showError('Please enter valid Height and Width (positive numbers).');
  }
  hideError();

  const rates  = getRatesSync();
  const result = calcPaperPouch({ pouchTypeKey, height, width, inkCoverage, printType, quantity, rates });
  renderResults(result);

  await addHistory({
    type: 'paper',
    label: result.pouchType.label,
    height, width, quantity, inkCoverage, printType,
    finalPerPouch: result.finalPerPouch,
    finalTotal:    result.finalTotal,
  });
}

// ─── Render ───────────────────────────────────────────────────────────────────

function renderResults(d) {
  const section = document.getElementById('results-section');
  if (!section) return;
  section.style.display = 'flex';

  const matRowsHTML = [
    { label: MATERIALS[d.s1Key].label  + ' (Side 1)', key: d.s1Key,  calc: d.s1,  qtyKg: d.qtyTotals.s1Kg,  qtyCost: d.qtyTotals.s1Cost  },
    { label: MATERIALS[d.s2Key].label  + ' (Side 2)', key: d.s2Key,  calc: d.s2,  qtyKg: d.qtyTotals.s2Kg,  qtyCost: d.qtyTotals.s2Cost  },
    { label: MATERIALS[d.inkKey].label + ' (Ink)',    key: d.inkKey, calc: d.ink, qtyKg: d.qtyTotals.inkKg, qtyCost: d.qtyTotals.inkCost },
  ].map(row => `
    <tr>
      <td>${row.label}</td>
      <td style="font-family:var(--mono);font-size:12px">${MATERIALS[row.key].gsm}</td>
      <td style="font-family:var(--mono);font-size:12px">₹${d.rates[row.key].toLocaleString('en-IN')}</td>
      <td style="font-family:var(--mono);font-size:12px">${fmtNum(row.calc.baseKg, 6)}</td>
      <td style="font-family:var(--mono);font-size:12px">${fmtNum(row.calc.wastageKg, 6)}</td>
      <td style="font-family:var(--mono);font-size:12px">${fmtNum(row.qtyKg, 4)}</td>
      <td style="font-family:var(--mono);font-size:12px">${fmt(row.calc.costPerPouch, 4)}</td>
      <td style="font-family:var(--mono);font-size:12px">${fmt(row.qtyCost, 2)}</td>
    </tr>`).join('');

  section.innerHTML = buildResultsHTML({
    breakdownId: 'breakdown-body', summaryId: 'summary-body',
    finalPerPouch:  d.finalPerPouch,   finalTotal:      d.finalTotal,
    quantity:       d.quantity,        qtyLabel:        `${d.quantity.toLocaleString('en-IN')} Pouch${d.quantity !== 1 ? 'es' : ''}`,
    qtySubLabel:    `${fmt(d.finalPerPouch, 4)} × ${d.quantity.toLocaleString('en-IN')}`,
    metaLine: `Area: <span style="font-family:var(--mono)">${d.areaSqM.toFixed(6)} m²</span> · ${d.pouchType.label} · Ink: ${d.inkCoverage === 'half' ? 'Half' : 'Full'} · ${d.printType.replace('_', ' ')} · Qty: ${d.quantity.toLocaleString('en-IN')}`,
    tableHeaders: ['Material','GSM','Rate/kg','Base (kg/pouch)','+3% Wastage','Total (kg×qty)','Cost/pouch','Cost×qty'],
    tableColspan: 6, matRowsHTML,
    totalMatCostPerPouch: d.totalMatCostPerPouch, qtyMatCost:   d.qtyTotals.matCost,
    profitPerPouch:       d.profitPerPouch,        qtyProfit:    d.qtyTotals.profit,
    labourPerPouch:       d.labourPerPouch,        qtyLabour:    d.qtyTotals.labour,
    labourBadgeText: d.labourExtra > 0 ? `+₹0.05 (${d.labourReason})` : 'Standard',
    kgInfoLine: '',
  });

  // Wire toggle buttons inside newly-injected HTML
  section.querySelectorAll('[data-toggle]').forEach(btn => {
    btn.addEventListener('click', () => toggleSection(btn.dataset.toggle, btn));
  });

  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function clearResults() {
  const s = document.getElementById('results-section');
  if (!s) return;
  s.style.display = 'none';
  s.innerHTML = '';
  hideError();
}

/** Wire form buttons. Call once on DOMContentLoaded. */
export function initPaperCalc() {
  document.getElementById('btn-calculate')?.addEventListener('click', calculate);
  document.getElementById('btn-clear')?.addEventListener('click', clearResults);
}
