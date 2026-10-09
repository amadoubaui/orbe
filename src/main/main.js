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
const extApi = require('./ext-api');
const extHost = require('./ext-host');
const boosts = require('./boosts');
const passwords = require('./passwords');
const easels = require('./easels');
const platform = require('./platform');
const essentials = require('./essentials');
const downloads = require('./downloads');
const prefs = require('./prefs');
const shortcuts = require('./shortcuts');
const panes = require('./panes');

platform.adaptLocales(locales);

// Mode test (--selftest, ORBE_SCENARIO, trousseau factice) : réservé au
// lancement depuis les sources. L'application fabriquée ne l'accepte qu'avec
// --orbe-test ET un dossier de données à part (essai de fumée de l'intégration
// continue) : jamais sur le vrai profil.
function testModeAllowed() {
  if (!app.isPackaged) return true;
  if (!process.argv.includes('--orbe-test') || !process.env.ORBE_USER_DATA) return false;
  const real = path.resolve(app.getPath('userData'));
  const asked = path.resolve(process.env.ORBE_USER_DATA);
  return asked !== real && !asked.startsWith(real + path.sep);
}
const pendingUrls = [];

app.setName('Orbe');
const SELFTEST = process.argv.includes('--selftest') && testModeAllowed();
if (process.argv.includes('--selftest') && !SELFTEST) {
  console.error('[orbe] --selftest refusé : application fabriquée, sans --orbe-test ni ORBE_USER_DATA à part');
  process.exit(2);
}
// Profil de données isolé : pour les tests, ou via ORBE_USER_DATA.
if (process.env.ORBE_USER_DATA) app.setPath('userData', path.resolve(process.env.ORBE_USER_DATA));
else if (SELFTEST) app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'orbe-test-')));
// En test, rien n'est écrit dans le vrai dossier Téléchargements.
if (SELFTEST) {
  // Les tests ne touchent jamais au vrai trousseau du système.
  app.commandLine.appendSwitch('use-mock-keychain');
  // Caméra et micro factices : aucun vrai appareil n'est ouvert pendant les tests.
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
  const dl = path.join(app.getPath('userData'), 'Telechargements');
  fs.mkdirSync(dl, { recursive: true });
  app.setPath('downloads', dl);
}
sessions.registerScheme();
// Hors macOS, un lien ouvert avec Orbe arrive en argument de la ligne de commande.
if (!platform.isMac) for (const x of process.argv.slice(1)) if (/^https?:\/\//i.test(x)) pendingUrls.push(x);

if (!SELFTEST && !process.env.ORBE_USER_DATA && !app.requestSingleInstanceLock()) app.quit();

function openUrl(url) {
  if (!app.isReady()) return pendingUrls.push(url);
  // Aiguillage (comme Air Traffic Control dans Arc) : la première règle dont le
  // texte figure dans l'adresse décide de l'Espace, ou de la petite fenêtre.
  let target = null;
  if (!openUrl.direct) {
    const rule = (store.state.settings.routes || []).find((r) => r.match && url.toLowerCase().includes(r.match.toLowerCase()));
    const ext = store.state.settings.externalLinks;
    // Sans règle : petite fenêtre, Espace précis (« space:<id> »), ou l'Espace affiché.
    target = rule ? rule.to : (ext === 'little' ? 'little' : (String(ext).startsWith('space:') ? ext.slice(6) : null));
  }
  if (target === 'little') return new little.LittleWindow(url);
  let w = OrbeWindow.primary;
  if (!w) w = new OrbeWindow();
  if (target && store.state.spaces.some((sp) => sp.id === target)) w.switchSpace(target);
  w.newTab(url);
  if (w.win.isMinimized()) w.win.restore();
  w.win.focus();
  return undefined;
}

function newWindow(opts = {}) {
  return new OrbeWindow(opts);
}

// Fenêtre des réglages, à volets (src/main/panes.js). `pane` : volet à afficher.
function openSettings(pane) {
  return panes.open(pane);
}

// Éditeur de Boost : petite fenêtre liée à l'onglet actif au moment de l'ouverture.
let boostWindow = null;
let boostTarget = null;
function openBoost(w) {
  const rt = w && w.activeRt;
  if (!rt || w.incognito || !boosts.hostOf(rt.wc.getURL())) return;
  boostTarget = rt.wc;
  if (boostWindow && !boostWindow.isDestroyed()) { boostWindow.webContents.reload(); return boostWindow.focus(); }
  boostWindow = new BrowserWindow({
    width: 380, height: 460, minWidth: 300, minHeight: 320, ...platform.windowChrome({ inset: true, dark: nativeTheme.shouldUseDarkColors }),
    alwaysOnTop: true, fullscreenable: false, webPreferences: { preload: UI_PRELOAD, sandbox: true, contextIsolation: true },
  });
  trusted.add(boostWindow.webContents);
  boostWindow.webContents.on('will-navigate', (e) => e.preventDefault());
  boostWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  boostWindow.loadURL(INTERNAL + 'boost.html');
  return boostWindow;
}

async function boostAction(action, a) {
  const wc = boostTarget && !boostTarget.isDestroyed() ? boostTarget : null;
  const host = wc ? boosts.hostOf(wc.getURL()) : '';
  if (!host) return null;
  if (action === 'boost:set') { boosts.set(host, a || {}); await boosts.apply(wc); }
  if (action === 'boost:zap') { wc.focus(); await boosts.zap(wc); if (boostWindow && !boostWindow.isDestroyed()) boostWindow.focus(); }
  return { host, ...boosts.get(host) };
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
  panes.settingsChanged();
  for (const w of OrbeWindow.all) w.layout();
  OrbeWindow.pushAll();
  menu.refresh(true);
}

const SETTABLE = {
  ...prefs.SETTABLE,
  lang: (v) => v === 'fr' || v === 'en',
  searchEngine: (v) => Object.prototype.hasOwnProperty.call(suggest.ENGINES, v),
  suggestions: (v) => typeof v === 'boolean',
  archiveAfterHours: (v) => [0, 12, 24, 168, 720].includes(v),
  appearance: (v) => ['auto', 'light', 'dark'].includes(v),
  translucent: (v) => typeof v === 'boolean',
  maxLiveTabs: (v) => Number.isInteger(v) && v >= 4 && v <= 60,
  externalLinks: prefs.externalLinks,
  autoPip: (v) => typeof v === 'boolean',
  sounds: (v) => typeof v === 'boolean',
  soundVolume: (v) => Number.isInteger(v) && v >= 0 && v <= 100,
  soundGestures: (v) => typeof v === 'boolean',
  adblock: (v) => typeof v === 'boolean',
  peekLinks: (v) => typeof v === 'boolean',
  passwordSave: (v) => typeof v === 'boolean',
  passwordFill: (v) => typeof v === 'boolean',
  routes: (v) => Array.isArray(v) && v.length <= 100 && v.every((r) => r && typeof r.match === 'string' && r.match.length <= 200 && typeof r.to === 'string' && r.to.length <= 40),
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
    items: [...names.map((n) => commands.byName.get(n)).filter((c) => c && shortcuts.keysOf(c.name)).map((c) => ({ label: t(c.label), keys: shortcuts.keysOf(c.name) })), ...extra],
  });
  const fr = store.state.settings.lang === 'fr';
  return [
    group(t('menu.tabs'), ['newTab', 'commandBar', 'closeTab', 'reopen', 'togglePin', 'nextTab', 'prevTab', 'clearToday'], [
      { label: fr ? 'Aller à l’onglet 1 à 9' : 'Go to tab 1 to 9', keys: platform.keys('⌘1 … ⌘9') },
      { label: platform.keys(fr ? 'Onglets récents (maintenir ⌃)' : 'Recent tabs (hold ⌃)'), keys: platform.keys('⌃⇥') },
    ]),
    group(t('menu.spaces'), ['nextSpace', 'prevSpace'], [{ label: fr ? 'Aller à l’Espace 1 à 9' : 'Go to Space 1 to 9', keys: platform.keys('⌃1 … ⌃9') }]),
    group(t('menu.window'), ['newWindow', 'newIncognito', 'newLittle', 'closeWindow', 'toggleSidebar', 'toggleToolbar', 'addSplit', 'closeSplit', 'fullscreen', 'library', 'downloads', 'newEasel', 'settings']),
    group(fr ? 'Page' : 'Page', ['back', 'forward', 'reload', 'forceReload', 'stop', 'find', 'findNext', 'findPrev', 'copyUrl', 'copyUrlMarkdown', 'capture', 'captureToEasel', 'savePage', 'print', 'zoomIn', 'zoomOut', 'actualSize', 'history']),
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
        // Médias : images, vidéos et sons téléchargés, plus les captures d'Orbe.
        media: s.downloads.filter((d) => d.state === 'completed' && /\.(png|jpe?g|gif|webp|avif|svg|mp4|mov|webm|mp3|wav|m4a)$/i.test(d.name) && match(d)).slice(0, 200)
          .map((d) => ({ ...d, exists: fs.existsSync(d.path) })).filter((d) => d.exists),
      };
    }
    case 'lib:clear':
      if (a === 'history') { s.history = {}; store.historyCount = 0; store.saveHistory(true); }
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
      // Un PDF s'ouvre dans un onglet ; un fichier exécutable demande confirmation.
      return downloads.action('dl:open', a, sender);
    }
    case 'notes:list':
      return s.notes.slice().sort((x, y) => y.at - x.at);
    case 'notes:save': {
      const text = String((a && a.text) || '').slice(0, 200000);
      let note = s.notes.find((n) => n.id === (a && a.id));
      if (!note) { note = { id: require('./store').uid(), text: '', at: Date.now() }; s.notes.push(note); }
      note.text = text;
      note.at = Date.now();
      store.save();
      return note;
    }
    case 'notes:delete':
      s.notes = s.notes.filter((n) => n.id !== a);
      store.save();
      return true;
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
      extApi.forget(String(a));
      return extensionList();
    case 'ext:toggle':
      extensions.setEnabled(String(a.id), !!a.enabled);
      return extensionList();
    // Boutons des extensions pour l'onglet actif : [{ id, name, title, icon, badgeText, badgeColor, badgeTextColor, popup, enabled }].
    case 'ext:actions':
      return extHost.actionsFor(OrbeWindow.ownerOf(sender) || OrbeWindow.primary);
    // Clic sur un bouton : `a` est l'identifiant, ou { id, x, y } pour ancrer la fenêtre surgissante.
    case 'ext:popup': {
      const o = a && typeof a === 'object' ? a : { id: a };
      return !!extHost.openPopup(OrbeWindow.ownerOf(sender) || OrbeWindow.primary, String(o.id), { x: Number(o.x), y: Number(o.y) });
    }
    case 'shortcuts:get':
      return shortcutGroups();
    case 'settings:get':
      return { settings: s.settings, spaces: s.spaces.map((sp) => ({ id: sp.id, name: `${sp.icon} ${sp.name}` })), profiles: profileList(), engines: Object.entries(suggest.ENGINES).map(([id, e]) => ({ id, name: e.name })), version: app.getVersion(), chrome: process.versions.chrome, ...panes.info() };
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
      if (OrbeWindow.deleteProfile(String(a))) { passwords.forgetProfile(String(a)); prefs.forgetProfile(String(a)); essentials.permissions.forgetProfile(String(a)); menu.refresh(true); }
      return profileList();
    case 'settings:makeDefault':
      commands.makeDefault();
      return true;
    case 'settings:resetPerms':
      essentials.permissions.resetAll(); // tous les profils
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
      store.saveHistory(true);
      store.historyCount = 0;
      store.save();
      return true;
    }
    default:
      return panes.handle(action, a, sender);
  }
}

