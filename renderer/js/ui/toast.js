/**
 * @file toast.js
 * @description Non-blocking toast notification system.
 */

const TOAST_DURATION_MS = 3000;
const FADE_MS           = 320;

/** @param {'success'|'info'|'danger'} type @param {string} message */
export function showToast(type, message) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `p-toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), FADE_MS);
  }, TOAST_DURATION_MS);
}
