const { app, BrowserWindow, ipcMain, Menu, shell, dialog } = require('electron');
const path = require('path');
const fs   = require('fs');
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
    productionOrders: []
  });
  await db.read();

  // Ensure defaults exist
  db.data.rates     = db.data.rates     || {};
  db.data.flexRates = db.data.flexRates || {};
  db.data.history   = db.data.history   || [];
  db.data.productionOrders = db.data.productionOrders || [];
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
  db.data.productionOrders = orders;
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
