// Barre latérale : largeur réglable à la souris (poignée #resize), bouton de
// masquage, et effet sur la zone de la page.
const assert = require('node:assert/strict');

module.exports = {
  nom: 'Barre latérale',
  async test(ctx, t) {
    const { shell, jusqua } = ctx;
    const largeur = async () => Math.round((await shell.locator('#sidebar').boundingBox()).width);
    // Tire la poignée de redimensionnement jusqu'à l'abscisse x.
    const tirer = async (x) => {
      const sw = await largeur();
      const y = 420;
      assert.equal(await ctx.vueAu(sw - 2, y), shell.url(), 'la poignée est accessible à la souris');
      await shell.mouse.move(sw - 2, y);
      await shell.mouse.down();
      await shell.mouse.move(Math.round((sw + x) / 2), y + 3, { steps: 4 });
      await shell.mouse.move(x, y + 5, { steps: 4 });
      await ctx.sleep(120);
      const pendant = await shell.evaluate(() => document.body.classList.contains('no-anim'));
      await shell.mouse.up();
      await ctx.sleep(120);
      return pendant;
    };

    await ctx.ouvrir('/a', 'Page A');

    await t.verifier('largeur par défaut : 250 px, la page commence au bord de la barre', async () => {
      assert.equal(await largeur(), 250);
      const e = await ctx.etat();
      assert.equal(e.largeur, 250);
      assert.equal(e.vuePage.x, 250);
    });

    await t.verifier('la poignée affiche le curseur de redimensionnement', async () => {
      assert.equal(await shell.locator('#resize').evaluate((el) => getComputedStyle(el).cursor), 'col-resize');
    });

    await t.verifier('tirer la poignée vers la droite élargit la barre et décale la page', async () => {
      const pendant = await tirer(330);
      assert.equal(pendant, true, 'animations coupées pendant le geste');
      await jusqua(async () => (await largeur()) === 330, 'barre à 330 px');
      const e = await ctx.etat();
      assert.equal(e.largeur, 330);
      assert.equal(e.vuePage.x, 330);
      const w = await shell.evaluate(() => innerWidth);
      assert.equal(e.vuePage.x + e.vuePage.width, w - 8);
      assert.equal(await shell.evaluate(() => document.body.classList.contains('no-anim')), false);
    });

    await t.verifier('une fois le bouton relâché, bouger la souris ne redimensionne plus', async () => {
      await shell.mouse.move(280, 430, { steps: 3 });
      await ctx.sleep(150);
      assert.equal(await largeur(), 330);
    });

    await t.verifier('tirer vers la gauche rétrécit la barre', async () => {
      await tirer(230);
      await jusqua(async () => (await largeur()) === 230, 'barre à 230 px');
      assert.equal((await ctx.etat()).vuePage.x, 230);
    });

    await t.verifier('largeur bornée : 420 px au plus', async () => {
      await tirer(700);
      await jusqua(async () => (await largeur()) === 420, 'barre à 420 px');
      assert.equal((await ctx.etat()).vuePage.x, 420);
    });

    await ctx.capture('laterale-420');

    await t.verifier('largeur bornée : 200 px au moins', async () => {
      await tirer(60);
      await jusqua(async () => (await largeur()) === 200, 'barre à 200 px');
      assert.equal((await ctx.etat()).vuePage.x, 200);
    });

    await t.verifier('à 200 px, les boutons du haut et la pastille d’adresse tiennent dans la barre', async () => {
      const m = await shell.evaluate(() => {
        const side = document.getElementById('sidebar').getBoundingClientRect();
        const hors = [];
        for (const id of ['b-sidebar', 'b-back', 'b-forward', 'b-reload', 'url', 'b-newtab', 'b-library', 'b-plus']) {
          const r = document.getElementById(id).getBoundingClientRect();
          if (r.left < side.left || r.right > side.right || r.width < 20) hors.push(`${id} [${Math.round(r.left)}–${Math.round(r.right)}]`);
        }
        const sc = document.getElementById('scroll');
        return { hors, defilement: sc.scrollWidth - sc.clientWidth, feux: document.getElementById('b-sidebar').getBoundingClientRect().left };
      });
      assert.deepEqual(m.hors, []);
      assert.ok(m.defilement <= 0, 'pas de débordement horizontal');
      assert.ok(m.feux >= 68, 'le bouton ne passe pas sous les feux tricolores');
    });

    await ctx.capture('laterale-200');
    await tirer(250);
    await jusqua(async () => (await largeur()) === 250, 'barre à 250 px');

    await t.verifier('la poignée (7 px) n’est pas recouverte par la page sur toute sa largeur', async () => {
      const r = await shell.locator('#resize').boundingBox();
      const y = 420;
      const libres = [];
      for (let x = Math.ceil(r.x); x < r.x + r.width; x++) if ((await ctx.vueAu(x, y)) === shell.url()) libres.push(x);
      assert.ok(libres.length >= 4, `seulement ${libres.length} px saisissables sur ${r.width}`);
    });

    await t.verifier('clic sur le bouton de la barre latérale : elle se masque, la page s’élargit', async () => {
      await ctx.clic(shell, '#b-sidebar');
      await jusqua(async () => !(await shell.evaluate(() => document.body.classList.contains('open'))), 'barre masquée');
      assert.equal(await shell.evaluate(() => document.body.classList.contains('docked')), false);
      await jusqua(async () => (await ctx.etat()).vuePage.x === 8, 'page à 8 px du bord');
      const e = await ctx.etat();
      assert.equal(e.lateraleVisible, false);
      const w = await shell.evaluate(() => innerWidth);
      assert.equal(e.vuePage.width, w - 16);
      await jusqua(async () => (await shell.locator('#sidebar').boundingBox()).x + 250 <= 0, 'barre sortie de la fenêtre');
    });

    await t.verifier('⌘S (élément de menu) la réaffiche à la même largeur', async () => {
      await ctx.menu('Cmd+S');
      await jusqua(async () => shell.evaluate(() => document.body.classList.contains('docked')), 'barre affichée');
      await jusqua(async () => (await ctx.etat()).vuePage.x === 250, 'page à 250 px');
      await jusqua(async () => (await shell.locator('#sidebar').boundingBox()).x === 0, 'barre en place');
      assert.equal((await ctx.etat()).lateraleVisible, true);
    });

    await t.verifier('clic sur le bouton sans aucun onglet : l’accueil s’étend sur toute la fenêtre', async () => {
      await ctx.menu('Cmd+W');
      await jusqua(async () => shell.evaluate(() => document.body.classList.contains('no-tab')), 'aucun onglet');
      await ctx.clic(shell, '#b-sidebar');
      await jusqua(async () => (await shell.locator('#empty').boundingBox()).x === 8, 'accueil pleine largeur');
      await ctx.menu('Cmd+S');
      await jusqua(async () => (await shell.locator('#empty').boundingBox()).x === 250, 'accueil à droite de la barre');
    });

    await t.verifier('⇧⌘D (élément de menu) affiche la barre d’outils au-dessus de la page', async () => {
      await ctx.ouvrir('/b', 'Page B');
      await ctx.menu('Shift+Cmd+D');
      await jusqua(() => shell.locator('#toolbar').isVisible(), 'barre d’outils visible');
      await jusqua(async () => (await ctx.etat()).vuePage.y === 48, 'page décalée sous la barre d’outils');
      assert.equal(await shell.textContent('#tb-url-text'), ctx.url('/b'));
      const tb = await shell.locator('#toolbar').boundingBox();
      assert.ok(tb.x >= 250 && tb.y + tb.height <= 48, 'barre d’outils entre la barre latérale et la page');
      await ctx.capture('barre-outils');
      await ctx.clic(shell, '#tb-url');
      await jusqua(ctx.commandeOuverte, 'barre de commande ouverte depuis la barre d’outils');
      await ctx.modal.keyboard.press('Escape');
      await ctx.menu('Shift+Cmd+D');
      await jusqua(async () => (await ctx.etat()).vuePage.y === 8, 'page revenue en haut');
    });
  },
};
