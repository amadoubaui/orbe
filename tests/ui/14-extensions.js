// Extensions, à la souris réelle : bouton sous l'adresse, fenêtre de
// l'extension, panneau latéral (ouverture, largeur, fermeture).
const assert = require('node:assert/strict');
const path = require('path');

module.exports = {
  nom: 'Extensions',
  async test(ctx, t) {
    const { shell, jusqua, sleep } = ctx;
    await ctx.ouvrir('/a', 'Page A');
    const id = await ctx.principal(async ({ req, win }, dir) => {
      const ses = req('sessions.js').mainSession();
      const ext = await ses.extensions.loadExtension(dir);
      req('ext-host.js').sync();
      win.OrbeWindow.pushAll();
      return ext.id;
    }, path.join(ctx.root, 'tests', 'ext-fixture'));
    const pageExt = (fichier) => ctx.pages().find((p) => p.url().startsWith(`chrome-extension://${id}/${fichier}`));
    const sousLePointeur = (page, sel) => page.evaluate((s) => {
      const el = document.querySelector(s);
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!top && (top === el || el.contains(top));
    }, sel);

    await t.verifier('le bouton de l’extension apparaît sous l’adresse, sans recouvrir ni être recouvert', async () => {
      await jusqua(() => shell.evaluate(() => document.querySelectorAll('#exts .ext').length === 1), 'bouton d’extension');
      assert.equal(await sousLePointeur(shell, '#exts .ext'), true);
      const boites = await shell.evaluate(() => ['url-row', 'exts', 'scroll'].map((x) => { const r = document.getElementById(x).getBoundingClientRect(); return [r.top, r.bottom]; }));
      assert.ok(boites[0][1] <= boites[1][0] + 1 && boites[1][1] <= boites[2][0] + 1, 'adresse, boutons et listes se suivent sans chevauchement : ' + JSON.stringify(boites));
      assert.equal(await shell.getAttribute('#exts .ext', 'title'), 'Essai');
    });

    await t.verifier('un clic sur le bouton ouvre la fenêtre de l’extension', async () => {
      await ctx.clic(shell, '#exts .ext');
      const popup = await jusqua(() => pageExt('popup.html'), 'fenêtre de l’extension', 8000);
      await jusqua(() => popup.evaluate(() => !!document.getElementById('out')), 'contenu de la fenêtre');
      assert.equal(await popup.evaluate(() => typeof chrome.tabs.query), 'function');
      const actif = await popup.evaluate(() => chrome.tabs.query({ active: true, currentWindow: true }).then((x) => x.map((y) => y.url)));
      assert.deepEqual(actif, [ctx.url('/a')], 'la fenêtre voit l’onglet actif d’Orbe');
    });

    await t.verifier('le panneau latéral s’ouvre à droite et la page lui laisse la place', async () => {
      const avant = (await ctx.etat()).vuePage.width;
      const popup = pageExt('popup.html') || (await (async () => { await ctx.clic(shell, '#exts .ext'); return jusqua(() => pageExt('popup.html'), 'fenêtre', 8000); })());
      await popup.evaluate(() => chrome.windows.getCurrent().then((w) => chrome.sidePanel.open({ windowId: w.id })));
      await jusqua(() => pageExt('panel.html'), 'page du panneau', 8000);
      const apres = await jusqua(async () => { const l = (await ctx.etat()).vuePage.width; return l < avant - 200 ? l : null; }, 'page rétrécie');
      const cadre = await jusqua(() => ctx.pages().find((p) => p.url().includes('orbe://app/panel.html')), 'cadre du panneau');
      await jusqua(() => cadre.evaluate(() => !document.getElementById('panel').hidden), 'cadre affiché');
      assert.equal(await sousLePointeur(cadre, '#close'), true, 'le bouton de fermeture est atteignable');
      ctx.largeurAvecPanneau = apres;
      ctx.largeurSansPanneau = avant;
    });

    await t.verifier('un clic sur × ferme le panneau, la page reprend sa largeur', async () => {
      const cadre = ctx.pages().find((p) => p.url().includes('orbe://app/panel.html'));
      const b = await cadre.evaluate(() => { const r = document.getElementById('close').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
      await cadre.mouse.click(b.x, b.y);
      await jusqua(async () => (await ctx.etat()).vuePage.width === ctx.largeurSansPanneau, 'largeur rétablie');
      await sleep(100);
    });

    await t.verifier('fenêtre des mots de passe : « Ajouter » ouvre un formulaire utilisable à la souris', async () => {
      await ctx.principal(({ w }) => { w.run('passwords'); });
      const gestion = await jusqua(() => ctx.pages().find((p) => p.url().includes('passwords.html')), 'fenêtre des mots de passe', 8000);
      // La page est prête quand le bouton a pris sa taille (textes traduits posés).
      await jusqua(() => gestion.evaluate(() => { const b = document.getElementById('add'); return !!b && b.getBoundingClientRect().width > 40; }), 'bouton Ajouter');
      assert.equal(await sousLePointeur(gestion, '#add'), true);
      await gestion.click('#add');
      await jusqua(() => gestion.evaluate(() => !document.getElementById('new').hidden && document.querySelectorAll('#new input').length >= 2), 'formulaire d’ajout');
      assert.equal(await sousLePointeur(gestion, '#new input'), true, 'le premier champ n’est recouvert par rien');
      // Aucun élément masqué n'est dessiné.
      const fantomes = await gestion.evaluate(() => [...document.querySelectorAll('[hidden]')].filter((el) => el.getClientRects().length).map((el) => el.id || el.className));
      assert.deepEqual(fantomes, []);
    });
  },
};
