// Import depuis Arc : Espaces, onglets épinglés, dossiers et favoris.
// Lit le fichier de barre latérale d'Arc sur cette machine, sans le modifier.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { store, uid, SPACE_COLORS } = require('./store');

// macOS : ~/Library/Application Support/Arc ; Windows : dossier du paquet Arc (voir platform.js).
const ARC_FILE = require('./platform').arcSidebarFile();

// Arc enregistre ses listes sous la forme [id, objet, id, objet, …].
const objects = (list) => (Array.isArray(list) ? list.filter((x) => x && typeof x === 'object') : []);

function findColor(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 12) return null;
  if (typeof node.red === 'number' && typeof node.green === 'number' && typeof node.blue === 'number') {
    const hex = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
    return '#' + hex(node.red) + hex(node.green) + hex(node.blue);
  }
  for (const v of Object.values(node)) {
    const c = findColor(v, depth + 1);
    if (c) return c;
  }
  return null;
}

// Clé de profil Arc : « default » ou le nom de son dossier (« Profile 3 »).
function profileKey(p) {
  const custom = p && p.custom && p.custom._0;
  return custom && custom.directoryBasename ? String(custom.directoryBasename) : 'default';
}

// Une couleur de fond presque grise ne fait pas une bonne teinte d'Espace.
function vivid(hex) {
  if (!hex) return null;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return Math.max(r, g, b) - Math.min(r, g, b) > 40 ? hex : null;
}

function read(file = ARC_FILE) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const container = (raw.sidebar.containers || []).find((c) => c && c.items && c.spaces);
  if (!container) throw new Error('Format Arc non reconnu');
  const items = new Map(objects(container.items).map((o) => [o.id, o]));

  const tabOf = (it) => {
    const tab = it.data && it.data.tab;
    if (!tab || !/^https?:/i.test(tab.savedURL || '')) return null;
    return { type: 'tab', url: tab.savedURL, title: tab.savedTitle || '', name: it.title || '' };
  };
  // Aplati : dossiers imbriqués conservés, vues scindées remplacées par leurs onglets.
  const children = (id) => {
    const it = items.get(id);
    const out = [];
    for (const cid of (it && it.childrenIds) || []) {
      const child = items.get(cid);
      if (!child || !child.data) continue;
      if (child.data.tab) { const tab = tabOf(child); if (tab) out.push(tab); }
      else if (child.data.list) out.push({ type: 'folder', name: child.title || 'Dossier', children: children(cid) });
      else if (child.data.splitView) out.push(...children(cid));
    }
    return out;
  };
  const flat = (nodes) => nodes.flatMap((n) => (n.type === 'folder' ? flat(n.children) : [n]));

  const spaces = objects(container.spaces).map((sp) => {
    const ids = {};
    const c = sp.containerIDs || [];
    for (let i = 0; i < c.length - 1; i++) if (c[i] === 'pinned' || c[i] === 'unpinned') ids[c[i]] = c[i + 1];
    const icon = sp.customInfo && sp.customInfo.iconType && sp.customInfo.iconType.emoji_v2;
    return {
      arcId: sp.id,
      name: sp.title || 'Espace',
      icon: typeof icon === 'string' ? icon : '',
      color: vivid(findColor(sp.customInfo && sp.customInfo.windowTheme)),
      profile: profileKey(sp.profile),
      pinned: ids.pinned ? children(ids.pinned) : [],
      today: ids.unpinned ? flat(children(ids.unpinned)) : [],
    };
  });

  // Favoris : une liste par profil, sous la forme [profil, id de liste, …].
  const favorites = {};
  let key = 'default';
  for (const entry of container.topAppsContainerIDs || []) {
    if (entry && typeof entry === 'object') key = profileKey(entry);
    else if (typeof entry === 'string') {
      const list = favorites[key] || (favorites[key] = []);
      for (const tab of flat(children(entry))) if (!list.some((x) => x.url === tab.url)) list.push(tab);
    }
  }
  const used = new Set(spaces.map((s) => s.profile));
  for (const k of Object.keys(favorites)) if (!used.has(k) || !favorites[k].length) delete favorites[k];
  return { spaces, favorites, profiles: [...used] };
}

function count(data) {
  const walk = (nodes) => nodes.reduce((n, x) => n + (x.type === 'folder' ? walk(x.children) : 1), 0);
  const folders = (nodes) => nodes.reduce((n, x) => n + (x.type === 'folder' ? 1 + folders(x.children) : 0), 0);
  return {
    spaces: data.spaces.length,
    pinned: data.spaces.reduce((n, s) => n + walk(s.pinned), 0),
    folders: data.spaces.reduce((n, s) => n + folders(s.pinned), 0),
    today: data.spaces.reduce((n, s) => n + s.today.length, 0),
    favorites: Object.values(data.favorites).reduce((n, l) => n + l.length, 0),
    profiles: data.profiles.length,
  };
}

// Ajoute les données lues à l'état d'Orbe. Un Espace déjà importé est ignoré.
function merge(data, state = store.state) {
  const makeTab = (src, pinned) => {
    const tab = { id: uid(), url: src.url, title: src.title, favicon: '', createdAt: Date.now(), lastActiveAt: Date.now() };
    if (pinned) tab.homeUrl = src.url;
    if (pinned && src.name) tab.customTitle = src.name;
    state.tabs[tab.id] = tab;
    return tab.id;
  };
  const makeNodes = (nodes) => nodes.map((n) => (n.type === 'folder'
    ? { type: 'folder', id: uid(), name: n.name, open: false, children: makeNodes(n.children) }
    : { type: 'tab', id: makeTab(n, true) }));

  // Chaque profil Arc devient un profil Orbe (les connexions sont à refaire).
  const profileFor = (key) => {
    if (key === 'default') return 'default';
    let p = state.profiles.find((x) => x.arcKey === key);
    if (!p) {
      p = { id: uid(), name: store.t('profiles.name', null, { n: state.profiles.length + 1 }), arcKey: key };
      state.profiles.push(p);
      state.favs[p.id] = [];
    }
    return p.id;
  };

  const known = new Set(state.spaces.map((s) => s.arcId).filter(Boolean));
  let added = 0;
  for (const sp of data.spaces) {
    if (known.has(sp.arcId)) continue;
    const space = store.makeSpace(sp.name, sp.icon || '✨', sp.color || SPACE_COLORS[(state.spaces.length + added) % SPACE_COLORS.length]);
    space.arcId = sp.arcId;
    space.profileId = profileFor(sp.profile);
    space.pinned = makeNodes(sp.pinned);
    space.today = sp.today.map((t) => makeTab(t, false));
    state.spaces.push(space);
    added += 1;
  }
  if (added) {
    for (const [key, list] of Object.entries(data.favorites)) {
      const favs = state.favs[profileFor(key)];
      const urls = new Set(favs.map((id) => state.tabs[id].url));
      for (const fav of list) {
        if (urls.has(fav.url)) continue;
        urls.add(fav.url);
        favs.push(makeTab(fav, true));
      }
    }
    // L'Espace vide créé au premier lancement n'a plus d'utilité.
    const first = state.spaces[0];
    if (!first.arcId && !first.pinned.length && !first.today.length && state.spaces.length > 1) state.spaces.shift();
  }
  return added;
}

module.exports = { ARC_FILE, read, count, merge, available: () => !!ARC_FILE && fs.existsSync(ARC_FILE) };
