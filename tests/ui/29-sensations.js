// Sensations : fichiers récents au survol de l'icône de la Bibliothèque (vraie
// souris : survol, clic, glisser hors d'Orbe, clic droit), mouvement et cadence
// du panneau, « Réduire les animations ».
// Les gestes du système (ouverture d'un fichier, glisser réel, menu natif) sont
// remplacés par des témoins dans le processus principal.
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const PROPS = `(a) => [...new Set(a.effect.getKeyframes().flatMap((k) => Object.keys(k)))].filter((k) => !['offset', 'easing', 'composite', 'computedOffset'].includes(k)).sort()`;
const HOSTILE = '<img src=x onerror="window.pwned=1"><b>gras</b>.txt';

module.exports = {
  nom: 'Sensations',
  async test(ctx, t) {
    const { shell, jusqua, sleep } = ctx;
    const reduit = await shell.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
    const animer = (titre, fn) => (reduit ? t.ignorer(titre, '« Réduire les animations » est actif') : t.avecEcran('verifier', titre, fn));
    const cdp = await shell.context().newCDPSession(shell);
    await cdp.send('Performance.enable');
    const compteurs = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
    const mesurer = async (ms) => {
      await shell.evaluate(() => { const p = (window.__img = { t: [], on: true }); const f = () => { p.t.push(performance.now()); if (p.on) requestAnimationFrame(f); }; requestAnimationFrame(f); });
      const avant = await compteurs();
      await sleep(ms);
      const apres = await compteurs();
      const t0 = await shell.evaluate(() => { window.__img.on = false; return window.__img.t; });
      const ecarts = t0.slice(1).map((x, i) => x - t0[i]).sort((a, b) => a - b);
      return { misesEnPage: apres.LayoutCount - avant.LayoutCount, images: ecarts.length, mediane: Math.round(ecarts[Math.floor(ecarts.length / 2)] * 10) / 10, p95: Math.round(ecarts[Math.floor(ecarts.length * 0.95)] * 10) / 10 };
    };

    await ctx.ouvrir('/a', 'Page A');

    // --- Fichiers récents -----------------------------------------------------------
    const dossier = path.join(ctx.userData, 'recents-essai');
    fs.mkdirSync(dossier, { recursive: true });
    for (const n of ['hostile.txt', 'photo.png', 'capture.png', 'rapport.pdf']) fs.writeFileSync(path.join(dossier, n), 'contenu de ' + n);
    await ctx.principal(({ req, store }, a) => {
      const rec = (file, name, extra = {}) => ({ id: 'r-' + file, name, path: a.dir + '/' + file, url: 'https://fichiers.exemple.fr/' + file, total: 20, received: 20, state: 'completed', at: Date.now() - 3 * 60e3, profile: 'default', marked: true, ...extra });
      store.state.downloads = [rec('hostile.txt', a.hostile), rec('photo.png', 'photo.png'), rec('capture.png', 'Orbe 2026-10-09.png', { capture: true, url: '' }), rec('rapport.pdf', 'rapport.pdf', { at: Date.now() - 26 * 3600e3 }), rec('absent.txt', 'absent.txt')];
      const downloads = req('downloads.js');
      const library = req('library.js');
      global.__recents = { ouverts: [], glisses: [], menus: [], choix: null };
      downloads.env.openPath = (f) => { global.__recents.ouverts.push(f); };
      downloads.env.openInTab = () => false;
      library.env.startDrag = (wc, item) => { global.__recents.glisses.push({ file: item.file, icone: !item.icon.isEmpty(), coque: wc.getURL().includes('shell.html') }); };
      library.env.popup = (w, tpl) => {
        global.__recents.menus.push(tpl.map((x) => (x.type === 'separator' ? '-' : x.label + (x.type === 'checkbox' ? (x.checked ? ' ✓' : ' ·') : ''))).join('|'));
        const it = tpl.find((x) => x.label === global.__recents.choix);
        if (it) it.click();
      };
    }, { dir: dossier.split(path.sep).join('/'), hostile: HOSTILE });
    const temoin = () => ctx.principal(() => global.__recents);
    const icone = shell.locator('#b-library');
    const panneau = shell.locator('#lib-peek');
    const fiche = (nom) => panneau.locator('.lp-row').filter({ has: shell.locator('.lp-name', { hasText: nom }) }).first();
    // Vrai survol : le pointeur de la personne assise devant ce Mac peut traverser la fenêtre ; on réessaie.
    const survoler = () => jusqua(async () => { await icone.hover(); await sleep(60); return (await panneau.count()) === 1 && !(await panneau.evaluate((el) => el.classList.contains('out'))); }, 'panneau des fichiers récents', 8000);
    const quitter = async () => { await shell.mouse.move(700, 300); await jusqua(async () => (await panneau.count()) === 0, 'panneau refermé'); };
    const posee = () => jusqua(() => panneau.evaluate((el) => !el.getAnimations({ subtree: true }).some((a) => a.playState === 'running')), 'panneau posé');

    await t.verifier('survol de l’icône de la Bibliothèque : après un court instant, les fichiers récents paraissent juste au-dessus, dans la barre', async () => {
      await shell.mouse.move(700, 300);
      await icone.hover();
      assert.equal(await panneau.count(), 0, 'rien avant le délai de survol');
      await survoler();
      await posee();
      const vu = await shell.evaluate(() => {
        const p = document.getElementById('lib-peek').getBoundingClientRect();
        const s = document.getElementById('sidebar').getBoundingClientRect();
        const b = document.getElementById('bottom').getBoundingClientRect();
        return { noms: [...document.querySelectorAll('#lib-peek .lp-name')].map((e) => e.textContent), subs: [...document.querySelectorAll('#lib-peek .lp-sub')].map((e) => e.textContent), dedans: p.left >= s.left && p.right <= s.right && p.top >= 0, ecart: Math.round(b.top - p.bottom), tete: document.querySelector('#lib-peek .lp-head span').textContent };
      });
      assert.deepEqual(vu.noms, [HOSTILE, 'photo.png', 'Orbe 2026-10-09.png', 'rapport.pdf'], 'fichier absent du disque : pas montré');
      assert.equal(vu.tete, 'Récents');
      assert.ok(vu.dedans, 'le panneau tient dans la barre latérale');
      assert.ok(vu.ecart >= 0 && vu.ecart <= 12, 'juste au-dessus de la rangée du bas : ' + vu.ecart);
      assert.match(vu.subs[0], /^Téléchargements · /);
      assert.match(vu.subs[1], /^Médias · /);
      assert.match(vu.subs[2], /^Captures · /);
      assert.match(vu.subs[3], /hier|1 j/);
    });

    await t.verifier('nom de fichier hostile : posé comme du texte, aucune balise n’en naît, rien ne s’exécute', async () => {
      const vu = await shell.evaluate(() => ({ enfants: [...document.querySelectorAll('#lib-peek .lp-name')].reduce((n, e) => n + e.childElementCount, 0), images: document.querySelectorAll('#lib-peek img, #lib-peek b').length, pwned: window.pwned === 1 }));
      assert.deepEqual(vu, { enfants: 0, images: 0, pwned: false });
    });

    await t.verifier('le pointeur passe de l’icône au panneau : il reste ouvert ; il s’en va : le panneau se referme', async () => {
      await fiche('photo.png').hover();
      await sleep(400);
      assert.equal(await panneau.count(), 1);
      assert.equal(await panneau.evaluate((el) => el.classList.contains('out')), false);
      await quitter();
      assert.equal(await icone.evaluate((el) => el.classList.contains('peeking')), false);
    });

    await animer('le panneau paraît au ressort et se retire en 120 ms : transformation et opacité seulement, cadence tenue, sans mise en page par image', async () => {
      await ctx.vitesseAnimations(0.25);
      try {
        await icone.hover();
        const a = await jusqua(() => shell.evaluate(`(() => { const el = document.getElementById('lib-peek'); const a = el && el.getAnimations()[0]; const r = el && el.querySelector('.lp-row'); const b = r && r.getAnimations().find((x) => x.animationName === 'lp-row'); return a && b ? { nom: a.animationName, props: (${PROPS})(a), duree: a.effect.getTiming().duration, ligne: (${PROPS})(b), dureeLigne: b.effect.getTiming().duration } : null; })()`), 'panneau en cours d’apparition', 8000);
        assert.deepEqual(a, { nom: 'lp-in', props: ['opacity', 'transform'], duree: 340, ligne: ['opacity', 'transform'], dureeLigne: 240 });
        const m = await mesurer(700);
        console.log(`    fichiers récents (apparition) : ${m.images} images, médiane ${m.mediane} ms, 95e centile ${m.p95} ms, ${m.misesEnPage} mise(s) en page`);
        assert.ok(m.misesEnPage <= 1, 'mises en page pendant l’apparition : ' + m.misesEnPage);
        assert.ok(m.mediane < 34, 'cadence médiane : ' + m.mediane);
        await posee();
        await shell.mouse.move(700, 300);
        const s = await jusqua(() => shell.evaluate(`(() => { const el = document.querySelector('#lib-peek.out'); const a = el && el.getAnimations().find((x) => x.animationName === 'lp-out'); return a ? { props: (${PROPS})(a), duree: a.effect.getTiming().duration, clic: getComputedStyle(el).pointerEvents } : null; })()`), 'panneau qui se retire', 8000);
        assert.deepEqual(s, { props: ['opacity', 'transform'], duree: 120, clic: 'none' });
      } finally { await ctx.vitesseAnimations(1); }
      await jusqua(async () => (await panneau.count()) === 0, 'panneau retiré');
    });

    await t.verifier('clic sur une fiche : le fichier s’ouvre, le panneau se referme', async () => {
      await survoler();
      await posee();
      await ctx.clic(shell, fiche('photo.png'));
      await jusqua(async () => (await temoin()).ouverts.length === 1, 'fichier ouvert');
      assert.equal(path.basename((await temoin()).ouverts[0]), 'photo.png');
      await jusqua(async () => (await panneau.count()) === 0, 'panneau refermé');
    });

    await t.verifier('glisser une fiche à la souris : le système reçoit le vrai fichier (glisser hors d’Orbe), la barre latérale ne déplace rien', async () => {
      await shell.mouse.move(700, 300);
      await survoler();
      await posee();
      const avant = await ctx.titres();
      const box = await fiche('rapport.pdf').boundingBox();
      const m = shell.mouse;
      await m.move(box.x + 40, box.y + box.height / 2);
      await m.down();
      const geste = (async () => { await m.move(box.x + 60, box.y - 30, { steps: 4 }); await m.move(box.x + 420, box.y - 200, { steps: 6 }); await m.up(); })();
      // Le glisser est repris par le système (ici, par le témoin) : la page l'annule, la souris peut rester en attente.
      await ctx.delai(geste, 5000, 'début du glisser').catch(() => {});
      await jusqua(async () => (await temoin()).glisses.length >= 1, 'glisser confié au système');
      const g = (await temoin()).glisses[0];
      assert.equal(path.basename(g.file), 'rapport.pdf');
      assert.equal(g.icone, true, 'une icône accompagne le fichier');
      assert.equal(g.coque, true, 'le glisser part de la barre latérale');
      assert.deepEqual(await ctx.titres(), avant);
      assert.equal(await shell.evaluate(() => document.body.classList.contains('dragging')), false, 'pas de glisser de ligne dans la barre');
      await m.up().catch(() => {});
      await shell.mouse.move(700, 300);
      await jusqua(async () => (await panneau.count()) === 0, 'panneau refermé');
    });

    await t.verifier('clic droit sur l’icône : menu des sortes montrées ; « Téléchargements » décoché, le survol ne montre plus que médias et captures', async () => {
      await ctx.principal(() => { global.__recents.choix = 'Téléchargements'; });
      await icone.click({ button: 'right' });
      await jusqua(async () => (await temoin()).menus.length === 1, 'menu ouvert');
      assert.equal((await temoin()).menus[0], 'Au survol, montrer|Captures ✓|Téléchargements ✓|Médias ✓|-|Ouvrir la Bibliothèque');
      assert.equal(await panneau.count(), 0, 'le clic droit n’ouvre pas le panneau');
      await shell.mouse.move(700, 300);
      await survoler();
      assert.deepEqual(await panneau.locator('.lp-name').allTextContents(), ['photo.png', 'Orbe 2026-10-09.png']);
      await quitter();
      // Remis : les trois sortes.
      await icone.click({ button: 'right' });
      await jusqua(async () => (await temoin()).menus.length === 2, 'menu rouvert');
      assert.equal((await temoin()).menus[1], 'Au survol, montrer|Captures ✓|Téléchargements ·|Médias ✓|-|Ouvrir la Bibliothèque');
      await ctx.principal(() => { global.__recents.choix = null; });
    });

    await t.verifier('« Réduire les animations » : le panneau paraît et se retire sans mouvement', async () => {
      await shell.emulateMedia({ reducedMotion: 'reduce' });
      try {
        await shell.mouse.move(700, 300);
        await survoler();
        const d = await shell.evaluate(() => { const el = document.getElementById('lib-peek'); return [el, ...el.querySelectorAll('.lp-row')].map((e) => parseFloat(getComputedStyle(e).animationDuration) * 1000).reduce((a, b) => Math.max(a, b), 0); });
        assert.ok(d <= 0.011, 'durée la plus longue : ' + d + ' ms');
        await posee();
        assert.equal(await fiche('photo.png').evaluate((el) => getComputedStyle(el).opacity), '1');
        await quitter();
      } finally { await shell.emulateMedia({ reducedMotion: null }); }
    });

    await t.verifier('Échap referme le panneau ; un clic sur l’icône ouvre la Bibliothèque, comme avant', async () => {
      await shell.mouse.move(700, 300);
      await survoler();
      await shell.keyboard.press('Escape');
      await jusqua(async () => (await panneau.count()) === 0, 'panneau refermé par Échap');
      await shell.mouse.move(700, 300);
      await survoler();
      await ctx.clic(shell, '#b-library');
      const lib = await ctx.attendrePage('library.html');
      assert.ok(lib);
      await jusqua(async () => (await panneau.count()) === 0, 'panneau refermé par le clic');
    });

    // --- Icônes animées des sections de la Bibliothèque ---------------------------------
    const lib = await ctx.attendrePage('library.html');
    lib.setDefaultTimeout(6000);
    const NOMS = { history: 'ti-clock', archive: 'ti-lid', downloads: 'ti-drop', media: 'ti-rise', easels: 'ti-sway', spaces: 'ti-hop', boosts: 'ti-zap' };
    const mouvement = (nom) => lib.evaluate(`(() => { const b = document.querySelector('.tabs [data-tab="${nom}"]'); const as = b.getAnimations({ subtree: true }).filter((a) => a.animationName); return { noms: [...new Set(as.map((a) => a.animationName))].sort(), props: [...new Set(as.flatMap(${PROPS}))].sort(), duree: Math.max(0, ...as.map((a) => a.effect.getTiming().duration)), enCours: as.some((a) => a.playState === 'running') }; })()`);

    await t.verifier('Bibliothèque : chaque section porte son icône, le libellé reste du texte, la rangée tient dans la page', async () => {
      await jusqua(() => lib.evaluate(() => document.querySelectorAll('.tabs [data-tab].on').length === 1), 'section choisie');
      if (process.env.ORBE_UI_SHOTS) await ctx.capture('bibliotheque-icones', lib);
      const vu = await lib.evaluate(() => { const bs = [...document.querySelectorAll('.tabs [data-tab]')]; return { icones: bs.filter((b) => b.querySelector('svg.ti')).length, textes: bs.map((b) => b.textContent), hauts: [...new Set([...document.querySelectorAll('.tabs button')].map((b) => Math.round(b.getBoundingClientRect().top)))].length, large: document.documentElement.scrollWidth <= innerWidth }; });
      assert.equal(vu.icones, 7);
      assert.deepEqual(vu.textes, ['Historique', 'Archive', 'Téléchargements', 'Médias', 'Tableaux', 'Espaces', 'Boosts']);
      assert.ok(vu.hauts <= 2, 'deux lignes de boutons au plus : ' + vu.hauts);
      assert.ok(vu.large);
    });

    await animer('survol d’une section : son icône s’anime une fois, en transformations et opacité seulement ; chacune a son mouvement', async () => {
      await ctx.vitesseAnimations(0.25);
      const vitesse = await lib.context().newCDPSession(lib);
      await vitesse.send('Animation.enable');
      await vitesse.send('Animation.setPlaybackRate', { playbackRate: 0.25 });
      try {
        for (const [nom, anim] of Object.entries(NOMS)) {
          if (await lib.locator(`.tabs [data-tab="${nom}"].on`).count()) continue; // la section affichée a déjà joué la sienne
          await lib.mouse.move(600, 500);
          await lib.locator(`.tabs [data-tab="${nom}"]`).hover();
          const m = await jusqua(async () => { const x = await mouvement(nom); return x.enCours ? x : null; }, 'icône en mouvement : ' + nom);
          assert.ok(m.noms.includes(anim), nom + ' : ' + m.noms.join());
          assert.ok(m.props.every((p) => p === 'transform' || p === 'opacity'), nom + ' : ' + m.props.join());
          assert.ok(m.duree >= 300 && m.duree <= 700, nom + ' : ' + m.duree + ' ms');
        }
        await lib.mouse.move(600, 500);
        await lib.locator('.tabs [data-tab="boosts"]').click();
        await lib.mouse.move(600, 500);
        const choisi = await jusqua(async () => { const x = await mouvement('boosts'); return x.noms.includes('ti-zap') ? x : null; }, 'icône de la section choisie');
        assert.deepEqual(choisi.props, ['transform']);
        assert.equal(await lib.locator('.tabs [data-tab="boosts"] .ti').evaluate((el) => getComputedStyle(el).color !== getComputedStyle(document.querySelector('.tabs [data-tab="spaces"] .ti')).color), true, 'icône choisie à la couleur d’accent');
      } finally { await vitesse.send('Animation.setPlaybackRate', { playbackRate: 1 }); await ctx.vitesseAnimations(1); }
    });

    await t.verifier('« Réduire les animations » : les icônes des sections ne bougent plus', async () => {
      await lib.emulateMedia({ reducedMotion: 'reduce' });
      try {
        await lib.mouse.move(600, 500);
        await lib.locator('.tabs [data-tab="archive"]').hover();
        const d = await lib.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.tabs [data-tab="archive"] .m')).animationDuration) * 1000);
        assert.ok(d <= 0.011, 'durée : ' + d + ' ms');
      } finally { await lib.emulateMedia({ reducedMotion: null }); await lib.mouse.move(600, 500); }
    });

    // --- Barre translucide : texte lisible sur le fond tel qu'il s'affiche -----------------
    await t.verifier('barre translucide, thème gris moyen : titres et texte discret gardent 4,5 de contraste sur le fond affiché, quel que soit l’arrière-plan', async () => {
      const Theme = require('../../src/renderer/theme');
      const avant = await ctx.principal(({ w, store }) => { const sp = w.space; const a = { translucent: store.state.settings.translucent, theme: { colors: [sp.color, sp.color2, sp.color3].filter(Boolean), intensity: sp.intensity, grain: sp.grain || 0, texture: sp.texture || 'grain', mode: sp.mode || 'auto' } }; store.state.settings.translucent = true; w.setTheme({ colors: ['#8a8f98'], intensity: 0.9, grain: 0, texture: 'grain', mode: 'light' }); return a; });
      try {
        const sombre = await ctx.principal(({ electron }) => electron.nativeTheme.shouldUseDarkColors);
        const vu = await jusqua(() => shell.evaluate(() => {
          const cs = getComputedStyle(document.body);
          if (!document.body.classList.contains('translucent') || !/0\.8\)$/.test(cs.getPropertyValue('--paint').trim())) return null;
          const nombres = (c) => c.match(/[\d.]+/g).map(Number);
          const titre = document.querySelector('#today .row.tab .title');
          const discret = document.getElementById('space-name');
          return { fond: nombres(cs.getPropertyValue('--paint')), titre: nombres(getComputedStyle(titre).color), discret: nombres(getComputedStyle(discret).color) };
        }), 'barre translucide peinte');
        assert.equal(vu.fond[3], 0.8, 'fond peint à 80 % d’opacité');
        for (const derriere of Theme.BACKDROP[sombre ? 'dark' : 'light']) {
          const fond = Theme.over(vu.fond.slice(0, 3), 0.8, derriere);
          for (const [nom, c] of [['titre', vu.titre], ['texte discret', vu.discret]]) {
            const texte = Theme.over(c.slice(0, 3), c.length > 3 ? c[3] : 1, fond);
            const k = Theme.contrast(texte, fond);
            assert.ok(k >= 4.5, `${nom} sur un arrière-plan ${derriere.join(',')} : contraste ${k.toFixed(2)}`);
          }
        }
      } finally {
        await ctx.principal(({ w, store, win }, a) => { store.state.settings.translucent = a.translucent; w.setTheme(a.theme); win.OrbeWindow.pushAll(); }, avant);
      }
    });

    // --- Accueil : la vague du logo, le bouton de la musique --------------------------------
    await ctx.principal(({ w }) => { w.openInternal('welcome.html'); });
    const accueil = await ctx.attendrePage('welcome.html');
    accueil.setDefaultTimeout(6000);
    await jusqua(() => accueil.evaluate(() => typeof music === 'object' && music.asked === true), 'accueil chargé');
    const mouvements = () => accueil.evaluate(`(() => { const de = (sel) => [...document.querySelectorAll(sel)].flatMap((el) => el.getAnimations().map((a) => ({ nom: a.animationName, props: (${PROPS})(a), duree: a.effect.getTiming().duration, retard: a.effect.getTiming().delay }))); return { vagues: de('.orb .wave'), anneau: de('.orb .mark i'), halo: de('.orb .halo').map((x) => x.nom).sort() }; })()`);

    await animer('accueil : trois anneaux partent du logo l’un après l’autre, l’anneau blanc s’enroule puis respire, le halo de couleurs tourne — transformations et opacité seulement', async () => {
      await accueil.reload();
      await jusqua(() => accueil.evaluate(() => typeof music === 'object' && document.querySelectorAll('.orb .wave').length === 3), 'accueil rechargé');
      const m = await mouvements();
      assert.deepEqual(m.vagues, [260, 520, 780].map((retard) => ({ nom: 'wave', props: ['opacity', 'transform'], duree: 1800, retard })));
      assert.deepEqual(m.anneau.map((x) => x.nom).sort(), ['ring-breathe', 'ring-in']);
      assert.ok(m.anneau.every((x) => x.props.every((p) => p === 'opacity' || p === 'transform')), JSON.stringify(m.anneau));
      assert.deepEqual(m.halo, ['halo-in', 'turn']);
      const cdpA = await accueil.context().newCDPSession(accueil);
      await cdpA.send('Performance.enable');
      const lire = async () => Object.fromEntries((await cdpA.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
      await accueil.evaluate(() => { const p = (window.__img = { t: [], on: true }); const f = () => { p.t.push(performance.now()); if (p.on) requestAnimationFrame(f); }; requestAnimationFrame(f); });
      const avant = await lire();
      await sleep(1200);
      const apres = await lire();
      const t0 = await accueil.evaluate(() => { window.__img.on = false; return window.__img.t; });
      const ecarts = t0.slice(1).map((x, i) => x - t0[i]).sort((x, y) => x - y);
      const mediane = Math.round(ecarts[Math.floor(ecarts.length / 2)] * 10) / 10;
      const p95 = Math.round(ecarts[Math.floor(ecarts.length * 0.95)] * 10) / 10;
      console.log(`    accueil (vague, anneau, halo) : ${ecarts.length} images, médiane ${mediane} ms, 95e centile ${p95} ms, ${apres.LayoutCount - avant.LayoutCount} mise(s) en page`);
      assert.ok(apres.LayoutCount - avant.LayoutCount <= 1, 'mises en page : ' + (apres.LayoutCount - avant.LayoutCount));
      assert.ok(mediane < 34, 'cadence médiane : ' + mediane);
    });

    await t.verifier('accueil : le bouton de la musique se voit, un vrai clic la coupe, un second la remet', async () => {
      const bouton = accueil.locator('#music');
      assert.equal(await bouton.isVisible(), true);
      if (process.env.ORBE_UI_SHOTS) { await sleep(1500); await ctx.capture('accueil', accueil); }
      assert.equal(await bouton.getAttribute('aria-pressed'), 'true');
      await bouton.click();
      assert.equal(await bouton.getAttribute('aria-pressed'), 'false');
      assert.equal(await accueil.evaluate(() => getComputedStyle(document.querySelector('#music .off')).display !== 'none' && getComputedStyle(document.querySelector('#music .on')).display === 'none'), true, 'haut-parleur barré');
      assert.equal(await accueil.evaluate(() => music.audio.paused), true);
      await bouton.click();
      assert.equal(await bouton.getAttribute('aria-pressed'), 'true');
    });

    await t.verifier('accueil, « Réduire les animations » : ni vague ni anneau en mouvement', async () => {
      await accueil.emulateMedia({ reducedMotion: 'reduce' });
      try {
        const m = await accueil.evaluate(() => ({ vagues: [...document.querySelectorAll('.orb .wave')].filter((el) => getComputedStyle(el).display !== 'none').length, anneau: getComputedStyle(document.querySelector('.orb .mark i')).animationName, halo: getComputedStyle(document.querySelector('.orb .halo')).animationName }));
        assert.deepEqual(m, { vagues: 0, anneau: 'none', halo: 'none' });
      } finally { await accueil.emulateMedia({ reducedMotion: null }); }
    });

    await t.verifier('aucune sorte cochée, ou rien de récent : le survol ne montre rien', async () => {
      await ctx.principal(({ store }) => { store.state.downloads = []; });
      await shell.mouse.move(700, 300);
      await icone.hover();
      await sleep(900);
      assert.equal(await panneau.count(), 0);
      await shell.mouse.move(700, 300);
    });
  },
};
