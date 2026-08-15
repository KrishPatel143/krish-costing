/**
 * @file companies.js
 * @description Company master: code, optional GST / contacts, multiple emails phones addresses.
 */

import {
  getCompanies,
  saveCompany as dbSaveCompany,
  updateCompany as dbUpdateCompany,
  deleteCompany as dbDeleteCompany,
} from '../db.js';
import { showToast } from './toast.js';

const els = {};
let companiesCache = [];
let editingId = null;

function byId(id) {
  return document.getElementById(id);
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

function defaultOf(list) {
  const rows = Array.isArray(list) ? list.filter((r) => String(r?.value || '').trim()) : [];
  return rows.find((r) => r.isDefault) || rows[0] || null;
}

function readList(kind) {
  const wrap = byId(`company-${kind}`);
  if (!wrap) return [];
  const rows = [...wrap.querySelectorAll('[data-multi-row]')];
  return rows.map((row, i) => {
    const input = row.querySelector('[data-multi-value]');
    const def = row.querySelector('[data-multi-default]');
    return {
      value: (input?.value || '').trim(),
      isDefault: Boolean(def?.checked),
    };
  }).filter((r) => r.value);
}

function addListRow(kind, value = '', isDefault = false, isTextarea = false) {
  const wrap = byId(`company-${kind}`);
  if (!wrap) return;
  const row = document.createElement('div');
  row.className = 'multi-row';
  row.setAttribute('data-multi-row', '');
  const field = isTextarea
    ? `<textarea class="p-input" data-multi-value rows="2" style="width:100%;min-width:220px;resize:vertical">${escapeHtml(value)}</textarea>`
    : `<input class="p-input" data-multi-value type="${kind === 'emails' ? 'email' : 'text'}" value="${escapeHtml(value)}" style="width:100%;min-width:180px"/>`;
  row.innerHTML = `
    ${field}
    <label class="p-radio" style="white-space:nowrap">
      <input type="radio" name="company-default-${kind}" data-multi-default ${isDefault ? 'checked' : ''}/>
      Default
    </label>
    <button type="button" class="p-btn p-btn-ghost multi-remove">Remove</button>
  `;
  row.querySelector('.multi-remove').addEventListener('click', () => {
    row.remove();
    const left = wrap.querySelectorAll('[data-multi-row]');
    if (!left.length) addListRow(kind, '', true, isTextarea);
    else if (![...left].some((r) => r.querySelector('[data-multi-default]')?.checked)) {
      left[0].querySelector('[data-multi-default]').checked = true;
    }
    renderCardFromForm();
  });
  row.querySelector('[data-multi-value]')?.addEventListener('input', renderCardFromForm);
  row.querySelector('[data-multi-default]')?.addEventListener('change', renderCardFromForm);
  wrap.appendChild(row);
}

function fillList(kind, items, isTextarea = false) {
  const wrap = byId(`company-${kind}`);
  if (!wrap) return;
  wrap.innerHTML = '';
  const rows = Array.isArray(items) && items.length ? items : [{ value: '', isDefault: true }];
  rows.forEach((item, i) => addListRow(kind, item.value || '', Boolean(item.isDefault) || i === 0, isTextarea));
}

function readForm() {
  return {
    name: (els.name?.value || '').trim(),
    gst: (els.gst?.value || '').trim(),
    contactName: (els.contactName?.value || '').trim(),
    emails: readList('emails'),
    phones: readList('phones'),
    addresses: readList('addresses'),
  };
}

function fillForm(c) {
  if (els.name) els.name.value = c.name || '';
  if (els.gst) els.gst.value = c.gst || '';
  if (els.contactName) els.contactName.value = c.contactName || '';
  if (els.code) els.code.textContent = c.companyCode || 'New';
  fillList('emails', c.emails);
  fillList('phones', c.phones);
  fillList('addresses', c.addresses, true);
  renderCard(c);
}

function clearForm() {
  editingId = null;
  if (els.name) els.name.value = '';
  if (els.gst) els.gst.value = '';
  if (els.contactName) els.contactName.value = '';
  if (els.code) els.code.textContent = 'New';
  if (els.saveBtn) els.saveBtn.textContent = 'Save company';
  fillList('emails', []);
  fillList('phones', []);
  fillList('addresses', [], true);
  hideFormError();
  renderCardFromForm();
}

function renderCard(c) {
  if (!els.card) return;
  const email = defaultOf(c.emails)?.value;
  const phone = defaultOf(c.phones)?.value;
  const address = defaultOf(c.addresses)?.value;
  const extraEmails = (c.emails || []).filter((e) => e.value && e.value !== email).map((e) => e.value);
  const extraPhones = (c.phones || []).filter((e) => e.value && e.value !== phone).map((e) => e.value);
  els.card.innerHTML = `
    <div class="company-card-code">${escapeHtml(c.companyCode || 'New company')}</div>
    <div class="company-card-name">${escapeHtml(c.name || 'Company name')}</div>
    ${c.contactName ? `<div class="company-card-line">${escapeHtml(c.contactName)}</div>` : '<div class="company-card-muted">No contact person</div>'}
    ${c.gst ? `<div class="company-card-line">GST ${escapeHtml(c.gst)}</div>` : '<div class="company-card-muted">No GST</div>'}
    <div class="company-card-block">
      <div class="company-card-k">Address</div>
      <div>${address ? escapeHtml(address).replace(/\n/g, '<br/>') : '<span class="company-card-muted">Not set</span>'}</div>
    </div>
    <div class="company-card-block">
      <div class="company-card-k">Phone</div>
      <div>${phone ? escapeHtml(phone) : '<span class="company-card-muted">Not set</span>'}</div>
      ${extraPhones.length ? `<div class="company-card-muted">${extraPhones.map(escapeHtml).join(' · ')}</div>` : ''}
    </div>
    <div class="company-card-block">
      <div class="company-card-k">Email</div>
      <div>${email ? escapeHtml(email) : '<span class="company-card-muted">Not set</span>'}</div>
      ${extraEmails.length ? `<div class="company-card-muted">${extraEmails.map(escapeHtml).join(' · ')}</div>` : ''}
    </div>
  `;
}

function renderCardFromForm() {
  const data = readForm();
  renderCard({
    ...data,
    companyCode: editingId
      ? (companiesCache.find((c) => String(c.id) === String(editingId))?.companyCode || '—')
      : 'New',
  });
}

function filteredCompanies() {
  const search = (els.search?.value || '').trim().toLowerCase();
  if (!search) return companiesCache.slice();
  return companiesCache.filter((c) => {
    const hay = [
      c.companyCode,
      c.name,
      c.gst,
      c.contactName,
      ...(c.emails || []).map((e) => e.value),
      ...(c.phones || []).map((e) => e.value),
      ...(c.addresses || []).map((e) => e.value),
    ].join(' ').toLowerCase();
    return hay.includes(search);
  });
}

function renderTable() {
  if (!els.tbody) return;
  const list = filteredCompanies();
  if (els.count) els.count.textContent = `${list.length} compan${list.length === 1 ? 'y' : 'ies'}`;
  if (!list.length) {
    els.tbody.innerHTML = `<tr><td colspan="7" style="color:var(--color-text-tertiary)">No companies yet. Add a name, or save a production order.</td></tr>`;
    return;
  }
  els.tbody.innerHTML = list.map((c) => {
    const email = defaultOf(c.emails)?.value || '—';
    const phone = defaultOf(c.phones)?.value || '—';
    return `<tr>
      <td style="font-family:var(--mono)">${escapeHtml(c.companyCode || '—')}</td>
      <td>${escapeHtml(c.name || '—')}</td>
      <td>${escapeHtml(c.contactName || '—')}</td>
      <td>${escapeHtml(c.gst || '—')}</td>
      <td>${escapeHtml(phone)}</td>
      <td>${escapeHtml(email)}</td>
      <td>
        <div style="display:flex;gap:6px">
          <button type="button" class="p-btn p-btn-ghost co-edit" data-id="${c.id}">Edit</button>
          <button type="button" class="p-btn p-btn-ghost co-del" data-id="${c.id}">Delete</button>
        </div>
      </td>
    </tr>`;
  }).join('');

  els.tbody.querySelectorAll('.co-edit').forEach((btn) => {
    btn.addEventListener('click', () => {
      const c = companiesCache.find((x) => String(x.id) === String(btn.getAttribute('data-id')));
      if (!c) return;
      editingId = c.id;
      fillForm(c);
      if (els.saveBtn) els.saveBtn.textContent = 'Update company';
      els.name?.focus();
    });
  });
  els.tbody.querySelectorAll('.co-del').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      const c = companiesCache.find((x) => String(x.id) === String(id));
      if (!window.confirm(`Delete ${c?.name || 'this company'}?`)) return;
      const res = await dbDeleteCompany(id);
      if (!res?.ok) {
        showToast('warn', res?.error || 'Could not delete company.');
        return;
      }
      if (String(editingId) === String(id)) clearForm();
      await refresh();
      showToast('success', 'Company deleted.');
    });
  });
}

