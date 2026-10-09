// Médias : lecteurs miniatures de la barre latérale (plusieurs à la fois, titre,
// artiste et pochette annoncés par la page, précédent / suivant, ±15 s, recherche,
// croix), données de la page tenues pour hostiles.
// Appelé par tests/selftest.js, ou seul :
//   ORBE_SCENARIO=tests/medias.js node scripts/dev.js --selftest
// Le son des pages d'essai est une note à −58 dB : inaudible, mais comptée
// comme un son par le moteur.
const http = require('http');

const outils = require('./outils');

const { sleep } = outils;
const until = (fn, label, timeout = 10000) => outils.until(fn, label, timeout);

// Fichier WAV d'une minute, mono 8 kHz 16 bits, note de 220 Hz à très faible niveau.
function wav(seconds = 60) {
  const rate = 8000;
  const n = rate * seconds;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(40 * Math.sin((2 * Math.PI * 220 * i) / rate)), 44 + i * 2);
  return buf;
}
function png(side, color = [200, 80, 40, 255]) {
  const { nativeImage } = require('electron');
  const raw = Buffer.alloc(side * side * 4);
  for (let i = 0; i < side * side; i++) raw.set(color, i * 4);
  return nativeImage.createFromBitmap(raw, { width: side, height: side }).toPNG();
}

const HOSTILE = '<img src=x onerror="window.pwned=1">Un titre de morceau vraiment très long, bien plus large que la barre latérale';

function serve(cover) {
  const sound = wav();
  if (!cover) cover = png(300);
  const hits = {};
  const page = (title, body, head = '') => `<!doctype html><meta charset="utf-8"><title>${title}</title>${head}<body style="font:16px sans-serif;padding:40px">${body}</body>`;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    hits[url.pathname] = (hits[url.pathname] || 0) + 1;
    if (url.pathname === '/son.wav') { res.setHeader('content-type', 'audio/wav'); res.setHeader('accept-ranges', 'bytes'); res.setHeader('content-length', sound.length); return res.end(sound); }
    if (url.pathname === '/pochette.png') { res.setHeader('content-type', 'image/png'); return res.end(cover); }
    if (url.pathname === '/faux.png') { res.setHeader('content-type', 'text/html'); return res.end('<script>1</script>'); }
    if (url.pathname === '/menteur.png') { res.setHeader('content-type', 'image/png'); return res.end('pas une image'); }
    if (url.pathname === '/enorme.png') { res.setHeader('content-type', 'image/png'); return res.end(Buffer.alloc(3 * 1024 * 1024, 1)); }
    res.setHeader('content-type', 'text/html; charset=utf-8');
    const m = /^\/piste(\d)$/.exec(url.pathname);
    if (m) {
      // Les gestionnaires sont déclarés dans l'en-tête, avant la fin du chargement.
      return res.end(page('Piste ' + m[1], `<audio id="a" src="/son.wav" loop></audio><h1>Piste ${m[1]}</h1>`, `<script>
        window.calls = [];
        navigator.mediaSession.setActionHandler('previoustrack', () => calls.push('prev'));
        navigator.mediaSession.setActionHandler('nexttrack', () => calls.push('next'));
        window.start = async (title) => {
          navigator.mediaSession.metadata = new MediaMetadata({ title, artist: 'Artiste ${m[1]}', artwork: [{ src: '/pochette.png', sizes: '300x300', type: 'image/png' }] });
          await document.getElementById('a').play();
          return true;
        };
      </script>`));
    }
    if (url.pathname === '/calme') return res.end(page('Calme', '<h1>Calme</h1>'));
    res.statusCode = 404;
    return res.end(page('404', 'introuvable'));
  });
  server.hits = hits;
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

