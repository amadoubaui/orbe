// Barre latérale : sélection multiple et pile d'annulation, sans réseau.
// Appelé par tests/selftest.js, ou seul :
//   ORBE_SCENARIO=tests/barre.js node scripts/dev.js --selftest
// Les onglets sont créés dans un Espace à part (jamais chargés : seules les
// données comptent ici) ; les messages passent par `handle`, la porte
// qu'emprunte la barre latérale, pour vérifier aussi le contrôle des arguments.
const { clipboard } = require('electron');

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

module.exports = async function barreTests(ctx) {
  const { first: w, store, win } = ctx;
  let failed = 0;
  const check = ctx.check || ((name, ok, detail = '') => { if (!ok) failed += 1; console.log(`${ok ? '  ✓' : '  ✗'} ${name}${ok || !detail ? '' : ' — ' + detail}`); });
  const ui = (js) => w.ui.webContents.executeJavaScript(js);
  const d = w.data;
  // Adresse locale qui refuse la connexion : rien ne sort de la machine.
  const url = (n) => `http://127.0.0.1:9/${n}`;
  const names = (ids) => ids.map((id) => (d.tabs[id] ? d.tabs[id].title : '?')).join('');
  const tree = (nodes) => nodes.map((n) => (n.type === 'folder' ? `[${tree(n.children)}]` : d.tabs[n.id].title)).join('');

  await until(() => ui('typeof S === "object" && S !== null'), 'coque chargée');
  const home = w.spaceId;
  const space = store.makeSpace('Essais', '🧪', '#0ea5e9');
  const other = store.makeSpace('Ailleurs', '📦', '#f97316');
  d.spaces.push(space, other);
  w.switchSpace(space.id);
  // Onglets A…H dans Aujourd'hui, dans cet ordre.
  const make = (letters, sp = space) => [...letters].map((c) => {
    const tab = w.createTab(url(c), { space: sp, index: sp.today.length });
    tab.title = c;
    return tab.id;
  });
  const [A, B, C, D, E, F, G, H] = make('ABCDEFGH');
  const today = () => names(space.today);
  const pinned = () => tree(space.pinned);
  w.changed();
  await until(() => ui('document.querySelectorAll("#today .row.tab").length === 8'), 'huit lignes affichées');

  // --- Sélection multiple ---------------------------------------------------
  const foreign = make('Z', other)[0];
  const folderX = { type: 'folder', id: 'dossier-x', name: 'X', open: true, children: [] };
  space.pinned.push(folderX);
  check('sélection : seuls les onglets affichés sont retenus, dans l’ordre de la barre',
    w.checkIds([D, 'inconnu', B, 42, null, foreign, folderX.id, B, { id: A }]).join() === [B, D].join()
    && w.checkIds('abc').length === 0 && w.checkIds(null).length === 0 && w.checkIds({ length: 2, 0: A, 1: B }).length === 0);

  w.handle('move', { ids: [F, B, D], to: 'today', index: 1 });
  check('sélection : déposer trois onglets ensemble les insère dans leur ordre', today() === 'ABDFCEGH', today());
  w.handle('move', { ids: [B, D, F], to: 'today', index: 8 });
  check('sélection : dépôt en fin de liste', today() === 'ACEGHBDF', today());
  w.handle('move', { ids: [A, H], to: 'today', index: 4 });
  check('sélection : dépôt au milieu du lot lui-même, autour de la position visée', today() === 'CEGAHBDF', today());
  w.handle('move', { ids: [C, E], to: 'ailleurs', index: 0 });
  w.handle('move', { ids: [C, E], to: 'folder', folderId: 'inconnu' });
  w.handle('move', { ids: [foreign, folderX.id], to: 'today', index: 0 });
  check('sélection : destination inconnue ou identifiants étrangers, rien ne bouge', today() === 'CEGAHBDF' && other.today.join() === foreign && pinned() === '[]');
  w.handle('move', { id: F, to: 'today', index: 0 });
  check('un seul identifiant : le déplacement simple est inchangé', today() === 'FCEGAHBD', today());

  w.handle('move', { ids: [C, G], to: 'folder', folderId: folderX.id, index: 0 });
  check('sélection : déposée dans un dossier', pinned() === '[CG]' && today() === 'FEAHBD' && d.tabs[C].homeUrl === url('C'));
  w.handle('move', { ids: [E, C], to: 'pinned', index: 0 });
  check('sélection mêlée (dossier et Aujourd’hui) : déposée dans les épinglés', pinned() === 'CE[G]' && today() === 'FAHBD', pinned());

  w.pinMany([A, C, B]);
  check('sélection : épingler ajoute les onglets du jour aux épinglés', pinned() === 'CE[G]AB' && today() === 'FHD', pinned());
  w.pinMany([C, A, G]);
  check('sélection entièrement épinglée : désépingler les ramène en tête d’Aujourd’hui', pinned() === 'E[]B' && today() === 'CGAFHD' && !d.tabs[C].homeUrl, pinned() + ' ' + today());
  w.favoriteMany([A, E, D]);
  check('sélection : ajoutée aux favoris', names(w.favorites) === 'EAD' && today() === 'CGFH' && pinned() === '[]B');
  w.favoriteMany([D, E]);
  check('sélection de favoris : retirée des favoris', names(w.favorites) === 'A' && today() === 'EDCGFH', today());
  w.favoriteMany([A]);

  const tpl = w.tabsMenuTemplate(w.checkIds([C, G, F]));
  const labels = tpl.filter((x) => x.label && x.visible !== false).map((x) => x.label);
  check('menu de la sélection : copier les liens, dupliquer, épingler, favoris, dossier, déplacer, archiver',
    labels.join('|') === ['tabs.copyLinks', 'tabs.duplicate', 'tabs.pinMany', 'tabs.addFavorite', 'tabs.folderFromSelection', 'tabs.moveTo', 'tabs.closeMany'].map((k) => store.t(k, null, { n: 3 })).join('|'), labels.join('|'));

  const previousClipboard = await clipboard.readText();
  w.copyLinks([G, C, foreign]);
  await until(async () => (await clipboard.readText()) === `${url('C')}\n${url('G')}`, 'liens dans le presse-papiers');
  check('sélection : « Copier les liens », un par ligne', true);
  w.handle('select', [F, H]);
  w.run('copyUrl');
  await until(async () => (await clipboard.readText()) === `${url('F')}\n${url('H')}`, 'liens de la sélection');
  check('⇧⌘C avec une sélection copie tous ses liens', true);
  await clipboard.writeText(previousClipboard);
  w.handle('select', []);

  const before = space.today.length;
  w.duplicateMany([D, B]);
  const copies = space.today.filter((id) => ![A, B, C, D, E, F, G, H].includes(id));
  check('sélection : dupliquer place chaque copie sous son modèle (en tête pour un épinglé)',
    space.today.length === before + 2 && today() === 'BAEDDCGFH' && pinned() === '[]B' && win.live.has(copies[0]) && w.activeId === null, today());
  w.handle('close', { ids: copies });
  check('sélection : archiver par la barre latérale ({ ids })', today() === 'AEDCGFH' && copies.every((id) => !d.tabs[id]) && !win.live.has(copies[0]));

  w.folderFromSelection([G, B, E]);
  const made = space.pinned.find((n) => n.type === 'folder' && n.id !== folderX.id);
  check('« Nouveau dossier avec la sélection » : le dossier prend la place du premier épinglé', pinned() === '[][BEG]' && today() === 'ADCFH' && !!made, pinned());
  await until(() => ui('!!document.querySelector("#pinned .folder input.rename")'), 'nom du dossier à saisir');
  await ui('document.querySelector("input.rename").blur()');

  w.moveManyToSpace([D, F, B], other.id);
  check('sélection : déplacée vers un autre Espace, ordre conservé', names(other.today) === 'DFZ' && tree(other.pinned) === 'B' && today() === 'ACH' && pinned() === '[][EG]', names(other.today));

  // La barre latérale annonce sa sélection ; ⌘W l'archive, et la sélection tombe.
  await until(() => ui('S.today.length === 3'), 'barre à jour');
  await ui(`setSel(${JSON.stringify([C, H])}); sel.size`);
  await until(() => w.selected().join() === [C, H].join(), 'sélection annoncée');
  check('la barre latérale annonce sa sélection (lignes surlignées)', await ui('document.querySelectorAll("#today .row.tab.sel").length') === 2);
  w.run('closeTab');
  check('⌘W avec une sélection archive tous ses onglets', today() === 'A' && !d.tabs[C] && !d.tabs[H] && store.state.archive[0].url === url('C'));
  await until(() => ui('sel.size === 0 && document.querySelectorAll(".sel").length === 0'), 'sélection vidée après l’action');
  check('après l’action, la barre latérale vide sa sélection', w.selected().length === 0);
  check('sans sélection, ⌘W garde son sens habituel', (() => { const t = w.createTab(url('seul'), { space }); w.activate(t.id); w.run('closeTab'); return !d.tabs[t.id]; })());

  // Remise en état : les deux Espaces d'essai disparaissent.
  for (const sp of [space, other]) {
    for (const id of [...sp.today, ...sp.pinned.flatMap((n) => (n.type === 'folder' ? n.children.map((c) => c.id) : [n.id]))]) { win.OrbeWindow.destroyView(id); delete d.tabs[id]; }
    d.spaces.splice(d.spaces.indexOf(sp), 1);
    delete w.activeBySpace[sp.id];
  }
  for (const id of w.favorites.splice(0).filter((x) => [A, B, C, D, E, F, G, H].includes(x))) delete d.tabs[id];
  w.spaceId = home;
  w.closed.length = 0;
  w.layout();
  w.changed();
  if (!ctx.check && failed) throw new Error(`${failed} vérification(s) en échec`);
};
