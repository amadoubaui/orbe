// Branche sur les fenêtres d'Orbe ce qu'un navigateur de tous les jours doit
// savoir faire : feuilles d'onglet, autorisations, partage d'écran, certificats,
// authentification HTTP, « quitter la page ? », fenêtres surgissantes, pages
// plantées. Chaque fonction vit dans son module ; ici, seulement les raccords
// avec window.js (ses `hooks`).
const sheets = require('./sheets');
const permissions = require('./permissions');
const displayMedia = require('./display-media');
const capture = require('./capture-state');
const certs = require('./certs');
const auth = require('./auth');
const unload = require('./unload');
const popups = require('./popups');
const downloads = require('./downloads');
const { store } = require('./store');

const t = (key, vars) => store.t(key, null, vars);

// Informations du site affiché : connexion, certificat, autorisations.
function siteInfo(w) {
  const rt = w.activeRt;
  const tab = w.activeId && w.data.tabs[w.activeId];
  if (!rt || !tab || rt.internal || rt.wc.isDestroyed()) return null;
  const wc = rt.wc;
  const ses = wc.session;
  const url = rt.failed ? tab.url : (wc.getURL() || tab.url);
  const origin = permissions.originOf(url);
  const payload = () => {
    const perms = permissions.list(ses, origin);
    if (certs.hasException(ses, url)) perms.unshift({ key: 'cert-exception', label: t('site.certException'), value: true });
    return {
      site: permissions.siteName(origin) || url.slice(0, 80),
      security: certs.state(wc, url) || 'other',
      cert: /^https:/i.test(url) ? certs.certFor(ses, url) : null,
      perms,
      capture: capture.of(wc).map((k) => t('capture.' + k)),
    };
  };
  return sheets.open(wc, 'site', payload(), {
    onAction: (name, arg) => {
      if (name !== 'reset') return null;
      let reload = false;
      if (arg === 'cert-exception' || arg === '*') reload = certs.revoke(ses, url);
      if (arg !== 'cert-exception') permissions.reset(ses, origin, arg);
      w.changed();
      // Exception retirée : les connexions déjà ouvertes avec ce certificat sont
      // coupées, sinon Chromium continuerait de s'en servir sans rien revérifier.
      if (reload && !wc.isDestroyed()) { ses.closeAllConnections().catch(() => {}).then(() => { if (!wc.isDestroyed()) wc.reload(); }); return null; }
      return { kind: 'site', cover: false, ...payload() };
    },
  });
}

// Menu du témoin de capture (caméra, micro, écran) d'un onglet.
function captureMenu(w, rt) {
  if (!rt || rt.wc.isDestroyed()) return;
  const kinds = capture.of(rt.wc);
  if (!kinds.length) return;
  w.popup([
    ...kinds.map((k) => ({ label: t('capture.' + k), enabled: false })),
    { type: 'separator' },
    { label: t('capture.stop'), click: () => capture.stop(rt.wc) },
  ]);
}

