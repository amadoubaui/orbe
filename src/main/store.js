// Données persistantes d'Orbe : espaces, onglets, archive, historique, réglages.
// Un seul fichier JSON, écrit de façon atomique et différée pour ne jamais
// bloquer l'interface.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const locales = require('../shared/locales');

const HISTORY_MAX = 8000;
const ARCHIVE_MAX = 2000;
const DOWNLOADS_MAX = 300;

const SPACE_COLORS = ['#7c6cf0', '#3b82f6', '#06b6d4', '#10b981', '#84cc16', '#f59e0b', '#f97316', '#ef4444', '#ec4899', '#a855f7', '#64748b', '#78716c'];

const uid = () => crypto.randomBytes(6).toString('base64url');
// Une icône « data: » volumineuse n'a pas sa place dans l'historique.
const lightIcon = (u) => !!u && !(u.startsWith('data:') && u.length > 2048);
const INTERNAL_PAGE = /^orbe:\/\/app\/(library|shortcuts|welcome|notes|easel)\.html/;

const DEFAULT_SETTINGS = {
  lang: 'fr',
  searchEngine: 'google',
  suggestions: true,
  archiveAfterHours: 12,
  appearance: 'auto',
  translucent: true,
  showToolbar: false,
  sidebarWidth: 250,
  maxLiveTabs: 30,
  peekLinks: true,
  routes: [],
  externalLinks: 'window',
  autoPip: true,
  sounds: true,
  // Fenêtre des réglages à volets (validation : src/main/prefs.js).
  showFullUrl: true,
  warnOnQuit: false,
  restoreSession: true,
  haptics: true,
  peekShift: true,
  littleAltClick: true,
  littleShortcut: '',
  littleArchiveHours: 0,
  cookieBanners: false,
  themeData: false,
  boostsEnabled: true,
  mediaControls: true,
  tabKeysFavorites: true,
  tabKeysNinthLast: true,
  devSites: [],
  downloadDir: '',
  profileSettings: {},
  shortcuts: {},
  adblock: true,
  adblockAllow: [],
  passwordSave: true,
  passwordFill: true,
  // Téléchargements : demander où enregistrer, PDF ouverts dans un onglet (le dossier : `downloadDir`, plus haut).
  downloadAsk: false,
  downloadOpenPdf: true,
};

class Store {
  constructor() {
    this.file = null;
    this.state = null;
    this.timer = null;
    this.listeners = new Set();
  }

  load(dir) {
    this.file = path.join(dir, 'orbe.json');
    let raw = null;
    try {
      raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      try { raw = JSON.parse(fs.readFileSync(this.file + '.bak', 'utf8')); } catch {}
    }
    // Copie de secours : une fois par lancement, à partir d'un fichier lisible.
    if (raw) { try { fs.copyFileSync(this.file, this.file + '.bak'); } catch {} }
    // L'historique vit dans son propre fichier : il est gros et change à chaque
    // page, alors que l'état (onglets, Espaces) est petit et s'écrit souvent.
    this.historyFile = path.join(dir, 'history.json');
    if (raw && raw.history && Object.keys(raw.history).length) this.historyDirty = true; // ancien format : à déplacer
    else {
      let h = null;
      try { h = JSON.parse(fs.readFileSync(this.historyFile, 'utf8')); } catch {
        try { h = JSON.parse(fs.readFileSync(this.historyFile + '.bak', 'utf8')); } catch {}
      }
      if (h && typeof h === 'object') { raw = raw || {}; raw.history = h; try { fs.copyFileSync(this.historyFile, this.historyFile + '.bak'); } catch {} }
    }
    this.state = this.normalize(raw || {});
    if (this.historyDirty) this.saveHistory();
    return this.state;
  }

