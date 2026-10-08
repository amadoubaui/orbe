// Fenêtres surgissantes : `window.open` (ou un lien `target=_blank` cliqué par
// script) sans geste de l'utilisateur est bloqué, avec une mention discrète dans
// la pastille d'adresse.
//
// Electron 44 ne dit pas à `setWindowOpenHandler` si l'ouverture vient d'un
// geste (ses `details` : url, frameName, features, disposition, referrer,
// postBody — rien sur l'activation), et le bloqueur de Chrome n'existe pas dans
// Electron. Orbe refait donc le raisonnement de Chromium avec ce que le
// processus principal observe lui-même :
//  - un « geste » est une vraie entrée reçue par la page : bouton de souris
//    pressé ou relâché, touche enfoncée (hors touches mortes et Échap). Ces
//    événements viennent du système (`before-mouse-event`,
//    `before-input-event`) : un script ne peut pas les fabriquer ;
//  - le geste vaut 5 secondes (durée de l'activation passagère de Chromium), ce
//    qui couvre les connexions OAuth qui ouvrent leur fenêtre après un aller-
//    retour réseau ;
//  - il est consommé par l'ouverture : un clic ouvre une fenêtre, pas dix ;
//  - le site peut être autorisé pour de bon (« Toujours autoriser pour ce
//    site »), par origine, comme une autorisation.
// Limite connue : un geste fait dans la page profite à n'importe quel cadre de
// cette page pendant 5 secondes (Chromium, lui, suit l'activation cadre par cadre).
const permissions = require('./permissions');

const WINDOW = 5000;
const KEEP = 8; // ouvertures bloquées gardées par page, pour « Ouvrir quand même »
const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Escape', 'Dead', 'Unidentified']);

// Vraie entrée de l'utilisateur dans la page.
function gesture(rt, input) {
  if (input && input.type === 'keyDown' && (MODIFIERS.has(input.key) || input.isAutoRepeat)) return;
  rt.gesture = Date.now();
  rt.touched = true;
}

function originOf(wc) {
  try { return permissions.originOf(wc.getURL()); } catch { return ''; }
}

// Décide d'une ouverture demandée par la page. Renvoie true si elle peut avoir lieu.
function allowed(rt, details) {
  const wc = rt.wc;
  const origin = originOf(wc);
  if (origin && permissions.get(wc.session, origin, 'popups') === true) return true;
  const fresh = !!rt.gesture && Date.now() - rt.gesture < WINDOW;
  if (fresh) { rt.gesture = 0; return true; }
  const list = rt.blockedPopups || (rt.blockedPopups = []);
  const url = /^https?:/i.test(details.url) ? details.url.slice(0, 2000) : '';
  if (!list.some((x) => x.url === url)) list.push({ url, at: Date.now() });
  if (list.length > KEEP) list.shift();
  rt.blockedCount = (rt.blockedCount || 0) + 1;
  return false;
}

// Une nouvelle page dans l'onglet : la mention disparaît.
function reset(rt) {
  rt.blockedPopups = null;
  rt.blockedCount = 0;
}

const count = (rt) => (rt && rt.blockedCount) || 0;

// Menu de la mention : ouvrir quand même, ou autoriser le site.
function menu(owner, rt, t) {
  if (!rt || !count(rt)) return [];
  const origin = originOf(rt.wc);
  const site = permissions.siteName(origin);
  const short = (u) => (u.length > 60 ? u.slice(0, 57) + '…' : u);
  const items = [{ label: t('popup.blockedN', { n: count(rt) }), enabled: false }];
  const urls = (rt.blockedPopups || []).filter((x) => x.url);
  if (urls.length) items.push({ type: 'separator' });
  for (const x of urls) items.push({ label: t('popup.open', { url: short(x.url) }), click: () => { owner.newTab(x.url, { after: rt.id }); } });
  items.push({ type: 'separator' });
  items.push({ label: t('popup.always', { site }), enabled: !!origin && origin !== 'null', click: () => { permissions.set(rt.wc.session, origin, 'popups', true); reset(rt); owner.changed(); } });
  items.push({ label: t('popup.dismiss'), click: () => { reset(rt); owner.changed(); } });
  return items;
}

module.exports = { gesture, allowed, reset, count, menu, WINDOW };
