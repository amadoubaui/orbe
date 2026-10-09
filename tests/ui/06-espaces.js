// Espaces : création, passage de l'un à l'autre par les pastilles du bas et
// par balayage horizontal (molette) sur la barre latérale.
const assert = require('node:assert/strict');

module.exports = {
  nom: 'Espaces',
  async test(ctx, t) {
    const { shell, jusqua } = ctx;
    const pastilles = shell.locator('#spaces .sp');
    const nom = () => shell.textContent('#space-name');
    const active = () => pastilles.evaluateAll((els) => els.findIndex((el) => el.classList.contains('active')));
    // Balayage horizontal : plusieurs crans de molette, comme un geste à deux doigts.
    const balayer = async (dx, dy = 0) => {
      const c = await ctx.centre(shell.locator('#scroll'));
      await shell.mouse.move(c.x, c.y);
      for (let i = 0; i < 4; i++) { await shell.mouse.wheel(dx, dy); await ctx.sleep(16); }
    };
    // Balayage lent : petits crans espacés, les doigts restent posés.
    const glisser = async (dx, crans) => {
      const c = await ctx.centre(shell.locator('#scroll'));
      await shell.mouse.move(c.x, c.y);
      for (let i = 0; i < crans; i++) { await shell.mouse.wheel(dx, 0); await ctx.sleep(25); }
    };
    // Où en sont les deux listes (celle de l'Espace courant et l'image de l'autre) et la teinte.
    const listes = () => shell.evaluate(() => {
      const x = (el) => new DOMMatrix(getComputedStyle(el).transform).m41;
      const g = document.querySelector('#pager .ghost');
      /* global slide */
      return {
        phase: slide ? slide.phase : null,
        courante: x(document.getElementById('scroll')),
        autre: g ? x(g) : null,
        autreNom: g ? g.querySelector('.g-name').textContent : null,
        autreTitres: g ? [...g.querySelectorAll('.row.tab .title')].map((el) => el.textContent) : [],
        largeur: document.getElementById('pager').clientWidth,
        teinte: Number(getComputedStyle(document.getElementById('tint')).opacity),
      };
    });
    const repos = () => jusqua(async () => { const l = await listes(); return !l.phase && l.autre === null && l.courante === 0 && l.teinte === 0; }, 'listes au repos');
    const anime = !(await shell.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches));
    const animer = (titre, fn) => (anime ? t.verifier(titre, fn) : t.ignorer(titre, '« Réduire les animations » est actif'));

    await ctx.ouvrir('/a', 'Page A');

    await t.verifier('avec un seul Espace, aucune pastille en bas', async () => {
      assert.equal(await pastilles.count(), 0);
      assert.equal(await nom(), 'Personnel');
    });

    await t.verifier('« Nouvel Espace » (élément de menu) : nouvel Espace affiché, vide, prêt à être nommé', async () => {
      await ctx.menu('spaces.new');
      await jusqua(() => shell.locator('#space-name input.rename').count(), 'champ de nom de l’Espace');
      assert.equal(await shell.locator('#space-name input.rename').inputValue(), 'Nouvel Espace');
      await shell.keyboard.type('Projets', { delay: 10 });
      await shell.keyboard.press('Enter');
      await jusqua(async () => (await nom()) === 'Projets', 'nom affiché');
      assert.deepEqual(await ctx.titres(), []);
      assert.equal(await shell.evaluate(() => document.body.classList.contains('no-tab')), true);
      assert.deepEqual((await ctx.etat()).espaces.map((s) => s.nom), ['Personnel', 'Projets']);
    });

    await t.verifier('deux pastilles en bas, la seconde active, chacune avec son nom en infobulle', async () => {
      assert.equal(await pastilles.count(), 2);
      assert.equal(await active(), 1);
      assert.deepEqual(await pastilles.evaluateAll((els) => els.map((el) => el.title)), ['Personnel', 'Projets']);
    });

    await t.verifier('la couleur d’accent change avec l’Espace', async () => {
      const c2 = await shell.evaluate(() => document.body.style.getPropertyValue('--accent'));
      assert.match(c2, /^#[0-9a-f]{6}$/i);
      assert.notEqual(c2.toLowerCase(), '#7c6cf0');
    });

    await ctx.ouvrir('/b', 'Page B');

    await t.verifier('clic sur la première pastille : retour au premier Espace et à son onglet', async () => {
      await ctx.clic(shell, pastilles.nth(0));
      await jusqua(async () => (await nom()) === 'Personnel', 'Espace Personnel');
      assert.deepEqual(await ctx.titres(), ['Page A']);
      assert.equal(await active(), 0);
      const e = await ctx.etat();
      assert.equal(e.actifUrl, ctx.url('/a'));
      assert.equal(await ctx.vueAu(e.vuePage.x + 40, e.vuePage.y + 40), ctx.url('/a'), 'la page A est affichée');
      assert.equal(await shell.evaluate(() => document.body.style.getPropertyValue('--accent').toLowerCase()), '#7c6cf0');
    });

    await t.verifier('clic sur la seconde pastille : second Espace et son onglet', async () => {
      await ctx.clic(shell, pastilles.nth(1));
      await jusqua(async () => (await nom()) === 'Projets', 'Espace Projets');
      assert.deepEqual(await ctx.titres(), ['Page B']);
      const e = await ctx.etat();
      assert.equal(await ctx.vueAu(e.vuePage.x + 40, e.vuePage.y + 40), ctx.url('/b'), 'la page B est affichée');
    });

    await animer('clic sur une pastille : les deux listes glissent côte à côte, dans le sens du changement', async () => {
      await repos();
      // Vers l'Espace précédent : sa liste entre par la gauche, la liste courante sort par la droite.
      await ctx.clic(shell, pastilles.nth(0));
      const vers = await jusqua(async () => { const l = await listes(); return l.autre !== null ? l : null; }, 'glissement en cours');
      assert.equal(vers.autreNom, 'Personnel');
      assert.deepEqual(vers.autreTitres, ['Page A']);
      assert.ok(vers.autre <= 0 && vers.courante >= 0, JSON.stringify(vers));
      assert.ok(Math.abs((vers.courante - vers.autre) - vers.largeur) < 1.5, 'les deux listes se touchent : ' + JSON.stringify(vers));
      assert.equal(await active(), 0, 'la pastille change dès le départ');
      await jusqua(async () => (await nom()) === 'Personnel', 'Espace Personnel');
      await repos();
      assert.deepEqual(await ctx.titres(), ['Page A']);
      // Vers l'Espace suivant : l'inverse.
      await ctx.clic(shell, pastilles.nth(1));
      const retour = await jusqua(async () => { const l = await listes(); return l.autre !== null ? l : null; }, 'glissement en cours');
      assert.equal(retour.autreNom, 'Projets');
      assert.ok(retour.autre >= 0 && retour.courante <= 0, JSON.stringify(retour));
      await jusqua(async () => (await nom()) === 'Projets', 'Espace Projets');
      await repos();
      assert.deepEqual(await ctx.titres(), ['Page B']);
    });

    await animer('balayage lent : la liste voisine suit les doigts, la teinte se fond ; doigts levés avant le seuil, tout revient', async () => {
      // Le pilotage peut prendre du retard sur une machine chargée (les doigts
      // sont alors « levés » trop tôt) : on recommence le geste.
      let l = null;
      await jusqua(async () => {
        await repos();
        await glisser(-8, 4);
        l = await listes();
        if (l.phase === 'drag' && l.courante === 32) return true;
        await ctx.sleep(500);
        return false;
      }, 'balayage lent suivi', 15000);
      assert.equal(l.autreNom, 'Personnel');
      assert.deepEqual(l.autreTitres, ['Page A']);
      assert.equal(l.autre, 32 - l.largeur, 'la liste voisine est collée à la liste courante');
      assert.ok(Math.abs(l.teinte - 32 / l.largeur) < 0.02, 'teinte au même pas : ' + l.teinte);
      await repos();
      assert.equal(await nom(), 'Projets');
      assert.equal(await active(), 1);
      assert.deepEqual(await ctx.titres(), ['Page B']);
    });

    await animer('balayage lent au bout de la rangée : la liste résiste (élastique) puis revient', async () => {
      let l = null;
      await jusqua(async () => {
        await repos();
        await glisser(10, 6);
        l = await listes();
        if (l.phase === 'drag') return true;
        await ctx.sleep(500);
        return false;
      }, 'balayage au bout de la rangée', 15000);
      assert.equal(l.autre, null, 'aucune liste à côté');
      assert.ok(l.courante < -5 && l.courante > -45, 'déplacement amorti : ' + l.courante + ' px pour 60 px de geste');
      assert.equal(l.teinte, 0);
      await repos();
      assert.equal(await nom(), 'Projets');
    });

    await animer('balayage lent poursuivi au-delà du seuil : l’Espace change, une seule fois', async () => {
      await repos();
      await jusqua(async () => {
        await glisser(-10, 14);
        if ((await ctx.etat()).espace === 'Personnel') return true;
        await ctx.sleep(500);
        return false;
      }, 'changement par balayage lent', 15000);
      await jusqua(async () => (await nom()) === 'Personnel', 'Espace Personnel');
      await repos();
      assert.equal(await active(), 0);
      assert.deepEqual(await ctx.titres(), ['Page A']);
      await ctx.sleep(400);
      await ctx.clic(shell, pastilles.nth(1));
      await jusqua(async () => (await nom()) === 'Projets', 'Espace Projets');
      await repos();
      await ctx.sleep(300);
    });

    await t.verifier('balayage horizontal vers la gauche sur la barre latérale : Espace précédent', async () => {
      await balayer(-40);
      await jusqua(async () => (await nom()) === 'Personnel', 'Espace Personnel');
      assert.deepEqual(await ctx.titres(), ['Page A']);
    });

    await t.verifier('un seul changement par geste, même si le balayage continue', async () => {
      await ctx.sleep(400);
      const c = await ctx.centre(shell.locator('#scroll'));
      await shell.mouse.move(c.x, c.y);
      for (let i = 0; i < 12; i++) { await shell.mouse.wheel(40, 0); await ctx.sleep(16); }
      await jusqua(async () => (await nom()) === 'Projets', 'Espace Projets');
      await ctx.sleep(300);
      assert.equal(await nom(), 'Projets');
      assert.equal(await active(), 1);
    });

    await t.verifier('balayage au-delà du dernier Espace : rien ne change', async () => {
      await ctx.sleep(400);
      await balayer(40);
      await ctx.sleep(300);
      assert.equal(await nom(), 'Projets');
    });

    await t.verifier('défilement vertical : ne change pas d’Espace', async () => {
      await ctx.sleep(400);
      await balayer(0, 60);
      await balayer(10, 60);
      await ctx.sleep(300);
      assert.equal(await nom(), 'Projets');
    });

    await animer('tirer franchement au-delà du dernier Espace : un « + » sort du bord et grandit ; au bout, un nouvel Espace est créé — un seul', async () => {
      await ctx.sleep(400);
      await repos();
      const plus = () => shell.evaluate(() => { const el = document.querySelector('#pager .pager-plus'); if (!el) return null; const cs = getComputedStyle(el); const m = new DOMMatrix(cs.transform); return { p: Number(el.dataset.p), opacite: Number(cs.opacity), x: m.m41, echelle: Math.round(m.a * 100) / 100, pos: cs.position }; });
      const c = await ctx.centre(shell.locator('#scroll'));
      await shell.mouse.move(c.x, c.y);
      // Début du geste : le « + » paraît, petit et pâle, et grandit à chaque pas.
      const vus = [];
      for (let i = 0; i < 3; i++) { await shell.mouse.wheel(30, 0); await ctx.sleep(16); vus.push(await plus()); }
      assert.ok(vus.every((v) => v && v.pos === 'absolute'), 'pastille présente dès le premier pas : ' + JSON.stringify(vus));
      assert.ok(vus[2].p > vus[1].p && vus[1].p > vus[0].p && vus[2].p < 1 && vus[2].echelle > vus[0].echelle && vus[2].x < vus[0].x && vus[2].opacite > vus[0].opacite, 'elle avance et grandit avec le geste : ' + JSON.stringify(vus));
      assert.equal((await ctx.etat()).espaces.length, 2, 'rien n’est créé avant le bout');
      // Le geste continue, franc : au bout, le nouvel Espace ; la suite du geste (inertie) n'en crée pas d'autre.
      for (let i = 0; i < 14; i++) { await shell.mouse.wheel(40, 0); await ctx.sleep(16); }
      await jusqua(async () => (await ctx.etat()).espaces.length === 3, 'nouvel Espace créé');
      await jusqua(() => shell.locator('#space-name input.rename').count(), 'champ de nom du nouvel Espace');
      await ctx.sleep(300);
      const e = await ctx.etat();
      assert.equal(e.espaces.length, 3, 'un seul Espace créé');
      assert.equal(e.espaces[2].nom, e.espace, 'il est affiché, à la suite du dernier');
      assert.equal(await shell.locator('#pager .pager-plus').count(), 0, 'la pastille est retirée');
      // Remise en place : l'Espace d'essai est supprimé.
      await shell.keyboard.press('Escape');
      await ctx.principal(({ w }) => { w.removeSpace(w.space.id); });
      await jusqua(async () => (await ctx.etat()).espaces.length === 2 && (await pastilles.count()) === 2, 'Espace d’essai retiré');
      await ctx.menu('Ctrl+2');
      await jusqua(async () => (await nom()) === 'Projets', 'Espace Projets');
      await repos();
    });

    await t.verifier('⌥⌘← et ⌃1/⌃2 (éléments de menu) changent d’Espace', async () => {
      await ctx.menu('Alt+Cmd+Left');
      await jusqua(async () => (await nom()) === 'Personnel', 'Espace Personnel');
      await ctx.menu('Ctrl+2');
      await jusqua(async () => (await nom()) === 'Projets', 'Espace Projets');
      await ctx.menu('Ctrl+1');
      await jusqua(async () => (await nom()) === 'Personnel', 'Espace Personnel');
    });

    await ctx.capture('espaces');

    // Beaucoup d'Espaces : toutes les pastilles doivent rester atteignables.
    for (let i = 3; i <= 9; i++) {
      await ctx.menu('spaces.new');
      await jusqua(() => shell.locator('#space-name input.rename').count(), 'champ de nom');
      await shell.keyboard.type('Espace ' + i, { delay: 5 });
      await shell.keyboard.press('Enter');
      await jusqua(async () => (await nom()) === 'Espace ' + i, 'Espace ' + i);
    }
    await ctx.capture('espaces-9');

    await t.verifier('avec 9 Espaces, toutes les pastilles restent visibles dans la rangée du bas', async () => {
      assert.equal(await pastilles.count(), 9);
      const zone = await shell.locator('#spaces').boundingBox();
      const boites = await pastilles.evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return [r.left, r.right]; }));
      const coupees = boites.filter(([l, r]) => l < zone.x - 0.5 || r > zone.x + zone.width + 0.5).length;
      assert.equal(coupees, 0, `${coupees} pastille(s) sur 9 sont coupées par #spaces (overflow: hidden) et impossibles à cliquer`);
    });

    await t.verifier('avec 9 Espaces, un clic sur la première pastille y mène', async () => {
      await ctx.clic(shell, pastilles.nth(0));
      await jusqua(async () => (await nom()) === 'Personnel', 'Espace Personnel');
      assert.equal(await active(), 0);
      // Un nouvel Espace se place après celui d'où on le crée : le dernier de la
      // rangée n'est pas forcément le dernier créé.
      const dernier = (await ctx.etat()).espaces[8].nom;
      await ctx.clic(shell, pastilles.nth(8));
      await jusqua(async () => (await nom()) === dernier, 'dernier Espace de la rangée');
      assert.equal(await active(), 8);
    });
  },
};
