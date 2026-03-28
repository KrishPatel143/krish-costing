const { app, BrowserWindow, ipcMain, Menu, shell } = require('electron');
const path = require('path');
const fs   = require('fs');

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
    history:   []
  });
  await db.read();

  // Ensure defaults exist
  db.data.rates     = db.data.rates     || {};
  db.data.flexRates = db.data.flexRates || {};
  db.data.history   = db.data.history   || [];
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

// App info
ipcMain.handle('app:getVersion', () => app.getVersion());
ipcMain.handle('app:getDbPath', () => dbData);

// ── Lifecycle ─────────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  await initDb();
  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
