// Point d'entrée d'Orbe.
const { app, ipcMain, BrowserWindow, nativeTheme, shell, webContents, dialog, net } = require('electron');
const { pathToFileURL } = require('url');
const path = require('path');
const os = require('os');
const fs = require('fs');
const locales = require('../shared/locales');
const { store } = require('./store');
const sessions = require('./sessions');
const suggest = require('./suggest');
const win = require('./window');
const { OrbeWindow, trusted, INTERNAL, UI_PRELOAD } = win;
const little = require('./little');
const commands = require('./commands');
const menu = require('./menu');
const adblock = require('./adblock');
const extensions = require('./extensions');

const SELFTEST = process.argv.includes('--selftest');
const pendingUrls = [];
let settingsWindow = null;

app.setName('Orbe');
// Profil de données isolé : pour les tests, ou via ORBE_USER_DATA.
if (process.env.ORBE_USER_DATA) app.setPath('userData', path.resolve(process.env.ORBE_USER_DATA));
else if (SELFTEST) app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'orbe-test-')));
// En test, rien n'est écrit dans le vrai dossier Téléchargements.
if (SELFTEST) {
  const dl = path.join(app.getPath('userData'), 'Telechargements');
  fs.mkdirSync(dl, { recursive: true });
  app.setPath('downloads', dl);
}
sessions.registerScheme();

if (!SELFTEST && !process.env.ORBE_USER_DATA && !app.requestSingleInstanceLock()) app.quit();

function openUrl(url) {
  if (!app.isReady()) return pendingUrls.push(url);
  if (store.state.settings.externalLinks === 'little' && !openUrl.direct) return new little.LittleWindow(url);
  let w = OrbeWindow.primary;
  if (!w) w = new OrbeWindow();
  w.newTab(url);
  if (w.win.isMinimized()) w.win.restore();
  w.win.focus();
  return undefined;
}

function newWindow(opts = {}) {
  return new OrbeWindow(opts);
}

function openSettings() {
  if (settingsWindow && !settingsWindow.isDestroyed()) return settingsWindow.focus();
  settingsWindow = new BrowserWindow({
    width: 620,
    height: 640,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    titleBarStyle: 'hiddenInset',
    vibrancy: 'sidebar',
    backgroundColor: '#00000000',
    show: false,
    webPreferences: { preload: UI_PRELOAD, sandbox: true, contextIsolation: true },
  });
  trusted.add(settingsWindow.webContents);
  settingsWindow.webContents.on('will-navigate', (e) => e.preventDefault());
  settingsWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  settingsWindow.loadURL(INTERNAL + 'settings.html');
  settingsWindow.once('ready-to-show', () => settingsWindow.show());
  return settingsWindow;
}

function applyAppearance() {
  const a = store.state.settings.appearance;
  nativeTheme.themeSource = a === 'auto' ? 'system' : a;
}

function broadcastSettings() {
  applyAppearance();
  if (adblock.isEnabled() !== store.state.settings.adblock) adblock.setEnabled(store.state.settings.adblock);
  for (const wc of webContents.getAllWebContents()) {
    if (trusted.has(wc) && !wc.isDestroyed()) wc.send('settings', store.state.settings);
  }
  for (const w of OrbeWindow.all) w.layout();
  OrbeWindow.pushAll();
  menu.refresh(true);
}

const SETTABLE = {
  lang: (v) => v === 'fr' || v === 'en',
  searchEngine: (v) => Object.prototype.hasOwnProperty.call(suggest.ENGINES, v),
  suggestions: (v) => typeof v === 'boolean',
  archiveAfterHours: (v) => [0, 12, 24, 168, 720].includes(v),
  appearance: (v) => ['auto', 'light', 'dark'].includes(v),
  translucent: (v) => typeof v === 'boolean',
  maxLiveTabs: (v) => Number.isInteger(v) && v >= 4 && v <= 60,
  externalLinks: (v) => v === 'window' || v === 'little',
  autoPip: (v) => typeof v === 'boolean',
  adblock: (v) => typeof v === 'boolean',
};

function profileList() {
  const s = store.state;
  return s.profiles.map((p) => ({ id: p.id, name: p.name, spaces: s.spaces.filter((sp) => sp.profileId === p.id).map((sp) => `${sp.icon} ${sp.name}`) }));
}

function extensionList() {
  return extensions.list().map((x) => ({
    id: x.id, name: x.name, version: x.version, description: (x.description || '').slice(0, 160),
    enabled: extensions.isEnabled(x.id), popup: !!extensions.popupFor(x.id),
  }));
}

