/**
 * @file rates.js
 * @description Material Rates tab — render tables, save, reset handlers.
 */

import { MATERIALS, DEFAULT_RATES } from '../data/materials.js';
import { getRatesSync, saveRates as dbSaveRates, resetRates as dbResetRates } from '../db.js';
import { showToast } from './toast.js';

// ─── Readers ──────────────────────────────────────────────────────────────────

function getRatesFromInputs() {
  return Object.fromEntries(
    Object.keys(DEFAULT_RATES).map(key => {
      const el = document.getElementById(`rate-${key}`);
      return [key, el ? (parseFloat(el.value) || DEFAULT_RATES[key]) : DEFAULT_RATES[key]];
    })
  );
}



// ─── Renderers ────────────────────────────────────────────────────────────────

export function renderRatesTable() {
  const rates = getRatesSync();
  const tbody = document.getElementById('rates-tbody');
  const foilTbody = document.getElementById('foil-rates-tbody');
  if (!tbody) return;

  const rows = [
    { key: 'med',      ...MATERIALS.med      },
    { key: 'ost',      ...MATERIALS.ost      },
    { key: 'cromo',    ...MATERIALS.cromo    },
    { key: 'ply',      ...MATERIALS.ply      },
    { key: 'poster',   ...MATERIALS.poster   },
    { key: 'ink_half', ...MATERIALS.ink_half },
    { key: 'ink_full', ...MATERIALS.ink_full },
  ];

  tbody.innerHTML = rows.map(row => `
    <tr>
      <td>${row.label}</td>
      <td class="gsm-cell">${row.gsm} gsm</td>
      <td><div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:13px;color:var(--color-text-tertiary)">₹</span>
        <input class="rate-input" type="number" id="rate-${row.key}" value="${rates[row.key] ?? DEFAULT_RATES[row.key]}" min="0" step="0.01"/>
        <span style="font-size:12px;color:var(--color-text-tertiary)">per kg</span>
      </div></td>
    </tr>`).join('');

  if (!foilTbody) return;
  const foilRows = [
    { key: 'foil_blister', label: 'Blister Foil' },
    { key: 'foil_aluminium', label: 'Aluminium Foil' },
    { key: 'foil_imported', label: 'Imported Foil' },
  ];

  foilTbody.innerHTML = foilRows.map(row => `
    <tr>
      <td>${row.label}</td>
      <td><div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:13px;color:var(--color-text-tertiary)">₹</span>
        <input class="rate-input" type="number" id="rate-${row.key}" value="${rates[row.key] ?? DEFAULT_RATES[row.key]}" min="0" step="0.01"/>
        <span style="font-size:12px;color:var(--color-text-tertiary)">per kg</span>
      </div></td>
    </tr>`).join('');
}



// ─── Handlers ─────────────────────────────────────────────────────────────────

async function handleSaveRates() {
  await dbSaveRates(getRatesFromInputs());
  showToast('success', '✓ Material rates saved successfully.');
}

async function handleResetRates() {
  await dbResetRates();
  renderRatesTable();
  showToast('info', '↺ Material rates reset to defaults.');
}



/** Wire all rate buttons. Call once on DOMContentLoaded. */
export function initRates() {
  document.getElementById('btn-save-rates')     ?.addEventListener('click', handleSaveRates);
  document.getElementById('btn-reset-rates')    ?.addEventListener('click', handleResetRates);
}
