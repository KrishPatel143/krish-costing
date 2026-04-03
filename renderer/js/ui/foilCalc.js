/**
 * @file foilCalc.js
 * @description Foil Costing calculator UI controller and renderer.
 */

import {
  FOIL_GROUPS,
  FOIL_DEFAULT_GSM,
  FOIL_DEFAULT_RATES,
  FOIL_PRINTING_GSM,
} from '../data/materials.js';
import { calcFoilPouch } from '../lib/calculator.js';
import { fmt, fmtNum } from '../lib/formatter.js';
import { getRatesSync } from '../db.js';

let selectedGroup = 'PET';
let selectedThickness = '0.2';
let selectedPrintType = 'plain';
let gsmSectionVisible = false;

function showError(msg) {
  const box = document.getElementById('foil-calc-error');
  const msgEl = document.getElementById('foil-calc-error-msg');
  if (box) box.style.display = 'block';
  if (msgEl) msgEl.textContent = msg;
}

function hideError() {
  const box = document.getElementById('foil-calc-error');
  if (box) box.style.display = 'none';
}

function renderGsmSectionVisibility() {
  const section = document.getElementById('foil-gsm-section');
  const btn = document.getElementById('btn-foil-advice');
  if (section) section.style.display = gsmSectionVisible ? '' : 'none';
  if (btn) btn.textContent = gsmSectionVisible ? 'Hide GSM' : 'Advance';
}

function setButtonGroupActive(containerId, dataKey, value) {
  document.querySelectorAll(`#${containerId} button`).forEach((btn) => {
    btn.classList.toggle('active', btn.dataset[dataKey] === value);
  });
}

function getGsmMapFromInputs() {
  return {
    '0.2': parseFloat(document.getElementById('foil-gsm-02')?.value),
    '0.25': parseFloat(document.getElementById('foil-gsm-025')?.value),
    '0.3': parseFloat(document.getElementById('foil-gsm-03')?.value),
    '0.4': parseFloat(document.getElementById('foil-gsm-04')?.value),
    Imported: parseFloat(document.getElementById('foil-gsm-imported')?.value),
  };
}

function getRatesFromStore() {
  const allRates = getRatesSync();
  return {
    blister: allRates.foil_blister ?? FOIL_DEFAULT_RATES.blister,
    aluminium: allRates.foil_aluminium ?? FOIL_DEFAULT_RATES.aluminium,
    imported: allRates.foil_imported ?? FOIL_DEFAULT_RATES.imported,
    // Foil ink rate must come from paper full-coverage rate.
    ink: allRates.ink_full ?? 15000,
  };
}

function applyDefaultInputs() {
  document.getElementById('foil-gsm-02').value = FOIL_DEFAULT_GSM['0.2'];
  document.getElementById('foil-gsm-025').value = FOIL_DEFAULT_GSM['0.25'];
  document.getElementById('foil-gsm-03').value = FOIL_DEFAULT_GSM['0.3'];
  document.getElementById('foil-gsm-04').value = FOIL_DEFAULT_GSM['0.4'];
  document.getElementById('foil-gsm-imported').value = FOIL_DEFAULT_GSM.Imported;
}

function renderThicknessButtons() {
  const group = FOIL_GROUPS[selectedGroup];
  const container = document.getElementById('foil-thickness-toggle');
  if (!group || !container) return;

  if (!group.thicknesses.includes(selectedThickness)) {
    selectedThickness = group.thicknesses[0];
  }

  container.innerHTML = group.thicknesses
    .map((th) => {
      const active = th === selectedThickness ? 'active' : '';
      return `<button type="button" class="${active}" data-thickness="${th}">${th}</button>`;
    })
    .join('');

  container.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedThickness = btn.dataset.thickness;
      renderThicknessButtons();
    });
  });
}

function validateInputs(gsmMap, rates, sizeMm, quantity, wastagePercent, profitPercent) {
  const group = FOIL_GROUPS[selectedGroup];
  if (!group?.thicknesses.includes(selectedThickness)) {
    return 'Selected thickness is not valid for the selected material group.';
  }
  if (Object.values(gsmMap).some((v) => Number.isNaN(v) || v <= 0)) {
    return 'Please enter valid GSM values.';
  }
  if (Object.values(rates).some((v) => Number.isNaN(v) || v < 0)) {
    return 'Please enter valid rates.';
  }
  if (Number.isNaN(sizeMm) || sizeMm <= 0) {
    return 'Please enter a valid size in mm.';
  }
  if (Number.isNaN(quantity) || quantity < 1) {
    return 'Please enter a valid quantity.';
  }
  if (Number.isNaN(wastagePercent) || wastagePercent < 0) {
    return 'Please enter a valid wastage percentage.';
  }
  if (Number.isNaN(profitPercent) || profitPercent < 0) {
    return 'Please enter a valid profit percentage.';
  }
  return '';
}

