// Glisser un onglet de la barre latérale sur la page : vue scindée.
const assert = require('node:assert/strict');

module.exports = {
  nom: 'Glisser pour scinder',
  async test(ctx, t) {
    const { shell, jusqua } = ctx;
    await ctx.ouvrir('/a', 'Page A');
    await ctx.ouvrir('/b', 'Page B');

    await t.verifier('glisser un onglet sur la page crée une vue scindée, sur une seule ligne', async () => {
      const e = await ctx.etat();
      const cible = { x: e.vuePage.x + e.vuePage.width * 0.75, y: e.vuePage.y + e.vuePage.height / 2 };
      await ctx.glisser(await ctx.centre(ctx.ligne('Page A')), () => cible);
      await jusqua(() => shell.evaluate(() => document.querySelectorAll('#today .row.split').length === 1), 'ligne de vue scindée');
      const visibles = await shell.evaluate(() => [...document.querySelectorAll('#today .row.tab')].filter((el) => el.offsetParent).length);
      assert.equal(visibles, 1, 'les deux onglets partagent une ligne');
      assert.equal(await shell.evaluate(() => document.querySelectorAll('#dividers .divider').length), 1, 'une poignée entre les deux volets');
    });
  },
};
