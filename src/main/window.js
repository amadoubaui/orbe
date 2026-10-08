// Une fenêtre Orbe : une vue « coque » (barre latérale) qui occupe toute la
// fenêtre, les vues web des onglets posées par-dessus dans la zone de contenu,
// et des vues flottantes (barre de commande, recherche, notifications).
const { app, BaseWindow, WebContentsView, Menu, clipboard, ClipboardItem, screen, dialog, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const { store, uid, SPACE_COLORS } = require('./store');
const sessions = require('./sessions');
const suggest = require('./suggest');

const PAD = 8;
const GAP = 8;
const RADIUS = 10;
const TOOLBAR_H = 40;
const TRAFFIC = { x: 15, y: 15 };
const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 420;
const UI_PRELOAD = path.join(__dirname, '../preload/ui.js');
const INTERNAL = 'orbe://app/';

const windows = new Map(); // id BaseWindow -> OrbeWindow
const live = new Map(); // id onglet -> { view, wc, owner, loading, lastUsed }
const trusted = new WeakSet(); // webContents autorisés à parler au processus principal
const wcOwner = new Map(); // id webContents (coque, flottants) -> OrbeWindow
const hooks = { changed: () => {}, openLittle: () => {}, openSettings: () => {} };

const t = (key, vars) => store.t(key, null, vars);
const isInternal = (url) => (url || '').startsWith(INTERNAL);
const isErrorPage = (url) => (url || '').startsWith(INTERNAL + 'error.html');
// Pages internes pouvant s'ouvrir dans un onglet, avec accès à l'interface.
const INTERNAL_PAGES = new Set(['library.html', 'shortcuts.html']);
// Adresse fournie par une page web (lien, image, glisser-déposer) : seuls
// http et https sont acceptés, jamais file:, orbe: ou chrome:.
const webUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : null);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function findNode(nodes, id) {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.id === id) return { arr: nodes, index: i, node: n };
    if (n.type === 'folder') {
      const f = findNode(n.children, id);
      if (f) return f;
    }
  }
  return null;
}

function* walk(nodes) {
  for (const n of nodes) {
    if (n.type === 'folder') yield* walk(n.children);
    else yield n.id;
  }
}

function sameHost(a, b) {
  try { return new URL(a).host.replace(/^www\./, '') === new URL(b).host.replace(/^www\./, ''); } catch { return false; }
}

function samePage(a, b) {
  try {
    const x = new URL(a);
    const y = new URL(b);
    return x.host === y.host && x.pathname === y.pathname;
  } catch {
    return a === b;
  }
}

let pushScheduled = false;

class OrbeWindow {
  static get all() { return [...windows.values()]; }
  static get focused() {
    const f = BaseWindow.getFocusedWindow();
    return (f && windows.get(f.id)) || null;
  }
  static get primary() {
    return OrbeWindow.focused && !OrbeWindow.focused.incognito
      ? OrbeWindow.focused
      : OrbeWindow.all.find((w) => !w.incognito) || null;
  }
  static ownerOf(wc) {
    if (wcOwner.has(wc.id)) return wcOwner.get(wc.id);
    for (const rt of live.values()) if (rt.wc === wc) return rt.owner;
    return null;
  }

  // Regroupe toutes les modifications d'un même tour de boucle en un seul envoi.
  static pushAll() {
    if (pushScheduled) return;
    pushScheduled = true;
    setImmediate(() => {
      pushScheduled = false;
      for (const w of windows.values()) w.sendState();
      hooks.changed();
    });
  }

  constructor({ incognito = false } = {}) {
    this.incognito = incognito;
    const saved = incognito ? {} : store.state.window;
    const first = !OrbeWindow.all.some((w) => !w.incognito);
    this.data = incognito
      ? { spaces: [store.makeSpace(t('incognito.title'), '🕶️', '#52525b')], tabs: {}, favs: { default: [] }, profiles: [{ id: 'default', name: '' }] }
      : store.state;
    this.session = incognito ? sessions.incognitoSession() : sessions.mainSession();
    const restore = !incognito && first;
    this.spaceId = (restore && this.data.spaces.some((s) => s.id === saved.spaceId)) ? saved.spaceId : this.data.spaces[0].id;
    this.activeBySpace = restore ? { ...(saved.activeBySpace || {}) } : {};
    this.splits = [];
    this.closed = [];
    this.sidebarVisible = restore ? saved.sidebarVisible !== false : true;
    this.p = this.sidebarVisible ? 1 : 0; // ouverture de la barre latérale, 0..1
    this.peek = false;
    this.htmlFullscreen = false;
    this.modalMode = null;
    this.findOpen = false;
    this.switcher = null;

    const b = (restore && saved.bounds) || {};
    const offset = first ? 0 : 28 * (OrbeWindow.all.length % 6);
    this.win = new BaseWindow({
      width: b.width || 1360,
      height: b.height || 860,
      x: b.x != null ? b.x + offset : undefined,
      y: b.y != null ? b.y + offset : undefined,
      minWidth: 520,
      minHeight: 360,
      titleBarStyle: 'hidden',
      trafficLightPosition: TRAFFIC,
      vibrancy: 'sidebar',
      visualEffectState: 'followWindow',
      backgroundColor: '#00000000',
      show: false,
    });
    windows.set(this.win.id, this);
    this.id = this.win.id;

    this.ui = this.makeUiView('shell.html');
    this.win.contentView.addChildView(this.ui);
    this.modal = this.makeUiView('overlay.html#modal');
    this.modal.setVisible(false);
    this.win.contentView.addChildView(this.modal);
    this.findView = null;
    this.toastView = null;

    this.win.on('resize', () => this.layout());
    this.win.on('enter-full-screen', () => { this.layout(); OrbeWindow.pushAll(); });
    this.win.on('leave-full-screen', () => { this.layout(); OrbeWindow.pushAll(); });
    this.win.on('focus', () => { this.focusContent(); hooks.changed(); });
    this.win.on('blur', () => { if (this.peek) this.setPeek(false); });
    this.win.on('close', () => this.remember());
    this.win.on('closed', () => this.dispose());
    for (const ev of ['resized', 'moved']) this.win.on(ev, () => this.remember());

    this.syncPeekTimer();
    this.ui.webContents.once('did-finish-load', () => {
      this.layout();
      this.win.show();
      if (process.env.ORBE_TIMING) console.log(`[orbe] fenêtre affichée en ${Math.round(Date.now() - process.getCreationTime())} ms`);
      this.sendState();
      this.focusContent();
    });
    this.layout();
    this.setButtons(this.sidebarVisible);
  }

  // Feux tricolores : masqués avec la barre latérale ; macOS oublie leur
  // position personnalisée quand on les réaffiche.
  setButtons(visible) {
    this.win.setWindowButtonVisibility(visible);
    if (visible) this.win.setWindowButtonPosition(TRAFFIC);
  }

  makeUiView(page) {
    const view = new WebContentsView({ webPreferences: { preload: UI_PRELOAD, sandbox: true, contextIsolation: true } });
    view.setBackgroundColor('#00000000');
    const wc = view.webContents;
    trusted.add(wc);
    wcOwner.set(wc.id, this);
    wc.on('before-input-event', (e, input) => this.onInput(e, input));
    wc.on('will-navigate', (e) => e.preventDefault());
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.loadURL(INTERNAL + page);
    return view;
  }

  // La plus ancienne fenêtre normale encore ouverte mémorise son état.
  get persistent() {
    return !this.incognito && OrbeWindow.all.find((w) => !w.incognito) === this;
  }

  // Retire toute trace d'un onglet (actif, vue scindée, lecteur) dans les
  // fenêtres qui partagent les mêmes données.
  static forget(id, data) {
    for (const w of windows.values()) {
      if (w.data !== data) continue;
      w.leaveSplit(id);
      for (const sid of Object.keys(w.activeBySpace)) if (w.activeBySpace[sid] === id) delete w.activeBySpace[sid];
      if (w.mediaId === id) w.mediaId = null;
    }
  }

  // --- Accès aux données ----------------------------------------------------
  get space() {
    return this.data.spaces.find((s) => s.id === this.spaceId) || this.data.spaces[0];
  }

  get activeId() {
    const id = this.activeBySpace[this.space.id];
    return id && this.data.tabs[id] ? id : null;
  }

  get activeRt() {
    const id = this.activeId;
    return (id && live.get(id)) || null;
  }

  // Page qui reçoit les commandes (actualiser, zoom, recherche…) : l'aperçu
  // s'il est ouvert, sinon l'onglet actif.
  get activeWc() {
    if (this.peekState && !this.peekState.view.webContents.isDestroyed()) return this.peekState.view.webContents;
    const rt = this.activeRt;
    return rt && !rt.wc.isDestroyed() ? rt.wc : null;
  }

  // Favoris du profil de l'Espace affiché.
  get favorites() {
    const favs = this.data.favs;
    const id = this.space.profileId || 'default';
    return favs[id] || (favs[id] = []);
  }

