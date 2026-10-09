// Test de bout en bout : lance le vrai navigateur sur un profil temporaire,
// avec un petit serveur local, et vérifie les fonctions principales.
//   npm test
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Menu, clipboard } = require('electron');

const platform = require('../src/main/platform');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(fn, label, timeout = 8000) {
  const t0 = Date.now();
  for (;;) {
    let v;
    try { v = await fn(); } catch { v = false; }
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error('Délai dépassé : ' + label);
    await sleep(40);
  }
}

function serve() {
  const page = (title, body) => `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:16px sans-serif;padding:40px">${body}</body>`;
  const hits = { pixel: 0 };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    res.setHeader('content-type', 'text/html; charset=utf-8');
    if (url.pathname === '/a') return res.end(page('Page A', '<h1>Alpha</h1><p>orbe orbe orbe</p><a id="pop" href="/c" target="_blank">ouvrir C</a>'));
    if (url.pathname === '/b') return res.end(page('Page B', '<h1>Bravo</h1>'));
    if (url.pathname === '/c') return res.end(page('Page C', '<h1>Charlie</h1><script>document.title = window.opener ? "C avec opener" : "C sans opener"</script>'));
    if (url.pathname === '/video') return res.end(page('Page vidéo', `<video id="v" width="320" height="180" playsinline></video><script>
      window.start = async () => {
        const c = document.createElement('canvas'); c.width = 320; c.height = 180;
        const g = c.getContext('2d'); let n = 0;
        setInterval(() => { g.fillStyle = 'hsl(' + (n++ % 360) + ' 70% 50%)'; g.fillRect(0, 0, 320, 180); }, 40);
        const ac = new AudioContext(); const osc = ac.createOscillator(); const gain = ac.createGain(); gain.gain.value = 0.002;
        const dest = ac.createMediaStreamDestination(); osc.connect(gain).connect(dest); osc.start();
        const stream = c.captureStream(25); stream.addTrack(dest.stream.getAudioTracks()[0]);
        const v = document.getElementById('v'); v.srcObject = stream; await v.play(); return true;
      };
    </script>`));
    if (url.pathname === '/pixel') { hits.pixel += 1; res.setHeader('content-type', 'image/gif'); return res.end(Buffer.from('R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==', 'base64')); }
    if (url.pathname === '/pub') return res.end(page('Page avec pub', `<img src="http://pub.orbe.localhost:${server.address().port}/pixel"><img src="/pixel?local">`));
    if (url.pathname === '/liens') return res.end(page('Page à liens', `<a id="dehors" href="http://localhost:${server.address().port}/b" style="display:block;width:300px;height:60px;background:#def">ailleurs</a>`));
    if (url.pathname === '/long') return res.end(page('Page longue', '<div style="height:4000px;background:linear-gradient(#fde,#def)">haut</div><p>bas</p>'));
    if (url.pathname === '/file.txt') { res.setHeader('content-disposition', 'attachment; filename="orbe-test.txt"'); return res.end('bonjour'); }
    res.statusCode = 404;
    return res.end(page('404', 'introuvable'));
  });
  server.hits = hits;
  return new Promise((resolve) => server.listen(0, () => resolve(server)));
}

