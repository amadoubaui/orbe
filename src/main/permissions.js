// Autorisations des sites : caméra, micro, position, notifications, MIDI,
// presse-papiers, liens vers d'autres applications, appareils (USB, HID, série,
// Bluetooth).
//
// Tout se décide ici, dans le processus principal, à partir de ce qu'Electron
// rapporte (origine du cadre demandeur, session) : jamais d'après un texte
// fourni par la page. Une réponse est retenue par origine, dans le profil
// (store.state.permissions) ou, en navigation privée, en mémoire seulement.
const { app, dialog, BaseWindow, systemPreferences, shell, webContents } = require('electron');
const { store } = require('./store');
const sheets = require('./sheets');
const capture = require('./capture-state');

// Accordées sans question : sans danger, ou confirmées autrement (le partage
// d'écran passe par le sélecteur d'Orbe, qui vaut consentement à chaque fois).
const AUTO_ALLOW = new Set(['fullscreen', 'pointerLock', 'clipboard-sanitized-write', 'keyboardLock', 'window-management', 'speaker-selection', 'display-capture']);
const ASKABLE = new Set(['media', 'geolocation', 'notifications', 'midi', 'midiSysex', 'clipboard-read']);
// Appareils : la vérification passe (la page peut demander), mais aucun appareil
// n'est jamais accordé : la demande est annulée proprement, avec un message.
const DEVICES = new Set(['hid', 'serial', 'usb']);
// Schémas qu'une page ne fait jamais ouvrir par le système.
const BLOCKED_SCHEMES = new Set(['http', 'https', 'file', 'ftp', 'orbe', 'chrome', 'chrome-extension', 'devtools', 'javascript', 'data', 'blob', 'about', 'view-source', 'ws', 'wss', 'filesystem',
  'afp', 'disk', 'disks', 'hcp', 'ie.http', 'ms-help', 'nntp', 'shell', 'vbscript', 'vnd.ms.radio', 'ms-msdt', 'search-ms', 'search', 'ms-officecmd', 'ms-cxh', 'ms-cxh-full', 'ms-its', 'mk', 'res', 'jar', 'smb', 'ssh', 'telnet', 'vnc']);

const env = {
  toast: () => {},
  ownerWindow: () => null, // webContents -> BaseWindow de sa fenêtre Orbe
  // Boîte de dialogue du système, pour les pages qui ne sont pas des onglets.
  confirm: async (parent, opts) => (await (parent ? dialog.showMessageBox(parent, opts) : dialog.showMessageBox(opts))).response === 0,
  openExternal: (url) => shell.openExternal(url).catch(() => {}),
};