  sessionFor(id) {
    if (this.incognito) return this.session;
    const loc = this.locate(id);
    return sessions.profileSession(loc ? (loc.space ? loc.space.profileId : loc.profileId) : 'default');
  }

  get sidebarWidth() {
    return clamp(store.state.settings.sidebarWidth, SIDEBAR_MIN, SIDEBAR_MAX);
  }

  locate(id) {
    const d = this.data;
    let i;
    for (const profileId of Object.keys(d.favs)) {
      i = d.favs[profileId].indexOf(id);
      if (i >= 0) return { list: 'favorites', arr: d.favs[profileId], index: i, space: null, profileId, node: { type: 'tab', id } };
    }
    for (const space of d.spaces) {
      i = space.today.indexOf(id);
      if (i >= 0) return { list: 'today', arr: space.today, index: i, space, node: { type: 'tab', id } };
      const f = findNode(space.pinned, id);
      if (f) return { list: 'pinned', arr: f.arr, index: f.index, space, node: f.node };
    }
    return null;
  }

  // Ordre d'affichage : favoris, épinglés, puis Aujourd'hui.
  orderedIds(space = this.space) {
    return [...(this.data.favs[space.profileId] || []), ...walk(space.pinned), ...space.today];
  }

  groupOf(id) {
    return this.splits.find((g) => g.includes(id)) || null;
  }

  visibleIds() {
    const id = this.activeId;
    if (!id) return [];
    const group = this.groupOf(id);
    return group ? group.filter((x) => this.data.tabs[x]) : [id];
  }

  changed() {
    if (!this.incognito) store.save();
    OrbeWindow.pushAll();
  }

  // --- Mise en page ---------------------------------------------------------
  contentRect() {
    const [W, H] = this.win.getContentSize();
    if (this.htmlFullscreen) return { x: 0, y: 0, width: W, height: H };
    const sw = this.sidebarWidth;
    const docked = this.sidebarVisible && this.p === 1 && !this.anim;
    const top = PAD + (store.state.settings.showToolbar ? TOOLBAR_H : 0);
    return {
      x: Math.round(PAD + (sw - PAD) * this.p),
      y: top,
      width: Math.max(100, docked ? W - sw - PAD : W - 2 * PAD),
      height: Math.max(100, H - top - PAD),
    };
  }

  layout() {
    if (this.win.isDestroyed()) return;
    const [W, H] = this.win.getContentSize();
    const full = { x: 0, y: 0, width: W, height: H };
    this.ui.setBounds(full);
    const rect = this.contentRect();
    const ids = this.visibleIds();
    const shown = new Set();
    const n = ids.length;
    const paneW = n ? (rect.width - GAP * (n - 1)) / n : 0;
    ids.forEach((id, i) => {
      const rt = this.ensureView(id);
      shown.add(rt.view);
      if (!this.attached || !this.attached.has(rt.view)) this.win.contentView.addChildView(rt.view, 1);
      rt.view.setBorderRadius(this.htmlFullscreen ? 0 : RADIUS);
      rt.view.setBounds({ x: Math.round(rect.x + i * (paneW + GAP)), y: rect.y, width: Math.round(paneW), height: rect.height });
    });
    for (const view of this.attached || []) {
      if (!shown.has(view)) {
        try { this.win.contentView.removeChildView(view); } catch {}
      }
    }
    this.attached = shown;
    if (this.peekState) {
      const m = Math.round(Math.min(90, Math.max(44, rect.width * 0.07)));
      this.peekChrome.setBounds(rect);
      this.peekChrome.setBorderRadius(this.htmlFullscreen ? 0 : RADIUS);
      this.peekState.view.setBounds({ x: rect.x + m, y: rect.y + 16, width: Math.max(200, rect.width - 2 * m), height: Math.max(120, rect.height - 16) });
    }
    if (this.modalMode) this.modal.setBounds(full);
    if (this.findOpen && this.findView) {
      const i = Math.max(0, ids.indexOf(this.activeId));
      const right = rect.x + (i + 1) * paneW + i * GAP;
      this.findView.setBounds({ x: Math.round(right - 372), y: rect.y + 10, width: 360, height: 50 });
    }
    if (this.toastView) {
      this.toastView.setBounds({ x: Math.round(rect.x + rect.width / 2 - 190), y: rect.y + 12, width: 380, height: 46 });
    }
  }

  // Anime l'ouverture de la barre latérale en ne déplaçant que la position des
  // pages : leur largeur ne change qu'une fois, donc une seule remise en page.
  animateTo(target) {
    clearInterval(this.anim);
    const from = this.p;
    if (from === target) { this.anim = null; this.layout(); return; }
    const t0 = Date.now();
    const DUR = 180;
    this.anim = setInterval(() => {
      const k = Math.min(1, (Date.now() - t0) / DUR);
      this.p = from + (target - from) * (1 - Math.pow(1 - k, 3));
      if (k === 1) { clearInterval(this.anim); this.anim = null; this.p = target; }
      if (!this.win.isDestroyed()) this.layout();
    }, 8);
    this.layout();
  }

  toggleSidebar(force) {
    this.sidebarVisible = typeof force === 'boolean' ? force : !this.sidebarVisible;
    this.peek = false;
    this.setButtons(this.sidebarVisible);
    this.animateTo(this.sidebarVisible ? 1 : 0);
    this.syncPeekTimer();
    this.remember();
    OrbeWindow.pushAll();
  }

  // La surveillance du bord gauche ne tourne que barre latérale masquée.
  syncPeekTimer() {
    const needed = !this.sidebarVisible && !this.win.isDestroyed();
    if (needed && !this.peekTimer) this.peekTimer = setInterval(() => this.pollPeek(), 80);
    else if (!needed && this.peekTimer) { clearInterval(this.peekTimer); this.peekTimer = null; }
  }

  setPeek(on) {
    if (this.peek === on || this.sidebarVisible) return;
    this.peek = on;
    this.setButtons(on);
    this.animateTo(on ? 1 : 0);
    OrbeWindow.pushAll();
  }

  pollPeek() {
    if (this.sidebarVisible || this.win.isDestroyed() || !this.win.isFocused() || this.modalMode || this.menuOpen) return;
    const pt = screen.getCursorScreenPoint();
    const b = this.win.getContentBounds();
    const x = pt.x - b.x;
    const y = pt.y - b.y;
    const inside = y >= 0 && y <= b.height;
    if (!this.peek && inside && x >= -2 && x <= 5) this.setPeek(true);
    else if (this.peek && (!inside || x > this.sidebarWidth + 28 || x < -40)) this.setPeek(false);
  }

  setSidebarWidth(w) {
    store.state.settings.sidebarWidth = clamp(Math.round(w), SIDEBAR_MIN, SIDEBAR_MAX);
    store.save();
    for (const win of windows.values()) win.layout();
    OrbeWindow.pushAll();
  }

  remember() {
    if (!this.persistent || this.win.isDestroyed()) return;
    const w = store.state.window;
    if (!this.win.isFullScreen() && !this.win.isMinimized()) w.bounds = this.win.getBounds();
    w.spaceId = this.spaceId;
    w.activeBySpace = this.activeBySpace;
    w.sidebarVisible = this.sidebarVisible;
    store.save();
  }

  dispose() {
    clearInterval(this.peekTimer);
    clearInterval(this.anim);
    clearTimeout(this.toastTimer);
    windows.delete(this.id);
    for (const [id, rt] of [...live]) if (rt.owner === this) OrbeWindow.destroyView(id);
    this.closePeek();
    for (const v of [this.ui, this.modal, this.findView, this.toastView, this.peekChrome]) {
      if (v && !v.webContents.isDestroyed()) { wcOwner.delete(v.webContents.id); v.webContents.close(); }
    }
    if (this.incognito) this.session.clearStorageData().catch(() => {});
    hooks.changed();
  }

  // --- Vues web des onglets -------------------------------------------------
  ensureView(id, viewOptions, existing) {
    let rt = live.get(id);
    if (rt) {
      if (rt.owner !== this) {
        // L'onglet était affiché dans une autre fenêtre : on le lui reprend.
        const prev = rt.owner;
        try { prev.win.contentView.removeChildView(rt.view); } catch {}
        if (prev.attached) prev.attached.delete(rt.view);
        rt.owner = this;
        // L'ancienne fenêtre ne doit plus le croire affiché chez elle.
        prev.leaveSplit(id);
        for (const sid of Object.keys(prev.activeBySpace)) if (prev.activeBySpace[sid] === id) delete prev.activeBySpace[sid];
        setImmediate(() => { if (!prev.win.isDestroyed()) { prev.layout(); OrbeWindow.pushAll(); } });
      }
      return rt;
    }
    const tab = this.data.tabs[id];
    // L'accès à l'interface dépend d'un drapeau posé par Orbe, jamais de
    // l'adresse, qu'une page web peut changer.
    const internal = tab.internal === true && isInternal(tab.url);
    const view = existing || new WebContentsView(viewOptions || {
      webPreferences: { session: this.sessionFor(id), sandbox: true, contextIsolation: true, preload: internal ? UI_PRELOAD : undefined },
    });
    view.setBackgroundColor('#ffffff');
    rt = { id, view, wc: view.webContents, owner: this, loading: false, lastUsed: Date.now(), internal };
    live.set(id, rt);
    this.wire(rt, tab);
    if (!viewOptions && !existing) rt.wc.loadURL(tab.url).catch(() => {});
    return rt;
  }