function shortcutGroups() {
  const t = (k) => store.t(k);
  const group = (title, names, extra = []) => ({
    title,
    items: [...names.map((n) => commands.byName.get(n)).filter((c) => c && c.keys).map((c) => ({ label: t(c.label), keys: c.keys })), ...extra],
  });
  const fr = store.state.settings.lang === 'fr';
  return [
    group(t('menu.tabs'), ['newTab', 'commandBar', 'closeTab', 'reopen', 'togglePin', 'nextTab', 'prevTab', 'clearToday'], [
      { label: fr ? 'Aller à l’onglet 1 à 9' : 'Go to tab 1 to 9', keys: '⌘1 … ⌘9' },
      { label: fr ? 'Onglets récents (maintenir ⌃)' : 'Recent tabs (hold ⌃)', keys: '⌃⇥' },
    ]),
    group(t('menu.spaces'), ['nextSpace', 'prevSpace'], [{ label: fr ? 'Aller à l’Espace 1 à 9' : 'Go to Space 1 to 9', keys: '⌃1 … ⌃9' }]),
    group(t('menu.window'), ['newWindow', 'newIncognito', 'newLittle', 'closeWindow', 'toggleSidebar', 'toggleToolbar', 'addSplit', 'closeSplit', 'fullscreen', 'library', 'downloads', 'settings']),
    group(fr ? 'Page' : 'Page', ['back', 'forward', 'reload', 'forceReload', 'stop', 'find', 'findNext', 'findPrev', 'copyUrl', 'copyUrlMarkdown', 'capture', 'savePage', 'print', 'zoomIn', 'zoomOut', 'actualSize', 'history']),
    group(t('view.developer'), ['devtools', 'inspect', 'console', 'source']),
  ];
}

async function globalAction(action, a, sender) {
  const s = store.state;
  switch (action) {
    case 'lib:get': {
      const q = String((a && a.q) || '').toLowerCase();
      const match = (x) => !q || (x.title || '').toLowerCase().includes(q) || (x.url || x.name || '').toLowerCase().includes(q);
      return {
        history: Object.values(s.history).filter(match).sort((x, y) => y.last - x.last).slice(0, 400)
          .map((h) => ({ url: h.url, title: h.title || h.url, favicon: h.favicon || '', at: h.last })),
        archive: s.archive.filter(match).slice(0, 400),
        downloads: s.downloads.filter(match).slice(0, 200).map((d) => ({ ...d, exists: d.state === 'completed' && fs.existsSync(d.path) })),
      };
    }
    case 'lib:clear':
      if (a === 'history') { s.history = {}; store.historyCount = 0; }
      if (a === 'archive') s.archive = [];
      if (a === 'downloads') s.downloads = s.downloads.filter((d) => d.state === 'progressing');
      store.save();
      return true;
    case 'lib:reveal': {
      const d = s.downloads.find((x) => x.id === a);
      if (d) shell.showItemInFolder(d.path);
      return true;
    }
    case 'lib:openFile': {
      const d = s.downloads.find((x) => x.id === a);
      if (d) shell.openPath(d.path);
      return true;
    }
    case 'ext:list':
      return extensionList();
    case 'ext:install': {
      const id = extensions.parseStoreInput(String(a || ''));
      if (!id) return { error: store.t('ext.badUrl') };
      try { await extensions.install(id); } catch (err) { return { error: `${store.t('ext.failed')} (${err.code || err.message})` }; }
      return { list: extensionList() };
    }
    case 'ext:remove':
      await extensions.remove(String(a)).catch(() => {});
      return extensionList();
    case 'ext:toggle':
      extensions.setEnabled(String(a.id), !!a.enabled);
      return extensionList();
    case 'ext:popup': {
      const p = extensions.popupFor(String(a));
      if (!p) return false;
      const w = new BrowserWindow({ width: 400, height: 600, title: p.title, webPreferences: { session: sessions.mainSession(), sandbox: true, contextIsolation: true } });
      w.loadURL(p.url).catch(() => {});
      return true;
    }
    case 'shortcuts:get':
      return shortcutGroups();
    case 'settings:get':
      return { settings: s.settings, profiles: profileList(), engines: Object.entries(suggest.ENGINES).map(([id, e]) => ({ id, name: e.name })), version: app.getVersion(), chrome: process.versions.chrome };
    case 'settings:set':
      for (const [k, v] of Object.entries(a || {})) if (Object.hasOwn(SETTABLE, k) && SETTABLE[k](v)) s.settings[k] = v;
      store.save();
      broadcastSettings();
      return s.settings;
    case 'settings:renameProfile': {
      const p = s.profiles.find((x) => x.id === (a && a.id));
      const name = String((a && a.name) || '').trim().slice(0, 40);
      if (p && name) { p.name = name; store.save(); menu.refresh(true); }
      return profileList();
    }
    case 'settings:deleteProfile':
      if (OrbeWindow.deleteProfile(String(a))) menu.refresh(true);
      return profileList();
    case 'settings:makeDefault':
      commands.makeDefault();
      return true;
    case 'settings:resetPerms':
      for (const k of Object.keys(s.permissions)) delete s.permissions[k];
      store.save();
      return true;
    case 'settings:clearData': {
      const parent = BrowserWindow.fromWebContents(sender);
      const r = await dialog.showMessageBox(parent, {
        type: 'warning',
        message: store.t('set.clearData').replace('…', ' ?'),
        detail: store.t('set.clearDataHint'),
        buttons: [store.t('set.clearData').replace('…', ''), store.t('edit.undo')],
        defaultId: 1,
        cancelId: 1,
      });
      if (r.response !== 0) return false;
      for (const p of s.profiles) {
        const ses = sessions.profileSession(p.id);
        await ses.clearStorageData();
        await ses.clearCache();
      }
      s.history = {};
      store.historyCount = 0;
      store.save();
      return true;
    }
    default:
      return undefined;
  }
}