  normalize(s) {
    const from = s.version || 0;
    s.version = 2;
    s.settings = { ...DEFAULT_SETTINGS, ...(s.settings || {}) };
    s.tabs = s.tabs || {};
    // Profils : chacun a ses cookies, ses connexions et ses favoris.
    if (!Array.isArray(s.profiles) || !s.profiles.length) s.profiles = [{ id: 'default', name: this.t('profiles.default', s.settings.lang) }];
    if (!s.profiles.some((p) => p.id === 'default')) s.profiles.unshift({ id: 'default', name: this.t('profiles.default', s.settings.lang) });
    const profileIds = new Set(s.profiles.map((p) => p.id));
    s.favs = s.favs || {};
    if (Array.isArray(s.favorites)) { s.favs.default = s.favorites; delete s.favorites; }
    const favSeen = new Set();
    for (const id of Object.keys(s.favs)) if (!profileIds.has(id)) delete s.favs[id];
    for (const id of profileIds) s.favs[id] = (s.favs[id] || []).filter((tid) => s.tabs[tid] && !favSeen.has(tid) && favSeen.add(tid));
    s.archive = s.archive || [];
    // Non énumérable : JSON.stringify(état) ne l'emporte pas dans orbe.json.
    const history = s.history && typeof s.history === 'object' ? s.history : {};
    delete s.history;
    Object.defineProperty(s, 'history', { value: history, writable: true, enumerable: false, configurable: true });
    s.downloads = s.downloads || [];
    // Un téléchargement interrompu par la fermeture ne reprendra pas.
    for (const d of s.downloads) if (d.state === 'progressing') { d.state = 'interrupted'; d.paused = false; d.stalled = false; d.canResume = !!d.resume; }
    // Version 2 : l'accès des pages internes repose sur un drapeau explicite.
    if (from < 2) for (const tab of Object.values(s.tabs)) if (INTERNAL_PAGE.test(tab.url || '')) tab.internal = true;
    s.permissions = s.permissions || {};
    s.boosts = s.boosts || {};
    s.notes = Array.isArray(s.notes) ? s.notes : [];
    s.window = s.window || {};
    if (!Array.isArray(s.spaces) || !s.spaces.length) {
      s.spaces = [this.makeSpace(this.t('spaces.firstName', s.settings.lang), '🏠', SPACE_COLORS[0])];
    }
    // Répare les références orphelines (fichier modifié à la main, crash…).
    const seen = favSeen;
    const clean = (nodes) => nodes.filter((n) => {
      if (n.type === 'folder') { n.children = clean(n.children || []); return true; }
      if (!s.tabs[n.id] || seen.has(n.id)) return false;
      seen.add(n.id);
      return true;
    });
    for (const sp of s.spaces) {
      if (!profileIds.has(sp.profileId)) sp.profileId = 'default';
      sp.pinned = clean(sp.pinned || []);
      sp.splits = (sp.splits || []).map((g) => (Array.isArray(g) ? g.filter((id) => s.tabs[id]) : [])).filter((g) => g.length > 1);
      sp.today = (sp.today || []).filter((id) => s.tabs[id] && !seen.has(id) && seen.add(id));
    }
    for (const id of Object.keys(s.tabs)) if (!seen.has(id)) delete s.tabs[id];
    return s;
  }

  makeSpace(name, icon, color) {
    return { id: uid(), name, icon: icon || '✨', color: color || SPACE_COLORS[Math.floor(Math.random() * SPACE_COLORS.length)], profileId: 'default', pinned: [], today: [] };
  }

  t(key, lang, vars) {
    const l = lang || (this.state && this.state.settings.lang) || 'fr';
    let str = (locales[l] && locales[l][key]) || locales.fr[key] || key;
    if (vars) for (const k of Object.keys(vars)) str = str.replace(`{${k}}`, vars[k]);
    return str;
  }

  // Écriture différée et asynchrone : plusieurs modifications rapprochées
  // donnent une seule écriture, qui ne bloque pas l'interface.
  // `lazy` : changement mineur (titre, icône d'une page) qui peut attendre ;
  // un changement normal survenant entre-temps ramène l'écriture à 1,5 s.
  save(lazy = false) {
    if (!this.file) return;
    if (this.timer) {
      if (lazy || !this.lazyTimer) return;
      clearTimeout(this.timer);
    }
    this.lazyTimer = lazy;
    this.timer = setTimeout(() => { this.timer = null; this.lazyTimer = false; this.write(); }, lazy ? 8000 : 1500);
  }

