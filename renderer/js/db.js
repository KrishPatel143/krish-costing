/**
 * @file db.js
 * @description IPC abstraction layer. Wraps window.krish.* calls behind a clean
 * async API with in-memory caching. All DB access goes through this module.
 */

import { DEFAULT_RATES, DEFAULT_FLEX_RATES } from './data/materials.js';

// ─── In-memory caches ─────────────────────────────────────────────────────────
let _rates     = null;
let _flexRates = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** @returns {boolean} true when running inside Electron with preload bridge */
function hasIPC() {
  return typeof window !== 'undefined' && typeof window.krish !== 'undefined';
}

// ─── Paper rates ──────────────────────────────────────────────────────────────

/** @returns {Promise<Record<string,number>>} */
export async function getRates() {
  if (_rates) return _rates;
  _rates = hasIPC()
    ? await window.krish.getRates()
    : Object.assign({}, DEFAULT_RATES);
  return _rates;
}

/** @returns {Record<string,number>} Sync read from cache (must call getRates first) */
export function getRatesSync() {
  return _rates ?? Object.assign({}, DEFAULT_RATES);
}

/** @param {Record<string,number>} rates */
export async function saveRates(rates) {
  _rates = rates;
  if (hasIPC()) await window.krish.saveRates(rates);
}

export async function resetRates() {
  _rates = Object.assign({}, DEFAULT_RATES);
  if (hasIPC()) await window.krish.resetRates();
  return _rates;
}

// ─── Flexible rates ───────────────────────────────────────────────────────────

/** @returns {Promise<Record<string,number>>} */
export async function getFlexRates() {
  if (_flexRates) return _flexRates;
  _flexRates = hasIPC()
    ? await window.krish.getFlexRates()
    : Object.assign({}, DEFAULT_FLEX_RATES);
  return _flexRates;
}

export function getFlexRatesSync() {
  return _flexRates ?? Object.assign({}, DEFAULT_FLEX_RATES);
}

/** @param {Record<string,number>} rates */
export async function saveFlexRates(rates) {
  _flexRates = rates;
  if (hasIPC()) await window.krish.saveFlexRates(rates);
}

export async function resetFlexRates() {
  _flexRates = Object.assign({}, DEFAULT_FLEX_RATES);
  if (hasIPC()) await window.krish.resetFlexRates();
  return _flexRates;
}

// ─── History ──────────────────────────────────────────────────────────────────

/** @param {object} entry */
export async function addHistory(entry) {
  if (hasIPC()) await window.krish.addHistory(entry);
}

/** @returns {Promise<object[]>} */
export async function getHistory() {
  if (hasIPC()) return window.krish.getHistory();
  return [];
}

export async function clearHistory() {
  if (hasIPC()) await window.krish.clearHistory();
}

// ─── Production orders ─────────────────────────────────────────────────────────

/** @returns {Promise<object[]>} */
export async function getProductionOrders() {
  if (hasIPC()) return window.krish.getProductionOrders();
  return [];
}

/** @returns {Promise<string>} */
export async function getNextProductionOrderId() {
  if (hasIPC()) return window.krish.getNextProductionOrderId();
  const year = new Date().getFullYear();
  return `ORD-${year}-0001`;
}

/** @param {object} entry */
export async function addProductionOrder(entry) {
  if (hasIPC()) return window.krish.addProductionOrder(entry);
  return { ok: true, orderId: entry?.orderId ?? null };
}

/** @param {number|string} id @param {number} dispatchQuantity @param {string} dispatchDate */
export async function updateProductionDispatch(id, dispatchQuantity, dispatchDate) {
  if (hasIPC()) return window.krish.updateProductionDispatch(id, dispatchQuantity, dispatchDate);
  return { ok: true };
}

/** @param {number|string} id @param {object} entry */
export async function updateProductionOrder(id, entry) {
  if (hasIPC()) return window.krish.updateProductionOrder(id, entry);
  return { ok: true };
}

/** @param {number|string} id */
export async function deleteProductionOrder(id) {
  if (hasIPC()) return window.krish.deleteProductionOrder(id);
  return { ok: true };
}

// ─── Products catalog ─────────────────────────────────────────────────────────

export async function getProducts() {
  if (hasIPC()) return window.krish.getProducts();
  return [];
}

export async function saveProduct(entry) {
  if (hasIPC()) return window.krish.saveProduct(entry);
  return { ok: true };
}

export async function updateProduct(id, entry) {
  if (hasIPC()) return window.krish.updateProduct(id, entry);
  return { ok: true };
}

export async function deleteProduct(id) {
  if (hasIPC()) return window.krish.deleteProduct(id);
  return { ok: true };
}

export async function importProductsFromProduction() {
  if (hasIPC()) return window.krish.importProductsFromProduction();
  return { ok: true, count: 0 };
}

export async function getCompanies() {
  if (hasIPC()) return window.krish.getCompanies();
  return [];
}

export async function saveCompany(entry) {
  if (hasIPC()) return window.krish.saveCompany(entry);
  return { ok: true };
}

export async function updateCompany(id, entry) {
  if (hasIPC()) return window.krish.updateCompany(id, entry);
  return { ok: true };
}

export async function deleteCompany(id) {
  if (hasIPC()) return window.krish.deleteCompany(id);
  return { ok: true };
}

export async function getQuotations() {
  if (hasIPC()) return window.krish.getQuotations();
  return [];
}

export async function getNextQuotationId() {
  if (hasIPC()) return window.krish.getNextQuotationId();
  const year = new Date().getFullYear();
  return `QT-${year}-0001`;
}

export async function getLastQuotedRates(companyId) {
  if (hasIPC()) return window.krish.getLastQuotedRates(companyId);
  return {};
}

export async function saveQuotation(entry) {
  if (hasIPC()) return window.krish.saveQuotation(entry);
  return { ok: true };
}

export async function updateQuotation(id, entry) {
  if (hasIPC()) return window.krish.updateQuotation(id, entry);
  return { ok: true };
}

export async function deleteQuotation(id) {
  if (hasIPC()) return window.krish.deleteQuotation(id);
  return { ok: true };
}

// ─── App meta ─────────────────────────────────────────────────────────────────

export async function getDbPath() {
  if (hasIPC()) return window.krish.getDbPath();
  return null;
}

export async function printPreview(html, title) {
  if (!hasIPC() || typeof window.krish.printPreview !== 'function') {
    return { ok: false, error: 'Print preview is only available in the desktop app.' };
  }
  return window.krish.printPreview(html, title);
}

// ─── Init ─────────────────────────────────────────────────────────────────────

/** Pre-warm both caches. Call once at app startup. */
export async function initDb() {
  await Promise.all([getRates(), getFlexRates()]);
}
