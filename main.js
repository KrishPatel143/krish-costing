const { app, BrowserWindow, ipcMain, Menu, shell, dialog } = require('electron');
const path = require('path');
const fs   = require('fs');
const { pathToFileURL } = require('url');
const { autoUpdater } = require('electron-updater');

autoUpdater.autoDownload = false; // Prompt user before downloading

// ── LowDB (ESM) loaded dynamically ──────────────────────────────────────────
let db, dbData;

async function initDb() {
  const { Low }    = await import('lowdb');
  const { JSONFile } = await import('lowdb/node');

  const userDataPath = app.getPath('userData');
  const dbFile = path.join(userDataPath, 'krish-crm-db.json');

  const adapter = new JSONFile(dbFile);
  db = new Low(adapter, {
    rates:     {},
    flexRates: {},
    history:   [],
    productionOrders: [],
    products: [],
    companies: [],
    quotations: [],
    meta: { nextCompanySeq: 1 },
  });
  await db.read();

  // Ensure defaults exist
  db.data.rates     = db.data.rates     || {};
  db.data.flexRates = db.data.flexRates || {};
  db.data.history   = db.data.history   || [];
  db.data.productionOrders = db.data.productionOrders || [];
  db.data.products = db.data.products || [];
  db.data.companies = db.data.companies || [];
  db.data.quotations = db.data.quotations || [];
  db.data.meta = db.data.meta || {};
  if (!Number.isFinite(db.data.meta.nextCompanySeq)) db.data.meta.nextCompanySeq = 1;
  if (db.data.products.length === 0 && db.data.productionOrders.length) {
    db.data.products = buildProductsFromOrders(db.data.productionOrders);
  }
  migrateCatalogLinks();
  await db.write();

  dbData = dbFile;
}

// ── Default rates (fallback) ─────────────────────────────────────────────────
const DEFAULT_RATES = {
  med: 160, ost: 120, cromo: 90, ply: 110, poster: 75,
  ink_half: 15000, ink_full: 15000
};