module.exports = async function mediasTests(ctx) {
  const { nativeImage } = require('electron');
  const { first: w, store, win } = ctx;
  let failed = 0;
  const check = ctx.check || ((name, ok, detail = '') => { if (!ok) failed += 1; console.log(`${ok ? '  ✓' : '  ✗'} ${name}${ok || !detail ? '' : ' — ' + detail}`); });
  const mediaLib = require('../src/main/media');
  const { media } = win;
  const d = w.data;
  const ui = (js) => w.ui.webContents.executeJavaScript(js);
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const wcOf = (id) => win.live.get(id).wc;
  const js = (id, code) => wcOf(id).executeJavaScript(code, true);
  const load = async (pathname, title) => {
    const tab = w.newTab(base + pathname);
    await until(() => d.tabs[tab.id] && d.tabs[tab.id].title === title && !wcOf(tab.id).isLoading(), 'page ' + pathname);
    return tab.id;
  };
  const players = () => media.payload(w, store.state.settings);
  await outils.profilPret(w);
  await until(() => ui('typeof S === "object" && S !== null'), 'coque chargée');
  const mediaControls0 = store.state.settings.mediaControls;
  store.state.settings.mediaControls = true;

  // --- Données de la page : tout est borné et typé -------------------------------------
  const c = mediaLib.clean({ has: 1, paused: 'non', t: 1e12, d: Infinity, title: 'A\u0000B‮' + 'x'.repeat(999), artist: { toString: () => 'x' }, art: 'javascript:alert(1)', acts: ['nexttrack', 7, {}, 'previoustrack'] });
  check('lecteur : réponse hostile de la page remise au propre (types, longueurs, caractères de contrôle, adresse de pochette)',
    c.has === false && c.paused === true && c.duration === 0 && c.position === 360000 && c.track.length === mediaLib.LIMITS.text && !/[\u0000‮]/.test(c.track) && c.artist === '' && c.artSrc === '' && c.next && c.prev, JSON.stringify(c).slice(0, 200));
  check('lecteur : réponse absente ou d’un autre type → lecteur vide, sans erreur', [null, undefined, 'x', 42, []].every((v) => { const r = mediaLib.clean(v); return r.has === false && r.track === '' && r.duration === 0 && !r.prev && !r.next; }));
  const kinds = ['javascript:alert(1)', 'file:///etc/passwd', 'blob:http://x/1', 'orbe://settings', 'data:text/html;base64,AAAA', 'data:image/svg+xml;base64,AAAA', 'data:image/png;base64,' + 'A'.repeat(mediaLib.LIMITS.dataUrl), 'http://' + 'a'.repeat(3000), '', 7].map(mediaLib.artworkKind);
  check('pochette : seules http(s) et data:image (png, jpeg, webp, gif) bornées sont acceptées', kinds.every((k) => k === '') && mediaLib.artworkKind('https://exemple.test/a.png') === 'http' && mediaLib.artworkKind('data:image/png;base64,AAAA') === 'data', kinds.join('|'));
  const art = await mediaLib.loadArtwork(w.session, base + '/pochette.png');
  const artSize = art ? nativeImage.createFromDataURL(art).getSize() : {};
  check('pochette : téléchargée dans la session de la page, recodée en PNG de 192 px au plus', art.startsWith('data:image/png;base64,') && artSize.width === 192 && artSize.height === 192, JSON.stringify(artSize));
  const refused = [await mediaLib.loadArtwork(w.session, base + '/faux.png'), await mediaLib.loadArtwork(w.session, base + '/menteur.png'), await mediaLib.loadArtwork(w.session, base + '/enorme.png'), await mediaLib.loadArtwork(w.session, 'file:///etc/hosts'), await mediaLib.loadArtwork(w.session, 'data:image/png;base64,' + Buffer.from('pas une image').toString('base64'))];
  check('pochette refusée : pas une image, fausse image, trop lourde (plus de 2 Mo), autre protocole', refused.every((r) => r === ''), refused.map((r) => r.length).join());
  const dataArt = await mediaLib.loadArtwork(w.session, 'data:image/png;base64,' + png(64).toString('base64'));
  check('pochette en data:image : redessinée par Orbe', dataArt.startsWith('data:image/png;base64,') && nativeImage.createFromDataURL(dataArt).getSize().width === 64);

  // --- Gestes refusés ------------------------------------------------------------------
  const calme = await load('/calme', 'Calme');
  check('geste sur un lecteur : action inconnue, onglet sans lecteur ou valeur absurde → refusé',
    w.mediaAct({ act: 'evil' }) === false && w.mediaAct({ id: calme, act: 'toggle' }) === false && w.mediaAct('toggle') === false && w.mediaAct({ id: { a: 1 }, act: 'close' }) === false && w.mediaAct(null) === false);

  // --- Un onglet qui joue, quitté : lecteur avec titre, artiste, pochette ---------------
  const p1 = await load('/piste1', 'Piste 1');
  await js(p1, `start(${JSON.stringify(HOSTILE)})`);
  const audible = await until(() => wcOf(p1).isCurrentlyAudible(), 'onglet audible', 8000).then(() => true, () => false);
  if (!audible) {
    const env = await outils.milieu(w);
    if (!env.muet) throw new Error('Délai dépassé : onglet audible');
    for (const nom of ['lecteur miniature à la sortie d’un onglet qui joue', 'titre, artiste et pochette de la page', 'lecture / pause, ±15 s, recherche', 'piste précédente / suivante', 'plusieurs lecteurs', 'croix', 'retour à l’onglet']) outils.ignorer(nom, env.muet);
  } else {
    check('l’onglet affiché qui joue n’a pas de lecteur', players().length === 0 && w.mediaId === null);
    w.activate(calme);
    win.OrbeWindow.pushAll();
    const first = await until(() => { const p = players()[0]; return p && p.art && p.duration > 0 ? p : null; }, 'lecteur renseigné');
    check('onglet quitté pendant qu’il joue : un lecteur, en lecture', players().length === 1 && first.id === p1 && first.playing === true && w.mediaId === p1);
    check('titre et artiste annoncés par la page (bornés), durée et pochette recodée', first.title === HOSTILE.slice(0, mediaLib.LIMITS.text) && first.sub === 'Artiste 1' && Math.round(first.duration) === 60 && first.art.startsWith('data:image/png;base64,') && !('artSrc' in first), JSON.stringify({ ...first, art: first.art.slice(0, 30) }));
    check('piste précédente / suivante proposées : gestionnaires déclarés par la page dès son en-tête', first.prev === true && first.next === true && first.seek === true);

    // La coque : le titre hostile reste du texte ; la pochette est l'image d'Orbe.
    const card = await until(() => ui(`(() => { const el = document.querySelector('#media .mp[data-id="${p1}"]'); if (!el || !el.querySelector('.mp-art img')) return null;
      return { titre: el.querySelector('.mp-title').textContent, enfants: el.querySelector('.mp-title span').childElementCount, img: el.querySelector('.mp-art img').src.slice(0, 22), sub: el.querySelector('.mp-sub').textContent, pwned: window.pwned === 1,
        prev: !el.querySelector('.mp-prev').hidden, next: !el.querySelector('.mp-next').hidden, bar: !el.querySelector('.mp-bar').hidden, visible: !document.getElementById('media').hidden }; })()`), 'carte du lecteur');
    check('barre latérale : titre posé comme du texte (aucune balise créée), pochette en data:image/png, commandes présentes',
      card.titre === HOSTILE.slice(0, mediaLib.LIMITS.text) && card.enfants === 0 && !card.pwned && card.img === 'data:image/png;base64,' && card.sub === 'Artiste 1' && card.prev && card.next && card.bar && card.visible, JSON.stringify(card));

    // Lecture / pause.
    await w.mediaAct({ id: p1, act: 'toggle' });
    await until(async () => (await js(p1, 'document.getElementById("a").paused')) === true, 'pause dans la page');
    await until(() => players()[0].playing === false, 'lecteur en pause');
    check('pause : la page s’arrête, le lecteur reste', players().length === 1);
    await w.mediaAct({ id: p1, act: 'toggle' });
    await until(async () => (await js(p1, 'document.getElementById("a").paused')) === false, 'lecture dans la page');
    await until(() => players()[0].playing === true, 'lecteur en lecture');

    // Recherche.
    await w.mediaAct({ id: p1, act: 'seek', value: 30 });
    const at30 = await js(p1, 'document.getElementById("a").currentTime');
    await w.mediaAct({ id: p1, act: 'forward' });
    const at45 = await js(p1, 'document.getElementById("a").currentTime');
    await w.mediaAct({ id: p1, act: 'back' });
    await w.mediaAct({ id: p1, act: 'back' });
    const at15 = await js(p1, 'document.getElementById("a").currentTime');
    check('recherche : aller à 30 s, avancer de 15 s, reculer deux fois de 15 s', at30 >= 30 && at30 < 33 && at45 >= 45 && at45 < 49 && at15 >= 15 && at15 < 20, [at30, at45, at15].join());
    await w.mediaAct({ id: p1, act: 'seek', value: 9999 });
    const end = await js(p1, 'document.getElementById("a").currentTime');
    check('recherche au-delà de la fin : bornée à la durée ; valeur qui n’est pas un nombre : refusée', end <= 60.5 && w.mediaAct({ id: p1, act: 'seek', value: 'NaN' }) === false && w.mediaAct({ id: p1, act: 'seek', value: -4 }) === false, String(end));
    await w.mediaAct({ id: p1, act: 'seek', value: 5 });

    // Précédent / suivant : ce sont les gestionnaires de la page qui répondent.
    const okNext = await w.mediaAct({ id: p1, act: 'next' });
    const okPrev = await w.mediaAct({ id: p1, act: 'prev' });
    check('piste suivante puis précédente : les gestionnaires de la page sont appelés', okNext === true && okPrev === true && (await js(p1, 'calls.join()')) === 'next,prev');

    // Son coupé depuis le lecteur.
    w.mediaAct({ id: p1, act: 'mute' });
    check('muet depuis le lecteur : son de l’onglet coupé, puis rétabli', d.tabs[p1].muted === true && wcOf(p1).isAudioMuted() && players()[0].muted === true && (w.mediaAct({ id: p1, act: 'mute' }), d.tabs[p1].muted === false));

    // Volume de l'onglet : celui des lecteurs de la page (le son d'essai reste quasi inaudible : on ne fait que baisser).
    {
      const v0 = await js(p1, 'document.getElementById("a").volume');
      const okVol = await w.mediaAct({ id: p1, act: 'volume', value: v0 * 0.5 });
      const v1 = await js(p1, 'document.getElementById("a").volume');
      const shown = await until(() => { const p = players()[0]; return p && Math.abs(p.volume - v1) < 0.02 ? p.volume : null; }, 'volume annoncé par le lecteur').catch(() => null);
      check('volume depuis le lecteur : les lecteurs de la page baissent, le lecteur miniature annonce le nouveau niveau', okVol === true && Math.abs(v1 - Math.round(v0 * 50) / 100) < 0.011 && shown !== null, [v0, v1, shown].join());
      check('volume : valeur hors de 0 à 1, ou qui n’est pas un nombre → refusée, rien ne change',
        w.mediaAct({ id: p1, act: 'volume', value: 1.5 }) === false && w.mediaAct({ id: p1, act: 'volume', value: -0.1 }) === false && w.mediaAct({ id: p1, act: 'volume', value: '0.5); alert(1); (' }) === false && w.mediaAct({ id: p1, act: 'volume' }) === false
        && (await js(p1, 'document.getElementById("a").volume')) === v1);
      await w.mediaAct({ id: p1, act: 'volume', value: v0 });
    }

    // Deuxième onglet qui joue : deux lecteurs, le plus récent en tête.
    const p2 = await load('/piste2', 'Piste 2');
    await js(p2, 'start("Deuxième morceau")');
    await until(() => wcOf(p2).isCurrentlyAudible(), 'second onglet audible');
    w.activate(calme);
    win.OrbeWindow.pushAll();
    await until(() => players().length === 2 && players()[0].title === 'Deuxième morceau', 'deux lecteurs');
    check('deux onglets qui jouent : deux lecteurs empilés, le plus récent en tête', players().map((p) => p.id).join() === [p2, p1].join());
    await until(() => ui('document.querySelectorAll("#media .mp:not(.out)").length === 2'), 'deux cartes');
    check('barre latérale : deux cartes, dans le même ordre', (await ui('[...document.querySelectorAll("#media .mp:not(.out)")].map((el) => el.dataset.id).join()')) === [p2, p1].join());

    // La croix : le son s'arrête, le lecteur s'en va, l'onglet reste.
    w.mediaAct({ id: p2, act: 'close' });
    await until(async () => (await js(p2, 'document.getElementById("a").paused')) === true, 'second onglet en pause');
    check('croix : lecture arrêtée, lecteur retiré, onglet gardé', players().map((p) => p.id).join() === p1 && !!d.tabs[p2] && win.live.has(p2));
    await until(() => ui('document.querySelectorAll("#media .mp").length === 1'), 'carte retirée');

    // Réglage coupé : aucun lecteur montré.
    store.state.settings.mediaControls = false;
    check('réglage « Lecteur réduit » coupé : rien n’est montré', players().length === 0);
    store.state.settings.mediaControls = true;

    // Retour à l'onglet : son lecteur disparaît.
    w.mediaAct({ id: p1, act: 'open' });
    check('« Revenir à l’onglet » : l’onglet s’affiche, son lecteur disparaît', w.activeId === p1 && players().length === 0);
    win.OrbeWindow.pushAll();
    await until(() => ui('document.getElementById("media").hidden === true && !document.querySelector("#media .mp")'), 'lecteurs retirés de la barre');
    // Onglet fermé pendant qu'il a un lecteur : le lecteur part avec lui.
    w.activate(calme);
    await until(() => players().length === 1, 'lecteur revenu');
    w.close(p1, { silent: true, ask: false });
    check('onglet fermé : son lecteur part avec lui', players().length === 0);
    if (d.tabs[p2]) w.close(p2, { silent: true, ask: false });
  }
  for (const id of [p1, calme]) if (d.tabs[id]) w.close(id, { silent: true, ask: false });
  store.state.settings.mediaControls = mediaControls0;
  win.OrbeWindow.pushAll();
  await sleep(50);
  server.close();
  if (server.closeAllConnections) server.closeAllConnections();
  return failed;
};
module.exports.serve = serve;
module.exports.HOSTILE = HOSTILE;