module.exports = async function selftest(ctx) {
  const { first: w, OrbeWindow, store, win, little, commands, openSettings, openUrl } = ctx;
  const results = [];
  let failed = 0;
  const check = (name, ok, detail = '') => {
    results.push({ name, ok });
    if (!ok) failed += 1;
    console.log(`${ok ? '  ✓' : '  ✗'} ${name}${ok || !detail ? '' : ' — ' + detail}`);
  };
  const ui = (js) => w.ui.webContents.executeJavaScript(js);
  const tabs = () => w.data.tabs;
  const titleOf = (id) => tabs()[id] && tabs()[id].title;
  const shots = process.env.ORBE_SHOTS;
  const shot = async (name) => {
    if (!shots) return;
    await sleep(350);
    // Capture de la fenêtre entière (coque + pages), pour relecture visuelle.
    await require('./capture').shoot(w.win, shots, name, platform.tint(w.space.color, require('electron').nativeTheme.shouldUseDarkColors));
  };

  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  console.log('\nOrbe — tests de bout en bout\n');

  // Coque
  await until(() => ui('!!window.S || typeof S === "object" && S !== null'), 'coque chargée');
  check('la barre latérale reçoit son état', await ui('S.space.name') === store.t('spaces.firstName'));
  check('aucun onglet au départ', w.activeId === null && await ui('document.body.classList.contains("no-tab")'));

  // Onglets
  const a = w.newTab(base + '/a');
  await until(() => titleOf(a.id) === 'Page A', 'titre de la page A');
  check('nouvel onglet chargé et actif', w.activeId === a.id && win.live.has(a.id));
  const b = w.newTab(base + '/b');
  await until(() => titleOf(b.id) === 'Page B', 'titre de la page B');
  check('le nouvel onglet se place en haut d’Aujourd’hui', w.space.today[0] === b.id && w.space.today[1] === a.id);
  await until(() => ui('document.querySelectorAll("#today .row.tab").length === 2'), 'deux lignes dans la barre');
  check('la barre latérale affiche les deux onglets', await ui('document.querySelector("#today .row.active .title").textContent') === 'Page B');
  check('historique enregistré', !!store.state.history[base + '/a'] && store.state.history[base + '/a'].title === 'Page A');

  w.run('nextTab');
  check('⌥⌘↓ passe à l’onglet suivant', w.activeId === a.id);
  w.run('prevTab');
  check('⌥⌘↑ revient à l’onglet précédent', w.activeId === b.id);
  w.tabAt(2);
  check('⌘2 active le deuxième onglet', w.activeId === a.id);

  // Épingler, favoris
  w.run('togglePin');
  check('⌘D épingle l’onglet', w.space.pinned.some((n) => n.id === a.id) && !w.space.today.includes(a.id) && tabs()[a.id].homeUrl === base + '/a');
  await until(() => ui('document.querySelectorAll("#pinned .row.tab").length === 1'), 'ligne épinglée');
  w.run('togglePin');
  check('⌘D désépingle l’onglet', w.space.today[0] === a.id && !tabs()[a.id].homeUrl);
  w.toggleFavorite(a.id);
  await until(() => ui('document.querySelectorAll("#fav .tile").length === 1'), 'tuile favori');
  check('ajout aux favoris (tuile en haut)', w.favorites[0] === a.id);
  w.toggleFavorite(a.id);
  check('retrait des favoris', !w.favorites.length && w.space.today[0] === a.id);

  // Dossiers et déplacements
  w.newFolder();
  const folder = w.space.pinned.find((n) => n.type === 'folder');
  w.move({ id: a.id, to: 'folder', folderId: folder.id, index: 0 });
  check('onglet déposé dans un dossier', folder.children[0].id === a.id);
  await until(() => ui('document.querySelectorAll("#pinned .folder .children .row.tab").length === 1'), 'onglet dans le dossier');
  w.rename(folder.id, 'Travail');
  await sleep(150);
  w.move({ id: a.id, to: 'today', index: 1 });
  check('onglet ressorti vers Aujourd’hui', w.space.today[1] === a.id && !folder.children.length);
  w.newFolder();
  const inner = w.space.pinned.find((n) => n.type === 'folder' && n.id !== folder.id);
  w.move({ id: inner.id, to: 'folder', folderId: folder.id, index: 0 });
  check('dossier imbriqué dans un dossier', folder.children[0] === inner && !w.space.pinned.includes(inner));
  w.move({ id: folder.id, to: 'folder', folderId: inner.id, index: 0 });
  check('un dossier ne peut pas entrer dans son propre sous-dossier', w.space.pinned.includes(folder) && !inner.children.length);
  w.deleteFolder(inner.id);
  w.deleteFolder(folder.id);
  check('dossier supprimé', !w.space.pinned.length);

  // Copie d'URL (le presse-papiers de la machine est restauré ensuite)
  const previousClipboard = await clipboard.readText().catch(() => '');
  w.activate(a.id);
  w.run('copyUrl');
  await until(async () => (await clipboard.readText()) === base + '/a', 'URL dans le presse-papiers');
  check('⇧⌘C copie l’URL', true);
  w.run('copyUrlMarkdown');
  await until(async () => (await clipboard.readText()) === `[Page A](${base}/a)`, 'lien Markdown dans le presse-papiers');
  check('⌥⇧⌘C copie le lien Markdown', true);
  await clipboard.writeText(previousClipboard);

  // Barre de commande
  w.openCommand('new');
  check('⌘T ouvre la barre de commande', w.modalMode === 'command');
  const sugg = await w.suggest('127');
  check('suggestions issues de l’historique', sugg.some((i) => i.kind === 'history' && i.url.startsWith(base)));
  const cmds = await w.suggest('scind');
  check('la barre de commande propose des actions', cmds.some((i) => i.kind === 'command' && i.command === 'addSplit'));
  const sw = await w.suggest('Page B');
  check('« Basculer vers l’onglet » proposé', sw.some((i) => i.kind === 'tab' && i.tabId === b.id));
  await shot('commande');
  w.runItem(sw.find((i) => i.kind === 'tab'));
  check('choisir un onglet y bascule', w.activeId === b.id && w.modalMode === null);
  w.openCommand('edit');
  w.runItem({ kind: 'raw', title: base + '/c' });
  await until(() => tabs()[b.id].url === base + '/c', '⌘L navigue dans l’onglet courant');
  check('⌘L remplace l’adresse de l’onglet actif', w.activeId === b.id);
  await until(() => titleOf(b.id) === 'C sans opener', 'titre C');

  // Fenêtre ouverte par la page (window.opener conservé). L'ouverture suit une
  // vraie entrée de l'utilisateur : sans geste, elle serait bloquée (popups.js).
  const gesture = async (id) => {
    const rt = win.live.get(id);
    rt.gesture = 0;
    for (const type of ['mouseDown', 'mouseUp']) rt.wc.sendInputEvent({ type, x: 3, y: 3, button: 'left', clickCount: 1 });
    await until(() => rt.gesture > 0, 'entrée reçue par la page');
  };
  w.activate(a.id);
  const before = w.space.today.length;
  await gesture(a.id);
  await win.live.get(a.id).wc.executeJavaScript('document.getElementById("pop").removeAttribute("target"); window.open("/c"); 1', true);
  await until(() => w.space.today.length === before + 1, 'onglet ouvert par la page');
  const child = w.activeId;
  await until(() => titleOf(child) === 'C avec opener', 'opener conservé');
  check('window.open ouvre un onglet avec window.opener', w.space.today[w.space.today.indexOf(a.id) + 1] === child);

  // Vue scindée
  w.splitWith(a.id, b.id);
  await sleep(120);
  const ba = win.live.get(a.id).view.getBounds();
  const bb = win.live.get(b.id).view.getBounds();
  check('vue scindée : deux volets côte à côte', w.visibleIds().length === 2 && bb.x > ba.x && Math.abs(ba.width - bb.width) <= 1 && ba.y === bb.y);
  w.resizeSplit(0, ba.x + ba.width + 4 + 120);
  const ra = win.live.get(a.id).view.getBounds();
  const rb = win.live.get(b.id).view.getBounds();
  check('vue scindée : la séparation se déplace à la souris', ra.width > ba.width + 100 && rb.width < bb.width - 100 && rb.x + rb.width === bb.x + bb.width, JSON.stringify([ra, rb]));
  await until(() => ui('document.querySelectorAll("#dividers .divider").length === 1'), 'poignée de séparation');
  const reread = store.normalize(JSON.parse(JSON.stringify(store.state)));
  check('vue scindée : enregistrée avec l’Espace (retrouvée au redémarrage)', reread.spaces[0].splits.length === 1 && reread.spaces[0].splits[0].join() === [a.id, b.id].join());
  w.run('splitDirection');
  const va = win.live.get(a.id).view.getBounds();
  const vb = win.live.get(b.id).view.getBounds();
  check('vue scindée empilée : les volets sont l’un au-dessus de l’autre', va.x === vb.x && va.width === vb.width && vb.y > va.y && w.isVertical(w.groupOf(a.id)));
  w.run('splitDirection');
  check('retour côte à côte', win.live.get(b.id).view.getBounds().x > win.live.get(a.id).view.getBounds().x);
  await shot('scinde');
  w.run('closeSplit');
  w.dragZone(true);
  await until(() => w.dropView && w.dropView.webContents.executeJavaScript('!document.getElementById("drop").hidden'), 'zone de dépôt');
  w.handle('dropSplit', w.activeId === a.id ? b.id : a.id);
  check('lâcher un onglet sur la page crée une vue scindée', w.visibleIds().length === 2);
  w.run('closeSplit');
  check('⌃⇧- ferme le volet', w.visibleIds().length === 1 && w.splits.length === 0);

  // Barre latérale
  const x0 = win.live.get(w.activeId).view.getBounds().x;
  w.run('toggleSidebar');
  await sleep(320);
  const x1 = win.live.get(w.activeId).view.getBounds().x;
  check('⌘S masque la barre latérale', !w.sidebarVisible && x1 < x0 && x1 === 10);
  w.run('toggleSidebar');
  await sleep(320);
  check('⌘S la réaffiche', w.sidebarVisible && win.live.get(w.activeId).view.getBounds().x === x0);

  // Barre masquée : au survol du bord, elle flotte par-dessus la page sans la déplacer
  w.toggleSidebar(false);
  await sleep(320);
  const hiddenX = win.live.get(w.activeId).view.getBounds();
  clearInterval(w.peekTimer); // le test remplace la souris
  w.peekTimer = null;
  w.setPeek(true);
  // (si la fenêtre de test perd le premier plan, le survol est annulé : on le redemande)
  await until(() => { w.setPeek(true); return w.floatView && w.floatView.webContents.executeJavaScript('document.body.classList.contains("open") && document.querySelectorAll(".row.tab").length > 0'); }, 'barre flottante affichée');
  await sleep(260);
  const peekX = win.live.get(w.activeId).view.getBounds();
  check('survol du bord : la barre flotte, la page ne bouge pas', peekX.x === hiddenX.x && peekX.width === hiddenX.width && w.floatView.getBounds().width > 200);
  await shot('flottante');
  w.setPeek(false);
  await sleep(300);
  w.toggleSidebar(true);
  await sleep(320);

  // Mouvements des pages : animation du système (View.setBounds animé), sans minuteur
  {
    // Les machines d'intégration sous Windows ont les animations coupées : on les
    // impose pour toute la suite, afin que le chemin animé y soit essayé aussi.
    const system = win.motion(1) > 0;
    win.forceMotion(true);
    const moving = win.motion(1) > 0;
    const view = () => win.live.get(w.activeId).view;
    const same = (r1, r2) => r1.x === r2.x && r1.y === r2.y && r1.width === r2.width && r1.height === r2.height;
    const pane = (i = 0) => { const p = w.paneRects(w.contentRect(), w.visibleIds())[i]; return { x: p.x, y: p.y, width: p.width, height: p.height }; };
    const docked = pane();
    w.toggleSidebar(false);
    await sleep(120);
    const hidden = pane();
    check('barre masquée : la page prend la largeur d’un coup', same(view().getBounds(), hidden) && hidden.x === 10);
    const before = { ...win.motionStats };
    const t0 = Date.now();
    let landed = 0;
    view().once('bounds-changed', () => { landed = Date.now() - t0; });
    w.toggleSidebar(true);
    const during = view().getBounds();
    check('retour de la barre : un seul appel par page, animé par le système, aucun minuteur',
      win.motionStats.animated - before.animated === (moving ? 1 : 0) && win.motionStats.direct - before.direct === (moving ? 0 : 1) && !w.anim);
    await sleep(320);
    check('retour de la barre : la page finit à sa place exacte', same(view().getBounds(), docked) && same(docked, { ...hidden, x: docked.x, width: hidden.width - (docked.x - hidden.x) }));
    console.log(`  – animation native des vues (${process.platform}, « Réduire les animations » ${system ? 'inactif' : 'actif, ignoré pour l’essai'}) : ${win.MOTION.sidebarIn} ms demandées ; position lue aussitôt après l’appel : x=${during.x} (départ ${hidden.x}, arrivée ${docked.x}) ; arrivée signalée à ${landed} ms`);
    // Trajet plus long, pour voir si le système anime vraiment : cote lue à mi-course.
    {
      const probe = { ...docked, x: docked.x + 120 };
      const t1 = Date.now();
      let end = 0;
      view().once('bounds-changed', () => { end = Date.now() - t1; });
      view().setBounds(probe, { animate: { duration: 400, easing: 'linear' } });
      await sleep(200);
      const mid = view().getBounds().x;
      await sleep(400);
      const fin = view().getBounds().x;
      console.log(`  – trajet d’essai de 400 ms : cote à 200 ms x=${mid}, à 600 ms x=${fin} (départ ${docked.x}, cible ${probe.x}) ; fin signalée à ${end} ms`);
      check('trajet animé : la vue arrive à sa cible', fin === probe.x);
      view().setBounds(docked, { animate: { duration: 1 } });
      await sleep(150);
      check('retour par un appel animé de 1 ms : cote exacte', same(view().getBounds(), docked));
    }
    // Interruptions : la dernière demande l'emporte, les cotes lues sont les bonnes
    w.toggleSidebar(false);
    await sleep(100);
    w.toggleSidebar(true);
    await sleep(15);
    w.toggleSidebar(false);
    await sleep(350);
    check('barre masquée pendant son retour : la page revient à la pleine largeur', same(view().getBounds(), hidden));
    w.toggleSidebar(true);
    w.toggleSidebar(false);
    w.toggleSidebar(true);
    await sleep(350);
    check('bascules coup sur coup : la page finit à la place de la dernière demande', same(view().getBounds(), docked));
    // Fenêtre redimensionnée pendant le mouvement
    const [cw, ch] = w.win.getContentSize();
    w.toggleSidebar(false);
    await sleep(100);
    w.toggleSidebar(true);
    w.win.setContentSize(cw - 60, ch);
    await until(() => w.win.getContentSize()[0] !== cw, 'fenêtre rétrécie');
    await sleep(350);
    const narrow = w.win.getContentSize()[0];
    check('fenêtre redimensionnée pendant le retour de la barre : la page suit', narrow < cw && same(view().getBounds(), pane()) && pane().width === docked.width - (cw - narrow));
    w.win.setContentSize(cw, ch);
    await until(() => w.win.getContentSize()[0] === cw, 'fenêtre rétablie');
    await sleep(350);
    // Vue scindée : les deux volets glissent ensemble
    const solo = w.activeId;
    const mate = w.orderedIds().find((x) => x !== solo);
    w.splitWith(solo, mate);
    w.toggleSidebar(false);
    await sleep(100);
    w.toggleSidebar(true);
    await sleep(350);
    const ids = w.visibleIds();
    check('vue scindée : chaque volet à sa place après le retour de la barre', ids.length === 2 && ids.every((x, i) => same(win.live.get(x).view.getBounds(), pane(i))));
    // Place réservée à droite (panneau latéral d'une extension)
    const inset = win.hooks.rightInset;
    win.hooks.rightInset = () => 140;
    w.toggleSidebar(false);
    await sleep(100);
    w.toggleSidebar(true);
    await sleep(350);
    const last = pane(1);
    check('place réservée à droite respectée après le retour de la barre', same(win.live.get(ids[1]).view.getBounds(), last) && last.x + last.width === cw - 10 - 140);
    win.hooks.rightInset = inset;
    w.closeSplitPane();
    w.activate(solo);
    await sleep(350);
    check('retour à une seule page, à sa place', w.visibleIds().length === 1 && same(view().getBounds(), docked));
  }

  // Recherche dans la page
  w.activate(a.id);
  w.openFind();
  let found = null;
  win.live.get(a.id).wc.on('found-in-page', (e, r) => { if (r.finalUpdate) found = r; });
  await sleep(250);
  w.find('orbe');
  await until(() => found, 'résultats de recherche');
  check('⌘F trouve le texte dans la page', found.matches === 3);
  w.closeFind();

  // Archive
  const cUrl = tabs()[child].url;
  w.close(child);
  check('⌘W archive l’onglet', !tabs()[child] && store.state.archive[0].url === cUrl);
  w.run('reopen');
  check('⇧⌘T rouvre le dernier onglet fermé', tabs()[w.activeId].url === cUrl && !store.state.archive.some((x) => x.url === cUrl));
  w.activate(a.id);
  w.run('clearToday');
  check('⇧⌘K efface Aujourd’hui sauf l’onglet actif', w.space.today.length === 1 && w.space.today[0] === a.id);

  // Onglet épinglé : ⌘W le décharge sans le supprimer
  w.togglePin(a.id);
  w.close(a.id);
  check('⌘W sur un onglet épinglé le met en veille', !!tabs()[a.id] && !win.live.has(a.id) && w.activeId === null);
  w.activate(a.id);
  await until(() => win.live.has(a.id), 'réveil de l’onglet épinglé');

  // Aperçu (Peek) : lien sortant d'un onglet épinglé
  const other = base.replace('127.0.0.1', 'localhost');
  const todayBefore = w.space.today.length;
  await until(() => !win.live.get(a.id).wc.isLoading(), 'onglet épinglé chargé');
  await gesture(a.id);
  await win.live.get(a.id).wc.executeJavaScript(`window.open(${JSON.stringify(other + '/b')}); 1`, true);
  await until(() => w.peekState && w.peekState.title === 'Page B', 'aperçu ouvert');
  check('un lien sortant d’un onglet épinglé s’ouvre en aperçu', w.activeId === a.id && w.space.today.length === todayBefore);
  await shot('apercu');
  const peekWc = w.peekState.view.webContents;
  w.run('expandPeek');
  check('⌘O transforme l’aperçu en onglet sans recharger', !w.peekState && win.live.get(w.activeId).wc === peekWc && tabs()[w.activeId].title === 'Page B' && w.space.today.length === todayBefore + 1);
  w.close(w.activeId);
  w.activate(a.id);
  w.openPeek(base + '/c', a.id);
  await until(() => w.peekState && w.peekState.title.startsWith('C '), 'second aperçu');
  w.run('closeTab');
  check('⌘W ferme l’aperçu sans fermer l’onglet', !w.peekState && w.activeId === a.id && !!tabs()[a.id]);

  // Aperçu sur un clic ordinaire depuis un onglet épinglé (comme dans Arc)
  const pinL = w.newTab(base + '/liens');
  await until(() => titleOf(pinL.id) === 'Page à liens' && !win.live.get(pinL.id).loading, 'page à liens');
  w.togglePin(pinL.id);
  const lwc = win.live.get(pinL.id).wc;
  const pt = await lwc.executeJavaScript('(() => { const r = document.getElementById("dehors").getBoundingClientRect(); return { x: Math.round(r.left + 40), y: Math.round(r.top + 20) }; })()');
  let clicks = 0;
  let skippedClick = false;
  await until(() => {
    if (w.peekState) return w.peekState.title === 'Page B';
    if (clicks++ % 25 === 0) { lwc.focus(); for (const type of ['mouseDown', 'mouseUp']) lwc.sendInputEvent({ type, x: pt.x, y: pt.y, button: 'left', clickCount: 1 }); }
    return false;
  }, 'aperçu ouvert par un clic').catch((err) => {
    // Fenêtre de test en arrière-plan : Chromium ignore les clics simulés. Ce
    // n'est pas un défaut d'Orbe ; on le signale et on poursuit.
    if (lwc.getURL() === base + '/liens' && !w.win.isFocused()) { skippedClick = true; w.openPeek(base.replace('127.0.0.1', 'localhost') + '/b', pinL.id); return until(() => w.peekState && w.peekState.title === 'Page B', 'aperçu'); }
    throw err;
  });
  if (skippedClick) console.log('  – ignoré : clic sur un lien sortant d’un onglet épinglé (fenêtre de test en arrière-plan)');
  else check('clic sur un lien sortant d’un onglet épinglé : aperçu, la page épinglée reste', lwc.getURL() === base + '/liens' && w.activeId === pinL.id);
  w.closePeek();
  w.togglePin(pinL.id);
  w.close(pinL.id);
  w.activate(a.id);

  // Aperçu : la carte grandit depuis le lien, se réduit à la fermeture, s'étend en onglet
  {
    const same = (r1, r2) => r1.x === r2.x && r1.y === r2.y && r1.width === r2.width && r1.height === r2.height;
    const kids = () => w.win.contentView.children;
    const final = w.peekRect();
    const zone = w.contentRect();
    const inside = (r) => r.x >= zone.x && r.y >= zone.y && r.x + r.width <= zone.x + zone.width && r.y + r.height <= zone.y + zone.height;
    const point = { x: final.x + 240, y: final.y + final.height - 30 };
    const seed = w.peekSeed(final, point);
    const centre = w.peekSeed(final, null);
    check('aperçu : départ autour du lien cliqué (sans sortir de la zone des pages), ou du centre à défaut',
      inside(seed) && seed.width < final.width / 2 && Math.abs(seed.x + seed.width / 2 - point.x) <= 1 && seed.y + seed.height === zone.y + zone.height
      && inside(centre) && Math.abs((centre.x + centre.width / 2) - (final.x + final.width / 2)) <= 1 && centre.width > final.width * 0.9);
    const v1 = w.openPeek(base + '/b', a.id, undefined, point);
    await until(() => w.peekState && w.peekState.title === 'Page B', 'aperçu animé ouvert');
    await sleep(450);
    check('aperçu : la carte finit à sa place, au-dessus du voile', same(v1.getBounds(), final) && kids().indexOf(v1) > kids().indexOf(w.peekChrome) && kids().includes(w.peekChrome));
    await until(() => w.peekChrome.webContents.executeJavaScript('document.body.classList.contains("peek") && !document.getElementById("peek").hidden'), 'voile de l’aperçu');
    const wc1 = v1.webContents;
    w.closePeek({ animate: true });
    const moving = win.motion(1) > 0;
    check('fermeture animée : l’aperçu n’existe plus pour le reste, sa vue reste le temps du mouvement', !w.peekState && w.activeWc === win.live.get(a.id).wc && kids().includes(v1) === moving);
    if (moving) await until(() => w.peekChrome.webContents.executeJavaScript('document.body.classList.contains("peek-out")'), 'voile qui s’efface');
    await sleep(350);
    check('fermeture animée : vue et voile retirés, page fermée', !kids().includes(v1) && !kids().includes(w.peekChrome) && wc1.isDestroyed());
    // Interruption : un nouvel aperçu pendant la fermeture du précédent
    const v2 = w.openPeek(base + '/b', a.id);
    const wc2 = v2.webContents;
    await sleep(60);
    w.closePeek({ animate: true });
    const v3 = w.openPeek(base + '/c', a.id);
    check('nouvel aperçu pendant une fermeture : le précédent est retiré aussitôt', !kids().includes(v2) && kids().includes(v3) && w.peekState.view === v3 && kids().filter((k) => k === w.peekChrome).length === 1);
    await until(() => wc2.isDestroyed(), 'page de l’aperçu précédent fermée');
    await until(() => w.peekState && w.peekState.title.startsWith('C '), 'troisième aperçu');
    await sleep(450);
    check('aperçu rouvert : carte à sa place', same(v3.getBounds(), final));
    // Passage en onglet : la carte s'étend jusqu'à la place de la page
    const under = win.live.get(a.id).view;
    w.expandPeek();
    const grown = w.activeId;
    check('aperçu agrandi : onglet créé aussitôt, la page quittée reste dessous pendant le mouvement', win.live.get(grown).view === v3 && !w.peekState && kids().includes(under) === moving);
    await sleep(500);
    const rect = w.paneRects(w.contentRect(), w.visibleIds())[0];
    check('aperçu agrandi : la page occupe toute la zone, au rang des pages ; l’ancienne et le voile sont retirés',
      same(v3.getBounds(), { x: rect.x, y: rect.y, width: rect.width, height: rect.height }) && kids().indexOf(v3) === 1 && !kids().includes(under) && !kids().includes(w.peekChrome));
    w.close(grown);
    w.activate(a.id);
  }

  // Espaces
  w.newSpace();
  const s2 = w.space;
  check('nouvel Espace créé et affiché', w.data.spaces.length === 2 && w.activeId === null);
  w.rename(s2.id, 'Projets');
  w.setTheme({ color: '#10b981', icon: '🚀' });
  const c = w.newTab(base + '/b');
  await until(() => titleOf(c.id) === 'Page B', 'page dans le second Espace');
  await until(() => ui('S.space.name === "Projets" && S.today.length === 1'), 'barre latérale du second Espace');
  w.setThemeExtra({ color2: '#3b82f6', grain: 0.3 });
  await until(() => ui('document.body.classList.contains("gradient") && getComputedStyle(document.body).backgroundImage.includes("gradient")'), 'thème en dégradé');
  check('thème d’Espace en dégradé avec grain', w.space.color2 === '#3b82f6' && w.space.grain === 0.3);
  await shot('espace-2');
  w.run('prevSpace');
  check('⌥⌘← revient à l’Espace précédent avec son onglet', w.space !== s2 && w.activeId === a.id);
  w.spaceAt(2);
  check('⌃2 va au deuxième Espace', w.space === s2 && w.activeId === c.id);

  // Glissement entre Espaces : les deux listes côte à côte, qui suivent les doigts
  {
    const firstSpace = w.data.spaces[0];
    await until(() => ui(`!slide && S.space.id === ${JSON.stringify(s2.id)}`), 'second Espace affiché');
    check('l’état donne à la barre la liste des Espaces voisins',
      await ui(`S.near.next === null && S.near.prev.space.id === ${JSON.stringify(firstSpace.id)} && S.near.prev.today.length === ${firstSpace.today.length} && [...S.near.prev.pinned, ...S.near.prev.today].some((x) => x.active)`));
    const reduced = await ui('matchMedia("(prefers-reduced-motion: reduce)").matches');
    // Balayage simulé : une suite d'événements de molette horizontaux sur la barre.
    const swipe = (dx, n, gap) => ui(`(async () => { for (let i = 0; i < ${n}; i++) { document.getElementById('scroll').dispatchEvent(new WheelEvent('wheel', { deltaX: ${dx}, bubbles: true, cancelable: true })); await new Promise((r) => setTimeout(r, ${gap})); } })()`);
    const look = () => ui(`(() => { const g = document.querySelector('#pager .ghost'); const W = document.getElementById('pager').clientWidth; const x = (el) => new DOMMatrix(getComputedStyle(el).transform).m41; return { ghost: g ? g.dataset.space : null, rows: g ? g.querySelectorAll('.row.tab').length : 0, live: x(document.getElementById('scroll')), ghostX: g ? x(g) : null, W, tint: Number(getComputedStyle(document.getElementById('tint')).opacity), phase: slide ? slide.phase : null }; })()`);
    if (reduced) {
      console.log('  – ignoré : glissement entre Espaces (« Réduire les animations » actif)');
    } else {
      await swipe(-12, 4, 30); // lent et court : en dessous du seuil
      const mid = await look();
      check('balayage lent : les deux listes suivent les doigts, côte à côte, la teinte se fond au même pas',
        mid.ghost === firstSpace.id && mid.rows >= firstSpace.today.length && mid.rows > 0 && mid.phase === 'drag'
        && Math.abs(mid.live - 48) < 1 && Math.abs(mid.ghostX - (48 - mid.W)) < 1 && Math.abs(mid.tint - 48 / mid.W) < 0.02, JSON.stringify(mid));
      await until(() => ui('!slide'), 'retour de la liste');
      const back = await look();
      check('doigts levés avant le seuil : la liste revient, l’Espace ne change pas', w.space === s2 && !back.ghost && back.live === 0 && back.tint === 0);
      await swipe(14, 5, 30); // vers la droite alors qu'il n'y a plus d'Espace : élastique
      const edge = await look();
      check('au bout de la rangée : la liste résiste, sans autre liste à côté', !edge.ghost && edge.live < 0 && edge.live > -70 && edge.tint === 0, JSON.stringify(edge));
      await until(() => ui('!slide'), 'retour de l’élastique');
      check('au bout de la rangée : rien ne change', w.space === s2 && (await look()).live === 0);
    }
    await sleep(150);
    await swipe(-30, 6, 16); // franc : au-delà du seuil
    await until(() => w.space === firstSpace, 'changement d’Espace par balayage');
    await until(() => ui(`!slide && S.space.id === ${JSON.stringify(firstSpace.id)}`), 'fin du glissement');
    const done = await look();
    check('balayage franc : l’Espace change une seule fois, la liste est rendue à l’arrivée', w.space === firstSpace && w.activeId === a.id && !done.ghost && done.live === 0 && done.tint === 0);
    await sleep(200);
    w.spaceAt(2);
    if (!reduced) {
      await until(() => ui('!!slide'), 'glissement lancé par le raccourci');
      const fly = await look();
      check('changement par raccourci : même glissement, dans le bon sens', fly.ghost === s2.id && fly.ghostX >= 0 && fly.live <= 0, JSON.stringify(fly));
    }
    await until(() => ui(`!slide && S.space.id === ${JSON.stringify(s2.id)}`), 'second Espace rendu');
    check('changement par raccourci : arrivée sur le second Espace', w.space === s2 && w.activeId === c.id && await ui('document.getElementById("space-name").textContent === "Projets"'));
  }
  w.moveToSpace(c.id, w.data.spaces[0].id);
  check('déplacer un onglet vers un autre Espace', w.data.spaces[0].today.includes(c.id) && !s2.today.length);
  w.spaceAt(1);

  // Profils : cookies séparés par profil
  const sesBefore = win.live.get(a.id).wc.session;
  w.newProfile();
  check('nouveau profil attribué à l’Espace', w.data.profiles.length === 2 && w.space.profileId !== 'default');
  w.activate(a.id);
  await until(() => win.live.has(a.id), 'onglet rechargé dans le nouveau profil');
  check('le profil a sa propre session', win.live.get(a.id).wc.session !== sesBefore);
  w.setProfile('default');
  w.activate(a.id);

  // Import depuis Arc (fichier d'exemple, jamais les vraies données)
  const arc = require('../src/main/import-arc');
  const sample = path.join(require('os').tmpdir(), `orbe-arc-${Date.now()}.json`);
  const tabItem = (id, url, title, parent) => [id, { id, title: null, parentID: parent, childrenIds: [], data: { tab: { savedURL: url, savedTitle: title } } }];
  fs.writeFileSync(sample, JSON.stringify({ sidebar: { containers: [{ global: {} }, {
    items: [
      'pin', { id: 'pin', childrenIds: ['t1', 'f1'], data: { itemContainer: {} } },
      ...tabItem('t1', 'https://exemple.org/un', 'Un', 'pin'),
      'f1', { id: 'f1', title: 'Dossier Arc', parentID: 'pin', childrenIds: ['t2'], data: { list: {} } },
      ...tabItem('t2', 'https://exemple.org/deux', 'Deux', 'f1'),
      'unp', { id: 'unp', childrenIds: ['t3'], data: { itemContainer: {} } },
      ...tabItem('t3', 'https://exemple.org/trois', 'Trois', 'unp'),
      'top', { id: 'top', childrenIds: ['t4'], data: { itemContainer: {} } },
      ...tabItem('t4', 'https://exemple.org/favori', 'Favori', 'top'),
    ],
    spaces: ['s1', { id: 's1', title: 'Espace Arc', customInfo: { iconType: { emoji_v2: '🌾' } }, profile: { custom: { _0: { directoryBasename: 'Profile 3' } } }, containerIDs: ['pinned', 'pin', 'unpinned', 'unp'] }],
    topAppsContainerIDs: [{ custom: { _0: { directoryBasename: 'Profile 3' } } }, 'top'],
  }] } }));
  const arcData = arc.read(sample);
  const spacesBefore = w.data.spaces.length;
  arc.merge(arcData);
  const imported = w.data.spaces.find((x) => x.arcId === 's1');
  const importedFolder = imported && imported.pinned.find((n) => n.type === 'folder');
  check('import Arc : Espace, épinglés, dossier, onglet du jour',
    w.data.spaces.length === spacesBefore + 1 && imported.name === 'Espace Arc' && imported.icon === '🌾'
    && imported.pinned.length === 2 && importedFolder.name === 'Dossier Arc' && importedFolder.children.length === 1 && imported.today.length === 1);
  check('import Arc : profil et favoris du profil', imported.profileId !== 'default' && w.data.favs[imported.profileId].length === 1);
  check('import Arc : pas de doublon au second import', arc.merge(arcData) === 0);
  fs.unlinkSync(sample);
  w.data.spaces.splice(w.data.spaces.indexOf(imported), 1);
  for (const id of [...imported.today, ...w.data.favs[imported.profileId], imported.pinned[0].id, importedFolder.children[0].id]) delete w.data.tabs[id];
  w.data.favs[imported.profileId] = [];
  OrbeWindow.pushAll();

  // Aiguillage des liens venus d'autres applications
  store.state.settings.routes = [{ match: '/b', to: s2.id }];
  openUrl(base + '/b');
  check('aiguillage : le lien s’ouvre dans l’Espace de la règle', w.space === s2 && tabs()[w.activeId].url === base + '/b');
  w.close(w.activeId);
  store.state.settings.routes = [];
  w.spaceAt(1);

  // Langue
  await until(() => ui('document.querySelector("#b-newtab .title").textContent === "Nouvel onglet"'), 'libellé français');
  store.state.settings.lang = 'en';
  OrbeWindow.pushAll();
  await until(() => ui('document.querySelector("#b-newtab .title").textContent === "New Tab"'), 'libellé anglais');
  check('l’interface passe en anglais', true);
  store.state.settings.lang = 'fr';
  OrbeWindow.pushAll();
  await until(() => ui('document.querySelector("#b-newtab .title").textContent === "Nouvel onglet"'), 'retour au français');

  // Menu : raccourcis d'Arc
  const accels = new Set();
  const collect = (m) => { for (const it of m.items) { if (it.accelerator) accels.add(it.accelerator); if (it.submenu) collect(it.submenu); } };
  require('../src/main/menu').build();
  collect(Menu.getApplicationMenu());
  const wanted = ['Cmd+T', 'Cmd+N', 'Shift+Cmd+N', 'Alt+Cmd+N', 'Shift+Cmd+T', 'Cmd+L', 'Shift+Cmd+W', 'Shift+Cmd+2', 'Shift+Cmd+S', 'Cmd+P', 'Shift+Cmd+C', 'Alt+Shift+Cmd+C', 'Cmd+F', 'Cmd+G', 'Cmd+S', 'Shift+Cmd+D', 'Cmd+.', 'Cmd+R', 'Shift+Cmd+R', 'Ctrl+Shift+=', 'Ctrl+Shift+-', 'Cmd+0', 'Alt+Cmd+U', 'Alt+Cmd+I', 'Alt+Cmd+C', 'Alt+Cmd+J', 'Ctrl+Cmd+F', 'Alt+Cmd+Right', 'Alt+Cmd+Left', 'Ctrl+1', 'Cmd+D', 'Alt+Cmd+Down', 'Alt+Cmd+Up', 'Shift+Cmd+K', 'Cmd+[', 'Cmd+]', 'Cmd+Y', 'Shift+Cmd+L', 'Shift+Cmd+J', 'Cmd+,', 'Cmd+1', 'Cmd+9'];
  // Hors macOS, les mêmes commandes portent les raccourcis du système (⌘ -> Ctrl…).
  const missing = wanted.map((k) => platform.accel(k)).filter((k) => !accels.has(k));
  check(`les ${wanted.length} raccourcis d’Arc sont dans le menu`, !missing.length, 'manquants : ' + missing.join(', '));

  // Windows : habillage et raccourcis propres au système
  if (platform.isWin) {
    const list = [];
    const all = (m) => { for (const it of m.items) { if (it.accelerator) list.push(it.accelerator); if (it.submenu) all(it.submenu); } };
    all(Menu.getApplicationMenu());
    const twice = list.filter((k, i) => list.indexOf(k) !== i && k !== platform.accel('Cmd+T'));
    check('Windows : raccourcis en Ctrl, sans doublon, affichés en notation Windows',
      commands.byName.get('newTab').accel === 'Ctrl+T' && commands.byName.get('newTab').keys === 'Ctrl+T' && commands.byName.get('history').keys === 'Ctrl+H'
      && !twice.length && !list.some((k) => /Cmd/.test(k)) && !/[⌘⌃⌥⇧]/.test(store.t('side.empty')), 'doublons : ' + twice.join(', '));
    const chrome = await ui('JSON.stringify([document.documentElement.classList.contains("win"), getComputedStyle(document.getElementById("b-menu")).display, getComputedStyle(document.getElementById("top")).paddingLeft, getComputedStyle(document.body).fontFamily])');
    const [isWinClass, menuDisplay, topPad, font] = JSON.parse(chrome);
    check('Windows : bouton de menu visible, pas de marge pour les feux tricolores, police Segoe', isWinClass && menuDisplay !== 'none' && topPad === '0px' && /Segoe/.test(font), chrome);
    const vb = win.live.get(w.activeId).view.getBounds();
    const [cw] = w.win.getContentSize();
    check('Windows : la page laisse libre la bande des boutons de fenêtre', vb.y === platform.CAPTION_H && vb.x + vb.width === cw - 10, JSON.stringify(vb));
    // Vraie frappe envoyée à la page : le menu est invisible, ses raccourcis doivent rester actifs.
    const kwc = win.live.get(w.activeId).wc;
    kwc.focus();
    let tries = 0;
    const opened = await until(() => {
      if (w.modalMode === 'command') return true;
      if (tries++ % 25 === 0) { kwc.sendInputEvent({ type: 'keyDown', keyCode: 'T', modifiers: ['control'] }); kwc.sendInputEvent({ type: 'keyUp', keyCode: 'T', modifiers: ['control'] }); }
      return false;
    }, 'Ctrl+T', 5000).catch(() => false);
    check('Windows : Ctrl+T frappé dans la page ouvre la barre de commande (menu masqué)', opened === true);
    if (w.modalMode) w.hideModal();
    // Barre d'outils : elle s'arrête avant les boutons de fenêtre.
    commands.setSetting('showToolbar', true);
    await until(() => ui('document.body.classList.contains("toolbar")'), 'barre d’outils affichée');
    await sleep(250);
    const tb = JSON.parse(await ui('JSON.stringify([document.getElementById("toolbar").getBoundingClientRect().right, innerWidth])'));
    const vt = win.live.get(w.activeId).view.getBounds();
    check('Windows : la barre d’outils s’arrête avant les boutons de fenêtre', tb[0] <= tb[1] - 138 && vt.y === 50, JSON.stringify([tb, vt]));
    await shot('win-barre-outils');
    commands.setSetting('showToolbar', false);
    await until(() => ui('!document.body.classList.contains("toolbar")'), 'barre d’outils masquée');
    // Thème sombre : capture seulement (symboles clairs des boutons de fenêtre).
    if (shots) {
      commands.setSetting('appearance', 'dark');
      await until(() => ui('matchMedia("(prefers-color-scheme: dark)").matches'), 'interface en sombre');
      await shot('win-sombre');
      commands.setSetting('appearance', 'auto');
    }
  }

  // Téléchargement
  win.live.get(a.id).wc.downloadURL(base + '/file.txt');
  await until(() => store.state.downloads[0] && store.state.downloads[0].state === 'completed', 'téléchargement terminé');
  const dl = store.state.downloads[0];
  check('téléchargement enregistré', fs.existsSync(dl.path) && fs.readFileSync(dl.path, 'utf8') === 'bonjour');
  fs.unlinkSync(dl.path);

  // Capture d'une zone (⇧⌘2) : zone choisie, puis action
  w.activate(a.id);
  const dlDir0 = require('electron').app.getPath('downloads');
  const pngs0 = fs.readdirSync(dlDir0).filter((f) => f.endsWith('.png')).length;
  let played = '';
  const sendOrig = w.ui.webContents.send.bind(w.ui.webContents);
  w.ui.webContents.send = (ch, ...rest) => { if (ch === 'sound') played = rest[0]; return sendOrig(ch, ...rest); };
  // La page vient d'être réaffichée : la capture peut être vide tant qu'elle n'a pas été peinte.
  const zoneSaved = await until(async () => (await w.capture({ area: { x: 10, y: 10, width: 200, height: 120 }, then: 'save' })) === 'save', 'capture d’une zone').catch((e) => e.message);
  // Écran en veille ou session verrouillée : Chromium ne peut rien capturer.
  const canCapture = zoneSaved === true;
  if (!canCapture) console.log('  – ignoré : captures d’une zone (écran en veille : rien à capturer)');
  else {
  check('capture d’une zone : enregistrée', true);
  await until(() => fs.readdirSync(dlDir0).filter((f) => f.endsWith('.png')).length >= pngs0 + 1, 'zone enregistrée');
  const zone = fs.readdirSync(dlDir0).filter((f) => f.endsWith('.png')).map((f) => path.join(dlDir0, f)).sort().pop();
  const zoneSize = await until(() => { const sz = require('electron').nativeImage.createFromPath(zone).getSize(); return sz.width ? sz : null; }, 'zone lisible');
  check('capture d’une zone : l’image a les proportions de la zone', Math.abs(zoneSize.width / zoneSize.height - 200 / 120) < 0.02, JSON.stringify(zoneSize));
  check('capture : le son de capture est demandé', played === 'capture');
  store.state.settings.sounds = false;
  played = '';
  await w.capture({ area: 'full', then: 'copy' });
  check('réglage « Sons » coupé : aucun son', played === '');
  }
  store.state.settings.sounds = true;
  w.ui.webContents.send = sendOrig;
  check('le fichier du son existe et se charge', await ui('fetch("sons/capture.wav").then((r) => r.ok && r.headers.get("content-type"))').then((x) => !!x).catch(() => false));

  // Capture de la page entière
  const tall = w.newTab(base + '/long');
  await until(() => titleOf(tall.id) === 'Page longue', 'page longue chargée');
  const dlDir = require('electron').app.getPath('downloads');
  const pngsBefore = new Set(fs.readdirSync(dlDir).filter((f) => f.endsWith('.png')));
  const pngBefore = pngsBefore.size;
  await w.captureFull();
  await until(() => fs.readdirSync(dlDir).filter((f) => f.endsWith('.png')).length === pngBefore + 1, 'capture enregistrée');
  const png = path.join(dlDir, fs.readdirSync(dlDir).filter((f) => f.endsWith('.png') && !pngsBefore.has(f))[0]);
  const pngSize = await until(() => { const sz = require('electron').nativeImage.createFromPath(png).getSize(); return sz.height ? sz : null; }, 'capture lisible');
  check('capture de la page entière (au-delà de la zone visible)', pngSize.height >= 4000, JSON.stringify(pngSize));
  w.close(tall.id);
  w.activate(a.id);

  // Image dans l'image : la vidéo suit quand on change d'onglet
  const vid = w.newTab(base + '/video');
  await until(() => titleOf(vid.id) === 'Page vidéo', 'page vidéo chargée');
  const vwc = win.live.get(vid.id).wc;
  await vwc.executeJavaScript('start()', true);
  await until(() => vwc.isCurrentlyAudible(), 'vidéo audible');
  w.activate(a.id);
  await until(() => vwc.executeJavaScript('!!document.pictureInPictureElement'), 'vidéo passée en image dans l’image');
  check('la vidéo en cours passe en image dans l’image en quittant l’onglet', w.mediaId === vid.id);
  w.activate(vid.id);
  await until(async () => !(await vwc.executeJavaScript('!!document.pictureInPictureElement')), 'retour de la vidéo dans la page');
  check('elle revient dans la page au retour sur l’onglet', w.mediaId === null);
  w.close(vid.id);
  w.activate(a.id);

  // Réglages
  const sw2 = openSettings();
  await until(async () => (await sw2.webContents.executeJavaScript('document.querySelectorAll("#profiles .profile").length')) === w.data.profiles.length, 'réglages affichés');
  check('les réglages listent les profils', await sw2.webContents.executeJavaScript('document.getElementById("lang").value') === 'fr');
  if (shots) fs.writeFileSync(path.join(shots, 'reglages.png'), (await sw2.webContents.capturePage()).toPNG());
  sw2.close();

  // Notes
  w.run('newNote');
  const noteTab = w.activeId;
  const nwc = win.live.get(noteTab).wc;
  await until(() => store.state.notes.length === 1 && nwc.executeJavaScript('document.querySelectorAll("#items .note").length === 1'), 'note créée');
  await nwc.executeJavaScript(`(() => { const e = document.getElementById('editor'); e.textContent = 'Idées pour Orbe'; e.dispatchEvent(new InputEvent('input')); })()`);
  await until(() => store.state.notes[0].text.startsWith('Idées pour Orbe'), 'note enregistrée');
  check('⌃⌘N crée une note, enregistrée au fil de la frappe', tabs()[noteTab].internal === true);
  w.close(noteTab);
  w.activate(a.id);

  // Page d'accueil
  const wel = w.openInternal('welcome.html');
  await until(() => win.live.get(wel.id).wc.executeJavaScript('document.querySelector("h1").textContent === "Bienvenue dans Orbe" && document.querySelectorAll("[data-cmd]").length >= 3'), 'page d’accueil');
  check('la page d’accueil s’affiche', tabs()[wel.id].internal === true);
  if (shots) fs.writeFileSync(path.join(shots, 'accueil.png'), (await win.live.get(wel.id).wc.capturePage()).toPNG());
  w.close(wel.id);
  w.activate(a.id);

  // Bibliothèque (page interne)
  w.run('history');
  const libId = w.activeId;
  await until(async () => (await win.live.get(libId).wc.executeJavaScript('document.querySelectorAll("#list .line").length')) > 0, 'historique affiché');
  check('⌘Y affiche l’historique', tabs()[libId].url.endsWith('library.html#history'));
  await shot('bibliotheque');
  w.close(libId);

  // Page d'erreur
  const bad = w.newTab('http://127.0.0.1:1/');
  await until(() => win.live.get(bad.id).wc.getURL().includes('error.html'), 'page d’erreur');
  check('page d’erreur en cas d’échec, adresse conservée', tabs()[bad.id].url === 'http://127.0.0.1:1/');
  w.close(bad.id);

  // Robustesse (défauts trouvés en relecture)
  const pop = w.newTab(base + '/b');
  await until(() => titleOf(pop.id) === 'Page B', 'onglet à fermer');
  await win.live.get(pop.id).wc.executeJavaScript('window.close(); 1', true).catch(() => {});
  win.live.get(pop.id) && win.live.get(pop.id).wc.close();
  await until(() => !tabs()[pop.id] && !win.live.has(pop.id), 'onglet retiré');
  check('une page qui se ferme elle-même ne laisse pas d’onglet fantôme', w.activeId !== pop.id && !w.space.today.includes(pop.id));

  const sv1 = w.newTab(base + '/a');
  const sv2 = w.newTab(base + '/b');
  await until(() => titleOf(sv2.id) === 'Page B', 'onglets pour la vue scindée');
  w.splitWith(sv1.id, sv2.id);
  const w2 = new OrbeWindow();
  w2.close(sv2.id);
  let layoutError = null;
  try { w.layout(); } catch (err) { layoutError = err; }
  check('fermer depuis une autre fenêtre un onglet en vue scindée ne casse rien', !layoutError && !w.splits.length && w.visibleIds().every((id) => tabs()[id]));
  w2.activate(sv1.id);
  await sleep(60);
  check('un onglet n’est actif que dans une seule fenêtre', w2.activeId === sv1.id && w.activeId !== sv1.id && win.live.get(sv1.id).owner === w2);
  w2.win.close();
  await sleep(150);
  check('la fenêtre restante continue de mémoriser son état', w.persistent === true);
  w.close(sv1.id);

  const trap = w.newTab(base + '/a');
  await until(() => titleOf(trap.id) === 'Page A', 'page de test');
  await win.live.get(trap.id).wc.executeJavaScript('location.href = "orbe://app/library.html"; 1', true).catch(() => {});
  await sleep(500);
  check('une page web ne peut pas se rendre sur une page interne', tabs()[trap.id].url === base + '/a' && !tabs()[trap.id].internal && win.live.get(trap.id).wc.getURL() === base + '/a');
  const before2 = Object.keys(tabs()).length;
  w.handle('dropUrl', 'file:///etc/hosts');
  w.handle('dropUrl', 'orbe://app/shell.html');
  w.handle('open', 'file:///etc/hosts');
  check('les adresses file: et orbe: venant d’une page sont refusées', Object.keys(tabs()).length === before2);
  w.close(trap.id);

  const retry = w.newTab('http://127.0.0.1:1/x');
  await until(() => win.live.get(retry.id).wc.getURL().includes('error.html'), 'page d’erreur');
  let reloaded = '';
  win.live.get(retry.id).wc.once('did-start-navigation', (e, u) => { reloaded = u; });
  w.run('reload');
  await until(() => reloaded, 'nouvelle tentative');
  check('⌘R sur la page d’erreur retente l’adresse d’origine', reloaded === 'http://127.0.0.1:1/x');
  w.close(retry.id);
  w.activate(a.id);

  // Bloqueur de publicités (« orbe.localhost » joue le rôle du domaine publicitaire)
  const adblock = require('../src/main/adblock');
  adblock.setDomains(['orbe.localhost']);
  server.hits.pixel = 0;
  const pub = w.newTab(base + '/pub');
  await until(() => titleOf(pub.id) === 'Page avec pub' && !win.live.get(pub.id).loading, 'page avec publicité');
  await sleep(300);
  const pubWc = win.live.get(pub.id).wc;
  check('le bloqueur annule la requête tierce listée, pas celle du site', server.hits.pixel === 1 && adblock.stats().blockedByTab.get(pubWc.id) === 1, JSON.stringify([server.hits.pixel, adblock.stats().blockedByTab.get(pubWc.id)]));
  await until(() => ui('document.getElementById("shield-n").textContent === "1"'), 'compteur du bouclier');
  server.hits.pixel = 0;
  w.toggleSiteBlocking();
  await until(() => server.hits.pixel === 2, 'exception pour le site');
  check('une exception par site laisse tout passer', adblock.isSiteAllowed(base) && store.state.settings.adblockAllow.length === 1);
  w.toggleSiteBlocking();
  await sleep(200);
  w.close(pub.id);
  w.activate(a.id);

  // Boosts : CSS par site et Zap
  const boostsMod = require('../src/main/boosts');
  const bt = w.newTab(base + '/a');
  await until(() => titleOf(bt.id) === 'Page A' && !win.live.get(bt.id).loading, 'page pour le Boost');
  const bwc = win.live.get(bt.id).wc;
  boostsMod.set(boostsMod.hostOf(base), { css: 'h1 { color: rgb(1, 2, 3) !important; }', zaps: ['p'] });
  await boostsMod.apply(bwc);
  check('Boost : le CSS du site et le Zap s’appliquent', await bwc.executeJavaScript('getComputedStyle(document.querySelector("h1")).color + "|" + getComputedStyle(document.querySelector("p")).display') === 'rgb(1, 2, 3)|none');
  bwc.reload();
  await until(async () => (await bwc.executeJavaScript('document.readyState === "complete" && getComputedStyle(document.querySelector("h1")).color').catch(() => '')) === 'rgb(1, 2, 3)', 'Boost réappliqué au rechargement');
  check('Boost : réappliqué à chaque chargement', true);
  boostsMod.set(boostsMod.hostOf(base), { css: '', zaps: [] });
  await boostsMod.apply(bwc);
  check('Boost : retiré quand il est vidé', await bwc.executeJavaScript('getComputedStyle(document.querySelector("p")).display') !== 'none' && !store.state.boosts[boostsMod.hostOf(base)], JSON.stringify([await bwc.executeJavaScript('getComputedStyle(document.querySelector("p")).display'), store.state.boosts]));
  w.close(bt.id);
  w.activate(a.id);

  // Navigation privée
  const inc = new OrbeWindow({ incognito: true });
  const it = inc.newTab(base + '/b');
  await until(() => inc.data.tabs[it.id].title === 'Page B', 'page en navigation privée');
  check('navigation privée : données séparées', inc.data !== store.state && !store.state.tabs[it.id] && inc.session !== w.session);
  const visitsBefore = store.state.history[base + '/b'].visits;
  check('navigation privée : pas d’historique', store.state.history[base + '/b'].visits === visitsBefore);
  inc.win.close();

  // Petite fenêtre
  const lw = new little.LittleWindow(base + '/a');
  await until(() => lw.title === 'Page A', 'petite fenêtre chargée');
  check('⌥⌘N ouvre une petite fenêtre', !!lw.view);
  if (shots && platform.isWin) { await sleep(400); await require('./capture').shoot(lw.win, shots, 'win-petite-fenetre', platform.tint('', require('electron').nativeTheme.shouldUseDarkColors)); }
  const count = w.space.today.length;
  lw.openInOrbe();
  await until(() => w.space.today.length === count + 1, 'ouverture dans Orbe');
  check('« Ouvrir dans Orbe » crée un onglet', tabs()[w.activeId].url === base + '/a');

  // Mise en veille des onglets
  store.state.settings.maxLiveTabs = 2;
  OrbeWindow.trimLive();
  check('mise en veille au-delà de la limite', win.live.size <= 2 && win.live.has(w.activeId));
  store.state.settings.maxLiveTabs = 14;

  // Thème clair (le menu Présentation → Apparence applique le thème)
  commands.setSetting('appearance', 'light');
  check('le thème clair s’applique', require('electron').nativeTheme.themeSource === 'light');
  await until(() => ui('matchMedia("(prefers-color-scheme: light)").matches'), 'interface en clair');
  await shot('clair');
  commands.setSetting('appearance', 'auto');

  // Barre latérale : sélection multiple, annulation (tests/barre.js)
  await require('./barre')({ ...ctx, check });

  // Tableaux (tests/easels.js)
  await require('./easels')({ ...ctx, check });

  // Mots de passe (tests/passwords.js)
  await require('./passwords')({ ...ctx, check });

  // Navigation de tous les jours : autorisations, partage d'écran, certificats,
  // authentification, « quitter la page ? », fenêtres surgissantes… (tests/essentiels.js)
  await require('./essentiels')({ ...ctx, check });

  // Réglages à volets, raccourcis modifiables, import de signets (tests/reglages.js)
  await require('./reglages')({ ...ctx, check });

  // Persistance
  await shot('final');
  w.remember();
  store.flush();
  const saved = JSON.parse(fs.readFileSync(store.file, 'utf8'));
  const histFile = path.join(path.dirname(store.file), 'history.json');
  check('historique enregistré dans son propre fichier, hors de l’état', fs.existsSync(histFile) && Object.keys(JSON.parse(fs.readFileSync(histFile, 'utf8'))).length === Object.keys(store.state.history).length && !('history' in JSON.parse(fs.readFileSync(store.file, 'utf8'))));
  // Ancien format (historique dans orbe.json) : repris tel quel au chargement.
  const { Store: StoreClass } = { Store: store.constructor };
  const old = new StoreClass();
  const oldDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'orbe-ancien-'));
  fs.writeFileSync(path.join(oldDir, 'orbe.json'), JSON.stringify({ history: { 'https://exemple.org/': { url: 'https://exemple.org/', visits: 3, last: 1 } } }));
  old.load(oldDir);
  old.flush();
  check('ancien fichier : l’historique est déplacé sans perte', old.state.history['https://exemple.org/'].visits === 3 && JSON.parse(fs.readFileSync(path.join(oldDir, 'history.json'), 'utf8'))['https://exemple.org/'].visits === 3 && !('history' in JSON.parse(fs.readFileSync(path.join(oldDir, 'orbe.json'), 'utf8'))));
  check('état enregistré sur disque', saved.spaces.length === 2 && Object.keys(saved.tabs).length === Object.keys(tabs()).length && saved.window.spaceId === w.spaceId);

  server.close();
  console.log(`\n${results.length - failed}/${results.length} vérifications réussies\n`);
  if (failed) throw new Error(`${failed} vérification(s) en échec`);
};
