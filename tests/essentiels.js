// Navigation de tous les jours : autorisations (caméra, micro), partage d'écran,
// certificats, authentification HTTP, « quitter la page ? », fenêtres
// surgissantes, téléchargements, pages plantées, appareils, liens externes.
// Appelé par tests/selftest.js, ou seul :
//   ORBE_SCENARIO=tests/essentiels.js node scripts/dev.js --selftest
// Serveurs locaux HTTP et HTTPS (certificat auto-signé fabriqué par
// tests/certificat.js, sans dépendance). Aucune boîte de dialogue du système,
// aucune vraie caméra, aucune capture de l'écran de la machine : les réponses
// sont pilotées, et Chromium tourne avec des appareils factices.
const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');
const { selfSigned } = require('./certificat');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label, timeout = 12000) {
  const t0 = Date.now();
  for (;;) {
    let v;
    try { v = await fn(); } catch { v = false; }
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error('Délai dépassé : ' + label);
    await sleep(40);
  }
}

const PDF = Buffer.from('%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
const BIG = Buffer.alloc(320 * 1024);
for (let i = 0; i < BIG.length; i++) BIG[i] = (i * 31 + (i >> 8)) & 255;
const MODIFIED = 'Wed, 01 Jan 2025 00:00:00 GMT';

function handler(state) {
  const page = (title, body) => `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:16px sans-serif;margin:0;padding:120px 40px">${body}</body>`;
  return (req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    state.seen.push({ path: p, host: req.headers.host, auth: req.headers.authorization || '', range: req.headers.range || '' });
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    if (p === '/auth' || p === '/auth.png') {
      const ok = req.headers.authorization === 'Basic ' + Buffer.from('alice:secret').toString('base64');
      if (!ok) { res.statusCode = 401; res.setHeader('www-authenticate', 'Basic realm="Zone <b>reservee</b>"'); return res.end(page('Refusé', 'accès refusé')); }
      return res.end(page('Entré', 'bienvenue'));
    }
    if (p === '/embarque') return res.end(page('Embarque', `<img src="http://localhost:${state.port}/auth.png" width="10" height="10">`));
    if (p === '/sale') return res.end(page('Brouillon', '<textarea id="t"></textarea><script>window.addEventListener("beforeunload", (e) => { if (window.sale) { e.preventDefault(); e.returnValue = "un texte que le navigateur ignore"; } });</script>'));
    if (p === '/lien') return res.end(page('Lien externe', '<a id="m" href="mailto:test@orbe.invalid?subject=x" style="position:fixed;left:0;top:0;width:200px;height:60px;background:#def">écrire</a>'));
    if (p === '/vue.pdf') { res.setHeader('content-type', 'application/pdf'); return res.end(PDF); }
    if (p === '/doc.pdf') { res.setHeader('content-type', 'application/pdf'); res.setHeader('content-disposition', 'attachment; filename="document.pdf"'); return res.end(PDF); }
    if (p === '/installe.dmg') { res.setHeader('content-type', 'application/octet-stream'); res.setHeader('content-disposition', 'attachment; filename="Installe.dmg"'); return res.end('faux disque'); }
    if (p === '/note.txt') { res.setHeader('content-disposition', 'attachment; filename="note.txt"'); return res.end('bonjour'); }
    if (p === '/gros.bin') {
      const range = /bytes=(\d+)-/.exec(req.headers.range || '');
      const start = range ? Number(range[1]) : 0;
      res.statusCode = range ? 206 : 200;
      res.setHeader('content-type', 'application/octet-stream');
      res.setHeader('content-disposition', 'attachment; filename="gros.bin"');
      res.setHeader('accept-ranges', 'bytes');
      res.setHeader('etag', '"orbe-gros-1"');
      res.setHeader('last-modified', MODIFIED);
      res.setHeader('content-length', String(BIG.length - start));
      if (range) res.setHeader('content-range', `bytes ${start}-${BIG.length - 1}/${BIG.length}`);
      let at = start;
      // « coupe » : la connexion tombe à chaque essai, après quelques dizaines de
      // kilo-octets (Chromium réessaie de lui-même plusieurs fois avant de renoncer).
      const cut = state.mode === 'coupe';
      const step = state.mode === 'vite' ? BIG.length : 8 * 1024;
      const stop = start + 40 * 1024;
      const timer = setInterval(() => {
        if (res.destroyed) return clearInterval(timer);
        if (cut && at >= stop) { clearInterval(timer); return res.destroy(); }
        res.write(BIG.subarray(at, Math.min(BIG.length, at + step)));
        at += step;
        if (at >= BIG.length) { clearInterval(timer); res.end(); }
      }, 50);
      res.on('close', () => clearInterval(timer));
      return undefined;
    }
    return res.end(page('Page ' + p, `<h1>${p}</h1>`));
  };
}

module.exports = async function essentielsTests(ctx) {
  const { first: w, OrbeWindow, store, win, essentials } = ctx;
  const standalone = !ctx.check;
  let failed = 0;
  let total = 0;
  const check = ctx.check || ((name, ok, detail = '') => {
    total += 1;
    if (!ok) failed += 1;
    console.log(`${ok ? '  ✓' : '  ✗'} ${name}${ok || !detail ? '' : ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail))}`);
  });
  if (standalone) console.log('\nOrbe — navigation de tous les jours\n');
  const { sheets, permissions, displayMedia, capture, certs, auth, unload, popups, downloads } = essentials;
  const t = (k, v) => store.t(k, null, v);
  const ui = (js) => w.ui.webContents.executeJavaScript(js);

  const state = { seen: [], mode: 'lent', port: 0 };
  const server = http.createServer(handler(state));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  state.port = server.address().port;
  const A = `http://127.0.0.1:${state.port}`;
  const B = `http://localhost:${state.port}`;
  const pem = selfSigned();
  const tls = https.createServer({ key: pem.key, cert: pem.cert }, handler(state));
  await new Promise((r) => tls.listen(0, '127.0.0.1', r));
  const S = `https://127.0.0.1:${tls.address().port}`;

  // Réponses pilotées : aucune boîte de dialogue du système pendant les tests.
  const saved = {
    ask: unload.env.ask, confirm: permissions.env.confirm, openExternal: permissions.env.openExternal, osStatus: permissions.os.status, osAsk: permissions.os.ask,
    sources: displayMedia.env.sources, hsts: certs.internals.probes.hsts, dl: { ...downloads.env }, settings: { ...store.state.settings },
  };
  const opened = [];
  const launched = [];
  permissions.env.openExternal = (url) => { launched.push(url); };
  const asks = [];
  let leave = false;
  unload.env.ask = (parent, opts) => { asks.push(opts); return leave ? 0 : 1; };

  const rtOf = (id) => win.live.get(id);
  const open = async (url, title, owner = w) => {
    const tab = owner.newTab(url);
    opened.push([owner, tab.id]);
    if (title) await until(() => owner.data.tabs[tab.id] && owner.data.tabs[tab.id].title === title, 'page « ' + title + ' »');
    return { tab, id: tab.id, get rt() { return rtOf(tab.id); }, wc: rtOf(tab.id).wc };
  };
  const js = (wc, code, gesture = false) => wc.executeJavaScript(code, gesture);
  // Vraie entrée de l'utilisateur dans la page (clic dans un coin vide).
  const click = async (wc, x = 230, y = 90) => {
    const rt = [...win.live.values()].find((r) => r.wc === wc);
    rt.gesture = 0;
    wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
    await until(() => rt.gesture > 0, 'entrée reçue par la page');
  };
  const sheetOf = (wc, kind, timeout) => until(() => { const s = sheets.top(wc); return s && s.kind === kind ? s : null; }, 'feuille « ' + kind + ' »', timeout);
  const noSheet = async (wc, ms = 500) => { await sleep(ms); return !sheets.top(wc); };
  // Contenu réellement affiché par une feuille, et clic dans la feuille.
  const inSheet = async (sheet, code) => {
    const vwc = sheet.view.webContents;
    await until(() => vwc.executeJavaScript('!document.getElementById("card").hidden'), 'feuille affichée');
    return vwc.executeJavaScript(code);
  };
  const press = (sheet, id) => inSheet(sheet, `shownAt = 0; document.getElementById(${JSON.stringify(id)}).click(); 1`);
  const origin = (url) => new URL(url).origin;

  // ---------------------------------------------------------------- Autorisations
  const cam = await open(A + '/camera', 'Page /camera');
  check('une page web n’a aucun accès à l’interface d’Orbe', await js(cam.wc, 'typeof window.orbe') === 'undefined');
  let pending = js(cam.wc, 'navigator.mediaDevices.getUserMedia({ video: true }).then((s) => { window.flux = s; return "flux:" + s.getTracks().map((x) => x.kind).join(); }, (e) => "err:" + e.name)', true);
  let sheet = await sheetOf(cam.wc, 'perm');
  check('caméra : la question est une feuille d’Orbe posée sur l’onglet, qui ne nomme que la caméra',
    sheet.payload.lines.length === 1 && sheet.payload.lines[0] === t('perm.camera') && sheet.payload.site === A && sheet.parent === w, sheet.payload);
  const shown = await inSheet(sheet, '({ title: document.getElementById("title").textContent, lines: [...document.querySelectorAll("#body p")].map((p) => p.textContent), buttons: [...document.querySelectorAll("#buttons button")].map((b) => b.id) })');
  check('la feuille affiche le site, ce qui est demandé, et « Refuser » / « Autoriser »', shown.title.includes('127.0.0.1') && shown.lines[0] === t('perm.camera') && shown.buttons.join() === 'deny,allow', shown);
  // Vue de la feuille : au-dessus de la page, aux mêmes dimensions.
  const same = (a, b) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
  check('la feuille couvre exactement la page de son onglet', same(sheet.view.getBounds(), cam.rt.view.getBounds()) && w.win.contentView.children.indexOf(sheet.view) > w.win.contentView.children.indexOf(cam.rt.view));
  check('une page ne peut pas répondre à la place de la feuille', await sheets.action('sheet:answer', 'allow', cam.wc) === undefined && !sheet.closed);
  await inSheet(sheet, 'shownAt = Date.now(); document.getElementById("allow").click(); 1');
  await sleep(250);
  check('un clic tombé à l’instant où la feuille apparaît est ignoré', !sheet.closed);
  await press(sheet, 'allow');
  check('caméra autorisée : la page reçoit son flux (appareil factice)', await pending === 'flux:video');
  check('la réponse est retenue pour la caméra seule, par origine', store.state.permissions[A] && store.state.permissions[A].camera === true && !('microphone' in store.state.permissions[A]) && !('media' in store.state.permissions[A]), store.state.permissions[A]);
  check('témoin : la page utilise la caméra', capture.of(cam.wc).join() === 'camera');
  await until(() => ui('S.nav.capture && S.nav.capture.join() === "camera" && !document.getElementById("capture-note").hidden && !!document.querySelector("#today .row.capturing")'), 'témoin dans la barre latérale');
  check('le témoin apparaît dans la pastille d’adresse et sur la ligne de l’onglet', true);
  check('un onglet qui capte n’est pas mis en veille', win.hooks.busy(cam.rt) === true);

  pending = js(cam.wc, 'navigator.mediaDevices.getUserMedia({ video: true }).then((s) => "flux", (e) => "err:" + e.name)', true);
  check('deuxième demande : plus de question', await pending === 'flux' && !sheets.top(cam.wc));

  pending = js(cam.wc, 'navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => "flux", (e) => "err:" + e.name)', true);
  sheet = await sheetOf(cam.wc, 'perm');
  check('micro : question distincte de celle de la caméra', sheet.payload.lines.join() === t('perm.microphone'));
  await press(sheet, 'deny');
  check('micro refusé : la page reçoit une erreur, le refus est retenu', await pending === 'err:NotAllowedError' && store.state.permissions[A].microphone === false);
  pending = js(cam.wc, 'navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => "flux", (e) => "err:" + e.name)', true);
  check('micro refusé : plus de question ensuite', await pending === 'err:NotAllowedError' && !sheets.top(cam.wc));

  // Accord du système (macOS, Windows) : en plus de celui du site.
  const asked = [];
  permissions.os.status = (kind) => (kind === 'camera' ? 'denied' : 'granted');
  pending = js(cam.wc, 'navigator.mediaDevices.getUserMedia({ video: true }).then((s) => "flux", (e) => "err:" + e.name)', true);
  sheet = await sheetOf(cam.wc, 'os');
  check('site autorisé mais système qui refuse : la page n’a rien, et Orbe dit que c’est le système qui bloque la caméra',
    await pending === 'err:NotAllowedError' && sheet.payload.title.includes(t('os.name.camera')) && sheet.payload.settings === true && store.state.permissions[A].camera === true, sheet.payload);
  sheet.close('ok');
  permissions.os.status = (kind) => (asked.includes(kind) ? 'granted' : 'not-determined');
  permissions.os.ask = async (kind) => { asked.push(kind); return true; };
  pending = js(cam.wc, 'navigator.mediaDevices.getUserMedia({ video: true }).then((s) => "flux", (e) => "err:" + e.name)', true);
  check('accord du système pas encore donné : Orbe le demande (askForMediaAccess), pour la caméra seulement', await pending === 'flux' && asked.join() === 'camera', asked);
  permissions.os.status = saved.osStatus;
  permissions.os.ask = saved.osAsk;

  // Vue des autorisations du site (menu du bouclier, cadenas).
  essentials.siteInfo(w);
  sheet = await sheetOf(cam.wc, 'site');
  const listed = await inSheet(sheet, '[...document.querySelectorAll("#perms .item")].map((r) => r.dataset.key + ":" + r.querySelector(".state").className)');
  check('informations du site : autorisations accordées et refusées, une par ligne', listed.join() === 'camera:state yes,microphone:state no', listed);
  check('le menu du site y mène', win.hooks.siteMenu(w)[0].label === t('site.info') && win.hooks.siteMenu(w)[0].enabled === true);
  await inSheet(sheet, 'document.querySelector("#perms .item[data-key=microphone] [data-do=reset]").click(); 1');
  await until(() => !('microphone' in (store.state.permissions[A] || {})), 'micro réinitialisé');
  await until(() => inSheet(sheet, 'document.querySelectorAll("#perms .item").length === 1'), 'liste mise à jour');
  check('« Réinitialiser » oublie une autorisation, sans toucher aux autres', store.state.permissions[A].camera === true);
  await press(sheet, 'close');
  await until(() => !sheets.top(cam.wc), 'feuille fermée');

  // Ancien format : « media » valait pour la caméra et le micro.
  store.state.permissions['https://ancien.exemple'] = { media: true };
  check('ancien réglage « media » : lu comme caméra et micro', permissions.get(cam.wc.session, 'https://ancien.exemple', 'camera') === true && permissions.get(cam.wc.session, 'https://ancien.exemple', 'microphone') === true
    && permissions.list(cam.wc.session, 'https://ancien.exemple').map((x) => x.key).join() === 'camera,microphone');
  permissions.reset(cam.wc.session, 'https://ancien.exemple', 'camera');
  check('ancien réglage : réinitialiser la caméra garde le micro', JSON.stringify(store.state.permissions['https://ancien.exemple']) === '{"microphone":true}', store.state.permissions['https://ancien.exemple']);
  delete store.state.permissions['https://ancien.exemple'];

  // Arrêt depuis le témoin : la page est rechargée, le témoin s'éteint.
  check('« Arrêter » recharge la page', capture.stop(cam.wc) === true);
  await until(() => !capture.of(cam.wc).length && !cam.wc.isLoading(), 'témoin éteint');
  await until(() => ui('!S.nav.capture.length && document.getElementById("capture-note").hidden'), 'témoin retiré de la barre');
  check('après l’arrêt, le témoin disparaît et le flux n’existe plus', await js(cam.wc, 'typeof window.flux') === 'undefined');

  // Une question disparaît avec la page qui l'a posée, sans rien retenir.
  js(cam.wc, 'Notification.requestPermission(); 1', true).catch(() => {});
  sheet = await sheetOf(cam.wc, 'perm');
  cam.wc.loadURL(A + '/autre');
  await until(() => sheet.closed, 'question fermée par la navigation');
  check('la page change : la question se ferme, rien n’est retenu', !('notifications' in store.state.permissions[A]));
  await until(() => w.data.tabs[cam.id].title === 'Page /autre', 'page suivante');

  // Navigation privée : les réponses restent en mémoire.
  const iw = new OrbeWindow({ incognito: true });
  const priv = await open(B + '/prive', 'Page /prive', iw);
  js(priv.wc, 'Notification.requestPermission(); 1', true).catch(() => {});
  sheet = await sheetOf(priv.wc, 'perm');
  sheet.close('allow');
  await until(() => permissions.get(priv.wc.session, B, 'notifications') === true, 'réponse retenue en mémoire');
  check('navigation privée : la réponse n’est pas écrite dans le profil', !store.state.permissions[B]);

  // ---------------------------------------------------------------- Partage d'écran
  const fake = { id: 'screen:9999:0', name: 'Écran <b>factice</b>', kind: 'screen', thumb: '', source: { id: 'screen:9999:0', name: 'Écran factice' } };
  displayMedia.env.sources = async () => [fake];
  const share = await open(A + '/partage', 'Page /partage');
  check('partage sans geste de l’utilisateur : refusé, sans sélecteur', (await js(share.wc, 'navigator.mediaDevices.getDisplayMedia({ video: true }).then(() => "flux", (e) => "err:" + e.name)')).startsWith('err:') && !sheets.top(share.wc));
  pending = js(share.wc, 'navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }).then((s) => { window.flux = s; return "flux:" + s.getVideoTracks().length; }, (e) => "err:" + e.name)', true);
  sheet = await sheetOf(share.wc, 'picker');
  await until(() => sheet.payload.sources.length === 2, 'écrans listés');
  check('sélecteur : « Cet onglet », puis les écrans et fenêtres (relevés par le processus principal)', sheet.payload.sources.map((s) => s.kind).join() === 'tab,screen' && sheet.payload.audioRequested === true && !('source' in sheet.payload.sources[1]), sheet.payload.sources.map((s) => s.kind));
  const tiles = await until(async () => { const v = await inSheet(sheet, '[...document.querySelectorAll(".src")].map((b) => b.dataset.kind + ":" + b.querySelector(".name").textContent + ":" + b.querySelectorAll("b").length)'); return v.length === 2 && v; }, 'vignettes');
  check('sélecteur : les noms venus du système sont affichés comme du texte', tiles[0].startsWith('tab:' + t('share.thisTab')) && tiles[1] === 'screen:Écran <b>factice</b>:0', tiles);
  check('rien n’est partagé avant le choix', await inSheet(sheet, 'document.getElementById("share").disabled') === true && await js(share.wc, 'typeof window.flux') === 'undefined' && !capture.of(share.wc).length);
  // Les captures d'Orbe lui-même (vignettes) comptent dans isBeingCaptured() ; écran
  // en veille, elles n'aboutissent jamais et la fin du partage n'est pas observable.
  const noisy = share.wc.isBeingCaptured();
  await inSheet(sheet, 'document.querySelector(".src[data-kind=tab]").click(); 1');
  check('« Partager aussi le son » proposé pour l’onglet', await inSheet(sheet, '!document.getElementById("audio").closest("label").hidden && !document.getElementById("share").disabled'));
  await press(sheet, 'share');
  check('« Cet onglet » : la page reçoit un flux vidéo', await pending === 'flux:1', await pending);
  await until(() => capture.of(share.wc).includes('screen'), 'capture en cours');
  await until(() => ui('S.nav.capture.includes("screen")'), 'témoin de partage');
  check('témoin « partage d’écran » pendant la capture de l’onglet', true);
  await js(share.wc, 'window.flux.getTracks().forEach((x) => x.stop()); 1');
  if (noisy) {
    console.log('  – ignoré : partage de l’onglet arrêté par la page : le témoin s’éteint (une capture d’Orbe est restée en attente, écran en veille)');
    capture.clearAll(share.wc);
  } else {
    await until(() => !capture.of(share.wc).includes('screen'), 'fin du partage observée', 20000);
    check('partage de l’onglet arrêté par la page : le témoin s’éteint (isBeingCaptured)', !share.wc.isBeingCaptured());
  }

  permissions.os.status = (kind) => (kind === 'screen' ? 'denied' : 'granted');
  pending = js(share.wc, 'navigator.mediaDevices.getDisplayMedia({ video: true }).then(() => "flux", (e) => "err:" + e.name)', true);
  sheet = await sheetOf(share.wc, 'picker');
  check('macOS n’autorise pas l’enregistrement de l’écran : le sélecteur le dit et propose d’ouvrir les réglages',
    sheet.payload.os === 'denied' && await inSheet(sheet, '!!document.getElementById("settings") && document.querySelector("#body p.warn").textContent') === t('share.osDenied'));
  // Réponse forgée : une source qui n'est pas dans la liste du processus principal.
  sheet.close({ id: 'screen:1:0', audio: true });
  check('une source absente de la liste proposée est refusée', (await pending).startsWith('err:'), await pending);
  permissions.os.status = saved.osStatus;
  pending = js(share.wc, 'navigator.mediaDevices.getDisplayMedia({ video: true }).then(() => "flux", (e) => "err:" + e.name)', true);
  sheet = await sheetOf(share.wc, 'picker');
  await inSheet(sheet, 'window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); 1');
  check('Échap annule le partage : la page reçoit une erreur', (await pending).startsWith('err:'));
  check('aucune autorisation de partage n’est retenue', !store.state.permissions[A] || !Object.keys(store.state.permissions[A]).some((k) => /display|screen/.test(k)));
  pending = js(priv.wc, 'navigator.mediaDevices.getDisplayMedia({ video: true }).then(() => "flux", (e) => "err:" + e.name)', true);
  sheet = await sheetOf(priv.wc, 'picker');
  sheet.close(null);
  check('navigation privée : même sélecteur', (await pending).startsWith('err:'));
  displayMedia.env.sources = saved.sources;

  // ---------------------------------------------------------------- Certificats
  check('état de la connexion : https sûr, http « non sécurisé », machine locale à part',
    certs.state(null, 'https://exemple.org/') === 'secure' && certs.state(null, 'http://exemple.org/') === 'insecure' && certs.state(null, A + '/') === 'local' && certs.state(null, 'file:///x') === '');
  const sec = await open(A + '/avant', 'Page /avant');
  sec.wc.loadURL(S + '/secret').catch(() => {});
  sheet = await sheetOf(sec.wc, 'cert');
  const host = new URL(S).host;
  check('certificat refusé : avertissement d’Orbe par-dessus l’onglet, avec le nom du site et la cause',
    sheet.payload.cover === true && sheet.payload.host === host && sheet.payload.reason === 'authority' && sheet.payload.error === 'net::ERR_CERT_AUTHORITY_INVALID' && sheet.payload.canProceed === true, sheet.payload);
  check('le certificat présenté est décrit : émetteur, validité, empreinte', sheet.payload.cert.issuer === pem.cn && sheet.payload.cert.subject === pem.cn && /^sha256\//.test(sheet.payload.cert.fingerprint) && sheet.payload.cert.validExpiry > Date.now() / 1000, sheet.payload.cert);
  check('la page du site n’a pas été chargée', !state.seen.some((x) => x.path === '/secret') && w.data.tabs[sec.id].url === S + '/secret');
  await until(() => ui('S.nav.security === "broken" && !document.getElementById("lock").hidden && document.getElementById("lock-text").textContent === ' + JSON.stringify(t('site.notSecure'))), 'pastille « Non sécurisé »');
  check('pastille d’adresse : « Non sécurisé » pendant l’avertissement', true);
  const warn = await inSheet(sheet, '({ title: document.getElementById("title").textContent, focus: document.activeElement && document.activeElement.id, hidden: document.getElementById("details").hidden, proceedShown: !!document.getElementById("proceed") && document.getElementById("proceed").offsetParent !== null, first: document.querySelector("#buttons button").id })');
  check('« Revenir en lieu sûr » est le choix par défaut ; « Continuer quand même » est caché derrière « Détails »', warn.title === t('cert.title') && warn.first === 'back' && warn.hidden === true && warn.proceedShown === false, warn);
  await inSheet(sheet, 'document.getElementById("more").click(); 1');
  const det = await inSheet(sheet, '({ text: document.getElementById("details").textContent, proceedShown: document.getElementById("proceed").offsetParent !== null })');
  check('« Détails » montre l’émetteur, l’empreinte et l’erreur', det.text.includes(pem.cn) && det.text.includes(sheet.payload.cert.fingerprint) && det.text.includes('ERR_CERT_AUTHORITY_INVALID') && det.proceedShown === true);
  await press(sheet, 'back');
  await until(() => w.data.tabs[sec.id].url === A + '/avant' && !sheets.top(sec.wc), 'retour à la page précédente');
  check('« Revenir en lieu sûr » ramène à la page précédente, sans exception', !certs.hasException(sec.wc.session, S + '/'));
  await until(() => ui('S.nav.security === "local" && document.getElementById("lock").hidden'), 'pastille sans alerte');

  // Site qui impose HTTPS (HSTS) ou refus sans appel : pas de « continuer ».
  certs.internals.probes.hsts = async () => true;
  sec.wc.loadURL(S + '/secret').catch(() => {});
  sheet = await sheetOf(sec.wc, 'cert');
  check('site HSTS : « Continuer quand même » n’est pas proposé', sheet.payload.canProceed === false && sheet.payload.hsts === true && await inSheet(sheet, '!document.getElementById("proceed")'));
  sheet.close('proceed'); // réponse forgée
  await sleep(600);
  check('site HSTS : une réponse « continuer » forgée est ignorée', !certs.hasException(sec.wc.session, S + '/') && !state.seen.some((x) => x.path === '/secret'));
  certs.internals.probes.hsts = async () => false;
  certs.failed(sec.wc, { code: -206, url: S + '/secret' }, { back() {}, load() {} });
  sheet = await sheetOf(sec.wc, 'cert');
  check('certificat révoqué : refus sans appel', sheet.payload.hard === true && sheet.payload.canProceed === false && sheet.payload.reason === 'revoked');
  sheet.close(null);
  check('la sonde HSTS ne sort pas de la machine pour une adresse locale', await certs.internals.probeHsts(sec.wc.session, '127.0.0.1') === false && await certs.internals.probeHsts(sec.wc.session, 'localhost') === false);
  certs.internals.probes.hsts = saved.hsts;

  sec.wc.loadURL(S + '/secret').catch(() => {});
  sheet = await sheetOf(sec.wc, 'cert');
  const fingerprint = sheet.payload.cert.fingerprint;
  await inSheet(sheet, 'document.getElementById("more").click(); 1');
  await press(sheet, 'proceed');
  await until(() => w.data.tabs[sec.id].title === 'Page /secret', 'page chargée après « continuer »');
  check('« Continuer quand même » : la page se charge, pour cet hôte et ce certificat', certs.internals.isAllowed(sec.wc.session, S + '/x', fingerprint) && !certs.internals.isAllowed(sec.wc.session, S + '/x', 'sha256/autre') && !certs.internals.isAllowed(sec.wc.session, S.replace('127.0.0.1', 'localhost') + '/', fingerprint));
  await until(() => ui('S.nav.security === "broken"'), 'toujours signalé');
  check('après « continuer », la pastille reste « Non sécurisé »', true);
  store.flush();
  check('l’exception n’est jamais écrite sur disque', fs.readdirSync(path.dirname(store.file)).filter((f) => f.endsWith('.json')).every((f) => !fs.readFileSync(path.join(path.dirname(store.file), f), 'utf8').includes(fingerprint)));
  priv.wc.loadURL(S + '/secret').catch(() => {});
  sheet = await sheetOf(priv.wc, 'cert');
  check('l’exception ne vaut pas pour une autre session (navigation privée)', sheet.payload.canProceed === true && !certs.hasException(priv.wc.session, S + '/'));
  sheet.close(null);
  check('résumé du certificat pour le cadenas', (certs.certFor(sec.wc.session, S + '/') || {}).fingerprint === fingerprint);
  essentials.siteInfo(w);
  sheet = await sheetOf(sec.wc, 'site');
  check('informations du site : connexion non sécurisée, certificat, exception en cours', sheet.payload.security === 'broken' && sheet.payload.cert.fingerprint === fingerprint && sheet.payload.perms[0].key === 'cert-exception');
  await inSheet(sheet, 'document.querySelector("#perms .item[data-key=cert-exception] [data-do=reset]").click(); 1');
  sheet = await sheetOf(sec.wc, 'cert');
  check('retirer l’exception : l’avertissement revient', !certs.hasException(sec.wc.session, S + '/'));
  sheet.close(null);
  iw.win.close();
  await until(() => !OrbeWindow.all.includes(iw), 'fenêtre privée fermée');

  // ---------------------------------------------------------------- Authentification HTTP
  const au = await open(A + '/zero', 'Page /zero');
  au.wc.loadURL(A + '/auth').catch(() => {});
  sheet = await sheetOf(au.wc, 'auth');
  check('authentification HTTP : feuille sur l’onglet, avec l’hôte rapporté par Electron', sheet.payload.host === new URL(A).host && sheet.payload.proxy === false && sheet.payload.retry === false && sheet.payload.insecure === false, sheet.payload);
  const realm = await inSheet(sheet, '({ quote: document.querySelector(".quote").textContent, tags: document.querySelectorAll(".quote b").length, pass: document.getElementById("pass").type })');
  check('le message du serveur est cité comme du texte ; le mot de passe est masqué', realm.quote === 'Zone <b>reservee</b>' && realm.tags === 0 && realm.pass === 'password', realm);
  await press(sheet, 'cancel');
  await until(() => w.data.tabs[au.id].title === 'Refusé', 'page 401');
  check('annuler : la page de refus du serveur s’affiche, sans identifiant envoyé', !state.seen.some((x) => x.path === '/auth' && x.auth));
  au.wc.loadURL(A + '/auth').catch(() => {});
  sheet = await sheetOf(au.wc, 'auth');
  await inSheet(sheet, 'document.getElementById("user").value = "alice"; document.getElementById("pass").value = "faux"; 1');
  await press(sheet, 'ok');
  await until(() => sheet.closed, 'première réponse');
  sheet = await sheetOf(au.wc, 'auth');
  check('identifiants refusés : la question revient et le dit', sheet.payload.retry === true);
  await inSheet(sheet, 'document.getElementById("user").value = "alice"; document.getElementById("pass").value = "secret"; 1');
  await press(sheet, 'ok');
  await until(() => w.data.tabs[au.id].title === 'Entré', 'page protégée');
  check('bons identifiants : la page protégée s’affiche', state.seen.some((x) => x.path === '/auth' && x.auth === 'Basic ' + Buffer.from('alice:secret').toString('base64')));
  // Ressource d'un autre site qui réclame un mot de passe : aucune question.
  const emb = await open(A + '/embarque', 'Embarque');
  await until(() => state.seen.some((x) => x.path === '/auth.png'), 'image demandée');
  check('une image d’un autre site ne peut pas faire apparaître la question', await noSheet(emb.wc, 700));
  // Réponse forgée (pas des chaînes) : demande annulée.
  let got = 'rien';
  const fakeEvent = { preventDefault() {} };
  auth.internals.onLogin(fakeEvent, emb.wc, { url: A + '/auth', isRequestForNavigation: true, firstAuthAttempt: true }, { isProxy: true, scheme: 'basic', host: 'proxy.exemple', port: 3128, realm: 'r' }, (...args) => { got = args; });
  sheet = await sheetOf(emb.wc, 'auth');
  check('proxy : la feuille nomme le proxy et son port', sheet.payload.proxy === true && sheet.payload.host === 'proxy.exemple:3128');
  sheet.close({ username: { toString() { return 'x'; } }, password: 1 });
  await until(() => got !== 'rien', 'réponse');
  check('réponse mal formée : la demande est annulée', Array.isArray(got) && got.length === 0, got);

  // Certificat client : jamais envoyé sans un choix.
  let chosen = 'rien';
  let prevented = false;
  const certs2 = [{ subjectName: 'Alice', issuerName: 'AC Test', fingerprint: 'a' }, { subjectName: 'Bob', issuerName: 'AC Test', fingerprint: 'b' }];
  app.emit('select-client-certificate', { preventDefault() { prevented = true; } }, emb.wc, 'https://client.exemple/', certs2, (c) => { chosen = c; });
  sheet = await sheetOf(emb.wc, 'choose');
  check('certificat client : Electron n’envoie pas le premier d’office ; Orbe demande lequel', prevented && chosen === 'rien' && sheet.payload.items.map((x) => x.label).join() === 'Alice,Bob' && sheet.payload.host === 'client.exemple');
  await inSheet(sheet, 'document.querySelector(".item[data-i=\\"1\\"]").click(); 1');
  await press(sheet, 'ok');
  await until(() => chosen !== 'rien', 'choix');
  check('certificat client : celui qui est choisi est envoyé', chosen === certs2[1]);
  chosen = 'rien';
  app.emit('select-client-certificate', { preventDefault() {} }, emb.wc, 'https://client.exemple/', certs2, (c) => { chosen = c; });
  (await sheetOf(emb.wc, 'choose')).close(null);
  await until(() => chosen !== 'rien', 'annulation');
  check('certificat client : annuler n’en envoie aucun', chosen === undefined);

  // ---------------------------------------------------------------- « Quitter la page ? »
  const dirty = await open(A + '/sale', 'Brouillon');
  await js(dirty.wc, 'window.sale = true; 1');
  asks.length = 0;
  w.close(dirty.id);
  await until(() => dirty.wc.isDestroyed(), 'page fermée');
  check('page jamais touchée : elle ne retient pas l’onglet, aucune question', asks.length === 0 && !w.data.tabs[dirty.id]);

  const d2 = await open(A + '/sale', 'Brouillon');
  await click(d2.wc);
  await js(d2.wc, 'window.sale = true; 1');
  leave = false;
  d2.wc.loadURL(A + '/ailleurs').catch(() => {});
  await until(() => asks.length === 1, 'question posée');
  check('navigation depuis une page modifiée : « Quitter la page ? Les modifications peuvent ne pas être enregistrées »',
    asks[0].message === t('unload.title') && asks[0].detail.includes(t('unload.detail')) && asks[0].detail.includes('127.0.0.1') && !asks[0].detail.includes('ignore') && asks[0].defaultId === 1 && asks[0].buttons[1] === t('unload.stay'), asks[0]);
  await sleep(400);
  check('« Rester » : la page reste, intacte', d2.wc.getURL() === A + '/sale' && await js(d2.wc, 'window.sale') === true);
  const row = w.space.today.indexOf(d2.id);
  const inArchive = () => store.state.archive.filter((x) => x.url === A + '/sale').length;
  const archivedBefore = inArchive();
  const undoBefore = w.pendingLabel('undo');
  w.close(d2.id);
  await until(() => asks.length === 2, 'question à la fermeture');
  await until(() => w.data.tabs[d2.id] && w.activeId === d2.id && win.live.get(d2.id) === d2.rt, 'onglet revenu');
  check('fermer l’onglet puis « Rester » : l’onglet revient à sa place, avec la même page', w.space.today.indexOf(d2.id) === row && !d2.wc.isDestroyed() && await js(d2.wc, 'window.sale') === true && w.win.contentView.children.includes(d2.rt.view));
  check('l’onglet revenu n’est plus dans l’archive, et sa fermeture n’est plus à annuler', inArchive() === archivedBefore && w.pendingLabel('undo') === undoBefore && !w.closed.some((r) => r.tab && r.tab.id === d2.id));
  await js(d2.wc, 'document.title = "Brouillon modifié"; 1');
  await until(() => w.data.tabs[d2.id].title === 'Brouillon modifié', 'titre suivi');
  check('l’onglet revenu suit toujours sa page (titre, adresse)', true);

  // Plusieurs onglets archivés d'un coup : une question par page qui s'y oppose.
  const d3 = await open(A + '/sale', 'Brouillon');
  await click(d3.wc);
  await js(d3.wc, 'window.sale = true; 1');
  const calm = await open(A + '/calme', 'Page /calme');
  asks.length = 0;
  leave = true;
  w.closeMany([d2.id, d3.id, calm.id]);
  await until(() => d2.wc.isDestroyed() && d3.wc.isDestroyed(), 'pages fermées');
  check('archiver plusieurs onglets : une question par page qui s’y oppose, pas pour les autres', asks.length === 2 && !w.data.tabs[d2.id] && !w.data.tabs[d3.id] && !w.data.tabs[calm.id], asks.length);

  // Fermeture d'une fenêtre.
  const w2 = new OrbeWindow();
  const d4 = await open(A + '/sale', 'Brouillon', w2);
  await click(d4.wc);
  await js(d4.wc, 'window.sale = true; 1');
  asks.length = 0;
  leave = false;
  const archived = store.state.archive.length;
  w2.win.close();
  await until(() => asks.length === 1, 'question à la fermeture de la fenêtre');
  await sleep(500);
  check('fermer la fenêtre puis « Rester » : la fenêtre et la page restent', !w2.win.isDestroyed() && OrbeWindow.all.includes(w2) && !d4.wc.isDestroyed() && await js(d4.wc, 'window.sale') === true);
  leave = true;
  w2.win.close();
  await until(() => !OrbeWindow.all.includes(w2), 'fenêtre fermée');
  check('fermer la fenêtre puis « Quitter » : elle se ferme, l’onglet reste dans l’Espace (non archivé)', asks.length === 2 && !!store.state.tabs[d4.id] && store.state.archive.length === archived && d4.wc.isDestroyed());
  leave = false;

  // ---------------------------------------------------------------- Fenêtres surgissantes
  const pop = await open(A + '/surgit', 'Page /surgit');
  let count = w.space.today.length;
  check('window.open sans geste : bloqué, la page reçoit null', await js(pop.wc, 'window.open("/pub") === null', true) === true && w.space.today.length === count);
  await until(() => ui('S.nav.popups === 1 && !document.getElementById("popup-note").hidden && document.getElementById("popup-note").title === ' + JSON.stringify(t('popup.blocked'))), 'mention dans la pastille');
  check('mention « Fenêtre surgissante bloquée » dans la pastille d’adresse', popups.count(pop.rt) === 1);
  await js(pop.wc, 'const a = document.createElement("a"); a.href = "/pub2"; a.target = "_blank"; document.body.append(a); a.click(); 1', true);
  await sleep(300);
  check('lien target=_blank cliqué par script : bloqué aussi', w.space.today.length === count && popups.count(pop.rt) === 2);
  const menu = popups.menu(w, pop.rt, t);
  check('menu de la mention : « Ouvrir quand même » et « Toujours autoriser pour ce site »', menu.some((m) => m.label === t('popup.open', { url: A + '/pub' })) && menu.some((m) => m.label === t('popup.always', { site: A })), menu.map((m) => m.label));
  await click(pop.wc);
  check('après un vrai clic : la fenêtre s’ouvre, avec window.opener', await js(pop.wc, 'window.fille = window.open("/fille"); !!window.fille') === true);
  await until(() => w.space.today.length === count + 1, 'onglet ouvert');
  const child = w.activeId;
  opened.push([w, child]);
  check('l’onglet ouvert par le clic se place sous sa page d’origine', w.space.today[w.space.today.indexOf(pop.id) + 1] === child && await until(() => js(rtOf(child).wc, '!!window.opener'), 'opener'));
  w.activate(pop.id);
  check('un geste n’ouvre qu’une fenêtre : la suivante est bloquée', await js(pop.wc, 'window.open("/encore") === null') === true);
  menu.find((m) => m.label === t('popup.open', { url: A + '/pub' })).click();
  await until(() => w.space.today.length === count + 2, '« ouvrir quand même »');
  opened.push([w, w.activeId]);
  check('« Ouvrir quand même » ouvre l’adresse bloquée dans un onglet', w.data.tabs[w.activeId].url === A + '/pub');
  w.activate(pop.id);
  popups.menu(w, pop.rt, t).find((m) => m.label === t('popup.always', { site: A })).click();
  check('« Toujours autoriser pour ce site » : retenu comme une autorisation, la mention disparaît', store.state.permissions[A].popups === true && popups.count(pop.rt) === 0 && permissions.list(pop.wc.session, A).some((x) => x.key === 'popups' && x.label === t('perm.popups')));
  pop.rt.gesture = 0;
  count = w.space.today.length;
  await js(pop.wc, 'window.open("/libre"); 1');
  await until(() => w.space.today.length === count + 1, 'ouverture autorisée');
  opened.push([w, w.activeId]);
  check('site autorisé : window.open passe sans geste', true);
  permissions.reset(pop.wc.session, A, 'popups');
  w.activate(pop.id);
  pop.rt.gesture = 0;
  await js(pop.wc, 'window.open("/x"); 1');
  await until(() => popups.count(pop.rt) === 1, 'bloquée de nouveau');
  pop.wc.loadURL(A + '/suite');
  await until(() => w.data.tabs[pop.id].title === 'Page /suite', 'page suivante');
  check('une nouvelle page efface la mention', popups.count(pop.rt) === 0);

  // ---------------------------------------------------------------- Liens vers d'autres applications
  const ext = await open(A + '/lien', 'Lien externe');
  await click(ext.wc, 40, 20);
  sheet = await sheetOf(ext.wc, 'external');
  check('lien mailto: : Orbe demande avant d’ouvrir une autre application', sheet.payload.scheme === 'mailto' && sheet.payload.url.startsWith('mailto:test@orbe.invalid') && sheet.payload.site === A && launched.length === 0, sheet.payload);
  await press(sheet, 'cancel');
  await sleep(300);
  check('annuler : rien n’est ouvert, la page reste affichée (pas de page d’erreur)', launched.length === 0 && w.data.tabs[ext.id].url === A + '/lien' && w.data.tabs[ext.id].title === 'Lien externe');
  await click(ext.wc, 40, 20);
  sheet = await sheetOf(ext.wc, 'external');
  await inSheet(sheet, 'document.getElementById("always").checked = true; 1');
  await press(sheet, 'ok');
  await until(() => launched.length === 1, 'application lancée');
  check('« Ouvrir » avec « Toujours autoriser » : lien ouvert, retenu par site et par schéma', launched[0].startsWith('mailto:test@orbe.invalid') && store.state.permissions[A]['external:mailto'] === true);
  await click(ext.wc, 40, 20);
  sheet = await sheetOf(ext.wc, 'external');
  check('ouvertures rapprochées : la question revient malgré l’autorisation', launched.length === 1);
  sheet.close(null);
  permissions.internals.lastExternal.clear();
  await click(ext.wc, 40, 20);
  await until(() => launched.length === 2, 'ouverture sans question');
  check('plus tard, le site autorisé ouvre son lien sans question', !sheets.top(ext.wc));
  const entry = permissions.internals.memories.get(ext.wc.session);
  const refused = [];
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'ms-msdt:/id', 'https://exemple.org/', 'pas une adresse']) refused.push(await permissions.internals.external(entry, ext.wc, A, { externalURL: url }));
  check('schémas dangereux (file:, javascript:, ms-msdt:…) : jamais ouverts, sans question', refused.every((x) => x === false) && launched.length === 2 && !sheets.top(ext.wc));

  // ---------------------------------------------------------------- Appareils
  let answer = 'rien';
  prevented = false;
  ext.wc.emit('select-bluetooth-device', { preventDefault() { prevented = true; } }, [{ deviceId: 'premier', deviceName: 'Casque' }], (id) => { answer = id; });
  check('Bluetooth : la demande est annulée tout de suite, jamais le premier appareil d’office', prevented && answer === '');
  answer = 'rien';
  prevented = false;
  ext.wc.session.emit('select-usb-device', { preventDefault() { prevented = true; } }, { deviceList: [{ deviceId: 'cle' }], frame: ext.wc.mainFrame }, (id) => { answer = id; });
  check('USB : la demande est annulée proprement', prevented && answer === undefined);
  answer = 'rien';
  ext.wc.session.emit('select-serial-port', { preventDefault() {} }, [{ portId: 'p1' }], ext.wc, (id) => { answer = id; });
  check('port série : la demande est annulée proprement', answer === '');
  check('aucun appareil n’est jamais accordé d’avance', (await js(ext.wc, 'navigator.usb ? navigator.usb.getDevices().then((d) => d.length) : 0')) === 0);

  // ---------------------------------------------------------------- Page plantée, page qui ne répond plus
  const crash = await open(A + '/fragile', 'Page /fragile');
  crash.wc.forcefullyCrashRenderer();
  sheet = await sheetOf(crash.wc, 'crash');
  check('page plantée : feuille « La page a planté » avec « Recharger »', sheet.payload.cover === true && await inSheet(sheet, 'document.getElementById("title").textContent') === t('crash.title'));
  await press(sheet, 'reload');
  await until(() => !sheets.top(crash.wc) && !crash.wc.isCrashed() && !crash.wc.isLoading(), 'page rechargée');
  check('« Recharger » relance la page', await js(crash.wc, 'document.title') === 'Page /fragile' && crash.rt.crashed === false);
  crash.wc.emit('unresponsive');
  sheet = await sheetOf(crash.wc, 'hung');
  check('page qui ne répond plus : « Attendre » ou « Recharger »', (await inSheet(sheet, '[...document.querySelectorAll("#buttons button")].map((b) => b.id)')).join() === 'wait,reload');
  crash.wc.emit('responsive');
  await until(() => sheet.closed, 'feuille fermée');
  check('la page répond de nouveau : la feuille se ferme toute seule', !sheets.top(crash.wc));

  // ---------------------------------------------------------------- Téléchargements
  const dlDir = app.getPath('downloads');
  const custom = fs.mkdtempSync(path.join(os.tmpdir(), 'orbe-dl-'));
  const dl = await open(A + '/fichiers', 'Page /fichiers');
  const newest = () => store.state.downloads[0];
  const start = async (file) => { const before = newest(); dl.wc.downloadURL(A + file); return until(() => (newest() !== before ? newest() : null), 'téléchargement lancé : ' + file); };
  const lib = (name, id) => downloads.action(name, id, null);
  const opens = [];
  const confirms = [];
  let agree = false;
  downloads.env.openPath = (file) => { opens.push(file); };
  downloads.env.confirm = async (parent, opts) => { confirms.push(opts); return agree; };

  check('nom proposé par un site : réduit à un simple nom de fichier', downloads.safeName('../../.ssh/authorized_keys') === 'authorized_keys' && downloads.safeName('C:\\Windows\\x.exe') === 'x.exe' && downloads.safeName('') !== '');
  state.mode = 'lent';
  let d = await start('/gros.bin');
  await until(() => d.received > 0, 'premiers octets');
  check('pause depuis la Bibliothèque', await lib('dl:pause', d.id) === true && d.paused === true && downloads.internals.items.get(d.id).isPaused());
  await sleep(2600);
  check('en pause, le téléchargement ne se termine pas', d.state === 'progressing' && d.received < BIG.length);
  check('reprise après une pause', await lib('dl:resume', d.id) === 'resumed');
  await until(() => d.state === 'completed', 'téléchargement terminé', 20000);
  check('le fichier repris est complet et exact', fs.readFileSync(d.path).equals(BIG) && path.dirname(d.path) === dlDir && d.paused === false);
  fs.unlinkSync(d.path);

  d = await start('/gros.bin');
  await until(() => d.received > 0, 'premiers octets');
  check('annulation depuis la Bibliothèque', await lib('dl:cancel', d.id) === true);
  await until(() => d.state === 'cancelled', 'annulé');
  await until(() => !fs.existsSync(d.path), 'morceau retiré');
  check('téléchargement annulé : aucun fichier laissé', !fs.existsSync(d.path));

  // Connexion coupée en route : le téléchargement se reprend là où il s'est arrêté.
  state.mode = 'coupe';
  state.seen.length = 0;
  d = await start('/gros.bin');
  await until(() => d.stalled === true || d.state === 'interrupted', 'interruption', 40000).catch(() => { console.log('    (état :', d.state, d.received, state.seen.map((x) => x.range).join('|'), ')'); });
  check('connexion coupée : le téléchargement est « interrompu, reprise possible »', d.received > 0 && d.received < BIG.length && (d.canResume === true || d.state === 'interrupted'), { state: d.state, stalled: d.stalled, canResume: d.canResume });
  state.mode = 'vite';
  const how = await lib('dl:resume', d.id);
  await until(() => d.state === 'completed', 'reprise terminée', 20000);
  check('« Reprendre » demande la suite au serveur (Range) et le fichier est exact', fs.readFileSync(d.path).equals(BIG) && state.seen.some((x) => x.path === '/gros.bin' && /^bytes=[1-9]/.test(x.range)), { how, ranges: state.seen.map((x) => x.range) });
  fs.unlinkSync(d.path);

  // Interrompu par la fermeture d'Orbe : l'enregistrement et le morceau reçu suffisent.
  const partial = path.join(dlDir, 'reprise.bin');
  fs.writeFileSync(partial, BIG.subarray(0, 100000));
  const old = { id: 'ancien-' + Date.now(), name: 'reprise.bin', path: partial, url: A + '/gros.bin', total: BIG.length, received: 100000, state: 'interrupted', at: Date.now(), profile: 'default', canResume: true,
    resume: { urlChain: [A + '/gros.bin'], mimeType: 'application/octet-stream', eTag: '"orbe-gros-1"', lastModified: MODIFIED, startTime: Date.now() / 1000 } };
  store.state.downloads.unshift(old);
  state.seen.length = 0;
  const way = await lib('dl:resume', old.id);
  await until(() => old.state === 'completed', 'reprise après redémarrage', 20000);
  check('interrompu par la fermeture d’Orbe : repris depuis le morceau déjà reçu', way === 'continued' && fs.readFileSync(partial).equals(BIG) && state.seen.some((x) => x.range === 'bytes=100000-'), { way, ranges: state.seen.map((x) => x.range) });
  fs.unlinkSync(partial);
  // Morceau disparu : nouveau départ.
  const lost = { ...old, id: 'perdu-' + Date.now(), state: 'interrupted', path: path.join(dlDir, 'perdu.bin'), name: 'perdu.bin' };
  store.state.downloads.unshift(lost);
  const before = store.state.downloads.length;
  const known = new Set(store.state.downloads);
  check('morceau disparu : le téléchargement repart de zéro', await lib('dl:resume', lost.id) === 'restarted');
  d = await until(() => store.state.downloads.find((x) => !known.has(x)), 'nouveau téléchargement');
  await until(() => d.state === 'completed', 'terminé', 20000);
  check('l’ancienne ligne est remplacée par la nouvelle', !store.state.downloads.includes(lost) && store.state.downloads.length === before && fs.readFileSync(d.path).equals(BIG));
  fs.unlinkSync(d.path);

  // Fichier exécutable.
  d = await start('/installe.dmg');
  await until(() => d.state === 'completed', 'dmg téléchargé');
  check('fichier exécutable (.dmg) : signalé', d.danger === true && downloads.isDangerous('a.EXE') && downloads.isDangerous('x.command') && downloads.isDangerous('x.pkg') && !downloads.isDangerous('photo.jpg') && !downloads.isDangerous('doc.pdf'));
  agree = false;
  check('ouvrir un exécutable demande confirmation, en nommant sa provenance ; refus : rien n’est ouvert',
    await lib('dl:open', d.id) === false && opens.length === 0 && confirms.length === 1 && confirms[0].detail.includes('127.0.0.1') && confirms[0].defaultId === 1, confirms[0]);
  agree = true;
  check('confirmation donnée : le fichier est ouvert par le système', await lib('dl:open', d.id) === true && opens.join() === d.path);
  fs.unlinkSync(d.path);

  // PDF : affiché par la visionneuse ; téléchargé, il s'ouvre dans un onglet.
  const viewer = await open(A + '/vue.pdf');
  await until(() => viewer.wc.mainFrame.framesInSubtree.some((f) => f.url.startsWith('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/')), 'visionneuse PDF', 20000);
  check('un PDF s’affiche dans la visionneuse de Chromium, sans téléchargement', viewer.wc.getURL() === A + '/vue.pdf' && !store.state.downloads.some((x) => x.url === A + '/vue.pdf'));
  count = Object.keys(w.data.tabs).length;
  store.state.settings.downloadOpenPdf = true;
  d = await start('/doc.pdf');
  await until(() => d.state === 'completed', 'pdf téléchargé');
  const pdfTab = await until(() => Object.values(w.data.tabs).find((x) => x.url.startsWith('file:') && x.url.endsWith('/document.pdf')), 'onglet du PDF');
  opened.push([w, pdfTab.id]);
  await until(() => rtOf(pdfTab.id) && rtOf(pdfTab.id).wc.mainFrame.framesInSubtree.some((f) => f.url.startsWith('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/')), 'visionneuse sur le fichier', 20000);
  check('PDF téléchargé : ouvert dans un onglet, par la visionneuse intégrée', Object.keys(w.data.tabs).length === count + 1 && opens.length === 1);
  store.state.settings.downloadOpenPdf = false;
  const pdf1 = d.path;
  d = await start('/doc.pdf');
  await until(() => d.state === 'completed', 'second pdf');
  await sleep(300);
  check('réglage coupé : le PDF téléchargé n’ouvre pas d’onglet', Object.keys(w.data.tabs).length === count + 1 && path.basename(d.path) === 'document (1).pdf');
  fs.unlinkSync(d.path);
  w.close(pdfTab.id, { ask: false });
  fs.unlinkSync(pdf1);

  // Dossier de destination et « toujours demander ».
  store.state.settings.downloadDir = custom;
  d = await start('/note.txt');
  await until(() => d.state === 'completed', 'note téléchargée');
  check('dossier des téléchargements choisi dans les réglages', d.path === path.join(custom, 'note.txt') && fs.readFileSync(d.path, 'utf8') === 'bonjour' && downloads.downloadDir() === custom);
  store.state.settings.downloadDir = path.join(custom, 'disparu');
  check('dossier choisi introuvable : retour au dossier Téléchargements', downloads.downloadDir() === dlDir);
  store.state.settings.downloadDir = '';
  store.state.settings.downloadAsk = true;
  const dialogs = [];
  const target = path.join(custom, 'renommée.txt');
  downloads.env.saveDialog = (parent, opts) => { dialogs.push(opts); return target; };
  d = await start('/note.txt');
  await until(() => d.state === 'completed', 'note enregistrée ailleurs');
  check('« Toujours demander où enregistrer » : la fenêtre propose le dossier habituel, le fichier va où on le dit', dialogs.length === 1 && dialogs[0].defaultPath === path.join(dlDir, 'note.txt') && d.path === target && fs.existsSync(target));
  downloads.env.saveDialog = (parent, opts) => { dialogs.push(opts); return undefined; };
  const lengthBefore = store.state.downloads.length;
  dl.wc.downloadURL(A + '/note.txt');
  await until(() => dialogs.length === 2, 'fenêtre d’enregistrement');
  await sleep(400);
  check('enregistrement annulé : aucun téléchargement', store.state.downloads.length === lengthBefore && !fs.existsSync(path.join(dlDir, 'note.txt')));
  store.state.settings.downloadAsk = false;
  downloads.env.pickFolder = async () => custom;
  check('choix du dossier depuis les réglages', await downloads.action('dl:pickDir', null, null) === custom && store.state.settings.downloadDir === custom && await downloads.action('dl:defaultDir', null, null) === '' && await downloads.action('dl:dir', null, null) === dlDir);
  // La Bibliothèque montre l'état et les boutons.
  store.state.downloads.unshift({ id: 'vue-1', name: 'calé.bin', path: path.join(dlDir, 'calé.bin'), url: A + '/gros.bin', total: 1000, received: 400, state: 'interrupted', canResume: true, at: Date.now() });
  const libTab = w.openInternal('library.html#downloads');
  const libWc = () => rtOf(libTab.id).wc;
  await until(() => libWc().executeJavaScript('document.querySelectorAll("#list .line").length > 0'), 'liste des téléchargements');
  const firstLine = await libWc().executeJavaScript('(() => { const l = document.querySelector("#list .line"); return { state: l.dataset.state, sub: l.querySelector(".sub").textContent, buttons: [...l.querySelectorAll("button")].map((b) => b.dataset.do) }; })()');
  check('Bibliothèque : un téléchargement interrompu affiche où il en est et propose « Reprendre »', firstLine.state === 'interrupted' && firstLine.sub.includes(t('lib.failed')) && firstLine.sub.includes('40 %') && firstLine.buttons.join() === 'resume', firstLine);
  store.state.downloads.shift();
  w.close(libTab.id, { ask: false });

  // ---------------------------------------------------------------- Ménage
  for (const [owner, id] of opened) if (owner === w && w.data.tabs[id]) w.close(id, { silent: true, ask: false });
  w.undoStack.length = 0;
  for (const key of [A, B]) delete store.state.permissions[key];
  store.state.downloads = store.state.downloads.filter((x) => !String(x.url).startsWith(A));
  Object.assign(store.state.settings, { downloadAsk: saved.settings.downloadAsk, downloadDir: saved.settings.downloadDir, downloadOpenPdf: saved.settings.downloadOpenPdf });
  unload.env.ask = saved.ask;
  permissions.env.confirm = saved.confirm;
  permissions.env.openExternal = saved.openExternal;
  Object.assign(downloads.env, saved.dl);
  try { fs.rmSync(custom, { recursive: true, force: true }); } catch {}
  w.layout();
  OrbeWindow.pushAll();
  server.closeAllConnections();
  tls.closeAllConnections();
  server.close();
  tls.close();
  if (standalone) {
    console.log(`\n${total - failed}/${total} vérifications réussies\n`);
    if (failed) throw new Error(`${failed} vérification(s) en échec`);
  }
};
