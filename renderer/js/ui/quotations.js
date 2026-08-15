/**
 * @file quotations.js
 * @description Create and store company quotations with current / last / quoted rates
 * and a snapshot of material rates.
 */

import {
  getCompanies,
  getProducts,
  getProductionOrders,
  getQuotations,
  getNextQuotationId,
  saveQuotation as dbSaveQuotation,
  updateQuotation as dbUpdateQuotation,
  deleteQuotation as dbDeleteQuotation,
  getRatesSync,
  getFlexRatesSync,
} from '../db.js';
import { MATERIALS, POUCH_TYPES, PRODUCTION_SINGLE_SIDE_POUCH_TYPES, FLEX_MATERIALS, DEFAULT_RATES, normalizePrintKind, normalizeInkCoverage, inkCoverageLabel } from '../data/materials.js';
import { calcPaperPouch, calcMaterial, labourForPaper } from '../lib/calculator.js';
import { fmt, fmtDateOnly } from '../lib/formatter.js';
import { showToast } from './toast.js';

const els = {};
let companiesCache = [];
let productsCache = [];
let quotationsCache = [];
let draftLines = [];
let viewingId = null;
let editingId = null;

function byId(id) {
  return document.getElementById(id);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function plusDaysIso(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function numberOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function isSingleWeb(pouchType) {
  return Boolean(PRODUCTION_SINGLE_SIDE_POUCH_TYPES[pouchType]);
}

function pouchTypeLabel(pouchTypeKey) {
  if (PRODUCTION_SINGLE_SIDE_POUCH_TYPES[pouchTypeKey]) {
    return PRODUCTION_SINGLE_SIDE_POUCH_TYPES[pouchTypeKey].label;
  }
  return POUCH_TYPES[pouchTypeKey]?.label ?? (pouchTypeKey || '—');
}

function printTypeLabel(printType) {
  const v = normalizePrintKind(printType);
  if (v === 'plain') return 'Plain';
  if (v === 'printed') return 'Printed';
  return '—';
}

function printAndFaceLabel(p) {
  const kind = normalizePrintKind(p?.printType);
  if (kind === 'plain') return 'Plain';
  if (kind === 'printed') return `Printed · ${inkCoverageLabel(p?.inkCoverage)}`;
  return '—';
}

function fmtWhole(n) {
  return Math.round(Number(n) || 0).toLocaleString('en-IN');
}

function sizeDisplay(p) {
  if (isSingleWeb(p.pouchType)) return `${fmtWhole(p.widthMm)} mm`;
  return `${fmtWhole(p.widthMm)}×${fmtWhole(p.heightMm)} mm`;
}

function moneyOrDash(n) {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? fmt(v, 2) : '—';
}

function roundNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function dim(p, ...keys) {
  for (const k of keys) {
    const n = Number(p?.[k]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

function normalizePrint(printType) {
  return normalizePrintKind(printType) || 'printed';
}

function matchKeys(p) {
  const job = String(p.jobName || '').trim().toLowerCase();
  const pouch = String(p.pouchType || '').trim();
  const width = roundNum(dim(p, 'widthMm', 'width'));
  const height = roundNum(dim(p, 'heightMm', 'height'));
  const cylinder = roundNum(dim(p, 'cylinderUpMm', 'cylinderUp'));
  const print = normalizePrint(p.printType);
  const ink = normalizeInkCoverage(p.inkCoverage, print);
  return [
    [job, pouch, width, height, cylinder, print, ink].join('|'),
    [job, pouch, width, height, print, ink].join('|'),
    [job, pouch, width, height].join('|'),
    [job, pouch, width].join('|'),
  ];
}

function moneyWithUnit(n, unit) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return '—';
  return `${fmt(v, 2)} <span style="color:var(--color-text-tertiary)">${escapeHtml(rateUnitLabel(unit))}</span>`;
}

function rateUnitLabel(unit) {
  return unit === 'kg' ? 'per kg' : 'per pouch';
}

function defaultRateUnit(pouchType) {
  return isSingleWeb(pouchType) ? 'kg' : 'nos';
}

function normalizeQtyUnit(unit, pouchType) {
  const v = String(unit || '').toLowerCase();
  if (v === 'kg') return 'kg';
  if (v === 'nos' || v === 'pouch' || v === 'pouches') return 'nos';
  return defaultRateUnit(pouchType);
}

function snapshotPaperRates(q) {
  return Object.assign({}, DEFAULT_RATES, q?.materialRatesSnapshot?.paperRates || {});
}

function profitPercentForQuotationLine(q, line, product) {
  const quoted = Number(line?.quotedRate);
  if (!(quoted > 0)) return null;
  if (Number.isFinite(Number(line.impliedProfitPercent))) return Number(line.impliedProfitPercent);
  if (Number(line.baseCost) > 0) {
    return impliedProfitPercent(quoted, line.baseCost, line.labourCost);
  }
  const p = { ...(product || {}), ...(line || {}) };
  const costs = estimatedCosts(p, snapshotPaperRates(q), line.inkCoverage || q?.costingAssumptions?.inkCoverage);
  const unit = line.rateUnit === 'kg' ? 'kg' : 'nos';
  const parts = pickCostParts(costs, unit);
  return impliedProfitPercent(quoted, parts.baseCost, parts.labourCost);
}

function lastQuotationRateForProduct(product, companyId, excludeQuotationId) {
  const list = quotationsCache
    .filter((q) => String(q.companyId) === String(companyId) && String(q.id) !== String(excludeQuotationId || ''))
    .slice()
    .sort((a, b) => String(a.quotationDate || a.createdAt || '').localeCompare(String(b.quotationDate || b.createdAt || '')));
  let found = { rate: 0, unit: '', profitPercent: null };
  for (const q of list) {
    for (const line of q.lines || []) {
      const sameId = line.productId != null && String(line.productId) === String(product.id);
      const sameCode = line.productCode && product.productCode && String(line.productCode) === String(product.productCode);
      const sameKey = matchKeys(line).some((k) => matchKeys(product).includes(k));
      const rate = Number(line.quotedRate);
      if ((sameId || sameCode || sameKey) && Number.isFinite(rate) && rate > 0) {
        found = {
          rate,
          unit: line.rateUnit === 'kg' ? 'kg' : (line.rateUnit === 'nos' ? 'nos' : ''),
          profitPercent: profitPercentForQuotationLine(q, line, product),
        };
      }
    }
  }
  return found;
}

function firstMatch(map, p) {
  for (const key of matchKeys(p)) {
    const v = map.get(key);
    if (v && Number.isFinite(Number(v.rate)) && Number(v.rate) > 0) return v;
  }
  return null;
}

function lastOrderRateMap(orders, company) {
  const map = new Map();
  const cid = String(company?.id ?? '');
  const cname = String(company?.name || '').trim().toLowerCase();
  const list = (orders || [])
    .filter((o) => {
      if (o.companyId != null && String(o.companyId) !== '') return String(o.companyId) === cid;
      return String(o.companyName || '').trim().toLowerCase() === cname;
    })
    .slice()
    .sort((a, b) => String(a.orderDate || '').localeCompare(String(b.orderDate || '')));
  for (const o of list) {
    const rate = Number(o.rate);
    if (!Number.isFinite(rate) || rate <= 0) continue;
    const rec = { rate, unit: normalizeQtyUnit(o.quantityUnit, o.pouchType) };
    for (const key of matchKeys(o)) map.set(key, rec);
  }
  return map;
}

function mergedPaperRates() {
  return Object.assign({}, DEFAULT_RATES, getRatesSync() || {});
}

function estimatedCosts(p, rates, inkCoverage) {
  const width = dim(p, 'widthMm', 'width');
  const heightLam = dim(p, 'heightMm', 'height');
  const height = heightLam || (isSingleWeb(p.pouchType) ? dim(p, 'cylinderUpMm', 'cylinderUp') : 0);
  const printType = normalizePrint(p.printType);
  const face = normalizeInkCoverage(inkCoverage ?? p.inkCoverage, printType);
  const empty = { perPouch: 0, perKg: 0, matPerPouch: 0, labourPerPouch: 0, matPerKg: 0, labourPerKg: 0 };

  if (POUCH_TYPES[p.pouchType]) {
    if (width <= 0 || height <= 0) return empty;
    try {
      const result = calcPaperPouch({
        pouchTypeKey: p.pouchType,
        height,
        width,
        inkCoverage: face,
        printType,
        quantity: 1,
        rates,
        profitPercent: 30,
      });
      const matPerPouch = Number(result.totalMatCostPerPouch) || 0;
      const labourPerPouch = Number(result.labourPerPouch) || 0;
      const perPouch = Number(result.finalPerPouch) || 0;
      const kgPerPouch = (Number(result.s1?.wastageKg) || 0)
        + (Number(result.s2?.wastageKg) || 0)
        + (Number(result.ink?.wastageKg) || 0);
      const perKg = kgPerPouch > 0 ? perPouch / kgPerPouch : 0;
      const matPerKg = kgPerPouch > 0 ? matPerPouch / kgPerPouch : 0;
      const labourPerKg = kgPerPouch > 0 ? labourPerPouch / kgPerPouch : 0;
      return { perPouch, perKg, matPerPouch, labourPerPouch, matPerKg, labourPerKg };
    } catch {
      return empty;
    }
  }

  const single = PRODUCTION_SINGLE_SIDE_POUCH_TYPES[p.pouchType];
  if (!single) return empty;
  const gsm = MATERIALS[single.gsmKey]?.gsm || 0;
  const ratePerKg = Number(rates[single.gsmKey]) || 0;
  if (gsm <= 0 || ratePerKg <= 0) return empty;
  const matPerKg = ratePerKg * 1.03;
  const labourPerKg = 0;
  const perKg = matPerKg * 1.3;
  let matPerPouch = 0;
  let labourPerPouch = 0;
  let perPouch = 0;
  if (width > 0 && height > 0) {
    const areaSqM = (height * width) / 1_000_000;
    const mat = calcMaterial(areaSqM, gsm, ratePerKg, 3);
    matPerPouch = mat.costPerPouch;
    labourPerPouch = labourForPaper(p.pouchType, height).labourPerPouch;
    perPouch = matPerPouch * 1.3 + labourPerPouch;
  }
  return { perPouch, perKg, matPerPouch, labourPerPouch, matPerKg, labourPerKg };
}

function pickCurrentRate(costs, unit) {
  const n = unit === 'kg' ? costs.perKg : costs.perPouch;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function pickCostParts(costs, unit) {
  if (unit === 'kg') {
    return { baseCost: costs.matPerKg || 0, labourCost: costs.labourPerKg || 0 };
  }
  return { baseCost: costs.matPerPouch || 0, labourCost: costs.labourPerPouch || 0 };
}

function impliedProfitPercent(quoted, baseCost, labourCost) {
  const sell = Number(quoted);
  const base = Number(baseCost);
  const labour = Number(labourCost) || 0;
  if (!(base > 0) || !Number.isFinite(sell) || sell <= 0) return null;
  return ((sell - labour) / base - 1) * 100;
}

function profitCellHtml(pct) {
  if (pct == null || !Number.isFinite(pct)) return '—';
  const color = pct >= 30 ? '#27500A' : pct >= 0 ? '#633806' : '#791F1F';
  const sign = pct > 0 ? '+' : '';
  return `<span style="font-family:var(--mono);color:${color}">${sign}${pct.toFixed(1)}%</span>`;
}

function moneyWithProfitHtml(rate, unit, profitPct) {
  const money = moneyWithUnit(rate, unit);
  if (money === '—' || profitPct == null || !Number.isFinite(Number(profitPct))) return money;
  return `${money}<div style="margin-top:2px">${profitCellHtml(Number(profitPct))}</div>`;
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

function quotationStatus(q) {
  const today = todayIso();
  if (q.validUntil && q.validUntil < today) return 'expired';
  return 'valid';
}

function fillCompanySelect() {
  if (!els.company) return;
  const prev = els.company.value;
  els.company.innerHTML = ['<option value="">Select company</option>']
    .concat(companiesCache.map((c) => `<option value="${c.id}">${escapeHtml(c.companyCode)} · ${escapeHtml(c.name)}</option>`))
    .join('');
  if (prev) els.company.value = prev;
}

async function refreshNextId() {
  if (els.quotationId) els.quotationId.value = await getNextQuotationId();
}

function setCreateOnlyLocked(locked) {
  if (els.company) els.company.disabled = locked;
  if (els.quotationDate) els.quotationDate.disabled = locked;
  if (els.validUntil) els.validUntil.disabled = locked;
  if (els.confirmBtn) els.confirmBtn.textContent = locked ? 'Save quoted rates' : 'Confirm quotation';
  if (els.editHint) {
    els.editHint.style.display = locked ? 'block' : 'none';
  }
}

function renderDraftTable() {
  if (!els.draftTbody) return;
  if (!draftLines.length) {
    els.draftTbody.innerHTML = `<tr><td colspan="9" style="color:var(--color-text-tertiary)">Select a company to load its products.</td></tr>`;
    return;
  }
  const editing = Boolean(editingId);
  els.draftTbody.innerHTML = draftLines.map((line, i) => {
    const unit = line.rateUnit || 'nos';
    const includeCell = editing
      ? '<td></td>'
      : `<td><input type="checkbox" class="qt-include" data-i="${i}" ${line.included ? 'checked' : ''}/></td>`;
    return `<tr>
      ${includeCell}
      <td style="font-family:var(--mono)">${escapeHtml(line.productCode || '—')}</td>
      <td>${escapeHtml(line.jobName || '—')}</td>
      <td>${escapeHtml(pouchTypeLabel(line.pouchType))}<div style="font-family:var(--mono);font-size:11px;color:var(--color-text-tertiary)">${escapeHtml(sizeDisplay(line))} · ${escapeHtml(printAndFaceLabel(line))}</div></td>
      <td style="font-family:var(--mono);font-size:12px">${moneyWithUnit(line.lastRate, unit)}</td>
      <td style="font-family:var(--mono);font-size:12px">${moneyWithProfitHtml(line.lastQuotationRate, line.lastQuotationRateUnit || unit, line.lastQuotationProfitPercent)}</td>
      <td style="font-family:var(--mono);font-size:12px">${moneyWithUnit(line.currentRate, unit)}</td>
      <td>
        <div style="display:flex;align-items:center;gap:8px">
          <input class="p-input qt-quoted" data-i="${i}" type="number" min="0" step="0.01" value="${Number(line.quotedRate) > 0 ? line.quotedRate : ''}" style="width:120px"/>
          <span style="font-size:12px;color:var(--color-text-tertiary);white-space:nowrap">${escapeHtml(rateUnitLabel(unit))}</span>
        </div>
      </td>
      <td class="qt-profit-cell" data-i="${i}">${profitCellHtml(impliedProfitPercent(line.quotedRate, line.baseCost, line.labourCost))}</td>
    </tr>`;
  }).join('');

  els.draftTbody.querySelectorAll('.qt-include').forEach((el) => {
    el.addEventListener('change', () => {
      const i = Number(el.getAttribute('data-i'));
      if (draftLines[i]) draftLines[i].included = el.checked;
    });
  });
  els.draftTbody.querySelectorAll('.qt-quoted').forEach((el) => {
    el.addEventListener('input', () => {
      const i = Number(el.getAttribute('data-i'));
      const line = draftLines[i];
      if (!line) return;
      line.quotedRate = numberOrNull(el.value) || 0;
      line.impliedProfitPercent = impliedProfitPercent(line.quotedRate, line.baseCost, line.labourCost);
      const cell = els.draftTbody.querySelector(`.qt-profit-cell[data-i="${i}"]`);
      if (cell) cell.innerHTML = profitCellHtml(line.impliedProfitPercent);
    });
  });
}

async function loadCompanyProducts() {
  if (editingId) return;
  hideFormError();
  const companyId = els.company?.value;
  if (!companyId) {
    draftLines = [];
    renderDraftTable();
    return;
  }
  const company = companiesCache.find((c) => String(c.id) === String(companyId));
  const [freshProducts, orders, quotations] = await Promise.all([
    getProducts(),
    getProductionOrders(),
    getQuotations(),
  ]);
  productsCache = Array.isArray(freshProducts) ? freshProducts : productsCache;
  quotationsCache = Array.isArray(quotations) ? quotations : quotationsCache;
  const orderLastMap = lastOrderRateMap(orders, company);
  const rates = mergedPaperRates();
  const products = productsCache.filter((p) => String(p.companyId) === String(companyId));
  draftLines = products.map((p) => {
    const last = firstMatch(orderLastMap, p);
    const lastQuote = lastQuotationRateForProduct(p, companyId, editingId);
    const rateUnit = last ? last.unit : defaultRateUnit(p.pouchType);
    const lastRate = last ? roundNum(last.rate) : 0;
    const lastQuotationRate = roundNum(lastQuote.rate);
    const lastQuotationRateUnit = lastQuote.unit || rateUnit;
    const lastQuotationProfitPercent = lastQuote.profitPercent;
    const costs = estimatedCosts(p, rates);
    const currentRate = roundNum(pickCurrentRate(costs, rateUnit));
    const parts = pickCostParts(costs, rateUnit);
    const quotedRate = roundNum(lastRate || lastQuotationRate || currentRate || 0);
    return {
      productId: p.id,
      productCode: p.productCode || '',
      jobName: p.jobName || '',
      pouchType: p.pouchType || '',
      widthMm: dim(p, 'widthMm', 'width'),
      heightMm: dim(p, 'heightMm', 'height'),
      cylinderUpMm: dim(p, 'cylinderUpMm', 'cylinderUp'),
      printType: normalizePrint(p.printType),
      inkCoverage: normalizeInkCoverage(p.inkCoverage, p.printType),
      rateUnit,
      lastRate,
      lastQuotationRate,
      lastQuotationRateUnit,
      lastQuotationProfitPercent,
      currentRate,
      quotedRate,
      baseCost: roundNum(parts.baseCost),
      labourCost: roundNum(parts.labourCost),
      impliedProfitPercent: impliedProfitPercent(quotedRate, parts.baseCost, parts.labourCost),
      included: true,
    };
  });
  renderDraftTable();
  if (!products.length) {
    showFormError('This company has no products yet. Add them on the Products page.');
  }
}

async function confirmQuotation() {
  hideFormError();
  const companyId = els.company?.value;
  if (!companyId) return showFormError('Select a company.');
  const quotationDate = els.quotationDate?.value || '';
  const validUntil = els.validUntil?.value || '';
  if (!quotationDate) return showFormError('Enter quotation date.');
  if (!validUntil) return showFormError('Enter valid until date.');
  if (validUntil < quotationDate) return showFormError('Valid until must be on or after the quotation date.');

  els.draftTbody?.querySelectorAll('.qt-quoted').forEach((el) => {
    const i = Number(el.getAttribute('data-i'));
    if (draftLines[i]) draftLines[i].quotedRate = numberOrNull(el.value) || 0;
  });
  if (editingId) {
    const lines = draftLines.filter((l) => l.included !== false);
    for (const line of lines) {
      if (!Number.isFinite(Number(line.quotedRate)) || Number(line.quotedRate) <= 0) {
        return showFormError(`Enter a quoted rate for ${line.jobName || line.productCode}.`);
      }
    }
    const res = await dbUpdateQuotation(editingId, { lines });
    if (!res?.ok) return showFormError(res?.error || 'Could not update quotation.');
    showToast('success', `Quoted rates saved (${res.quotationId}).`);
    await refresh();
    await resetDraft();
    showListPage();
    return;
  }
  els.draftTbody?.querySelectorAll('.qt-include').forEach((el) => {
    const i = Number(el.getAttribute('data-i'));
    if (draftLines[i]) draftLines[i].included = el.checked;
  });

  const included = draftLines.filter((l) => l.included);
  if (!included.length) return showFormError('Tick at least one product.');

  const company = companiesCache.find((c) => String(c.id) === String(companyId));
  const res = await dbSaveQuotation({
    quotationId: els.quotationId?.value || '',
    quotationDate,
    validUntil,
    companyId,
    companyName: company?.name || '',
    lines: included,
    materialRatesSnapshot: {
      paperRates: { ...getRatesSync() },
      flexRates: { ...getFlexRatesSync() },
    },
    costingAssumptions: {
      inkCoverage: 'half',
      profitPercent: 30,
      wastagePercent: 3,
    },
  });
  if (!res?.ok) return showFormError(res?.error || 'Could not save quotation.');
  showToast('success', `Quotation saved (${res.quotationId}).`);
  await refresh();
  await resetDraft();
  showListPage();
}

async function resetDraft() {
  editingId = null;
  setCreateOnlyLocked(false);
  if (els.company) els.company.value = '';
  if (els.quotationDate) els.quotationDate.value = todayIso();
  if (els.validUntil) els.validUntil.value = plusDaysIso(30);
  draftLines = [];
  hideFormError();
  await refreshNextId();
  renderDraftTable();
}

function startEditQuotation(id) {
  const q = quotationsCache.find((x) => String(x.id) === String(id));
  if (!q) {
    showToast('warn', 'Quotation not found.');
    return;
  }
  editingId = q.id;
  viewingId = null;
  renderQuotationDetail(null);
  fillCompanySelect();
  if (els.quotationId) els.quotationId.value = q.quotationId || '';
  if (els.company) els.company.value = String(q.companyId || '');
  if (els.quotationDate) els.quotationDate.value = String(q.quotationDate || '').slice(0, 10);
  if (els.validUntil) els.validUntil.value = String(q.validUntil || '').slice(0, 10);
  draftLines = (q.lines || []).map((line) => {
    const rateUnit = line.rateUnit === 'kg' ? 'kg' : 'nos';
    const product = productsCache.find((p) => String(p.id) === String(line.productId)) || line;
    const costs = estimatedCosts(product, snapshotPaperRates(q), line.inkCoverage || q.costingAssumptions?.inkCoverage);
    const parts = pickCostParts(costs, rateUnit);
    const baseCost = Number(line.baseCost) > 0 ? Number(line.baseCost) : roundNum(parts.baseCost);
    const labourCost = Number(line.baseCost) > 0 ? (Number(line.labourCost) || 0) : roundNum(parts.labourCost);
    const lastQuote = lastQuotationRateForProduct(line, q.companyId, q.id);
    return {
      ...line,
      included: true,
      rateUnit,
      baseCost,
      labourCost,
      lastQuotationProfitPercent: Number.isFinite(Number(line.lastQuotationProfitPercent))
        ? Number(line.lastQuotationProfitPercent)
        : lastQuote.profitPercent,
      impliedProfitPercent: impliedProfitPercent(line.quotedRate, baseCost, labourCost),
    };
  });
  setCreateOnlyLocked(true);
  if (els.editHint) {
    els.editHint.textContent = `Editing ${q.quotationId}. Quotation date is already set. You can only change quoted rates.`;
  }
  hideFormError();
  renderDraftTable();
  showNewPage();
}

function paperRateRows(snapshot) {
  const rates = snapshot?.paperRates || {};
  return Object.keys(MATERIALS).map((key) => {
    const label = MATERIALS[key].label;
    const val = rates[key];
    return `<tr><td>${escapeHtml(label)}</td><td style="font-family:var(--mono)">${Number.isFinite(Number(val)) ? fmt(Number(val), 2) : '—'}</td></tr>`;
  }).join('');
}

function flexRateRows(snapshot) {
  const rates = snapshot?.flexRates || {};
  const keys = Object.keys(rates);
  if (!keys.length) return `<tr><td colspan="2" style="color:var(--color-text-tertiary)">No flexible rates stored.</td></tr>`;
  return keys.map((key) => {
    const label = FLEX_MATERIALS[key]?.label || key;
    return `<tr><td>${escapeHtml(label)}</td><td style="font-family:var(--mono)">${fmt(Number(rates[key]) || 0, 2)}</td></tr>`;
  }).join('');
}

function renderQuotationDetail(q) {
  if (!els.detail) return;
  if (!q) {
    els.detail.style.display = 'none';
    els.detail.innerHTML = '';
    return;
  }
  const status = quotationStatus(q);
  const lines = (q.lines || []).map((line) => `<tr>
    <td style="font-family:var(--mono)">${escapeHtml(line.productCode || '—')}</td>
    <td>${escapeHtml(line.jobName || '—')}</td>
    <td>${escapeHtml(pouchTypeLabel(line.pouchType))}<div style="font-family:var(--mono);font-size:11px;color:var(--color-text-tertiary)">${escapeHtml(sizeDisplay(line))} · ${escapeHtml(printAndFaceLabel(line))}</div></td>
    <td style="font-family:var(--mono);font-size:12px">${moneyWithUnit(line.lastRate, line.rateUnit)}</td>
    <td style="font-family:var(--mono);font-size:12px">${moneyWithProfitHtml(
      line.lastQuotationRate,
      line.lastQuotationRateUnit || line.rateUnit,
      line.lastQuotationProfitPercent != null
        ? Number(line.lastQuotationProfitPercent)
        : lastQuotationRateForProduct(line, q.companyId, q.id).profitPercent
    )}</td>
    <td style="font-family:var(--mono);font-size:12px">${moneyWithUnit(line.currentRate, line.rateUnit)}</td>
    <td style="font-family:var(--mono)">${fmt(line.quotedRate || 0, 2)} <span style="color:var(--color-text-tertiary)">${escapeHtml(rateUnitLabel(line.rateUnit))}</span></td>
    <td>${profitCellHtml(profitPercentForQuotationLine(q, line, line))}</td>
  </tr>`).join('');
  const assumptions = q.costingAssumptions || {};
  els.detail.style.display = 'block';
  els.detail.innerHTML = `
    <div class="divider"></div>
    <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start">
      <div>
        <div class="section-label">Quotation ${escapeHtml(q.quotationId)}</div>
        <div style="margin-top:6px;font-size:14px">${escapeHtml(q.companyCode || '')} · ${escapeHtml(q.companyName || '')}</div>
        <div style="font-size:12px;color:var(--color-text-secondary);margin-top:6px">
          Date ${escapeHtml(fmtDateOnly(q.quotationDate))} · Valid until ${escapeHtml(fmtDateOnly(q.validUntil))}
          · <span class="p-badge ${status === 'valid' ? 'success' : 'warn'}">${status === 'valid' ? 'Valid' : 'Expired'}</span>
        </div>
        <div style="font-size:12px;color:var(--color-text-tertiary);margin-top:6px">
          ${q.companyContactName ? escapeHtml(q.companyContactName) + ' · ' : ''}${q.companyPhone ? escapeHtml(q.companyPhone) + ' · ' : ''}${q.companyEmail ? escapeHtml(q.companyEmail) : ''}
        </div>
        ${q.companyAddress ? `<div style="font-size:12px;color:var(--color-text-secondary);margin-top:4px;white-space:pre-wrap">${escapeHtml(q.companyAddress)}</div>` : ''}
      </div>
      <button type="button" class="p-btn p-btn-ghost" id="btn-qt-edit-detail" data-id="${q.id}">Edit quoted rates</button>
      <button type="button" class="p-btn p-btn-ghost" id="btn-qt-close-detail">Close</button>
    </div>
          <div class="rates-table-wrap" style="margin-top:12px">
            <table class="rates-table">
        <thead><tr><th>Code</th><th>Product</th><th>Type / size</th><th>Last rate</th><th>Last quotation rate</th><th>Current rate</th><th>Quoted rate</th><th>Profit %</th></tr></thead>
        <tbody>${lines}</tbody>
      </table>
    </div>
    <p style="margin:12px 0 6px;font-size:12px;color:var(--color-text-secondary)">
      Material rates stored with this quotation (print face ${escapeHtml(assumptions.inkCoverage || 'half')}, profit ${assumptions.profitPercent ?? 30}%, wastage ${assumptions.wastagePercent ?? 3}%).
    </p>
    <div class="grid2">
      <div class="rates-table-wrap">
        <table class="rates-table">
          <thead><tr><th>Paper / ink</th><th>₹/kg</th></tr></thead>
          <tbody>${paperRateRows(q.materialRatesSnapshot)}</tbody>
        </table>
      </div>
      <div class="rates-table-wrap">
        <table class="rates-table">
          <thead><tr><th>Flexible</th><th>₹/kg</th></tr></thead>
          <tbody>${flexRateRows(q.materialRatesSnapshot)}</tbody>
        </table>
      </div>
    </div>
  `;
  byId('btn-qt-edit-detail')?.addEventListener('click', () => startEditQuotation(q.id));
  byId('btn-qt-close-detail')?.addEventListener('click', () => {
    viewingId = null;
    renderQuotationDetail(null);
  });
}

function renderList() {
  if (!els.listTbody) return;
  const search = (els.listSearch?.value || '').trim().toLowerCase();
  let list = quotationsCache.slice();
  if (search) {
    list = list.filter((q) => {
      const hay = [q.quotationId, q.companyCode, q.companyName, q.quotationDate, q.validUntil].join(' ').toLowerCase();
      return hay.includes(search);
    });
  }
  if (els.listCount) els.listCount.textContent = `${list.length} quotation${list.length === 1 ? '' : 's'}`;
  if (!list.length) {
    els.listTbody.innerHTML = `<tr><td colspan="7" style="color:var(--color-text-tertiary)">No quotations yet.</td></tr>`;
    return;
  }
  els.listTbody.innerHTML = list.map((q) => {
    const status = quotationStatus(q);
    return `<tr>
      <td style="font-family:var(--mono)">${escapeHtml(q.quotationId)}</td>
      <td>${escapeHtml(q.companyCode ? `${q.companyCode} · ${q.companyName}` : (q.companyName || '—'))}</td>
      <td>${escapeHtml(fmtDateOnly(q.quotationDate))}</td>
      <td>${escapeHtml(fmtDateOnly(q.validUntil))}</td>
      <td><span class="p-badge ${status === 'valid' ? 'success' : 'warn'}">${status === 'valid' ? 'Valid' : 'Expired'}</span></td>
      <td>${(q.lines || []).length}</td>
      <td>
        <div style="display:flex;gap:6px">
          <button type="button" class="p-btn p-btn-ghost qt-edit" data-id="${q.id}">Edit</button>
          <button type="button" class="p-btn p-btn-ghost qt-view" data-id="${q.id}">View</button>
          <button type="button" class="p-btn p-btn-ghost qt-del" data-id="${q.id}">Delete</button>
        </div>
      </td>
    </tr>`;
  }).join('');

  els.listTbody.querySelectorAll('.qt-edit').forEach((btn) => {
    btn.addEventListener('click', () => startEditQuotation(btn.getAttribute('data-id')));
  });
  els.listTbody.querySelectorAll('.qt-view').forEach((btn) => {
    btn.addEventListener('click', () => {
      viewingId = btn.getAttribute('data-id');
      const q = quotationsCache.find((x) => String(x.id) === String(viewingId));
      renderQuotationDetail(q);
    });
  });
  els.listTbody.querySelectorAll('.qt-del').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      const q = quotationsCache.find((x) => String(x.id) === String(id));
      if (!window.confirm(`Delete quotation ${q?.quotationId || ''}?`)) return;
      const res = await dbDeleteQuotation(id);
      if (!res?.ok) {
        showToast('warn', 'Could not delete quotation.');
        return;
      }
      if (String(viewingId) === String(id)) {
        viewingId = null;
        renderQuotationDetail(null);
      }
      await refresh();
      showToast('success', 'Quotation deleted.');
    });
  });
}

function showNewPage() {
  if (els.pageNew) els.pageNew.style.display = 'block';
  if (els.pageList) els.pageList.style.display = 'none';
  els.toggle?.querySelectorAll('button[data-page]').forEach((b) => {
    b.classList.toggle('active', b.getAttribute('data-page') === 'new');
  });
}

function showListPage() {
  if (els.pageNew) els.pageNew.style.display = 'none';
  if (els.pageList) els.pageList.style.display = 'block';
  els.toggle?.querySelectorAll('button[data-page]').forEach((b) => {
    b.classList.toggle('active', b.getAttribute('data-page') === 'list');
  });
  renderList();
}

async function refresh() {
  const [companies, products, quotations] = await Promise.all([
    getCompanies(),
    getProducts(),
    getQuotations(),
  ]);
  companiesCache = companies;
  productsCache = products;
  quotationsCache = quotations;
  fillCompanySelect();
  renderList();
  if (viewingId) {
    const q = quotationsCache.find((x) => String(x.id) === String(viewingId));
    renderQuotationDetail(q || null);
  }
}

function cacheElements() {
  els.toggle = byId('quotation-page-toggle');
  els.pageNew = byId('quotation-page-new');
  els.pageList = byId('quotation-page-list');
  els.company = byId('qt-company');
  els.quotationId = byId('qt-id');
  els.quotationDate = byId('qt-date');
  els.validUntil = byId('qt-valid-until');
  els.draftTbody = byId('qt-draft-tbody');
  els.formError = byId('qt-form-error');
  els.formErrorMsg = byId('qt-form-error-msg');
  els.listSearch = byId('qt-list-search');
  els.listTbody = byId('qt-list-tbody');
  els.listCount = byId('qt-list-count');
  els.detail = byId('qt-detail');
  els.confirmBtn = byId('btn-qt-confirm');
  els.editHint = byId('qt-edit-hint');
}

function bindEvents() {
  els.toggle?.querySelectorAll('button[data-page]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.getAttribute('data-page') === 'new') {
        if (!editingId) showNewPage();
        else showNewPage();
      } else showListPage();
    });
  });
  els.company?.addEventListener('change', loadCompanyProducts);
  byId('btn-qt-confirm')?.addEventListener('click', confirmQuotation);
  byId('btn-qt-clear')?.addEventListener('click', resetDraft);
  els.listSearch?.addEventListener('input', renderList);
}

export async function renderQuotations() {
  await refresh();
}

export async function initQuotations() {
  cacheElements();
  bindEvents();
  if (els.quotationDate && !els.quotationDate.value) els.quotationDate.value = todayIso();
  if (els.validUntil && !els.validUntil.value) els.validUntil.value = plusDaysIso(30);
  await refresh();
  await refreshNextId();
  renderDraftTable();
}
