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
  getProducts,
  getQuotations,
  getRatesSync,
  printPreview,
} from '../db.js';
import { MATERIALS, POUCH_TYPES, PRODUCTION_SINGLE_SIDE_POUCH_TYPES, DEFAULT_RATES, normalizePrintKind, normalizeInkCoverage, inkCoverageLabel } from '../data/materials.js';
import { calcPaperPouch, calcMaterial, labourForPaper } from '../lib/calculator.js';
import { fmt, fmtDate, fmtDateOnly } from '../lib/formatter.js';
import { showToast } from './toast.js';

const els = {};
let ordersCache = [];
let companiesCache = [];
let productsCache = [];
let quotationsCache = [];
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
  const fromProducts = productsForCompanyName(companyName)
    .map((p) => (p.jobName || '').trim())
    .filter(Boolean);
  const fromOrders = (orders || [])
    .filter((o) => (o.companyName || '').trim().toLowerCase() === needle)
    .map((o) => (o.jobName || '').trim())
    .filter(Boolean);
  return [...new Set([...fromProducts, ...fromOrders])];
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

function companyByName(name) {
  const n = (name || '').trim().toLowerCase();
  if (!n) return null;
  return companiesCache.find((c) => (c.name || '').trim().toLowerCase() === n) || null;
}

function productsForCompanyName(companyName) {
  const company = companyByName(companyName);
  const n = (companyName || '').trim().toLowerCase();
  if (!n && !company) return [];
  return productsCache.filter((p) => {
    if (company && p.companyId != null && String(p.companyId) === String(company.id)) return true;
    return (p.companyName || '').trim().toLowerCase() === n;
  });
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

function pickProductForAutofill(companyName, jobName) {
  const j = (jobName || '').trim().toLowerCase();
  if (!j) return null;
  const matches = productsForCompanyName(companyName)
    .filter((p) => (p.jobName || '').trim().toLowerCase() === j);
  if (!matches.length) return null;
  if (matches.length === 1) return matches[0];

  const pouch = (els.pouchType?.value || '').trim();
  const width = numberOrNull(els.widthMm?.value);
  let pool = matches;
  if (pouch) {
    const byPouch = pool.filter((p) => String(p.pouchType || '') === pouch);
    if (byPouch.length) pool = byPouch;
  }
  if (Number.isFinite(width) && width > 0) {
    const byWidth = pool.filter((p) => Number(p.widthMm) === width);
    if (byWidth.length) pool = byWidth;
  }
  return pool.slice().sort((a, b) =>
    String(b.lastOrderDate || '').localeCompare(String(a.lastOrderDate || ''))
  )[0] || pool[0];
}

function applySpecToForm(spec) {
  if (!spec) return;
  if (els.pouchType) els.pouchType.value = spec.pouchType || '';
  if (els.widthMm) els.widthMm.value = spec.widthMm ?? '';
  if (els.heightMm) els.heightMm.value = isProductionSingleSidePouch(spec.pouchType) ? '' : (spec.heightMm ?? '');
  if (els.cylinderUpMm) els.cylinderUpMm.value = spec.cylinderUpMm ?? '';
  if (els.printType) els.printType.value = normalizeProductionPrintType(spec.printType) || 'printed';
  if (els.inkCoverage) els.inkCoverage.value = normalizeInkCoverage(spec.inkCoverage, spec.printType);
}

function roundRate(n) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
}

