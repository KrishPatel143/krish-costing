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
} from '../db.js';
import { MATERIALS, POUCH_TYPES, PRODUCTION_SINGLE_SIDE_POUCH_TYPES } from '../data/materials.js';
import { fmt, fmtDate } from '../lib/formatter.js';
import { showToast } from './toast.js';

const els = {};
let ordersCache = [];
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

function renderCompanySuggestions() {
  if (!els.companyList) return;
  const companies = buildUniqueCompanyList(ordersCache);
  els.companyList.innerHTML = companies.map((name) => `<option value="${name}"></option>`).join('');
}

function renderOrderTableCompanyFilter() {
  if (!els.prodTableCompany) return;
  const prev = els.prodTableCompany.value;
  const companies = buildUniqueCompanyList(ordersCache).sort((a, b) => a.localeCompare(b));
  const sel = els.prodTableCompany;
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
  if (els.printType) els.printType.value = normalizeProductionPrintType(last.printType) || 'one_side';
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
  const v = String(printType || '').toLowerCase();
  if (v === 'two_side') return 'two_side';
  if (v === 'printed') return 'one_side';
  if (v === 'one_side' || v === 'plain') return v;
  return '';
}

function productionPrintFactor(printType) {
  const t = normalizeProductionPrintType(printType) || 'one_side';
  return t === 'two_side' ? 2 : 1;
}

/** Same as calculateProduction: ((widthMm × cylinderUpMm) / 1000) × printFactor */
function computeOpenSizeM2(order) {
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

function calculateProduction(entry) {
  const widthMm = numberOrNull(entry.widthMm) ?? 0;
  const cylinderUpMm = numberOrNull(entry.cylinderUpMm) ?? 0;
  const qty = numberOrNull(entry.quantity) ?? 0;
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
  if (v === 'one_side') return 'Single Side';
  if (v === 'two_side') return 'Double Side';
  return '-';
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

/** NOS orders only: total dispatched pouches ≥ ordered quantity. */
function shouldAutoCompleteOrder(row) {
  if (normalizeOrderStatus(row) === 'completed') return false;
  const unit = String(row?.quantityUnit || 'nos').toLowerCase();
  if (unit !== 'nos') return false;
  const ordered = Number(row?.quantity) || 0;
  if (ordered <= 0) return false;
  return dispatchTotal(row) >= ordered;
}

function orderStatusLabel(row) {
  return normalizeOrderStatus(row) === 'completed' ? 'Completed' : 'Pending';
}

function dispatchTooltip(row) {
  const entries = dispatchEntries(row);
  if (!entries.length) return 'No dispatch yet';
  return entries
    .map((e) => `${e.date || '-'}: ${fmtWhole(e.quantity)} pouch`)
    .join('\n');
}

function openSizeDisplay(order) {
  const v = computeOpenSizeM2(order);
  return fmtWhole(v);
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
        ` : (o.orderDate || '-')}
      </td>
      <td style="font-family:var(--mono)">${o.orderId || '-'}</td>
      <td style="font-family:var(--mono)">
        ${editingRowId === o.id
          ? `<input class="p-input prod-edit-po-number" data-prod-id="${o.id}" type="text" value="${htmlAttr(o.poNumber || '')}" placeholder="Optional" style="width:120px"/>`
          : ((o.poNumber || '').trim() || '—')}
      </td>
      <td>
        ${editingRowId === o.id ? `
        <select class="p-select prod-edit-print-type" data-prod-id="${o.id}" style="min-width:120px">
          <option value="plain" ${normalizeProductionPrintType(o.printType) === 'plain' ? 'selected' : ''}>Plain</option>
          <option value="one_side" ${normalizeProductionPrintType(o.printType) === 'one_side' ? 'selected' : ''}>Single Side</option>
          <option value="two_side" ${normalizeProductionPrintType(o.printType) === 'two_side' ? 'selected' : ''}>Double Side</option>
        </select>
        ` : printTypeLabel(o.printType)}
      </td>
      <td>
        ${editingRowId === o.id
          ? `<input class="p-input prod-edit-company" data-prod-id="${o.id}" type="text" value="${o.companyName || ''}" style="width:180px"/>`
          : (o.companyName || '-')}
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
                <input class="p-input prod-add-dispatch-qty" data-prod-id="${o.id}" type="number" min="1" step="1" placeholder="Qty" style="width:90px"/>
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
    if (!row || !span) return;
    const syncOpen = () => {
      const pt = normalizeProductionPrintType(sel.value) || 'one_side';
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
      const printType = normalizeProductionPrintType(q('.prod-edit-print-type')?.value || row.printType || 'one_side');
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
        widthMm: row.widthMm,
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
      showToast('success', 'Order deleted.');
    });
  });
}

async function refreshOrders() {
  const all = await getProductionOrders();
  ordersCache = Array.isArray(all) ? all : [];
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
  if (els.printType) els.printType.value = 'one_side';
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
  wrap.querySelectorAll('button[data-page]').forEach((btn) => {
    btn.addEventListener('click', () => {
      wrap.querySelectorAll('button[data-page]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const page = btn.getAttribute('data-page');
      if (newOrder) newOrder.style.display = page === 'new-order' ? 'block' : 'none';
      if (ordersTable) ordersTable.style.display = page === 'orders-table' ? 'block' : 'none';
      if (page === 'orders-table') renderOrdersTable();
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
    if (els.prodTableStatus) els.prodTableStatus.value = 'all';
    if (els.prodTableCompany) els.prodTableCompany.value = '';
    if (els.prodTablePouchType) els.prodTablePouchType.value = '';
    renderOrdersTable();
  });
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
