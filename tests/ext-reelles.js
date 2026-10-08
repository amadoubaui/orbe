// Essai sur de vraies extensions (demande Internet) : installation depuis le
// Chrome Web Store dans un profil jetable, pages réelles, puis relevé de ce qui
// fonctionne — styles calculés, contenu des fenêtres surgissantes, erreurs des
// service workers.
//   node scripts/test-ext.js reelles      (ou : ORBE_SCENARIO=tests/ext-reelles.js node scripts/dev.js --selftest)
//   ORBE_EXT_KEEP=1 avec ORBE_USER_DATA=<dossier> : second passage sur le même profil, sans réinstaller
//   ORBE_EXT=darkreader,wappalyzer,ublock,…   pour n'en essayer que certaines
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const IDS = {
  darkreader: 'eimadpbcbfnmbkopoojfekhnkhdbieeh',
  wappalyzer: 'gppongmhjkpfnbhagpmjfkannfbllamg',
  ublock: 'ddkjiahejlhfcafbddmgiahcphecmpfh',
};

async function until(fn, timeout = 15000) {
  const t0 = Date.now();
  for (;;) {
    let v;
    try { v = await fn(); } catch { v = false; }
    if (v) return v;
    if (Date.now() - t0 > timeout) return null;
    await sleep(100);
  }
}

