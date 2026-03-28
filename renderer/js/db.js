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

// ─── App meta ─────────────────────────────────────────────────────────────────

export async function getDbPath() {
  if (hasIPC()) return window.krish.getDbPath();
  return null;
}

// ─── Init ─────────────────────────────────────────────────────────────────────

/** Pre-warm both caches. Call once at app startup. */
export async function initDb() {
  await Promise.all([getRates(), getFlexRates()]);
}
