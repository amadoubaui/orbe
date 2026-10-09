// Finitions, deuxième série, à la vraie souris et au vrai clavier : dossier « Premiers
// pas », onglet lâché en haut de la page (vue empilée), dépôt dans un dossier fermé,
// onglet glissé hors de la fenêtre puis vers une autre fenêtre, Échap doublé en plein écran.
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

module.exports = {
  nom: 'Finitions 2 : premiers pas, quatre côtés, onglet hors de la fenêtre',
  async test(ctx, t) {
    const { shell, jusqua } = ctx;
    const volets = () => ctx.principal(({ w, win }) => {
      const ids = w.visibleIds();
      const g = ids.length > 1 ? w.groupOf(ids[0]) : null;
      return { titres: ids.map((id) => w.data.tabs[id].title), actif: w.activeId ? w.data.tabs[w.activeId].title : null, empile: !!g && w.isVertical(g), pages: ids.map((id) => win.live.get(id).view.getBounds()) };
    });
    const fenetres = () => ctx.principal(({ win }) => win.OrbeWindow.all.map((x) => ({ actif: x.activeId ? x.data.tabs[x.activeId].title : null, prive: x.incognito })));

    // --- Premiers pas -------------------------------------------------------------------
    await t.verifier('premier lancement : le dossier « Premiers pas » est en tête des épinglés ; un clic sur « Raccourcis clavier essentiels » ouvre la page d’Orbe', async () => {
      const n = await ctx.principal(({ w, req }) => { const f = req('starter.js').seed(w); return f ? f.children.length : 0; });
      assert.ok(n >= 3, 'dossier posé');
      const dossier = shell.locator('#pinned .folder').first();
      await jusqua(async () => (await dossier.locator('> .row .title').textContent()) === (await ctx.texte('starter.folder')), 'dossier affiché');
      assert.equal(await dossier.locator('.children .row.tab').count(), n);
      const ligne = dossier.locator('.children .row.tab').first();
      assert.equal(await ligne.locator('.title').textContent(), await ctx.texte('help.shortcuts'));
      await ctx.clic(shell, ligne);
      const page = await ctx.attendrePage('shortcuts.html');
      await jusqua(async () => (await page.locator('h1').count()) > 0, 'page des raccourcis chargée');
      assert.equal((await ctx.etat()).actifUrl, 'orbe://app/shortcuts.html');
      // Remise à plat pour la suite.
      await ctx.principal(({ w, win }) => { const f = w.space.pinned.shift(); for (const c of f.children) { win.OrbeWindow.destroyView(c.id); delete w.data.tabs[c.id]; } delete w.activeBySpace[w.space.id]; w.layout(); w.changed(); });
      await jusqua(async () => (await shell.locator('#pinned .folder').count()) === 0, 'dossier retiré');
    });

    for (const c of ['a', 'b', 'c', 'd']) await ctx.ouvrir('/' + c, 'Page ' + c.toUpperCase());

    // --- Quatre côtés -------------------------------------------------------------------
    await t.verifier('glisser un onglet en haut de la page : la zone de dépôt éclaire la moitié haute ; lâché, la vue est empilée, l’onglet au-dessus', async () => {
      await ctx.clic(shell, ctx.ligne('Page A'));
      await jusqua(async () => (await volets()).actif === 'Page A', 'Page A affichée');
      const e = await ctx.principal(({ w }) => w.contentRect());
      let zone = null;
      await ctx.glisser(await ctx.centre(ctx.ligne('Page B')), () => ({ x: e.x + e.width / 2, y: e.y + e.height * 0.1 }), {
        avantLacher: async () => {
          const depot = await ctx.attendrePage('overlay.html#drop');
          zone = await jusqua(() => depot.evaluate(() => { const l = document.getElementById('drop-label'); return document.getElementById('drop').classList.contains('over') && l.style.left ? { left: parseFloat(l.style.left), top: parseFloat(l.style.top), width: parseFloat(l.style.width), height: parseFloat(l.style.height) } : null; }), 'côté éclairé');
        },
      });
      assert.ok(Math.abs(zone.top - 6) <= 1 && Math.abs(zone.width - (e.width - 12)) <= 1 && Math.abs(zone.height - (e.height / 2 - 12)) <= 1, `moitié haute éclairée : ${JSON.stringify(zone)} dans ${JSON.stringify(e)}`);
      await jusqua(async () => (await volets()).titres.join() === 'Page B,Page A', 'vue scindée B au-dessus de A');
      const v = await volets();
      assert.equal(v.empile, true, 'vue empilée');
      assert.ok(v.pages[0].y < v.pages[1].y && v.pages[0].x === v.pages[1].x, JSON.stringify(v.pages));
      assert.equal(v.actif, 'Page B');
      await ctx.capture('quatre-cotes-haut');
    });

    await t.verifier('glisser un onglet au milieu, à droite : côte à côte, comme avant', async () => {
      await ctx.menu('view.closeSplit');
      await jusqua(async () => (await volets()).titres.length === 1, 'vue scindée fermée');
      await ctx.principal(({ w }) => { for (const id of w.space.today) w.leaveSplit(id); w.layout(); w.changed(); });
      await ctx.clic(shell, ctx.ligne('Page A'));
      await jusqua(async () => (await volets()).titres.join() === 'Page A', 'Page A seule');
      const e = await ctx.principal(({ w }) => w.contentRect());
      await ctx.glisser(await ctx.centre(ctx.ligne('Page C')), () => ({ x: e.x + e.width * 0.8, y: e.y + e.height / 2 }));
      await jusqua(async () => (await volets()).titres.join() === 'Page A,Page C', 'vue scindée A | C');
      assert.equal((await volets()).empile, false);
      await ctx.principal(({ w }) => { for (const id of w.space.today) w.leaveSplit(id); w.layout(); w.changed(); });
      await jusqua(async () => (await volets()).titres.length === 1, 'vue scindée défaite');
    });

    // --- Dossier fermé ------------------------------------------------------------------
    await t.verifier('glisser un onglet sur un dossier fermé : il ne s’ouvre pas pendant le survol ; au dépôt l’onglet y entre et l’icône du dossier rebondit', async () => {
      await ctx.principal(({ w }) => { w.space.pinned.push({ type: 'folder', id: 'f-ferme', name: 'Fermé', open: false, children: [] }); w.changed(); });
      const dossier = shell.locator('#pinned .folder').first();
      await jusqua(async () => (await dossier.count()) === 1, 'dossier affiché');
      const reduit = await shell.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
      await ctx.vitesseAnimations(0.1); // le rebond dure 280 ms : ralenti, il se laisse observer
      let survol = null;
      try {
        const r = await ctx.glisser(await ctx.centre(ctx.ligne('Page D')), () => ctx.centre(dossier.locator('> .row')), {
          pause: 500,
          avantLacher: async () => { survol = await shell.evaluate(() => { const f = document.querySelector('#pinned .folder'); return { ouvert: f.classList.contains('open'), vise: f.classList.contains('drop-into') }; }); },
        });
        assert.equal(r.dossier, true, 'le dossier est mis en évidence pendant le survol');
        assert.deepEqual(survol, { ouvert: false, vise: true });
        if (!reduit) {
          const anime = await jusqua(() => shell.evaluate(() => { const ic = document.querySelector('#pinned .folder > .row .ic'); return ic ? ic.getAnimations().filter((a) => a.id === 'drop-pulse').length : 0; }), 'rebond de l’icône', 3000);
          assert.equal(anime, 1);
        }
      } finally { await ctx.vitesseAnimations(1); }
      await jusqua(async () => { const p = (await ctx.etat()).epingles[0]; return p && p.enfants.map((x) => x.title).join() === 'Page D'; }, 'onglet dans le dossier');
      assert.equal((await ctx.etat()).epingles[0].ouvert, false, 'le dossier est resté fermé');
      assert.equal(await dossier.evaluate((f) => f.classList.contains('open')), false);
    });

    // --- Hors de la fenêtre -------------------------------------------------------------
    // Le glisser est mené en événements bruts (protocole DevTools) : la souris de Playwright
    // ne sort pas de la fenêtre. Le point « hors de la fenêtre » est celui que le système
    // donnerait : il est fourni au processus principal à la place du vrai pointeur.
    const lacherDehors = async (de) => {
      const cdp = await shell.context().newCDPSession(shell);
      let donnees = null;
      cdp.on('Input.dragIntercepted', (e) => { donnees = e.data; });
      await cdp.send('Input.setInterceptDrags', { enabled: true });
      const souris = (type, x, y, buttons) => cdp.send('Input.dispatchMouseEvent', { type, x, y, buttons, clickCount: 1, button: type === 'mouseMoved' && !buttons ? 'none' : 'left' }).catch(() => {});
      await souris('mouseMoved', de.x, de.y, 0);
      await souris('mousePressed', de.x, de.y, 1);
      await souris('mouseMoved', de.x + 3, de.y + 3, 1);
      await souris('mouseMoved', de.x + 8, de.y + 8, 1);
      await jusqua(() => donnees, 'glisser commencé', 3000);
      await ctx.sleep(200);
      await cdp.send('Input.dispatchDragEvent', { type: 'dragCancel', x: -240, y: de.y, data: donnees });
      await souris('mouseReleased', -240, de.y, 0);
      await cdp.send('Input.setInterceptDrags', { enabled: false }).catch(() => {});
      await cdp.detach().catch(() => {});
      return donnees;
    };

    let donneesGlisser = null;
    await t.verifier('glisser un onglet hors de la fenêtre : il s’ouvre dans une nouvelle fenêtre ; la première passe à l’onglet voisin', async () => {
      await ctx.clic(shell, ctx.ligne('Page A'));
      await jusqua(async () => (await volets()).actif === 'Page A', 'Page A affichée');
      await ctx.principal(({ w, win }) => { const b = w.win.getBounds(); win.hooks.cursor0 = win.hooks.cursor0 || win.hooks.cursor; win.hooks.cursor = () => ({ x: b.x + b.width + 400, y: b.y + 120 }); });
      donneesGlisser = await lacherDehors(await ctx.centre(ctx.ligne('Page A')));
      await jusqua(async () => (await fenetres()).length === 2, 'seconde fenêtre');
      await jusqua(async () => (await fenetres()).some((f, i) => i > 0 && f.actif === 'Page A'), 'Page A dans la nouvelle fenêtre');
      const f = await fenetres();
      assert.notEqual(f[0].actif, 'Page A', 'la première fenêtre est passée à un autre onglet');
      assert.ok(f[0].actif, 'la première fenêtre garde une page');
      assert.equal(f[1].prive, false);
      assert.deepEqual(await shell.evaluate(() => ({ corps: document.body.classList.contains('dragging'), soi: document.querySelectorAll('.dragging-self').length })), { corps: false, soi: 0 });
      assert.ok((await ctx.titres()).includes('Page A'), 'l’onglet reste dans la liste, commune aux fenêtres');
    });

    await t.verifier('glisser abandonné à l’intérieur de la fenêtre : aucune fenêtre de plus', async () => {
      await ctx.principal(({ w, win }) => { const b = w.win.getBounds(); win.hooks.cursor = () => ({ x: b.x + 60, y: b.y + 60 }); });
      const r = await ctx.tenterGlisser(await ctx.centre(ctx.ligne('Page B')));
      assert.equal(r.intercepte, true);
      await ctx.sleep(300);
      assert.equal((await fenetres()).length, 2);
    });

    await t.verifier('ligne lâchée sur la barre latérale de l’autre fenêtre : c’est elle qui affiche l’onglet', async () => {
      const autre = await jusqua(() => ctx.pages().find((p) => p !== shell && /shell\.html$/.test(p.url())), 'barre de la seconde fenêtre');
      await jusqua(() => autre.evaluate(() => typeof S === 'object' && !!S && document.querySelectorAll('#today .row.tab').length > 0), 'seconde barre prête');
      const idB = await ctx.principal(({ w }) => Object.keys(w.data.tabs).find((id) => w.data.tabs[id].title === 'Page B'));
      await ctx.clic(shell, ctx.ligne('Page B'));
      await jusqua(async () => (await fenetres())[0].actif === 'Page B', 'Page B dans la première fenêtre');
      const cdp = await autre.context().newCDPSession(autre);
      const data = { items: [{ mimeType: 'application/x-orbe-item', data: idB }, { mimeType: 'text/plain', data: idB }], dragOperationsMask: 19 };
      const box = await autre.locator('#today').boundingBox();
      const pt = { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + 20) };
      for (const type of ['dragEnter', 'dragOver', 'drop']) await cdp.send('Input.dispatchDragEvent', { type, x: pt.x, y: pt.y, data });
      await cdp.detach().catch(() => {});
      await jusqua(async () => (await fenetres())[1].actif === 'Page B', 'Page B dans la seconde fenêtre');
      const f = await fenetres();
      assert.notEqual(f[0].actif, 'Page B');
      // Aucun onglet n'a été créé par ce dépôt (ce n'est pas une adresse).
      assert.equal((await ctx.titres()).filter((x) => x === 'Page B').length, 1);
      await ctx.principal(({ win }) => { win.hooks.cursor = win.hooks.cursor0; const w2 = win.OrbeWindow.all[1]; win.OrbeWindow.all[0].activate(win.OrbeWindow.all[0].space.today[0]); w2.win.close(); });
      await jusqua(async () => (await fenetres()).length === 1, 'seconde fenêtre fermée');
    });

    // --- Téléchargement en cours au bas de la barre -----------------------------------------
    await t.verifier('téléchargement en cours : une ligne au bas de la barre (nom, taille, progression) ; un clic ouvre les téléchargements ; « × » l’annule', async () => {
      const GROS = Buffer.alloc(4 * 1024 * 1024, 7);
      const serveur = http.createServer((req, res) => {
        res.setHeader('content-type', 'application/octet-stream');
        res.setHeader('content-disposition', 'attachment; filename="gros.bin"');
        res.setHeader('content-length', String(GROS.length));
        let at = 0;
        const timer = setInterval(() => {
          if (res.destroyed || at >= GROS.length) { clearInterval(timer); if (!res.destroyed) res.end(); return; }
          res.write(GROS.subarray(at, at + 16384));
          at += 16384;
        }, 100);
      });
      await new Promise((r) => serveur.listen(0, '127.0.0.1', r));
      const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'orbe-ui-dl2-'));
      try {
        await ctx.clic(shell, ctx.ligne('Page A'));
        await jusqua(async () => (await volets()).actif === 'Page A', 'Page A affichée');
        await ctx.principal(({ w, store }, a) => { store.state.settings.downloadDir = a.dir; w.activeRt.wc.downloadURL(a.url); }, { dir: dossier, url: `http://127.0.0.1:${serveur.address().port}/gros.bin` });
        const ligne = shell.locator('#dls .dl').first();
        await jusqua(() => ligne.isVisible(), 'ligne du téléchargement', 10000);
        assert.equal(await ligne.locator('.dl-name').textContent(), 'gros.bin');
        const unites = (await ctx.texte('dl.units')).split(' ');
        await jusqua(async () => new RegExp(`^[\\d.]+ (${unites.join('|')}) / 4\\.0 ${unites[2]}( · .+)?$`).test(await ligne.locator('.dl-sub').textContent()), 'taille reçue sur taille totale', 8000);
        await jusqua(async () => /restantes|left/.test(await ligne.locator('.dl-sub').textContent()), 'temps restant affiché', 8000);
        // La ligne tient au-dessus de la rangée du bas, dans la barre.
        const b = await ligne.boundingBox();
        const bas = await shell.locator('#bottom').boundingBox();
        const barre = await shell.locator('#sidebar').boundingBox();
        assert.ok(b.y + b.height <= bas.y + 1 && b.x >= barre.x && b.x + b.width <= barre.x + barre.width, JSON.stringify([b, bas, barre]));
        await ctx.capture('telechargement-barre');
        await ctx.clic(shell, ligne.locator('.dl-name'));
        await ctx.attendrePage('library.html');
        await ctx.clic(shell, ligne.locator('.dl-x'));
        await jusqua(async () => (await shell.locator('#dls .dl').count()) === 0, 'ligne retirée');
        await jusqua(() => !fs.existsSync(path.join(dossier, 'gros.bin')), 'morceau retiré');
        assert.equal(await ctx.principal(({ store }) => store.state.downloads.filter((d) => d.name === 'gros.bin').map((d) => d.state).join()), 'cancelled');
      } finally {
        serveur.closeAllConnections();
        serveur.close();
        try { fs.rmSync(dossier, { recursive: true, force: true }); } catch {}
      }
    });

    // --- Échap en plein écran -------------------------------------------------------------
    const plein = () => ctx.principal(({ w }) => w.win.isFullScreen());
    await ctx.menu('Ctrl+Cmd+F');
    let entre = await jusqua(plein, 'plein écran', 6000).catch(() => false);
    // Session verrouillée : le système annonce le plein écran puis y renonce ; on attend qu'il tienne.
    if (entre) { await ctx.sleep(1500); entre = await plein(); }
    if (!entre) {
      t.ignorer('plein écran : un Échap ne fait rien, Échap doublé fait sortir la fenêtre du plein écran', 'la fenêtre n’entre pas en plein écran ici (session verrouillée ou écran absent)');
      await ctx.principal(({ w }) => w.win.setFullScreen(false));
    } else {
      await t.verifier('plein écran : un Échap ne fait rien, Échap doublé fait sortir la fenêtre du plein écran', async () => {
        await shell.keyboard.press('Escape');
        await ctx.sleep(700);
        assert.equal(await plein(), true, 'un seul Échap : toujours en plein écran');
        await shell.keyboard.press('Escape');
        await ctx.sleep(80);
        await shell.keyboard.press('Escape');
        await jusqua(async () => !(await plein()), 'sortie du plein écran', 6000);
      });
    }
  },
};
