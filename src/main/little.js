// Petite fenêtre (⌥⌘N) : une page seule, sans barre latérale, pour un coup
// d'œil rapide. Un bouton l'envoie dans la fenêtre principale.
const { BaseWindow, WebContentsView, clipboard, Menu } = require('electron');
const { store } = require('./store');
const sessions = require('./sessions');
const suggest = require('./suggest');
const { trusted, UI_PRELOAD, INTERNAL } = require('./window');

const BAR = 42;
const PAD = 6;
const littles = new Map(); // id webContents de la barre -> LittleWindow
const hooks = { openInOrbe: () => {}, profileId: () => 'default', spaces: () => [] };

class LittleWindow {
  static ownerOf(wc) { return littles.get(wc.id) || null; }

  constructor(input) {
    // Même profil (cookies, connexions) que l'Espace affiché à l'ouverture.
    this.profileId = hooks.profileId();
    this.url = input ? suggest.resolve(input) : '';
    this.title = '';
    this.loading = false;
    this.win = new BaseWindow({
      width: 860,
      height: 640,
      minWidth: 380,
      minHeight: 260,
      titleBarStyle: 'hidden',
      trafficLightPosition: { x: 14, y: 13 },
      vibrancy: 'sidebar',
      backgroundColor: '#00000000',
    });
    this.win.orbeLittle = this;
    this.ui = new WebContentsView({ webPreferences: { preload: UI_PRELOAD, sandbox: true, contextIsolation: true } });
    this.ui.setBackgroundColor('#00000000');
    trusted.add(this.ui.webContents);
    littles.set(this.ui.webContents.id, this);
    this.uiId = this.ui.webContents.id;
    this.win.contentView.addChildView(this.ui);
    this.ui.webContents.loadURL(INTERNAL + 'little.html');
    this.ui.webContents.once('did-finish-load', () => { this.send(); if (!this.url) this.ui.webContents.focus(); });
    this.win.on('resize', () => this.layout());
    this.win.on('closed', () => {
      littles.delete(this.uiId);
      for (const v of [this.ui, this.view]) if (v && !v.webContents.isDestroyed()) v.webContents.close();
    });
    if (this.url) this.load(this.url);
    this.layout();
  }

  layout() {
    const [W, H] = this.win.getContentSize();
    this.ui.setBounds({ x: 0, y: 0, width: W, height: H });
    if (this.view) this.view.setBounds({ x: PAD, y: BAR, width: W - 2 * PAD, height: H - BAR - PAD });
  }

  load(input) {
    const url = suggest.resolve(input);
    this.url = url;
    if (!this.view) {
      this.view = new WebContentsView({ webPreferences: { session: sessions.profileSession(this.profileId), sandbox: true, contextIsolation: true } });
      this.view.setBackgroundColor('#ffffff');
      this.view.setBorderRadius(9);
      this.win.contentView.addChildView(this.view);
      const wc = this.view.webContents;
      wc.on('did-start-loading', () => { this.loading = true; this.send(); });
      wc.on('did-stop-loading', () => { this.loading = false; this.send(); });
      wc.on('page-title-updated', (e, title) => { this.title = title; this.send(); });
      const nav = (u) => { this.url = u; store.visit(u, this.title, ''); this.send(); };
      wc.on('did-navigate', (e, u) => nav(u));
      wc.on('did-navigate-in-page', (e, u, main) => { if (main) nav(u); });
      wc.on('will-prevent-unload', (e) => e.preventDefault());
      wc.setWindowOpenHandler((d) => { if (/^https?:/i.test(d.url)) hooks.openInOrbe(d.url); return { action: 'deny' }; });
      this.layout();
    }
    this.view.webContents.loadURL(url).catch(() => {});
    this.view.webContents.focus();
    this.send();
  }

  send() {
    if (this.ui.webContents.isDestroyed()) return;
    const s = store.state.settings;
    this.ui.webContents.send('state', { lang: s.lang, appearance: s.appearance, url: this.url, title: this.title, loading: this.loading });
  }

  // « Ouvrir dans… » : choix de l'Espace de destination (⌥⌘O dans Arc).
  openInMenu() {
    if (!this.url) return;
    const items = hooks.spaces().map((sp) => ({
      label: `${sp.icon}  ${sp.name}`,
      click: () => { hooks.openInOrbe(this.url, sp.id); this.win.close(); },
    }));
    if (items.length) Menu.buildFromTemplate(items).popup({ window: this.win });
  }

  openInOrbe() {
    if (!this.url) return;
    hooks.openInOrbe(this.url);
    this.win.close();
  }

  handle(action, a) {
    if (action === 'ready') return this.send();
    if (action === 'navigate') return this.load(String(a));
    if (action === 'openInOrbe') return this.openInOrbe();
    if (action === 'openInMenu') return this.openInMenu();
    return undefined;
  }

  // Raccourcis du menu applicables à une petite fenêtre.
  run(name) {
    const wc = this.view && this.view.webContents;
    switch (name) {
      case 'commandBar': case 'newTab': this.ui.webContents.focus(); this.ui.webContents.send('edit'); return true;
      case 'reload': if (wc) wc.reload(); return true;
      case 'forceReload': if (wc) wc.reloadIgnoringCache(); return true;
      case 'back': if (wc) wc.navigationHistory.goBack(); return true;
      case 'forward': if (wc) wc.navigationHistory.goForward(); return true;
      case 'copyUrl': if (this.url) clipboard.writeText(this.url); return true;
      case 'devtools': if (wc) wc.toggleDevTools(); return true;
      case 'zoomIn': if (wc) wc.setZoomLevel(wc.getZoomLevel() + 0.5); return true;
      case 'zoomOut': if (wc) wc.setZoomLevel(wc.getZoomLevel() - 0.5); return true;
      case 'actualSize': if (wc) wc.setZoomLevel(0); return true;
      case 'print': if (wc) wc.print(); return true;
      // Comme dans Arc : ⌘O envoie la page dans la fenêtre principale.
      case 'expandPeek': case 'togglePin': this.openInOrbe(); return true;
      case 'openInSpace': this.openInMenu(); return true;
      default: return false;
    }
  }
}

module.exports = { LittleWindow, hooks };
