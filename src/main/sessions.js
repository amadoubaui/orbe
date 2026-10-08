// Sessions Chromium : protocole interne orbe://, agent utilisateur,
// autorisations des sites et téléchargements.
const { app, session, protocol, net, dialog, BaseWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { store, uid } = require('./store');
const adblock = require('./adblock');
const extensions = require('./extensions');

const RENDERER_DIR = path.join(__dirname, '../renderer');
const configured = new WeakSet();
const hooks = { onDownload: () => {}, ownerWindow: () => null };

// À appeler avant app.ready.
function registerScheme() {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'orbe', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
}

function serveInternal(request) {
  const url = new URL(request.url);
  if (url.host !== 'app') return new Response('Introuvable', { status: 404 });
  const file = path.normalize(path.join(RENDERER_DIR, decodeURIComponent(url.pathname)));
  if (!file.startsWith(RENDERER_DIR + path.sep)) return new Response('Interdit', { status: 403 });
  return net.fetch(pathToFileURL(file).toString());
}

// Les sites (Google, banques…) refusent parfois les agents « Electron ».
function cleanUserAgent(ses) {
  return ses.getUserAgent().replace(/\sElectron\/\S+/, '').replace(/\s(Orbe|orbe)\/\S+/, '');
}

const AUTO_ALLOW = new Set(['fullscreen', 'pointerLock', 'clipboard-sanitized-write', 'keyboardLock', 'window-management', 'speaker-selection']);
const ASKABLE = new Set(['media', 'geolocation', 'notifications', 'midi', 'midiSysex', 'clipboard-read']);
const pending = new Map();

function originOf(url) {
  try { return new URL(url).origin; } catch { return ''; }
}

async function askPermission(wc, origin, permission) {
  const key = origin + '|' + permission;
  if (pending.has(key)) return pending.get(key);
  const labelKey = 'perm.' + (permission === 'midiSysex' ? 'midi' : permission);
  let label = store.t(labelKey);
  if (label === labelKey) label = store.t('perm.other', null, { name: permission });
  const parent = hooks.ownerWindow(wc) || BaseWindow.getFocusedWindow();
  const opts = {
    type: 'question',
    message: store.t('perm.title', null, { origin }),
    detail: label,
    buttons: [store.t('perm.allow'), store.t('perm.deny')],
    defaultId: 1,
    cancelId: 1,
  };
  const p = (parent ? dialog.showMessageBox(parent, opts) : dialog.showMessageBox(opts)).then((r) => r.response === 0);
  pending.set(key, p);
  p.finally(() => pending.delete(key));
  return p;
}

function configure(ses, { persist }) {
  if (configured.has(ses)) return ses;
  configured.add(ses);
  // Bloqueur de publicités : il occupe l'unique écouteur onBeforeRequest.
  adblock.attach(ses);
  ses.setUserAgent(cleanUserAgent(ses));
  if (ses !== session.defaultSession) ses.protocol.handle('orbe', serveInternal);

  // Lu à chaque demande : « réinitialiser les autorisations » agit tout de suite.
  const volatile = {};
  const memory = () => (persist ? store.state.permissions : volatile);

  ses.setPermissionRequestHandler(async (wc, permission, callback, details) => {
    const origin = originOf(details.requestingUrl || (wc && wc.getURL()) || '');
    if (origin.startsWith('orbe://') || AUTO_ALLOW.has(permission)) return callback(true);
    if (!ASKABLE.has(permission) || !origin) return callback(false);
    const remembered = memory();
    const known = remembered[origin] && remembered[origin][permission];
    if (typeof known === 'boolean') return callback(known);
    const ok = await askPermission(wc, origin, permission);
    // Une origine opaque (file:, data:) vaut « null » : on ne retient rien pour elle.
    if (origin !== 'null') {
      (remembered[origin] || (remembered[origin] = {}))[permission] = ok;
      if (persist) store.save();
    }
    callback(ok);
  });

  ses.setPermissionCheckHandler((wc, permission, requestingOrigin) => {
    if (AUTO_ALLOW.has(permission) || (requestingOrigin || '').startsWith('orbe://')) return true;
    const origin = originOf(requestingOrigin || '');
    const remembered = memory();
    return !!(remembered[origin] && remembered[origin][permission]);
  });

  ses.on('will-download', (event, item, wc) => {
    const dir = app.getPath('downloads');
    const parsed = path.parse(item.getFilename());
    let target = path.join(dir, parsed.base);
    for (let i = 1; fs.existsSync(target); i++) target = path.join(dir, `${parsed.name} (${i})${parsed.ext}`);
    item.setSavePath(target);
    const d = { id: uid(), name: path.basename(target), path: target, url: item.getURL(), total: item.getTotalBytes(), received: 0, state: 'progressing', at: Date.now() };
    if (persist) store.addDownload(d);
    hooks.onDownload('start', d, wc, item);
    item.on('updated', () => {
      d.received = item.getReceivedBytes();
      d.total = item.getTotalBytes();
      hooks.onDownload('progress', d, wc, item);
    });
    item.once('done', (e, state) => {
      d.state = state;
      d.received = item.getReceivedBytes();
      if (persist) store.save();
      hooks.onDownload('done', d, wc, item);
    });
  });
  // Extensions installées : rechargées dans chaque profil à chaque démarrage.
  if (persist) {
    extensions.loadInto(ses).then((r) => {
      for (const f of (r && r.failed) || []) console.error('[orbe] extension', f.id, f.error);
    }).catch((err) => console.error('[orbe] extensions', err));
  }
  return ses;
}

// Une session Chromium par profil : cookies et connexions séparés.
function profileSession(id) {
  const partition = !id || id === 'default' ? 'persist:orbe' : 'persist:orbe-' + id;
  return configure(session.fromPartition(partition), { persist: true });
}

const mainSession = () => profileSession('default');

let incognitoCount = 0;
function incognitoSession() {
  return configure(session.fromPartition('incognito-' + Date.now() + '-' + ++incognitoCount), { persist: false });
}

function setupDefaultSession() {
  protocol.handle('orbe', serveInternal);
  // La session par défaut ne sert qu'à l'interface : aucune autorisation web.
  session.defaultSession.setPermissionRequestHandler((wc, p, cb) => cb(false));
}

module.exports = { registerScheme, setupDefaultSession, mainSession, profileSession, incognitoSession, hooks, originOf };
