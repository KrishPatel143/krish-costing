/**
 * @file products.js
 * @description Products catalog — unique jobs saved separately from production orders.
 */

import {
  getProducts,
  getCompanies,
  getRatesSync,
  saveProduct as dbSaveProduct,
  updateProduct as dbUpdateProduct,
  deleteProduct as dbDeleteProduct,
  importProductsFromProduction,
} from '../db.js';
import { MATERIALS, POUCH_TYPES, PRODUCTION_SINGLE_SIDE_POUCH_TYPES, normalizePrintKind, normalizeInkCoverage, inkCoverageLabel } from '../data/materials.js';
import { calcPaperPouch, calcMaterial, labourForPaper } from '../lib/calculator.js';
import { fmt, fmtDateOnly } from '../lib/formatter.js';
import { showToast } from './toast.js';

const els = {};
let productsCache = [];
let companiesCache = [];
let editingId = null;

function byId(id) {
  return document.getElementById(id);
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

function estimatedCost(p) {
  const key = p.pouchType;
  const rates = getRatesSync();
  const printType = normalizePrintKind(p.printType) || 'printed';
  const inkCoverage = normalizeInkCoverage(p.inkCoverage, p.printType);
  const width = Number(p.widthMm) || 0;
  const height = Number(p.heightMm) || (isSingleWeb(key) ? Number(p.cylinderUpMm) || 0 : 0);

  if (POUCH_TYPES[key]) {
    if (height <= 0 || width <= 0) return null;
    try {
      const result = calcPaperPouch({
        pouchTypeKey: key,
        height,
        width,
        inkCoverage,
        printType,
        quantity: 1,
        rates,
        profitPercent: 30,
      });
      const n = Number(result.finalPerPouch);
      return Number.isFinite(n) && n > 0 ? { amount: n, unit: 'per pouch' } : null;
    } catch {
      return null;
    }
  }

  const single = PRODUCTION_SINGLE_SIDE_POUCH_TYPES[key];
  if (!single) return null;
  const gsm = MATERIALS[single.gsmKey]?.gsm || 0;
  const ratePerKg = Number(rates[single.gsmKey]) || 0;
  if (gsm <= 0 || ratePerKg <= 0) return null;
  const perKg = ratePerKg * 1.03 * 1.3;
  if (Number.isFinite(perKg) && perKg > 0) return { amount: perKg, unit: 'per kg' };
  if (width > 0 && height > 0) {
    const areaSqM = (height * width) / 1_000_000;
    const mat = calcMaterial(areaSqM, gsm, ratePerKg, 3);
    const labour = labourForPaper(key, height).labourPerPouch;
    const perPouch = mat.costPerPouch * 1.3 + labour;
    return Number.isFinite(perPouch) && perPouch > 0 ? { amount: perPouch, unit: 'per pouch' } : null;
  }
  return null;
}

function pouchTypeSelectHtml(selectedKey) {
  const singleOpts = Object.entries(PRODUCTION_SINGLE_SIDE_POUCH_TYPES)
    .map(([k, v]) => `<option value="${k}" ${k === selectedKey ? 'selected' : ''}>${v.label}</option>`)
    .join('');
  const lamOpts = Object.entries(POUCH_TYPES)
    .map(([k, v]) => `<option value="${k}" ${k === selectedKey ? 'selected' : ''}>${v.label}</option>`)
    .join('');
  return `<option value="">Select type</option><optgroup label="Single web">${singleOpts}</optgroup><optgroup label="Laminate pouch">${lamOpts}</optgroup>`;
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

function syncHeightField() {
  const single = isSingleWeb(els.pouchType?.value);
  if (els.heightFieldGroup) els.heightFieldGroup.style.display = single ? 'none' : '';
  if (els.heightMm && single) {
    els.heightMm.value = '';
    els.heightMm.required = false;
  } else if (els.heightMm) {
    els.heightMm.required = true;
  }
}

function syncInkCoverageUI() {
  const plain = normalizePrintKind(els.printType?.value) === 'plain';
  if (els.inkCoverage) els.inkCoverage.disabled = plain;
  if (els.inkCoverageWrap) els.inkCoverageWrap.style.opacity = plain ? '0.55' : '';
  if (plain && els.inkCoverage) els.inkCoverage.value = 'half';
}

function readForm() {
  const pouchType = els.pouchType?.value || '';
  const single = isSingleWeb(pouchType);
  const company = companiesCache.find((c) => String(c.id) === String(els.companyId?.value));
  return {
    companyId: els.companyId?.value || '',
    companyName: company?.name || '',
    jobName: (els.jobName?.value || '').trim(),
    pouchType,
    widthMm: numberOrNull(els.widthMm?.value),
    heightMm: single ? 0 : numberOrNull(els.heightMm?.value),
    cylinderUpMm: numberOrNull(els.cylinderUpMm?.value),
    printType: els.printType?.value || '',
    inkCoverage: normalizeInkCoverage(els.inkCoverage?.value, els.printType?.value),
  };
}

function validateForm(data) {
  if (!data.companyId || !data.companyName) return 'Please select a company.';
  if (!data.jobName) return 'Please enter product / job name.';
  if (!data.pouchType) return 'Please select pouch type.';
  if (!data.printType) return 'Please select print type.';
  if (!Number.isFinite(data.widthMm) || data.widthMm <= 0) return 'Please enter valid width.';
  if (!Number.isFinite(data.cylinderUpMm) || data.cylinderUpMm <= 0) return 'Please enter valid cylinder up.';
  if (!isSingleWeb(data.pouchType) && (!Number.isFinite(data.heightMm) || data.heightMm <= 0)) {
    return 'Please enter valid height.';
  }
  return null;
}

function fillForm(p) {
  if (els.companyId) els.companyId.value = p.companyId || '';
  if (els.jobName) els.jobName.value = p.jobName || '';
  if (els.pouchType) els.pouchType.value = p.pouchType || '';
  if (els.widthMm) els.widthMm.value = p.widthMm ?? '';
  if (els.heightMm) els.heightMm.value = isSingleWeb(p.pouchType) ? '' : (p.heightMm ?? '');
  if (els.cylinderUpMm) els.cylinderUpMm.value = p.cylinderUpMm ?? '';
  if (els.printType) els.printType.value = normalizePrintKind(p.printType) || 'printed';
  if (els.inkCoverage) els.inkCoverage.value = normalizeInkCoverage(p.inkCoverage, p.printType);
  syncHeightField();
  syncInkCoverageUI();
}

function clearForm() {
  editingId = null;
  if (els.companyId) els.companyId.value = '';
  if (els.jobName) els.jobName.value = '';
  if (els.pouchType) els.pouchType.value = '';
  if (els.widthMm) els.widthMm.value = '';
  if (els.heightMm) els.heightMm.value = '';
  if (els.cylinderUpMm) els.cylinderUpMm.value = '';
  if (els.printType) els.printType.value = 'printed';
  if (els.inkCoverage) els.inkCoverage.value = 'half';
  if (els.saveBtn) els.saveBtn.textContent = 'Save product';
  hideFormError();
  syncHeightField();
  syncInkCoverageUI();
}

function uniqueCompanies(list) {
  const map = new Map();
  for (const p of list) {
    const id = p.companyId || p.companyName;
    if (!id || map.has(String(id))) continue;
    map.set(String(id), { id: p.companyId || p.companyName, name: p.companyName, code: p.companyCode });
  }
  return [...map.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

function renderCompanySelect() {
  if (!els.companyId) return;
  const prev = els.companyId.value;
  const opts = ['<option value="">Select company</option>'].concat(
    companiesCache.map((c) => `<option value="${c.id}">${escapeHtml(c.companyCode)} · ${escapeHtml(c.name)}</option>`)
  );
  els.companyId.innerHTML = opts.join('');
  if (prev) els.companyId.value = prev;
}

function renderCompanyFilter() {
  if (!els.filterCompany) return;
  const prev = els.filterCompany.value;
  const names = uniqueCompanies(productsCache);
  els.filterCompany.textContent = '';
  const all = document.createElement('option');
  all.value = '';
  all.textContent = 'All companies';
  els.filterCompany.appendChild(all);
  for (const c of names) {
    const opt = document.createElement('option');
    opt.value = String(c.id);
    opt.textContent = c.code ? `${c.code} · ${c.name}` : c.name;
    els.filterCompany.appendChild(opt);
  }
  if (prev) els.filterCompany.value = prev;
}

function filteredProducts() {
  let list = productsCache.slice();
  const search = (els.search?.value || '').trim().toLowerCase();
  const company = (els.filterCompany?.value || '').trim();
  const pouch = (els.filterPouch?.value || '').trim();
  if (search) {
    list = list.filter((p) => {
      const hay = [
        p.productCode,
        p.companyCode,
        p.companyName,
        p.jobName,
        pouchTypeLabel(p.pouchType),
        printTypeLabel(p.printType),
        inkCoverageLabel(p.inkCoverage),
        sizeDisplay(p),
      ].join(' ').toLowerCase();
      return hay.includes(search);
    });
  }
  if (company) {
    list = list.filter((p) => String(p.companyId || p.companyName) === company);
  }
  if (pouch) {
    list = list.filter((p) => String(p.pouchType || '') === pouch);
  }
  return list;
}

function renderTable() {
  if (!els.tbody) return;
  const list = filteredProducts();
  if (els.count) els.count.textContent = `${list.length} product${list.length === 1 ? '' : 's'}`;
  if (!list.length) {
    els.tbody.innerHTML = `<tr><td colspan="10" style="color:var(--color-text-tertiary)">No products yet. Import from production or add one above.</td></tr>`;
    return;
  }
  els.tbody.innerHTML = list.map((p) => {
    const cost = estimatedCost(p);
    const costCell = cost == null
      ? '—'
      : `${fmt(cost.amount, cost.unit === 'per kg' ? 2 : 4)} <span style="color:var(--color-text-tertiary)">${cost.unit}</span>`;
    const lastOrder = p.lastOrderDate ? fmtDateOnly(p.lastOrderDate) : '—';
    return `<tr>
      <td style="font-family:var(--mono)">${escapeHtml(p.productCode || '—')}</td>
      <td>${escapeHtml(p.companyCode ? `${p.companyCode} · ${p.companyName}` : (p.companyName || '—'))}</td>
      <td>${escapeHtml(p.jobName || '—')}</td>
      <td>${escapeHtml(pouchTypeLabel(p.pouchType))}</td>
      <td style="font-family:var(--mono)">${escapeHtml(sizeDisplay(p))}</td>
      <td style="font-family:var(--mono)">${fmtWhole(p.cylinderUpMm)}</td>
      <td>${escapeHtml(printAndFaceLabel(p))}</td>
      <td style="font-family:var(--mono)">${costCell}</td>
      <td>${escapeHtml(lastOrder)}${p.orderCount ? ` · ${p.orderCount}` : ''}</td>
      <td>
        <div style="display:flex;gap:6px">
          <button type="button" class="p-btn p-btn-ghost prod-edit-btn" data-product-id="${p.id}">Edit</button>
          <button type="button" class="p-btn p-btn-ghost prod-del-btn" data-product-id="${p.id}">Delete</button>
        </div>
      </td>
    </tr>`;
  }).join('');

  els.tbody.querySelectorAll('.prod-edit-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-product-id');
      const p = productsCache.find((x) => String(x.id) === String(id));
      if (!p) return;
      editingId = p.id;
      fillForm(p);
      if (els.saveBtn) els.saveBtn.textContent = 'Update product';
      els.companyId?.focus();
    });
  });
  els.tbody.querySelectorAll('.prod-del-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-product-id');
      const p = productsCache.find((x) => String(x.id) === String(id));
      const label = p ? `${p.jobName} (${p.companyName})` : 'this product';
      if (!window.confirm(`Delete ${label}? Orders are not deleted.`)) return;
      const res = await dbDeleteProduct(id);
      if (!res?.ok) {
        showToast('warn', 'Could not delete product.');
        return;
      }
      if (String(editingId) === String(id)) clearForm();
      await refresh();
      showToast('success', 'Product deleted.');
    });
  });
}

