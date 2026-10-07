'use strict';
// Halı: masaüstüne serilen, fiziği olan halı.
// Pencere: çalışma alanını kaplayan şeffaf, çerçevesiz pencere. Masaüstünün hemen
// üstünde (diğer uygulamaların altında) durur; halının olmadığı yerde tıklamalar
// masaüstüne geçer.
const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

// Test için: ayrı veri klasörü ve betikli sürüş (normal kullanımda boş)
if (process.env.HALI_USERDATA) app.setPath('userData', process.env.HALI_USERDATA);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  start();
}

function start() {
  let win = null;
  let tray = null;
  let quitting = false;
  let lastCursor = { x: -1, y: -1 };

  // ---------- durum (halının şekli + altına süpürülenler)
  const stateFile = () => path.join(app.getPath('userData'), 'state.json');
  let state = { items: [], rug: null };
  function loadState() {
    try {
      const s = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
      state = { items: Array.isArray(s.items) ? s.items : [], rug: s.rug || null };
    } catch {
      /* ilk açılış */
    }
  }
  let saveTimer = null;
  function writeState() {
    try {
      const tmp = stateFile() + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(state));
      fs.renameSync(tmp, stateFile());
    } catch (e) {
      console.error('durum kaydedilemedi', e);
    }
  }
  function saveState() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(writeState, 400);
  }

  // ---------- Win32: pencereyi masaüstünün hemen üstüne it
  let user32 = null;
  try {
    const koffi = require('koffi');
    const lib = koffi.load('user32.dll');
    user32 = {
      SetWindowPos: lib.func('__stdcall', 'SetWindowPos', 'bool', ['intptr_t', 'intptr_t', 'int', 'int', 'int', 'int', 'uint32_t']),
    };
  } catch (e) {
    console.warn('koffi yüklenemedi, z-sırası Electron ile sınırlı:', e.message);
  }
  const HWND_BOTTOM = 1;
  const SWP = 0x0001 /* NOSIZE */ | 0x0002 /* NOMOVE */ | 0x0010; /* NOACTIVATE */
  function hwndOf(w) {
    const b = w.getNativeWindowHandle();
    return b.length >= 8 ? Number(b.readBigUInt64LE(0)) : b.readUInt32LE(0);
  }
  function sendToBottom() {
    if (!win || win.isDestroyed() || !user32) return;
    try {
      user32.SetWindowPos(hwndOf(win), HWND_BOTTOM, 0, 0, 0, 0, SWP);
    } catch (e) {
      console.warn(e.message);
    }
  }

  // ---------- dosya gizleme (halının altına süpürme)
  function attrib(flag, p) {
    return new Promise((resolve, reject) => {
      execFile('attrib', [flag, p], { windowsHide: true }, (err, stdout) => {
        if (err) return reject(err);
        const out = String(stdout || '').trim();
        if (out) return reject(new Error(out)); // attrib hatayı stdout'a yazar
        resolve();
      });
    });
  }
  function displayName(p) {
    let st = null;
    try {
      st = fs.statSync(p);
    } catch {
      /* yok */
    }
    const base = path.basename(p);
    if (st && st.isDirectory()) return base;
    const ext = path.extname(base);
    return ext ? base.slice(0, -ext.length) : base;
  }
  async function iconOf(p) {
    try {
      // Klasörler için Electron genel bir simge döndürüyor; oluşturucu kendi klasör simgesini çizer
      if (fs.statSync(p).isDirectory()) return 'folder';
      const img = await app.getFileIcon(p, { size: 'large' });
      return img.toDataURL();
    } catch {
      return null;
    }
  }
  function isRoot(p) {
    const r = path.parse(p).root;
    return path.resolve(p).replace(/[\\/]+$/, '') === r.replace(/[\\/]+$/, '');
  }

  ipcMain.handle('get-state', async () => {
    // silinmiş olanları at
    state.items = state.items.filter((it) => fs.existsSync(it.path));
    const items = [];
    for (const it of state.items) items.push({ ...it, icon: await iconOf(it.path) });
    return { items, rug: state.rug };
  });

  ipcMain.handle('hide-items', async (_e, list) => {
    const out = [];
    const failed = [];
    for (const entry of Array.isArray(list) ? list : []) {
      const p = entry && entry.path;
      if (typeof p !== 'string' || !path.isAbsolute(p) || !fs.existsSync(p) || isRoot(p)) continue;
      if (state.items.some((i) => i.path.toLowerCase() === p.toLowerCase())) continue;
      try {
        await attrib('+h', p);
      } catch (e) {
        failed.push({ path: p, error: e.message });
        continue;
      }
      const item = { path: p, name: displayName(p), x: Number(entry.x) || 0, y: Number(entry.y) || 0 };
      state.items.push(item);
      out.push({ ...item, icon: await iconOf(p) });
    }
    saveState();
    return { items: out, failed };
  });

  async function restore(p) {
    const idx = state.items.findIndex((i) => i.path === p);
    if (idx < 0) return false;
    if (fs.existsSync(p)) {
      try {
        await attrib('-h', p);
      } catch (e) {
        console.warn('geri çıkarılamadı', p, e.message);
        return false;
      }
    }
    state.items.splice(idx, 1);
    saveState();
    return true;
  }
  async function restoreAll() {
    for (const it of [...state.items]) await restore(it.path);
    if (win && !win.isDestroyed()) win.webContents.send('command', 'items-cleared');
  }

  ipcMain.handle('restore-item', (_e, p) => restore(p));
  ipcMain.handle('open-item', (_e, p) => {
    if (state.items.some((i) => i.path === p)) return shell.openPath(p);
    return 'bilinmeyen öğe';
  });
  ipcMain.on('move-item', (_e, p, x, y) => {
    const it = state.items.find((i) => i.path === p);
    if (it && Number.isFinite(x) && Number.isFinite(y)) {
      it.x = x;
      it.y = y;
      saveState();
    }
  });
  ipcMain.on('save-rug', (_e, rug) => {
    state.rug = rug;
    saveState();
  });
  ipcMain.on('interactive', (_e, on) => {
    if (win && !win.isDestroyed()) win.setIgnoreMouseEvents(!on);
  });

  function popup(template) {
    return new Promise((resolve) => {
      let chosen = null;
      const menu = Menu.buildFromTemplate(
        template.map((t) => (t.type ? t : { ...t, click: () => (chosen = t.id) }))
      );
      menu.popup({ window: win, callback: () => setTimeout(() => resolve(chosen), 0) });
    });
  }
  ipcMain.handle('item-menu', () =>
    popup([
      { id: 'restore', label: 'Masaüstüne geri çıkar' },
      { id: 'open', label: 'Aç' },
    ])
  );
  ipcMain.handle('rug-menu', async () => {
    const id = await popup(rugMenuTemplate());
    return handleRugCommand(id);
  });

  function rugMenuTemplate() {
    const login = app.getLoginItemSettings(loginArgs());
    return [
      { id: 'flatten', label: 'Halıyı düzelt' },
      { id: 'restore-all', label: 'Altındakilerin hepsini geri çıkar', enabled: state.items.length > 0 },
      { type: 'separator' },
      { id: 'login', label: 'Windows açılınca başlat', type: 'checkbox', checked: login.openAtLogin },
      { type: 'separator' },
      { id: 'quit', label: 'Kapat' },
    ];
  }
  function loginArgs() {
    return app.isPackaged ? {} : { path: process.execPath, args: [path.resolve(__dirname)] };
  }
  async function handleRugCommand(id) {
    if (id === 'restore-all') await restoreAll();
    else if (id === 'login') {
      const cur = app.getLoginItemSettings(loginArgs()).openAtLogin;
      app.setLoginItemSettings({ openAtLogin: !cur, ...loginArgs() });
    } else if (id === 'quit') {
      quitting = true;
      app.quit();
    } else if (id === 'flatten' && win && !win.isDestroyed()) win.webContents.send('command', 'flatten');
    return id;
  }

  // ---------- pencere
  function createWindow() {
    const area = screen.getPrimaryDisplay().workArea;
    win = new BrowserWindow({
      x: area.x,
      y: area.y,
      width: area.width,
      height: area.height,
      type: 'toolbar', // görev çubuğunda ve Alt+Tab'da görünmesin
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      show: false,
      title: 'Halı',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    win.setIgnoreMouseEvents(true);
    win.loadFile(path.join(__dirname, 'src', 'index.html'));
    win.once('ready-to-show', () => {
      win.showInactive();
      sendToBottom();
    });
    // Tıklanınca öne gelmesin: hemen masaüstünün üstüne geri it
    win.on('focus', sendToBottom);
    win.on('show', sendToBottom);
    win.on('closed', () => {
      win = null;
      if (!quitting) setTimeout(createWindow, 1500);
    });
    win.webContents.on('render-process-gone', () => {
      if (!quitting && win) win.reload();
    });
    if (process.env.HALI_SCRIPT) {
      win.webContents.on('console-message', (e) => console.log('[renderer]', e.message));
      win.webContents.once('did-finish-load', () => require(path.resolve(process.env.HALI_SCRIPT))(win, app));
    }
  }

  function fitToScreen() {
    if (!win || win.isDestroyed()) return;
    const area = screen.getPrimaryDisplay().workArea;
    win.setBounds(area);
  }

  app.whenReady().then(() => {
    loadState();
    createWindow();

    // İmleci izle: oluşturucu, imlecin altında halı var mı diye bakıp tıklanabilirliği ayarlar.
    // (Dosya sürüklenirken de çalışır; böylece halının üstüne bırakılabilir.)
    setInterval(() => {
      if (!win || win.isDestroyed()) return;
      const pt = screen.getCursorScreenPoint();
      const b = win.getBounds();
      const x = pt.x - b.x;
      const y = pt.y - b.y;
      if (x !== lastCursor.x || y !== lastCursor.y) {
        lastCursor = { x, y };
        win.webContents.send('cursor', lastCursor);
      }
    }, 16);
    setInterval(sendToBottom, 1500);

    screen.on('display-metrics-changed', fitToScreen);
    screen.on('display-added', fitToScreen);
    screen.on('display-removed', fitToScreen);

    const icon = nativeImage.createFromPath(path.join(__dirname, 'src', 'hali.jpg')).resize({ width: 16, height: 16 });
    tray = new Tray(icon);
    tray.setToolTip('Halı');
    const rebuildTray = () =>
      tray.setContextMenu(
        Menu.buildFromTemplate(rugMenuTemplate().map((t) => (t.type === 'separator' ? t : { ...t, click: () => handleRugCommand(t.id).then(rebuildTray) })))
      );
    rebuildTray();
    tray.on('right-click', rebuildTray);
  });

  app.on('second-instance', async (_e, argv) => {
    if (!win || win.isDestroyed()) return;
    // Teşhis: `electron . --hali-shot=<dosya.png>` çalışan halının kendi penceresinin görüntüsünü
    // ve durum özetini yazar (yalnızca halı penceresi, ekranın geri kalanı değil)
    const arg = argv.find((a) => a.startsWith('--hali-shot='));
    if (arg) {
      const out = arg.slice('--hali-shot='.length);
      const img = await win.webContents.capturePage();
      fs.writeFileSync(out, img.toPNG());
      const dbg = await win.webContents.executeJavaScript('window.__haliDebug ? window.__haliDebug() : null');
      fs.writeFileSync(out.replace(/\.png$/i, '') + '.json', JSON.stringify(dbg, null, 1));
      return;
    }
    win.webContents.send('command', 'flatten');
  });
  app.on('before-quit', () => {
    quitting = true;
    clearTimeout(saveTimer);
    writeState();
  });
  app.on('window-all-closed', () => {
    /* pencere yeniden açılır; çıkış sadece menüden */
  });
}
