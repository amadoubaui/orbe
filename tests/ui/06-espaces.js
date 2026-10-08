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

    await t.verifier('la liste glisse dans le sens du changement d’Espace', async () => {
      await ctx.clic(shell, pastilles.nth(0));
      await jusqua(async () => (await nom()) === 'Personnel', 'Espace Personnel');
      assert.equal(await shell.evaluate(() => document.getElementById('scroll').classList.contains('slide-prev')), true);
      await ctx.clic(shell, pastilles.nth(1));
      await jusqua(async () => (await nom()) === 'Projets', 'Espace Projets');
      assert.equal(await shell.evaluate(() => document.getElementById('scroll').classList.contains('slide-next')), true);
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
      await ctx.clic(shell, pastilles.nth(8));
      await jusqua(async () => (await nom()) === 'Espace 9', 'Espace 9');
    });
  },
};