// ── Window ───────────────────────────────────────────────────────────────────
let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width:  1440,
    height: 900,
    minWidth:  900,
    minHeight: 600,
    title: 'Krish-CRM',
    backgroundColor: '#f5f5f3',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    // macOS: native title bar but no traffic lights overlap content
    titleBarStyle: 'default',
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ── App menu ─────────────────────────────────────────────────────────────────
function buildMenu() {
  const template = [
    {
      label: 'Krish-CRM',
      submenu: [
        { label: 'About Krish-CRM', role: 'about' },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() },
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => mainWindow?.webContents.reload() },
        { label: 'Toggle DevTools', accelerator: 'CmdOrCtrl+Shift+I', click: () => mainWindow?.webContents.toggleDevTools() },
        { type: 'separator' },
        { label: 'Actual Size', role: 'resetZoom' },
        { label: 'Zoom In',  role: 'zoomIn' },
        { label: 'Zoom Out', role: 'zoomOut' },
        { type: 'separator' },
        { label: 'Toggle Fullscreen', role: 'togglefullscreen' },
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Check for Updates...',
          click: () => {
            autoUpdater.checkForUpdates();
          }
        }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── IPC Handlers ─────────────────────────────────────────────────────────────

// Paper rates
ipcMain.handle('db:getRates', async () => {
  await db.read();
  return Object.assign({}, DEFAULT_RATES, db.data.rates);
});
ipcMain.handle('db:saveRates', async (_, rates) => {
  db.data.rates = rates;
  await db.write();
  return true;
});
ipcMain.handle('db:resetRates', async () => {
  db.data.rates = {};
  await db.write();
  return DEFAULT_RATES;
});

// Flex rates
ipcMain.handle('db:getFlexRates', async () => {
  await db.read();
  return db.data.flexRates;
});
ipcMain.handle('db:saveFlexRates', async (_, rates) => {
  db.data.flexRates = rates;
  await db.write();
  return true;
});
ipcMain.handle('db:resetFlexRates', async () => {
  db.data.flexRates = {};
  await db.write();
  return {};
});

// History
ipcMain.handle('db:addHistory', async (_, entry) => {
  await db.read();
  db.data.history.unshift({ ...entry, id: Date.now(), savedAt: new Date().toISOString() });
  // Keep last 200 entries
  if (db.data.history.length > 200) db.data.history = db.data.history.slice(0, 200);
  await db.write();
  return true;
});
ipcMain.handle('db:getHistory', async () => {
  await db.read();
  return db.data.history;
});
ipcMain.handle('db:clearHistory', async () => {
  db.data.history = [];
  await db.write();
  return true;
});

// Production orders
function buildNextOrderId(orders) {
  const nowYear = new Date().getFullYear();
  const yearPrefix = `ORD-${nowYear}-`;
  const yearOrders = orders.filter((o) => typeof o.orderId === 'string' && o.orderId.startsWith(yearPrefix));
  const lastNum = yearOrders.reduce((max, order) => {
    const num = parseInt(order.orderId.slice(yearPrefix.length), 10);
    return Number.isFinite(num) ? Math.max(max, num) : max;
  }, 0);
  const nextNum = String(lastNum + 1).padStart(4, '0');
  return `${yearPrefix}${nextNum}`;
}

ipcMain.handle('db:getProductionOrders', async () => {
  await db.read();
  return db.data.productionOrders;
});

ipcMain.handle('db:getNextProductionOrderId', async () => {
  await db.read();
  return buildNextOrderId(db.data.productionOrders || []);
});

ipcMain.handle('db:addProductionOrder', async (_, entry) => {
  await db.read();
  const now = new Date().toISOString();
  const orders = db.data.productionOrders || [];
  const orderId = entry.orderId || buildNextOrderId(orders);
  orders.unshift({
    ...entry,
    dispatchEntries: Array.isArray(entry.dispatchEntries) ? entry.dispatchEntries : [],
    dispatchQuantity: Number(entry.dispatchQuantity) || 0,
    id: Date.now(),
    orderId,
    savedAt: now,
  });
  const company = ensureCompanyByName(entry.companyName);
  orders[0].companyId = company.id;
  orders[0].companyCode = company.companyCode;
  orders[0].companyName = company.name;
  db.data.productionOrders = orders;
  upsertProductFromOrder(orders[0], { incrementCount: true });
  await db.write();
  return { ok: true, orderId };
});

ipcMain.handle('db:updateProductionDispatch', async (_, payload) => {
  await db.read();
  const { id, dispatchQuantity, dispatchDate } = payload || {};
  const orders = db.data.productionOrders || [];
  const idx = orders.findIndex((o) => String(o.id) === String(id));
  if (idx === -1) return { ok: false };
  const qty = Number(dispatchQuantity);
  if (!Number.isFinite(qty) || qty <= 0) return { ok: false };
  const entry = {
    date: dispatchDate || new Date().toISOString().slice(0, 10),
    quantity: qty,
    createdAt: new Date().toISOString(),
  };
  const prevEntries = Array.isArray(orders[idx].dispatchEntries) ? orders[idx].dispatchEntries : [];
  const nextEntries = [...prevEntries, entry];
  orders[idx].dispatchEntries = nextEntries;
  orders[idx].dispatchQuantity = nextEntries.reduce((s, e) => s + (Number(e.quantity) || 0), 0);
  await db.write();
  return { ok: true, dispatchQuantity: orders[idx].dispatchQuantity, dispatchEntries: nextEntries };
});

ipcMain.handle('db:updateProductionOrder', async (_, payload) => {
  await db.read();
  const { id, entry } = payload || {};
  const orders = db.data.productionOrders || [];
  const idx = orders.findIndex((o) => String(o.id) === String(id));
  if (idx === -1) return { ok: false };
  const prev = orders[idx];
  orders[idx] = {
    ...prev,
    ...entry,
    dispatchEntries: Array.isArray(entry?.dispatchEntries) ? entry.dispatchEntries : (Array.isArray(prev.dispatchEntries) ? prev.dispatchEntries : []),
    dispatchQuantity: Number(entry?.dispatchQuantity ?? prev.dispatchQuantity ?? 0) || 0,
    id: prev.id,
    orderId: prev.orderId,
    savedAt: prev.savedAt,
  };
  if (orders[idx].companyName) {
    const company = ensureCompanyByName(orders[idx].companyName);
    orders[idx].companyId = company.id;
    orders[idx].companyCode = company.companyCode;
    orders[idx].companyName = company.name;
  }
  upsertProductFromOrder(orders[idx], { incrementCount: false });
  await db.write();
  return { ok: true };
});

function roundNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function padCode(n, width = 4) {
  return String(n).padStart(width, '0');
}

function normalizeContactList(list) {
  const rows = (Array.isArray(list) ? list : [])
    .map((row) => {
      if (typeof row === 'string') return { value: row.trim(), isDefault: false };
      const value = String(row?.value || '').trim();
      return { value, isDefault: Boolean(row?.isDefault) };
    })
    .filter((row) => row.value);
  if (rows.length && !rows.some((r) => r.isDefault)) rows[0].isDefault = true;
  if (rows.filter((r) => r.isDefault).length > 1) {
    let seen = false;
    for (const row of rows) {
      if (row.isDefault && seen) row.isDefault = false;
      else if (row.isDefault) seen = true;
    }
  }
  return rows;
}

function emptyCompany(name) {
  const now = new Date().toISOString();
  db.data.meta = db.data.meta || {};
  const seq = Number(db.data.meta.nextCompanySeq) || 1;
  db.data.meta.nextCompanySeq = seq + 1;
  return {
    id: Date.now() + seq,
    companyCode: `C-${padCode(seq)}`,
    name: String(name || '').trim(),
    gst: '',
    contactName: '',
    emails: [],
    phones: [],
    addresses: [],
    nextProductSeq: 1,
    createdAt: now,
    updatedAt: now,
  };
}

function findCompanyByName(name) {
  const needle = String(name || '').trim().toLowerCase();
  if (!needle) return null;
  return (db.data.companies || []).find((c) => String(c.name || '').trim().toLowerCase() === needle) || null;
}

function findCompanyById(id) {
  if (id == null || id === '') return null;
  return (db.data.companies || []).find((c) => String(c.id) === String(id)) || null;
}

function ensureCompanyByName(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return null;
  db.data.companies = db.data.companies || [];
  const existing = findCompanyByName(trimmed);
  if (existing) return existing;
  const created = emptyCompany(trimmed);
  db.data.companies.unshift(created);
  return created;
}

function nextProductCode(company) {
  const seq = Number(company.nextProductSeq) || 1;
  company.nextProductSeq = seq + 1;
  return `${company.companyCode}-P-${padCode(seq)}`;
}

function companyRefFromEntry(entry) {
  let company = findCompanyById(entry.companyId) || findCompanyByName(entry.companyName);
  if (!company && String(entry.companyName || '').trim()) {
    company = ensureCompanyByName(entry.companyName);
  }
  return company;
}

function normalizePrintKind(printType) {
  const v = String(printType || '').toLowerCase();
  if (v === 'plain') return 'plain';
  if (v === 'printed' || v === 'one_side' || v === 'two_side') return 'printed';
  return '';
}

function normalizeInkCoverage(coverage, printType) {
  if (normalizePrintKind(printType) === 'plain') return 'half';
  return String(coverage || '').toLowerCase() === 'full' ? 'full' : 'half';
}

function productKeyFrom(entry) {
  const company = companyRefFromEntry(entry);
  const companyPart = company
    ? `id:${company.id}`
    : String(entry.companyName || '').trim().toLowerCase();
  const job = String(entry.jobName || '').trim().toLowerCase();
  const pouch = String(entry.pouchType || '').trim();
  const print = normalizePrintKind(entry.printType) || String(entry.printType || '').trim().toLowerCase();
  const ink = normalizeInkCoverage(entry.inkCoverage, print);
  return [
    companyPart,
    job,
    pouch,
    String(roundNum(entry.widthMm)),
    String(roundNum(entry.heightMm)),
    String(roundNum(entry.cylinderUpMm)),
    print,
    ink,
  ].join('|');
}

function productFieldsFromOrder(order) {
  const company = companyRefFromEntry(order);
  return {
    productKey: productKeyFrom(order),
    companyId: company?.id ?? null,
    companyCode: company?.companyCode || '',
    companyName: company?.name || String(order.companyName || '').trim(),
    jobName: String(order.jobName || '').trim(),
    pouchType: order.pouchType || '',
    widthMm: roundNum(order.widthMm),
    heightMm: roundNum(order.heightMm),
    cylinderUpMm: roundNum(order.cylinderUpMm),
    printType: normalizePrintKind(order.printType) || order.printType || '',
    inkCoverage: normalizeInkCoverage(order.inkCoverage, order.printType),
    lastOrderId: order.orderId || null,
    lastOrderDate: order.orderDate || null,
  };
}

function orderMatchesProduct(order, product) {
  return productKeyFrom(order) === product.productKey;
}

function refreshProductPricing(product) {
  const orders = (db.data.productionOrders || []).filter((o) => orderMatchesProduct(o, product));
  const rates = orders.map((o) => Number(o.rate)).filter((n) => Number.isFinite(n) && n > 0);
  const sum = rates.reduce((s, n) => s + n, 0);
  product.rateCount = rates.length;
  product.avgRate = rates.length ? roundNum(sum / rates.length) : 0;
  delete product.lastRate;
  if (rates.length) {
    const latest = orders.slice().sort((a, b) => String(b.orderDate || '').localeCompare(String(a.orderDate || '')))[0];
    product.lastOrderId = latest?.orderId || product.lastOrderId || null;
    product.lastOrderDate = latest?.orderDate || product.lastOrderDate || null;
  }
  product.orderCount = orders.length;
  return product;
}

function assignProductCode(product) {
  if (product.productCode) return product;
  const company = findCompanyById(product.companyId) || ensureCompanyByName(product.companyName);
  if (!company) return product;
  product.companyId = company.id;
  product.companyCode = company.companyCode;
  product.companyName = company.name;
  product.productCode = nextProductCode(company);
  return product;
}

function migrateCatalogLinks() {
  db.data.companies = db.data.companies || [];
  const names = new Set();
  for (const o of db.data.productionOrders || []) {
    const n = String(o.companyName || '').trim();
    if (n) names.add(n);
  }
  for (const p of db.data.products || []) {
    const n = String(p.companyName || '').trim();
    if (n) names.add(n);
  }
  for (const name of names) ensureCompanyByName(name);

  for (const o of db.data.productionOrders || []) {
    const company = findCompanyById(o.companyId) || ensureCompanyByName(o.companyName);
    if (!company) continue;
    o.companyId = company.id;
    o.companyCode = company.companyCode;
    o.companyName = company.name;
  }

  for (const p of db.data.products || []) {
    const company = findCompanyById(p.companyId) || ensureCompanyByName(p.companyName);
    if (company) {
      p.companyId = company.id;
      p.companyCode = company.companyCode;
      p.companyName = company.name;
      p.productKey = productKeyFrom(p);
    }
    assignProductCode(p);
    refreshProductPricing(p);
  }
}

function buildProductsFromOrders(orders) {
  const map = new Map();
  const list = Array.isArray(orders) ? orders.slice() : [];
  list.sort((a, b) => String(a.orderDate || '').localeCompare(String(b.orderDate || '')));
  let i = 0;
  for (const o of list) {
    if (!String(o.companyName || '').trim() || !String(o.jobName || '').trim() || !o.pouchType) continue;
    const fields = productFieldsFromOrder(o);
    const prev = map.get(fields.productKey);
    const now = new Date().toISOString();
    if (!prev) {
      map.set(fields.productKey, {
        ...fields,
        id: Date.now() + (i++),
        orderCount: 1,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      map.set(fields.productKey, {
        ...prev,
        ...fields,
        orderCount: (prev.orderCount || 0) + 1,
        updatedAt: now,
      });
    }
  }
  return [...map.values()].sort((a, b) =>
    String(a.companyName).localeCompare(String(b.companyName)) ||
    String(a.jobName).localeCompare(String(b.jobName))
  );
}

function mergeImportedProducts(existing, imported) {
  const byKey = new Map(imported.map((p) => [p.productKey, p]));
  const kept = existing.filter((p) => !byKey.has(p.productKey));
  const merged = imported.map((p) => {
    const old = existing.find((e) => e.productKey === p.productKey);
    if (!old) return p;
    return {
      ...p,
      id: old.id,
      productCode: old.productCode,
      createdAt: old.createdAt || p.createdAt,
    };
  });
  return [...merged, ...kept];
}

function upsertProductFromOrder(order, { incrementCount }) {
  if (!String(order.companyName || '').trim() || !String(order.jobName || '').trim() || !order.pouchType) return;
  db.data.products = db.data.products || [];
  const fields = productFieldsFromOrder(order);
  const now = new Date().toISOString();
  const idx = db.data.products.findIndex((p) => p.productKey === fields.productKey);
  if (idx === -1) {
    const created = {
      ...fields,
      id: Date.now(),
      orderCount: 1,
      createdAt: now,
      updatedAt: now,
    };
    assignProductCode(created);
    refreshProductPricing(created);
    db.data.products.unshift(created);
    return;
  }
  const prev = db.data.products[idx];
  db.data.products[idx] = {
    ...prev,
    ...fields,
    id: prev.id,
    productCode: prev.productCode,
    createdAt: prev.createdAt || now,
    orderCount: (prev.orderCount || 0) + (incrementCount ? 1 : 0),
    updatedAt: now,
  };
  assignProductCode(db.data.products[idx]);
  refreshProductPricing(db.data.products[idx]);
}

ipcMain.handle('db:getProducts', async () => {
  await db.read();
  return db.data.products || [];
});

ipcMain.handle('db:saveProduct', async (_, entry) => {
  await db.read();
  db.data.products = db.data.products || [];
  const fields = productFieldsFromOrder(entry);
  if (!fields.companyName || !fields.jobName || !fields.pouchType) {
    return { ok: false, error: 'Missing company, job, or pouch type.' };
  }
  const now = new Date().toISOString();
  const dup = db.data.products.find((p) => p.productKey === fields.productKey);
  if (dup) return { ok: false, error: 'This product already exists.' };
  const created = {
    ...fields,
    lastOrderId: null,
    lastOrderDate: null,
    id: Date.now(),
    orderCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  assignProductCode(created);
  refreshProductPricing(created);
  db.data.products.unshift(created);
  await db.write();
  return { ok: true, productCode: created.productCode };
});

ipcMain.handle('db:updateProduct', async (_, payload) => {
  await db.read();
  const { id, entry } = payload || {};
  const products = db.data.products || [];
  const idx = products.findIndex((p) => String(p.id) === String(id));
  if (idx === -1) return { ok: false };
  const fields = productFieldsFromOrder(entry);
  const clash = products.find((p) => p.productKey === fields.productKey && String(p.id) !== String(id));
  if (clash) return { ok: false, error: 'Another product already has this size and type.' };
  const prev = products[idx];
  products[idx] = {
    ...prev,
    ...fields,
    id: prev.id,
    productCode: prev.productCode,
    orderCount: prev.orderCount || 0,
    lastOrderId: prev.lastOrderId,
    lastOrderDate: prev.lastOrderDate,
    createdAt: prev.createdAt,
    updatedAt: new Date().toISOString(),
  };
  assignProductCode(products[idx]);
  refreshProductPricing(products[idx]);
  await db.write();
  return { ok: true };
});

ipcMain.handle('db:deleteProduct', async (_, id) => {
  await db.read();
  const products = db.data.products || [];
  const idx = products.findIndex((p) => String(p.id) === String(id));
  if (idx === -1) return { ok: false };
  products.splice(idx, 1);
  db.data.products = products;
  await db.write();
  return { ok: true };
});

ipcMain.handle('db:importProductsFromProduction', async () => {
  await db.read();
  const imported = buildProductsFromOrders(db.data.productionOrders || []);
  db.data.products = mergeImportedProducts(db.data.products || [], imported);
  migrateCatalogLinks();
  await db.write();
  return { ok: true, count: db.data.products.length };
});

function sanitizeCompanyEntry(entry, prev) {
  const name = String(entry?.name || entry?.companyName || prev?.name || '').trim();
  return {
    name,
    gst: String(entry?.gst ?? prev?.gst ?? '').trim(),
    contactName: String(entry?.contactName ?? prev?.contactName ?? '').trim(),
    emails: normalizeContactList(entry?.emails ?? prev?.emails),
    phones: normalizeContactList(entry?.phones ?? prev?.phones),
    addresses: normalizeContactList(entry?.addresses ?? prev?.addresses),
  };
}

ipcMain.handle('db:getCompanies', async () => {
  await db.read();
  return db.data.companies || [];
});

ipcMain.handle('db:saveCompany', async (_, entry) => {
  await db.read();
  db.data.companies = db.data.companies || [];
  const fields = sanitizeCompanyEntry(entry, null);
  if (!fields.name) return { ok: false, error: 'Company name is required.' };
  if (findCompanyByName(fields.name)) return { ok: false, error: 'A company with this name already exists.' };
  const created = { ...emptyCompany(fields.name), ...fields };
  db.data.companies.unshift(created);
  await db.write();
  return { ok: true, company: created };
});

ipcMain.handle('db:updateCompany', async (_, payload) => {
  await db.read();
  const { id, entry } = payload || {};
  const companies = db.data.companies || [];
  const idx = companies.findIndex((c) => String(c.id) === String(id));
  if (idx === -1) return { ok: false };
  const fields = sanitizeCompanyEntry(entry, companies[idx]);
  if (!fields.name) return { ok: false, error: 'Company name is required.' };
  const clash = companies.find((c) => String(c.id) !== String(id) && String(c.name).trim().toLowerCase() === fields.name.toLowerCase());
  if (clash) return { ok: false, error: 'Another company already has this name.' };
  const prev = companies[idx];
  companies[idx] = {
    ...prev,
    ...fields,
    id: prev.id,
    companyCode: prev.companyCode,
    nextProductSeq: prev.nextProductSeq || 1,
    createdAt: prev.createdAt,
    updatedAt: new Date().toISOString(),
  };
  const updated = companies[idx];
  for (const p of db.data.products || []) {
    if (String(p.companyId) === String(updated.id)) {
      p.companyName = updated.name;
      p.companyCode = updated.companyCode;
    }
  }
  for (const o of db.data.productionOrders || []) {
    if (String(o.companyId) === String(updated.id)) {
      o.companyName = updated.name;
      o.companyCode = updated.companyCode;
    }
  }
  await db.write();
  return { ok: true, company: updated };
});

ipcMain.handle('db:deleteCompany', async (_, id) => {
  await db.read();
  const usedProduct = (db.data.products || []).some((p) => String(p.companyId) === String(id));
  const usedOrder = (db.data.productionOrders || []).some((o) => String(o.companyId) === String(id));
  if (usedProduct || usedOrder) {
    return { ok: false, error: 'This company is linked to products or orders. Remove those first.' };
  }
  const companies = db.data.companies || [];
  const idx = companies.findIndex((c) => String(c.id) === String(id));
  if (idx === -1) return { ok: false };
  companies.splice(idx, 1);
  db.data.companies = companies;
  await db.write();
  return { ok: true };
});

function buildNextQuotationId(list) {
  const nowYear = new Date().getFullYear();
  const yearPrefix = `QT-${nowYear}-`;
  const yearItems = (list || []).filter((q) => typeof q.quotationId === 'string' && q.quotationId.startsWith(yearPrefix));
  const lastNum = yearItems.reduce((max, q) => {
    const num = parseInt(q.quotationId.slice(yearPrefix.length), 10);
    return Number.isFinite(num) ? Math.max(max, num) : max;
  }, 0);
  return `${yearPrefix}${String(lastNum + 1).padStart(4, '0')}`;
}

function lastQuotedRateMap(companyId) {
  const map = new Map();
  const list = (db.data.quotations || [])
    .filter((q) => String(q.companyId) === String(companyId))
    .slice()
    .sort((a, b) => String(a.quotationDate || a.createdAt || '').localeCompare(String(b.quotationDate || b.createdAt || '')));
  for (const q of list) {
    for (const line of q.lines || []) {
      if (!line.productId) continue;
      const rate = Number(line.quotedRate);
      if (Number.isFinite(rate) && rate > 0) map.set(String(line.productId), rate);
    }
  }
  return map;
}

ipcMain.handle('db:getQuotations', async () => {
  await db.read();
  return db.data.quotations || [];
});

ipcMain.handle('db:getNextQuotationId', async () => {
  await db.read();
  return buildNextQuotationId(db.data.quotations || []);
});

ipcMain.handle('db:getLastQuotedRates', async (_, companyId) => {
  await db.read();
  return Object.fromEntries(lastQuotedRateMap(companyId));
});

ipcMain.handle('db:saveQuotation', async (_, entry) => {
  await db.read();
  db.data.quotations = db.data.quotations || [];
  const company = findCompanyById(entry.companyId) || findCompanyByName(entry.companyName);
  if (!company) return { ok: false, error: 'Select a company.' };
  const quotationDate = String(entry.quotationDate || '').slice(0, 10);
  const validUntil = String(entry.validUntil || '').slice(0, 10);
  if (!quotationDate) return { ok: false, error: 'Quotation date is required.' };
  if (!validUntil) return { ok: false, error: 'Valid until date is required.' };
  if (validUntil < quotationDate) return { ok: false, error: 'Valid until must be on or after the quotation date.' };
  const lines = Array.isArray(entry.lines) ? entry.lines.filter((l) => l && l.included !== false) : [];
  if (!lines.length) return { ok: false, error: 'Include at least one product.' };
  for (const line of lines) {
    const quoted = Number(line.quotedRate);
    if (!Number.isFinite(quoted) || quoted <= 0) {
      return { ok: false, error: `Enter a quoted rate for ${line.jobName || line.productCode || 'each product'}.` };
    }
  }
  const now = new Date().toISOString();
  const quotationId = entry.quotationId || buildNextQuotationId(db.data.quotations);
  const snapshot = {
    paperRates: entry.materialRatesSnapshot?.paperRates || Object.assign({}, DEFAULT_RATES, db.data.rates || {}),
    flexRates: entry.materialRatesSnapshot?.flexRates || Object.assign({}, db.data.flexRates || {}),
    inkCoverage: entry.costingAssumptions?.inkCoverage || 'half',
    profitPercent: Number(entry.costingAssumptions?.profitPercent) || 30,
    wastagePercent: Number(entry.costingAssumptions?.wastagePercent) || 3,
  };
  const emails = Array.isArray(company.emails) ? company.emails : [];
  const phones = Array.isArray(company.phones) ? company.phones : [];
  const addresses = Array.isArray(company.addresses) ? company.addresses : [];
  const def = (list) => (list.find((r) => r.isDefault) || list[0] || {}).value || '';
  const saved = {
    id: Date.now(),
    quotationId,
    quotationDate,
    validUntil,
    companyId: company.id,
    companyCode: company.companyCode,
    companyName: company.name,
    companyGst: company.gst || '',
    companyContactName: company.contactName || '',
    companyEmail: def(emails),
    companyPhone: def(phones),
    companyAddress: def(addresses),
    lines: lines.map((line) => ({
      productId: line.productId,
      productCode: line.productCode || '',
      jobName: line.jobName || '',
      pouchType: line.pouchType || '',
      widthMm: Number(line.widthMm) || 0,
      heightMm: Number(line.heightMm) || 0,
      cylinderUpMm: Number(line.cylinderUpMm) || 0,
      printType: line.printType || '',
      inkCoverage: line.inkCoverage === 'full' ? 'full' : 'half',
      avgRate: Number(line.avgRate) || 0,
      lastRate: Number(line.lastRate) || 0,
      lastQuotationRate: Number(line.lastQuotationRate) || 0,
      lastQuotationRateUnit: line.lastQuotationRateUnit === 'kg' ? 'kg' : (line.lastQuotationRateUnit === 'nos' ? 'nos' : (line.rateUnit === 'kg' ? 'kg' : 'nos')),
      lastQuotationProfitPercent: Number.isFinite(Number(line.lastQuotationProfitPercent)) ? Number(line.lastQuotationProfitPercent) : null,
      currentRate: Number(line.currentRate) || 0,
      quotedRate: Number(line.quotedRate) || 0,
      baseCost: Number(line.baseCost) || 0,
      labourCost: Number(line.labourCost) || 0,
      impliedProfitPercent: Number.isFinite(Number(line.impliedProfitPercent)) ? Number(line.impliedProfitPercent) : null,
      rateUnit: line.rateUnit === 'kg' ? 'kg' : 'nos',
    })),
    materialRatesSnapshot: {
      paperRates: snapshot.paperRates,
      flexRates: snapshot.flexRates,
    },
    costingAssumptions: {
      inkCoverage: snapshot.inkCoverage,
      profitPercent: snapshot.profitPercent,
      wastagePercent: snapshot.wastagePercent,
    },
    createdAt: now,
  };
  db.data.quotations.unshift(saved);
  await db.write();
  return { ok: true, quotationId };
});

ipcMain.handle('db:updateQuotation', async (_, payload) => {
  await db.read();
  const { id, entry } = payload || {};
  const list = db.data.quotations || [];
  const idx = list.findIndex((q) => String(q.id) === String(id));
  if (idx === -1) return { ok: false, error: 'Quotation not found.' };
  const prev = list[idx];
  const incoming = Array.isArray(entry?.lines) ? entry.lines : [];
  const nextLines = (prev.lines || []).map((line) => {
    const patch = incoming.find((l) =>
      (l.productId != null && String(l.productId) === String(line.productId))
      || (l.productCode && line.productCode && String(l.productCode) === String(line.productCode))
    );
    if (!patch) return line;
    const quoted = Number(patch.quotedRate);
    if (!Number.isFinite(quoted) || quoted <= 0) return line;
    const base = Number(line.baseCost) || Number(patch.baseCost) || 0;
    const labour = Number(line.labourCost) || Number(patch.labourCost) || 0;
    const implied = base > 0 ? ((quoted - labour) / base - 1) * 100 : null;
    return {
      ...line,
      quotedRate: quoted,
      baseCost: base,
      labourCost: labour,
      impliedProfitPercent: Number.isFinite(implied) ? implied : null,
    };
  });
  for (const line of nextLines) {
    if (!Number.isFinite(Number(line.quotedRate)) || Number(line.quotedRate) <= 0) {
      return { ok: false, error: `Enter a quoted rate for ${line.jobName || line.productCode || 'each product'}.` };
    }
  }
  list[idx] = {
    ...prev,
    lines: nextLines,
    updatedAt: new Date().toISOString(),
  };
  await db.write();
  return { ok: true, quotationId: prev.quotationId };
});

ipcMain.handle('db:deleteQuotation', async (_, id) => {
  await db.read();
  const list = db.data.quotations || [];
  const idx = list.findIndex((q) => String(q.id) === String(id));
  if (idx === -1) return { ok: false };
  list.splice(idx, 1);
  db.data.quotations = list;
  await db.write();
  return { ok: true };
});

ipcMain.handle('db:deleteProductionOrder', async (_, id) => {
  await db.read();
  const orders = db.data.productionOrders || [];
  const idx = orders.findIndex((o) => String(o.id) === String(id));
  if (idx === -1) return { ok: false };
  orders.splice(idx, 1);
  db.data.productionOrders = orders;
  await db.write();
  return { ok: true };
});

ipcMain.handle('print:preview', async (_event, payload) => {
  const html = String(payload?.html || '');
  const title = String(payload?.title || 'Print preview');
  if (!html.trim()) return { ok: false, error: 'Empty document.' };

  const stamp = Date.now();
  const tmpHtml = path.join(app.getPath('temp'), `krish-print-${stamp}.html`);
  const tmpPdf = path.join(app.getPath('temp'), `krish-print-${stamp}.pdf`);
  fs.writeFileSync(tmpHtml, html, 'utf8');

  const preview = new BrowserWindow({
    width: 960,
    height: 820,
    parent: mainWindow || undefined,
    title,
    backgroundColor: '#ffffff',
    autoHideMenuBar: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const cleanupTemps = () => {
    try { fs.unlinkSync(tmpHtml); } catch (_) { /* ignore */ }
    try { fs.unlinkSync(tmpPdf); } catch (_) { /* ignore */ }
  };

  const printFromPreview = () => {
    preview.webContents.print({ printBackground: true, silent: false });
  };

  preview.setMenu(Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [
        { label: 'Print…', accelerator: 'CmdOrCtrl+P', click: printFromPreview },
        {
          label: 'Save PDF…',
          click: async () => {
            const { filePath } = await dialog.showSaveDialog(preview, {
              title: 'Save PDF',
              defaultPath: `${String(title).replace(/[\\/:*?"<>|]/g, '_')}.pdf`,
              filters: [{ name: 'PDF', extensions: ['pdf'] }],
            });
            if (!filePath) return;
            const data = await preview.webContents.printToPDF({
              printBackground: true,
              pageSize: 'A4',
            });
            fs.writeFileSync(filePath, data);
          },
        },
        { type: 'separator' },
        { label: 'Close', role: 'close' },
      ],
    },
  ]));

  try {
    await preview.loadFile(tmpHtml);
    const pdfBuf = await preview.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
    });
    fs.writeFileSync(tmpPdf, pdfBuf);
    await preview.loadURL(pathToFileURL(tmpPdf).href);
  } catch {
    preview.close();
    cleanupTemps();
    return { ok: false, error: 'Unable to build print preview.' };
  }

  preview.on('closed', cleanupTemps);
  return { ok: true };
});

// App info
ipcMain.handle('app:getVersion', () => app.getVersion());
ipcMain.handle('app:getDbPath', () => dbData);

function setupAutoUpdater() {
  autoUpdater.on('update-available', (info) => {
    dialog.showMessageBox({
      type: 'info',
      title: 'Update Available',
      message: `Version ${info.version} is available. Do you want to download it now?`,
      buttons: ['Yes', 'No']
    }).then((result) => {
      if (result.response === 0) {
        autoUpdater.downloadUpdate();
        dialog.showMessageBox({
          type: 'info',
          title: 'Downloading',
          message: 'Downloading update in the background...',
          buttons: ['OK']
        });
      }
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    dialog.showMessageBox({
      type: 'info',
      title: 'Up to Date',
      message: 'You are running the latest version.'
    });
  });

  autoUpdater.on('error', (err) => {
    dialog.showMessageBox({
      type: 'error',
      title: 'Update Error',
      message: 'Error while checking for updates:\n' + err.message
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    dialog.showMessageBox({
      type: 'info',
      title: 'Update Ready',
      message: 'Update downloaded successfully. The application will now restart to install it.',
      buttons: ['Restart Now', 'Later']
    }).then((result) => {
      if (result.response === 0) {
        autoUpdater.quitAndInstall();
      }
    });
  });
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  await initDb();
  buildMenu();
  createWindow();
  setupAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
