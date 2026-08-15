/**
 * @file production.js
 * @description Production order form + table for paper pouch manufacturing.
 */

import {
  getProductionOrders,
  getNextProductionOrderId,
  addProductionOrder,
  updateProductionDispatch,
  updateProductionOrder,
  deleteProductionOrder,
  getCompanies,
  printPreview,
} from '../db.js';
import { MATERIALS, POUCH_TYPES, PRODUCTION_SINGLE_SIDE_POUCH_TYPES, normalizePrintKind, normalizeInkCoverage, inkCoverageLabel } from '../data/materials.js';
import { fmt, fmtDate, fmtDateOnly } from '../lib/formatter.js';
import { showToast } from './toast.js';

const els = {};
let ordersCache = [];
let companiesCache = [];
let editingRowId = null;

function byId(id) {
  return document.getElementById(id);
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function numberOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function htmlAttr(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function showFormError(msg) {
  if (!els.formError || !els.formErrorMsg) return;
  els.formError.style.display = 'block';
  els.formErrorMsg.textContent = msg;
}

function hideFormError() {
  if (!els.formError) return;
  els.formError.style.display = 'none';
}

function buildUniqueCompanyList(orders) {
  return [...new Set(orders.map((o) => (o.companyName || '').trim()).filter(Boolean))];
}

function buildUniqueJobsForCompany(companyName, orders) {
  const needle = (companyName || '').trim().toLowerCase();
  return [...new Set(
    orders
      .filter((o) => (o.companyName || '').trim().toLowerCase() === needle)
      .map((o) => (o.jobName || '').trim())
      .filter(Boolean)
  )];
}

function companyDisplay(o) {
  const name = o?.companyName || '';
  if (o?.companyCode && name) return `${o.companyCode} · ${name}`;
  return name || '-';
}

function renderCompanySuggestions() {
  if (!els.companyList) return;
  const fromOrders = buildUniqueCompanyList(ordersCache);
  const fromMaster = companiesCache.map((c) => (c.name || '').trim()).filter(Boolean);
  const companies = [...new Set([...fromMaster, ...fromOrders])];
  els.companyList.innerHTML = companies.map((name) => `<option value="${name}"></option>`).join('');
}

function renderCompanyFilterSelect(sel) {
  if (!sel) return;
  const prev = sel.value;
  const companies = buildUniqueCompanyList(ordersCache).sort((a, b) => a.localeCompare(b));
  sel.textContent = '';
  const allOpt = document.createElement('option');
  allOpt.value = '';
  allOpt.textContent = 'All companies';
  sel.appendChild(allOpt);
  for (const name of companies) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    sel.appendChild(opt);
  }
  if (prev && companies.includes(prev)) sel.value = prev;
}

function renderOrderTableCompanyFilter() {
  renderCompanyFilterSelect(els.prodTableCompany);
  renderCompanyFilterSelect(els.prodDetailCompany);
}

/** Orders visible in the table after search / status / company / pouch type filters. */
function getFilteredProductionOrders() {
  let list = ordersCache.slice();
  const search = (els.prodTableSearch?.value || '').trim().toLowerCase();
  const status = els.prodTableStatus?.value || 'all';
  const companyNeedle = (els.prodTableCompany?.value || '').trim().toLowerCase();
  const pouchKey = (els.prodTablePouchType?.value || '').trim();

  if (search) {
    list = list.filter((o) => {
      const parts = [
        o.orderId,
        o.poNumber,
        o.companyName,
        o.jobName,
        o.orderDate,
        pouchTypeLabel(o.pouchType),
        printTypeLabel(o.printType),
        inkCoverageLabel(o.inkCoverage),
      ];
      const hay = parts.filter(Boolean).join(' ').toLowerCase();
      return hay.includes(search);
    });
  }
  if (status === 'pending') {
    list = list.filter((o) => normalizeOrderStatus(o) === 'pending');
  } else if (status === 'completed') {
    list = list.filter((o) => normalizeOrderStatus(o) === 'completed');
  }
  if (companyNeedle) {
    list = list.filter((o) => (o.companyName || '').trim().toLowerCase() === companyNeedle);
  }
  if (pouchKey) {
    list = list.filter((o) => String(o.pouchType || '') === pouchKey);
  }

  if (editingRowId != null) {
    const ed = ordersCache.find((o) => Number(o.id) === Number(editingRowId));
    if (ed && !list.some((o) => Number(o.id) === Number(editingRowId))) {
      list = [ed, ...list];
    }
  }
  return list;
}

function getDetailFilteredOrders() {
  let list = ordersCache.slice();
  const status = els.prodDetailStatus?.value || 'pending';
  const companyNeedle = (els.prodDetailCompany?.value || '').trim().toLowerCase();
  const pouchKey = (els.prodDetailPouchType?.value || '').trim();

  if (status === 'pending') {
    list = list.filter((o) => normalizeOrderStatus(o) === 'pending');
  } else if (status === 'completed') {
    list = list.filter((o) => normalizeOrderStatus(o) === 'completed');
  }
  if (companyNeedle) {
    list = list.filter((o) => (o.companyName || '').trim().toLowerCase() === companyNeedle);
  }
  if (pouchKey) {
    list = list.filter((o) => String(o.pouchType || '') === pouchKey);
  }
  return list;
}

function renderJobSuggestions(companyName) {
  if (!els.jobList) return;
  const jobs = buildUniqueJobsForCompany(companyName, ordersCache);
  els.jobList.innerHTML = jobs.map((name) => `<option value="${name}"></option>`).join('');
}

function latestOrderByCompanyAndJob(companyName, jobName) {
  const c = (companyName || '').trim().toLowerCase();
  const j = (jobName || '').trim().toLowerCase();
  if (!c || !j) return null;
  return ordersCache.find((o) =>
    (o.companyName || '').trim().toLowerCase() === c &&
    (o.jobName || '').trim().toLowerCase() === j
  ) || null;
}

function autofillFromLastOrder() {
  const last = latestOrderByCompanyAndJob(els.companyName?.value, els.jobName?.value);
  if (!last) return;
  if (els.pouchType) els.pouchType.value = last.pouchType || '';
  if (els.widthMm) els.widthMm.value = last.widthMm ?? '';
  if (els.heightMm) els.heightMm.value = last.heightMm ?? '';
  if (els.cylinderUpMm) els.cylinderUpMm.value = last.cylinderUpMm ?? '';
  if (els.printType) els.printType.value = normalizeProductionPrintType(last.printType) || 'printed';
  if (els.inkCoverage) els.inkCoverage.value = normalizeInkCoverage(last.inkCoverage, last.printType);
  if (els.rate) els.rate.value = last.rate ?? '';
  if (els.quantityUnit) els.quantityUnit.value = last.quantityUnit || 'nos';
  syncProductionPouchFormUI();
}

function isProductionSingleSidePouch(pouchType) {
  return Boolean(PRODUCTION_SINGLE_SIDE_POUCH_TYPES[pouchType]);
}

function productionSingleSideGsm(pouchType) {
  const cfg = PRODUCTION_SINGLE_SIDE_POUCH_TYPES[pouchType];
  if (!cfg) return 0;
  return MATERIALS[cfg.gsmKey]?.gsm ?? 0;
}

function pouchSingleSideGsm(pouchType) {
  if (isProductionSingleSidePouch(pouchType)) return productionSingleSideGsm(pouchType);
  const pt = POUCH_TYPES[pouchType];
  if (!pt) return 0;
  return MATERIALS[pt.side1]?.gsm ?? 0;
}

/** Total pouch GSM (side 1 + side 2) — laminate kg path; single-web uses one gsm only. */
function pouchTotalGsm(pouchType) {
  if (isProductionSingleSidePouch(pouchType)) return productionSingleSideGsm(pouchType);
  const pt = POUCH_TYPES[pouchType];
  if (!pt) return 0;
  const s1 = MATERIALS[pt.side1]?.gsm ?? 0;
  const s2 = MATERIALS[pt.side2]?.gsm ?? 0;
  return s1 + s2;
}

function normalizeProductionPrintType(printType) {
  return normalizePrintKind(printType);
}

function productionPrintFactor(printType) {
  const t = String(printType || '').toLowerCase();
  if (t === 'two_side') return 2;
  return 1;
}

function printAndFaceLabel(row) {
  const kind = normalizePrintKind(row?.printType);
  if (kind === 'plain') return 'Plain';
  if (kind === 'printed') return `Printed · ${inkCoverageLabel(row?.inkCoverage)}`;
  return '-';
}

/** Same as calculateProduction: ((widthMm × cylinderUpMm) / 1000) × printFactor */
export function computeOpenSizeM2(order) {
  const widthMm = numberOrNull(order?.widthMm) ?? 0;
  const cylinderUpMm = numberOrNull(order?.cylinderUpMm) ?? 0;
  const pf = productionPrintFactor(order?.printType);
  return (widthMm * cylinderUpMm)  * pf;
}

function pouchTypeLabel(pouchTypeKey) {
  if (PRODUCTION_SINGLE_SIDE_POUCH_TYPES[pouchTypeKey]) {
    return PRODUCTION_SINGLE_SIDE_POUCH_TYPES[pouchTypeKey].label;
  }
  return POUCH_TYPES[pouchTypeKey]?.label ?? (pouchTypeKey || '—');
}

/**
 * Material names for requirement roll-up: split pouch label on "+", trim, dedupe.
 * e.g. "Cromo + Cromo" → ["Cromo"]; "Medical Paper + One Side Transparent" → both sides.
 * @param {string} pouchTypeKey
 * @returns {string[]}
 */
export function distinctMaterialsFromPouchTypeKey(pouchTypeKey) {
  const label = pouchTypeLabel(pouchTypeKey);
  if (!label || label === '—') return [];
  const seen = new Set();
  const out = [];
  for (const part of label.split('+')) {
    const t = part.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/**
 * Laminate labels "A + B" → line break after + ; second line slightly indented.
 * Single-web labels stay one line.
 */
function pouchTypeDisplayHtml(pouchTypeKey) {
  const label = pouchTypeLabel(pouchTypeKey);
  if (!label || label === '—') return label;
  const sep = ' + ';
  const i = label.indexOf(sep);
  if (i === -1) return escapeHtml(label);
  const first = label.slice(0, i).trimEnd();
  const second = label.slice(i + sep.length).trim();
  return `${escapeHtml(first)} +<br/><span style="display:block;padding-left:6px;margin-top:2px;line-height:1.35;color:var(--color-text-secondary)">${escapeHtml(second)}</span>`;
}

function pouchTypeSelectHtml(selectedKey) {
  const singleOpts = Object.entries(PRODUCTION_SINGLE_SIDE_POUCH_TYPES)
    .map(([k, { label }]) => `<option value="${k}" ${k === selectedKey ? 'selected' : ''}>${label}</option>`)
    .join('');
  const lamOpts = Object.entries(POUCH_TYPES)
    .map(([k, { label }]) => `<option value="${k}" ${k === selectedKey ? 'selected' : ''}>${label}</option>`)
    .join('');
  return `<option value="">Select type</option><optgroup label="Single web (kg only)">${singleOpts}</optgroup><optgroup label="Laminate pouch">${lamOpts}</optgroup>`;
}

/** Single-web row: show width only (no height). */
function pouchSizeCellDisplay(o) {
  if (isProductionSingleSidePouch(o.pouchType)) {
    return `${fmtWhole(o.widthMm)} mm`;
  }
  return `${fmtWhole(o.widthMm)}*${fmtWhole(o.heightMm)}`;
}

export function calculateProduction(entry) {
  const wasteFactor = 1.05;
  const widthMm = numberOrNull(entry.widthMm) ?? 0;
  const cylinderUpMm = numberOrNull(entry.cylinderUpMm) ?? 0;
  const rawQty = numberOrNull(entry.quantity) ?? 0;
const qty = Math.round(rawQty * wasteFactor);
  const unit = entry.quantityUnit;
  const printFactor = productionPrintFactor(entry.printType);

  if (isProductionSingleSidePouch(entry.pouchType)) {
    const gsm = productionSingleSideGsm(entry.pouchType);
    const totalGrams = qty * 1000;
    const heightMm = 0;
    const pouchSizeM2 = 0;
    const openSizeM2 = ((widthMm * cylinderUpMm) / 1000) * printFactor;
    const totalMeter = gsm > 0 ? totalGrams / gsm : 0;
    const meter = openSizeM2 > 0 ? totalMeter / openSizeM2 : 0;
    const effectiveGsm = gsm;
    const kg = gsm > 0 ? (totalMeter * gsm) / 1000 : 0;
    return { pouchSizeM2, openSizeM2, totalMeter, meter, kg, effectiveGsm };
  }

  const heightMm = numberOrNull(entry.heightMm) ?? 0;
  const pouchSizeM2 = ((heightMm * widthMm) / 1_000_000) * printFactor;
  const openSizeM2 = ((widthMm * cylinderUpMm) / 1000) * printFactor;

  let totalMeter = 0;
  let meter = 0;
  let kg = 0;
  let effectiveGsm = 0;

  if (unit === 'nos') {
    effectiveGsm = pouchSingleSideGsm(entry.pouchType);
    totalMeter = pouchSizeM2 * qty;
    meter = openSizeM2 > 0 ? totalMeter / openSizeM2 : 0;
    kg = (totalMeter * effectiveGsm) / 1000;
  } else {
    effectiveGsm = pouchTotalGsm(entry.pouchType);
    const totalWeightGrams = qty * 1000 *  printFactor;
    totalMeter = effectiveGsm > 0 ? totalWeightGrams / effectiveGsm : 0;
    meter = openSizeM2 > 0 ? totalMeter / openSizeM2 : 0;
    effectiveGsm = pouchSingleSideGsm(entry.pouchType);
    kg = (totalMeter * effectiveGsm) / 1000;
  }

  return { pouchSizeM2, openSizeM2, totalMeter, meter, kg, effectiveGsm };
}

function readForm() {
  const pouchType = els.pouchType?.value || '';
  const single = isProductionSingleSidePouch(pouchType);
  return {
    orderDate: els.orderDate?.value || todayIsoDate(),
    orderId: els.orderId?.value || '',
    poNumber: (els.poNumber?.value || '').trim(),
    companyName: (els.companyName?.value || '').trim(),
    jobName: (els.jobName?.value || '').trim(),
    pouchType,
    widthMm: numberOrNull(els.widthMm?.value),
    heightMm: single ? 0 : numberOrNull(els.heightMm?.value),
    cylinderUpMm: numberOrNull(els.cylinderUpMm?.value),
    printType: els.printType?.value || '',
    inkCoverage: normalizeInkCoverage(els.inkCoverage?.value, els.printType?.value),
    rate: numberOrNull(els.rate?.value),
    quantity: numberOrNull(els.quantity?.value),
    quantityUnit: single ? 'kg' : (els.quantityUnit?.value || 'nos'),
    dispatchQuantity: null,
  };
}

function validateForm(data) {
  const requiredText = ['companyName', 'jobName', 'pouchType', 'printType'];
  for (const k of requiredText) {
    if (!data[k]) return `Please fill ${k}.`;
  }
  const single = isProductionSingleSidePouch(data.pouchType);
  if (!single && !data.quantityUnit) return 'Please select quantity unit.';
  if (single && String(data.quantityUnit).toLowerCase() !== 'kg') return 'Single web pouch types must use KG quantity.';
  const requiredNum = ['widthMm', 'cylinderUpMm', 'rate', 'quantity'];
  for (const k of requiredNum) {
    if (!Number.isFinite(data[k]) || data[k] <= 0) return `Please enter valid ${k}.`;
  }
  if (!single) {
    if (!Number.isFinite(data.heightMm) || data.heightMm <= 0) return 'Please enter valid heightMm.';
  }
  return null;
}

function syncProductionPouchFormUI() {
  const pouchType = els.pouchType?.value || '';
  const single = isProductionSingleSidePouch(pouchType);
  if (els.heightFieldGroup) els.heightFieldGroup.style.display = single ? 'none' : '';
  if (els.heightMm && single) {
    els.heightMm.value = '';
    els.heightMm.required = false;
  } else if (els.heightMm) {
    els.heightMm.required = true;
  }
  if (els.quantityUnitWrap) els.quantityUnitWrap.style.display = single ? 'none' : '';
  if (els.quantityKgOnlyWrap) els.quantityKgOnlyWrap.style.display = single ? '' : 'none';
  if (els.quantityUnit && single) els.quantityUnit.value = 'kg';
  syncInkCoverageUI();
}

function fmtUnitQty(qty, unit) {
  const roundedQty = Math.round(Number(qty) || 0);
  return `${roundedQty.toLocaleString('en-IN')} ${String(unit || '').toUpperCase()}`;
}

function fmtWhole(n) {
  return Math.round(Number(n) || 0).toLocaleString('en-IN');
}

function printTypeLabel(printType) {
  const v = normalizeProductionPrintType(printType);
  if (v === 'plain') return 'Plain';
  if (v === 'printed') return 'Printed';
  return '-';
}

function syncInkCoverageUI() {
  const plain = normalizePrintKind(els.printType?.value) === 'plain';
  if (els.inkCoverage) els.inkCoverage.disabled = plain;
  if (els.inkCoverageWrap) els.inkCoverageWrap.style.opacity = plain ? '0.55' : '';
  if (plain && els.inkCoverage) els.inkCoverage.value = 'half';
}

function dispatchEntries(row) {
  return Array.isArray(row?.dispatchEntries) ? row.dispatchEntries : [];
}

function dispatchTotal(row) {
  return dispatchEntries(row).reduce((s, e) => s + (Number(e.quantity) || 0), 0);
}

/** @returns {'pending'|'completed'} */
function normalizeOrderStatus(row) {
  const s = String(row?.orderStatus || 'pending').toLowerCase();
  return s === 'completed' ? 'completed' : 'pending';
}

/** Auto-complete when total dispatched ≥ ordered qty (NOS pouches or KG). */
function shouldAutoCompleteOrder(row) {
  if (normalizeOrderStatus(row) === 'completed') return false;
  const ordered = Number(row?.quantity) || 0;
  if (ordered <= 0) return false;
  return dispatchTotal(row) >= ordered;
}

function orderStatusLabel(row) {
  return normalizeOrderStatus(row) === 'completed' ? 'Completed' : 'Pending';
}

function dispatchUnitLabel(row) {
  return String(row?.quantityUnit || 'nos').toLowerCase() === 'kg' ? 'kg' : 'pouch';
}

function dispatchTooltip(row) {
  const entries = dispatchEntries(row);
  if (!entries.length) return 'No dispatch yet';
  const unit = dispatchUnitLabel(row);
  return entries
    .map((e) => `${fmtDateOnly(e.date)}: ${fmtWhole(e.quantity)} ${unit}`)
    .join('\n');
}

function openSizeDisplay(order) {
  const v = computeOpenSizeM2(order);
  return fmtWhole(v);
}

function renderDetailTable() {
  if (!els.prodDetailTbody) return;
  if (!ordersCache.length) {
    els.prodDetailTbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--color-text-tertiary)">No production orders yet.</td></tr>';
    return;
  }
  const visible = getDetailFilteredOrders();
  if (!visible.length) {
    els.prodDetailTbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--color-text-tertiary)">No orders match your filters.</td></tr>';
    return;
  }
  els.prodDetailTbody.innerHTML = visible.map((o) => `
    <tr>
      <td>${fmtDateOnly(o.orderDate)}</td>
      <td>${escapeHtml(companyDisplay(o))}</td>
      <td>${escapeHtml(o.jobName || '-')}</td>
      <td style="font-size:12px;max-width:220px;line-height:1.35">${pouchTypeDisplayHtml(o.pouchType)}</td>
      <td style="font-family:var(--mono)">${pouchSizeCellDisplay(o)}</td>
      <td style="font-family:var(--mono)">${fmtUnitQty(o.quantity, o.quantityUnit)}</td>
      <td style="font-family:var(--mono)">${openSizeDisplay(o)}</td>
      <td style="font-family:var(--mono)">${fmtWhole(o.meter)}</td>
      <td style="font-family:var(--mono)">${fmtWhole(o.kg)}</td>
    </tr>
  `).join('');
}

function statusFilterLabel(value) {
  if (value === 'completed') return 'Completed';
  if (value === 'all') return 'All statuses';
  return 'Pending';
}

function filterSummaryLine({ statusValue, companyValue, pouchValue, searchValue }) {
  const parts = [statusFilterLabel(statusValue || 'pending')];
  const company = (companyValue || '').trim();
  if (company) parts.push(`Company: ${company}`);
  const pouch = (pouchValue || '').trim();
  if (pouch) parts.push(`Pouch: ${pouchTypeLabel(pouch)}`);
  const search = (searchValue || '').trim();
  if (search) parts.push(`Search: “${search}”`);
  return parts.join(' · ');
}

function openProductionPrintFrame(title, subtitle, tableHtml) {
  const html = `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8"/>
        <title>${escapeHtml(title)}</title>
        <style>
          body{font-family:Arial,sans-serif;margin:16px;color:#111}
          h2{margin:0 0 4px 0;font-size:18px}
          p.sub{margin:0 0 12px 0;font-size:12px;color:#555}
          table{width:100%;border-collapse:collapse;font-size:11px}
          th,td{border:1px solid #cfcfcf;padding:5px 6px;vertical-align:top;text-align:left}
          thead th{background:#f5f5f5}
          @media print{body{margin:8px}}
        </style>
      </head>
      <body>
        <h2>${escapeHtml(title)}</h2>
        <p class="sub">${escapeHtml(subtitle)}</p>
        ${tableHtml}
      </body>
    </html>`;

  printPreview(html, title).then((res) => {
    if (!res?.ok) showToast('warn', res?.error || 'Unable to open print preview.');
  }).catch(() => {
    showToast('warn', 'Unable to open print preview.');
  });
}

function printOrdersTable() {
  const visible = getFilteredProductionOrders();
  if (!visible.length) {
    showToast('info', 'No orders match your filters.');
    return;
  }

  const rows = visible.map((o) => `
    <tr>
      <td>${escapeHtml(fmtDateOnly(o.orderDate))}</td>
      <td>${escapeHtml(o.orderId || '-')}</td>
      <td>${escapeHtml((o.poNumber || '').trim() || '—')}</td>
      <td>${escapeHtml(printAndFaceLabel(o))}</td>
      <td>${escapeHtml(companyDisplay(o))}</td>
      <td>${escapeHtml(o.jobName || '-')}</td>
      <td>${escapeHtml(pouchTypeLabel(o.pouchType))}</td>
      <td>${escapeHtml(pouchSizeCellDisplay(o))}</td>
      <td>${escapeHtml(fmtUnitQty(o.quantity, o.quantityUnit))}</td>
      <td>${escapeHtml(fmt(o.rate || 0, 2))}</td>
      <td>${escapeHtml(openSizeDisplay(o))}</td>
      <td>${escapeHtml(fmtWhole(o.meter))}</td>
      <td>${escapeHtml(fmtWhole(o.kg))}</td>
      <td>${escapeHtml(fmtWhole(dispatchTotal(o)))}</td>
      <td>${escapeHtml(orderStatusLabel(o))}</td>
    </tr>
  `).join('');

  const tableHtml = `
    <table>
      <thead>
        <tr>
          <th>Date</th><th>Order ID</th><th>PO</th><th>Print</th><th>Company</th>
          <th>Job</th><th>Pouch Type</th><th>Size</th><th>Qty</th><th>Rate</th>
          <th>Open size</th><th>Meter</th><th>KG</th><th>Dispatch</th><th>Status</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  const subtitle = filterSummaryLine({
    statusValue: els.prodTableStatus?.value,
    companyValue: els.prodTableCompany?.value,
    pouchValue: els.prodTablePouchType?.value,
    searchValue: els.prodTableSearch?.value,
  }) + ` · ${visible.length} order${visible.length === 1 ? '' : 's'}`;

  openProductionPrintFrame('Production Orders', subtitle, tableHtml);
}

function printDetailTable() {
  const visible = getDetailFilteredOrders();
  if (!visible.length) {
    showToast('info', 'No orders match your filters.');
    return;
  }

  const rows = visible.map((o) => `
    <tr>
      <td>${escapeHtml(fmtDateOnly(o.orderDate))}</td>
      <td>${escapeHtml(companyDisplay(o))}</td>
      <td>${escapeHtml(o.jobName || '-')}</td>
      <td>${escapeHtml(pouchTypeLabel(o.pouchType))}</td>
      <td>${escapeHtml(pouchSizeCellDisplay(o))}</td>
      <td>${escapeHtml(fmtUnitQty(o.quantity, o.quantityUnit))}</td>
      <td>${escapeHtml(openSizeDisplay(o))}</td>
      <td>${escapeHtml(fmtWhole(o.meter))}</td>
      <td>${escapeHtml(fmtWhole(o.kg))}</td>
    </tr>
  `).join('');

  const tableHtml = `
    <table>
      <thead>
        <tr>
          <th>Date</th><th>Company</th><th>Product/Job</th><th>Pouch Type</th>
          <th>Pouch Size</th><th>Quantity</th><th>Open size</th><th>Meter</th><th>KG</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  const subtitle = filterSummaryLine({
    statusValue: els.prodDetailStatus?.value,
    companyValue: els.prodDetailCompany?.value,
    pouchValue: els.prodDetailPouchType?.value,
  }) + ` · ${visible.length} order${visible.length === 1 ? '' : 's'}`;

  openProductionPrintFrame('Production Detail', subtitle, tableHtml);
}

function renderOrdersTable() {
  if (!els.ordersTbody) return;
  if (!ordersCache.length) {
    els.ordersTbody.innerHTML = '<tr><td colspan="16" style="text-align:center;color:var(--color-text-tertiary)">No production orders yet.</td></tr>';
    return;
  }

  const visible = getFilteredProductionOrders();
  if (!visible.length) {
    els.ordersTbody.innerHTML = '<tr><td colspan="16" style="text-align:center;color:var(--color-text-tertiary)">No orders match your filters.</td></tr>';
    return;
  }

  els.ordersTbody.innerHTML = visible.map((o) => `
    <tr>
      <td title="${o.savedAt ? fmtDate(o.savedAt) : ''}">
        ${editingRowId === o.id ? `
        <input class="p-input prod-edit-order-date" data-prod-id="${o.id}" type="date" value="${o.orderDate || ''}" style="width:140px"/>
        ` : fmtDateOnly(o.orderDate)}
      </td>
      <td style="font-family:var(--mono)">${o.orderId || '-'}</td>
      <td style="font-family:var(--mono)">
        ${editingRowId === o.id
          ? `<input class="p-input prod-edit-po-number" data-prod-id="${o.id}" type="text" value="${htmlAttr(o.poNumber || '')}" placeholder="Optional" style="width:120px"/>`
          : ((o.poNumber || '').trim() || '—')}
      </td>
      <td>
        ${editingRowId === o.id ? `
        <select class="p-select prod-edit-print-type" data-prod-id="${o.id}" style="min-width:100px">
          <option value="plain" ${normalizeProductionPrintType(o.printType) === 'plain' ? 'selected' : ''}>Plain</option>
          <option value="printed" ${normalizeProductionPrintType(o.printType) !== 'plain' ? 'selected' : ''}>Printed</option>
        </select>
        <select class="p-select prod-edit-ink-coverage" data-prod-id="${o.id}" style="min-width:110px;margin-top:6px" ${normalizeProductionPrintType(o.printType) === 'plain' ? 'disabled' : ''}>
          <option value="half" ${normalizeInkCoverage(o.inkCoverage, o.printType) !== 'full' ? 'selected' : ''}>Half face</option>
          <option value="full" ${normalizeInkCoverage(o.inkCoverage, o.printType) === 'full' ? 'selected' : ''}>Full face</option>
        </select>
        ` : printAndFaceLabel(o)}
      </td>
      <td>
        ${editingRowId === o.id
          ? `<input class="p-input prod-edit-company" data-prod-id="${o.id}" type="text" value="${o.companyName || ''}" style="width:180px"/>`
          : companyDisplay(o)}
      </td>
      <td>
        ${editingRowId === o.id
          ? `<input class="p-input prod-edit-job" data-prod-id="${o.id}" type="text" value="${o.jobName || ''}" style="width:180px"/>`
          : (o.jobName || '-')}
      </td>
      <td style="font-size:12px;max-width:220px;line-height:1.35">
        ${editingRowId === o.id
          ? `<select class="p-select prod-edit-pouch-type" data-prod-id="${o.id}" style="min-width:160px;max-width:220px">${pouchTypeSelectHtml(o.pouchType || '')}</select>`
          : pouchTypeDisplayHtml(o.pouchType)}
      </td>
      <td style="font-family:var(--mono)">${pouchSizeCellDisplay(o)}</td>
      <td style="font-family:var(--mono)">
        ${editingRowId === o.id ? `
        <div class="prod-edit-qty-cell" data-prod-id="${o.id}" style="display:flex;gap:6px;align-items:center">
          <input class="p-input prod-edit-quantity" data-prod-id="${o.id}" type="number" min="0.001" step="0.001" value="${o.quantity ?? 0}" style="width:100px"/>
          <select class="p-select prod-edit-unit-lam" data-prod-id="${o.id}" style="min-width:84px;display:${isProductionSingleSidePouch(o.pouchType) ? 'none' : ''}">
            <option value="nos" ${String(o.quantityUnit).toLowerCase() === 'nos' ? 'selected' : ''}>NOS</option>
            <option value="kg" ${String(o.quantityUnit).toLowerCase() === 'kg' ? 'selected' : ''}>KG</option>
          </select>
          <span class="prod-edit-unit-kg-label" style="font-size:12px;color:var(--color-text-tertiary);white-space:nowrap;display:${isProductionSingleSidePouch(o.pouchType) ? 'inline' : 'none'}">KG</span>
        </div>
        ` : fmtUnitQty(o.quantity, o.quantityUnit)}
      </td>
      <td style="font-family:var(--mono)">
        ${editingRowId === o.id
          ? `<input class="p-input prod-edit-rate" data-prod-id="${o.id}" type="number" min="0" step="0.01" value="${o.rate ?? 0}" style="width:110px"/>`
          : fmt(o.rate || 0, 2)}
      </td>
      <td style="font-family:var(--mono);font-size:12px" title="(width × cylinder up) / 1000 × print factor">
        ${editingRowId === o.id
          ? `<span class="prod-open-size-preview" data-prod-id="${o.id}">${openSizeDisplay(o)}</span>`
          : openSizeDisplay(o)}
      </td>
      <td style="font-family:var(--mono)">
        ${editingRowId === o.id
          ? `<input class="p-input prod-edit-meter" data-prod-id="${o.id}" type="number" min="0" step="1" value="${fmtWhole(o.meter).replace(/,/g,'')}" style="width:90px"/>`
          : fmtWhole(o.meter)}
      </td>
      <td style="font-family:var(--mono)">
        ${editingRowId === o.id
          ? `<input class="p-input prod-edit-kg" data-prod-id="${o.id}" type="number" min="0" step="1" value="${fmtWhole(o.kg).replace(/,/g,'')}" style="width:90px"/>`
          : fmtWhole(o.kg)}
      </td>
      <td>
        ${editingRowId === o.id
          ? `<input class="p-input prod-dispatch-input" data-prod-id="${o.id}" type="number" min="0" step="1" value="${o.dispatchQuantity ?? 0}" style="width:120px"/>`
          : `
            <div style="display:flex;flex-direction:column;gap:6px">
              <div style="font-family:var(--mono)">
                ${fmtWhole(dispatchTotal(o))} <span title="${dispatchTooltip(o)}" style="cursor:help;color:#185FA5">ⓘ</span>
              </div>
              <div style="display:flex;gap:6px;align-items:center">
                <input class="p-input prod-add-dispatch-date" data-prod-id="${o.id}" type="date" value="${todayIsoDate()}" style="width:140px"/>
                <input class="p-input prod-add-dispatch-qty" data-prod-id="${o.id}" type="number" min="0.001" step="${String(o.quantityUnit).toLowerCase() === 'kg' ? '0.001' : '1'}" placeholder="${String(o.quantityUnit).toLowerCase() === 'kg' ? 'KG' : 'Qty'}" style="width:90px"/>
                <button class="p-btn prod-add-dispatch-btn" data-prod-id="${o.id}" type="button" style="padding:6px 8px">Add</button>
              </div>
            </div>
          `}
      </td>
      <td>
        ${editingRowId === o.id
          ? '—'
          : `<span class="type-badge" style="${normalizeOrderStatus(o) === 'completed' ? 'background:#e8f5e9;color:#1b5e20' : 'background:#fff8e1;color:#f57f17'}"
              title="${o.completedAt ? fmtDate(o.completedAt) : ''}">${orderStatusLabel(o)}</span>`}
      </td>
      <td>
        ${editingRowId === o.id
          ? `<button class="p-btn p-btn-primary prod-update-btn" data-prod-id="${o.id}" type="button" style="padding:6px 10px">Update</button>
             <button class="p-btn prod-cancel-btn" data-prod-id="${o.id}" type="button" style="padding:6px 10px;margin-left:6px">Cancel</button>`
          : `<div style="display:flex;flex-direction:column;gap:6px;align-items:flex-start">
               <button class="p-btn prod-edit-btn" data-prod-id="${o.id}" type="button" style="padding:6px 10px">Edit</button>
               ${normalizeOrderStatus(o) === 'pending'
            ? `<button class="p-btn p-btn-primary prod-complete-btn" data-prod-id="${o.id}" type="button" style="padding:6px 10px">Complete</button>`
            : ''}
               <button class="p-btn p-btn-danger prod-delete-btn" data-prod-id="${o.id}" type="button" style="padding:6px 10px">Delete</button>
             </div>`}
      </td>
    </tr>
  `).join('');

  els.ordersTbody.querySelectorAll('.prod-edit-pouch-type').forEach((sel) => {
    const id = sel.getAttribute('data-prod-id');
    const tr = sel.closest('tr');
    if (!tr) return;
    const lam = tr.querySelector(`.prod-edit-unit-lam[data-prod-id="${id}"]`);
    const kgLbl = tr.querySelector(`.prod-edit-qty-cell[data-prod-id="${id}"] .prod-edit-unit-kg-label`);
    const syncQtyUnit = () => {
      const single = isProductionSingleSidePouch(sel.value);
      if (lam) lam.style.display = single ? 'none' : '';
      if (kgLbl) kgLbl.style.display = single ? 'inline' : 'none';
    };
    sel.addEventListener('change', syncQtyUnit);
    syncQtyUnit();
  });

  els.ordersTbody.querySelectorAll('.prod-edit-print-type').forEach((sel) => {
    const id = sel.getAttribute('data-prod-id');
    const row = ordersCache.find((it) => String(it.id) === String(id));
    const span = els.ordersTbody.querySelector(`.prod-open-size-preview[data-prod-id="${id}"]`);
    const inkSel = els.ordersTbody.querySelector(`.prod-edit-ink-coverage[data-prod-id="${id}"]`);
    const toggleInk = () => {
      const plain = normalizePrintKind(sel.value) === 'plain';
      if (inkSel) {
        inkSel.disabled = plain;
        if (plain) inkSel.value = 'half';
      }
    };
    sel.addEventListener('change', toggleInk);
    toggleInk();
    if (!row || !span) return;
    const syncOpen = () => {
      const pt = normalizeProductionPrintType(sel.value) || 'printed';
      span.textContent = openSizeDisplay({ ...row, printType: pt });
    };
    sel.addEventListener('change', syncOpen);
    syncOpen();
  });

  els.ordersTbody.querySelectorAll('.prod-edit-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      editingRowId = Number(btn.getAttribute('data-prod-id'));
      renderOrdersTable();
    });
  });

  els.ordersTbody.querySelectorAll('.prod-cancel-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      editingRowId = null;
      renderOrdersTable();
    });
  });

  els.ordersTbody.querySelectorAll('.prod-update-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-prod-id');
      const row = ordersCache.find((it) => String(it.id) === String(id));
      if (!row) return;
      const q = (selector) => els.ordersTbody.querySelector(`${selector}[data-prod-id="${id}"]`);

      const orderDate = q('.prod-edit-order-date')?.value || row.orderDate;
      const poNumber = (q('.prod-edit-po-number')?.value || '').trim();
      const printType = normalizeProductionPrintType(q('.prod-edit-print-type')?.value || row.printType || 'printed') || 'printed';
      const inkCoverage = normalizeInkCoverage(q('.prod-edit-ink-coverage')?.value || row.inkCoverage, printType);
      const pouchType = q('.prod-edit-pouch-type')?.value || row.pouchType || '';
      const companyName = (q('.prod-edit-company')?.value || row.companyName || '').trim();
      const jobName = (q('.prod-edit-job')?.value || row.jobName || '').trim();
      const quantity = numberOrNull(q('.prod-edit-quantity')?.value);
      const quantityUnit = isProductionSingleSidePouch(pouchType)
        ? 'kg'
        : (q('.prod-edit-unit-lam')?.value || row.quantityUnit || 'nos');
      const rate = numberOrNull(q('.prod-edit-rate')?.value);
      const meter = numberOrNull(q('.prod-edit-meter')?.value);
      const kg = numberOrNull(q('.prod-edit-kg')?.value);
      const dispatchQuantity = q('.prod-dispatch-input')?.value === '' ? null : numberOrNull(q('.prod-dispatch-input')?.value);

      const calcIn = {
        pouchType,
        printType,
        inkCoverage,
        quantity,
        quantityUnit,
        widthMm: numberOrNull(row.widthMm),
        heightMm: isProductionSingleSidePouch(pouchType) ? 0 : numberOrNull(row.heightMm),
        cylinderUpMm: numberOrNull(row.cylinderUpMm),
      };
      const calcOut = calculateProduction(calcIn);
      const totalMeter = calcOut.totalMeter;

      if (
        !companyName || !jobName || !pouchType ||
        !Number.isFinite(quantity) || quantity <= 0 ||
        !Number.isFinite(rate) || rate < 0 ||
        !Number.isFinite(totalMeter) || totalMeter < 0 ||
        !Number.isFinite(meter) || meter < 0 ||
        !Number.isFinite(kg) || kg < 0
      ) {
        showToast('warn', 'Please enter valid values before updating.');
        return;
      }

      if (!isProductionSingleSidePouch(pouchType) && POUCH_TYPES[pouchType]) {
        const hm = numberOrNull(row.heightMm) ?? 0;
        if (hm <= 0) {
          showToast('warn', 'Laminate orders need height on file; re-create from New Order or fix data.');
          return;
        }
      }

      const mergedDims = {
        ...row,
        pouchType,
        printType,
        inkCoverage,
        heightMm: isProductionSingleSidePouch(pouchType) ? 0 : row.heightMm,
        cylinderUpMm: row.cylinderUpMm,
      };
      const openSizeM2 = computeOpenSizeM2(mergedDims);
      const printFactor = productionPrintFactor(printType);
      const widthMm = numberOrNull(row.widthMm) ?? 0;
      const heightMm = isProductionSingleSidePouch(pouchType) ? 0 : (numberOrNull(row.heightMm) ?? 0);
      const pouchSizeM2 = isProductionSingleSidePouch(pouchType)
        ? 0
        : ((heightMm * widthMm) / 1_000_000) * printFactor;

      const editable = {
        ...row,
        orderDate,
        poNumber,
        printType,
        inkCoverage,
        pouchType,
        companyName,
        jobName,
        quantity,
        quantityUnit,
        rate,
        openSizeM2,
        pouchSizeM2,
        heightMm,
        totalMeter,
        meter,
        kg,
        dispatchQuantity: Number(dispatchQuantity || 0),
      };
      const payload = { ...editable };
      const res = await updateProductionOrder(id, payload);
      if (!res?.ok) {
        showToast('warn', 'Could not update order.');
        return;
      }
      Object.assign(row, payload);
      editingRowId = null;
      renderOrdersTable();
      renderDetailTable();
      showToast('success', 'Order updated.');
    });
  });

  els.ordersTbody.querySelectorAll('.prod-add-dispatch-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-prod-id');
      const qtyInput = els.ordersTbody.querySelector(`.prod-add-dispatch-qty[data-prod-id="${id}"]`);
      const dateInput = els.ordersTbody.querySelector(`.prod-add-dispatch-date[data-prod-id="${id}"]`);
      const qty = numberOrNull(qtyInput?.value);
      const date = dateInput?.value || todayIsoDate();
      if (!Number.isFinite(qty) || qty <= 0) {
        showToast('warn', 'Enter valid dispatch quantity.');
        return;
      }
      const res = await updateProductionDispatch(id, qty, date);
      if (!res?.ok) {
        showToast('warn', 'Could not add dispatch entry.');
        return;
      }
      const row = ordersCache.find((o) => String(o.id) === String(id));
      if (row) {
        row.dispatchEntries = Array.isArray(res.dispatchEntries) ? res.dispatchEntries : dispatchEntries(row);
        row.dispatchQuantity = Number(res.dispatchQuantity || dispatchTotal(row));
      }
      if (row && shouldAutoCompleteOrder(row)) {
        const completedAt = new Date().toISOString();
        const patch = { ...row, orderStatus: 'completed', completedAt };
        const up = await updateProductionOrder(id, patch);
        if (up?.ok) Object.assign(row, patch);
      }
      if (qtyInput) qtyInput.value = '';
      renderOrdersTable();
      renderDetailTable();
      showToast('success', 'Dispatch added.');
    });
  });

  els.ordersTbody.querySelectorAll('.prod-complete-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-prod-id');
      const row = ordersCache.find((o) => String(o.id) === String(id));
      if (!row) return;
      const completedAt = new Date().toISOString();
      const patch = { ...row, orderStatus: 'completed', completedAt };
      const res = await updateProductionOrder(id, patch);
      if (!res?.ok) {
        showToast('warn', 'Could not complete order.');
        return;
      }
      Object.assign(row, patch);
      renderOrdersTable();
      renderDetailTable();
      showToast('success', 'Order marked completed.');
    });
  });

  els.ordersTbody.querySelectorAll('.prod-delete-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-prod-id');
      const row = ordersCache.find((o) => String(o.id) === String(id));
      const label = row?.orderId || id;
      if (!window.confirm(`Delete order ${label}? This cannot be undone.`)) return;
      const res = await deleteProductionOrder(id);
      if (!res?.ok) {
        showToast('warn', 'Could not delete order.');
        return;
      }
      if (editingRowId === Number(id)) editingRowId = null;
      ordersCache = ordersCache.filter((o) => String(o.id) !== String(id));
      renderCompanySuggestions();
      renderJobSuggestions(els.companyName?.value || '');
      renderOrdersTable();
      renderDetailTable();
      showToast('success', 'Order deleted.');
    });
  });
}

