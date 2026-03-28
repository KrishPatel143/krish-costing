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
  document.querySelectorAll('.p-tab').forEach(el => el.classList.remove('active'));
  document.getElementById(`tab-${tabId}`)?.classList.add('active');
  btn.classList.add('active');

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