  async write() {
    if (this.writing) { this.dirty = true; return; }
    this.writing = true;
    const tmp = this.file + '.tmp';
    try {
      await fs.promises.writeFile(tmp, JSON.stringify(this.state));
      await fs.promises.rename(tmp, this.file);
    } catch (err) {
      console.error('[orbe] sauvegarde impossible', err);
    }
    this.writing = false;
    if (this.dirty) { this.dirty = false; this.save(); }
  }

  // Historique : écrit à part, rarement (20 s après la dernière visite, ou tout
  // de suite avec `now`), sans jamais bloquer une écriture de l'état.
  saveHistory(now = false) {
    if (!this.historyFile) return;
    this.historyDirty = true;
    if (this.historyTimer) { if (!now) return; clearTimeout(this.historyTimer); }
    this.historyTimer = setTimeout(() => { this.historyTimer = null; this.writeHistory(); }, now ? 0 : 20000);
    if (this.historyTimer.unref) this.historyTimer.unref();
  }

  async writeHistory() {
    if (this.historyWriting) { this.historyAgain = true; return; }
    this.historyWriting = true;
    this.historyDirty = false;
    const tmp = this.historyFile + '.tmp';
    try {
      await fs.promises.writeFile(tmp, JSON.stringify(this.state.history));
      await fs.promises.rename(tmp, this.historyFile);
    } catch (err) {
      this.historyDirty = true;
      console.error('[orbe] historique : sauvegarde impossible', err);
    }
    this.historyWriting = false;
    if (this.historyAgain) { this.historyAgain = false; this.saveHistory(); }
  }

  // Écriture immédiate, à la fermeture de l'application.
  flush() {
    if (!this.file) return;
    if (this.historyTimer) { clearTimeout(this.historyTimer); this.historyTimer = null; }
    if (this.historyDirty && this.historyFile) {
      try {
        fs.writeFileSync(this.historyFile + '.sync.tmp', JSON.stringify(this.state.history));
        fs.renameSync(this.historyFile + '.sync.tmp', this.historyFile);
        this.historyDirty = false;
      } catch (err) {
        console.error('[orbe] historique : sauvegarde impossible', err);
      }
    }
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.dirty = false;
    const tmp = this.file + '.sync.tmp';
    try {
      fs.writeFileSync(tmp, JSON.stringify(this.state));
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error('[orbe] sauvegarde impossible', err);
    }
  }

  // --- Historique -----------------------------------------------------------
  visit(url, title, favicon) {
    if (!/^https?:/i.test(url)) return;
    const h = this.state.history;
    const isNew = !h[url];
    const e = h[url] || (h[url] = { url, visits: 0 });
    e.visits += 1;
    e.last = Date.now();
    if (title) e.title = String(title).slice(0, 300);
    if (lightIcon(favicon)) e.favicon = favicon;
    if (this.historyCount == null) this.historyCount = Object.keys(h).length;
    else if (isNew) this.historyCount += 1;
    if (this.historyCount > HISTORY_MAX + 500) {
      const all = Object.values(h).sort((a, b) => b.last - a.last).slice(0, HISTORY_MAX);
      this.state.history = Object.fromEntries(all.map((x) => [x.url, x]));
      this.historyCount = all.length;
    }
    this.saveHistory();
  }

  touchHistory(url, patch) {
    const e = this.state.history[url];
    if (!e) return;
    if (patch.title) e.title = String(patch.title).slice(0, 300);
    if (lightIcon(patch.favicon)) e.favicon = patch.favicon;
    this.saveHistory();
  }

  archive(entry) {
    if (!/^https?:/i.test(entry.url || '')) return;
    this.state.archive.unshift({ url: entry.url, title: entry.title || entry.url, favicon: entry.favicon || '', spaceId: entry.spaceId, at: Date.now() });
    if (this.state.archive.length > ARCHIVE_MAX) this.state.archive.length = ARCHIVE_MAX;
    this.save();
  }

  addDownload(d) {
    this.state.downloads.unshift(d);
    if (this.state.downloads.length > DOWNLOADS_MAX) this.state.downloads.length = DOWNLOADS_MAX;
    this.save();
  }
}

module.exports = { store: new Store(), uid, SPACE_COLORS, DEFAULT_SETTINGS };
