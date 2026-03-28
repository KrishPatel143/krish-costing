/**
 * @file history.js
 * @description Calculation history UI — render list, clear all.
 */

import { getHistory, clearHistory as dbClearHistory, addHistory } from '../db.js';
import { fmt } from '../lib/formatter.js';
import { fmtDate } from '../lib/formatter.js';
import { showToast } from './toast.js';

export { addHistory };   // re-export so callers can use db.addHistory via this module

/** Render the history list into #history-list */
export async function renderHistory() {
  const el = document.getElementById('history-list');
  if (!el) return;

  const history = await getHistory();

  if (!history || history.length === 0) {
    el.innerHTML = `<div class="p-alert info" style="font-size:13px">
      <span>ℹ</span>
      <span>No calculations saved yet. Run a calculation to see it here.</span>
    </div>`;
    return;
  }

  el.innerHTML = history.map(h => {
    const badge = h.type === 'flexible'
      ? '<span class="p-badge info">Flexible</span>'
      : '<span class="p-badge neutral">Paper</span>';
    return `
      <div class="card" style="flex-direction:row;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;padding:14px 18px">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          ${badge}
          <span style="font-size:13px;font-weight:500;color:var(--color-text-primary)">${h.label}</span>
          <span style="font-size:12px;color:var(--color-text-tertiary)">
            ${h.height}×${h.width} mm &nbsp;·&nbsp; Qty: ${h.quantity.toLocaleString('en-IN')}
            &nbsp;·&nbsp; Ink: ${h.inkCoverage === 'half' ? 'Half' : 'Full'}
          </span>
        </div>
        <div style="display:flex;gap:24px;align-items:center">
          <div style="text-align:right">
            <div style="font-size:11px;color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:.06em">Per Pouch</div>
            <div style="font-family:var(--mono);font-size:14px;font-weight:600;color:#185FA5">${fmt(h.finalPerPouch)}</div>
          </div>
          <div style="text-align:right">
            <div style="font-size:11px;color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:.06em">Total</div>
            <div style="font-family:var(--mono);font-size:14px;font-weight:600;color:var(--color-text-primary)">${fmt(h.finalTotal)}</div>
          </div>
          <div style="font-size:11px;color:var(--color-text-tertiary);text-align:right">${fmtDate(h.savedAt)}</div>
        </div>
      </div>`;
  }).join('');
}

/** Clear all history and refresh the view */
export async function clearHistory() {
  await dbClearHistory();
  await renderHistory();
  showToast('info', '↺ History cleared.');
}

/** Wire up the clear-history button. Call on DOMContentLoaded. */
export function initHistory() {
  document.getElementById('btn-clear-history')
    ?.addEventListener('click', clearHistory);
}