function setupIpc() {
  const ok = (e) => trusted.has(e.sender) && e.senderFrame && e.senderFrame.url.startsWith(INTERNAL);
  ipcMain.on('i18n', (e) => {
    e.returnValue = ok(e) ? { locales, lang: store.state.settings.lang, settings: store.state.settings, platform: platform.name, keys: shortcuts.keysMap(), defaultKeys: shortcuts.defaultKeysMap() } : null;
  });
  ipcMain.handle('orbe', async (e, action, payload) => {
    if (!ok(e) || typeof action !== 'string') return undefined;
    if (action.startsWith('boost:')) return boostAction(action, payload);
    if (action.startsWith('pw:')) return passwords.action(action, payload, e.sender);
    if (action.startsWith('easel:')) return easels.action(action, payload, e.sender);
    if (action.startsWith('sheet:')) return essentials.sheets.action(action, payload, e.sender);
    if (action.startsWith('dl:')) return downloads.action(action, payload, e.sender);
    if (action === 'welcome:info') return { arc: require('./import-arc').available() };
    if (/^(lib|settings|shortcuts|ext|notes):/.test(action)) return globalAction(action, payload, e.sender);
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
  // Moteur avec Widevine (ORBE_DRM) : prépare le module de lecture protégée, sans
  // retarder l'ouverture (premier lancement : téléchargement en arrière-plan).
  const { components } = require('electron');
  if (components) components.whenReady().catch((err) => console.error('[orbe] widevine', err.message));
  applyAppearance();
  extensions.configure({ dir: path.join(app.getPath('userData'), 'Extensions'), fetch: (u, o) => net.fetch(u, o), lang: store.state.settings.lang });
  extApi.configure({ dir: path.join(app.getPath('userData'), 'Extensions') });
  extHost.setup();
  // Feuilles d'onglet, autorisations, certificats, authentification, « quitter la page ? »… (après extHost : mise en page chaînée).
  essentials.setup({ win, sessions, test: SELFTEST });
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
  commands.hooks.openBoost = openBoost;
  commands.hooks.openPasswords = () => passwords.openManager();
  passwords.configure({ trusted, uiPreload: UI_PRELOAD, internal: INTERNAL, toast: (wc, text) => { const o = OrbeWindow.ownerOf(wc); if (o) o.toast(text); } });
  commands.hooks.settingsChanged = broadcastSettings;
  commands.hooks.importBookmarks = (w) => panes.importBookmarks(w && w.win, { profileId: w && !w.incognito ? w.space.profileId : 'default' });
  panes.configure({ broadcast: broadcastSettings, profileList, refreshMenu: () => menu.refresh(true) });
  // Moteur de recherche et suggestions : ceux du profil de l'Espace affiché.
  suggest.hooks.profileId = () => { const w = OrbeWindow.focused || OrbeWindow.primary; return w && !w.incognito ? w.space.profileId : 'default'; };
  win.hooks.openLittle = (url) => new little.LittleWindow(url);
  win.hooks.changed = () => { menu.refresh(); extHost.sync(); passwords.sync(); };
  win.hooks.extensionMenu = (wc, params) => [...extApi.contextMenuItems(wc, params), ...passwords.contextMenuItems(wc, params)];
  extApi.hooks.actionChanged = () => OrbeWindow.pushAll();
  little.hooks.openInOrbe = (url, spaceId) => {
    openUrl.direct = true;
    try {
      const w = OrbeWindow.primary;
      if (w && spaceId) w.switchSpace(spaceId);
      openUrl(url);
    } finally { openUrl.direct = false; }
  };
  little.hooks.profileId = () => { const w = OrbeWindow.primary; return w ? w.space.profileId : 'default'; };
  little.hooks.spaces = () => store.state.spaces.map((sp) => ({ id: sp.id, name: sp.name, icon: sp.icon }));
  sessions.hooks.ownerWindow = (wc) => { const o = wc && OrbeWindow.ownerOf(wc); return o ? o.win : null; };
  sessions.hooks.onDownload = (phase, d, wc) => {
    const owner = (wc && OrbeWindow.ownerOf(wc)) || OrbeWindow.primary;
    if (owner && phase === 'start') owner.toast(store.t('toast.downloadStarted', null, { name: d.name }));
    if (owner && phase === 'done' && d.state === 'completed') owner.toast(store.t(d.danger ? 'toast.downloadDanger' : 'toast.downloadDone', null, { name: d.name }));
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
  setInterval(() => little.LittleWindow.archiveStale(), 10 * 60e3).unref();

  if (SELFTEST) {
    // Garde-fou : un scénario qui n'avance plus s'arrête de lui-même, avec un message.
    const limit = Number(process.env.ORBE_TEST_LIMIT) || 480;
    setTimeout(() => { console.error(`\nÉCHEC : scénario bloqué depuis ${limit} s`); app.exit(3); }, limit * 1000).unref();
    try {
      // ORBE_SCENARIO : autre scénario de test (ex. tests/sites.js, sites réels).
      await require(process.env.ORBE_SCENARIO ? path.resolve(process.env.ORBE_SCENARIO) : '../../tests/selftest')({ first, OrbeWindow, store, win, little, commands, menu, openSettings, openUrl, extensions, extApi, extHost, passwords, panes, prefs, shortcuts, globalAction, essentials });
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
