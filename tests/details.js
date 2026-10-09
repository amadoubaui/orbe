// Détails de la branche « médias et capture » : petite fenêtre (ouverture animée,
// bandeau de première fois, profil retenu par site), image dans l'image par site…
// Appelé par tests/selftest.js, ou seul :
//   ORBE_SCENARIO=tests/details.js node scripts/dev.js --selftest
const outils = require('./outils');

const { sleep } = outils;
const until = (fn, label, timeout = 10000) => outils.until(fn, label, timeout);

module.exports = async function detailsTests(ctx) {
  const { first: w, store, win, little } = ctx;
  let failed = 0;
  const check = ctx.check || ((name, ok, detail = '') => { if (!ok) failed += 1; console.log(`${ok ? '  ✓' : '  ✗'} ${name}${ok || !detail ? '' : ' — ' + detail}`); });
  const { LittleWindow } = little;
  const d = w.data;
  await outils.profilPret(w);

  // === Petite fenêtre ==================================================================
  {
    for (const l of LittleWindow.all) l.win.close();
    await until(() => LittleWindow.all.length === 0, 'petites fenêtres fermées');
    const saved = { seen: store.state.window.littleSeen, profiles: store.state.window.littleProfiles, hooks: { ...little.hooks } };
    const uiOf = (l, js) => l.ui.webContents.executeJavaScript(js);

    // Ouverture animée : opacité et position seulement.
    delete store.state.window.littleSeen;
    win.forceMotion(true);
    const l1 = new LittleWindow('');
    const at0 = { opacity: l1.win.getOpacity(), opening: !!l1.opening, visible: l1.win.isVisible(), size: l1.win.getSize().join('x') };
    const pos0 = l1.win.getPosition();
    await until(() => !l1.opening, 'ouverture terminée', 3000);
    const steps = l1.win.getOpacity();
    check('petite fenêtre : elle s’ouvre en se dévoilant (opacité de 0 à 1) et en montant de quelques points, sans changer de taille',
      at0.opacity === 0 && at0.opening && at0.visible && steps === 1 && l1.win.getPosition()[1] === pos0[1] - little.OPEN.rise && l1.win.getPosition()[0] === pos0[0] && l1.win.getSize().join('x') === at0.size,
      JSON.stringify({ at0, pos0, fin: l1.win.getPosition(), opacite: steps }));

    // Première fois : bandeau d'explication, une seule fois.
    await until(() => uiOf(l1, 'typeof O === "object" && !document.getElementById("hint").hidden').catch(() => false), 'bandeau affiché');
    check('première petite fenêtre : un bandeau dit à quoi elle sert, et la chose est retenue', l1.hint === true && store.state.window.littleSeen === true && (await uiOf(l1, 'document.querySelector("#hint span").textContent')) === store.t('little.hint'));
    l1.load('http://127.0.0.1:9/petite');
    const yHint = win.boundsOf(l1.view).y;
    await uiOf(l1, 'document.getElementById("hint-close").click()');
    await until(() => !l1.hint && win.boundsOf(l1.view).y === 42, 'bandeau refermé');
    check('bandeau refermé : la page reprend sa place sous la barre', yHint === 42 + little.HINT && (await uiOf(l1, 'document.getElementById("hint").hidden')) === true);
    win.forceMotion(false);
    const l2 = new LittleWindow('');
    check('fenêtres suivantes : pas de bandeau ; « Réduire les animations » : ouverte d’un coup', l2.hint === false && !l2.opening && l2.win.getOpacity() === 1 && l2.win.isVisible());
    win.forceMotion(null);

    // Profil retenu par site.
    little.hooks.profiles = () => ['default', 'travail'];
    little.hooks.profileId = () => 'default';
    little.hooks.profileOfSpace = (id) => (id === 'esp-travail' ? 'travail' : null);
    little.hooks.spaces = () => [{ id: 'esp-travail', name: 'Travail', icon: '💼' }];
    const sent = [];
    little.hooks.openInOrbe = (url, spaceId) => sent.push([url, spaceId]);
    store.state.window.littleProfiles = {};
    const l3 = new LittleWindow('http://www.intranet.exemple.invalid/a');
    const first = l3.profileId;
    l3.openInSpace('esp-travail');
    await until(() => !LittleWindow.all.includes(l3), 'petite fenêtre envoyée');
    const l4 = new LittleWindow('http://intranet.exemple.invalid/autre');
    const l5 = new LittleWindow('http://ailleurs.exemple.invalid/');
    check('profil retenu par site : envoyée dans un Espace d’un autre profil, la petite fenêtre suivante du même site s’ouvre avec ce profil', first === 'default' && sent.length === 1 && l4.profileId === 'travail' && l5.profileId === 'default' && store.state.window.littleProfiles['intranet.exemple.invalid'] === 'travail', JSON.stringify([first, l4.profileId, l5.profileId, store.state.window.littleProfiles]));
    little.hooks.profiles = () => ['default'];
    check('profil retenu disparu, adresse d’Orbe ou sans site : profil de l’Espace affiché', little.rememberedProfile('http://intranet.exemple.invalid/') === null && little.rememberProfile('orbe://settings', 'travail') === false && little.rememberProfile('http://x.test/', { a: 1 }) === false && little.siteOf('file:///etc/hosts') === '');
    for (let i = 0; i < 230; i++) little.rememberProfile(`http://site${i}.test/`, 'default');
    check('profils retenus : 200 sites au plus, les plus anciens oubliés', Object.keys(store.state.window.littleProfiles).length === 200 && !('site0.test' in store.state.window.littleProfiles) && 'site229.test' in store.state.window.littleProfiles);

    for (const l of LittleWindow.all) l.win.close();
    await until(() => LittleWindow.all.length === 0, 'petites fenêtres fermées');
    Object.assign(little.hooks, saved.hooks);
    if (saved.seen === undefined) delete store.state.window.littleSeen; else store.state.window.littleSeen = saved.seen;
    if (saved.profiles === undefined) delete store.state.window.littleProfiles; else store.state.window.littleProfiles = saved.profiles;
  }

  // === Image dans l'image automatique, site par site =====================================
  {
    const t = (k, v) => store.t(k, null, v);
    const s = store.state.settings;
    const saved = { autoPip: s.autoPip, pipOffSites: s.pipOffSites };
    s.autoPip = true;
    s.pipOffSites = [];
    const tab = w.newTab('http://127.0.0.1:9/video');
    const rt = win.live.get(tab.id);
    await until(() => !rt.wc.isLoading(), 'onglet chargé');
    const url = 'https://Video.Exemple.test/regarder?v=1';
    const getURL = rt.wc.getURL;
    rt.wc.getURL = () => url;
    const asked = [];
    const run = rt.wc.executeJavaScript;
    rt.wc.executeJavaScript = (code) => { asked.push(code.includes('requestPictureInPicture') ? 'entrer' : 'sortir'); return Promise.resolve(); };
    const menu = () => w.pageMenuTemplate(rt, { x: 10, y: 10, mediaType: 'video', srcURL: '' });
    const box = () => menu().find((x) => x.label === t('ctx.pipAuto', { site: 'video.exemple.test' }));
    check('menu d’une vidéo : case « Automatique en quittant l’onglet, sur <site> », cochée par défaut', !!box() && box().type === 'checkbox' && box().checked === true);
    box().click();
    check('case décochée : le site est retenu, la case le montre', s.pipOffSites.join() === 'video.exemple.test' && box().checked === false && win.OrbeWindow.pipOff(url) && !win.OrbeWindow.pipOff('https://autre.test/'));
    delete rt.pip;
    w.pip(rt, true);
    const refused = asked.length === 0 && !('pip' in rt);
    w.pip(rt, false);
    check('site coupé : la vidéo n’y entre plus d’elle-même en image dans l’image ; en sortir reste permis', refused && asked.join() === 'sortir');
    box().click();
    w.pip(rt, true);
    check('case recochée : le site est oublié, la vidéo suit de nouveau', s.pipOffSites.length === 0 && asked.join() === 'sortir,entrer' && rt.pip === true);
    s.autoPip = false;
    check('réglage général coupé : la case par site n’est pas proposée', !box());
    s.autoPip = true;
    const prefs = require('../src/main/prefs');
    check('liste des sites : seuls des noms d’hôte, sans doublon, 200 au plus', prefs.SETTABLE.pipOffSites(['a.test', 'b.test']) && !prefs.SETTABLE.pipOffSites(['a.test', 'a.test']) && !prefs.SETTABLE.pipOffSites(['<script>']) && !prefs.SETTABLE.pipOffSites('a.test') && !prefs.SETTABLE.pipOffSites(Array.from({ length: 201 }, (_, i) => `s${i}.test`))
      && win.OrbeWindow.togglePipSite('orbe://settings') === false && win.OrbeWindow.pipSite('file:///x') === '');
    rt.wc.getURL = getURL;
    rt.wc.executeJavaScript = run;
    rt.pip = false;
    w.close(tab.id, { silent: true, ask: false });
    Object.assign(s, saved);
  }

  await sleep(30);
  return failed;
};
