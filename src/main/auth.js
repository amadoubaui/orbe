// Authentification HTTP (Basic, Digest, NTLM) et proxys : quand un serveur
// répond 401 ou 407, Orbe demande l'identifiant et le mot de passe dans une
// feuille posée sur l'onglet concerné (sheets.js). Annulable ; sans réponse, la
// demande est annulée et la page du serveur s'affiche.
//
// Sécurité :
//  - la feuille nomme l'hôte qui demande, tel que rapporté par Electron
//    (`authInfo`) ; le « domaine » (realm) est un texte choisi par le serveur :
//    il est affiché comme une citation, jamais comme un message d'Orbe ;
//  - une ressource d'un autre site que la page (image, script, requête) ne peut
//    pas faire apparaître la question : la demande est annulée (hameçonnage
//    classique : faire croire que le site visité demande un mot de passe) ;
//  - en HTTP simple, la feuille prévient que le mot de passe partira en clair ;
//  - rien n'est retenu par Orbe : Chromium garde l'identification pour la session.
// À FAIRE : proposer les comptes du gestionnaire de mots de passe (il faudrait
// une clé par hôte + domaine et passer par le déverrouillage du coffre ; pas
// trivial, donc laissé de côté — voir docs/securite-navigation.md).
const { app } = require('electron');
const sheets = require('./sheets');

const MAX = 1024;
const counts = new Map(); // id webContents -> { key, n } : tentatives pour une même demande

function hostOf(url) {
  try { return new URL(url).hostname; } catch { return ''; }
}

// Une navigation (page ou cadre) peut demander : la feuille nomme l'hôte. Une
// simple ressource (image, script, requête) ne le peut que si elle vient du
// même hôte que la page affichée.
function shouldAsk(wc, details, authInfo) {
  if (authInfo.isProxy || details.isRequestForNavigation) return true;
  let top = '';
  try { top = wc.getURL(); } catch {}
  return !!top && hostOf(details.url) === hostOf(top);
}

function onLogin(event, wc, details, authInfo, callback) {
  if (!wc || wc.isDestroyed()) return; // demande hors page : annulée (comportement par défaut)
  if (!shouldAsk(wc, details, authInfo)) return;
  const host = authInfo.host + (authInfo.port && ![80, 443].includes(authInfo.port) ? ':' + authInfo.port : '');
  const key = `${authInfo.isProxy ? 'proxy' : 'site'}|${host}|${authInfo.realm}`;
  const prev = counts.get(wc.id);
  const n = prev && prev.key === key && Date.now() - prev.at < 120000 ? prev.n + 1 : 1;
  const id = wc.id;
  if (!counts.has(id)) wc.once('destroyed', () => counts.delete(id));
  counts.set(id, { key, n, at: Date.now() });
  const sheet = sheets.open(wc, 'auth', {
    host,
    realm: String(authInfo.realm || '').slice(0, 200),
    proxy: !!authInfo.isProxy,
    scheme: String(authInfo.scheme || '').slice(0, 20),
    insecure: !authInfo.isProxy && /^http:/i.test(details.url) && !/^(localhost|127\.0\.0\.1)$/.test(authInfo.host),
    retry: n > 1 || details.firstAuthAttempt === false,
  }, { untilNavigation: false });
  // Page qui n'est pas un onglet (aperçu, petite fenêtre) : pas de feuille, demande annulée.
  if (!sheet) return;
  event.preventDefault();
  // Une autre navigation de l'onglet abandonne la demande.
  const onNav = (d) => { if (d.isMainFrame && !d.isSameDocument && Date.now() - sheet.openedAt > 300) sheet.close(null); };
  wc.on('did-start-navigation', onNav);
  sheet.result.then((answer) => {
    if (!wc.isDestroyed()) wc.off('did-start-navigation', onNav);
    const ok = answer && typeof answer.username === 'string' && typeof answer.password === 'string' && answer.username.length <= MAX && answer.password.length <= MAX;
    try { if (ok) callback(answer.username, answer.password); else callback(); } catch {}
    if (!ok) counts.delete(id);
  });
}

// Certificat client demandé par un site. Sans réponse, Electron enverrait le
// premier certificat du trousseau : Orbe n'en envoie jamais sans un choix
// explicite, fait dans une feuille posée sur l'onglet.
function onClientCert(event, wc, url, list, callback) {
  event.preventDefault();
  const none = () => { try { callback(); } catch {} };
  if (!wc || wc.isDestroyed() || !Array.isArray(list) || !list.length) return none();
  let host = '';
  try { host = new URL(url).host; } catch {}
  const items = list.slice(0, 50).map((c) => ({ label: String(c.subjectName || '?').slice(0, 120), sub: String(c.issuerName || '').slice(0, 120) }));
  const sheet = sheets.open(wc, 'choose', { host, items });
  if (!sheet) return none();
  sheet.result.then((i) => {
    const cert = Number.isInteger(i) && i >= 0 && i < items.length ? list[i] : null;
    try { if (cert) callback(cert); else callback(); } catch {}
  });
  return undefined;
}

function setup() {
  app.on('login', onLogin);
  app.on('select-client-certificate', onClientCert);
}

module.exports = { setup, internals: { onLogin, onClientCert, shouldAsk, counts } };