async function refreshOrders() {
  const all = await getProductionOrders();
  ordersCache = Array.isArray(all) ? all : [];
  try {
    companiesCache = await getCompanies();
  } catch {
    companiesCache = [];
  }
  for (const row of ordersCache) {
    if (shouldAutoCompleteOrder(row)) {
      const completedAt = new Date().toISOString();
      const patch = { ...row, orderStatus: 'completed', completedAt };
      const res = await updateProductionOrder(row.id, patch);
      if (res?.ok) Object.assign(row, patch);
    }
  }
  renderCompanySuggestions();
  renderOrderTableCompanyFilter();
  renderJobSuggestions(els.companyName?.value || '');
  renderOrdersTable();
  renderDetailTable();
}

async function resetFormKeepContext() {
  if (els.orderDate) els.orderDate.value = todayIsoDate();
  if (els.orderId) els.orderId.value = await getNextProductionOrderId();
  if (els.poNumber) els.poNumber.value = '';
  if (els.companyName) els.companyName.value = '';
  if (els.jobName) els.jobName.value = '';
  if (els.pouchType) els.pouchType.value = '';
  if (els.widthMm) els.widthMm.value = '';
  if (els.heightMm) els.heightMm.value = '';
  if (els.cylinderUpMm) els.cylinderUpMm.value = '';
  if (els.printType) els.printType.value = 'printed';
  if (els.inkCoverage) els.inkCoverage.value = 'half';
  if (els.rate) els.rate.value = '';
  if (els.quantity) els.quantity.value = '';
  if (els.quantityUnit) els.quantityUnit.value = 'nos';
  syncProductionPouchFormUI();
  hideFormError();
}

