/**
 * @file resultsBuilder.js
 * @description Shared HTML builder for calculation results. Used by both
 * paperCalc.js and flexCalc.js — single source of truth for results layout.
 */

import { fmt, fmtNum } from '../lib/formatter.js';
import { SHOW_BREAKDOWN } from '../data/materials.js';

/**
 * Build the full results HTML string.
 * @param {object} o
 * @returns {string}
 */
export function buildResultsHTML(o) {
  const profitPct = o.profitPercent ?? 30;
  const thHTML   = o.tableHeaders.map(h => `<th>${h}</th>`).join('');
  const kgBanner = o.kgInfoLine
    ? `<div class="p-alert info" style="font-size:12px;margin-bottom:4px"><span>ℹ</span><span>${o.kgInfoLine}</span></div>`
    : '';

  const show = SHOW_BREAKDOWN ? '' : 'display:none';

  return `
    ${kgBanner}
    <div class="result-highlight">
      <div class="result-big">
        <div class="rb-label">Final Cost per Pouch</div>
        <div class="rb-value">${fmt(o.finalPerPouch, 2)}</div>
        <div class="rb-sub">Material + ${profitPct}% profit + labour</div>
      </div>
      <div class="result-big-secondary">
        <div class="rb-label">Total Cost for ${o.qtyLabel}</div>
        <div class="rb-value">${fmt(o.finalTotal, 2)}</div>
        <div class="rb-sub">${o.qtySubLabel}</div>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <span class="card-title">Material Breakdown</span>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="type-badge">per pouch + qty</span>
          <button class="p-btn p-btn-ghost" style="padding:3px 10px;font-size:12px"
            data-toggle="${o.breakdownId}">${SHOW_BREAKDOWN ? 'Hide' : 'Show'}</button>
        </div>
      </div>
      <div id="${o.breakdownId}" style="${show}">
        <div style="display:flex;flex-direction:column;gap:10px">
          <div style="font-size:12px;color:var(--color-text-tertiary)">${o.metaLine}</div>
          <div style="overflow-x:auto">
            <table class="p-table">
              <thead><tr>${thHTML}</tr></thead>
              <tbody>${o.matRowsHTML}</tbody>
              <tfoot>
                <tr>
                  <td colspan="${o.tableColspan}" style="font-weight:500">Total Material Cost</td>
                  <td style="font-family:var(--mono);font-size:12px;font-weight:600">${fmt(o.totalMatCostPerPouch, 4)}</td>
                  <td style="font-family:var(--mono);font-size:12px;font-weight:600">${fmt(o.qtyMatCost, 2)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <span class="card-title">Cost Summary</span>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="type-badge">breakdown</span>
          <button class="p-btn p-btn-ghost" style="padding:3px 10px;font-size:12px"
            data-toggle="${o.summaryId}">${SHOW_BREAKDOWN ? 'Hide' : 'Show'}</button>
        </div>
      </div>
      <div id="${o.summaryId}" style="${show}">
        <div class="summary-header">
          <span>Per pouch</span>
          <span>× ${o.quantity.toLocaleString('en-IN')} qty</span>
        </div>
        <div class="summary-row">
          <span class="sr-label">Material Cost</span>
          <div class="sr-values">
            <span>${fmt(o.totalMatCostPerPouch, 4)}</span>
            <span>${fmt(o.qtyMatCost, 2)}</span>
          </div>
        </div>
        <div class="summary-row">
          <span class="sr-label">Profit (${profitPct}% of material cost)</span>
          <div class="sr-values">
            <span>${fmt(o.profitPerPouch, 4)}</span>
            <span>${fmt(o.qtyProfit, 2)}</span>
          </div>
        </div>
        <div class="summary-row">
          <span class="sr-label">Labour <span class="labour-badge">${o.labourBadgeText}</span></span>
          <div class="sr-values">
            <span>${fmt(o.labourPerPouch, 2)}</span>
            <span>${fmt(o.qtyLabour, 2)}</span>
          </div>
        </div>
        <div class="summary-row" style="border-top:1.5px solid var(--color-border-primary);margin-top:4px;padding-top:12px">
          <span style="font-weight:600;font-size:14px;color:var(--color-text-primary)">Final Cost</span>
          <div style="display:flex;gap:24px;font-family:var(--mono)">
            <span style="font-size:15px;font-weight:600;color:#185FA5;min-width:80px;text-align:right">${fmt(o.finalPerPouch, 2)}</span>
            <span style="font-size:15px;font-weight:600;color:#185FA5;min-width:80px;text-align:right">${fmt(o.finalTotal, 2)}</span>
          </div>
        </div>
      </div>
    </div>
  `;
}
