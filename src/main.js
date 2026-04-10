const { app, BrowserWindow, ipcMain, Menu, MenuItem, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const zlib = require('zlib');

let mainWindow;

function createWindow() {
  const isMac = process.platform === 'darwin';
  const isWin = process.platform === 'win32';

  const preloadPath = path.join(__dirname, 'preload.js');
  const iconPath = path.join(__dirname, '..', '..', '..', 'assets', isWin ? 'icon.ico' : 'icon.png');

  const logLines = [
    `isPackaged: ${app.isPackaged}`,
    `__dirname: ${__dirname}`,
    `preloadPath: ${preloadPath}`,
    `preload exists: ${fs.existsSync(preloadPath)}`,
    `iconPath: ${iconPath}`,
  ];
  console.log(logLines.join('\n'));
  fs.writeFileSync(path.join(app.getPath('userData'), 'debug.log'), logLines.join('\n'));

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    backgroundColor: '#0f0f0f',
    autoHideMenuBar: isWin,
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: preloadPath,
      webSecurity: false,
      spellcheck: false,
    },
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  buildMenu();

  // Right-click context menu for inputs (cut/copy/paste)
  mainWindow.webContents.on('context-menu', (e, params) => {
    if (params.isEditable) {
      const menu = new Menu();
      menu.append(new MenuItem({ label: 'Cut', role: 'cut', enabled: params.selectionText.length > 0 }));
      menu.append(new MenuItem({ label: 'Copy', role: 'copy', enabled: params.selectionText.length > 0 }));
      menu.append(new MenuItem({ label: 'Paste', role: 'paste' }));
      menu.append(new MenuItem({ type: 'separator' }));
      menu.append(new MenuItem({ label: 'Select All', role: 'selectAll' }));
      menu.popup({ window: mainWindow });
    }
  });
}

function buildMenu() {
  const template = [
    {
      label: 'IPTV Player',
      submenu: [
        { label: 'About IPTV Player', role: 'about' },
        { type: 'separator' },
        { label: 'Hide IPTV Player', accelerator: 'Command+H', role: 'hide' },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'Command+Q', click: () => app.quit() },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'Command+Z', role: 'undo' },
        { label: 'Redo', accelerator: 'Shift+Command+Z', role: 'redo' },
        { type: 'separator' },
        { label: 'Cut', accelerator: 'Command+X', role: 'cut' },
        { label: 'Copy', accelerator: 'Command+C', role: 'copy' },
        { label: 'Paste', accelerator: 'Command+V', role: 'paste' },
        { label: 'Select All', accelerator: 'Command+A', role: 'selectAll' },
      ],
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'Open M3U File…',
          accelerator: 'Command+O',
          click: async () => {
            const result = await dialog.showOpenDialog(mainWindow, {
              properties: ['openFile'],
              filters: [{ name: 'M3U Playlist', extensions: ['m3u', 'm3u8'] }],
            });
            if (!result.canceled && result.filePaths.length > 0) {
              mainWindow.webContents.send('open-file', result.filePaths[0]);
            }
          },
        },
        { type: 'separator' },
        { label: 'Close Window', accelerator: 'Command+W', role: 'close' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle Full Screen', accelerator: 'Ctrl+Command+F', role: 'togglefullscreen' },
        { label: 'Actual Size', accelerator: 'Command+0', role: 'resetZoom' },
        { label: 'Zoom In', accelerator: 'Command+Plus', role: 'zoomIn' },
        { label: 'Zoom Out', accelerator: 'Command+-', role: 'zoomOut' },
        { type: 'separator' },
        { label: 'Toggle DevTools', accelerator: 'Alt+Command+I', role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { label: 'Minimize', accelerator: 'Command+M', role: 'minimize' },
        { label: 'Zoom', role: 'zoom' },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// IPC: fetch remote M3U over http/https (bypasses browser CORS)
ipcMain.handle('fetch-m3u', async (event, url) => {
  function fetchURL(targetURL, redirectsLeft) {
    return new Promise((resolve, reject) => {
      if (redirectsLeft < 0) {
        reject(new Error('Too many redirects'));
        return;
      }
      const lib = targetURL.startsWith('https') ? https : http;
      const req = lib.get(targetURL, { timeout: 20000 }, (res) => {
        // Handle redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume(); // drain response
          const next = res.headers.location.startsWith('http')
            ? res.headers.location
            : new URL(res.headers.location, targetURL).href;
          resolve(fetchURL(next, redirectsLeft - 1));
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        // Collect chunks as buffers to handle large playlists
        const chunks = [];
        res.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        res.on('error', reject);
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    });
  }
  return fetchURL(url, 5);
});

// IPC: read local M3U file
ipcMain.handle('read-file', async (event, filePath) => {
  return fs.readFileSync(filePath, 'utf-8');
});

// IPC: open file dialog
ipcMain.handle('open-file-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'M3U Playlist', extensions: ['m3u', 'm3u8'] }],
  });
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

// IPC: save favorites to user data
ipcMain.handle('save-data', async (event, key, value) => {
  if (key === 'playlist-cache') {
    const compressed = zlib.gzipSync(JSON.stringify(value));
    fs.writeFileSync(path.join(app.getPath('userData'), `${key}.gz`), compressed);
  } else {
    fs.writeFileSync(path.join(app.getPath('userData'), `${key}.json`), JSON.stringify(value));
  }
});

ipcMain.handle('load-data', async (event, key) => {
  if (key === 'playlist-cache') {
    const gzPath = path.join(app.getPath('userData'), `${key}.gz`);
    if (fs.existsSync(gzPath)) {
      return JSON.parse(zlib.gunzipSync(fs.readFileSync(gzPath)).toString('utf-8'));
    }
  }
  const dataPath = path.join(app.getPath('userData'), `${key}.json`);
  if (fs.existsSync(dataPath)) {
    return JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  }
  return null;
});

app.whenReady().then(createWindow);

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
