/**
 * @file tabs.js
 * @description Tab switching and collapsible section toggle.
 */

/** @type {Map<string, () => void>} Lifecycle hooks called on tab activation */
const tabActivationHooks = new Map();

/**
 * Register a callback to run when a specific tab becomes active.
 * @param {string} tabId   e.g. 'history'
 * @param {() => void} fn
 */
export function onTabActivate(tabId, fn) {
  tabActivationHooks.set(tabId, fn);
}

/**
 * Switch the active tab.
 * @param {string} tabId   Must match the id suffix used in HTML: tab-{tabId}
 * @param {Element} btn    The clicked tab button
 */
export function switchTab(tabId, btn) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.p-tab').forEach(el => {
    el.classList.remove('active');
    el.removeAttribute('aria-current');
  });
  document.getElementById(`tab-${tabId}`)?.classList.add('active');
  btn.classList.add('active');
  btn.setAttribute('aria-current', 'page');

  const title = document.getElementById('page-title');
  const subtitle = document.getElementById('page-subtitle');
  if (title) title.textContent = btn.dataset.title || btn.textContent.trim();
  if (subtitle) subtitle.textContent = btn.dataset.subtitle || '';

  try { localStorage.setItem('krish-active-tab', tabId); } catch { /* ignore quota */ }

  const hook = tabActivationHooks.get(tabId);
  if (hook) hook();
}

/**
 * Toggle the visibility of a collapsible section.
 * @param {string} bodyId  ID of the element to show/hide
 * @param {Element} btn    The toggle button
 */
export function toggleSection(bodyId, btn) {
  const body   = document.getElementById(bodyId);
  if (!body) return;
  const hidden = body.style.display === 'none';
  body.style.display = hidden ? '' : 'none';
  btn.textContent    = hidden ? 'Hide' : 'Show';
}

/** Wire tab buttons using data attributes. Call once on DOMContentLoaded. */
export function initTabs() {
  document.querySelectorAll('[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab, btn));
  });
}

/** Restore last section after activation hooks are registered. */
export function restoreActiveTab() {
  try {
    const saved = localStorage.getItem('krish-active-tab');
    const btn = saved ? document.querySelector(`[data-tab="${saved}"]`) : null;
    if (btn) switchTab(saved, btn);
  } catch { /* ignore */ }
}
