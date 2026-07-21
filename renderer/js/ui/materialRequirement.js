/**
 * @file materialRequirement.js
 * @description Material Requirement report: pending orders only. Split pouch types by "+",
 * group by material and open size, sum KG and roll meters with per-line breakdown (company, job).
 */

import { getProductionOrders } from '../db.js';
import { MATERIALS } from '../data/materials.js';
import {
  calculateProduction,
  computeOpenSizeM2,
  distinctMaterialsFromPouchTypeKey,
} from './production.js';
import { showToast } from './toast.js';

/** @type {ReturnType<typeof buildMaterialRequirementMap> | null} */
let lastDataMap = null;

function byId(id) {
  return document.getElementById(id);
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function fmtWhole(n) {
  return Math.round(Number(n) || 0).toLocaleString('en-IN');
}

/** @returns {'pending'|'completed'} */
function normalizeOrderStatus(row) {
  const s = String(row?.orderStatus || 'pending').toLowerCase();
  return s === 'completed' ? 'completed' : 'pending';
}

function pendingOrdersOnly(orders) {
  return orders.filter((o) => normalizeOrderStatus(o) === 'pending');
}

function lineKgRounded(order) {
  const stored = Number(order.kg);
  if (Number.isFinite(stored)) return Math.round(stored);
  return Math.round(calculateProduction(order).kg);
}

function openSizeKey(order) {
  return Math.round(computeOpenSizeM2(order));
}

/**
 * Resolve GSM for a material name from the requirement roll-up
 * (e.g. "One Side Transparent" matches "One Side Transparent (OST)").
 * @param {string} name
 * @returns {number}
 */
function gsmForMaterialLabel(name) {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return 0;
  for (const m of Object.values(MATERIALS)) {
    const lab = String(m.label || '').toLowerCase();
    const base = lab.replace(/\s*\([^)]*\)\s*$/, '').trim();
    if (lab === n || base === n) return Number(m.gsm) || 0;
  }
  return 0;
}

/**
 * Roll length (m) from weight, material GSM, and web width.
 * meters = (kg × 1_000_000) / (gsm × widthMm)
 * @param {number} kg
 * @param {number} gsm
 * @param {number} widthMm
 * @returns {number}
 */
function rollMetersFromKg(kg, gsm, widthMm) {
  if (!(gsm > 0) || !(widthMm > 0) || !(kg > 0)) return 0;
  return (kg * 1_000_000) / (gsm * widthMm);
}

/**
 * @typedef {{ kg: number, meters: number, companyName: string, jobName: string }} MrLineItem
 * @param {object[]} orders  Already filtered (e.g. pending only).
 * @returns {Record<string, Record<number, { totalKg: number, totalMeters: number, items: MrLineItem[] }>>}
 */
export function buildMaterialRequirementMap(orders) {
  /** @type {Record<string, Record<number, { totalKg: number, totalMeters: number, items: MrLineItem[] }>>} */
  const map = {};

  for (const o of orders) {
    const materials = distinctMaterialsFromPouchTypeKey(o.pouchType);
    if (!materials.length) continue;

    const openSz = openSizeKey(o);
    const kgLine = lineKgRounded(o);
    const widthMm = Number(o.widthMm);
    const companyName = String(o.companyName || '').trim();
    const jobName = String(o.jobName || '').trim();

    for (const mat of materials) {
      const gsm = gsmForMaterialLabel(mat);
      const metersLine = rollMetersFromKg(kgLine, gsm, widthMm);
      const line = { kg: kgLine, meters: metersLine, companyName, jobName };

      if (!map[mat]) map[mat] = {};
      if (!map[mat][openSz]) {
        map[mat][openSz] = { totalKg: 0, totalMeters: 0, items: [] };
      }
      const cell = map[mat][openSz];
      cell.totalKg += kgLine;
      cell.totalMeters += metersLine;
      cell.items.push(line);
    }
  }

  return map;
}

function formatBreakdownLine(item) {
  const kg = fmtWhole(item.kg);
  const co = item.companyName || '—';
  const job = item.jobName || '—';
  return `<span style="font-family:var(--mono)">${kg}</span> — ${escapeHtml(co)} — ${escapeHtml(job)}`;
}