function setup({ win, sessions, test = false }) {
  const { OrbeWindow, live, trusted, hooks, UI_PRELOAD, INTERNAL } = win;
  const locate = (wc) => { for (const rt of live.values()) if (rt.wc === wc) return { owner: rt.owner, rt }; return null; };
  const ownerOf = (wc) => { try { return wc ? OrbeWindow.ownerOf(wc) : null; } catch { return null; } };
  const ownerWindow = (wc) => { const o = ownerOf(wc); return o ? o.win : null; };
  const toast = (wc, text) => { const o = ownerOf(wc); if (o) o.toast(text); };

  sheets.configure({ trusted, uiPreload: UI_PRELOAD, internal: INTERNAL, locate });
  // Geste récent de l'utilisateur dans un onglet (relevé par popups.gesture) : sert au partage d'écran et aux liens externes.
  const gesture = (wc) => { const where = locate(wc); if (!where) return null; return where.rt.gesture ? Date.now() - where.rt.gesture : Infinity; };
  permissions.setup({ test, toast, ownerWindow, gesture });
  displayMedia.setup({ test, toast });
  certs.setup();
  auth.setup();
  unload.setup();
  capture.hooks.changed = () => OrbeWindow.pushAll();
  Object.assign(downloads.env, {
    ownerWindow,
    profileSession: (id) => sessions.profileSession(id),
    openInTab: (url, wc) => { const o = ownerOf(wc) || OrbeWindow.primary; if (!o) return false; o.newTab(url); return true; },
  });

  // Les feuilles suivent la mise en page de leur fenêtre et y gardent le clavier.
  const layoutBefore = hooks.layout;
  hooks.layout = (w) => { layoutBefore(w); sheets.layout(w); };
  hooks.sheetFocus = (w) => sheets.focusFor(w);
  hooks.leave = (w, wc) => unload.confirm(w.win, wc);
  hooks.closeAll = (rts, close) => unload.closeAll(rts, close);
  hooks.quitState = unload.state;
  hooks.input = (rt, input) => popups.gesture(rt, input);
  hooks.popup = (rt, details) => popups.allowed(rt, details);
  hooks.navigated = (rt) => popups.reset(rt);
  hooks.busy = (rt) => capture.of(rt.wc).length > 0;
  hooks.tabState = (rt) => capture.of(rt.wc);
  hooks.navState = (w, rt, tab) => ({
    // Chargement refusé pour un certificat : « non sécurisé », que l'avertissement soit déjà affiché ou non.
    security: rt && tab && !rt.internal ? (rt.failed ? 'broken' : certs.state(rt.wc, rt.wc.getURL() || tab.url)) : '',
    popups: popups.count(rt),
    capture: rt ? capture.of(rt.wc) : [],
  });
  // Certificat refusé : avertissement d'Orbe à la place de la page d'erreur.
  hooks.failed = (rt, info) => certs.failed(rt.wc, info, {
    load: (url) => { if (!rt.wc.isDestroyed()) rt.wc.loadURL(url).catch(() => {}); },
    back: () => {
      if (rt.wc.isDestroyed()) return;
      // Retour à la page précédente ; s'il n'y en a pas, l'onglet se ferme.
      const nav = rt.wc.navigationHistory;
      if (nav.canGoBack()) nav.goBack(); else rt.owner.close(rt.id, { ask: false });
    },
  });
  // Processus de la page disparu : « page plantée », avec rechargement.
  hooks.gone = (rt, details) => {
    if (rt.expectGone) { rt.expectGone = false; return; }
    if (!details || details.reason === 'clean-exit' || rt.wc.isDestroyed()) return;
    const owner = rt.owner;
    if (owner.win.isDestroyed() || !owner.visibleIds().includes(rt.id)) return; // en arrière-plan : rechargée à son retour
    const sheet = sheets.open(rt.wc, 'crash', { oom: details.reason === 'oom' }, { cover: true });
    if (sheet) sheet.result.then((a) => { if (a === 'reload' && !rt.wc.isDestroyed()) { rt.crashed = false; rt.wc.reload(); } });
  };
  // Page qui ne répond plus : attendre, ou recharger.
  hooks.hung = (rt, on) => {
    if (rt.wc.isDestroyed()) return;
    if (!on) return sheets.closeAll(rt.wc, 'hung');
    if ((rt.hungWait || 0) > Date.now()) return;
    const sheet = sheets.open(rt.wc, 'hung', {}, {});
    if (sheet) sheet.result.then((a) => {
      if (rt.wc.isDestroyed()) return;
      if (a === 'wait') rt.hungWait = Date.now() + 20000;
      if (a === 'reload') { rt.expectGone = true; try { rt.wc.forcefullyCrashRenderer(); } catch {} rt.crashed = false; rt.wc.reload(); }
    });
  };
  hooks.action = (w, action, a) => {
    if (action === 'siteInfo') { siteInfo(w); return true; }
    // Autorisations du site affiché, dans la mémoire de SA session (profil, navigation privée).
    if (action === 'resetSitePerms') {
      const rt = w.activeRt;
      if (rt && !rt.wc.isDestroyed()) { permissions.reset(rt.wc.session, permissions.originOf(rt.wc.getURL()), '*'); w.changed(); }
      return true;
    }
    if (action === 'popupMenu') { const items = popups.menu(w, w.activeRt, t); if (items.length) w.popup(items); return true; }
    if (action === 'captureMenu') { captureMenu(w, (typeof a === 'string' && live.get(a)) || w.activeRt); return true; }
    return undefined;
  };
  hooks.siteMenu = (w) => [{ label: t('site.info'), enabled: !!(w.activeRt && !w.activeRt.internal), click: () => siteInfo(w) }];
}

module.exports = { setup, siteInfo, sheets, permissions, displayMedia, capture, certs, auth, unload, popups, downloads };