async function saveOrder() {
  const data = readForm();
  const err = validateForm(data);
  if (err) {
    showFormError(err);
    return;
  }
  hideFormError();

  const computed = calculateProduction(data);
  const payload = {
    ...data,
    ...computed,
    dispatchQuantity: 0,
    dispatchEntries: [],
    orderStatus: 'pending',
    completedAt: null,
  };
  const res = await addProductionOrder(payload);
  if (!res?.ok) {
    showToast('warn', 'Could not save production order.');
    return;
  }
  showToast('success', `Order saved (${res.orderId || payload.orderId}).`);
  await refreshOrders();
  await resetFormKeepContext();
}

function setupPageToggle() {
  const wrap = byId('production-page-toggle');
  if (!wrap) return;
  const newOrder = byId('production-page-new-order');
  const ordersTable = byId('production-page-orders-table');
  const detailView = byId('production-page-detail-view');
  wrap.querySelectorAll('button[data-page]').forEach((btn) => {
    btn.addEventListener('click', () => {
      wrap.querySelectorAll('button[data-page]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const page = btn.getAttribute('data-page');
      if (newOrder) newOrder.style.display = page === 'new-order' ? 'block' : 'none';
      if (ordersTable) ordersTable.style.display = page === 'orders-table' ? 'block' : 'none';
      if (detailView) detailView.style.display = page === 'detail-view' ? 'block' : 'none';
      if (page === 'orders-table') renderOrdersTable();
      if (page === 'detail-view') renderDetailTable();
    });
  });
}

function bindEvents() {
  els.companyName?.addEventListener('input', () => {
    renderJobSuggestions(els.companyName.value);
  });
  els.companyName?.addEventListener('change', () => {
    renderJobSuggestions(els.companyName.value);
    autofillFromLastOrder();
  });
  els.jobName?.addEventListener('change', autofillFromLastOrder);
  els.pouchType?.addEventListener('change', syncProductionPouchFormUI);
  els.printType?.addEventListener('change', syncInkCoverageUI);
  byId('btn-prod-save-order')?.addEventListener('click', saveOrder);
  byId('btn-prod-clear-form')?.addEventListener('click', () => {
    resetFormKeepContext();
  });

  els.prodTableSearch?.addEventListener('input', () => renderOrdersTable());
  els.prodTableStatus?.addEventListener('change', () => renderOrdersTable());
  els.prodTableCompany?.addEventListener('change', () => renderOrdersTable());
  els.prodTablePouchType?.addEventListener('change', () => renderOrdersTable());
  byId('btn-prod-table-clear-filters')?.addEventListener('click', () => {
    if (els.prodTableSearch) els.prodTableSearch.value = '';
    if (els.prodTableStatus) els.prodTableStatus.value = 'pending';
    if (els.prodTableCompany) els.prodTableCompany.value = '';
    if (els.prodTablePouchType) els.prodTablePouchType.value = '';
    renderOrdersTable();
  });
  byId('btn-prod-table-print')?.addEventListener('click', printOrdersTable);

  els.prodDetailStatus?.addEventListener('change', renderDetailTable);
  els.prodDetailCompany?.addEventListener('change', renderDetailTable);
  els.prodDetailPouchType?.addEventListener('change', renderDetailTable);
  byId('btn-prod-detail-clear-filters')?.addEventListener('click', () => {
    if (els.prodDetailStatus) els.prodDetailStatus.value = 'pending';
    if (els.prodDetailCompany) els.prodDetailCompany.value = '';
    if (els.prodDetailPouchType) els.prodDetailPouchType.value = '';
    renderDetailTable();
  });
  byId('btn-prod-detail-print')?.addEventListener('click', printDetailTable);
}

function cacheElements() {
  els.orderDate = byId('prod-order-date');
  els.orderId = byId('prod-order-id');
  els.poNumber = byId('prod-po-number');
  els.companyName = byId('prod-company-name');
  els.jobName = byId('prod-job-name');
  els.pouchType = byId('prod-pouch-type');
  els.widthMm = byId('prod-width-mm');
  els.heightMm = byId('prod-height-mm');
  els.cylinderUpMm = byId('prod-cylinder-up-mm');
  els.printType = byId('prod-print-type');
  els.inkCoverage = byId('prod-ink-coverage');
  els.inkCoverageWrap = byId('prod-ink-coverage-wrap');
  els.rate = byId('prod-rate');
  els.quantity = byId('prod-quantity');
  els.quantityUnit = byId('prod-quantity-unit');
  els.heightFieldGroup = byId('prod-height-field-group');
  els.quantityUnitWrap = byId('prod-quantity-unit-wrap');
  els.quantityKgOnlyWrap = byId('prod-quantity-kg-only-wrap');
  els.companyList = byId('prod-company-list');
  els.jobList = byId('prod-job-list');
  els.formError = byId('prod-form-error');
  els.formErrorMsg = byId('prod-form-error-msg');
  els.ordersTbody = byId('prod-orders-tbody');
  els.prodTableSearch = byId('prod-table-search');
  els.prodTableStatus = byId('prod-table-status');
  els.prodTableCompany = byId('prod-table-company');
  els.prodTablePouchType = byId('prod-table-pouch-type');
  els.prodDetailStatus = byId('prod-detail-status');
  els.prodDetailCompany = byId('prod-detail-company');
  els.prodDetailPouchType = byId('prod-detail-pouch-type');
  els.prodDetailTbody = byId('prod-detail-tbody');
}

export async function renderProductionOrders() {
  await refreshOrders();
}

export async function initProduction() {
  cacheElements();
  setupPageToggle();
  bindEvents();
  syncProductionPouchFormUI();
  if (els.orderDate && !els.orderDate.value) els.orderDate.value = todayIsoDate();
  if (els.orderId && !els.orderId.value) els.orderId.value = await getNextProductionOrderId();
  await refreshOrders();
}