module.exports = async function realExtensions({ first: w, win, extensions, extApi, extHost }) {
  const wanted = (process.env.ORBE_EXT || 'darkreader,wappalyzer,ublock').split(',').map((s) => s.trim()).filter(Boolean);
  const ses = w.session;
  let failed = 0;
  const check = (name, ok, detail = '') => {
    if (!ok) failed += 1;
    console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? '\n      ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`);
  };
  const consoleOf = {};
  ses.serviceWorkers.on('console-message', (e, d) => {
    const id = (/^chrome-extension:\/\/([a-p]{32})\//.exec(d.sourceUrl || '') || [])[1] || '?';
    (consoleOf[id] || (consoleOf[id] = [])).push(`[${d.level}] ${d.message}`);
  });
  extApi.host.confirmPermissions = async () => true;
  const open = async (url, wait = 2500) => {
    const tab = w.newTab(url);
    const rt = win.live.get(tab.id);
    await new Promise((resolve) => { const timer = setTimeout(resolve, 25000); rt.wc.once('did-stop-loading', () => { clearTimeout(timer); resolve(); }); });
    await sleep(wait);
    return rt;
  };
  const popup = async (id) => {
    const pop = extHost.openPopup(w, id, { x: 260, y: 60 }, { keepOpen: true });
    if (!pop || pop === true) return null;
    const errors = [];
    // « navigate-to » : directive que Chromium ne connaît plus, sans conséquence.
    pop.webContents.on('console-message', (e) => { if ((e.level === 'error' || e.level === 3) && !/navigate-to/.test(e.message)) errors.push(e.message); });
    await until(async () => (await js(pop.webContents, 'document.readyState === "complete"')) === true);
    await sleep(2500);
    pop.errors = errors;
    return pop;
  };
  // Borné dans le temps : executeJavaScript attend la fin du chargement, qui peut ne jamais venir.
  const js = (wc, code) => Promise.race([wc.executeJavaScript(code).catch((err) => 'ERREUR ' + err.message), sleep(8000).then(() => 'ERREUR délai dépassé')]);
  const swErrors = (id) => (consoleOf[id] || []).filter((m) => /^\[(error|3)\]|Uncaught|is not a function|Cannot read|undefined/i.test(m));

  console.log('\nOrbe — vraies extensions\n');
  for (const key of wanted) {
    const id = IDS[key] || key;
    if (process.env.ORBE_EXT_KEEP && extensions.get(id)) { console.log(`  · ${extensions.get(id).name} déjà installée`); continue; }
    try {
      const r = await extensions.install(id);
      console.log(`  · ${r.name} ${r.version} installée (signature du Store : ${r.verified.store})`);
    } catch (err) {
      check(`installation de ${key}`, false, `${err.code || ''} ${err.message}`);
    }
  }
  await sleep(4000);

  if (wanted.includes('darkreader')) {
    const id = IDS.darkreader;
    console.log('\nDark Reader');
    const rt = await open('https://fr.wikipedia.org/wiki/Dakar', 5000);
    const probe = `(() => {
      const styles = [...document.querySelectorAll('style.darkreader, link.darkreader')].map((s) => s.className.replace('darkreader', '').trim());
      const count = {};
      for (const c of styles) count[c] = (count[c] || 0) + 1;
      const bg = (el) => (el ? getComputedStyle(el).backgroundColor : '');
      const fb = document.querySelector('.darkreader--fallback');
      return { classes: count, fallback: !!(fb && fb.textContent.trim()), html: bg(document.documentElement), body: bg(document.body),
        text: getComputedStyle(document.body).color, link: getComputedStyle(document.querySelector('#bodyContent a[href^="/wiki/"]')).color,
        scheme: document.documentElement.getAttribute('data-darkreader-scheme'), mode: document.documentElement.getAttribute('data-darkreader-mode') };
    })()`;
    // Dark Reader attend que la page soit visible : on laisse le temps au thème.
    const dynamic = (r) => r && !r.fallback && r.mode === 'dynamic' && Object.keys(r.classes).some((c) => /sync/.test(c));
    await until(async () => dynamic(await js(rt.wc, probe)), 12000);
    const before = await js(rt.wc, probe);
    check('thème dynamique appliqué (feuilles du site réécrites, feuille de secours vidée)', dynamic(before), before);
    check('aucune erreur dans le service worker', swErrors(id).length === 0, swErrors(id).slice(0, 6).join(' | '));

    const pop = await popup(id);
    check('la fenêtre surgissante s’ouvre', !!pop);
    if (pop) {
      const text = await js(pop.webContents, 'document.body.innerText.replace(/\\s+/g, " ").slice(0, 400)');
      const loader = await js(pop.webContents, '(() => { const l = document.querySelector(".loader"); if (!l) return "absent"; const c = getComputedStyle(l); return l.className + " opacité " + c.opacity + " " + c.visibility; })()');
      check('elle affiche ses réglages (écran « Loading » terminé)', typeof text === 'string' && /Brightness/.test(text) && /loader--complete/.test(loader), `${pop.getContentSize().join('×')} · écran d’attente : ${loader} · ${text}`);
      check('aucune erreur dans sa console', pop.errors.length === 0, pop.errors.slice(0, 4).join(' | '));
      console.log('      structure : ' + await js(pop.webContents, '[...document.querySelectorAll("button, [role=button], .toggle, .site-toggle, input")].slice(0, 40).map((e) => e.tagName.toLowerCase() + "." + String(e.className).split(" ").join(".") + (e.innerText ? ":" + e.innerText.trim().slice(0, 18).replace(/\\s+/g, " ") : "")).join(" | ")'));
      if (process.env.ORBE_SHOTS) require('fs').writeFileSync(require('path').join(process.env.ORBE_SHOTS, 'ext-darkreader-popup.png'), (await pop.webContents.capturePage()).toPNG());

      // Réglage : luminosité +, lue ensuite dans le stockage de l'extension.
      const stored = () => js(pop.webContents, 'Promise.all([chrome.storage.local.get(null), chrome.storage.sync.get(null)]).then(([l, s]) => JSON.stringify({ local: l, sync: s }).slice(0, 900))');
      console.log('      stockage avant : ' + await stored());
      const clicked = await js(pop.webContents, `(() => {
        const site = document.querySelector('.site-toggle');
        if (!site) return 'bouton du site introuvable';
        site.click();
        return 'clic : ' + site.innerText.trim().replace(/\\s+/g, ' ').slice(0, 40);
      })()`);
      console.log('      ' + clicked);
      await sleep(2500);
      const after = await js(rt.wc, probe);
      check('« activer/désactiver pour ce site » agit sur la page', after && JSON.stringify(after.classes) !== JSON.stringify(before.classes) && after.body !== before.body, { avant: before.body, apres: after.body, classes: after.classes });
      console.log('      stockage après : ' + await stored());
      await js(pop.webContents, 'document.querySelector(".site-toggle") && document.querySelector(".site-toggle").click()');
      await sleep(2500);
      const again = await js(rt.wc, probe);
      check('second clic : la page redevient sombre', again && again.body === before.body, again && again.body);
      // Luminosité : trois crans vers le haut, relus dans le stockage puis sur la page.
      const brightness = () => js(pop.webContents, 'chrome.storage.sync.get(null).then((s) => (s.theme ? s.theme.brightness : "défaut"))');
      const b0 = await brightness();
      // Second passage sur le même profil (ORBE_EXT_KEEP) : le réglage a survécu au redémarrage.
      if (process.env.ORBE_EXT_KEEP) check('réglage conservé après redémarrage', Number(b0) > 100, { luminosite: b0 });
      await js(pop.webContents, '(() => { const up = [...document.querySelectorAll(".updown__button")][1]; for (let i = 0; i < 3; i++) up.click(); })()');
      await sleep(3000);
      const b1 = await brightness();
      const lit = await js(rt.wc, probe);
      check('la luminosité se règle et s’enregistre', b1 !== b0 && Number(b1) > 100, { avant: b0, apres: b1 });
      check('…et la page suit', lit && lit.body !== before.body, { avant: before.body, apres: lit && lit.body });
      extHost.closePopup(w);
    }
    const info = extHost.actionsFor(w).find((x) => x.id === id);
    check('bouton décrit pour la barre latérale', !!(info && info.icon && info.popup), info && { title: info.title, badge: info.badgeText, icon: info.icon.slice(0, 30) + '…' });
  }

  if (wanted.includes('wappalyzer')) {
    const id = IDS.wappalyzer;
    console.log('\nWappalyzer');
    // À l'installation, l'extension ouvre sa page d'accueil (tabs.create) : on
    // l'attend, pour qu'elle ne prenne pas la place de l'onglet étudié.
    const welcome = await until(() => extHost.tabs().some((t) => /wappalyzer\.com/.test(t.url)), 20000);
    check('sa page d’accueil s’ouvre dans un onglet d’Orbe (tabs.create)', !!welcome || !!process.env.ORBE_EXT_KEEP);
    const rt = await open('https://wordpress.org/', 6000);
    w.activate(rt.id);
    await sleep(500);
    check('aucune erreur dans le service worker', swErrors(id).length === 0, swErrors(id).slice(0, 6).join(' | '));
    const pop = await popup(id);
    check('la fenêtre surgissante s’ouvre', !!pop);
    if (pop) {
      await sleep(2500);
      const text = await js(pop.webContents, 'document.body.innerText.replace(/\\s+/g, " ").slice(0, 700)');
      const techs = await js(pop.webContents, '[...document.querySelectorAll(".technology__name, .technology .technology__link, [class*=technology__name]")].map((e) => e.innerText.trim()).filter(Boolean).slice(0, 30)');
      const seen = await js(pop.webContents, 'chrome.tabs.query({ active: true, currentWindow: true }).then((t) => t.map((x) => x.url))');
      console.log('      onglet actif vu par la fenêtre surgissante : ' + JSON.stringify(seen) + ' · onglets : ' + JSON.stringify(extHost.tabs().map((t) => (t.active ? '*' : '') + t.url)));
      check('elle liste des technologies pour l’onglet actif', Array.isArray(techs) && techs.some((x) => /^WordPress/.test(x)) && Array.isArray(seen) && seen[0] === rt.wc.getURL(), `${pop.getContentSize().join('×')} · ${JSON.stringify(techs)} · ${text}`);
      check('aucune erreur dans sa console', pop.errors.length === 0, pop.errors.slice(0, 4).join(' | '));
      if (process.env.ORBE_SHOTS) require('fs').writeFileSync(require('path').join(process.env.ORBE_SHOTS, 'ext-wappalyzer-popup.png'), (await pop.webContents.capturePage()).toPNG());
      extHost.closePopup(w);
    }
    const info = extHost.actionsFor(w).find((x) => x.id === id);
    check('bouton décrit pour la barre latérale', !!(info && info.icon), info && { title: info.title, badge: info.badgeText });
  }

  if (wanted.includes('ublock')) {
    const id = IDS.ublock;
    console.log('\nuBlock Origin Lite');
    const rt = await open('https://www.lemonde.fr/', 5000);
    w.activate(rt.id);
    check('aucune erreur dans le service worker', swErrors(id).length === 0, swErrors(id).slice(0, 6).join(' | '));
    const pop = await popup(id);
    check('la fenêtre surgissante s’ouvre', !!pop);
    if (pop) {
      const text = await js(pop.webContents, 'document.body.innerText.replace(/\\s+/g, " ").slice(0, 300)');
      check('elle affiche le site de l’onglet actif', typeof text === 'string' && /lemonde/i.test(text), `${pop.getContentSize().join('×')} · ${text}`);
      check('aucune erreur dans sa console', pop.errors.length === 0, pop.errors.slice(0, 4).join(' | '));
      extHost.closePopup(w);
    }
  }

  for (const id of Object.keys(consoleOf)) {
    const lines = consoleOf[id].filter((m) => !/^\[(info|log|debug|0|1)\]/.test(m));
    if (lines.length) console.log(`\n  console du service worker ${id} :\n    ` + lines.slice(0, 15).join('\n    '));
  }
  console.log(`\n${failed ? failed + ' point(s) en échec' : 'Tout fonctionne'}\n`);
};
