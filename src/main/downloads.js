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
//    (bac à sable), jamais par une application du système. « PDF » se juge sur le
//    fichier enregistré : extension `.pdf` ET contenu qui commence par `%PDF-`.
//    Le type annoncé par le serveur ne compte pas : un fichier `.html` servi
//    comme « application/pdf » serait sinon ouvert en `file://` dans un onglet ;
//  - l'ouverture automatique n'a lieu que pour un téléchargement lancé par un
//    geste de l'utilisateur, et « toujours demander » ne laisse pas une page
//    enchaîner les fenêtres d'enregistrement.
const { app, clipboard, ClipboardItem, dialog, nativeImage, shell, BaseWindow, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { store, uid } = require('./store');

// Extensions de fichiers qui peuvent exécuter du code à l'ouverture.
const DANGEROUS = new Set(['dmg', 'pkg', 'mpkg', 'app', 'command', 'tool', 'terminal', 'workflow', 'action', 'scpt', 'scptd', 'applescript', 'sh', 'bash', 'zsh', 'csh', 'ksh', 'fish', 'run', 'bin',
  'exe', 'msi', 'msix', 'msp', 'appx', 'appxbundle', 'bat', 'cmd', 'com', 'scr', 'pif', 'cpl', 'lnk', 'ps1', 'psm1', 'vbs', 'vbe', 'jse', 'wsf', 'wsh', 'hta', 'reg', 'dll', 'sys', 'inf', 'url',
  'jar', 'jnlp', 'apk', 'deb', 'rpm', 'iso', 'img', 'webloc', 'desktop', 'appimage',
  'js', 'vb', 'wsc', 'ws', 'msc', 'chm', 'scf', 'application', 'appref-ms', 'settingcontent-ms', 'diagcab', 'gadget', 'xll', 'py', 'pyw', 'cab', 'vhd', 'vhdx',
  'inetloc', 'fileloc', 'mobileconfig', 'prefpane', 'xip']);

const env = {
  // Fenêtre Orbe (BaseWindow) de la page qui télécharge, pour y attacher les boîtes de dialogue.
  ownerWindow: () => null,
  profileSession: () => null, // identifiant de profil -> session
  openInTab: () => false, // (adresse, webContents d'origine) -> ouvre un onglet
  // Boîtes de dialogue du système ; remplacées pendant les tests.
  saveDialog: (parent, opts) => (parent ? dialog.showSaveDialogSync(parent, opts) : dialog.showSaveDialogSync(opts)),
  confirm: async (parent, opts) => (await (parent ? dialog.showMessageBox(parent, opts) : dialog.showMessageBox(opts))).response === 0,
  openPath: (file) => shell.openPath(file),
  reveal: (file) => shell.showItemInFolder(file),
  // Corbeille du système : le fichier s'y retrouve, rien n'est détruit.
  trash: (file) => shell.trashItem(file),
  // Menu d'un téléchargement : rend la main quand il se referme.
  popup: (template, parent) => new Promise((resolve) => {
    const menu = Menu.buildFromTemplate(template);
    menu.popup({ ...(parent ? { window: parent } : {}), callback: () => setTimeout(resolve, 30) });
  }),
};
const items = new Map(); // identifiant -> DownloadItem en cours (cette exécution d'Orbe)
const resuming = new Map(); // chemin du fichier -> enregistrement dont la reprise est demandée
const profiles = new WeakMap(); // session -> identifiant de profil
const t = (key, vars) => store.t(key, null, vars);

// Caractères invisibles qui retournent le sens de lecture (« exe.fdp » affiché
// « pdf.exe ») ou se cachent en fin de nom : retirés avant de lire l'extension.
const HIDDEN = /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;
const clean = (name) => String(name || '').replace(HIDDEN, '').replace(/[. ]+$/, '');
const extOf = (name) => path.extname(clean(name)).slice(1).toLowerCase();
const isDangerous = (name) => DANGEROUS.has(extOf(name));
// Vrai PDF : le fichier enregistré porte l'extension .pdf et commence par « %PDF- ».
function isPdfFile(file) {
  if (extOf(file) !== 'pdf') return false;
  let fd = null;
  try {
    fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(5);
    return fs.readSync(fd, head, 0, 5, 0) === 5 && head.toString('latin1') === '%PDF-';
  } catch { return false; } finally { if (fd !== null) { try { fs.closeSync(fd); } catch {} } }
}
// Exécutable ? Jugé sur le fichier tel qu'il est sur disque, au moment de l'ouvrir.
const dangerNow = (d) => !!d.danger || isDangerous(d.path) || isDangerous(d.name);
const asked = new Map(); // id webContents (0 : aucun) -> instant de la dernière fenêtre « enregistrer sous »
const ASK_GAP = 10000;

// Dossier de destination : celui des réglages (général, ou propre au profil de la
// session — voir prefs.js, par `sessions.hooks.downloadDir`), sinon Téléchargements.
let dirOf = () => '';
function downloadDir(ses) {
  let custom = '';
  try { custom = dirOf(ses) || ''; } catch {}
  return custom || app.getPath('downloads');
}

// Nom proposé par le site : un simple nom de fichier, sans dossier ni caractère interdit.
function safeName(name) {
  const base = clean(String(name || '').split(/[\\/]/).pop()).replace(/[<>:"|?*]/g, '_').replace(/^\.+/, '').slice(0, 200);
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
    // Ouverture automatique : un vrai PDF, téléchargé à la demande de l'utilisateur.
    if (state === 'completed' && d.gesture && store.state.settings.downloadOpenPdf && !dangerNow(d) && isPdfFile(d.path)) openFile(d, wc);
  });
}

function attach(ses, { persist, hooks }) {
  dirOf = (s) => hooks.downloadDir(s);
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
    let target = uniquePath(downloadDir(ses), name);
    if (store.state.settings.downloadAsk) {
      // Sans geste de l'utilisateur, une page n'ouvre pas deux fenêtres
      // d'enregistrement de suite (elles bloquent toute l'application).
      const who = wc && !wc.isDestroyed() ? wc.id : 0;
      const now = Date.now();
      if (!item.hasUserGesture() && now - (asked.get(who) || 0) < ASK_GAP) { event.preventDefault(); return; }
      asked.set(who, now);
      if (asked.size > 500) asked.clear();
      const parent = (wc && env.ownerWindow(wc)) || BaseWindow.getFocusedWindow();
      const chosen = env.saveDialog(parent, { defaultPath: target, title: t('dl.saveAs') });
      // Annulé : pas de téléchargement.
      if (!chosen || typeof chosen !== 'string' || !path.isAbsolute(chosen)) { event.preventDefault(); return; }
      target = chosen;
    }
    item.setSavePath(target);
    const d = {
      id: uid(), name: path.basename(target), path: target, url: item.getURL(), total: item.getTotalBytes(), received: 0, state: 'progressing', at: Date.now(),
      mime: item.getMimeType(), profile: profiles.get(ses) || 'default', gesture: item.hasUserGesture(),
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
  const danger = dangerNow(d);
  if (danger && !confirmed) {
    let host = '';
    try { host = new URL(d.url).host; } catch {}
    const ok = await env.confirm(parent, {
      type: 'warning', message: t('dl.dangerTitle', { name: d.name }), detail: t('dl.dangerDetail', { host: host || '?' }), buttons: [t('dl.dangerOpen'), t('sheet.cancel')], defaultId: 1, cancelId: 1,
    });
    if (!ok) return false;
  }
  if (!danger && isPdfFile(d.path) && env.openInTab(pathToFileURL(d.path).href, wc)) return true;
  env.openPath(d.path);
  return true;
}

// « Copier » : une image part comme image (elle se colle dans un message, un document) ;
// tout autre fichier part comme fichier (il se colle dans le Finder ou l'Explorateur).
const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff']);
async function copyFile(d) {
  if (!d || d.state !== 'completed' || !fs.existsSync(d.path)) return false;
  try {
    if (IMAGE.has(extOf(d.path))) {
      const img = nativeImage.createFromPath(d.path);
      if (!img.isEmpty()) {
        await clipboard.write([new ClipboardItem({ 'image/png': new Blob([img.toPNG()], { type: 'image/png' }) })]);
        return 'image';
      }
    }
    // « text/uri-list » avec une adresse file: : Chromium y met le fichier lui-même, sur chaque système.
    await clipboard.write([new ClipboardItem({ 'text/uri-list': pathToFileURL(d.path).href })]);
    return 'file';
  } catch (err) {
    console.error('[orbe] copie du fichier', err.message);
    return false;
  }
}

// Retire un téléchargement de la liste (le fichier reste où il est).
function forget(d) {
  if (items.has(d.id)) return false;
  volatileRecords.delete(d);
  const i = store.state.downloads.indexOf(d);
  if (i >= 0) { store.state.downloads.splice(i, 1); store.save(); }
  return true;
}

// « Placer dans la corbeille » : le fichier part à la corbeille du système, la ligne disparaît.
async function trash(d) {
  if (!d || items.has(d.id) || d.state === 'progressing') return false;
  if (d.path && fs.existsSync(d.path)) {
    try { await env.trash(d.path); } catch (err) { console.error('[orbe] corbeille', err.message); return false; }
  }
  return forget(d);
}

// Menu d'un téléchargement, comme dans Arc : Ouvrir, Copier, Afficher dans le Finder,
// Partager (macOS), Masquer de la liste, Placer dans la corbeille ; Pause, Reprendre, Annuler.
function menuTemplate(d, { parent = null } = {}) {
  const running = d.state === 'progressing';
  const exists = d.state === 'completed' && fs.existsSync(d.path);
  const stopped = d.state === 'interrupted' || d.state === 'cancelled';
  const live = items.has(d.id);
  const tpl = [
    { id: 'open', label: t('lib.open'), enabled: exists, click: () => openFile(d, null, { parent }) },
    { id: 'copy', label: t('edit.copy'), enabled: exists, click: () => copyFile(d) },
    { id: 'reveal', label: t('lib.reveal'), enabled: exists, click: () => env.reveal(d.path) },
  ];
  // Feuille de partage du système (AirDrop, Messages, Mail…).
  if (process.platform === 'darwin' && exists) tpl.push({ id: 'share', role: 'shareMenu', sharingItem: { filePaths: [d.path] } });
  tpl.push({ type: 'separator' });
  if (running) {
    tpl.push(d.paused || d.stalled ? { id: 'resume', label: t('dl.resume'), click: () => resume(d) } : { id: 'pause', label: t('dl.pause'), enabled: live, click: () => action('dl:pause', d.id) });
    tpl.push({ id: 'cancel', label: t('dl.cancel'), click: () => cancel(d) });
  } else {
    if (stopped) tpl.push({ id: 'resume', label: t(d.state === 'interrupted' && d.canResume ? 'dl.resume' : 'dl.retry'), click: () => resume(d) });
    tpl.push({ id: 'hide', label: t('dl.hide'), click: () => forget(d) });
    tpl.push({ id: 'trash', label: t('dl.trash'), enabled: exists, click: () => trash(d) });
  }
  return tpl;
}

// Messages de la Bibliothèque et des réglages.
async function action(name, a, sender) {
  const parent = (sender && env.ownerWindow(sender)) || BaseWindow.getFocusedWindow();
  const d = findRecord(String(a));
  if (!d) return false;
  if (name === 'dl:pause') { const item = items.get(d.id); if (item && !item.isPaused()) { item.pause(); d.paused = true; } return !!item; }
  if (name === 'dl:resume') return resume(d);
  if (name === 'dl:cancel') return cancel(d);
  if (name === 'dl:open') return openFile(d, null, { parent });
  if (name === 'dl:remove') return forget(d);
  if (name === 'dl:trash') return trash(d);
  if (name === 'dl:copy') return copyFile(d);
  if (name === 'dl:menu') { await env.popup(menuTemplate(d, { parent }), parent); return true; }
  return undefined;
}

module.exports = { attach, bindProfile, action, resume, cancel, openFile, copyFile, trash, forget, menuTemplate, downloadDir, isDangerous, isPdfFile, safeName, env, internals: { items, resuming, DANGEROUS, asked, extOf } };