function renderReportInto(root, dataMap) {
  if (!root) return;

  const materialNames = Object.keys(dataMap).sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
  if (!materialNames.length) {
    root.innerHTML = '<p style="margin:0;color:var(--color-text-tertiary);font-size:13px">No pending production orders.</p>';
    return;
  }

  const blocks = materialNames.map((name) => {
    const byOpen = dataMap[name];
    const sizes = Object.keys(byOpen)
      .map(Number)
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);

    const rows = sizes.map((sz) => {
      const { totalKg, totalMeters, items } = byOpen[sz];
      const detailInner = items.map((item) => `<div>${formatBreakdownLine(item)}</div>`).join('');
      return `
        <tr>
          <td style="font-family:var(--mono)">${fmtWhole(sz)}</td>
          <td style="font-family:var(--mono)">${fmtWhole(totalKg)}</td>
          <td style="font-family:var(--mono)">${fmtWhole(totalMeters)}</td>
          <td style="font-size:12px;line-height:1.45;color:var(--color-text-secondary);max-width:420px"><div style="display:flex;flex-direction:column;gap:4px">${detailInner}</div></td>
        </tr>`;
    }).join('');

    return `
      <div style="margin-top:20px">
        <div style="font-size:15px;font-weight:600;color:var(--color-text-primary);margin-bottom:10px">${escapeHtml(name)}</div>
        <div class="rates-table-wrap">
          <table class="rates-table">
            <thead>
              <tr>
                <th>Open Size</th>
                <th>Total KG</th>
                <th>Meters</th>
                <th>Breakdown</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
  });

  root.innerHTML = blocks.join('');
}

function sortedMaterialEntries(dataMap) {
  const materialNames = Object.keys(dataMap).sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
  return materialNames.map((name) => {
    const byOpen = dataMap[name];
    const sizes = Object.keys(byOpen)
      .map(Number)
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);
    return { name, sizes, byOpen };
  });
}

function hasReportData(dataMap) {
  return dataMap && Object.keys(dataMap).length > 0;
}

function buildSummaryRows(dataMap) {
  const rows = [];
  for (const { name, sizes, byOpen } of sortedMaterialEntries(dataMap)) {
    for (const sz of sizes) {
      rows.push({
        material: name,
        size: sz,
        kg: byOpen[sz].totalKg,
        meters: byOpen[sz].totalMeters,
      });
    }
  }
  return rows;
}

function buildDetailRows(dataMap) {
  const rows = [];
  for (const { name, sizes, byOpen } of sortedMaterialEntries(dataMap)) {
    for (const sz of sizes) {
      for (const item of byOpen[sz].items) {
        rows.push({
          material: name,
          size: sz,
          kg: item.kg,
          meters: item.meters,
          company: item.companyName || '',
          job: item.jobName || '',
        });
      }
    }
  }
  return rows;
}

function csvCell(value) {
  const s = String(value ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadCsv(filename, lines) {
  const blob = new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function printMaterialRequirement() {
  if (!hasReportData(lastDataMap)) {
    showToast('info', 'No data to print.');
    return;
  }

  const summaryRows = buildSummaryRows(lastDataMap);
  const bodyRows = summaryRows.map((r) => `
    <tr>
      <td>${escapeHtml(r.material)}</td>
      <td style="font-family:Consolas,monospace">${fmtWhole(r.size)}</td>
      <td style="font-family:Consolas,monospace">${fmtWhole(r.kg)}</td>
      <td style="font-family:Consolas,monospace">${fmtWhole(r.meters)}</td>
    </tr>
  `).join('');

  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(frame);

  const doc = frame.contentDocument || frame.contentWindow?.document;
  if (!doc || !frame.contentWindow) {
    frame.remove();
    showToast('info', 'Unable to initialize print preview.');
    return;
  }

  doc.open();
  doc.write(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8"/>
        <title>Material Requirement</title>
        <style>
          body{font-family:Arial,sans-serif;margin:16px;color:#111}
          h2{margin:0 0 4px 0;font-size:18px}
          p.sub{margin:0 0 12px 0;font-size:12px;color:#555}
          table{width:100%;border-collapse:collapse;font-size:12px}
          th,td{border:1px solid #cfcfcf;padding:6px 8px;vertical-align:top;text-align:left}
          thead th{background:#f5f5f5}
        </style>
      </head>
      <body>
        <h2>Material Requirement</h2>
        <p class="sub">Pending orders only — summary by material and open size</p>
        <table>
          <thead>
            <tr>
              <th>Material</th>
              <th>Open Size</th>
              <th>KG</th>
              <th>Meters</th>
            </tr>
          </thead>
          <tbody>${bodyRows}</tbody>
        </table>
      </body>
    </html>
  `);
  doc.close();

  const cleanup = () => {
    setTimeout(() => frame.remove(), 300);
  };
  frame.contentWindow.addEventListener('afterprint', cleanup, { once: true });
  frame.contentWindow.focus();
  frame.contentWindow.print();
  setTimeout(cleanup, 3000);
}

function exportMaterialRequirement() {
  if (!hasReportData(lastDataMap)) {
    showToast('info', 'No data to export.');
    return;
  }

  const summaryHeader = ['Material', 'Open Size', 'KG', 'Meters'].map(csvCell).join(',');
  const summaryLines = [
    summaryHeader,
    ...buildSummaryRows(lastDataMap).map((r) => [
      csvCell(r.material),
      csvCell(r.size),
      csvCell(Math.round(Number(r.kg) || 0)),
      csvCell(Math.round(Number(r.meters) || 0)),
    ].join(',')),
  ];
  downloadCsv('material-requirement-summary.csv', summaryLines);

  const detailHeader = ['Material', 'Open Size', 'KG', 'Meters', 'Company', 'Product/Job'].map(csvCell).join(',');
  const detailLines = [
    detailHeader,
    ...buildDetailRows(lastDataMap).map((r) => [
      csvCell(r.material),
      csvCell(r.size),
      csvCell(Math.round(Number(r.kg) || 0)),
      csvCell(Math.round(Number(r.meters) || 0)),
      csvCell(r.company),
      csvCell(r.job),
    ].join(',')),
  ];
  setTimeout(() => downloadCsv('material-requirement-detail.csv', detailLines), 250);

  showToast('success', 'Exported summary and detail CSV files.');
}

export function initMaterialRequirement() {
  byId('btn-mr-print')?.addEventListener('click', printMaterialRequirement);
  byId('btn-mr-export')?.addEventListener('click', exportMaterialRequirement);
}

export async function renderMaterialRequirement() {
  const root = byId('mr-report-root');
  const all = await getProductionOrders();
  const orders = Array.isArray(all) ? all : [];
  const filtered = pendingOrdersOnly(orders);
  const dataMap = buildMaterialRequirementMap(filtered);
  lastDataMap = dataMap;
  renderReportInto(root, dataMap);
}