function setupIpc() {
  const ok = (e) => trusted.has(e.sender) && e.senderFrame && e.senderFrame.url.startsWith(INTERNAL);
  ipcMain.on('i18n', (e) => {
    e.returnValue = ok(e) ? { locales, lang: store.state.settings.lang, settings: store.state.settings } : null;
  });
  ipcMain.handle('orbe', async (e, action, payload) => {
    if (!ok(e) || typeof action !== 'string') return undefined;
    if (action === 'welcome:info') return { arc: require('./import-arc').available() };
    if (/^(lib|settings|shortcuts|ext):/.test(action)) return globalAction(action, payload, e.sender);
    const owner = OrbeWindow.ownerOf(e.sender) || little.LittleWindow.ownerOf(e.sender) || OrbeWindow.primary;
    return owner ? owner.handle(action, payload) : undefined;
  });
}

app.on('open-url', (e, url) => { e.preventDefault(); openUrl(url); });
app.on('open-file', (e, file) => { e.preventDefault(); openUrl(pathToFileURL(file).href); });
app.on('second-instance', (e, argv) => {
  const url = argv.find((x) => /^https?:\/\//i.test(x));
  if (url) openUrl(url);
  else if (OrbeWindow.primary) OrbeWindow.primary.win.focus();
});

app.whenReady().then(async () => {
  store.load(app.getPath('userData'));
  const firstRun = !Object.keys(store.state.tabs).length && !Object.keys(store.state.history).length;
  applyAppearance();
  extensions.configure({ dir: path.join(app.getPath('userData'), 'Extensions'), fetch: (u, o) => net.fetch(u, o), lang: store.state.settings.lang });
  adblock.configure({
    enabled: store.state.settings.adblock,
    allowlist: store.state.settings.adblockAllow,
    onChange: ({ enabled, allowlist }) => {
      store.state.settings.adblock = enabled;
      store.state.settings.adblockAllow = allowlist;
      store.save();
    },
    onCount: () => OrbeWindow.pushAll(),
  });
  // Liste chargée peu après le démarrage, pour ne pas le ralentir.
  setTimeout(() => adblock.load(), 1200);
  sessions.setupDefaultSession();
  setupIpc();

  commands.hooks.newWindow = newWindow;
  commands.hooks.newLittle = (url) => new little.LittleWindow(url);
  commands.hooks.openSettings = openSettings;
  commands.hooks.settingsChanged = broadcastSettings;
  win.hooks.openLittle = (url) => new little.LittleWindow(url);
  win.hooks.changed = () => menu.refresh();
  little.hooks.openInOrbe = (url) => { openUrl.direct = true; try { openUrl(url); } finally { openUrl.direct = false; } };
  sessions.hooks.ownerWindow = (wc) => { const o = wc && OrbeWindow.ownerOf(wc); return o ? o.win : null; };
  sessions.hooks.onDownload = (phase, d, wc) => {
    const owner = (wc && OrbeWindow.ownerOf(wc)) || OrbeWindow.primary;
    if (owner && phase === 'start') owner.toast(store.t('toast.downloadStarted', null, { name: d.name }));
    if (owner && phase === 'done' && d.state === 'completed') owner.toast(store.t('toast.downloadDone', null, { name: d.name }));
    OrbeWindow.pushAll();
  };
  nativeTheme.on('updated', () => OrbeWindow.pushAll());

  app.setAboutPanelOptions({ applicationName: 'Orbe', applicationVersion: app.getVersion(), copyright: 'Logiciel libre — licence MIT', credits: `Chromium ${process.versions.chrome}` });
  menu.build();

  const first = newWindow();
  if (firstRun && !SELFTEST && !process.env.ORBE_NO_WELCOME) first.openInternal('welcome.html');
  for (const url of pendingUrls.splice(0)) openUrl(url);

  setTimeout(win.archiveStale, 30e3);
  setInterval(win.archiveStale, 10 * 60e3);

  if (SELFTEST) {
    try {
      // ORBE_SCENARIO : autre scénario de test (ex. tests/sites.js, sites réels).
      await require(process.env.ORBE_SCENARIO ? path.resolve(process.env.ORBE_SCENARIO) : '../../tests/selftest')({ first, OrbeWindow, store, win, little, commands, menu, openSettings });
      store.flush();
      app.exit(0);
    } catch (err) {
      console.error('\nÉCHEC', err);
      app.exit(1);
    }
  }
});

app.on('activate', () => {
  if (!OrbeWindow.all.length) newWindow();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => store.flush());
app.on('web-contents-created', (e, wc) => {
  // Aucune page web ne doit pouvoir ouvrir une <webview>.
  wc.on('will-attach-webview', (ev) => ev.preventDefault());
});
