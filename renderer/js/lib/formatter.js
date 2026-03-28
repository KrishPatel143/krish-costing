/**
 * @file formatter.js
 * @description Pure string-formatting helpers. Zero dependencies, zero side effects.
 */

/**
 * Format a number as Indian-locale currency string.
 * @param {number} n
 * @param {number} [decimals=2]
 * @returns {string}  e.g. "₹1,23,456.78"
 */
export function fmt(n, decimals = 2) {
  return '₹' + n.toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Format a number with fixed decimal places (Indian locale, no currency symbol).
 * @param {number} n
 * @param {number} [d=4]
 * @returns {string}
 */
export function fmtNum(n, d = 4) {
  return n.toLocaleString('en-IN', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}

/**
 * Format a Date object as a short human-readable string.
 * @param {Date|string} date
 * @returns {string}  e.g. "27 Mar 2026  11:24 PM"
 */
export function fmtDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  return (
    d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) +
    '  ' +
    d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
  );
}