function renderResults(result, rates) {
  const section = document.getElementById('foil-results-section');
  if (!section) return;
  section.style.display = 'flex';
  section.innerHTML = `
    <div class="result-highlight">
      <div class="result-big">
        <div class="rb-label">Final Price per Pouch</div>
        <div class="rb-value">${fmt(result.finalPrice, 4)}</div>
        <div class="rb-sub">Profit + labour included</div>
      </div>
      <div class="result-big-secondary">
        <div class="rb-label">Total for ${result.quantity.toLocaleString('en-IN')} Qty</div>
        <div class="rb-value">${fmt(result.finalTotal, 2)}</div>
        <div class="rb-sub">${fmt(result.finalPrice, 4)} × ${result.quantity.toLocaleString('en-IN')}</div>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <span class="card-title">Foil Breakdown</span>
        <span class="type-badge">${result.classLabel}</span>
      </div>
      <div style="font-size:12px;color:var(--color-text-tertiary)">
        Area: <span style="font-family:var(--mono)">(${fmtNum(result.sizeMm, 2)} + 5) × (${fmtNum(result.sizeMm, 2)} + 5) = ${fmtNum(result.areaMm2, 2)} mm² (${result.areaSqM.toFixed(6)} m²)</span>
        · Group: ${FOIL_GROUPS[result.materialGroupKey].label}
        · Thickness: ${result.thicknessKey}
        · Printing: ${result.printed ? 'Printed' : 'Plain'}
        · Qty: ${result.quantity.toLocaleString('en-IN')}
      </div>
      <div style="overflow-x:auto">
        <table class="p-table">
          <thead>
            <tr><th>Component</th><th>GSM</th><th>Rate/kg</th><th>Cost/pouch</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>${result.classLabel}</td>
              <td style="font-family:var(--mono);font-size:12px">${fmtNum(result.totalGsm, 3)}</td>
              <td style="font-family:var(--mono);font-size:12px">₹${rates[result.materialRateKey].toLocaleString('en-IN')}</td>
              <td style="font-family:var(--mono);font-size:12px">${fmt(result.materialCost.costPerPouch, 4)}</td>
            </tr>
            <tr>
              <td>Ink</td>
              <td style="font-family:var(--mono);font-size:12px">${result.printed ? FOIL_PRINTING_GSM : 0}</td>
              <td style="font-family:var(--mono);font-size:12px">₹${rates.ink.toLocaleString('en-IN')}</td>
              <td style="font-family:var(--mono);font-size:12px">${fmt(result.inkCost.costPerPouch, 4)}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td colspan="3" style="font-weight:600">Cost + Profit (${result.profitPercent}%)</td>
              <td style="font-family:var(--mono);font-size:12px;font-weight:600">${fmt(result.priceWithProfit, 4)}</td>
            </tr>
            <tr>
              <td colspan="3" style="font-weight:600">Labour Cost</td>
              <td style="font-family:var(--mono);font-size:12px;font-weight:600">${fmt(result.labourPerPouch, 2)}</td>
            </tr>
            <tr>
              <td colspan="3" style="font-weight:600">Final Price (Per Pouch)</td>
              <td style="font-family:var(--mono);font-size:12px;font-weight:600">${fmt(result.finalPrice, 4)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  `;
}

function calculateFoil() {
  const gsmByThickness = getGsmMapFromInputs();
  const rates = getRatesFromStore();
  const sizeMm = parseFloat(document.getElementById('foil-size')?.value);
  const quantity = parseInt(document.getElementById('foil-quantity')?.value, 10);
  const wastagePercent = parseFloat(document.getElementById('foil-wastage')?.value);
  const profitPercent = parseFloat(document.getElementById('foil-profit')?.value);
  const err = validateInputs(gsmByThickness, rates, sizeMm, quantity, wastagePercent, profitPercent);
  if (err) return showError(err);
  hideError();

  const result = calcFoilPouch({
    materialGroupKey: selectedGroup,
    thicknessKey: selectedThickness,
    printType: selectedPrintType,
    gsmByThickness,
    rates,
    sizeMm,
    quantity,
    wastagePercent,
    profitPercent,
  });
  renderResults(result, rates);
}

function clearFoilResults() {
  const s = document.getElementById('foil-results-section');
  if (s) {
    s.style.display = 'none';
    s.innerHTML = '';
  }
  hideError();
}

export function initFoilCalc() {
  const groupToggle = document.getElementById('foil-group-toggle');
  const printToggle = document.getElementById('foil-print-toggle');
  const adviceBtn = document.getElementById('btn-foil-advice');
  if (!groupToggle || !printToggle) return;

  applyDefaultInputs();
  setButtonGroupActive('foil-group-toggle', 'group', selectedGroup);
  setButtonGroupActive('foil-print-toggle', 'print', selectedPrintType);
  renderThicknessButtons();
  renderGsmSectionVisibility();

  groupToggle.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedGroup = btn.dataset.group;
      setButtonGroupActive('foil-group-toggle', 'group', selectedGroup);
      renderThicknessButtons();
    });
  });
  printToggle.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedPrintType = btn.dataset.print;
      setButtonGroupActive('foil-print-toggle', 'print', selectedPrintType);
    });
  });
  adviceBtn?.addEventListener('click', () => {
    gsmSectionVisible = !gsmSectionVisible;
    renderGsmSectionVisibility();
  });

  document.getElementById('btn-foil-calculate')?.addEventListener('click', calculateFoil);
  document.getElementById('btn-foil-clear')?.addEventListener('click', clearFoilResults);
}