// Accès accordé à Orbe par le système (macOS, Windows). Remplacé pendant les
// tests : aucune vraie demande au système n'y est faite.
const SETTINGS_URL = {
  darwin: { camera: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera', microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone', screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture' },
  win32: { camera: 'ms-settings:privacy-webcam', microphone: 'ms-settings:privacy-microphone', screen: 'ms-settings:privacy' },
};
const os = {
  status(kind) {
    if (process.platform !== 'darwin' && process.platform !== 'win32') return 'granted';
    try { return systemPreferences.getMediaAccessStatus(kind); } catch { return 'unknown'; }
  },
  async ask(kind) {
    if (process.platform !== 'darwin' || kind === 'screen') return os.status(kind) !== 'denied';
    try { return await systemPreferences.askForMediaAccess(kind); } catch { return false; }
  },
  openSettings(kind) {
    const url = (SETTINGS_URL[process.platform] || {})[kind];
    if (url) env.openExternal(url);
  },
};

const memories = new WeakMap(); // session -> { memory(), persist }
const pending = new Map(); // « id onglet|origine|clés » -> promesse de la réponse en cours
const lastExternal = new Map(); // id webContents -> instant de la dernière ouverture sans question

const t = (key, vars) => store.t(key, null, vars);

function originOf(url) {
  try { return new URL(url).origin; } catch { return ''; }
}

// Nom du site à afficher : l'hôte, sans le schéma quand il est sûr.
function siteName(origin) {
  try { const u = new URL(origin); return u.protocol === 'https:' ? u.host : origin; } catch { return origin; }
}

// Réponse retenue (true, false) ou undefined. L'ancienne clé « media » valait
// pour la caméra et le micro.
function lookup(memory, origin, key) {
  const m = memory[origin];
  if (!m) return undefined;
  if (typeof m[key] === 'boolean') return m[key];
  if ((key === 'camera' || key === 'microphone') && typeof m.media === 'boolean') return m.media;
  return undefined;
}

function remember(entry, origin, key, value) {
  if (origin === 'null' || !origin) return; // origine opaque (file:, data:) : rien n'est retenu
  const memory = entry.memory();
  (memory[origin] || (memory[origin] = {}))[key] = value;
  if (entry.persist) store.save();
}

function forget(entry, origin, key) {
  const memory = entry.memory();
  const m = memory[origin];
  if (!m) return;
  if (key === '*') delete memory[origin];
  else {
    delete m[key];
    if (key === 'camera' || key === 'microphone') {
      // Ancienne clé commune : l'autre moitié garde sa réponse.
      if (typeof m.media === 'boolean') { const other = key === 'camera' ? 'microphone' : 'camera'; if (typeof m[other] !== 'boolean') m[other] = m.media; delete m.media; }
    }
    if (!Object.keys(m).length) delete memory[origin];
  }
  if (entry.persist) store.save();
}

function labelOf(key) {
  if (key.startsWith('external:')) return t('perm.external', { scheme: key.slice(9) });
  const k = 'perm.' + (key === 'midiSysex' ? 'midi' : key);
  const label = t(k);
  return label === k ? t('perm.other', { name: key }) : label;
}

function mediaKeys(details) {
  const types = (details && details.mediaTypes) || [];
  const keys = [];
  if (types.includes('video')) keys.push('camera');
  if (types.includes('audio')) keys.push('microphone');
  return keys;
}

// Question posée à l'utilisateur. Renvoie true, false, ou null si la question a
// disparu sans réponse (la page a changé) : rien n'est alors retenu.
async function ask(wc, origin, keys, top) {
  const id = (wc ? wc.id : 0) + '|' + origin + '|' + keys.join(',');
  if (pending.has(id)) return pending.get(id);
  const lines = keys.map(labelOf);
  const site = siteName(origin);
  const note = top && top !== origin ? t('perm.embedded', { site: siteName(top) }) : '';
  let p;
  const sheet = wc ? sheets.open(wc, 'perm', { site, lines, note, icon: keys[0] === 'camera' ? 'camera' : (keys[0] === 'microphone' ? 'mic' : 'info') }, { exclusive: false }) : null;
  if (sheet) p = sheet.result.then((r) => (r === 'allow' ? true : (r === 'deny' ? false : null)));
  else {
    const parent = (wc && env.ownerWindow(wc)) || BaseWindow.getFocusedWindow();
    p = env.confirm(parent, { type: 'question', message: t('perm.title', { origin: site }), detail: lines.join('\n') + (note ? '\n' + note : ''), buttons: [t('perm.allow'), t('perm.deny')], defaultId: 1, cancelId: 1 });
  }
  pending.set(id, p);
  p.finally(() => pending.delete(id));
  return p;
}

// Caméra, micro : il faut aussi l'accord du système pour Orbe. Dit lequel manque.
async function osAccess(wc, keys) {
  const missing = [];
  for (const key of keys) {
    let status = os.status(key);
    if (status === 'not-determined') status = (await os.ask(key)) ? 'granted' : 'denied';
    if (status === 'denied' || status === 'restricted') missing.push(key);
  }
  if (!missing.length) return true;
  const what = missing.map((k) => t('os.name.' + k)).join(t('os.and'));
  const text = t(process.platform === 'darwin' ? 'os.deniedMac' : 'os.deniedWin', { what });
  const sheet = wc && !wc.isDestroyed() ? sheets.open(wc, 'os', { title: t('os.title', { what }), text, settings: true, icon: missing[0] === 'camera' ? 'camera' : 'mic' }, { onAction: (name) => { if (name === 'settings') os.openSettings(missing[0]); } }) : null;
  if (!sheet && wc && !wc.isDestroyed()) env.toast(wc, t('os.title', { what }));
  return false;
}

// Lien vers une autre application (mailto:, tel:, lien d'application). Orbe
// demande, puis ouvre lui-même le lien : la réponse donnée à Chromium est
// toujours « non ».
async function external(entry, wc, origin, details) {
  const url = String((details && details.externalURL) || '');
  const scheme = (/^([a-z][a-z0-9+.-]*):/i.exec(url) || [])[1];
  if (!scheme || !wc || wc.isDestroyed() || !origin || url.length > 4096) return false;
  const name = scheme.toLowerCase();
  if (BLOCKED_SCHEMES.has(name)) return false;
  const key = 'external:' + name;
  const now = Date.now();
  // Autorisation permanente : au plus une ouverture toutes les trois secondes
  // par page, sinon la question revient.
  const quiet = lookup(entry.memory(), origin, key) === true && now - (lastExternal.get(wc.id) || 0) > 3000;
  if (!quiet) {
    const id = wc.id + '|external';
    if (pending.has(id)) return false; // une question à la fois par page
    const sheet = sheets.open(wc, 'external', { site: siteName(origin), scheme: name, url: url.slice(0, 300), canRemember: origin !== 'null' });
    const parent = env.ownerWindow(wc);
    const p = sheet
      ? sheet.result
      : env.confirm(parent, { type: 'question', message: t('external.title', { scheme: name }), detail: t('external.text', { site: siteName(origin) }) + '\n' + url.slice(0, 300), buttons: [t('external.go'), t('sheet.cancel')], defaultId: 1, cancelId: 1 }).then((ok) => (ok ? { open: true } : null));
    pending.set(id, p);
    const res = await p.finally(() => pending.delete(id));
    if (!res || res.open !== true) return false;
    if (res.always === true) remember(entry, origin, key, true);
  }
  lastExternal.set(wc.id, Date.now());
  if (lastExternal.size > 500) lastExternal.clear();
  env.openExternal(url);
  return false;
}

async function request(entry, wc, permission, details) {
  const origin = originOf((details && details.requestingUrl) || (wc && !wc.isDestroyed() && wc.getURL()) || '');
  if (origin.startsWith('orbe://') || AUTO_ALLOW.has(permission)) return true;
  if (permission === 'openExternal') return external(entry, wc, origin, details);
  if (!ASKABLE.has(permission) || !origin) return false;
  const keys = permission === 'media' ? mediaKeys(details) : [permission];
  // « media » sans caméra ni micro : c'est un partage d'écran (relevé sur
  // Electron 44). Rien n'est accordé ici : le sélecteur d'Orbe décide ensuite
  // de ce qui est partagé (display-media.js).
  if (!keys.length) return true;
  const known = keys.map((k) => lookup(entry.memory(), origin, k));
  if (known.includes(false)) return false;
  const unknown = keys.filter((k, i) => known[i] === undefined);
  if (unknown.length) {
    const top = wc && !wc.isDestroyed() && details && details.isMainFrame === false ? originOf(wc.getURL()) : '';
    const ok = await ask(wc, origin, unknown, top);
    if (ok === null) return false;
    for (const k of unknown) remember(entry, origin, k, ok);
    if (!ok) return false;
  }
  if (permission === 'media') {
    if (!(await osAccess(wc, keys))) return false;
    if (wc && !wc.isDestroyed()) for (const k of keys) capture.mark(wc, k);
  }
  return true;
}

function check(entry, permission, requestingOrigin, details) {
  if (AUTO_ALLOW.has(permission) || DEVICES.has(permission) || (requestingOrigin || '').startsWith('orbe://')) return true;
  const origin = originOf(requestingOrigin || '');
  const memory = entry.memory();
  if (permission === 'media') {
    const type = details && details.mediaType;
    if (type === 'video') return lookup(memory, origin, 'camera') === true;
    if (type === 'audio') return lookup(memory, origin, 'microphone') === true;
    return lookup(memory, origin, 'camera') === true || lookup(memory, origin, 'microphone') === true;
  }
  return lookup(memory, origin, permission) === true;
}

// Appareils USB, HID, série : Orbe n'a pas (encore) de sélecteur. La demande est
// annulée tout de suite, avec un message, plutôt que de rester sans réponse —
// et surtout sans jamais laisser Electron choisir le premier appareil.
function denyDevice(kind, wc, callback, value) {
  try { callback(value); } catch {}
  if (wc && !wc.isDestroyed()) env.toast(wc, t('device.unsupported', { kind: t('device.' + kind) }));
}

function attach(ses, { persist }) {
  // Lu à chaque demande : « réinitialiser les autorisations » agit tout de suite.
  const volatile = {};
  const entry = { memory: () => (persist ? store.state.permissions : volatile), persist };
  memories.set(ses, entry);
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    request(entry, wc, permission, details).then((ok) => callback(!!ok), (err) => { console.error('[orbe] autorisation', err); callback(false); });
  });
  ses.setPermissionCheckHandler((wc, permission, requestingOrigin, details) => check(entry, permission, requestingOrigin, details));
  ses.setDevicePermissionHandler(() => false);
  const fromFrame = (frame) => { try { return frame ? webContents.fromFrame(frame) : null; } catch { return null; } };
  ses.on('select-hid-device', (event, details, callback) => { event.preventDefault(); denyDevice('hid', fromFrame(details && details.frame), callback, undefined); });
  ses.on('select-usb-device', (event, details, callback) => { event.preventDefault(); denyDevice('usb', fromFrame(details && details.frame), callback, undefined); });
  ses.on('select-serial-port', (event, portList, wc, callback) => { event.preventDefault(); denyDevice('serial', wc, callback, ''); });
  return entry;
}