function dimMm(p, ...keys) {
  for (const k of keys) {
    const n = Number(p?.[k]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

function defaultQtyUnit(pouchType) {
  return isProductionSingleSidePouch(pouchType) ? 'kg' : 'nos';
}

function specMatchKeys(p) {
  const job = String(p?.jobName || '').trim().toLowerCase();
  const pouch = String(p?.pouchType || '').trim();
  const width = roundRate(dimMm(p, 'widthMm', 'width'));
  const height = roundRate(dimMm(p, 'heightMm', 'height'));
  const cylinder = roundRate(dimMm(p, 'cylinderUpMm', 'cylinderUp'));
  const print = normalizeProductionPrintType(p?.printType) || 'printed';
  const ink = normalizeInkCoverage(p?.inkCoverage, print);
  return [
    [job, pouch, width, height, cylinder, print, ink].join('|'),
    [job, pouch, width, height, print, ink].join('|'),
    [job, pouch, width, height].join('|'),
    [job, pouch, width].join('|'),
  ];
}

function lastQuotedForSpec(spec, company) {
  if (!spec || !company) return null;
  const cid = String(company.id);
  const specKeys = specMatchKeys(spec);
  const list = quotationsCache
    .filter((q) => String(q.companyId) === cid)
    .slice()
    .sort((a, b) => String(a.quotationDate || a.createdAt || '').localeCompare(String(b.quotationDate || b.createdAt || '')));
  let found = null;
  for (const q of list) {
    for (const line of q.lines || []) {
      const sameId = spec.id != null && line.productId != null && String(line.productId) === String(spec.id);
      const sameCode = spec.productCode && line.productCode && String(line.productCode) === String(spec.productCode);
      const sameKey = specMatchKeys(line).some((k) => specKeys.includes(k));
      const rate = Number(line.quotedRate);
      if ((sameId || sameCode || sameKey) && Number.isFinite(rate) && rate > 0) {
        const unit = String(line.rateUnit || '').toLowerCase() === 'kg' ? 'kg' : 'nos';
        found = { rate: roundRate(rate), unit };
      }
    }
  }
  return found;
}

function calculatedPaperRate(spec, unit) {
  const rates = Object.assign({}, DEFAULT_RATES, getRatesSync() || {});
  const width = dimMm(spec, 'widthMm', 'width');
  const heightLam = dimMm(spec, 'heightMm', 'height');
  const height = heightLam || (isProductionSingleSidePouch(spec.pouchType) ? dimMm(spec, 'cylinderUpMm', 'cylinderUp') : 0);
  const printType = normalizeProductionPrintType(spec.printType) || 'printed';
  const face = normalizeInkCoverage(spec.inkCoverage, printType);
  const wantKg = unit === 'kg';

  if (POUCH_TYPES[spec.pouchType]) {
    if (width <= 0 || height <= 0) return 0;
    try {
      const result = calcPaperPouch({
        pouchTypeKey: spec.pouchType,
        height,
        width,
        inkCoverage: face,
        printType,
        quantity: 1,
        rates,
        profitPercent: 30,
      });
      const perPouch = Number(result.finalPerPouch) || 0;
      if (!wantKg) return roundRate(perPouch);
      const kgPerPouch = (Number(result.s1?.wastageKg) || 0)
        + (Number(result.s2?.wastageKg) || 0)
        + (Number(result.ink?.wastageKg) || 0);
      return kgPerPouch > 0 ? roundRate(perPouch / kgPerPouch) : 0;
    } catch {
      return 0;
    }
  }

  const single = PRODUCTION_SINGLE_SIDE_POUCH_TYPES[spec.pouchType];
  if (!single) return 0;
  const gsm = MATERIALS[single.gsmKey]?.gsm || 0;
  const ratePerKg = Number(rates[single.gsmKey]) || 0;
  if (gsm <= 0 || ratePerKg <= 0) return 0;
  const perKg = ratePerKg * 1.03 * 1.3;
  if (wantKg) return roundRate(perKg);
  if (width > 0 && height > 0) {
    const areaSqM = (height * width) / 1_000_000;
    const mat = calcMaterial(areaSqM, gsm, ratePerKg, 3);
    const labour = labourForPaper(spec.pouchType, height).labourPerPouch;
    return roundRate(mat.costPerPouch * 1.3 + labour);
  }
  return 0;
}

function applyRateToForm(spec, company) {
  const quoted = lastQuotedForSpec(spec, company);
  const single = isProductionSingleSidePouch(spec.pouchType);
  const unit = single ? 'kg' : (quoted?.unit || defaultQtyUnit(spec.pouchType));
  const rate = quoted?.rate || calculatedPaperRate(spec, unit);
  if (els.quantityUnit) els.quantityUnit.value = unit;
  if (els.rate) els.rate.value = rate > 0 ? rate : '';
}

function autofillFromCatalog() {
  const companyName = els.companyName?.value;
  const jobName = els.jobName?.value;
  const company = companyByName(companyName);
  const product = pickProductForAutofill(companyName, jobName);
  const last = latestOrderByCompanyAndJob(companyName, jobName);
  const spec = product || last;
  if (!spec) return;
  applySpecToForm(spec);
  applyRateToForm(spec, company);
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
  updateOrderTicket();
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

function ticketDash(v) {
  const s = String(v ?? '').trim();
  return s || '—';
}

function updateOrderTicket() {
  const data = readForm();
  const single = isProductionSingleSidePouch(data.pouchType);
  const ready = !validateForm(data);

  if (els.ticketRoot) els.ticketRoot.classList.toggle('is-ready', ready);
  if (els.ticketStamp) els.ticketStamp.textContent = ready ? 'Ready' : 'Draft';
  if (els.ticketId) els.ticketId.textContent = ticketDash(data.orderId);
  if (els.ticketDate) els.ticketDate.textContent = ticketDash(data.orderDate);
  if (els.ticketPo) els.ticketPo.textContent = ticketDash(data.poNumber);
  if (els.ticketCompany) els.ticketCompany.textContent = ticketDash(data.companyName);
  if (els.ticketJob) els.ticketJob.textContent = ticketDash(data.jobName);
  if (els.ticketPouch) els.ticketPouch.textContent = data.pouchType ? pouchTypeLabel(data.pouchType) : '—';

  if (els.ticketSize) {
    const w = Number.isFinite(data.widthMm) ? fmtWhole(data.widthMm) : '';
    const h = Number.isFinite(data.heightMm) && data.heightMm > 0 ? fmtWhole(data.heightMm) : '';
    const c = Number.isFinite(data.cylinderUpMm) ? fmtWhole(data.cylinderUpMm) : '';
    let size = '—';
    if (w && (single || !h)) size = `${w} mm`;
    if (w && h && !single) size = `${w} × ${h} mm`;
    if (c && size !== '—') size += ` · cyl ${c}`;
    else if (c) size = `cyl ${c} mm`;
    els.ticketSize.textContent = size;
  }

  if (els.ticketPrint) {
    const print = printTypeLabel(data.printType);
    const face = normalizePrintKind(data.printType) === 'printed' ? inkCoverageLabel(data.inkCoverage) : '';
    els.ticketPrint.textContent = print === '-' ? '—' : (face ? `${print} · ${face}` : print);
  }

  if (els.ticketQty) {
    els.ticketQty.textContent = Number.isFinite(data.quantity)
      ? fmtUnitQty(data.quantity, data.quantityUnit)
      : '—';
  }
  if (els.ticketRate) {
    els.ticketRate.textContent = Number.isFinite(data.rate) ? fmt(data.rate) : '—';
  }
  if (els.ticketFoot) {
    els.ticketFoot.textContent = ready
      ? 'Job card is complete. Save to send it to production.'
      : 'Fill the form to complete this card.';
  }
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
  const [all, companies, products, quotations] = await Promise.all([
    getProductionOrders(),
    getCompanies().catch(() => []),
    getProducts().catch(() => []),
    getQuotations().catch(() => []),
  ]);
  ordersCache = Array.isArray(all) ? all : [];
  companiesCache = Array.isArray(companies) ? companies : [];
  productsCache = Array.isArray(products) ? products : [];
  quotationsCache = Array.isArray(quotations) ? quotations : [];
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
  updateOrderTicket();
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
    updateOrderTicket();
  });
  els.companyName?.addEventListener('change', () => {
    renderJobSuggestions(els.companyName.value);
    autofillFromCatalog();
  });
  els.jobName?.addEventListener('input', updateOrderTicket);
  els.jobName?.addEventListener('change', () => autofillFromCatalog());
  els.pouchType?.addEventListener('change', syncProductionPouchFormUI);
  els.printType?.addEventListener('change', () => {
    syncInkCoverageUI();
    updateOrderTicket();
  });
  [
    els.orderDate, els.poNumber, els.widthMm, els.heightMm, els.cylinderUpMm,
    els.inkCoverage, els.rate, els.quantity, els.quantityUnit,
  ].forEach((el) => {
    el?.addEventListener('input', updateOrderTicket);
    el?.addEventListener('change', updateOrderTicket);
  });
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
  els.ticketRoot = document.querySelector('.prod-ticket');
  els.ticketStamp = byId('prod-ticket-stamp');
  els.ticketId = byId('prod-ticket-id');
  els.ticketDate = byId('prod-ticket-date');
  els.ticketPo = byId('prod-ticket-po');
  els.ticketCompany = byId('prod-ticket-company');
  els.ticketJob = byId('prod-ticket-job');
  els.ticketPouch = byId('prod-ticket-pouch');
  els.ticketSize = byId('prod-ticket-size');
  els.ticketPrint = byId('prod-ticket-print');
  els.ticketQty = byId('prod-ticket-qty');
  els.ticketRate = byId('prod-ticket-rate');
  els.ticketFoot = byId('prod-ticket-foot');
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
  updateOrderTicket();
  await refreshOrders();
}