  wire(rt, tab) {
    const wc = rt.wc;
    const data = this.data;
    const incognito = this.incognito;
    const touch = () => { if (!incognito) store.save(); OrbeWindow.pushAll(); };
    if (rt.internal) {
      trusted.add(wc);
      wc.on('will-navigate', (e, url) => {
        if (isInternal(url)) return;
        e.preventDefault();
        rt.owner.newTab(url);
      });
    }
    if (!rt.internal) {
      const guard = (e, url) => { if (isInternal(url)) e.preventDefault(); };
      wc.on('will-navigate', guard);
      wc.on('will-redirect', guard);
    }
    // Page fermée par elle-même (window.close) ou processus disparu.
    wc.once('destroyed', () => {
      if (live.get(rt.id) !== rt) return;
      const owner = rt.owner;
      if (owner.htmlFullscreen) owner.htmlFullscreen = false;
      if (!owner.win.isDestroyed()) owner.close(rt.id);
      else live.delete(rt.id);
    });
    wc.on('did-start-loading', () => { rt.loading = true; OrbeWindow.pushAll(); });
    wc.on('did-stop-loading', () => { rt.loading = false; OrbeWindow.pushAll(); });
    wc.on('page-title-updated', (e, title) => {
      if (isErrorPage(wc.getURL())) return;
      tab.title = String(title).slice(0, 300);
      if (!incognito) store.touchHistory(tab.url, { title });
      touch();
    });
    wc.on('page-favicon-updated', (e, icons) => {
      tab.favicon = icons[0] || '';
      if (!incognito) store.touchHistory(tab.url, { favicon: tab.favicon });
      touch();
    });
    const navigated = (url) => {
      if (isErrorPage(url)) return;
      if (isInternal(url) && !rt.internal) return;
      let hostChanged = true;
      try { hostChanged = new URL(url).host !== new URL(tab.url).host; } catch {}
      if (hostChanged) tab.favicon = '';
      tab.url = url;
      if (!incognito) store.visit(url, tab.title, tab.favicon);
      touch();
    };
    wc.on('did-navigate', (e, url) => navigated(url));
    wc.on('did-navigate-in-page', (e, url, isMainFrame) => { if (isMainFrame) navigated(url); });
    wc.on('audio-state-changed', () => {
      const owner = rt.owner;
      if (wc.isCurrentlyAudible()) { rt.playing = true; if (!owner.visibleIds().includes(rt.id)) owner.mediaId = rt.id; }
      OrbeWindow.pushAll();
    });
    wc.on('context-menu', (e, params) => rt.owner.pageMenu(rt, params));
    wc.on('before-input-event', (e, input) => rt.owner.onInput(e, input));
    wc.on('found-in-page', (e, result) => rt.owner.sendFind(result));
    wc.on('focus', () => rt.owner.paneFocused(rt.id));
    wc.on('enter-html-full-screen', () => { rt.owner.htmlFullscreen = true; rt.fullscreen = true; rt.owner.layout(); });
    wc.on('leave-html-full-screen', () => { rt.owner.htmlFullscreen = false; rt.fullscreen = false; rt.owner.layout(); });
    wc.on('will-prevent-unload', (e) => e.preventDefault());
    wc.on('did-fail-load', (e, code, desc, url, isMainFrame) => {
      if (!isMainFrame || code === -3 || isInternal(url)) return;
      tab.url = url;
      const q = new URLSearchParams({ url, desc, code: String(code), title: t('err.title'), retry: t('err.retry') });
      wc.loadURL(INTERNAL + 'error.html?' + q).catch(() => {});
    });
    wc.on('render-process-gone', () => { rt.crashed = true; });
    wc.setWindowOpenHandler((details) => {
      const owner = rt.owner;
      if (!/^(https?|about|blob|data):/i.test(details.url) && details.url !== '') return { action: 'deny' };
      if (details.disposition === 'background-tab') {
        owner.newTab(details.url, { background: true, after: rt.id });
        return { action: 'deny' };
      }
      // Aperçu : lien sortant d'un onglet épinglé ou d'un favori, ou ⇧clic.
      const from = data.tabs[rt.id];
      const outside = from && from.homeUrl && !sameHost(details.url, from.url);
      const shiftClick = details.disposition === 'new-window' && !details.features;
      if (/^https?:/i.test(details.url) && (outside || shiftClick)) {
        return { action: 'allow', createWindow: (options) => owner.openPeek(details.url, rt.id, options).webContents };
      }
      // Conserve window.opener (connexions OAuth, paiements…).
      return {
        action: 'allow',
        createWindow: (options) => {
          const child = owner.createTab(details.url || 'about:blank', { after: rt.id });
          const childRt = owner.ensureView(child.id, options);
          owner.activate(child.id);
          return childRt.wc;
        },
      };
    });
    if (data.tabs[rt.id] && tab.muted) wc.setAudioMuted(true);
  }

  static destroyView(id) {
    const rt = live.get(id);
    if (!rt) return;
    live.delete(id);
    const owner = rt.owner;
    if (rt.fullscreen) owner.htmlFullscreen = false;
    try { owner.win.contentView.removeChildView(rt.view); } catch {}
    if (owner.attached) owner.attached.delete(rt.view);
    if (!rt.wc.isDestroyed()) rt.wc.close({ waitForBeforeUnload: false });
  }

  // Met en veille les onglets les plus anciens au-delà de la limite.
  static trimLive() {
    const max = store.state.settings.maxLiveTabs;
    if (live.size <= max) return;
    const visible = new Set();
    for (const w of windows.values()) for (const id of w.visibleIds()) visible.add(id);
    const idle = [...live.values()]
      .filter((rt) => !visible.has(rt.id) && !rt.wc.isDestroyed() && !rt.wc.isCurrentlyAudible() && !rt.wc.isDevToolsOpened())
      .sort((a, b) => a.lastUsed - b.lastUsed);
    while (live.size > max && idle.length) OrbeWindow.destroyView(idle.shift().id);
  }

  // --- Onglets --------------------------------------------------------------
  createTab(url, { space = this.space, after, index } = {}) {
    const tab = { id: uid(), url, title: '', favicon: '', createdAt: Date.now(), lastActiveAt: Date.now() };
    this.data.tabs[tab.id] = tab;
    let at = 0;
    const i = after ? space.today.indexOf(after) : -1;
    if (i >= 0) at = i + 1;
    if (typeof index === 'number') at = clamp(index, 0, space.today.length);
    space.today.splice(at, 0, tab.id);
    return tab;
  }

  newTab(input, { background = false, after, split = false } = {}) {
    const url = suggest.resolve(input);
    if (isInternal(url)) return this.openInternal(url.slice(INTERNAL.length));
    const previous = this.activeId;
    const tab = this.createTab(url, { after });
    if (split && previous) this.splitWith(previous, tab.id, true);
    if (background) {
      this.ensureView(tab.id);
      OrbeWindow.trimLive();
      this.changed();
    } else {
      this.activate(tab.id);
    }
    return tab;
  }

  activate(id) {
    const loc = this.locate(id);
    if (!loc || loc.node.type === 'folder') return;
    if (loc.space && loc.space.id !== this.spaceId) this.spaceId = loc.space.id;
    // En quittant un onglet qui joue du son, il passe dans le lecteur miniature.
    for (const prevId of this.visibleIds()) {
      const prevRt = live.get(prevId);
      if (prevId !== id && prevRt && !prevRt.wc.isDestroyed() && prevRt.wc.isCurrentlyAudible()) {
        prevRt.playing = true;
        this.mediaId = prevId;
        if (!(this.groupOf(id) || []).includes(prevId)) this.pip(prevRt, true);
      }
    }
    if (this.mediaId === id) this.mediaId = null;
    const backRt = live.get(id);
    if (backRt && backRt.pip) this.pip(backRt, false);
    this.activeBySpace[this.space.id] = id;
    const tab = this.data.tabs[id];
    tab.lastActiveAt = Date.now();
    const rt = this.ensureView(id);
    rt.lastUsed = Date.now();
    if (rt.crashed) { rt.crashed = false; rt.wc.reload(); }
    if (this.peekState && !this.peekAdopting) this.closePeek();
    if (this.findOpen) this.closeFind();
    this.layout();
    this.focusContent();
    OrbeWindow.trimLive();
    this.remember();
    this.changed();
  }

  paneFocused(id) {
    if (this.activeId === id || !this.visibleIds().includes(id)) return;
    this.activeBySpace[this.space.id] = id;
    OrbeWindow.pushAll();
  }