async function refresh() {
  const [products, companies] = await Promise.all([getProducts(), getCompanies()]);
  productsCache = products;
  companiesCache = companies;
  renderCompanySelect();
  renderCompanyFilter();
  renderTable();
}

async function handleSave() {
  hideFormError();
  const data = readForm();
  const err = validateForm(data);
  if (err) return showFormError(err);
  const res = editingId
    ? await dbUpdateProduct(editingId, data)
    : await dbSaveProduct(data);
  if (!res?.ok) {
    return showFormError(res?.error || 'Could not save product.');
  }
  showToast('success', editingId ? 'Product updated.' : 'Product saved.');
  clearForm();
  await refresh();
}

async function handleImport() {
  const res = await importProductsFromProduction();
  if (!res?.ok) {
    showToast('warn', 'Could not import from production.');
    return;
  }
  await refresh();
  showToast('success', `Products catalog updated (${res.count} saved).`);
}

function cacheElements() {
  els.companyId = byId('product-company-id');
  els.jobName = byId('product-job-name');
  els.pouchType = byId('product-pouch-type');
  els.widthMm = byId('product-width-mm');
  els.heightMm = byId('product-height-mm');
  els.heightFieldGroup = byId('product-height-field-group');
  els.cylinderUpMm = byId('product-cylinder-up-mm');
  els.printType = byId('product-print-type');
  els.inkCoverage = byId('product-ink-coverage');
  els.inkCoverageWrap = byId('product-ink-coverage-wrap');
  els.saveBtn = byId('btn-product-save');
  els.formError = byId('product-form-error');
  els.formErrorMsg = byId('product-form-error-msg');
  els.search = byId('product-search');
  els.filterCompany = byId('product-filter-company');
  els.filterPouch = byId('product-filter-pouch');
  els.tbody = byId('product-tbody');
  els.count = byId('product-count');
}

function bindEvents() {
  els.pouchType?.addEventListener('change', syncHeightField);
  els.printType?.addEventListener('change', syncInkCoverageUI);
  els.saveBtn?.addEventListener('click', handleSave);
  byId('btn-product-clear')?.addEventListener('click', clearForm);
  byId('btn-product-import')?.addEventListener('click', handleImport);
  els.search?.addEventListener('input', renderTable);
  els.filterCompany?.addEventListener('change', renderTable);
  els.filterPouch?.addEventListener('change', renderTable);
  byId('btn-product-clear-filters')?.addEventListener('click', () => {
    if (els.search) els.search.value = '';
    if (els.filterCompany) els.filterCompany.value = '';
    if (els.filterPouch) els.filterPouch.value = '';
    renderTable();
  });
}

export async function renderProducts() {
  await refresh();
}

export async function initProducts() {
  cacheElements();
  if (els.pouchType) els.pouchType.innerHTML = pouchTypeSelectHtml('');
  bindEvents();
  syncHeightField();
  syncInkCoverageUI();
  await refresh();
}
