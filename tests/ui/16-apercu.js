// Aperçu (Peek) : depuis un onglet épinglé, un clic sur un lien vers un autre
// site ouvre celui-ci en aperçu ; la carte grandit depuis le lien ; Échap ou un
// clic à côté la referme en la réduisant ; le bouton d'agrandissement en fait
// un onglet, en l'étendant jusqu'à la place de la page.
const assert = require('node:assert/strict');

module.exports = {
  nom: 'Aperçu',
  async test(ctx, t) {
    const { shell, jusqua } = ctx;
    // État de l'aperçu côté fenêtre : sa place, d'où il est parti, les vues présentes.
    const apercu = () => ctx.principal(({ w, win }) => {
      const kids = w.win.contentView.children;
      const st = w.peekState;
      return {
        ouvert: !!st,
        titre: st ? st.title : null,
        point: st ? st.point : null,
        place: st ? st.view.getBounds() : null,
        attendue: w.peekRect(),
        depart: st ? w.peekSeed(w.peekRect(), st.point) : null,
        voile: !!w.peekChrome && kids.includes(w.peekChrome),
        // Vues montrant la page de l'aperçu (servie sous le nom « localhost »).
        cartes: kids.filter((k) => k.webContents && !k.webContents.isDestroyed() && k.webContents.getURL().startsWith('http://localhost')).length,
        mouvement: win.motion(1) > 0,
        page: w.activeRt ? w.activeRt.view.getBounds() : null,
        zone: w.contentRect(),
      };
    });
    const memeRect = (a, b) => a && b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
    const pageL = await ctx.ouvrir('/liens', 'Page à liens');
    await ctx.principal(({ w }) => w.togglePin(w.activeId)); // mise en place : onglet épinglé
    await jusqua(async () => (await ctx.titres('#pinned')).join() === 'Page à liens', 'onglet épinglé');
    // Relevée une fois : sous l'aperçu, la page ne répond plus aux mesures (elle n'est plus dessinée).
    const boite = await pageL.locator('#dehors').boundingBox();
    const autre = () => ctx.pages().find((p) => p.url() === `http://localhost:${ctx.hote.split(':')[1]}/b`);
    const ouvrir = async () => {
      // Souris brute : `locator.click` attendrait une navigation, qui est justement empêchée.
      await pageL.mouse.click(boite.x + boite.width / 2, boite.y + boite.height / 2);
      await jusqua(async () => (await apercu()).titre === 'Page B', 'aperçu de la page B');
      await jusqua(async () => { const a = await apercu(); return memeRect(a.place, a.attendue); }, 'carte de l’aperçu à sa place');
    };
    const ferme = () => jusqua(async () => { const a = await apercu(); return !a.ouvert && !a.voile; }, 'aperçu refermé, voile retiré');

    await t.verifier('clic sur un lien sortant d’un onglet épinglé : l’aperçu s’ouvre par-dessus la page, qui reste l’onglet actif', async () => {
      await ouvrir();
      const a = await apercu();
      assert.equal(a.voile, true, 'voile derrière la carte');
      assert.equal(a.cartes, 1, 'une carte dans la fenêtre');
      assert.deepEqual(await ctx.titres('#pinned'), ['Page à liens']);
      assert.deepEqual(await ctx.titres(), []);
      assert.equal((await ctx.etat()).actifUrl, ctx.url('/liens'));
    });

    await t.verifier('la carte part du lien cliqué', async () => {
      const a = await apercu();
      const b = boite;
      assert.ok(a.point, 'point de départ connu');
      const cx = a.page.x + b.x + b.width / 2;
      const cy = a.page.y + b.y + b.height / 2;
      assert.ok(Math.abs(a.point.x - cx) <= b.width / 2 + 2 && Math.abs(a.point.y - cy) <= b.height / 2 + 2, `départ ${JSON.stringify(a.point)} loin du lien (${cx}, ${cy})`);
      // Petite carte autour du lien.
      assert.ok(a.depart.width < a.attendue.width / 2 && a.depart.x >= a.zone.x && a.depart.y >= a.zone.y, 'petite carte, dans la zone des pages');
      assert.ok(a.depart.x <= cx && cx <= a.depart.x + a.depart.width && a.depart.y <= cy && cy <= a.depart.y + a.depart.height, 'le lien est dans la carte de départ : ' + JSON.stringify(a.depart));
    });

    await t.verifier('le voile et les boutons de l’aperçu paraissent en fondu', async () => {
      const chrome = await ctx.attendrePage('overlay.html#peek');
      await jusqua(() => chrome.evaluate(() => document.body.classList.contains('peek') && !document.getElementById('peek').hidden), 'voile affiché');
      await jusqua(() => chrome.evaluate(() => getComputedStyle(document.getElementById('backdrop')).opacity === '1'), 'voile opaque en fin de fondu');
    });

    await t.verifier('Échap : l’aperçu se referme (la carte se réduit, le voile s’efface)', async () => {
      // (Les touches envoyées par Playwright n'atteignent pas le filtre clavier du processus
      // principal : Échap est tapé dans le voile, qui le traite lui-même.)
      const chrome = await ctx.attendrePage('overlay.html#peek');
      await chrome.keyboard.press('Escape');
      await jusqua(async () => !(await apercu()).ouvert, 'aperçu fermé pour le reste de l’application');
      await ferme();
      await jusqua(async () => (await apercu()).cartes === 0, 'la carte a quitté la fenêtre');
      assert.equal((await ctx.etat()).actifUrl, ctx.url('/liens'));
    });

    await t.verifier('clic à côté de la carte : l’aperçu se referme', async () => {
      await ouvrir();
      const chrome = await ctx.attendrePage('overlay.html#peek');
      const a = await apercu();
      // Dans la marge entre le bord de la zone des pages et la carte.
      await chrome.mouse.click(Math.round((a.place.x - a.zone.x) / 2), Math.round(a.zone.height / 2));
      await ferme();
      assert.deepEqual(await ctx.titres(), []);
    });

    await t.verifier('rouvrir aussitôt après une fermeture : un seul aperçu, à sa place', async () => {
      await ouvrir();
      const chrome = await ctx.attendrePage('overlay.html#peek');
      await chrome.keyboard.press('Escape');
      await ouvrir(); // pendant que le précédent se réduit encore
      const a = await apercu();
      assert.equal(a.cartes, 1, 'une seule carte');
      assert.equal(a.voile, true);
      assert.ok(memeRect(a.place, a.attendue));
    });

    await t.verifier('bouton « agrandir » : l’aperçu devient un onglet et s’étend jusqu’à la place de la page', async () => {
      const chrome = await ctx.attendrePage('overlay.html#peek');
      await chrome.locator('#peek-expand').click();
      await jusqua(async () => (await ctx.titres()).join() === 'Page B', 'onglet « Page B » créé');
      await jusqua(async () => { const a = await apercu(); return !a.voile && a.cartes === 1 && memeRect(a.page, a.zone); }, 'page étendue à toute la zone, voile et ancienne page retirés');
      const e = await ctx.etat();
      assert.equal(e.actifUrl, autre().url());
      assert.equal(await ctx.vueAu(e.vuePage.x + 40, e.vuePage.y + 40), autre().url());
    });
  },
};
