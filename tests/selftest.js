// Test de bout en bout : lance le vrai navigateur sur un profil temporaire,
// avec un petit serveur local, et vérifie les fonctions principales.
//   npm test
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Menu, clipboard } = require('electron');

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
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    res.setHeader('content-type', 'text/html; charset=utf-8');
    if (url.pathname === '/a') return res.end(page('Page A', '<h1>Alpha</h1><p>orbe orbe orbe</p><a id="pop" href="/c" target="_blank">ouvrir C</a>'));
    if (url.pathname === '/b') return res.end(page('Page B', '<h1>Bravo</h1>'));
    if (url.pathname === '/c') return res.end(page('Page C', '<h1>Charlie</h1><script>document.title = window.opener ? "C avec opener" : "C sans opener"</script>'));
    if (url.pathname === '/file.txt') { res.setHeader('content-disposition', 'attachment; filename="orbe-test.txt"'); return res.end('bonjour'); }
    res.statusCode = 404;
    return res.end(page('404', 'introuvable'));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

module.exports = async function selftest({ first: w, OrbeWindow, store, win, little, commands }) {
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
    const id = w.win.getMediaSourceId().split(':')[1];
    try { require('child_process').execFileSync('screencapture', ['-x', '-o', '-l', id, path.join(shots, name + '.png')]); } catch {}
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
  check('ajout aux favoris (tuile en haut)', w.data.favorites[0] === a.id);
  w.toggleFavorite(a.id);
  check('retrait des favoris', !w.data.favorites.length && w.space.today[0] === a.id);

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

  // Fenêtre ouverte par la page (window.opener conservé)
  w.activate(a.id);
  const before = w.space.today.length;
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
  await shot('scinde');
  w.run('closeSplit');
  check('⌃⇧- ferme le volet', w.visibleIds().length === 1 && w.splits.length === 0);

  // Barre latérale
  const x0 = win.live.get(w.activeId).view.getBounds().x;
  w.run('toggleSidebar');
  await sleep(320);
  const x1 = win.live.get(w.activeId).view.getBounds().x;
  check('⌘S masque la barre latérale', !w.sidebarVisible && x1 < x0 && x1 === 8);
  w.run('toggleSidebar');
  await sleep(320);
  check('⌘S la réaffiche', w.sidebarVisible && win.live.get(w.activeId).view.getBounds().x === x0);

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

  // Espaces
  w.newSpace();
  const s2 = w.space;
  check('nouvel Espace créé et affiché', w.data.spaces.length === 2 && w.activeId === null);
  w.rename(s2.id, 'Projets');
  w.setTheme({ color: '#10b981', icon: '🚀' });
  const c = w.newTab(base + '/b');
  await until(() => titleOf(c.id) === 'Page B', 'page dans le second Espace');
  await until(() => ui('S.space.name === "Projets" && S.today.length === 1'), 'barre latérale du second Espace');
  await shot('espace-2');
  w.run('prevSpace');
  check('⌥⌘← revient à l’Espace précédent avec son onglet', w.space !== s2 && w.activeId === a.id);
  w.spaceAt(2);
  check('⌃2 va au deuxième Espace', w.space === s2 && w.activeId === c.id);
  w.moveToSpace(c.id, w.data.spaces[0].id);
  check('déplacer un onglet vers un autre Espace', w.data.spaces[0].today.includes(c.id) && !s2.today.length);
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
  const missing = wanted.filter((k) => !accels.has(k));
  check(`les ${wanted.length} raccourcis d’Arc sont dans le menu`, !missing.length, 'manquants : ' + missing.join(', '));

  // Téléchargement
  win.live.get(a.id).wc.downloadURL(base + '/file.txt');
  await until(() => store.state.downloads[0] && store.state.downloads[0].state === 'completed', 'téléchargement terminé');
  const dl = store.state.downloads[0];
  check('téléchargement enregistré', fs.existsSync(dl.path) && fs.readFileSync(dl.path, 'utf8') === 'bonjour');
  fs.unlinkSync(dl.path);

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
  const count = w.space.today.length;
  lw.openInOrbe();
  await until(() => w.space.today.length === count + 1, 'ouverture dans Orbe');
  check('« Ouvrir dans Orbe » crée un onglet', tabs()[w.activeId].url === base + '/a');

  // Mise en veille des onglets
  store.state.settings.maxLiveTabs = 2;
  OrbeWindow.trimLive();
  check('mise en veille au-delà de la limite', win.live.size <= 2 && win.live.has(w.activeId));
  store.state.settings.maxLiveTabs = 14;

  // Persistance
  await shot('final');
  w.remember();
  store.flush();
  const saved = JSON.parse(fs.readFileSync(store.file, 'utf8'));
  check('état enregistré sur disque', saved.spaces.length === 2 && Object.keys(saved.tabs).length === Object.keys(tabs()).length && saved.window.spaceId === w.spaceId);

  server.close();
  console.log(`\n${results.length - failed}/${results.length} vérifications réussies\n`);
  if (failed) throw new Error(`${failed} vérification(s) en échec`);
};
