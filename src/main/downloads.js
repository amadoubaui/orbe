// Téléchargements : dossier de destination, « toujours demander », pause,
// reprise, annulation, reprise après interruption, mise en garde pour les
// fichiers exécutables, PDF ouverts dans un onglet une fois téléchargés.
//
// Sécurité :
//  - le nom du fichier proposé par le site est réduit à un simple nom (jamais un
//    chemin) et ne remplace jamais un fichier existant ;
//  - un fichier exécutable n'est jamais ouvert tout seul : il est signalé, et
//    son ouverture depuis Orbe demande une confirmation qui nomme sa provenance ;
//  - seuls les PDF sont ouverts automatiquement, dans la visionneuse de Chromium
//    (bac à sable), jamais par une application du système.
const { app, dialog, shell, BaseWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { store, uid } = require('./store');

// Extensions de fichiers qui peuvent exécuter du code à l'ouverture.
const DANGEROUS = new Set(['dmg', 'pkg', 'mpkg', 'app', 'command', 'tool', 'terminal', 'workflow', 'action', 'scpt', 'scptd', 'applescript', 'sh', 'bash', 'zsh', 'csh', 'ksh', 'fish', 'run', 'bin',
  'exe', 'msi', 'msix', 'msp', 'appx', 'appxbundle', 'bat', 'cmd', 'com', 'scr', 'pif', 'cpl', 'lnk', 'ps1', 'psm1', 'vbs', 'vbe', 'jse', 'wsf', 'wsh', 'hta', 'reg', 'dll', 'sys', 'inf', 'url',
  'jar', 'jnlp', 'apk', 'deb', 'rpm', 'iso', 'img', 'webloc', 'desktop', 'appimage']);

const env = {
  // Fenêtre Orbe (BaseWindow) de la page qui télécharge, pour y attacher les boîtes de dialogue.
  ownerWindow: () => null,
  profileSession: () => null, // identifiant de profil -> session
  openInTab: () => false, // (adresse, webContents d'origine) -> ouvre un onglet
  settingsChanged: () => {},
  // Boîtes de dialogue du système ; remplacées pendant les tests.
  saveDialog: (parent, opts) => (parent ? dialog.showSaveDialogSync(parent, opts) : dialog.showSaveDialogSync(opts)),
  confirm: async (parent, opts) => (await (parent ? dialog.showMessageBox(parent, opts) : dialog.showMessageBox(opts))).response === 0,
  pickFolder: async (parent, opts) => { const r = await (parent ? dialog.showOpenDialog(parent, opts) : dialog.showOpenDialog(opts)); return r.canceled ? '' : r.filePaths[0] || ''; },
  openPath: (file) => shell.openPath(file),
};
const items = new Map(); // identifiant -> DownloadItem en cours (cette exécution d'Orbe)
const resuming = new Map(); // chemin du fichier -> enregistrement dont la reprise est demandée
const profiles = new WeakMap(); // session -> identifiant de profil
const t = (key, vars) => store.t(key, null, vars);

const extOf = (name) => path.extname(String(name || '')).slice(1).toLowerCase();
const isDangerous = (name) => DANGEROUS.has(extOf(name));
const isPdf = (name, mime) => extOf(name) === 'pdf' || mime === 'application/pdf';

// Dossier de destination : celui des réglages s'il existe encore, sinon Téléchargements.
function downloadDir() {
  const custom = store.state.settings.downloadDir;
  if (custom) { try { if (fs.statSync(custom).isDirectory()) return custom; } catch {} }
  return app.getPath('downloads');
}

// Nom proposé par le site : un simple nom de fichier, sans dossier ni caractère interdit.
function safeName(name) {
  const base = String(name || '').split(/[\\/]/).pop().replace(/[\x00-\x1f<>:"|?*]/g, '_').replace(/^\.+/, '').slice(0, 200);
  return base || 'téléchargement';
}

function uniquePath(dir, name) {
  const parsed = path.parse(name);
  let target = path.join(dir, parsed.base);
  for (let i = 1; fs.existsSync(target); i++) target = path.join(dir, `${parsed.name} (${i})${parsed.ext}`);
  return target;
}

function findRecord(id) {
  return store.state.downloads.find((d) => d.id === id) || [...volatileRecords].find((d) => d.id === id) || null;
}
const volatileRecords = new Set(); // navigation privée : jamais écrits sur disque

function track(d, item, wc, { persist, hooks }) {
  items.set(d.id, item);
  const note = () => {
    d.received = item.getReceivedBytes();
    d.total = item.getTotalBytes();
    d.paused = item.isPaused();
    d.canResume = item.canResume();
    // De quoi reprendre plus tard, même après un redémarrage d'Orbe.
    d.resume = { urlChain: item.getURLChain().slice(0, 20), mimeType: item.getMimeType(), eTag: item.getETag(), lastModified: item.getLastModifiedTime(), startTime: item.getStartTime() };
  };
  item.on('updated', (e, state) => {
    note();
    d.state = 'progressing';
    d.stalled = state === 'interrupted';
    hooks.onDownload('progress', d, wc, item);
  });
  item.once('done', (e, state) => {
    items.delete(d.id);
    try { d.received = item.getReceivedBytes(); d.total = item.getTotalBytes() || d.total; } catch {}
    d.state = state; // 'completed', 'cancelled' ou 'interrupted'
    d.paused = false;
    d.stalled = false;
    d.canResume = state === 'interrupted';
    if (state !== 'interrupted') delete d.resume;
    // Annulé : Electron laisse sur disque le morceau déjà reçu ; ce fichier
    // incomplet, créé pour ce téléchargement, est retiré.
    if (state === 'cancelled' && d.path) fs.unlink(d.path, () => {});
    if (persist) store.save();
    hooks.onDownload('done', d, wc, item);
    if (state === 'completed' && !d.danger && isPdf(d.name, d.mime) && store.state.settings.downloadOpenPdf) openFile(d, wc);
  });
}

function attach(ses, { persist, hooks }) {
  ses.on('will-download', (event, item, wc) => {
    // Reprise d'un téléchargement interrompu : il garde son enregistrement.
    const again = resuming.get(item.getSavePath());
    if (again) {
      resuming.delete(item.getSavePath());
      again.state = 'progressing';
      again.stalled = false;
      track(again, item, wc, { persist, hooks });
      if (item.canResume()) item.resume();
      hooks.onDownload('progress', again, wc, item);
      return;
    }
    const name = safeName(item.getFilename());
    let target = uniquePath(downloadDir(), name);
    if (store.state.settings.downloadAsk) {
      const parent = (wc && env.ownerWindow(wc)) || BaseWindow.getFocusedWindow();
      const chosen = env.saveDialog(parent, { defaultPath: target, title: t('dl.saveAs') });
      // Annulé : pas de téléchargement.
      if (!chosen || typeof chosen !== 'string' || !path.isAbsolute(chosen)) { event.preventDefault(); return; }
      target = chosen;
    }
    item.setSavePath(target);
    const d = {
      id: uid(), name: path.basename(target), path: target, url: item.getURL(), total: item.getTotalBytes(), received: 0, state: 'progressing', at: Date.now(),
      mime: item.getMimeType(), profile: profiles.get(ses) || 'default',
    };
    if (isDangerous(d.name)) d.danger = true;
    if (persist) store.addDownload(d); else volatileRecords.add(d);
    track(d, item, wc, { persist, hooks });
    hooks.onDownload('start', d, wc, item);
  });
}

// Associe une session à son profil : la reprise repart avec les mêmes cookies.
function bindProfile(ses, id) {
  profiles.set(ses, id || 'default');
}

function fileSize(file) {
  try { return fs.statSync(file).size; } catch { return -1; }
}

// Reprend un téléchargement : en pause, calé, ou interrompu (même par la
// fermeture d'Orbe). Si la partie déjà reçue n'est plus là, il repart de zéro.
function resume(d) {
  const item = items.get(d.id);
  if (item) {
    if (item.isPaused() || item.canResume()) item.resume();
    return 'resumed';
  }
  if (d.state !== 'interrupted' && d.state !== 'cancelled') return 'none';
  const ses = env.profileSession(d.profile || 'default');
  if (!ses || !/^https?:/i.test(d.url || '')) return 'none';
  const size = fileSize(d.path);
  if (d.state === 'interrupted' && d.resume && size > 0 && (!d.total || size < d.total)) {
    resuming.set(d.path, d);
    try {
      ses.createInterruptedDownload({
        path: d.path, urlChain: d.resume.urlChain && d.resume.urlChain.length ? d.resume.urlChain : [d.url], mimeType: d.resume.mimeType || '', offset: size, length: d.total || 0,
        lastModified: d.resume.lastModified || '', eTag: d.resume.eTag || '', startTime: d.resume.startTime || 0,
      });
      return 'continued';
    } catch (err) {
      resuming.delete(d.path);
      console.error('[orbe] reprise du téléchargement', err.message);
    }
  }
  // Rien à continuer : nouveau téléchargement, l'ancienne ligne disparaît.
  const list = store.state.downloads;
  const i = list.indexOf(d);
  if (i >= 0) list.splice(i, 1);
  if (d.state === 'interrupted' && size >= 0 && d.total && size < d.total) { try { fs.unlinkSync(d.path); } catch {} }
  ses.downloadURL(d.url);
  store.save();
  return 'restarted';
}

function cancel(d) {
  const item = items.get(d.id);
  if (item) { item.cancel(); return true; }
  if (d.state !== 'interrupted') return false;
  // Enregistrement d'une exécution précédente : on retire le morceau resté sur disque.
  const size = fileSize(d.path);
  if (size >= 0 && d.total && size < d.total) { try { fs.unlinkSync(d.path); } catch {} }
  d.state = 'cancelled';
  d.canResume = false;
  delete d.resume;
  store.save();
  return true;
}

// Ouvre un fichier téléchargé : un PDF dans un onglet, le reste par le système.
// Un fichier exécutable demande d'abord confirmation.
async function openFile(d, wc, { parent = null, confirmed = false } = {}) {
  if (!d || d.state !== 'completed' || !fs.existsSync(d.path)) return false;
  if (d.danger && !confirmed) {
    let host = '';
    try { host = new URL(d.url).host; } catch {}
    const ok = await env.confirm(parent, {
      type: 'warning', message: t('dl.dangerTitle', { name: d.name }), detail: t('dl.dangerDetail', { host: host || '?' }), buttons: [t('dl.dangerOpen'), t('sheet.cancel')], defaultId: 1, cancelId: 1,
    });
    if (!ok) return false;
  }
  if (!d.danger && isPdf(d.name, d.mime) && env.openInTab(pathToFileURL(d.path).href, wc)) return true;
  env.openPath(d.path);
  return true;
}

// Messages de la Bibliothèque et des réglages.
async function action(name, a, sender) {
  const parent = (sender && env.ownerWindow(sender)) || BaseWindow.getFocusedWindow();
  if (name === 'dl:pickDir') {
    const dir = await env.pickFolder(parent, { properties: ['openDirectory', 'createDirectory'], defaultPath: downloadDir() });
    if (dir && path.isAbsolute(dir)) { store.state.settings.downloadDir = dir; store.save(); env.settingsChanged(); }
    return store.state.settings.downloadDir || '';
  }
  if (name === 'dl:defaultDir') {
    store.state.settings.downloadDir = '';
    store.save();
    env.settingsChanged();
    return '';
  }
  if (name === 'dl:dir') return downloadDir();
  const d = findRecord(String(a));
  if (!d) return false;
  if (name === 'dl:pause') { const item = items.get(d.id); if (item && !item.isPaused()) { item.pause(); d.paused = true; } return !!item; }
  if (name === 'dl:resume') return resume(d);
  if (name === 'dl:cancel') return cancel(d);
  if (name === 'dl:open') return openFile(d, null, { parent });
  if (name === 'dl:remove') {
    if (items.has(d.id)) return false;
    const i = store.state.downloads.indexOf(d);
    if (i >= 0) { store.state.downloads.splice(i, 1); store.save(); }
    return true;
  }
  return undefined;
}

module.exports = { attach, bindProfile, action, resume, cancel, openFile, downloadDir, isDangerous, isPdf, safeName, env, internals: { items, resuming, DANGEROUS } };