  focusContent() {
    if (this.modalMode && this.modalMode !== 'switcher') return this.modal.webContents.focus();
    if (this.peekState) return this.peekState.view.webContents.focus();
    const wc = this.activeWc;
    if (wc) wc.focus();
    else if (!this.ui.webContents.isDestroyed()) this.ui.webContents.focus();
  }

  navigate(input, id = this.activeId) {
    if (!id) return this.newTab(input);
    const rt = this.ensureView(id);
    const url = suggest.resolve(input);
    if (rt.internal || isInternal(url)) return this.newTab(url);
    rt.wc.loadURL(url).catch(() => {});
    this.focusContent();
  }

  nextActiveAfter(id, space) {
    const group = this.groupOf(id);
    if (group) {
      const other = group.find((x) => x !== id);
      if (other) return other;
    }
    const today = space.today;
    const i = today.indexOf(id);
    if (i >= 0) return today[i + 1] || today[i - 1] || this.mostRecent(space, id);
    return this.mostRecent(space, id);
  }

  mostRecent(space, except) {
    let best = null;
    for (const id of this.orderedIds(space)) {
      if (id === except || !live.has(id)) continue;
      const tab = this.data.tabs[id];
      if (!best || tab.lastActiveAt > this.data.tabs[best].lastActiveAt) best = id;
    }
    return best;
  }

  leaveSplit(id) {
    const g = this.groupOf(id);
    if (!g) return;
    g.splice(g.indexOf(id), 1);
    if (g.length < 2) this.splits.splice(this.splits.indexOf(g), 1);
  }

  // ⌘W : un onglet du jour est archivé ; un onglet épinglé est simplement
  // déchargé et reste dans la barre latérale.
  close(id = this.activeId, { silent = false } = {}) {
    const loc = id && this.locate(id);
    if (!loc || loc.node.type === 'folder') return;
    const space = loc.space || this.space;
    const wasActive = this.activeBySpace[space.id] === id;
    const next = wasActive ? this.nextActiveAfter(id, space) : null;
    this.leaveSplit(id);
    const tab = this.data.tabs[id];
    if (loc.list === 'today') {
      loc.arr.splice(loc.index, 1);
      this.closed.push({ tab: { ...tab }, spaceId: space.id, index: loc.index });
      if (this.closed.length > 50) this.closed.shift();
      if (!this.incognito) store.archive({ ...tab, spaceId: space.id });
      delete this.data.tabs[id];
    } else if (tab.homeUrl) {
      tab.url = tab.homeUrl;
    }
    OrbeWindow.destroyView(id);
    OrbeWindow.forget(id, this.data);
    if (wasActive && next) this.activeBySpace[space.id] = next;
    if (silent) return;
    this.layout();
    this.focusContent();
    this.remember();
    this.changed();
  }

  reopenClosed() {
    const last = this.closed.pop();
    if (!last) return;
    const space = this.data.spaces.find((s) => s.id === last.spaceId) || this.space;
    const tab = this.createTab(last.tab.url, { space, index: last.index });
    tab.title = last.tab.title;
    tab.favicon = last.tab.favicon;
    if (!this.incognito) {
      const i = store.state.archive.findIndex((a) => a.url === last.tab.url);
      if (i >= 0) store.state.archive.splice(i, 1);
    }
    this.activate(tab.id);
  }

  clearToday() {
    const space = this.space;
    const active = this.activeId;
    const ids = space.today.filter((id) => id !== active).reverse();
    if (!ids.length) return;
    for (const id of ids) this.close(id, { silent: true });
    this.layout();
    this.changed();
    this.toast(t('toast.cleared'));
  }

  duplicate(id = this.activeId) {
    const tab = id && this.data.tabs[id];
    if (tab) this.newTab(tab.url, { after: id });
  }

  togglePin(id = this.activeId) {
    const loc = id && this.locate(id);
    if (!loc || loc.node.type === 'folder') return;
    const tab = this.data.tabs[id];
    const space = loc.space || this.space;
    loc.arr.splice(loc.index, 1);
    if (loc.list === 'today') {
      space.pinned.push({ type: 'tab', id });
      tab.homeUrl = tab.url;
      this.toast(t('toast.pinned'));
    } else {
      space.today.unshift(id);
      delete tab.homeUrl;
      delete tab.customTitle;
      this.toast(t('toast.unpinned'));
    }
    this.changed();
  }

  toggleFavorite(id = this.activeId) {
    const loc = id && this.locate(id);
    if (!loc || loc.node.type === 'folder') return;
    const tab = this.data.tabs[id];
    loc.arr.splice(loc.index, 1);
    if (loc.list === 'favorites') {
      this.space.today.unshift(id);
      delete tab.homeUrl;
    } else {
      this.favorites.push(id);
      tab.homeUrl = tab.homeUrl || tab.url;
    }
    this.changed();
  }

  // Image dans l'image : la vidéo en cours suit l'utilisateur quand il change
  // d'onglet, et retourne dans sa page quand il y revient.
  pip(rt, enter) {
    if (!store.state.settings.autoPip || rt.wc.isDestroyed()) return;
    rt.pip = enter;
    const code = enter
      ? `(() => {
          const v = [...document.querySelectorAll('video')]
            .filter((x) => !x.paused && !x.ended && x.readyState > 2 && !x.disablePictureInPicture && x.videoWidth > 0)
            .sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
          if (v && document.pictureInPictureEnabled && !document.pictureInPictureElement) v.requestPictureInPicture().catch(() => {});
        })()`
      : `(() => { if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {}); })()`;
    rt.wc.executeJavaScript(code, true).catch(() => {});
  }

  // Lecture / pause du média de l'onglet en arrière-plan.
  mediaToggle() {
    const rt = this.mediaId && live.get(this.mediaId);
    if (!rt || rt.wc.isDestroyed()) return;
    rt.playing = !rt.playing;
    rt.wc.executeJavaScript(`(() => {
      const all = [...document.querySelectorAll('video, audio')];
      const m = all.find((x) => !x.paused) || all.find((x) => x.currentTime > 0) || all[0];
      if (m) { if (m.paused) m.play(); else m.pause(); }
    })()`, true).catch(() => {});
    OrbeWindow.pushAll();
  }

  resetPinned(id = this.activeId) {
    const tab = id && this.data.tabs[id];
    if (tab && tab.homeUrl) this.navigate(tab.homeUrl, id);
  }

  toggleMute(id = this.activeId) {
    const tab = id && this.data.tabs[id];
    if (!tab) return;
    tab.muted = !tab.muted;
    const rt = live.get(id);
    if (rt) rt.wc.setAudioMuted(tab.muted);
    this.toast(t(tab.muted ? 'toast.muted' : 'toast.unmuted'));
    this.changed();
  }

  stepTab(delta) {
    const ids = this.orderedIds();
    if (!ids.length) return;
    const i = ids.indexOf(this.activeId);
    this.activate(ids[(i + delta + ids.length) % ids.length]);
  }

  tabAt(n) {
    const ids = this.orderedIds();
    const id = n === 9 ? ids[ids.length - 1] : ids[n - 1];
    if (id) this.activate(id);
  }

  move({ id, to, folderId, index }) {
    const loc = this.locate(id);
    if (!loc) return;
    const space = loc.space || this.space;
    const node = loc.node;
    const isFolder = node.type === 'folder';
    let dest;
    if (to === 'favorites') dest = this.favorites;
    else if (to === 'today') dest = this.space.today;
    else if (to === 'pinned') dest = this.space.pinned;
    else if (to === 'folder') {
      const f = findNode(this.space.pinned, folderId);
      if (!f || f.node.type !== 'folder') return;
      dest = f.node.children;
    } else return;
    if (isFolder && to !== 'pinned') return;
    let at = typeof index === 'number' ? index : dest.length;
    if (dest === loc.arr && loc.index < at) at -= 1;
    loc.arr.splice(loc.index, 1);
    const flat = to === 'favorites' || to === 'today';
    dest.splice(clamp(at, 0, dest.length), 0, flat ? id : node);
    if (!isFolder) {
      const tab = this.data.tabs[id];
      if (to === 'today') { delete tab.homeUrl; delete tab.customTitle; } else if (!tab.homeUrl) tab.homeUrl = tab.url;
      if (loc.space && space.id !== this.space.id && this.activeBySpace[space.id] === id) delete this.activeBySpace[space.id];
    }
    this.changed();
  }

  moveToSpace(id, spaceId) {
    const loc = this.locate(id);
    const target = this.data.spaces.find((s) => s.id === spaceId);
    if (!loc || !target || loc.space === target) return;
    const wasActive = this.activeId === id;
    const next = wasActive ? this.nextActiveAfter(id, this.space) : null;
    OrbeWindow.forget(id, this.data);
    // Changer de profil change de cookies : la page sera rechargée.
    if (loc.space && loc.space.profileId !== target.profileId) OrbeWindow.destroyView(id);
    loc.arr.splice(loc.index, 1);
    if (loc.list === 'pinned') target.pinned.push(loc.node);
    else { target.today.unshift(id); delete this.data.tabs[id].homeUrl; }
    if (wasActive && next) this.activeBySpace[this.space.id] = next;
    for (const w of windows.values()) if (w.data === this.data) w.layout();
    this.changed();
  }

