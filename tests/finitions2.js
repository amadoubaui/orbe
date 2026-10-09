// Finitions, deuxième série : dossier « Premiers pas » du premier lancement, Échap en
// plein écran, onglet lâché sur les quatre côtés d'une page, onglet glissé hors de la
// fenêtre ou vers une autre fenêtre, dépôt dans un dossier fermé, nouvel Espace au bout
// de la rangée, lueur de chargement.
// Appelé par tests/selftest.js, ou seul :
//   ORBE_SCENARIO=tests/finitions2.js node scripts/dev.js --selftest
const outils = require('./outils');

const { sleep } = outils;
const until = (fn, label, timeout = 10000) => outils.until(fn, label, timeout);

module.exports = async function finitions2Tests(ctx) {
  const { first: w, store, win, OrbeWindow } = ctx;
  const starter = require('../src/main/starter');
  let failed = 0;
  const check = ctx.check || ((name, ok, detail = '') => { if (!ok) failed += 1; console.log(`${ok ? '  ✓' : '  ✗'} ${name}${ok || !detail ? '' : ' — ' + detail}`); });
  const ignorer = outils.ignorer;
  const ui = (js) => w.ui.webContents.executeJavaScript(js);
  const d = w.data;
  const T = (k, v) => store.t(k, null, v);
  const dead = (n) => `http://127.0.0.1:9/fin2-${n}`;
  const mine = (x) => String(x.url || '').startsWith(dead(''));

  await until(() => ui('typeof S === "object" && S !== null'), 'coque chargée');
  const home = w.spaceId;
  const homeActive = w.activeBySpace[home];
  const sidebar0 = w.sidebarVisible;
  if (!w.sidebarVisible) w.toggleSidebar(true);
  const archive0 = store.state.archive.length;
  const spaces0 = d.spaces.length;
  const space = store.makeSpace('Finitions 2', '🧪', '#0ea5e9');
  d.spaces.push(space);
  w.switchSpace(space.id);
  const make = (letters, sp = space) => [...letters].map((c) => {
    const tab = w.createTab(dead(c), { space: sp, index: sp.today.length });
    tab.title = c;
    return tab.id;
  });

  // --- Dossier « Premiers pas » (IMP-5) ------------------------------------------------
  {
    const flag0 = store.state.window.starter;
    delete store.state.window.starter;
    const folder = starter.seed(w, space);
    const kids = folder ? folder.children.map((n) => d.tabs[n.id]) : [];
    check('premier lancement : un dossier « Premiers pas » est posé en tête des épinglés, ouvert, avec ses onglets',
      !!folder && space.pinned[0] === folder && folder.open === true && folder.name === T('starter.folder') && kids.length === starter.PAGES.length && kids.length >= 3
      && kids.every((tab, i) => tab && tab.url === starter.PAGES[i][1] && tab.homeUrl === tab.url && tab.title === T(starter.PAGES[i][0])));
    check('« Premiers pas » : seules des pages d’Orbe (marquées internes) et des adresses https écrites dans le code ; aucune page n’est chargée d’avance',
      kids.every((tab) => (tab.internal === true ? /^orbe:\/\/app\/[a-z]+\.html$/.test(tab.url) : /^https:\/\/github\.com\/amadoubaui\/orbe/.test(tab.url)) && !win.live.has(tab.id)));
    check('« Premiers pas » : posé une seule fois ; jamais dans une fenêtre privée', starter.seed(w, space) === null && store.state.window.starter === true && space.pinned.filter((n) => n.type === 'folder').length === 1
      && (() => { delete store.state.window.starter; const r = starter.seed({ incognito: true, shared: false, data: d, space, changed() {} }); return r === null && !store.state.window.starter; })());
    await until(() => ui(`[...document.querySelectorAll('#pinned .folder > .row .title')].some((el) => el.textContent === ${JSON.stringify(T('starter.folder'))})`), 'dossier dans la barre');
    check('« Premiers pas » : la barre latérale montre le dossier et ses lignes',
      await ui(`document.querySelectorAll('#pinned .folder.open .children .row.tab').length === ${kids.length}`));
    for (const tab of kids) delete d.tabs[tab.id];
    space.pinned = [];
    if (flag0 === undefined) delete store.state.window.starter; else store.state.window.starter = flag0;
    w.changed();
  }

  // --- Échap en plein écran (RAC-45) ---------------------------------------------------
  {
    const isFull0 = w.win.isFullScreen;
    const setFull0 = w.win.setFullScreen;
    let full = true;
    const asked = [];
    w.win.isFullScreen = () => full;
    w.win.setFullScreen = (v) => { asked.push(v); full = v; };
    const patched = w.win.isFullScreen() === true;
    const key = (extra = {}) => { const e = { prevented: false, preventDefault() { this.prevented = true; } }; w.onInput(e, { type: 'keyDown', key: 'Escape', ...extra }, false, null); return e.prevented; };
    if (!patched) ignorer('Échap doublé ou maintenu : sortie du plein écran', 'la fenêtre ne se laisse pas simuler en plein écran');
    else {
      w.escAt = 0;
      const one = key();
      check('plein écran : un seul Échap ne fait pas sortir (il va à la page)', one === false && asked.length === 0 && full === true);
      await sleep(450);
      const late = key();
      check('plein écran : deux Échap espacés de plus de 400 ms ne font pas sortir', late === false && asked.length === 0);
      const second = key();
      check('plein écran : Échap doublé fait sortir la fenêtre du plein écran, et la touche est consommée', second === true && asked.join() === 'false' && full === false);
      full = true; asked.length = 0; w.escAt = 0;
      key();
      const early = w.escFullScreen({ isAutoRepeat: true }, w.escAt + 300);
      const held = w.escFullScreen({ isAutoRepeat: true }, w.escAt + 650);
      check('plein écran : Échap maintenu 0,6 s fait sortir ; relâché avant, non', early === false && held === true && asked.join() === 'false');
      full = true; asked.length = 0; w.escAt = 0;
      w.htmlFullscreen = true;
      key(); const video = key();
      w.htmlFullscreen = false;
      check('page en plein écran (vidéo) : le moteur garde la main, Orbe ne s’en mêle pas', video === false && asked.length === 0);
      full = false; w.escAt = 0;
      key(); const plain = key();
      check('fenêtre ordinaire : Échap doublé ne fait rien de plus', plain === false && asked.length === 0);
    }
    w.win.isFullScreen = isFull0;
    w.win.setFullScreen = setFull0;
    w.escAt = 0;
  }

  // --- Onglet lâché sur la page : quatre côtés (BL-97) ----------------------------------
  const [A, B, C, D] = make('ABCD');
  w.activate(A);
  {
    const rect = w.contentRect();
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    const at = (fx, fy) => w.dropTargetAt(rect.x + rect.width * fx, rect.y + rect.height * fy);
    const top = at(0.5, 0.1);
    const bottom = at(0.3, 0.9);
    const left = at(0.2, 0.5);
    const right = at(0.8, 0.5);
    check('page seule, glisser un onglet : le quart haut vise « au-dessus », le quart bas « au-dessous » ; la zone éclairée est la moitié correspondante',
      top.id === A && top.vertical === true && top.before === true && top.zone.y === 0 && top.zone.w === rect.width && top.zone.h === Math.round(rect.height / 2)
      && bottom.vertical === true && bottom.before === false && bottom.zone.y === Math.round(rect.height / 2), JSON.stringify([top, bottom]));
    check('page seule : le reste de la hauteur vise la gauche ou la droite', left.vertical === false && left.before === true && left.zone.x === 0 && left.zone.h === rect.height
      && right.vertical === false && right.before === false && right.zone.x === Math.round(rect.width / 2), JSON.stringify([left, right]));
    w.handle('dropSplit', { id: B, x: cx, y: rect.y + 12 });
    let g = w.groupOf(A);
    let pa = win.live.get(A).view.getBounds();
    let pb = win.live.get(B).view.getBounds();
    check('lâché en haut : vue empilée, le nouvel onglet au-dessus, et c’est lui qui a la main', !!g && g.join() === [B, A].join() && w.isVertical(g) && pb.y < pa.y && pb.x === pa.x && w.activeId === B, JSON.stringify([g, pa, pb]));
    const stacked = w.dropTargetAt(cx, rect.y + rect.height - 20);
    check('vue déjà empilée : elle garde son sens (le bas du second volet vise « après lui »)', stacked.id === A && stacked.vertical === true && stacked.before === false);
    w.leaveSplit(B); w.leaveSplit(A);
    w.activate(A);
    w.handle('dropSplit', { id: C, x: cx, y: rect.y + rect.height - 12 });
    g = w.groupOf(A);
    pa = win.live.get(A).view.getBounds();
    const pc = win.live.get(C).view.getBounds();
    check('lâché en bas : vue empilée, le nouvel onglet au-dessous', !!g && g.join() === [A, C].join() && w.isVertical(g) && pc.y > pa.y, JSON.stringify([g, pa, pc]));
    w.leaveSplit(C); w.leaveSplit(A);
    w.activate(A);
    w.handle('dropSplit', { id: D, x: rect.x + 20, y: cy });
    g = w.groupOf(A);
    check('lâché à gauche : côte à côte, le nouvel onglet à gauche (comme avant)', !!g && g.join() === [D, A].join() && !w.isVertical(g) && win.live.get(D).view.getBounds().x < win.live.get(A).view.getBounds().x);
    w.leaveSplit(D); w.leaveSplit(A);
    w.activate(A);
    w.layout();
    // La coque redemande la zone quand le pointeur change de bande (huit bandes sur la hauteur).
    await until(() => ui(`S.activeId === ${JSON.stringify(A)} && (S.panes || []).length === 0`), 'page seule dans la barre');
    check('coque : la clé de la zone change entre le haut, le milieu et le bas de la page (un envoi par bande, pas un par mouvement)',
      await ui(`(() => { const x = S.sidebar.width + 200; const k = [zoneKeyAt(x, 20), zoneKeyAt(x, 24), zoneKeyAt(x, innerHeight / 2), zoneKeyAt(x, innerHeight - 20)]; return k[0] === k[1] && new Set(k).size === 3; })()`));
  }

  // --- Onglet glissé hors de la fenêtre, ou vers une autre fenêtre (BL-95, BL-96) --------
  {
    const b = w.win.getBounds();
    const count0 = OrbeWindow.all.length;
    w.activate(A);
    check('lâché à l’intérieur de la fenêtre (glisser abandonné) : aucune fenêtre n’est créée', w.tearOff([B], { x: b.x + 50, y: b.y + 50 }) === null && OrbeWindow.all.length === count0);
    check('identifiants inconnus, dossier, point illisible : refusés', w.tearOff(['nope'], { x: b.x - 500, y: b.y }) === null && w.tearOff([B], { x: NaN, y: 1 }) === null && w.handle('tearOff', 'x') === false && w.handle('tearOff', { ids: 'x' }) === false && OrbeWindow.all.length === count0);
    const cursor0 = win.hooks.cursor;
    const out = { x: b.x + b.width + 300, y: b.y + 200 };
    win.hooks.cursor = () => out;
    const made = w.handle('tearOff', { ids: [A], x: 5, y: 5 }); // le point envoyé par l'interface est ignoré
    const w2 = OrbeWindow.all.find((x) => x !== w && x.activeId === A);
    check('onglet lâché hors de la fenêtre : une nouvelle fenêtre ordinaire l’affiche, sur le même Espace', made === true && OrbeWindow.all.length === count0 + 1 && !!w2 && w2.shared && w2.spaceId === space.id && win.live.get(A).owner === w2);
    check('… la fenêtre d’origine passe à l’onglet voisin (pas de page vide), l’onglet reste à sa place dans la liste', w.activeId === B && space.today.join() === [A, B, C, D].join(), String(w.activeId));
    if (w2) {
      const nb = w2.win.getBounds();
      const area = require('electron').screen.getDisplayNearestPoint(out).workArea;
      check('… la nouvelle fenêtre se pose sous le pointeur, dans l’écran, à la taille de la première',
        nb.x >= area.x && nb.y >= area.y && nb.x + nb.width <= area.x + area.width && nb.y + nb.height <= area.y + area.height && nb.width === Math.min(b.width, area.width),
        JSON.stringify([nb, area, out]));
      // Vers une autre fenêtre : le pointeur est au-dessus de la seconde fenêtre.
      // (Les fenêtres peuvent se recouvrir à l'écran : on vise un coin de la seconde que la première ne couvre pas.)
      const r = w.win.getBounds();
      const within = (p, q) => p.x >= q.x && p.x < q.x + q.width && p.y >= q.y && p.y < q.y + q.height;
      const corners = [[20, 20], [nb.width - 20, 20], [20, nb.height - 20], [nb.width - 20, nb.height - 20]].map(([dx, dy]) => ({ x: nb.x + dx, y: nb.y + dy }));
      const spot = corners.find((p) => !within(p, r));
      win.hooks.cursor = () => spot;
      const n1 = OrbeWindow.all.length;
      if (!spot) ignorer('onglet lâché sur une autre fenêtre : elle l’affiche', 'les deux fenêtres se recouvrent sur cet écran');
      else {
        w.activate(C);
        const moved = w.handle('tearOff', { ids: [C] });
        check('onglet lâché sur une autre fenêtre d’Orbe : elle l’affiche, sans créer de fenêtre ; la première passe au voisin', moved === true && OrbeWindow.all.length === n1 && w2.activeId === C && win.live.get(C).owner === w2 && w.activeId !== C && !!w.activeId, JSON.stringify([w2.activeId, w.activeId]));
      }
      // Ligne lâchée sur la barre latérale de l'autre fenêtre (l'interface n'envoie que l'identifiant).
      w.activate(D);
      check('ligne d’une autre fenêtre lâchée sur la barre latérale : l’onglet s’affiche ici ; identifiant inconnu ou déjà d’ici : refusé',
        w2.handle('adoptTab', D) === true && w2.activeId === D && w.activeId !== D && w2.handle('adoptTab', 'nope') === false && w2.handle('adoptTab', { id: D }) === false);
      // Fenêtre privée : ses onglets ne sortent pas, et elle n'en adopte pas.
      const iw = new OrbeWindow({ incognito: true });
      const it = iw.createTab(dead('prive'));
      win.hooks.cursor = () => ({ x: -9000, y: -9000 });
      const n2 = OrbeWindow.all.length;
      check('fenêtre privée : un onglet glissé dehors n’ouvre rien ; elle n’adopte aucun onglet', iw.tearOff([it.id]) === null && iw.handle('adoptTab', D) === false && iw.adopt([D], w2) === null && OrbeWindow.all.length === n2 && w2.activeId === D);
      // (Une fenêtre fermée pendant que sa barre se charge laisse des messages en route dans le moteur.)
      await until(() => !iw.ui.webContents.isLoading() && !w2.ui.webContents.isLoading(), 'barres des fenêtres d’essai chargées');
      await sleep(300);
      iw.win.close();
      w.activate(A); // reprend l'onglet avant de fermer la seconde fenêtre
      w2.win.close();
      await until(() => !OrbeWindow.all.includes(w2) && !OrbeWindow.all.includes(iw), 'fenêtres d’essai fermées');
    }
    win.hooks.cursor = cursor0;
    check('la position du pointeur vient du système', typeof win.hooks.cursor().x === 'number');
  }

  // --- Dépôt dans un dossier fermé (BL-76) ---------------------------------------------
  {
    const folder = { type: 'folder', id: 'fin2-dossier', name: 'Fermé', open: false, children: [] };
    space.pinned.push(folder);
    w.changed();
    w.handle('move', { id: D, to: 'folder', folderId: folder.id, index: 0 });
    check('déposer un onglet dans un dossier fermé : il y entre, le dossier reste fermé', folder.children.map((n) => n.id).join() === D && folder.open === false && !space.today.includes(D));
    await until(() => ui(`(() => { const f = document.querySelector('#pinned .folder'); return !!f && !f.classList.contains('open'); })()`), 'dossier fermé dans la barre');
    const reduced = await ui('reducedMotion.matches');
    const pulse = await ui(`(() => { const f = document.querySelector('#pinned .folder'); dropPulse(f); const a = f.querySelector('.ic').getAnimations().find((x) => x.id === 'drop-pulse'); return a ? Object.keys(a.effect.getKeyframes()[1]).filter((k) => !['offset', 'easing', 'composite', 'computedOffset'].includes(k)).join() : ''; })()`);
    check('dépôt dans un dossier : son icône rebondit une fois, par transformation seulement (rien avec « Réduire les animations »)', pulse === (reduced ? '' : 'transform'), pulse);
  }

  // --- Nouvel Espace au bout de la rangée (ESP-10) ----------------------------------------
  {
    w.switchSpace(d.spaces[d.spaces.length - 1].id);
    await until(() => ui(`!slide && S.space.id === ${JSON.stringify(space.id)} && S.near.next === null`), 'dernier Espace affiché');
    const reduced = await ui('reducedMotion.matches');
    if (reduced) ignorer('tirer franchement au-delà du dernier Espace : un nouvel Espace est créé', '« Réduire les animations » actif');
    else {
      const n = d.spaces.length;
      await ui(`(async () => { for (let i = 0; i < 40 && !wheelLocked; i++) { document.getElementById('scroll').dispatchEvent(new WheelEvent('wheel', { deltaX: 60, bubbles: true, cancelable: true })); await new Promise((r) => setTimeout(r, 8)); } })()`);
      await until(() => d.spaces.length === n + 1, 'nouvel Espace');
      const created = d.spaces[d.spaces.length - 1];
      check('tirer franchement au-delà du dernier Espace : un nouvel Espace est créé et affiché', w.space === created && created.id !== space.id);
      await until(() => ui('!slide'), 'fin du glissement');
      await sleep(200);
      w.hideModal();
      w.switchSpace(space.id);
      d.spaces.splice(d.spaces.indexOf(created), 1);
      delete w.activeBySpace[created.id];
      w.undoStack.length = 0;
      w.changed();
      await until(() => ui(`!slide && S.space.id === ${JSON.stringify(space.id)}`), 'retour à l’Espace d’essai');
    }
  }

  // --- Lueur de chargement (BL-32) ---------------------------------------------------------
  {
    w.activate(A);
    const rt = win.live.get(A);
    const loading0 = rt.loading;
    rt.loading = true;
    w.changed();
    await until(() => ui('document.body.classList.contains("loading")'), 'chargement annoncé à la coque');
    const g = await ui(`(() => { const el = document.getElementById('glow'); const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return { left: Math.round(r.left), top: Math.round(r.top), events: cs.pointerEvents, sw: S.sidebar.width }; })()`);
    check('page en chargement : la lueur est posée le long du bord haut de la page (à droite de la barre latérale), sans prendre les clics', g.left === g.sw && g.top === 0 && g.events === 'none', JSON.stringify(g));
    rt.loading = loading0;
    w.changed();
    await until(() => ui('!document.body.classList.contains("loading")'), 'fin du chargement');
    check('chargement fini : la lueur s’éteint', true);
  }

  // --- Téléchargements en cours, au bas de la barre (BL-57) -----------------------------------
  {
    const dl = require('../src/main/downloads');
    const rec = { id: 'fin2-dl', name: 'gros <b>fichier</b>.zip', url: dead('dl'), path: '', state: 'progressing', received: 1048576, total: 10485760 };
    const done = { id: 'fin2-fini', name: 'fini.zip', url: dead('dl2'), path: '', state: 'completed', received: 5, total: 5 };
    store.state.downloads.push(done, rec);
    check('temps restant : inconnu tant que le débit n’est pas mesuré', dl.eta(rec) === null);
    dl.sample(rec, 1000);
    rec.received = 2097152;
    dl.sample(rec, 1200); // relevé trop rapproché : ignoré
    dl.sample(rec, 2000); // 1 Mo en 1 s
    check('temps restant : reste à recevoir ÷ débit lissé (8 Mo à 1 Mo/s : 8 s) ; en pause ou sans taille : inconnu',
      dl.eta(rec) === 8 && dl.eta({ ...rec }) === null && (() => { rec.paused = true; const p = dl.eta(rec); rec.paused = false; return p === null; })(), String(dl.eta(rec)));
    w.changed();
    await until(() => ui('document.querySelectorAll("#dls .dl").length === 1 && !document.getElementById("dls").hidden'), 'ligne du téléchargement');
    const row = await ui(`(() => { const el = document.querySelector('#dls .dl'); return { name: el.querySelector('.dl-name').textContent, tags: el.querySelector('.dl-name').children.length, sub: el.querySelector('.dl-sub').textContent, bar: el.querySelector('.dl-bar').style.transform, x: el.querySelector('.dl-x').title, id: el.dataset.dl }; })()`);
    const units = T('dl.units').split(' ');
    check('téléchargement en cours : une ligne au bas de la barre — nom posé comme du texte, taille reçue sur taille totale, temps restant, « × » pour annuler',
      row.name === rec.name && row.tags === 0 && row.sub === `2.0 ${units[2]} / 10.0 ${units[2]} · ${T('dl.leftSec', { n: 8 })}` && row.bar === 'scaleX(0.2)' && row.x === T('dl.cancel') && row.id === rec.id, JSON.stringify(row));
    const more = [1, 2, 3].map((n) => ({ ...rec, id: 'fin2-plus' + n, name: 'autre' + n }));
    store.state.downloads.push(...more);
    w.changed();
    await until(() => ui('document.querySelectorAll("#dls .dl").length === 3'), 'trois lignes');
    check('seuls les téléchargements en cours ont une ligne, trois au plus, le plus récent en haut', await ui('[...document.querySelectorAll("#dls .dl-name")].map((x) => x.textContent).join()') === 'autre3,autre2,autre1');
    store.state.downloads = store.state.downloads.filter((x) => !more.includes(x));
    w.changed();
    await until(() => ui('document.querySelectorAll("#dls .dl").length === 1'), 'une ligne');
    rec.paused = true;
    w.changed();
    await until(() => ui(`document.querySelector('#dls .dl-sub').textContent.endsWith(${JSON.stringify(T('dl.paused'))})`), 'en pause');
    check('téléchargement en pause : la ligne le dit, sans temps restant', true);
    rec.paused = false;
    const cancel0 = dl.cancel;
    const cancelled = [];
    dl.cancel = (d) => { cancelled.push(d.id); return true; };
    await ui('document.querySelector("#dls .dl-x").click()');
    await until(() => cancelled.length === 1, 'annulation demandée');
    check('« × » : le téléchargement est annulé ; identifiant inconnu, objet, ou téléchargement déjà fini : refusé',
      cancelled.join() === rec.id && w.handle('dlCancel', 'nope') === false && w.handle('dlCancel', { id: rec.id }) === false && w.handle('dlCancel', done.id) === false && cancelled.length === 1);
    dl.cancel = cancel0;
    store.state.downloads = store.state.downloads.filter((x) => x !== rec && x !== done);
    w.changed();
    await until(() => ui('document.getElementById("dls").hidden && document.querySelectorAll("#dls .dl").length === 0'), 'ligne retirée');
    check('téléchargement terminé : la ligne s’en va', true);
  }

  // --- Remise en état ---------------------------------------------------------------------
  w.switchSpace(space.id);
  for (const id of Object.keys(d.tabs)) if (mine(d.tabs[id])) { OrbeWindow.destroyView(id); delete d.tabs[id]; }
  space.today = []; space.pinned = []; space.splits = [];
  delete w.activeBySpace[space.id];
  d.spaces.splice(d.spaces.indexOf(space), 1);
  store.state.archive = store.state.archive.filter((x) => !mine(x));
  check('remise en état : Espaces et archive retrouvent leur taille', d.spaces.length === spaces0 && store.state.archive.length === archive0, `${d.spaces.length}/${spaces0} ${store.state.archive.length}/${archive0}`);
  w.closed.length = 0;
  w.undoStack.length = 0;
  w.redoStack.length = 0;
  w.spaceId = home;
  if (homeActive && d.tabs[homeActive]) w.activeBySpace[home] = homeActive;
  if (w.sidebarVisible !== sidebar0) w.toggleSidebar(sidebar0);
  w.layout();
  w.changed();
  if (!ctx.check && failed) throw new Error(`${failed} vérification(s) en échec`);
};
