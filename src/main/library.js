// Bibliothèque : ce que la page interne `library.html` demande au processus
// principal. Historique, archive (recherche, filtres, restauration, suppression),
// téléchargements et médias, Espaces, Boosts.
// Chaque message vient d'une page de l'interface, mais ce qu'il porte est
// vérifié ici : identifiants recherchés dans les données, jamais de chemin ni
// d'adresse pris tels quels.
const { app, shell, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const { store, uid } = require('./store');
const downloads = require('./downloads');

const SECTIONS = ['history', 'archive', 'downloads', 'media', 'easels', 'spaces', 'boosts'];
const HOW = ['manual', 'auto', 'little']; // façon dont un onglet a rejoint l'archive
const MEDIA = /\.(png|jpe?g|gif|webp|avif|svg|mp4|mov|webm|mp3|wav|m4a)$/i;

// `window(sender)` : fenêtre Orbe de la page qui demande ; `startDrag` : remplacé pendant les tests.
const env = {
  window: () => null,
  startDrag: (wc, item) => wc.startDrag(item),
  clearArchive: (w) => require('./commands').clearArchive(w),
};

const t = (key, vars) => store.t(key, null, vars);

// --- Archive -------------------------------------------------------------------
// Les entrées d'avant cette version n'ont pas d'identifiant : elles en reçoivent un à la lecture.
function archive() {
  const list = store.state.archive;
  for (const a of list) if (!a.id) a.id = uid();
  return list;
}

function archiveRows({ q, how, space }) {
  const spaces = new Map(store.state.spaces.map((s) => [s.id, s]));
  const match = (a) => !q || (a.title || '').toLowerCase().includes(q) || (a.url || '').toLowerCase().includes(q);
  const rows = [];
  for (const a of archive()) {
    if (how && (a.by || 'manual') !== how) continue;
    if (space && a.spaceId !== space) continue;
    if (!match(a)) continue;
    const sp = spaces.get(a.spaceId);
    rows.push({ id: a.id, url: a.url, title: a.title, favicon: a.favicon || '', at: a.at, by: a.by || 'manual', space: sp ? `${sp.icon} ${sp.name}` : '' });
    if (rows.length >= 400) break;
  }
  return rows;
}

// Rouvre un onglet archivé dans son Espace d'origine (s'il existe encore) ; l'entrée quitte l'archive.
function restore(w, id) {
  const list = archive();
  const i = list.findIndex((a) => a.id === id);
  if (i < 0 || !w || w.incognito) return false;
  const a = list[i];
  if (!/^https?:/i.test(a.url || '')) return false;
  const space = w.data.spaces.find((s) => s.id === a.spaceId) || w.space;
  list.splice(i, 1);
  const tab = w.createTab(a.url, { space });
  if (a.title && a.title !== a.url) tab.title = a.title;
  if (a.favicon) tab.favicon = a.favicon;
  w.activate(tab.id);
  store.save();
  return { tabId: tab.id, spaceId: space.id };
}

function removeArchived(id) {
  const list = archive();
  const i = list.findIndex((a) => a.id === id);
  if (i < 0) return false;
  list.splice(i, 1);
  store.save();
  return true;
}

// --- Téléchargements et médias ---------------------------------------------------
const icons = new Map(); // chemin -> icône du fichier (pour le glisser hors d'Orbe)
let fallbackIcon = null;

// L'icône d'un fichier se demande au système, sans attendre : elle doit être prête
// au moment où l'utilisateur commence à glisser.
function warmIcon(file) {
  if (icons.has(file)) return;
  icons.set(file, null);
  if (icons.size > 400) icons.delete(icons.keys().next().value);
  app.getFileIcon(file, { size: 'normal' }).then((img) => { if (img && !img.isEmpty()) icons.set(file, img); }).catch(() => {});
}

function dragIcon(file) {
  const known = icons.get(file);
  if (known) return known;
  if (!fallbackIcon) {
    const img = nativeImage.createFromPath(path.join(__dirname, '..', '..', 'assets', 'icon.png'));
    fallbackIcon = img.isEmpty() ? img : img.resize({ width: 48, height: 48 });
  }
  return fallbackIcon;
}

function fileRows(list, q, media) {
  const match = (d) => !q || (d.name || '').toLowerCase().includes(q) || (d.url || '').toLowerCase().includes(q);
  const rows = [];
  for (const d of list) {
    if (media && !(d.state === 'completed' && MEDIA.test(d.name || ''))) continue;
    if (!match(d)) continue;
    const exists = d.state === 'completed' && fs.existsSync(d.path);
    if (media && !exists) continue;
    if (exists) warmIcon(d.path);
    rows.push({ ...d, exists });
    if (rows.length >= 200) break;
  }
  return rows;
}

// Glisser un fichier hors de la Bibliothèque : vers le Finder, un courriel, une autre application.
function drag(sender, id) {
  const d = store.state.downloads.find((x) => x.id === id);
  if (!d || d.state !== 'completed' || !sender || sender.isDestroyed() || !fs.existsSync(d.path)) return false;
  const icon = dragIcon(d.path);
  if (!icon || icon.isEmpty()) return false;
  env.startDrag(sender, { file: d.path, icon });
  return true;
}

// --- Espaces, Boosts --------------------------------------------------------------
const count = (nodes) => nodes.reduce((n, x) => n + (x.type === 'folder' ? count(x.children) : 1), 0);

function spaceRows(w, q) {
  const profiles = new Map(store.state.profiles.map((p) => [p.id, p.name]));
  return store.state.spaces
    .filter((s) => !q || s.name.toLowerCase().includes(q))
    .map((s) => ({ id: s.id, name: s.name, icon: s.icon, color: s.color, profile: profiles.get(s.profileId) || '', pinned: count(s.pinned), today: s.today.length, current: !!w && w.spaceId === s.id, only: store.state.spaces.length < 2 }));
}

function boostRows(q) {
  return Object.entries(store.state.boosts)
    .filter(([host]) => !q || host.toLowerCase().includes(q))
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([host, b]) => ({ host, enabled: b.enabled !== false, zaps: (b.zaps || []).length, css: (b.css || '').trim().length }));
}