function setup({ test = false, ...options } = {}) {
  Object.assign(env, options);
  // Tests : ni question du système, ni application lancée.
  if (test) Object.assign(os, { status: () => 'granted', ask: async () => true, openSettings: () => {} }, { real: false });
  if (test) env.openExternal = () => {};
  // Bluetooth : sans réponse, Electron prendrait le premier appareil trouvé.
  app.on('web-contents-created', (e, wc) => {
    wc.on('select-bluetooth-device', (event, devices, callback) => { event.preventDefault(); denyDevice('bluetooth', wc, callback, ''); });
  });
}

// --- Vue des autorisations d'un site ------------------------------------------
function list(ses, origin) {
  const entry = memories.get(ses);
  const m = (entry && entry.memory()[origin]) || {};
  const out = [];
  for (const [key, value] of Object.entries(m)) {
    if (typeof value !== 'boolean') continue;
    if (key === 'media') { for (const k of ['camera', 'microphone']) if (typeof m[k] !== 'boolean') out.push({ key: k, label: labelOf(k), value }); } else out.push({ key, label: labelOf(key), value });
  }
  return out;
}

function reset(ses, origin, key) {
  const entry = memories.get(ses);
  if (entry && origin) forget(entry, origin, String(key));
}

// Réglage direct d'une autorisation (fenêtres surgissantes : « toujours autoriser »).
function set(ses, origin, key, value) {
  const entry = memories.get(ses);
  if (entry) remember(entry, origin, key, !!value);
}

function get(ses, origin, key) {
  const entry = memories.get(ses);
  return entry ? lookup(entry.memory(), origin, key) : undefined;
}

module.exports = { attach, setup, list, reset, set, get, originOf, siteName, labelOf, os, env, internals: { request, check, external, osAccess, memories, BLOCKED_SCHEMES, lastExternal } };
