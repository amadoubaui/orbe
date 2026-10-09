// Lecteur miniature : retient les gestionnaires que la page déclare elle-même
// par `navigator.mediaSession.setActionHandler` (piste précédente, suivante…).
//
// Chromium ne laisse pas relire ces gestionnaires, et Electron n'ouvre pas la
// session multimédia du navigateur : pour que les boutons du lecteur d'Orbe
// (src/main/media.js) déclenchent ceux du site, on les note au passage. Le script
// tourne dans le monde de la page, avant ses scripts, cadre principal des pages
// web seulement. Il n'expose rien d'Orbe : la table ne contient que des fonctions
// de la page, et Orbe ne fait que les appeler, comme le ferait une touche
// multimédia.
const { webFrame } = require('electron');

const PATCH = `(() => { try {
  const ms = navigator.mediaSession;
  if (!ms || ms.__orbeActions) return;
  const proto = Object.getPrototypeOf(ms);
  const set = proto.setActionHandler;
  const map = new Map();
  Object.defineProperty(ms, '__orbeActions', { value: map });
  const patched = function setActionHandler(action, handler) {
    const r = set.call(this, action, handler);
    try { if (typeof handler === 'function') map.set(String(action), handler); else map.delete(String(action)); } catch {}
    return r;
  };
  Object.defineProperty(proto, 'setActionHandler', { value: patched, writable: true, configurable: true, enumerable: true });
} catch {} })()`;

try {
  if (process.isMainFrame && /^https?:$/.test(location.protocol)) webFrame.executeJavaScript(PATCH);
} catch {}