  // --- Dossiers -------------------------------------------------------------
  newFolder() {
    const folder = { type: 'folder', id: uid(), name: t('tabs.folderDefault'), open: true, children: [] };
    this.space.pinned.push(folder);
    this.changed();
    this.askRename(folder.id);
  }

  toggleFolder(id) {
    const f = findNode(this.space.pinned, id);
    if (!f) return;
    f.node.open = !f.node.open;
    this.changed();
  }

  deleteFolder(id) {
    const f = findNode(this.space.pinned, id);
    if (!f) return;
    f.arr.splice(f.index, 1, ...f.node.children);
    this.changed();
  }

  askRename(id) {
    if (!this.sidebarVisible && !this.peek) this.toggleSidebar(true);
    setTimeout(() => {
      if (this.ui.webContents.isDestroyed()) return;
      this.ui.webContents.focus();
      this.ui.webContents.send('edit', id);
    }, 60);
  }

  rename(id, name) {
    name = String(name || '').trim().slice(0, 80);
    const space = this.data.spaces.find((s) => s.id === id);
    if (space) { if (name) space.name = name; return this.changed(); }
    const loc = this.locate(id);
    if (!loc) return;
    if (loc.node.type === 'folder') { if (name) loc.node.name = name; } else {
      const tab = this.data.tabs[id];
      if (name) tab.customTitle = name; else delete tab.customTitle;
    }
    this.changed();
  }

  // --- Espaces --------------------------------------------------------------
  switchSpace(id) {
    const i = this.data.spaces.findIndex((s) => s.id === id);
    if (i < 0 || id === this.spaceId) return;
    const from = this.data.spaces.findIndex((s) => s.id === this.spaceId);
    this.spaceDir = i > from ? 1 : -1;
    this.closePeek();
    this.htmlFullscreen = false;
    this.spaceId = id;
    if (this.findOpen) this.closeFind();
    this.layout();
    this.focusContent();
    this.remember();
    OrbeWindow.pushAll();
  }

  stepSpace(delta) {
    const spaces = this.data.spaces;
    const i = spaces.findIndex((s) => s.id === this.spaceId);
    const next = spaces[i + delta];
    if (next) this.switchSpace(next.id);
  }

  spaceAt(n) {
    const sp = this.data.spaces[n - 1];
    if (sp) this.switchSpace(sp.id);
  }

  newSpace() {
    if (this.incognito) return;
    const used = new Set(this.data.spaces.map((s) => s.color));
    const color = SPACE_COLORS.find((c) => !used.has(c));
    const space = store.makeSpace(t('spaces.defaultName'), '✨', color);
    this.data.spaces.push(space);
    this.switchSpace(space.id);
    this.changed();
    this.askRename(space.id);
  }

  async deleteSpace(id = this.spaceId) {
    const spaces = this.data.spaces;
    const i = spaces.findIndex((s) => s.id === id);
    if (i < 0 || spaces.length < 2 || this.incognito) return;
    const space = spaces[i];
    const r = await dialog.showMessageBox(this.win, {
      type: 'warning',
      message: t('spaces.deleteConfirm', { name: space.name }),
      detail: t('spaces.deleteDetail'),
      buttons: [t('spaces.delete').replace('…', ''), t('edit.undo')],
      defaultId: 1,
      cancelId: 1,
    });
    if (r.response !== 0) return;
    for (const tid of [...walk(space.pinned), ...space.today]) {
      const tab = this.data.tabs[tid];
      if (space.today.includes(tid)) store.archive({ ...tab, spaceId: space.id });
      OrbeWindow.destroyView(tid);
      OrbeWindow.forget(tid, this.data);
      delete this.data.tabs[tid];
    }
    spaces.splice(i, 1);
    for (const w of windows.values()) {
      if (w.data !== this.data) continue;
      delete w.activeBySpace[id];
      if (w.spaceId === id) w.spaceId = spaces[Math.max(0, i - 1)].id;
      w.layout();
    }
    this.remember();
    this.changed();
  }

  // --- Profils --------------------------------------------------------------
  setProfile(profileId, space = this.space) {
    if (this.incognito || space.profileId === profileId || !this.data.profiles.some((p) => p.id === profileId)) return;
    for (const id of [...walk(space.pinned), ...space.today]) OrbeWindow.destroyView(id);
    space.profileId = profileId;
    for (const w of windows.values()) w.layout();
    this.changed();
  }

  newProfile() {
    if (this.incognito) return;
    const profile = { id: uid(), name: t('profiles.name', { n: this.data.profiles.length + 1 }) };
    this.data.profiles.push(profile);
    this.data.favs[profile.id] = [];
    this.setProfile(profile.id);
  }