// Après un changement de Boost : les pages ouvertes de ce site le reprennent.
function reapplyBoost(host) {
  const boosts = require('./boosts');
  const { live } = require('./window');
  for (const rt of live.values()) if (!rt.wc.isDestroyed() && boosts.hostOf(rt.wc.getURL()) === host) boosts.apply(rt.wc);
}

// --- Messages ----------------------------------------------------------------------
async function action(name, a, sender) {
  const s = store.state;
  const w = env.window(sender);
  switch (name) {
    case 'lib:get': {
      const o = a && typeof a === 'object' ? a : {};
      const q = String(o.q || '').toLowerCase().slice(0, 200);
      const match = (x) => !q || (x.title || '').toLowerCase().includes(q) || (x.url || '').toLowerCase().includes(q);
      return {
        history: Object.values(s.history).filter(match).sort((x, y) => y.last - x.last).slice(0, 400)
          .map((h) => ({ url: h.url, title: h.title || h.url, favicon: h.favicon || '', at: h.last })),
        archive: archiveRows({ q, how: HOW.includes(o.how) ? o.how : '', space: typeof o.space === 'string' ? o.space : '' }),
        downloads: fileRows(s.downloads, q, false),
        // Médias : images, vidéos et sons téléchargés, plus les captures d'Orbe.
        media: fileRows(s.downloads, q, true),
        spaces: spaceRows(w, q),
        boosts: boostRows(q),
        // Pour les filtres de l'archive.
        spaceNames: s.spaces.map((sp) => ({ id: sp.id, name: `${sp.icon} ${sp.name}` })),
        archiveTotal: s.archive.length,
      };
    }
    // Dernière section affichée : la Bibliothèque s'y rouvre (⇧⌘L).
    case 'lib:section':
      if (SECTIONS.includes(a) && s.window.librarySection !== a) { s.window.librarySection = a; store.save(true); }
      return true;
    case 'lib:clear':
      if (a === 'history') { s.history = {}; store.historyCount = 0; store.saveHistory(true); }
      // Vider l'archive ne se rattrape pas : la question est posée d'abord.
      if (a === 'archive') return env.clearArchive(w);
      if (a === 'downloads') s.downloads = s.downloads.filter((d) => d.state === 'progressing');
      store.save();
      return true;
    case 'lib:restore':
      return restore(w, String(a));
    case 'lib:archiveDelete':
      return removeArchived(String(a));
    case 'lib:reveal': {
      const d = s.downloads.find((x) => x.id === a);
      if (d) shell.showItemInFolder(d.path);
      return true;
    }
    // Un PDF s'ouvre dans un onglet ; un fichier exécutable demande confirmation.
    case 'lib:openFile':
      return downloads.action('dl:open', a, sender);
    case 'lib:drag':
      return drag(sender, String(a));
    case 'lib:space': {
      const o = a && typeof a === 'object' ? a : {};
      const sp = s.spaces.find((x) => x.id === o.id);
      if (!w || !sp) return false;
      if (o.do === 'focus') { w.switchSpace(sp.id); return true; }
      if (o.do === 'rename') { w.switchSpace(sp.id); w.askRename(sp.id); return true; }
      if (o.do === 'theme') { w.switchSpace(sp.id); w.openTheme(); return true; }
      if (o.do === 'delete') { await w.deleteSpace(sp.id); return true; }
      return false;
    }
    case 'lib:newSpace':
      if (w) w.newSpace();
      return !!w;
    case 'lib:boost': {
      const o = a && typeof a === 'object' ? a : {};
      const host = String(o.host || '');
      if (!Object.hasOwn(s.boosts, host)) return false;
      if (o.do === 'toggle') s.boosts[host].enabled = s.boosts[host].enabled === false;
      else if (o.do === 'delete') delete s.boosts[host];
      else if (o.do === 'open') return w ? !!w.newTab('https://' + host) : false;
      else return false;
      store.save();
      reapplyBoost(host);
      return true;
    }
    default:
      return undefined;
  }
}

module.exports = { action, env, SECTIONS, HOW, MEDIA, archive, restore, removeArchived, drag, internals: { icons, dragIcon } };
