// Sensations : fichiers récents au survol de l'icône de la Bibliothèque, sortes
// montrées (clic droit), captures rangées dans la Bibliothèque…
// Appelé par tests/selftest.js, ou seul :
//   ORBE_SCENARIO=tests/sensations.js node scripts/dev.js --selftest
// Rien n'est réellement glissé ni ouvert : ces gestes du système sont remplacés par des témoins.
const fs = require('fs');
const os = require('os');
const path = require('path');
const outils = require('./outils');

const { sleep } = outils;
const until = (fn, label, timeout = 10000) => outils.until(fn, label, timeout);

module.exports = async function sensationsTests(ctx) {
  const { first: w, store } = ctx;
  let failed = 0;
  const check = ctx.check || ((name, ok, detail = '') => { if (!ok) failed += 1; console.log(`${ok ? '  ✓' : '  ✗'} ${name}${ok || !detail ? '' : ' — ' + detail}`); });
  const ui = (js) => w.ui.webContents.executeJavaScript(js);
  const library = require('../src/main/library');
  const downloads = require('../src/main/downloads');
  const T = (k, v) => store.t(k, null, v);
  await until(() => ui('typeof S === "object" && S !== null && typeof libPeek === "object"'), 'coque chargée');

  // === Fichiers récents (BIB-4, BIB-5) ===================================================
  {
    const saved = { downloads: store.state.downloads, peek: store.state.settings.libraryPeek, env: { ...library.env }, open: downloads.env.openPath };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbe-recents-'));
    const HOSTILE = '<img src=x onerror="window.pwned=1">.txt';
    const rec = (name, extra = {}) => {
      const file = path.join(dir, name.replace(/[<>"=/]/g, '_'));
      fs.writeFileSync(file, 'x');
      return { id: 'r-' + name.length + '-' + Math.random().toString(36).slice(2, 8), name, path: file, url: 'http://127.0.0.1:9/' + encodeURIComponent(name), total: 1, received: 1, state: 'completed', at: Date.now() - 5 * 60e3, marked: true, ...extra };
    };
    const gone = rec('disparu.txt');
    fs.rmSync(gone.path);
    const list = [rec(HOSTILE), rec('photo.png'), rec('Orbe 2026-10-09.png', { capture: true }), gone, { ...rec('encours.zip'), state: 'progressing' }, rec('a.pdf'), rec('b.pdf'), rec('c.pdf'), rec('d.pdf')];
    store.state.downloads = list;
    store.state.settings.libraryPeek = ['captures', 'downloads', 'media'];
    const lib = (name, a) => library.action(name, a, w.ui.webContents);

    const rows = await lib('lib:recent');
    check('fichiers récents : les cinq derniers encore sur le disque, du plus récent au plus ancien ; ni fichier disparu, ni téléchargement en cours',
      rows.length === 5 && rows.map((r) => r.name).join('|') === [HOSTILE, 'photo.png', 'Orbe 2026-10-09.png', 'a.pdf', 'b.pdf'].join('|'), JSON.stringify(rows.map((r) => r.name)));
    check('fichiers récents : chaque fiche dit sa sorte (capture, média, téléchargement) ; aucun chemin ni adresse ne part vers la barre',
      rows.map((r) => r.kind).join() === 'downloads,media,captures,downloads,downloads' && rows.every((r) => Object.keys(r).sort().join() === 'at,danger,id,kind,name'), JSON.stringify(rows[0]));

    // Clic droit : les sortes montrées.
    let menu = null;
    library.env.popup = (win, tpl) => { menu = tpl; };
    await lib('lib:peekMenu');
    const labels = menu.map((m) => m.label || '-');
    check('clic droit sur l’icône : « Au survol, montrer » Captures, Téléchargements, Médias (cochés), puis « Ouvrir la Bibliothèque »',
      labels.join('|') === [T('peek.show'), T('peek.kind.captures'), T('peek.kind.downloads'), T('peek.kind.media'), '-', T('peek.open')].join('|') && menu.slice(1, 4).every((m) => m.type === 'checkbox' && m.checked), labels.join('|'));
    menu[2].click(); // décoche « Téléchargements »
    const sansDl = await lib('lib:recent');
    check('« Téléchargements » décoché : le survol ne montre plus que captures et médias ; le choix est retenu',
      sansDl.map((r) => r.kind).join() === 'media,captures' && store.state.settings.libraryPeek.join() === 'captures,media', JSON.stringify(sansDl.map((r) => r.kind)));
    await lib('lib:peekMenu');
    check('le menu rouvert montre le choix (Téléchargements décoché)', menu[2].checked === false && menu[1].checked && menu[3].checked);
    menu[1].click(); menu[3].click();
    check('tout décoché : plus rien au survol', (await lib('lib:recent')).length === 0 && store.state.settings.libraryPeek.length === 0);
    menu[3].click(); menu[2].click(); menu[1].click();
    check('tout recoché : dans l’ordre fixe des sortes', store.state.settings.libraryPeek.join() === 'captures,downloads,media');
    store.state.settings.libraryPeek = 'n’importe quoi';
    check('réglage abîmé : les trois sortes par défaut', (await lib('lib:recent')).length === 5);
    store.state.settings.libraryPeek = ['captures', 'downloads', 'media'];

    // Le panneau, dans la barre : texte posé comme du texte, ouverture, glisser.
    const shown = await ui(`(async () => {
      const rows = await send('lib:recent');
      const b = document.getElementById('b-library');
      b.dispatchEvent(new PointerEvent('pointerenter'));
      // (sans vraie souris, « :hover » est faux : le panneau est posé par son nom d'essai)
      return rows.length;
    })()`);
    check('la barre latérale obtient les mêmes fiches par le canal de l’interface', shown === 5);
    const opened = [];
    const dragged = [];
    downloads.env.openPath = (f) => { opened.push(f); };
    library.env.startDrag = (wc, item) => { dragged.push(item.file); };
    await lib('lib:openFile', rows[1].id);
    check('ouvrir une fiche récente : le fichier s’ouvre par le système', opened.length === 1 && opened[0] === list[1].path, JSON.stringify(opened));
    // (l'icône du fichier est demandée au système au moment où la fiche est montrée)
    await until(() => !!library.internals.icons.get(list[1].path) || library.internals.dragIcon(list[1].path), 'icône du fichier');
    const okDrag = await lib('lib:drag', rows[1].id);
    check('glisser une fiche récente hors d’Orbe : le vrai fichier part, depuis la barre latérale', okDrag === true && dragged.join() === list[1].path, JSON.stringify(dragged));
    check('identifiant inconnu ou forgé : ni ouverture ni glisser', (await lib('lib:openFile', '../../etc/passwd')) === false && (await lib('lib:drag', { id: rows[0].id })) === false && opened.length === 1 && dragged.length === 1);

    // Captures d'Orbe : elles rejoignent la Bibliothèque (sauf en navigation privée).
    library.env.captureDir = () => dir;
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const kept = await new Promise((done) => library.keepCapture('Orbe essai.png', png, { done }));
    const top = (await lib('lib:recent'))[0];
    check('capture enregistrée : le fichier est écrit et sa fiche prend la tête des récents, rangée parmi les captures',
      !!kept && fs.existsSync(path.join(dir, 'Orbe essai.png')) && top.name === 'Orbe essai.png' && top.kind === 'captures' && store.state.downloads[0].capture === true, JSON.stringify(top));
    const before = store.state.downloads.length;
    const priv = await new Promise((done) => library.keepCapture('Orbe privée.png', png, { incognito: true, done }));
    check('capture en navigation privée : le fichier est écrit, aucune fiche n’est gardée', priv === null && fs.existsSync(path.join(dir, 'Orbe privée.png')) && store.state.downloads.length === before);
    const all = await lib('lib:get', {});
    check('Bibliothèque → Médias : la capture y figure', all.media.some((r) => r.name === 'Orbe essai.png'));

    await ui('libPeek.close(true)');
    Object.assign(library.env, saved.env);
    downloads.env.openPath = saved.open;
    store.state.downloads = saved.downloads;
    store.state.settings.libraryPeek = saved.peek;
    store.save();
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // === Changement d'onglet : coupe franche (ANI-24) ========================================
  {
    const { win } = ctx;
    const home = w.activeId;
    const motion0 = win.forceMotion(true); // animations permises : la coupe franche est un choix, pas un repli
    const a = w.newTab('http://127.0.0.1:9/coupe-a').id;
    const b = w.newTab('http://127.0.0.1:9/coupe-b').id;
    await until(() => win.live.has(a) && win.live.has(b) && !win.inFlight(win.live.get(b).view), 'deux onglets vivants');
    const shown = (id) => w.win.contentView.children.includes(win.live.get(id).view);
    const same = (x, y) => x.x === y.x && x.y === y.y && x.width === y.width && x.height === y.height;
    const before = win.motionStats.animated;
    w.activate(a);
    // Lu dans le même tour : rien n'a le temps de s'animer.
    const cut = { a: shown(a), b: shown(b), flight: win.inFlight(win.live.get(a).view), animated: win.motionStats.animated - before, rect: same(win.live.get(a).view.getBounds(), w.contentRect()) };
    check('changement d’onglet : coupe franche — la page choisie est à sa place entière dans le même tour, l’autre est retirée, aucun trajet animé',
      cut.a && !cut.b && !cut.flight && cut.animated === 0 && cut.rect, JSON.stringify(cut));
    const row = await ui(`(async () => { await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); const el = document.querySelector('#today .row.tab.active'); return el ? el.getAnimations().filter((x) => x.playState === 'running').length : -1; })()`);
    check('changement d’onglet : la ligne choisie de la barre latérale change d’état sans animation', row === 0, String(row));
    win.forceMotion(motion0);
    w.close(a, { ask: false });
    w.close(b, { ask: false });
    store.state.archive = store.state.archive.filter((x) => !/\/coupe-[ab]$/.test(x.url || ''));
    if (home) w.activate(home);
  }

  await sleep(0);
  return failed;
};
