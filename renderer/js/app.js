/**
 * @file app.js
 * @description Application entry point. Bootstraps all modules in correct order.
 * This is the only file loaded by index.html (type="module").
 */

import { initDb, getDbPath } from './db.js';
import { initTabs, onTabActivate } from './ui/tabs.js';
import { initPaperCalc } from './ui/paperCalc.js';
import { initRates, renderRatesTable } from './ui/rates.js';
import { initHistory, renderHistory } from './ui/history.js';

async function boot() {
  // 1. Pre-warm DB caches (fetches rates from LowDB via IPC)
  await initDb();

  // 2. Wire up tab switching with activation hooks
  initTabs();
  onTabActivate('history', renderHistory);

  // 3. Init each feature module (attaches event listeners)
  initPaperCalc();
  initRates();
  initHistory();

  // 4. Render static tables that need data at startup
  renderRatesTable();

  // 5. Show DB path in subtitle
  const dbPath = await getDbPath();
  const dbLabel = document.getElementById('db-path-label');
  if (dbLabel) {
    dbLabel.textContent = dbPath ?? 'Local DB active';
    dbLabel.title       = dbPath ?? '';
  }
}

document.addEventListener('DOMContentLoaded', boot);
