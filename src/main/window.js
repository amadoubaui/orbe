// Une fenêtre Orbe : une vue « coque » (barre latérale) qui occupe toute la
// fenêtre, les vues web des onglets posées par-dessus dans la zone de contenu,
// et des vues flottantes (barre de commande, recherche, notifications).
const { app, BaseWindow, WebContentsView, Menu, clipboard, ClipboardItem, screen, dialog, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const { store, uid, SPACE_COLORS } = require('./store');
const sessions = require('./sessions');
const suggest = require('./suggest');
const adblock = require('./adblock');
const boosts = require('./boosts');
const platform = require('./platform');

// Marge autour de la page : 10 pt, comme mesuré dans Arc.
const PAD = 10;
const GAP = 8;
const RADIUS = 10;
const TOOLBAR_H = 40;
const TRAFFIC = { x: 15, y: 15 };
const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 420;
const UI_PRELOAD = path.join(__dirname, '../preload/ui.js');
const INTERNAL = 'orbe://app/';
const UNDO_MAX = 50; // actions de la barre latérale que ⌘Z peut défaire, par fenêtre

const windows = new Map(); // id BaseWindow -> OrbeWindow
const live = new Map(); // id onglet -> { view, wc, owner, loading, lastUsed }
const trusted = new WeakSet(); // webContents autorisés à parler au processus principal
const wcOwner = new Map(); // id webContents (coque, flottants) -> OrbeWindow
// `rightInset(fenêtre)` : place réservée à droite des pages (panneau latéral d'une
// extension) ; `layout(fenêtre)` : appelé à la fin de chaque mise en page.
const hooks = { changed: () => {}, openLittle: () => {}, openSettings: () => {}, extensionMenu: () => [], rightInset: () => 0, layout: () => {} };

const t = (key, vars) => store.t(key, null, vars);
const isInternal = (url) => (url || '').startsWith(INTERNAL);
const isErrorPage = (url) => (url || '').startsWith(INTERNAL + 'error.html');
// Pages internes pouvant s'ouvrir dans un onglet, avec accès à l'interface.
const INTERNAL_PAGES = new Set(['library.html', 'shortcuts.html', 'welcome.html', 'notes.html', 'easel.html']);
// Adresse fournie par une page web (lien, image, glisser-déposer) : seuls
// http et https sont acceptés, jamais file:, orbe: ou chrome:.
const webUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : null);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// Nom horodaté d'une capture ; deux captures dans la même seconde ne s'écrasent pas.
let lastStamp = '';
let stampCount = 0;
function captureStamp() {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  stampCount = stamp === lastStamp ? stampCount + 1 : 0;
  lastStamp = stamp;
  return stampCount ? `${stamp} (${stampCount + 1})` : stamp;
}

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
    this.closed = [];
    this.undoStack = [];
    this.redoStack = [];
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
      ...platform.windowChrome({ traffic: TRAFFIC, color: this.space.color, dark: nativeTheme.shouldUseDarkColors, translucent: store.state.settings.translucent }),
      visualEffectState: 'followWindow',
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
    // La fenêtre paraît sans attendre la barre latérale (60 à 100 ms gagnées).
    if (!process.env.ORBE_HIDE_UNTIL_READY) this.win.show();
    this.ui.webContents.once('did-finish-load', () => {
      this.layout();
      if (!this.win.isVisible()) this.win.show();
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
    platform.setButtons(this.win, visible, TRAFFIC);
  }

  makeUiView(page) {
    const view = new WebContentsView({ webPreferences: { preload: UI_PRELOAD, sandbox: true, contextIsolation: true } });
    view.setBackgroundColor('#00000000');
    const wc = view.webContents;
    trusted.add(wc);
    wcOwner.set(wc.id, this);
    wc.on('before-input-event', (e, input) => this.onInput(e, input, true));
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
    for (const sp of this.data.spaces) {
      for (const g of sp.splits || []) if (g.includes(id)) return g;
    }
    return null;
  }

  // Vues scindées : enregistrées avec l'Espace, elles survivent au redémarrage.
  get splits() {
    return this.data.spaces.flatMap((sp) => sp.splits || []);
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
    const top = platform.topInset(this.win, PAD, store.state.settings.showToolbar) + (store.state.settings.showToolbar ? TOOLBAR_H : 0);
    return {
      x: Math.round(PAD + (sw - PAD) * this.p),
      y: top,
      width: Math.max(100, (docked ? W - sw - PAD : W - 2 * PAD) - hooks.rightInset(this)),
      height: Math.max(100, H - top - PAD),
    };
  }

  // Largeur de chaque volet : parts égales, ou celles réglées à la souris.
  // Vue scindée empilée (volets l'un au-dessus de l'autre) ? Mémorisé par Espace,
  // sous l'identifiant du premier onglet du groupe.
  isVertical(group) {
    if (!group) return false;
    for (const sp of this.data.spaces) if ((sp.splits || []).includes(group)) return !!(sp.splitDirs && sp.splitDirs[group[0]] === 'v');
    return false;
  }

  toggleSplitDirection() {
    const group = this.activeId && this.groupOf(this.activeId);
    if (!group) return;
    const sp = this.data.spaces.find((x) => (x.splits || []).includes(group));
    if (!sp) return;
    const dirs = sp.splitDirs || (sp.splitDirs = {});
    if (dirs[group[0]] === 'v') delete dirs[group[0]]; else dirs[group[0]] = 'v';
    delete group.ratios;
    this.layout();
    this.changed();
  }

  // Rectangle de chaque volet : parts égales, ou celles réglées à la souris.
  paneRects(rect, ids) {
    const n = ids.length;
    if (!n) return [];
    const group = n > 1 ? this.groupOf(ids[0]) : null;
    const vertical = this.isVertical(group);
    let ratios = group && group.ratios && group.ratios.length === n ? group.ratios : null;
    if (!ratios) ratios = ids.map(() => 1 / n);
    const start = vertical ? rect.y : rect.x;
    const total = vertical ? rect.height : rect.width;
    const usable = total - GAP * (n - 1);
    const out = [];
    let pos = start;
    ratios.forEach((r, i) => {
      const size = Math.max(60, i === n - 1 ? start + total - pos : Math.round(usable * r));
      out.push(vertical
        ? { x: rect.x, y: Math.round(pos), width: rect.width, height: size, vertical }
        : { x: Math.round(pos), y: rect.y, width: size, height: rect.height, vertical });
      pos += size + GAP;
    });
    return out;
  }

  // Déplace la séparation entre les volets i et i+1 jusqu'à la position donnée
  // (abscisse, ou ordonnée pour une vue empilée).
  resizeSplit(i, at) {
    const ids = this.visibleIds();
    const group = ids.length > 1 ? this.groupOf(ids[0]) : null;
    if (!group || !(i >= 0 && i < ids.length - 1)) return;
    const rect = this.contentRect();
    const panes = this.paneRects(rect, ids);
    const vertical = panes[0].vertical;
    const usable = (vertical ? rect.height : rect.width) - GAP * (ids.length - 1);
    const ratios = panes.map((p) => (vertical ? p.height : p.width) / usable);
    const pair = ratios[i] + ratios[i + 1];
    const min = Math.min(0.15, pair / 2);
    const first = clamp((at - GAP / 2 - (vertical ? panes[i].y : panes[i].x)) / usable, min, pair - min);
    ratios[i] = first;
    ratios[i + 1] = pair - first;
    group.ratios = ratios;
    this.layout();
    this.sendState();
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
    const panes = this.paneRects(rect, ids);
    const paneW = n ? panes[Math.max(0, ids.indexOf(this.activeId))].width : 0;
    ids.forEach((id, i) => {
      const rt = this.ensureView(id);
      shown.add(rt.view);
      if (!this.attached || !this.attached.has(rt.view)) this.win.contentView.addChildView(rt.view, 1);
      rt.view.setBorderRadius(this.htmlFullscreen ? 0 : RADIUS);
      rt.view.setBounds({ x: panes[i].x, y: panes[i].y, width: panes[i].width, height: panes[i].height });
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
    if (this.floatView && this.peek) this.floatView.setBounds({ x: 0, y: 0, width: Math.min(W, this.sidebarWidth + 24), height: H });
    if (this.modalMode) this.modal.setBounds(full);
    if (this.findOpen && this.findView) {
      const i = Math.max(0, ids.indexOf(this.activeId));
      const right = panes[i] ? panes[i].x + panes[i].width : rect.x + paneW;
      this.findView.setBounds({ x: Math.round(right - 372), y: (panes[i] ? panes[i].y : rect.y) + 10, width: 360, height: 50 });
    }
    if (this.toastView) {
      this.toastView.setBounds({ x: Math.round(rect.x + rect.width / 2 - 190), y: rect.y + 12, width: 380, height: 46 });
    }
    hooks.layout(this);
  }

  // Anime l'ouverture de la barre latérale en ne déplaçant que la position des
  // pages : leur largeur ne change qu'une fois, donc une seule remise en page.
  animateTo(target) {
    clearInterval(this.anim);
    const from = this.p;
    if (from === target) { this.anim = null; this.layout(); return; }
    const t0 = Date.now();
    // Comme mesuré dans Arc : la barre disparaît d'un coup et revient en 50 ms.
    const DUR = target === 1 ? 50 : 0;
    if (!DUR) { this.p = target; this.anim = null; this.layout(); return; }
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
    if (this.peek) this.setPeek(false);
    if (this.floatView) { this.floatView.setVisible(false); try { this.win.contentView.removeChildView(this.floatView); } catch {} }
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
    // Comme dans Arc : la barre revient en flottant par-dessus la page, qui ne
    // bouge pas. Elle vit dans sa propre vue, posée au-dessus des onglets.
    clearTimeout(this.floatTimer);
    if (on) {
      if (!this.floatView) this.floatView = this.makeUiView('shell.html#flottant');
      this.win.contentView.addChildView(this.floatView);
      this.layout();
      this.floatView.setVisible(true);
    } else if (this.floatView) {
      // Le temps que la barre glisse hors de l'écran.
      this.floatTimer = setTimeout(() => {
        if (this.win.isDestroyed() || this.peek || !this.floatView) return;
        this.floatView.setVisible(false);
        try { this.win.contentView.removeChildView(this.floatView); } catch {}
      }, 220);
    }
    OrbeWindow.pushAll();
  }

  // Vue qui affiche la barre latérale en ce moment (ancrée ou flottante).
  get shellView() {
    return this.peek && this.floatView ? this.floatView : this.ui;
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
    clearTimeout(this.floatTimer);
    clearTimeout(this.statusTimer);
    for (const v of [this.ui, this.modal, this.findView, this.toastView, this.peekChrome, this.floatView, this.statusView, this.dropView]) {
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
      // nodeIntegrationInSubFrames : avec le bac à sable, cela ne fait qu'exécuter les scripts
      // de préchargement de la session dans les iframes (mots de passe) ; aucun accès à Node.
      webPreferences: { session: this.sessionFor(id), sandbox: true, contextIsolation: true, nodeIntegrationInSubFrames: true, preload: internal ? UI_PRELOAD : undefined },
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
    const touch = (lazy) => { if (!incognito) store.save(lazy); OrbeWindow.pushAll(); };
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
      // Comme dans Arc : depuis un onglet épinglé ou un favori, un lien cliqué
      // vers un autre site s'ouvre en aperçu, sans quitter la page épinglée.
      let lastClick = 0;
      wc.on('before-mouse-event', (e, mouse) => { if (mouse.type === 'mouseUp' && mouse.button === 'left') lastClick = Date.now(); });
      wc.on('will-navigate', (e, url) => {
        if (!e.isMainFrame || e.defaultPrevented || !store.state.settings.peekLinks) return;
        if (!tab.homeUrl || Date.now() - lastClick > 1200 || !webUrl(url) || sameHost(url, tab.url)) return;
        if (rt.owner.locate(rt.id) && rt.owner.visibleIds().includes(rt.id)) {
          e.preventDefault();
          lastClick = 0;
          rt.owner.openPeek(url, rt.id);
        }
      });
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
      touch(true); // un titre peut attendre la prochaine écriture
    });
    wc.on('page-favicon-updated', (e, icons) => {
      tab.favicon = icons[0] || '';
      if (!incognito) store.touchHistory(tab.url, { favicon: tab.favicon });
      touch(true);
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
    if (!incognito) wc.on('dom-ready', () => boosts.apply(wc));
    wc.on('did-navigate-in-page', (e, url, isMainFrame) => { if (isMainFrame) navigated(url); });
    wc.on('update-target-url', (e, url) => rt.owner.linkStatus(rt, url));
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
      // Vignette pour la bascule ⌃Tab, prise au moment de quitter la page.
      if (prevId !== id && prevRt && !prevRt.wc.isDestroyed() && !this.incognito) {
        prevRt.wc.capturePage().then((img) => {
          if (!img.isEmpty()) prevRt.thumb = img.resize({ width: 320, quality: 'good' }).toJPEG(70).toString('base64');
        }).catch(() => {});
      }
      if (prevId !== id && prevRt && !prevRt.wc.isDestroyed() && prevRt.wc.isCurrentlyAudible()) {
        prevRt.playing = true;
        this.mediaId = prevId;
        if (!(this.groupOf(id) || []).includes(prevId) && !this.data.tabs[prevId].muted) this.pip(prevRt, true);
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
    if (this.modalMode) return this.modal.webContents.focus();
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
    delete g.ratios;
    for (const sp of this.data.spaces) if (sp.splitDirs) delete sp.splitDirs[id];
    if (g.length < 2) {
      for (const sp of this.data.spaces) {
        const i = (sp.splits || []).indexOf(g);
        if (i >= 0) sp.splits.splice(i, 1);
      }
    }
  }

  // ⌘W : un onglet du jour est archivé ; un onglet épinglé est simplement
  // déchargé et reste dans la barre latérale.
  close(id = this.activeId, { silent = false } = {}) {
    const loc = id && this.locate(id);
    if (!loc || loc.node.type === 'folder') return;
    const space = loc.space || this.space;
    const wasActive = this.activeBySpace[space.id] === id;
    const next = wasActive ? this.nextActiveAfter(id, space) : null;
    const group = this.groupOf(id);
    const split = group ? { ids: [...group], ratios: group.ratios && [...group.ratios], vertical: this.isVertical(group) } : null;
    this.leaveSplit(id);
    const tab = this.data.tabs[id];
    // Trace de l'onglet archivé : de quoi le rouvrir à sa place (⌘Z, ⇧⌘T).
    let rec = null;
    if (loc.list === 'today') {
      loc.arr.splice(loc.index, 1);
      rec = { tab: { ...tab }, spaceId: space.id, index: loc.index, active: wasActive, split };
      this.closed.push(rec);
      if (this.closed.length > 50) this.closed.shift();
      if (!this.incognito) store.archive({ ...tab, spaceId: space.id });
      delete this.data.tabs[id];
    } else if (tab.homeUrl) {
      tab.url = tab.homeUrl;
    }
    OrbeWindow.destroyView(id);
    OrbeWindow.forget(id, this.data);
    if (wasActive && next) this.activeBySpace[space.id] = next;
    if (silent) return rec;
    if (rec) this.recordClosed('undo.archive', [rec]);
    this.layout();
    this.focusContent();
    this.remember();
    this.changed();
    return undefined;
  }

  // ⇧⌘T : le dernier onglet (ou aperçu) fermé revient, à sa place.
  reopenClosed() {
    const last = this.closed.pop();
    if (!last) return;
    if (last.peek) this.reopenPeek(last.peek);
    else this.restoreClosed([last]);
  }

  clearToday() {
    const space = this.space;
    const active = this.activeId;
    const ids = space.today.filter((id) => id !== active).reverse();
    if (!ids.length) return;
    this.closeGroup(ids, 'undo.clearToday');
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
    const before = this.places([id]);
    loc.arr.splice(loc.index, 1);
    if (loc.list === 'today') {
      space.pinned.push({ type: 'tab', id });
      tab.homeUrl = tab.url;
    } else {
      space.today.unshift(id);
      delete tab.homeUrl;
      delete tab.customTitle;
    }
    this.recordPlaces(loc.list === 'today' ? 'undo.pin' : 'undo.unpin', before);
    this.changed();
  }

  toggleFavorite(id = this.activeId) {
    const loc = id && this.locate(id);
    if (!loc || loc.node.type === 'folder') return;
    const tab = this.data.tabs[id];
    const before = this.places([id]);
    loc.arr.splice(loc.index, 1);
    if (loc.list === 'favorites') {
      this.space.today.unshift(id);
      delete tab.homeUrl;
    } else {
      this.favorites.push(id);
      tab.homeUrl = tab.homeUrl || tab.url;
    }
    this.recordPlaces(loc.list === 'favorites' ? 'undo.removeFavorite' : 'undo.addFavorite', before);
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
    // Un dossier va dans les épinglés ou dans un autre dossier, jamais dans
    // lui-même ni dans l'un de ses propres sous-dossiers.
    if (isFolder && to !== 'pinned' && to !== 'folder') return;
    if (isFolder && to === 'folder' && (folderId === id || findNode(node.children, folderId))) return;
    let at = typeof index === 'number' ? index : dest.length;
    if (dest === loc.arr && loc.index < at) at -= 1;
    const before = this.places([id]);
    loc.arr.splice(loc.index, 1);
    const flat = to === 'favorites' || to === 'today';
    dest.splice(clamp(at, 0, dest.length), 0, flat ? id : node);
    if (!isFolder) {
      const tab = this.data.tabs[id];
      if (to === 'today') { delete tab.homeUrl; delete tab.customTitle; } else if (!tab.homeUrl) tab.homeUrl = tab.url;
      if (loc.space && space.id !== this.space.id && this.activeBySpace[space.id] === id) delete this.activeBySpace[space.id];
    }
    this.recordPlaces(isFolder ? 'undo.moveFolder' : 'undo.move', before);
    this.changed();
  }

  moveToSpace(id, spaceId) {
    const loc = this.locate(id);
    const target = this.data.spaces.find((s) => s.id === spaceId);
    if (!loc || !target || loc.space === target) return;
    const wasActive = this.activeId === id;
    const next = wasActive ? this.nextActiveAfter(id, this.space) : null;
    const before = this.places([id]);
    OrbeWindow.forget(id, this.data);
    // Changer de profil change de cookies : la page sera rechargée.
    if (loc.space && loc.space.profileId !== target.profileId) OrbeWindow.destroyView(id);
    loc.arr.splice(loc.index, 1);
    if (loc.list === 'pinned') target.pinned.push(loc.node);
    else { target.today.unshift(id); delete this.data.tabs[id].homeUrl; }
    if (wasActive && next) this.activeBySpace[this.space.id] = next;
    this.recordPlaces('undo.moveToSpace', before);
    for (const w of windows.values()) if (w.data === this.data) w.layout();
    this.changed();
  }

  // --- Sélection multiple ---------------------------------------------------
  // La sélection vit dans la barre latérale ; le processus principal ne reçoit
  // que des listes d'identifiants, vérifiées une à une : seuls restent les
  // onglets (jamais les dossiers) affichés dans cette fenêtre — favoris du
  // profil et Espace courant —, sans doublon et dans l'ordre d'affichage.
  checkIds(ids) {
    if (!Array.isArray(ids) || ids.length > 5000) return [];
    const wanted = new Set(ids.filter((x) => typeof x === 'string'));
    if (!wanted.size) return [];
    return this.orderedIds().filter((id) => wanted.has(id) && this.data.tabs[id]);
  }

  // Sélection annoncée par la barre latérale, revérifiée à chaque usage.
  selected() {
    return this.checkIds(this.selection);
  }

  // Après une action sur la sélection : la barre latérale la vide.
  dropSelection() {
    this.selection = [];
    this.selRev = (this.selRev || 0) + 1;
  }

  closeMany(ids) {
    ids = this.checkIds(ids);
    if (!ids.length) return;
    this.closeGroup([...ids].reverse(), ids.length > 1 ? 'undo.archiveMany' : 'undo.archive');
    this.dropSelection();
    this.layout();
    this.focusContent();
    this.remember();
    this.changed();
  }

  // Dépose plusieurs onglets au même endroit, dans leur ordre d'affichage.
  moveMany({ ids, to, folderId, index }, label = 'undo.moveMany') {
    ids = this.checkIds(ids);
    if (!ids.length) return;
    let dest;
    if (to === 'favorites') dest = this.favorites;
    else if (to === 'today') dest = this.space.today;
    else if (to === 'pinned') dest = this.space.pinned;
    else if (to === 'folder') {
      const f = typeof folderId === 'string' ? findNode(this.space.pinned, folderId) : null;
      if (!f || f.node.type !== 'folder') return;
      dest = f.node.children;
    } else return;
    const flat = to === 'favorites' || to === 'today';
    const key = (x) => (flat ? x : x.id);
    // Repère : la première ligne, à partir de la position visée, qui ne part pas avec le lot.
    const moving = new Set(ids);
    const from = Number.isFinite(index) ? clamp(Math.floor(index), 0, dest.length) : dest.length;
    const before = dest.slice(from).map(key).find((k) => !moving.has(k));
    const places = this.places(ids);
    for (const id of ids) {
      const loc = this.locate(id);
      loc.arr.splice(loc.index, 1);
      const tab = this.data.tabs[id];
      if (to === 'today') { delete tab.homeUrl; delete tab.customTitle; } else if (!tab.homeUrl) tab.homeUrl = tab.url;
    }
    const at = before === undefined ? dest.length : dest.findIndex((x) => key(x) === before);
    dest.splice(at, 0, ...ids.map((id) => (flat ? id : { type: 'tab', id })));
    if (label) this.recordPlaces(label, places);
    this.dropSelection();
    this.changed();
  }

  // Épingle les onglets du jour de la sélection ; si tous sont déjà épinglés, les désépingle.
  pinMany(ids) {
    ids = this.checkIds(ids).filter((id) => this.locate(id).list !== 'favorites');
    if (!ids.length) return;
    const unpin = ids.every((id) => this.locate(id).list === 'pinned');
    if (unpin) this.moveMany({ ids, to: 'today', index: 0 }, 'undo.unpinMany');
    else this.moveMany({ ids: ids.filter((id) => this.locate(id).list === 'today'), to: 'pinned' }, 'undo.pinMany');
  }

  // Ajoute la sélection aux favoris ; si tous en sont déjà, les en retire.
  favoriteMany(ids) {
    ids = this.checkIds(ids);
    if (!ids.length || this.incognito) return;
    const remove = ids.every((id) => this.locate(id).list === 'favorites');
    if (remove) this.moveMany({ ids, to: 'today', index: 0 }, 'undo.removeFavorite');
    else this.moveMany({ ids: ids.filter((id) => this.locate(id).list !== 'favorites'), to: 'favorites' }, 'undo.addFavorite');
  }

  moveManyToSpace(ids, spaceId) {
    ids = this.checkIds(ids).filter((id) => this.locate(id).list !== 'favorites');
    if (!ids.length || !this.data.spaces.some((s) => s.id === spaceId)) return;
    // Les épinglés s'ajoutent à la suite ; les onglets du jour arrivent en tête,
    // donc du dernier au premier pour garder leur ordre.
    const today = ids.filter((id) => this.locate(id).list === 'today');
    const before = this.places(ids);
    this.mute(() => {
      for (const id of ids) if (!today.includes(id)) this.moveToSpace(id, spaceId);
      for (const id of today.reverse()) this.moveToSpace(id, spaceId);
    });
    this.recordPlaces('undo.moveToSpace', before);
    this.dropSelection();
    this.changed();
  }

  copyLinks(ids) {
    ids = this.checkIds(ids);
    if (!ids.length) return;
    clipboard.writeText(ids.map((id) => this.data.tabs[id].url).join('\n'));
    this.toast(t('toast.linksCopied', { n: ids.length }));
  }

  // Chaque copie se place sous son modèle (en tête d'Aujourd'hui pour un épinglé
  // ou un favori) et se charge en arrière-plan ; l'onglet affiché ne change pas.
  duplicateMany(ids) {
    ids = this.checkIds(ids).filter((id) => !this.data.tabs[id].internal);
    if (!ids.length) return;
    for (const id of [...ids].reverse()) {
      const src = this.data.tabs[id];
      const tab = this.createTab(src.url, { after: id });
      tab.title = src.title;
      tab.favicon = src.favicon;
      this.ensureView(tab.id);
    }
    OrbeWindow.trimLive();
    this.dropSelection();
    this.changed();
  }

  // « Nouveau dossier avec la sélection » : le dossier prend la place du premier
  // onglet épinglé de la sélection (sinon la fin des épinglés) et reçoit le lot.
  folderFromSelection(ids) {
    ids = this.checkIds(ids);
    if (!ids.length) return;
    const folder = { type: 'folder', id: uid(), name: t('tabs.folderDefault'), open: true, children: [] };
    const first = ids.map((id) => this.locate(id)).find((loc) => loc.list === 'pinned');
    const before = this.places(ids);
    if (first) first.arr.splice(first.index, 0, folder); else this.space.pinned.push(folder);
    this.moveMany({ ids, to: 'folder', folderId: folder.id }, null);
    const after = this.places(ids);
    let back = null;
    this.record('undo.newFolder',
      () => { this.restorePlaces(before); back = this.dissolveFolder(folder.id); },
      () => { back(); this.restorePlaces(after); });
    this.askRename(folder.id);
  }

  // --- Annulation (⌘Z, ⇧⌘Z) ------------------------------------------------
  // Pile des actions de la barre latérale : propre à la fenêtre, bornée, jamais
  // enregistrée sur disque. Chaque entrée sait se défaire (`undo`) et se refaire
  // (`redo`) ; `stale(sens)` dit qu'elle n'a plus d'objet — l'onglet a déjà été
  // rouvert par ⇧⌘T, par exemple — et elle est alors sautée.
  record(label, undo, redo, stale) {
    if (this.replaying) return;
    this.undoStack.push({ label, undo, redo, stale });
    if (this.undoStack.length > UNDO_MAX) this.undoStack.shift();
    this.redoStack.length = 0;
    OrbeWindow.pushAll();
  }

  // Exécute `fn` sans rien empiler (actions composées, rejeu d'une entrée).
  mute(fn) {
    const was = this.replaying;
    this.replaying = true;
    try { return fn(); } finally { this.replaying = was; }
  }

  // Défait (`undo`) ou refait (`redo`) la dernière entrée valable. Renvoie false
  // s'il n'y a rien à faire : ⌘Z garde alors son sens habituel dans la page.
  replay(way) {
    const from = way === 'undo' ? this.undoStack : this.redoStack;
    const to = way === 'undo' ? this.redoStack : this.undoStack;
    for (;;) {
      const entry = from.pop();
      if (!entry) return false;
      if (entry.stale && entry.stale(way)) continue;
      this.mute(() => entry[way]());
      to.push(entry);
      this.dropSelection();
      for (const w of windows.values()) if (w.data === this.data) w.layout();
      this.remember();
      this.changed();
      return true;
    }
  }

  // Libellé de l'action que ⌘Z (ou ⇧⌘Z) toucherait, pour le menu Édition.
  pendingLabel(way) {
    const stack = way === 'undo' ? this.undoStack : this.redoStack;
    for (let i = stack.length - 1; i >= 0; i--) if (!(stack[i].stale && stack[i].stale(way))) return stack[i].label;
    return null;
  }

  // Emplacement d'une ligne (onglet ou dossier) : liste, Espace ou profil,
  // dossier parent, rang ; pour un onglet, ce que l'épinglage lui attache.
  placeOf(id) {
    const loc = this.locate(id);
    if (!loc) return null;
    let parentId = null;
    if (loc.list === 'pinned' && loc.arr !== loc.space.pinned) {
      const owner = (nodes) => {
        for (const n of nodes) {
          if (n.type !== 'folder') continue;
          if (n.children === loc.arr) return n.id;
          const deeper = owner(n.children);
          if (deeper) return deeper;
        }
        return null;
      };
      parentId = owner(loc.space.pinned);
    }
    const tab = loc.node.type === 'folder' ? null : this.data.tabs[id];
    return { id, node: loc.node, list: loc.list, spaceId: loc.space ? loc.space.id : null, profileId: loc.profileId || null, parentId, index: loc.index, homeUrl: tab && tab.homeUrl, customTitle: tab && tab.customTitle };
  }

  places(ids) {
    return ids.map((id) => this.placeOf(id)).filter(Boolean);
  }

  // Remet des lignes aux emplacements relevés par `places` : même liste, même
  // dossier, même rang (au plus près si la liste a changé entre-temps).
  restorePlaces(places) {
    const d = this.data;
    const todo = places.filter((p) => p.node.type === 'folder' || d.tabs[p.id]);
    const from = new Map();
    for (const p of todo) {
      const loc = this.locate(p.id);
      if (!loc) continue;
      from.set(p.id, loc.space);
      loc.arr.splice(loc.index, 1);
    }
    // Par rang croissant : chaque ligne retrouve exactement le sien.
    for (const p of [...todo].sort((a, b) => a.index - b.index)) {
      const space = p.list === 'favorites' ? null : (d.spaces.find((s) => s.id === p.spaceId) || this.space);
      let arr;
      if (!space) arr = d.favs[p.profileId] || this.favorites;
      else if (p.list === 'today') arr = space.today;
      else {
        const f = p.parentId ? findNode(space.pinned, p.parentId) : null;
        arr = f && f.node.type === 'folder' ? f.node.children : space.pinned;
      }
      const node = p.node.type === 'folder' ? p.node : { type: 'tab', id: p.id };
      arr.splice(clamp(p.index, 0, arr.length), 0, p.list === 'pinned' ? node : p.id);
      if (p.node.type === 'folder') continue;
      const tab = d.tabs[p.id];
      if (p.homeUrl) tab.homeUrl = p.homeUrl; else delete tab.homeUrl;
      if (p.customTitle) tab.customTitle = p.customTitle; else delete tab.customTitle;
      // Changement d'Espace : l'onglet n'est plus « actif » là d'où il vient, et
      // un autre profil veut une page rechargée avec ses propres cookies.
      const was = from.get(p.id);
      if (was !== undefined && was !== space) {
        OrbeWindow.forget(p.id, d);
        if (was && space && was.profileId !== space.profileId) OrbeWindow.destroyView(p.id);
      }
    }
  }

  // Retient pour ⌘Z un déplacement de lignes : `before` est le relevé pris avant.
  recordPlaces(label, before) {
    if (this.replaying || !before.length) return;
    const after = this.places(before.map((p) => p.id));
    const same = after.length === before.length && before.every((p, i) => ['list', 'spaceId', 'profileId', 'parentId', 'index'].every((k) => p[k] === after[i][k]));
    if (!same) this.record(label, () => this.restorePlaces(before), () => this.restorePlaces(after));
  }

  // Archive un lot d'onglets en une seule action annulable. Renvoie leur nombre.
  closeGroup(ids, label) {
    const recs = ids.map((id) => this.close(id, { silent: true })).filter(Boolean);
    this.recordClosed(label, recs);
    return recs.length;
  }

  recordClosed(label, recs) {
    if (!recs.length) return;
    const ids = recs.map((r) => r.tab.id);
    this.record(label,
      () => this.restoreClosed(recs),
      () => recs.splice(0, recs.length, ...ids.map((id) => this.close(id, { silent: true })).filter(Boolean)),
      (way) => (way === 'undo' ? recs.every((r) => this.data.tabs[r.tab.id]) : !ids.some((id) => this.data.tabs[id])));
  }

  // Rouvre des onglets archivés : même identifiant, même Espace, même rang (du
  // dernier fermé au premier, chacun retrouve sa place), vue scindée comprise.
  restoreClosed(recs) {
    const d = this.data;
    const back = [];
    for (const rec of [...recs].reverse()) {
      const id = rec.tab.id;
      if (d.tabs[id]) continue;
      const space = d.spaces.find((s) => s.id === rec.spaceId) || this.space;
      d.tabs[id] = { ...rec.tab, lastActiveAt: Date.now() };
      space.today.splice(clamp(rec.index, 0, space.today.length), 0, id);
      const i = this.closed.indexOf(rec);
      if (i >= 0) this.closed.splice(i, 1);
      if (!this.incognito) {
        const a = store.state.archive.findIndex((x) => x.url === rec.tab.url);
        if (a >= 0) store.state.archive.splice(a, 1);
      }
      back.push(rec);
    }
    for (const rec of back) {
      if (!rec.split) continue;
      const ids = rec.split.ids.filter((x) => d.tabs[x]);
      const groups = new Set(ids.map((x) => this.groupOf(x)).filter(Boolean));
      const loc = this.locate(ids[0]);
      let g = [...groups][0];
      // Regroupés autrement depuis : on n'y touche pas.
      if (ids.length < 2 || groups.size > 1 || !loc || !loc.space || (g && g.some((x) => !ids.includes(x)))) continue;
      const sp = loc.space;
      if (!g) (sp.splits || (sp.splits = [])).push(g = []);
      if (sp.splitDirs && g.length) delete sp.splitDirs[g[0]];
      g.splice(0, g.length, ...ids);
      if (rec.split.ratios && ids.length === rec.split.ids.length) g.ratios = [...rec.split.ratios]; else delete g.ratios;
      if (rec.split.vertical) (sp.splitDirs || (sp.splitDirs = {}))[g[0]] = 'v';
    }
    // L'onglet qui était affiché le redevient ; un onglet rouvert seul aussi.
    const show = back.find((r) => r.active) || (back.length === 1 ? back[0] : null);
    if (show) this.activate(show.tab.id);
    return back.length;
  }

  // Retire un dossier : ses lignes prennent sa place. Renvoie de quoi le remettre.
  dissolveFolder(id) {
    const loc = this.locate(id);
    if (!loc || loc.node.type !== 'folder') return () => {};
    const folder = loc.node;
    const place = this.placeOf(id);
    const kids = this.places(folder.children.map((n) => n.id));
    loc.arr.splice(loc.index, 1, ...folder.children);
    folder.children = [];
    return () => {
      if (this.locate(id)) return;
      this.restorePlaces([place]);
      this.restorePlaces(kids);
    };
  }

  // Fermeture d'un aperçu par l'utilisateur (Échap, ⌘W, bouton) : ⌘Z ou ⇧⌘T le rouvrent.
  dismissPeek() {
    const state = this.peekState;
    if (!state) return;
    const wc = state.view.webContents;
    const rec = { peek: { url: (!wc.isDestroyed() && webUrl(wc.getURL())) || state.url, from: state.from } };
    this.closePeek();
    if (!webUrl(rec.peek.url)) return;
    const forget = () => { const i = this.closed.indexOf(rec); if (i >= 0) this.closed.splice(i, 1); };
    this.closed.push(rec);
    if (this.closed.length > 50) this.closed.shift();
    this.record('undo.closePeek',
      () => { forget(); this.reopenPeek(rec.peek); },
      () => { this.closePeek(); this.closed.push(rec); },
      (way) => (way === 'undo' ? !this.closed.includes(rec) : !this.peekState));
  }

  reopenPeek({ url, from }) {
    if (this.locate(from) && this.activeId !== from) this.activate(from);
    this.openPeek(url, from);
  }

  // --- Dossiers -------------------------------------------------------------
  newFolder() {
    const folder = { type: 'folder', id: uid(), name: t('tabs.folderDefault'), open: true, children: [] };
    this.space.pinned.push(folder);
    let back = null;
    this.record('undo.newFolder', () => { back = this.dissolveFolder(folder.id); }, () => back());
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
    if (!f || f.node.type !== 'folder') return;
    let back = this.dissolveFolder(id);
    this.record('undo.deleteFolder', () => back(), () => { back = this.dissolveFolder(id); });
    this.changed();
  }

  askRename(id) {
    if (!this.sidebarVisible && !this.peek) this.toggleSidebar(true);
    setTimeout(() => {
      const view = this.shellView;
      if (view.webContents.isDestroyed()) return;
      view.webContents.focus();
      view.webContents.send('edit', id);
    }, 60);
  }

  rename(id, name) {
    name = String(name || '').trim().slice(0, 80);
    const space = this.data.spaces.find((x) => x.id === id);
    const loc = space ? null : this.locate(id);
    if (!space && !loc) return;
    // Un onglet porte un titre personnalisé (vide : il reprend celui de la page) ;
    // un dossier ou un Espace garde son nom si la saisie est vide.
    const isTab = !space && loc.node.type !== 'folder';
    const named = space || loc.node;
    // L'onglet est relu à chaque fois : archivé puis rouvert, ce n'est plus le même objet.
    const get = () => (isTab ? (this.data.tabs[id] || {}).customTitle : named.name);
    const set = (v) => {
      const tab = isTab ? this.data.tabs[id] : null;
      if (!isTab) { if (v) named.name = v; } else if (!tab) return; else if (v) tab.customTitle = v; else delete tab.customTitle;
    };
    const before = get();
    set(name);
    const after = get();
    if (after !== before) this.record(space ? 'undo.renameSpace' : (isTab ? 'undo.renameTab' : 'undo.renameFolder'), () => set(before), () => set(after));
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
    let back = null;
    this.record('undo.newSpace', () => { back = this.removeSpace(space.id); }, () => back && back());
    this.changed();
    this.askRename(space.id);
  }

  async deleteSpace(id = this.spaceId) {
    const spaces = this.data.spaces;
    const space = spaces.find((s) => s.id === id);
    if (!space || spaces.length < 2 || this.incognito) return;
    const r = await dialog.showMessageBox(this.win, {
      type: 'warning',
      message: t('spaces.deleteConfirm', { name: space.name }),
      detail: t('spaces.deleteDetail'),
      buttons: [t('spaces.delete').replace('…', ''), t('edit.undo')],
      defaultId: 1,
      cancelId: 1,
    });
    if (r.response !== 0) return;
    let back = this.removeSpace(id);
    if (back) this.record('undo.deleteSpace', () => back(), () => { back = this.removeSpace(id) || back; });
  }

  // Supprime un Espace sans rien demander. Renvoie de quoi le rétablir : l'Espace
  // à son rang, avec ses épinglés, ses dossiers, ses onglets du jour, ses vues
  // scindées et son thème. Ses pages, elles, sont fermées : elles se rechargeront.
  removeSpace(id) {
    const spaces = this.data.spaces;
    const i = spaces.findIndex((s) => s.id === id);
    if (i < 0 || spaces.length < 2) return null;
    const space = spaces[i];
    const tabs = {};
    const archived = [];
    const splits = (space.splits || []).map((g) => Object.assign([...g], g.ratios ? { ratios: [...g.ratios] } : {}));
    const splitDirs = { ...(space.splitDirs || {}) };
    const active = this.activeBySpace[id];
    for (const tid of [...walk(space.pinned), ...space.today]) {
      const tab = this.data.tabs[tid];
      tabs[tid] = tab;
      if (space.today.includes(tid) && !this.incognito) {
        const top = store.state.archive[0];
        store.archive({ ...tab, spaceId: space.id });
        if (store.state.archive[0] !== top) archived.push(store.state.archive[0]);
      }
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
    return () => {
      if (spaces.includes(space)) return;
      if (!this.data.profiles.some((p) => p.id === space.profileId)) space.profileId = 'default';
      spaces.splice(clamp(i, 0, spaces.length), 0, space);
      Object.assign(this.data.tabs, tabs);
      space.splits = splits.map((g) => Object.assign([...g], g.ratios ? { ratios: [...g.ratios] } : {}));
      space.splitDirs = { ...splitDirs };
      if (!this.incognito) store.state.archive = store.state.archive.filter((a) => !archived.includes(a));
      if (active && tabs[active]) this.activeBySpace[id] = active;
      this.switchSpace(id);
    };
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

  // Dégradé (seconde couleur) et grain du fond de l'Espace.
  setThemeExtra({ color2, grain }) {
    const space = this.space;
    if (color2 === '' || (typeof color2 === 'string' && /^#[0-9a-f]{6}$/i.test(color2))) space.color2 = color2;
    if (typeof grain === 'number' && grain >= 0 && grain <= 1) space.grain = Math.round(grain * 100) / 100;
    this.changed();
  }

  // --- Vue scindée ----------------------------------------------------------
  splitWith(a, b, quiet) {
    if (a === b) return;
    let g = this.groupOf(a);
    if (g && g.length >= 4) return this.toast(t('toast.splitMax'));
    this.leaveSplit(b);
    g = this.groupOf(a);
    if (!g) {
      g = [a];
      const loc = this.locate(a);
      const sp = (loc && loc.space) || this.space;
      (sp.splits || (sp.splits = [])).push(g);
    }
    g.splice(g.indexOf(a) + 1, 0, b);
    delete g.ratios;
    if (!quiet) this.activate(b);
  }

  addSplit() {
    if (!this.activeId) return this.openCommand('new');
    const g = this.groupOf(this.activeId);
    if (g && g.length >= 4) return this.toast(t('toast.splitMax'));
    this.openCommand('split');
  }

  focusPane(n) {
    const id = this.visibleIds()[n - 1];
    if (id && this.visibleIds().length > 1) this.activate(id);
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
      webPreferences: { session: this.sessionFor(fromId), sandbox: true, contextIsolation: true, nodeIntegrationInSubFrames: true },
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
      if (input.type === 'keyDown' && input.key === 'Escape') { e.preventDefault(); return this.dismissPeek(); }
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
    const shown = !!this.modalMode;
    this.modalMode = mode;
    const [W, H] = this.win.getContentSize();
    // Déjà affichée : ne pas la rattacher, cela lui ferait perdre le clavier.
    if (!shown) this.win.contentView.addChildView(this.modal); // repasse au premier plan
    this.modal.setBounds({ x: 0, y: 0, width: W, height: H });
    this.modal.setVisible(true);
    this.modal.webContents.send('overlay', { mode, ...payload });
    if (focus && !(shown && this.modal.webContents.isFocused())) this.modal.webContents.focus();
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
      centerX: Math.round(W / 2),
      anchor: mode === 'edit' && this.sidebarVisible ? { x: 8, y: 46, width: Math.max(460, this.sidebarWidth + 220) } : null,
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
    this.showModal('theme', { color: s.color, icon: s.icon, color2: s.color2 || '', grain: s.grain || 0, colors: SPACE_COLORS, x: this.sidebarWidth + 10 });
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
      const thumb = live.get(id) && live.get(id).thumb;
      return { id, title: tab.customTitle || tab.title || suggest.strip(tab.url), favicon: this.incognito ? '' : tab.favicon, thumb: thumb ? 'data:image/jpeg;base64,' + thumb : '' };
    });
    // La vue de la bascule prend le clavier : c'est elle qui verra le
    // relâchement de ⌃ (remettre une vue au premier plan retire le clavier à la page).
    this.showModal('switcher', { items, index: s.index }, true);
  }

  switcherCommit() {
    const s = this.switcher;
    if (!s) return;
    const id = s.ids[s.index];
    this.hideModal();
    if (id) this.activate(id);
  }

  onInput(e, input, fromUi) {
    if (input.type === 'keyDown' && input.key === 'Tab' && input.control && !input.meta && !input.alt) {
      // Dans une vue de l'interface, on laisse passer la touche : la bloquer ici
      // ferait aussi disparaître le relâchement de ⌃ qui valide la bascule.
      if (!fromUi) e.preventDefault();
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

  // Pendant qu'on glisse un onglet de la barre latérale, une zone de dépôt
  // couvre la page : y lâcher l'onglet crée une vue scindée.
  dragZone(on) {
    if (this.win.isDestroyed()) return;
    if (!on) {
      if (this.dropView) { this.dropView.setVisible(false); try { this.win.contentView.removeChildView(this.dropView); } catch {} }
      return;
    }
    if (!this.activeId || this.peekState || this.modalMode) return;
    const show = () => {
      if (this.win.isDestroyed() || this.dropView.webContents.isDestroyed()) return;
      this.dropView.setBounds(this.contentRect());
      this.dropView.setBorderRadius(RADIUS);
      this.win.contentView.addChildView(this.dropView);
      this.dropView.setVisible(true);
      this.dropView.webContents.send('overlay', { mode: 'drop', label: t('view.addSplit') });
    };
    if (!this.dropView) {
      this.dropView = this.makeUiView('overlay.html#drop');
      this.dropView.setVisible(false);
      this.dropView.webContents.once('did-finish-load', show);
    } else show();
  }

  dropSplit(id) {
    this.dragZone(false);
    const loc = this.locate(id);
    if (!loc || loc.node.type === 'folder' || !this.activeId || id === this.activeId) return;
    this.splitWith(this.activeId, id);
  }

  // Adresse du lien survolé, en bas à gauche de la page.
  linkStatus(rt, url) {
    if (this.win.isDestroyed() || !this.visibleIds().includes(rt.id)) return;
    clearTimeout(this.statusTimer);
    const hide = () => {
      if (!this.statusView || this.win.isDestroyed()) return;
      this.statusView.setVisible(false);
      try { this.win.contentView.removeChildView(this.statusView); } catch {}
    };
    if (!url) { this.statusTimer = setTimeout(hide, 120); return; }
    const show = () => {
      if (this.win.isDestroyed() || this.statusView.webContents.isDestroyed()) return;
      const b = rt.view.getBounds();
      const width = Math.min(b.width - 16, Math.max(120, 14 + url.length * 6.6));
      this.statusView.setBounds({ x: b.x + 6, y: b.y + b.height - 30, width: Math.round(width), height: 26 });
      this.win.contentView.addChildView(this.statusView);
      this.statusView.setVisible(true);
      this.statusView.webContents.send('overlay', { mode: 'status', text: url });
    };
    if (!this.statusView) {
      this.statusView = this.makeUiView('overlay.html#status');
      this.statusView.setVisible(false);
      this.statusView.webContents.once('did-finish-load', show);
    } else if (!this.statusView.webContents.isLoading()) show();
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

  // Copie la sélection sous forme de citation Markdown, avec sa source.
  async copyQuote() {
    const tab = this.activeId && this.data.tabs[this.activeId];
    const wc = this.activeRt && this.activeRt.wc;
    if (!tab || !wc || wc.isDestroyed()) return;
    const text = String(await wc.executeJavaScript('String(getSelection())').catch(() => '')).trim();
    if (!text) return this.copyUrl(true);
    const quote = text.split(/\n+/).map((l) => '> ' + l).join('\n');
    clipboard.writeText(`${quote}\n>\n> — [${tab.title || tab.url}](${tab.url})`);
    this.toast(t('toast.quoteCopied'));
    return undefined;
  }

  zoom(delta) {
    const wc = this.activeWc;
    if (!wc) return;
    wc.setZoomLevel(delta === 0 ? 0 : clamp(wc.getZoomLevel() + delta, -4, 5));
    this.toast(`Zoom ${Math.round(wc.getZoomFactor() * 100)} %`);
  }

  // Son d'interface, joué par la coque (réglage « Sons »).
  sound(name) {
    if (!store.state.settings.sounds || this.ui.webContents.isDestroyed()) return;
    this.ui.webContents.send('sound', name);
  }

  // ⇧⌘2, comme dans Arc : on choisit une zone (Entrée ou un clic = la page
  // visible, Échap annule), puis ce qu'on en fait.
  async capture(opts = {}) {
    const wc = this.activeWc;
    if (!wc) return undefined;
    const easels = require('./easels');
    const area = opts.area !== undefined ? opts.area : await easels.pickArea(wc, t('capture.hint'));
    if (!area || wc.isDestroyed()) return undefined;
    const rect = area === 'full' ? undefined : area;
    const image = await wc.capturePage(rect).catch(() => null);
    if (!image || image.isEmpty()) return undefined;
    this.sound('capture');
    const png = image.toPNG();
    const copy = () => { clipboard.write([new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) })]).catch(() => {}); };
    const save = () => {
      const stamp = captureStamp();
      fs.writeFile(path.join(app.getPath('downloads'), `Orbe ${stamp}.png`), png, () => {});
    };
    const done = (what) => {
      if (what === 'copy') { copy(); this.toast(t('capture.copied')); }
      else if (what === 'save') { save(); this.toast(t('capture.saved')); }
      else if (what === 'easel') {
        // Le tableau attend la zone en pixels de la page (avant zoom).
        const k = wc.getZoomFactor() || 1;
        easels.capture(this, rect ? { rect: { x: rect.x / k, y: rect.y / k, width: rect.width / k, height: rect.height / k } } : { full: true });
      }
      else { copy(); save(); this.toast(t('toast.captured')); }
      return what;
    };
    if (opts.then) return done(opts.then);
    // Zone choisie : petit menu à l'endroit de la sélection.
    const b = this.activeRt && this.activeRt.wc === wc ? this.activeRt.view.getBounds() : { x: 0, y: 0 };
    this.menuOpen = true;
    Menu.buildFromTemplate([
      { label: t('capture.copy'), click: () => done('copy') },
      { label: t('capture.save'), click: () => done('save') },
      { label: t('capture.both'), click: () => done('both') },
      { type: 'separator' },
      { label: t('easel.capture'), enabled: !this.incognito, click: () => done('easel') },
    ]).popup({ window: this.win, x: Math.round(b.x + (rect ? rect.x + rect.width / 2 : 40)), y: Math.round(b.y + (rect ? rect.y + rect.height : 40) + 6), callback: () => { this.menuOpen = false; } });
    return 'menu';
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
      const stamp = captureStamp();
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

  // Active ou coupe le bloqueur pour le site affiché, puis recharge la page.
  toggleSiteBlocking() {
    const tab = this.activeId && this.data.tabs[this.activeId];
    if (!tab || !/^https?:/i.test(tab.url)) return;
    const allowed = adblock.isSiteAllowed(tab.url);
    adblock.allowSite(tab.url, !allowed);
    this.toast(t(allowed ? 'adblock.onSite' : 'adblock.offSite', { site: suggest.strip(new URL(tab.url).origin) }));
    this.reload(false);
    OrbeWindow.pushAll();
  }

  shieldMenu() {
    const tab = this.activeId && this.data.tabs[this.activeId];
    const on = store.state.settings.adblock;
    const web = !!tab && /^https?:/i.test(tab.url);
    const wc = this.activeWc;
    const n = wc ? (adblock.stats().blockedByTab.get(wc.id) || 0) : 0;
    // Extensions installées : un clic ouvre leur fenêtre, ancrée sous l'adresse.
    let actions = [];
    try { actions = require('./ext-host').actionsFor(this) || []; } catch {}
    const extItems = actions.map((x) => ({
      label: x.badgeText ? `${x.title}  (${x.badgeText})` : x.title,
      enabled: x.enabled !== false,
      click: () => require('./ext-host').openPopup(this, x.id, { x: 12, y: 86 }),
    }));
    this.popup([
      ...extItems,
      ...(extItems.length ? [{ type: 'separator' }] : []),
      { label: t('adblock.count', { n }), enabled: false },
      { type: 'separator' },
      { label: t('adblock.thisSite'), type: 'checkbox', checked: on && web && !adblock.isSiteAllowed(tab.url), enabled: on && web, click: () => this.toggleSiteBlocking() },
      { label: t('adblock.everywhere'), type: 'checkbox', checked: on, click: () => require('./commands').setSetting('adblock', !on) },
      { type: 'separator' },
      { label: t('edit.copyUrl'), enabled: !!tab, click: () => this.copyUrl(false) },
      { label: t('file.capture').replace('…', ''), enabled: !!tab, click: () => this.capture() },
      { label: t('boost.edit'), enabled: web && !this.incognito, click: () => this.run('boost') },
      { label: t('boost.zapCmd'), enabled: web && !this.incognito, click: () => this.run('zap') },
      { type: 'separator' },
      { label: t('view.clearCookies'), enabled: web, click: () => this.clearAndReload('cookies') },
      { label: t('site.resetPerms'), enabled: web, click: () => {
        try { delete store.state.permissions[new URL(tab.url).origin]; store.save(); } catch {}
      } },
    ]);
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

  tabMenu(id, ids) {
    const many = this.checkIds(ids);
    if (many.length > 1 && many.includes(id)) return this.tabsMenu(many);
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
        this.closeGroup(loc.arr.slice(loc.index + 1).reverse(), 'undo.archiveMany');
        this.layout();
        this.changed();
      } });
    }
    this.popup(tpl);
  }

  // Menu d'une sélection de plusieurs onglets : chaque action porte sur tous.
  tabsMenuTemplate(ids) {
    const n = ids.length;
    const lists = ids.map((id) => this.locate(id).list);
    const favs = lists.every((l) => l === 'favorites');
    const pinned = lists.every((l) => l === 'pinned');
    const others = this.data.spaces.filter((s) => s !== this.space);
    const tpl = [
      { label: t('tabs.copyLinks'), click: () => this.copyLinks(ids) },
      { label: t('tabs.duplicate'), click: () => this.duplicateMany(ids) },
      { type: 'separator' },
      { label: t(pinned ? 'tabs.unpinMany' : 'tabs.pinMany', { n }), visible: !favs, enabled: pinned || lists.includes('today'), click: () => this.pinMany(ids) },
      { label: t(favs ? 'tabs.removeFavorite' : 'tabs.addFavorite'), visible: !this.incognito, click: () => this.favoriteMany(ids) },
      { label: t('tabs.folderFromSelection'), click: () => this.folderFromSelection(ids) },
    ];
    if (others.length && !lists.includes('favorites')) {
      tpl.push({ label: t('tabs.moveTo'), submenu: others.map((s) => ({ label: `${s.icon} ${s.name}`, click: () => this.moveManyToSpace(ids, s.id) })) });
    }
    tpl.push({ type: 'separator' }, { label: t('tabs.closeMany', { n }), click: () => this.closeMany(ids) });
    return tpl;
  }

  tabsMenu(ids) {
    this.popup(this.tabsMenuTemplate(ids));
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
    // Éléments ajoutés par les extensions (chrome.contextMenus).
    const fromExtensions = hooks.extensionMenu(wc, p);
    if (fromExtensions.length) { sep(); tpl.push(...fromExtensions); }
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
        // Comme dans Arc, une vue scindée n'occupe qu'une ligne : celle de son
        // premier onglet, qui porte les icônes et les titres des autres.
        partners: g && g[0] === id ? g.slice(1).filter((x) => d.tabs[x]).map((x) => ({ id: x, title: d.tabs[x].customTitle || d.tabs[x].title || suggest.strip(d.tabs[x].url), favicon: d.tabs[x].favicon, url: d.tabs[x].url })) : null,
        grouped: !!g && g[0] !== id,
        active: g && g[0] === id ? g.includes(activeId) : id === activeId,
        shown: false,
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
    const payload = {
      lang: settings.lang,
      appearance: settings.appearance,
      translucent: settings.translucent,
      dark: nativeTheme.shouldUseDarkColors,
      incognito: this.incognito,
      sidebar: { visible: this.sidebarVisible, peek: this.peek, width: this.sidebarWidth },
      toolbar: settings.showToolbar,
      fullScreen: this.win.isFullScreen(),
      spaceDir: dir,
      space: { id: space.id, name: space.name, icon: space.icon, color: space.color, color2: space.color2 || '', grain: space.grain || 0 },
      spaces: d.spaces.map((s) => ({ id: s.id, name: s.name, icon: s.icon, color: s.color })),
      favorites: this.favorites.map(tabVM),
      pinned: space.pinned.map(nodeVM),
      today: space.today.map(tabVM),
      activeId,
      selRev: this.selRev || 0,
      nav: {
        url: tab ? tab.url : '',
        internal: tab ? isInternal(tab.url) : false,
        title: tab ? (tab.title || '') : '',
        loading: !!(this.activeRt && this.activeRt.loading),
        canBack: !!(wc && wc.navigationHistory.canGoBack()),
        canForward: !!(wc && wc.navigationHistory.canGoForward()),
        blocked: wc && settings.adblock ? (adblock.stats().blockedByTab.get(wc.id) || 0) : 0,
        shield: !settings.adblock ? 'off' : (tab && adblock.isSiteAllowed(tab.url) ? 'allowed' : 'on'),
      },
      // Boutons des extensions, sous l'adresse.
      extensions: (() => {
        try { return (require('./ext-host').actionsFor(this) || []).map((x) => ({ id: x.id, title: x.title, icon: typeof x.icon === 'string' ? x.icon : '', badge: x.badgeText, badgeColor: x.badgeColor, badgeTextColor: x.badgeTextColor, enabled: x.enabled })); } catch { return []; }
      })(),
      dividers: (() => {
        const ids = this.visibleIds();
        if (ids.length < 2 || this.htmlFullscreen) return [];
        const rect = this.contentRect();
        return this.paneRects(rect, ids).slice(0, -1).map((p) => (p.vertical
          ? { v: true, x: p.x, y: p.y + p.height, w: p.width }
          : { x: p.x + p.width, y: rect.y, h: rect.height }));
      })(),
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
    };
    platform.syncChrome(this.win, { color: space.color, dark: payload.dark, toolbar: settings.showToolbar, translucent: settings.translucent });
    this.ui.webContents.send('state', payload);
    if (this.floatView && !this.floatView.webContents.isDestroyed()) this.floatView.webContents.send('state', payload);
  }

  // --- Messages venant de l'interface ---------------------------------------
  handle(action, a) {
    switch (action) {
      case 'ready': return this.sendState();
      // Clic sur l'onglet déjà affiché : rien à faire, et surtout ne pas
      // reprendre le clavier (second clic d'un double-clic pour renommer).
      case 'activate': return a === this.activeId && live.has(a) && !this.peekState ? undefined : this.activate(a);
      // Variante { ids } : l'action porte sur la sélection (liste vérifiée par checkIds).
      case 'close': return a && typeof a === 'object' ? this.closeMany(a.ids) : this.close(a);
      case 'select': this.selection = this.checkIds(a); return undefined;
      case 'openCommand': return this.openCommand(a);
      case 'toggleSidebar': return this.toggleSidebar();
      case 'sidebarWidth': return this.setSidebarWidth(a);
      case 'switchSpace': return this.switchSpace(a);
      case 'stepSpace': return this.stepSpace(a);
      case 'tabMenu': return a && typeof a === 'object' ? this.tabMenu(String(a.id), a.ids) : this.tabMenu(a);
      case 'spaceMenu': return this.spaceMenu(a);
      case 'sidebarMenu': return this.sidebarMenu();
      case 'shieldMenu': return this.shieldMenu();
      case 'rename': return this.rename(a.id, a.name);
      case 'toggleFolder': return this.toggleFolder(a);
      case 'move': return a && Array.isArray(a.ids) ? this.moveMany(a) : this.move(a);
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
      case 'switcherCommit': return this.switcherCommit();
      case 'find': return this.find(String(a.text || ''), a);
      case 'findClose': return this.closeFind();
      case 'theme': return this.setTheme(a);
      case 'themeExtra': return this.setThemeExtra(a || {});
      case 'dragZone': return this.dragZone(!!a);
      case 'dragZoneOver': if (this.dropView && !this.dropView.webContents.isDestroyed()) this.dropView.webContents.send('overlay', { mode: 'drop', label: t('view.addSplit'), over: !!a }); return undefined;
      case 'dropSplit': return this.dropSplit(String(a));
      case 'splitResize': return this.resizeSplit(Number(a.i), Number(a.at != null ? a.at : a.x));
      case 'peekClose': return this.dismissPeek();
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