async function refresh() {
  companiesCache = await getCompanies();
  renderTable();
}

async function handleSave() {
  hideFormError();
  const data = readForm();
  if (!data.name) return showFormError('Company name is required. Everything else is optional.');
  const res = editingId
    ? await dbUpdateCompany(editingId, data)
    : await dbSaveCompany(data);
  if (!res?.ok) return showFormError(res?.error || 'Could not save company.');
  showToast('success', editingId ? 'Company updated.' : `Company saved (${res.company?.companyCode || ''}).`);
  clearForm();
  await refresh();
}

function cacheElements() {
  els.name = byId('company-name');
  els.gst = byId('company-gst');
  els.contactName = byId('company-contact-name');
  els.code = byId('company-code-label');
  els.saveBtn = byId('btn-company-save');
  els.formError = byId('company-form-error');
  els.formErrorMsg = byId('company-form-error-msg');
  els.search = byId('company-search');
  els.tbody = byId('company-tbody');
  els.count = byId('company-count');
  els.card = byId('company-card');
}

function bindEvents() {
  els.saveBtn?.addEventListener('click', handleSave);
  byId('btn-company-clear')?.addEventListener('click', clearForm);
  els.search?.addEventListener('input', renderTable);
  els.name?.addEventListener('input', renderCardFromForm);
  els.gst?.addEventListener('input', renderCardFromForm);
  els.contactName?.addEventListener('input', renderCardFromForm);
  byId('btn-company-add-email')?.addEventListener('click', () => addListRow('emails'));
  byId('btn-company-add-phone')?.addEventListener('click', () => addListRow('phones'));
  byId('btn-company-add-address')?.addEventListener('click', () => addListRow('addresses', '', false, true));
}

export async function renderCompanies() {
  await refresh();
}

export async function initCompanies() {
  cacheElements();
  bindEvents();
  clearForm();
  await refresh();
}
