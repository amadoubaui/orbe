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

const DEFAULT_SETTINGS = {
  lang: 'fr',
  searchEngine: 'google',
  suggestions: true,
  archiveAfterHours: 12,
  appearance: 'auto',
  translucent: true,
  showToolbar: false,
  sidebarWidth: 250,
  maxLiveTabs: 14,
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
    this.state = this.normalize(raw || {});
    return this.state;
  }

  normalize(s) {
    s.version = 1;
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
    s.history = s.history || {};
    s.downloads = s.downloads || [];
    s.permissions = s.permissions || {};
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

  // Écriture différée : plusieurs modifications rapprochées = une seule écriture.
  save() {
    if (!this.file || this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, 500);
  }

  flush() {
    if (!this.file) return;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const tmp = this.file + '.tmp';
    try {
      fs.writeFileSync(tmp, JSON.stringify(this.state));
      if (fs.existsSync(this.file)) fs.copyFileSync(this.file, this.file + '.bak');
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
    if (title) e.title = title;
    if (favicon) e.favicon = favicon;
    if (this.historyCount == null) this.historyCount = Object.keys(h).length;
    else if (isNew) this.historyCount += 1;
    if (this.historyCount > HISTORY_MAX + 500) {
      const all = Object.values(h).sort((a, b) => b.last - a.last).slice(0, HISTORY_MAX);
      this.state.history = Object.fromEntries(all.map((x) => [x.url, x]));
      this.historyCount = all.length;
    }
    this.save();
  }

  touchHistory(url, patch) {
    const e = this.state.history[url];
    if (e) { Object.assign(e, patch); this.save(); }
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