  setTheme({ color, icon }) {
    const space = this.space;
    if (typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)) space.color = color;
    if (typeof icon === 'string' && icon.length <= 8) space.icon = icon;
    this.changed();
  }

  // --- Vue scindée ----------------------------------------------------------
  splitWith(a, b, quiet) {
    if (a === b) return;
    let g = this.groupOf(a);
    if (g && g.length >= 4) return this.toast(t('toast.splitMax'));
    this.leaveSplit(b);
    g = this.groupOf(a);
    if (!g) { g = [a]; this.splits.push(g); }
    g.splice(g.indexOf(a) + 1, 0, b);
    if (!quiet) this.activate(b);
  }

  addSplit() {
    if (!this.activeId) return this.openCommand('new');
    const g = this.groupOf(this.activeId);
    if (g && g.length >= 4) return this.toast(t('toast.splitMax'));
    this.openCommand('split');
  }

  closeSplitPane() {
    const id = this.activeId;
    const g = id && this.groupOf(id);
    if (!g) return;
    const other = g.find((x) => x !== id);
    this.leaveSplit(id);
    this.activate(other);
  }

  // --- Aperçu (Peek) --------------------------------------------------------
  // Une page ouverte par-dessus l'onglet courant, sans quitter celui-ci.
  // Elle se ferme d'un geste ou devient un vrai onglet.
  openPeek(url, fromId, options) {
    this.closePeek();
    const view = new WebContentsView(options || {
      webPreferences: { session: this.sessionFor(fromId), sandbox: true, contextIsolation: true },
    });
    view.setBackgroundColor('#ffffff');
    view.setBorderRadius(12);
    const wc = view.webContents;
    const state = (this.peekState = { view, from: fromId, url, title: '', handlers: [] });
    const on = (event, fn) => { wc.on(event, fn); state.handlers.push([event, fn]); };
    on('page-title-updated', (e, title) => { state.title = title; });
    on('page-favicon-updated', (e, icons) => { state.favicon = icons[0] || ''; });
    on('did-navigate', (e, u) => { state.url = u; });
    on('did-navigate-in-page', (e, u, main) => { if (main) state.url = u; });
    on('will-prevent-unload', (e) => e.preventDefault());
    on('destroyed', () => { if (this.peekState === state) this.closePeek(); });
    const guard = (e, u) => { if (isInternal(u)) e.preventDefault(); };
    on('will-navigate', guard);
    on('will-redirect', guard);
    on('context-menu', (e, params) => this.pageMenu({ wc, id: fromId }, params));
    on('before-input-event', (e, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') { e.preventDefault(); return this.closePeek(); }
      return this.onInput(e, input);
    });
    wc.setWindowOpenHandler((d) => { if (/^https?:/i.test(d.url)) this.newTab(d.url); return { action: 'deny' }; });
    if (!this.peekChrome) {
      this.peekChrome = this.makeUiView('overlay.html#peek');
      this.peekChrome.webContents.once('did-finish-load', () => this.peekChrome.webContents.send('overlay', { mode: 'peek' }));
    } else {
      this.peekChrome.webContents.send('overlay', { mode: 'peek' });
    }
    this.win.contentView.addChildView(this.peekChrome);
    this.win.contentView.addChildView(view);
    if (this.findOpen) this.closeFind();
    this.layout();
    if (!options) wc.loadURL(url).catch(() => {});
    wc.focus();
    return view;
  }

  detachPeek() {
    const state = this.peekState;
    if (!state) return null;
    this.peekState = null;
    try { this.win.contentView.removeChildView(state.view); } catch {}
    try { this.win.contentView.removeChildView(this.peekChrome); } catch {}
    return state;
  }

  closePeek() {
    const state = this.detachPeek();
    if (!state) return;
    if (!state.view.webContents.isDestroyed()) state.view.webContents.close({ waitForBeforeUnload: false });
    if (!this.win.isDestroyed()) this.focusContent();
  }

  // Transforme l'aperçu en onglet sans recharger la page.
  expandPeek({ split = false } = {}) {
    const state = this.detachPeek();
    if (!state) return;
    const wc = state.view.webContents;
    if (wc.isDestroyed()) return;
    for (const [event, fn] of state.handlers) wc.off(event, fn);
    const from = this.locate(state.from) ? state.from : null;
    const tab = this.createTab(wc.getURL() || state.url, { after: from });
    tab.title = state.title;
    tab.favicon = state.favicon || '';
    state.view.setBorderRadius(RADIUS);
    this.ensureView(tab.id, null, state.view);
    if (!this.incognito) store.visit(tab.url, tab.title, tab.favicon);
    if (split && from && this.activeId === from) this.splitWith(from, tab.id);
    else this.activate(tab.id);
  }

  // --- Vues flottantes ------------------------------------------------------
  showModal(mode, payload, focus = true) {
    this.modalMode = mode;
    const [W, H] = this.win.getContentSize();
    this.win.contentView.addChildView(this.modal); // repasse au premier plan
    this.modal.setBounds({ x: 0, y: 0, width: W, height: H });
    this.modal.setVisible(true);
    this.modal.webContents.send('overlay', { mode, ...payload });
    if (focus) this.modal.webContents.focus();
  }

  hideModal() {
    if (!this.modalMode) return;
    this.modalMode = null;
    this.switcher = null;
    this.modal.setVisible(false);
    this.modal.webContents.send('overlay', { mode: null });
    this.focusContent();
  }

  // 'new' : nouvel onglet ; 'edit' : modifie l'adresse de l'onglet actif ;
  // 'split' : ouvre le résultat dans un nouveau volet.
  openCommand(mode = 'new') {
    if (mode === 'edit' && !this.activeId) mode = 'new';
    if (this.modalMode === 'command' && this.commandMode === mode) return this.hideModal();
    this.commandMode = mode;
    const tab = mode === 'edit' ? this.data.tabs[this.activeId] : null;
    const rect = this.contentRect();
    const [W] = this.win.getContentSize();
    this.showModal('command', {
      value: tab && !isInternal(tab.url) ? tab.url : '',
      items: this.suggestLocal(''),
      centerX: Math.round(mode === 'edit' ? rect.x + rect.width / 2 : W / 2),
    });
  }

  commandList() {
    const { COMMANDS } = require('./commands');
    return COMMANDS.filter((c) => c.palette !== false).map((c) => ({ command: c.name, title: t(c.label), shortcut: c.keys || '' }));
  }

  suggestLocal(q) {
    const tabs = [];
    for (const sp of this.data.spaces) {
      for (const id of [...walk(sp.pinned), ...sp.today]) tabs.push(this.data.tabs[id]);
    }
    for (const list of Object.values(this.data.favs)) for (const id of list) tabs.push(this.data.tabs[id]);
    const items = suggest.local(q, { tabs, commands: this.commandList(), activeId: this.commandMode === 'edit' ? this.activeId : null });
    return this.incognito ? items.filter((i) => i.kind !== 'history').map((i) => ({ ...i, favicon: '' })) : items;
  }

  async suggest(q) {
    if (this.suggestAbort) this.suggestAbort.abort();
    const ctrl = (this.suggestAbort = new AbortController());
    const items = this.suggestLocal(q);
    if (!this.incognito) {
      suggest.remote(q, ctrl.signal).then((more) => {
        if (ctrl.signal.aborted || !more.length || this.modalMode !== 'command') return;
        const seen = new Set(items.map((i) => i.title.toLowerCase()));
        this.modal.webContents.send('suggest-more', { q, items: more.filter((m) => !seen.has(m.title.toLowerCase())) });
      });
    }
    return items;
  }

  runItem(item, { background = false } = {}) {
    const mode = this.commandMode;
    this.hideModal();
    if (!item) return;
    if (item.kind === 'command') return this.run(item.command);
    if (item.kind === 'tab' && this.locate(item.tabId)) {
      if (mode === 'split' && this.activeId) return this.splitWith(this.activeId, item.tabId);
      return this.activate(item.tabId);
    }
    const target = item.url || item.title;
    if (!target) return;
    if (mode === 'edit' && this.activeId && !background) return this.navigate(target);
    this.newTab(target, { background, split: mode === 'split' });
  }

  run(name, arg) {
    return require('./commands').run(this, name, arg);
  }

  openTheme() {
    if (!this.sidebarVisible) this.toggleSidebar(true);
    const s = this.space;
    this.showModal('theme', { color: s.color, icon: s.icon, colors: SPACE_COLORS, x: this.sidebarWidth + 10 });
  }

  // Bascule ⌃Tab : ordre d'utilisation récente, validée au relâchement de ⌃.
  switcherStep(delta) {
    if (!this.switcher) {
      const ids = this.orderedIds()
        .filter((id) => live.has(id) || this.space.today.includes(id))
        .sort((a, b) => (this.data.tabs[b].lastActiveAt || 0) - (this.data.tabs[a].lastActiveAt || 0))
        .slice(0, 8);
      if (ids.length < 2) return;
      this.switcher = { ids, index: 0 };
    }
    const s = this.switcher;
    s.index = (s.index + delta + s.ids.length) % s.ids.length;
    const items = s.ids.map((id) => {
      const tab = this.data.tabs[id];
      return { id, title: tab.customTitle || tab.title || suggest.strip(tab.url), favicon: this.incognito ? '' : tab.favicon };
    });
    this.showModal('switcher', { items, index: s.index }, false);
  }

  switcherCommit() {
    const s = this.switcher;
    if (!s) return;
    const id = s.ids[s.index];
    this.hideModal();
    if (id) this.activate(id);
  }

  onInput(e, input) {
    if (input.type === 'keyDown' && input.key === 'Tab' && input.control && !input.meta && !input.alt) {
      e.preventDefault();
      this.switcherStep(input.shift ? -1 : 1);
    } else if (input.type === 'keyUp' && input.key === 'Control' && this.switcher) {
      this.switcherCommit();
    } else if (input.type === 'keyDown' && input.key === 'Escape') {
      if (this.switcher) this.hideModal();
      else if (this.findOpen) this.closeFind();
    }
  }

  openFind() {
    const wc = this.activeWc;
    if (!wc) return;
    if (!this.findView) {
      this.findView = this.makeUiView('overlay.html#find');
      this.findView.setVisible(false);
    }
    this.findOpen = true;
    this.win.contentView.addChildView(this.findView);
    this.layout();
    this.findView.setVisible(true);
    const show = () => { this.findView.webContents.send('overlay', { mode: 'find' }); this.findView.webContents.focus(); };
    if (this.findView.webContents.isLoading()) this.findView.webContents.once('did-finish-load', show);
    else show();
  }

  find(text, { forward = true, next = false } = {}) {
    const wc = this.activeWc;
    if (!wc) return;
    this.findText = text;
    if (!text) { wc.stopFindInPage('clearSelection'); return this.sendFind({ matches: 0, activeMatchOrdinal: 0, finalUpdate: true }); }
    // Electron : findNext vaut true pour une nouvelle recherche.
    wc.findInPage(text, { forward, findNext: !next });
  }

  findStep(forward) {
    if (!this.findOpen) return this.openFind();
    if (this.findText) this.find(this.findText, { forward, next: true });
  }

  sendFind(result) {
    if (this.findOpen && this.findView) this.findView.webContents.send('find-result', { matches: result.matches, current: result.activeMatchOrdinal });
  }

  closeFind() {
    if (!this.findOpen) return;
    this.findOpen = false;
    this.findText = '';
    this.findView.setVisible(false);
    try { this.win.contentView.removeChildView(this.findView); } catch {}
    for (const id of this.visibleIds()) {
      const rt = live.get(id);
      if (rt && !rt.wc.isDestroyed()) rt.wc.stopFindInPage('clearSelection');
    }
    this.focusContent();
  }

  toast(text) {
    if (this.win.isDestroyed()) return;
    const send = () => {
      if (this.toastView.webContents.isDestroyed()) return;
      this.win.contentView.addChildView(this.toastView);
      this.layout();
      this.toastView.setVisible(true);
      this.toastView.webContents.send('overlay', { mode: 'toast', text });
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => {
        if (this.win.isDestroyed()) return;
        this.toastView.setVisible(false);
        try { this.win.contentView.removeChildView(this.toastView); } catch {}
      }, 2100);
    };
    if (!this.toastView) {
      this.toastView = this.makeUiView('overlay.html#toast');
      this.toastView.setVisible(false);
      this.toastView.webContents.once('did-finish-load', send);
    } else if (this.toastView.webContents.isLoading()) {
      this.toastView.webContents.once('did-finish-load', send);
    } else send();
  }

  // --- Actions sur la page --------------------------------------------------
  copyUrl(markdown) {
    const tab = this.activeId && this.data.tabs[this.activeId];
    if (!tab) return;
    clipboard.writeText(markdown ? `[${tab.title || tab.url}](${tab.url})` : tab.url);
    this.toast(t(markdown ? 'toast.markdownCopied' : 'toast.urlCopied'));
  }

  zoom(delta) {
    const wc = this.activeWc;
    if (!wc) return;
    wc.setZoomLevel(delta === 0 ? 0 : clamp(wc.getZoomLevel() + delta, -4, 5));
  }

  async capture() {
    const wc = this.activeWc;
    if (!wc) return;
    const image = await wc.capturePage();
    const png = image.toPNG();
    clipboard.write([new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) })]).catch(() => {});
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    fs.writeFile(path.join(app.getPath('downloads'), `Orbe ${stamp}.png`), png, () => {});
    this.toast(t('toast.captured'));
  }

  // Capture de la page entière, au-delà de la zone visible.
  async captureFull() {
    const wc = this.activeWc;
    if (!wc) return;
    const dbg = wc.debugger;
    if (dbg.isAttached()) return this.capture();
    try {
      dbg.attach('1.3');
      const metrics = await dbg.sendCommand('Page.getLayoutMetrics');
      const size = metrics.cssContentSize || metrics.contentSize;
      const shot = await dbg.sendCommand('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true,
        clip: { x: 0, y: 0, width: Math.ceil(size.width), height: Math.min(Math.ceil(size.height), 20000), scale: 1 },
      });
      const png = Buffer.from(shot.data, 'base64');
      clipboard.write([new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) })]).catch(() => {});
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      fs.writeFile(path.join(app.getPath('downloads'), `Orbe ${stamp}.png`), png, () => {});
      this.toast(t('toast.captured'));
    } catch (err) {
      console.error('[orbe] capture', err);
    } finally {
      try { dbg.detach(); } catch {}
    }
    return undefined;
  }

  async savePage() {
    const wc = this.activeWc;
    if (!wc) return;
    const name = (wc.getTitle() || 'page').replace(/[/:\\]/g, '-').slice(0, 80);
    const r = await dialog.showSaveDialog(this.win, { defaultPath: path.join(app.getPath('downloads'), name + '.html') });
    if (!r.canceled && r.filePath) wc.savePage(r.filePath, 'HTMLComplete').catch(() => {});
  }

  async clearAndReload(what) {
    const wc = this.activeWc;
    if (!wc) return;
    if (what === 'cache') await wc.session.clearCache();
    else {
      let origin = '';
      try { origin = new URL(wc.getURL()).origin; } catch {}
      if (origin) await wc.session.clearStorageData({ origin, storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage'] });
    }
    wc.reloadIgnoringCache();
  }

  openInternal(page) {
    if (!INTERNAL_PAGES.has(String(page).split(/[#?]/)[0])) return undefined;
    const url = INTERNAL + page;
    const base = url.split('#')[0];
    for (const id of Object.keys(this.data.tabs)) {
      if (this.data.tabs[id].internal && this.data.tabs[id].url.split('#')[0] === base && this.locate(id)) {
        this.activate(id);
        const rt = live.get(id);
        if (rt) rt.wc.loadURL(url).catch(() => {});
        return this.data.tabs[id];
      }
    }
    const tab = this.createTab(url);
    tab.internal = true;
    this.activate(tab.id);
    return tab;
  }

  // Actualiser : depuis la page d'erreur, on retente l'adresse d'origine.
  reload(ignoreCache) {
    const wc = this.activeWc;
    if (!wc) return;
    const tab = this.activeId && this.data.tabs[this.activeId];
    if (tab && this.activeRt && wc === this.activeRt.wc && isErrorPage(wc.getURL())) wc.loadURL(tab.url).catch(() => {});
    else if (ignoreCache) wc.reloadIgnoringCache();
    else wc.reload();
  }

  static deleteProfile(profileId) {
    const s = store.state;
    const i = s.profiles.findIndex((x) => x.id === profileId);
    if (i < 0 || profileId === 'default' || s.spaces.some((sp) => sp.profileId === profileId)) return false;
    // Les favoris du profil rejoignent l'archive ; ses cookies sont effacés.
    for (const id of s.favs[profileId] || []) {
      OrbeWindow.destroyView(id);
      OrbeWindow.forget(id, s);
      store.archive(s.tabs[id]);
      delete s.tabs[id];
    }
    delete s.favs[profileId];
    s.profiles.splice(i, 1);
    sessions.profileSession(profileId).clearStorageData().catch(() => {});
    store.save();
    for (const w of windows.values()) w.layout();
    OrbeWindow.pushAll();
    return true;
  }

  // --- Menus contextuels ----------------------------------------------------
  popup(template) {
    this.menuOpen = true;
    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: this.win, callback: () => { this.menuOpen = false; } });
  }

  tabMenu(id) {
    const loc = this.locate(id);
    if (!loc) return;
    if (loc.node.type === 'folder') return this.folderMenu(id);
    const tab = this.data.tabs[id];
    const pinned = loc.list === 'pinned';
    const fav = loc.list === 'favorites';
    const others = this.data.spaces.filter((s) => s !== loc.space);
    const tpl = [
      { label: t('tabs.copyLink'), click: () => clipboard.writeText(tab.url) },
      { label: t('tabs.duplicate'), click: () => this.duplicate(id) },
      { label: t('tabs.rename'), visible: !fav, click: () => this.askRename(id) },
      { type: 'separator' },
      { label: t(pinned ? 'tabs.unpin' : 'tabs.pin'), visible: !fav, click: () => this.togglePin(id) },
      { label: t(fav ? 'tabs.removeFavorite' : 'tabs.addFavorite'), visible: !this.incognito, click: () => this.toggleFavorite(id) },
      { label: t('tabs.openSplit'), enabled: !!this.activeId && this.activeId !== id, click: () => this.splitWith(this.activeId, id) },
      { label: t(tab.muted ? 'tabs.unmute' : 'tabs.mute'), click: () => this.toggleMute(id) },
    ];
    if (others.length && !fav) {
      tpl.push({ label: t('tabs.moveTo'), submenu: others.map((s) => ({ label: `${s.icon} ${s.name}`, click: () => this.moveToSpace(id, s.id) })) });
    }
    if (tab.homeUrl && !samePage(tab.homeUrl, tab.url)) {
      tpl.push({ type: 'separator' },
        { label: t('tabs.resetPinned'), click: () => this.resetPinned(id) },
        { label: t('tabs.replacePinned'), click: () => { tab.homeUrl = tab.url; this.changed(); } });
    }
    tpl.push({ type: 'separator' }, { label: t('tabs.close'), click: () => this.close(id) });
    if (loc.list === 'today') {
      tpl.push({ label: t('tabs.closeOthers'), enabled: loc.index < loc.arr.length - 1, click: () => {
        for (const other of loc.arr.slice(loc.index + 1).reverse()) this.close(other, { silent: true });
        this.layout();
        this.changed();
      } });
    }
    this.popup(tpl);
  }

  folderMenu(id) {
    this.popup([
      { label: t('tabs.renameFolder'), click: () => this.askRename(id) },
      { type: 'separator' },
      { label: t('tabs.deleteFolder'), click: () => this.deleteFolder(id) },
    ]);
  }

  spaceMenu(id) {
    if (id && id !== this.spaceId) this.switchSpace(id);
    this.popup([
      { label: t('spaces.rename'), click: () => this.askRename(this.spaceId) },
      { label: t('spaces.editTheme'), click: () => this.openTheme() },
      { type: 'separator' },
      { label: t('tabs.newFolder'), click: () => this.newFolder() },
      { label: t('spaces.new'), enabled: !this.incognito, click: () => this.newSpace() },
      { type: 'separator' },
      { label: t('spaces.delete'), enabled: this.data.spaces.length > 1, click: () => this.deleteSpace() },
    ]);
  }

  sidebarMenu() {
    this.popup([
      { label: t('tabs.newTab'), click: () => this.openCommand('new') },
      { label: t('tabs.newFolder'), click: () => this.newFolder() },
      { label: t('spaces.new'), enabled: !this.incognito, click: () => this.newSpace() },
      { type: 'separator' },
      { label: t('spaces.editTheme'), click: () => this.openTheme() },
    ]);
  }

  pageMenu(rt, p) {
    const wc = rt.wc;
    const tpl = [];
    const sep = () => { if (tpl.length && tpl[tpl.length - 1].type !== 'separator') tpl.push({ type: 'separator' }); };
    const link = webUrl(p.linkURL);
    const src = webUrl(p.srcURL);
    if (link) {
      tpl.push(
        { label: t('ctx.openNewTab'), click: () => this.newTab(link, { background: true, after: rt.id }) },
        { label: t('ctx.openSplit'), click: () => { this.activate(rt.id); this.newTab(link, { split: true }); } },
        { label: t('ctx.openPeek'), click: () => this.openPeek(link, rt.id) },
        // Une petite fenêtre utilise le profil principal : pas depuis la navigation privée.
        { label: t('ctx.openLittle'), visible: !this.incognito, click: () => hooks.openLittle(link) },
      );
    }
    if (p.linkURL) tpl.push({ label: t('ctx.copyLink'), click: () => clipboard.writeText(p.linkURL) });
    if (p.mediaType === 'image' && p.srcURL) {
      sep();
      tpl.push(
        { label: t('ctx.openImage'), visible: !!src, click: () => this.newTab(src, { after: rt.id }) },
        { label: t('ctx.copyImage'), click: () => wc.copyImageAt(p.x, p.y) },
        { label: t('ctx.copyImageUrl'), click: () => clipboard.writeText(p.srcURL) },
        { label: t('ctx.saveImage'), visible: !!src, click: () => wc.downloadURL(src) },
      );
    }
    if (p.isEditable) {
      sep();
      for (const w of (p.dictionarySuggestions || []).slice(0, 5)) tpl.push({ label: w, click: () => wc.replaceMisspelling(w) });
      sep();
      tpl.push({ label: t('edit.cut'), role: 'cut' }, { label: t('edit.copy'), role: 'copy' }, { label: t('edit.paste'), role: 'paste' }, { label: t('edit.selectAll'), role: 'selectAll' });
    } else if (p.selectionText && p.selectionText.trim()) {
      sep();
      const text = p.selectionText.trim();
      tpl.push(
        { label: t('edit.copy'), role: 'copy' },
        { label: t('ctx.searchFor', { text: text.length > 28 ? text.slice(0, 28) + '…' : text }), click: () => this.newTab(suggest.searchUrl(text), { after: rt.id }) },
      );
    }
    if (!p.linkURL && !p.isEditable && p.mediaType === 'none' && !(p.selectionText || '').trim()) {
      const nav = wc.navigationHistory;
      tpl.push(
        { label: t('ctx.back'), enabled: nav.canGoBack(), click: () => nav.goBack() },
        { label: t('ctx.forward'), enabled: nav.canGoForward(), click: () => nav.goForward() },
        { label: t('ctx.reload'), click: () => { this.activate(rt.id); this.reload(); } },
        { type: 'separator' },
        { label: t('edit.copyUrl'), click: () => clipboard.writeText(wc.getURL()) },
        { label: t('file.savePage'), click: () => { this.activate(rt.id); this.savePage(); } },
        { label: t('file.print'), click: () => wc.print() },
      );
    }
    sep();
    tpl.push({ label: t('ctx.inspect'), click: () => wc.inspectElement(p.x, p.y) });
    this.popup(tpl);
  }

  // --- État envoyé à la coque -----------------------------------------------
  sendState() {
    if (this.win.isDestroyed() || this.ui.webContents.isDestroyed()) return;
    const d = this.data;
    const space = this.space;
    const activeId = this.activeId;
    const tabVM = (id) => {
      const tab = d.tabs[id];
      const rt = live.get(id);
      const alive = rt && !rt.wc.isDestroyed();
      const g = this.groupOf(id);
      return {
        type: 'tab',
        id,
        title: tab.customTitle || tab.title || suggest.strip(tab.url) || '…',
        url: tab.url,
        favicon: tab.favicon,
        loading: !!(alive && rt.loading),
        audible: !!(alive && rt.wc.isCurrentlyAudible()),
        muted: !!tab.muted,
        live: !!alive,
        changed: !!tab.homeUrl && !samePage(tab.homeUrl, tab.url),
        split: g ? this.splits.indexOf(g) + 1 : 0,
        active: id === activeId,
        shown: !!g && g.includes(activeId) && id !== activeId,
      };
    };
    const nodeVM = (n) => (n.type === 'folder'
      ? { type: 'folder', id: n.id, name: n.name, open: n.open !== false, children: n.children.map(nodeVM) }
      : tabVM(n.id));
    const wc = this.activeWc;
    const tab = activeId && d.tabs[activeId];
    const settings = store.state.settings;
    const downloads = store.state.downloads.filter((x) => x.state === 'progressing');
    const dir = this.spaceDir || 0;
    this.spaceDir = 0;
    const mediaRt = this.mediaId && live.get(this.mediaId);
    const mediaTab = mediaRt && !mediaRt.wc.isDestroyed() && d.tabs[this.mediaId];
    if (!mediaTab || this.visibleIds().includes(this.mediaId)) this.mediaId = null;
    this.ui.webContents.send('state', {
      lang: settings.lang,
      appearance: settings.appearance,
      translucent: settings.translucent,
      dark: nativeTheme.shouldUseDarkColors,
      incognito: this.incognito,
      sidebar: { visible: this.sidebarVisible, peek: this.peek, width: this.sidebarWidth },
      toolbar: settings.showToolbar,
      fullScreen: this.win.isFullScreen(),
      spaceDir: dir,
      space: { id: space.id, name: space.name, icon: space.icon, color: space.color },
      spaces: d.spaces.map((s) => ({ id: s.id, name: s.name, icon: s.icon, color: s.color })),
      favorites: this.favorites.map(tabVM),
      pinned: space.pinned.map(nodeVM),
      today: space.today.map(tabVM),
      activeId,
      nav: {
        url: tab ? tab.url : '',
        internal: tab ? isInternal(tab.url) : false,
        title: tab ? (tab.title || '') : '',
        loading: !!(this.activeRt && this.activeRt.loading),
        canBack: !!(wc && wc.navigationHistory.canGoBack()),
        canForward: !!(wc && wc.navigationHistory.canGoForward()),
      },
      media: this.mediaId ? {
        id: this.mediaId,
        title: mediaTab.customTitle || mediaTab.title || suggest.strip(mediaTab.url),
        url: mediaTab.url,
        favicon: mediaTab.favicon,
        playing: mediaRt.wc.isCurrentlyAudible() || (!!mediaRt.playing && !mediaTab.muted),
        muted: !!mediaTab.muted,
      } : null,
      downloads: downloads.length
        ? { count: downloads.length, progress: downloads.reduce((a, x) => a + (x.total ? x.received / x.total : 0), 0) / downloads.length }
        : null,
    });
  }

  // --- Messages venant de l'interface ---------------------------------------
  handle(action, a) {
    switch (action) {
      case 'ready': return this.sendState();
      case 'activate': return this.activate(a);
      case 'close': return this.close(a);
      case 'openCommand': return this.openCommand(a);
      case 'toggleSidebar': return this.toggleSidebar();
      case 'sidebarWidth': return this.setSidebarWidth(a);
      case 'switchSpace': return this.switchSpace(a);
      case 'stepSpace': return this.stepSpace(a);
      case 'tabMenu': return this.tabMenu(a);
      case 'spaceMenu': return this.spaceMenu(a);
      case 'sidebarMenu': return this.sidebarMenu();
      case 'rename': return this.rename(a.id, a.name);
      case 'toggleFolder': return this.toggleFolder(a);
      case 'move': return this.move(a);
      case 'toggleMute': return this.toggleMute(a);
      case 'mediaToggle': return this.mediaToggle();
      case 'resetPinned': return this.resetPinned(a);
      case 'command': return this.run(a);
      case 'dropUrl': {
        // Texte déposé : une adresse web, ou sinon une recherche — jamais file: ou orbe:.
        const text = String(a || '').trim().slice(0, 2000);
        if (!text) return undefined;
        if (/^[a-z][a-z0-9+.-]*:/i.test(text) && !webUrl(text)) return undefined;
        return this.newTab(webUrl(text) || suggest.searchUrl(text));
      }
      case 'suggest': return this.suggest(String(a || ''));
      case 'run': return this.runItem(a.item, { background: !!a.background });
      case 'closeOverlay': return this.hideModal();
      case 'find': return this.find(String(a.text || ''), a);
      case 'findClose': return this.closeFind();
      case 'theme': return this.setTheme(a);
      case 'peekClose': return this.closePeek();
      case 'peekExpand': return this.expandPeek();
      case 'peekSplit': return this.expandPeek({ split: true });
      case 'open': return webUrl(String(a)) ? this.newTab(String(a)) : undefined;
      default: return undefined;
    }
  }
}

function archiveStale() {
  const hours = store.state.settings.archiveAfterHours;
  if (!hours) return;
  const limit = Date.now() - hours * 36e5;
  const any = OrbeWindow.all.find((w) => !w.incognito);
  if (!any) return;
  const activeIds = new Set();
  for (const w of windows.values()) {
    if (w.incognito) continue;
    for (const id of Object.values(w.activeBySpace)) activeIds.add(id);
    for (const g of w.splits) for (const id of g) activeIds.add(id);
  }
  let count = 0;
  for (const space of store.state.spaces) {
    for (const id of [...space.today]) {
      const tab = store.state.tabs[id];
      const rt = live.get(id);
      if (activeIds.has(id) || (tab.lastActiveAt || 0) > limit) continue;
      if (rt && !rt.wc.isDestroyed() && rt.wc.isCurrentlyAudible()) continue;
      any.close(id, { silent: true });
      count += 1;
    }
  }
  if (count) { store.save(); for (const w of windows.values()) w.layout(); OrbeWindow.pushAll(); }
}

module.exports = { OrbeWindow, windows, live, trusted, hooks, archiveStale, INTERNAL, UI_PRELOAD, isInternal };
