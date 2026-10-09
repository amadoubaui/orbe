// Mises à jour (src/main/updates.js) : GitHub est remplacé par un serveur local.
// Appelé par tests/selftest.js, ou seul :
//   ORBE_SCENARIO=tests/mises-a-jour.js node scripts/dev.js --selftest
// Aucune requête ne part vers Internet.
const crypto = require('crypto');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Menu } = require('electron');

const { until } = require('./outils');

module.exports = async function majTests(ctx) {
  const { first: w, store, updates, openSettings, panes } = ctx;
  let failed = 0;
  const check = ctx.check || ((name, ok, detail = '') => { if (!ok) failed += 1; console.log(`${ok ? '  ✓' : '  ✗'} ${name}${ok || !detail ? '' : ' — ' + detail}`); });
  const ui = (js) => w.ui.webContents.executeJavaScript(js);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orbe-maj-'));
  const mine = updates.assetName('9.9.9');
  const zip = Buffer.concat([Buffer.from('PK\u0003\u0004'), crypto.randomBytes(70000)]);
  const sha = crypto.createHash('sha256').update(zip).digest('hex');

  // --- Serveur qui joue GitHub ----------------------------------------------------
  const seen = [];
  let reply = null; // (req, res) -> void
  let served = zip;
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url, headers: req.headers });
    if (req.url.startsWith('/archive/')) { res.setHeader('content-type', 'application/zip'); return res.end(served); }
    return reply(req, res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const release = (over = {}) => ({
    tag_name: 'v9.9.9', name: 'Orbe 9.9.9', draft: false, prerelease: false, published_at: '2026-10-01T10:00:00Z',
    html_url: 'https://exemple.invalid/ailleurs',
    body: 'Nouveautés\r\n- import depuis Chrome\n<img src=x onerror="document.title=\'piégé\'"><script>document.title="piégé"</script>‮',
    assets: mine ? [{ name: mine, size: zip.length, digest: 'sha256:' + sha, browser_download_url: `${base}/archive/${mine}` }] : [],
    ...over,
  });
  const json = (o) => (req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };

  // --- Lecture de la réponse (sans réseau) ------------------------------------------
  check('versions comparées par numéro, pas par ordre alphabétique',
    updates.compare('0.12.1', '0.12.0') > 0 && updates.compare('0.9.0', '0.12.0') < 0 && updates.compare('v1.0.0', '0.99.99') > 0 && updates.compare('0.12.0', 'v0.12.0') === 0
    && updates.compare('1.0.0-beta', '0.1.0') === 0 && updates.compare('abc', '0.1.0') === 0 && updates.compare('', '') === 0);
  const gh = (over) => updates.parseRelease({ tag_name: 'v1.2.3', body: 'x', assets: [], ...over }, { platform: 'darwin', arch: 'arm64' });
  const macAsset = { name: 'Orbe-1.2.3-mac-arm64.zip', size: 10, browser_download_url: 'https://github.com/amadoubaui/orbe/releases/download/v1.2.3/Orbe-1.2.3-mac-arm64.zip' };
  const good = gh({ assets: [{ ...macAsset, digest: 'sha256:' + 'a'.repeat(64) }, { ...macAsset, name: 'Orbe-1.2.3-windows-x64.zip' }], html_url: 'https://pirate.example/' });
  check('version publiée : numéro, page reconstruite dans le dépôt d’Orbe, archive de ce système',
    good.version === '1.2.3' && good.url === 'https://github.com/amadoubaui/orbe/releases/tag/v1.2.3' && good.asset.name === 'Orbe-1.2.3-mac-arm64.zip' && good.asset.digest === 'a'.repeat(64)
    && updates.parseRelease({ tag_name: '1.2.3', assets: [{ ...macAsset, name: 'Orbe-1.2.3-windows-x64.zip', browser_download_url: macAsset.browser_download_url.replace('mac-arm64', 'windows-x64') }] }, { platform: 'win32', arch: 'x64' }).asset.name === 'Orbe-1.2.3-windows-x64.zip'
    && updates.parseRelease({ tag_name: '1.2.3', assets: [macAsset] }, { platform: 'linux', arch: 'x64' }).asset === null, JSON.stringify(good));
  check('brouillon, préversion, numéro illisible ou réponse qui n’est pas un objet : ignorés',
    gh({ draft: true }) === null && gh({ prerelease: true }) === null && gh({ tag_name: 'v1.2' }) === null && gh({ tag_name: '1.2.3; rm -rf' }) === null && gh({ tag_name: 12 }) === null
    && updates.parseRelease(null) === null && updates.parseRelease([]) === null && updates.parseRelease('v1.2.3') === null);
  check('archive hors du dépôt d’Orbe, de taille folle ou d’un autre nom : pas de téléchargement proposé',
    gh({ assets: [{ ...macAsset, browser_download_url: 'https://github.com/pirate/orbe/releases/download/v1.2.3/Orbe-1.2.3-mac-arm64.zip' }] }).asset === null
    && gh({ assets: [{ ...macAsset, browser_download_url: 'http://github.com/amadoubaui/orbe/releases/download/v1.2.3/x.zip' }] }).asset === null
    && gh({ assets: [{ ...macAsset, browser_download_url: 'https://github.com.pirate.example/amadoubaui/orbe/releases/download/x.zip' }] }).asset === null
    && gh({ assets: [{ ...macAsset, size: 5e12 }] }).asset === null && gh({ assets: [{ ...macAsset, size: -1 }] }).asset === null && gh({ assets: [{ ...macAsset, size: '10' }] }).asset === null
    && gh({ assets: [{ ...macAsset, name: 'Orbe-1.2.3-mac-arm64.zip.exe' }] }).asset === null && gh({ assets: 'x' }).asset === null && gh({ assets: [null, 4, 'a'] }).asset === null
    && gh({ assets: [{ ...macAsset, digest: 'sha256:xyz' }] }).asset.digest === '');
  const long = gh({ body: 'é'.repeat(50000), name: 'n'.repeat(900) });
  const dirty = gh({ body: 'a\u0000b‮c\u0007d\r\ne', name: 7 });
  check('notes de version : longueur bornée, caractères de contrôle et d’inversion retirés',
    long.notes.length === updates.MAX_NOTES && long.name.length === 120 && dirty.notes === 'abcd\ne' && dirty.name === '');
  check('seul api.github.com, en HTTPS et sur le dépôt d’Orbe, est accepté pour la question',
    updates.endpointOk(updates.ENDPOINT) && !updates.endpointOk('http://api.github.com/repos/amadoubaui/orbe/releases/latest') && !updates.endpointOk('https://api.github.com/repos/pirate/orbe/releases/latest')
    && !updates.endpointOk('https://api.github.com.pirate.example/repos/amadoubaui/orbe/releases/latest') && !updates.endpointOk('https://pirate.example/') && !updates.endpointOk('file:///etc/passwd') && !updates.endpointOk(''));

  // --- Vérification, contre le serveur local ----------------------------------------
  const before = { ...store.state.updates };
  const opened = [];
  const revealed = [];
  let now = Date.now();
  let shown = 0;
  check('en test, aucune vérification automatique n’est programmée', updates.start() === false);
  // Hors test, une autre adresse que GitHub est refusée : la configuration revient à GitHub.
  const real = updates.internals();
  updates.configure({ test: false, endpoint: `${base}/latest` });
  const pinned = updates.internals().endpoint;
  updates.configure({ test: true, endpoint: 'http://192.168.1.10/latest' });
  check('hors test, ou vers une autre machine, une adresse de substitution est ignorée : la question reste pour GitHub',
    pinned === updates.ENDPOINT && updates.internals().endpoint === updates.ENDPOINT && pinned === 'https://api.github.com/repos/amadoubaui/orbe/releases/latest');
  store.state.updates = {};
  updates.configure({ test: true, endpoint: `${base}/repos/amadoubaui/orbe/releases/latest`, version: '0.12.0', downloadsDir: () => tmp, reveal: (f) => revealed.push(f), open: (u) => opened.push(u), show: () => { shown += 1; }, now: () => now });

  reply = json(release());
  const r1 = await updates.check({ manual: true });
  const st1 = updates.status();
  const h = seen[0] ? seen[0].headers : {};
  check('une version plus récente est annoncée, avec ses notes', r1.state === 'available' && st1.available && st1.latest.version === '9.9.9' && st1.latest.notes.startsWith('Nouveautés\n- import depuis Chrome') && !/‮/.test(st1.latest.notes)
    && st1.latest.url === 'https://github.com/amadoubaui/orbe/releases/tag/v9.9.9' && st1.checkedAt === now, JSON.stringify(st1));
  check('la question ne porte aucun identifiant : ni cookie, ni référent, ni version, agent « Orbe »',
    seen.length === 1 && seen[0].url === '/repos/amadoubaui/orbe/releases/latest' && h['user-agent'] === 'Orbe' && !h.cookie && !h.referer && !h.authorization && !/\?/.test(seen[0].url)
    && !JSON.stringify(h).includes('0.12') && !/electron|chrome/i.test(h['user-agent']), JSON.stringify(h));

  // Note de la barre latérale.
  await until(() => ui('!document.getElementById("update-note").hidden'), 'note de mise à jour affichée');
  check('barre latérale : une ligne discrète annonce la version', (await ui('document.getElementById("update-open").textContent')) === 'Orbe 9.9.9 est disponible');
  await ui('document.getElementById("update-open").click()');
  await until(() => shown === 1, 'clic sur la note');
  check('un clic sur la note ouvre la carte des mises à jour, sans nouvelle requête', shown === 1 && seen.length === 1);
  await ui('document.getElementById("update-close").click()');
  await until(() => ui('document.getElementById("update-note").hidden'), 'note écartée');
  check('« Plus tard » : la note disparaît et ne revient pas pour cette version', updates.note() === null && updates.status().dismissed && store.state.updates.dismissed === '9.9.9');

  // Une vérification automatique par jour au plus.
  const again = await updates.check();
  now += 23 * 3600e3;
  const sameDay = await updates.check();
  check('automatique : pas de seconde question dans la journée', again.state === 'recent' && sameDay.state === 'recent' && seen.length === 1);
  store.state.settings.updateCheck = false;
  now += 2 * updates.DAY;
  const off = await updates.check();
  check('réglage coupé : aucune question automatique, aucune note', off.state === 'disabled' && seen.length === 1 && updates.note() === null);
  store.state.settings.updateCheck = true;
  reply = json(release({ tag_name: 'v9.9.10', assets: [] }));
  const next = await updates.check();
  await until(() => ui('!document.getElementById("update-note").hidden'), 'note pour la version suivante');
  check('le lendemain : nouvelle question, et une version plus récente que celle écartée se signale', next.state === 'available' && seen.length === 2 && updates.note().version === '9.9.10' && updates.status().latest.asset === null);

  // Échecs : silencieux en automatique, dits à la demande.
  const asked = seen.length;
  now += 2 * updates.DAY;
  reply = (req, res) => { res.statusCode = 403; res.setHeader('x-ratelimit-remaining', '0'); res.end('{"message":"API rate limit exceeded"}'); };
  const quota = await updates.check();
  const quiet = updates.status();
  const quotaRetry = await updates.check();
  check('quota de GitHub dépassé : rien n’est affiché, l’annonce précédente reste, pas de nouvelle tentative avant un jour',
    quota.state === 'error' && quiet.error === '' && quiet.available && quiet.latest.version === '9.9.10' && quotaRetry.state === 'recent' && seen.length === asked + 1, JSON.stringify(quiet));
  await updates.check({ manual: true });
  check('à la demande, le quota dépassé est dit', updates.status().error === 'rate');
  reply = (req, res) => { res.setHeader('content-type', 'application/json'); res.end('{"tag_name":"v99.0.0","body":"' + 'x'.repeat(700 * 1024) + '"}'); };
  const big = await updates.check({ manual: true });
  reply = (req, res) => res.end('<html>portail captif</html>');
  const html = await updates.check({ manual: true });
  reply = json({ tag_name: 'v99.0.0', draft: true });
  const draft = await updates.check({ manual: true });
  let followed = 0;
  reply = (req, res) => { if (req.url === '/ailleurs') { followed += 1; return json(release({ tag_name: 'v99.0.0' }))(req, res); } res.statusCode = 302; res.setHeader('location', '/ailleurs'); return res.end(); };
  const redirected = await updates.check({ manual: true });
  check('réponse démesurée, qui n’est pas du JSON, brouillon ou redirection : refusées, la version annoncée ne change pas',
    big.state === 'error' && html.state === 'error' && draft.state === 'error' && redirected.state === 'error' && followed === 0 && updates.status().latest.version === '9.9.10' && updates.status().error === 'offline',
    JSON.stringify({ big, html, draft, redirected, followed }));
  reply = (req) => req.destroy();
  const cut = await updates.check({ manual: true });
  check('connexion coupée : dit à la demande', cut.state === 'error' && updates.status().error === 'offline');
  reply = json(release({ tag_name: 'v0.12.0' }));
  const same = await updates.check({ manual: true });
  reply = json(release({ tag_name: 'v0.11.9' }));
  const older = await updates.check({ manual: true });
  check('même version ou version plus ancienne : Orbe est à jour, aucune note', same.state === 'upToDate' && older.state === 'upToDate' && !updates.status().available && updates.note() === null && updates.status().error === '');
  await until(() => ui('document.getElementById("update-note").hidden'), 'note retirée');

  // --- Réglages : carte des mises à jour --------------------------------------------
  reply = json(release());
  await updates.check({ manual: true });
  const sw = openSettings('advanced');
  const js = (code) => sw.webContents.executeJavaScript(code);
  await until(() => sw.isVisible(), 'réglages affichés');
  await until(() => js('!document.getElementById("update-new").hidden'), 'carte de la nouvelle version');
  const card = JSON.parse(await js(`JSON.stringify({
    version: document.getElementById('update-version').textContent, state: document.getElementById('update-state').textContent,
    head: document.getElementById('update-headline').textContent, notes: document.getElementById('update-notes').textContent,
    html: document.getElementById('update-notes').children.length + document.querySelectorAll('#update-card img, #update-card script').length,
    title: document.title, box: document.getElementById('updateCheck').checked,
    dl: !document.getElementById('update-download').hidden, page: document.getElementById('update-page').textContent, check: document.getElementById('update-check').textContent,
  })`));
  check('réglages : version en cours, version disponible, notes de version',
    card.version === 'Orbe 0.12.0' && card.state === 'Orbe 9.9.9 est disponible' && card.head.startsWith('Orbe 9.9.9 est disponible') && card.notes.includes('import depuis Chrome') && card.box === true && card.page === 'Page de téléchargement' && card.check === 'Rechercher' && card.dl === !!mine, JSON.stringify(card));
  check('les notes venues de GitHub sont du texte : aucune balise n’est interprétée', card.html === 0 && card.notes.includes('<img src=x onerror=') && card.title !== 'piégé');
  await js('document.getElementById("update-page").click()');
  await until(() => opened.length === 1, 'page de téléchargement demandée');
  check('« Page de téléchargement » ouvre la page de la version, dans le dépôt d’Orbe', opened[0] === 'https://github.com/amadoubaui/orbe/releases/tag/v9.9.9');
  await js('document.getElementById("updateCheck").click()');
  await until(() => store.state.settings.updateCheck === false, 'réglage coupé depuis la carte');
  await js('document.getElementById("updateCheck").click()');
  await until(() => store.state.settings.updateCheck === true, 'réglage rétabli');
  check('l’interrupteur de la carte coupe et rétablit la recherche automatique', true);
  const n = seen.length;
  await js('document.getElementById("update-check").click()');
  await until(() => seen.length === n + 1 && !updates.status().checking, '« Rechercher » interroge le serveur');
  check('« Rechercher » pose la question tout de suite', seen.length === n + 1);

  // --- Téléchargement de l'archive ----------------------------------------------------
  if (mine) {
    await js('document.getElementById("update-download").click()');
    await until(() => updates.status().download.state === 'done', 'archive téléchargée');
    const d = updates.status().download;
    await until(async () => (await js('document.getElementById("update-dl-state").textContent')).includes(mine), 'réglages : archive annoncée');
    check('archive téléchargée dans le dossier des téléchargements, taille et empreinte SHA-256 vérifiées, montrée dans son dossier',
      d.path === path.join(tmp, mine) && fs.readFileSync(d.path).equals(zip) && d.verified && revealed.length === 1 && revealed[0] === d.path && !fs.existsSync(d.path + '.part')
      && (await js('!document.getElementById("update-reveal").hidden && document.getElementById("update-download").hidden')), JSON.stringify(d));
    const dlReq = seen.filter((x) => x.url.startsWith('/archive/')).pop();
    check('le téléchargement non plus ne porte ni cookie ni référent', !!dlReq && !dlReq.headers.cookie && !dlReq.headers.referer && dlReq.headers['user-agent'] === 'Orbe');
    const again2 = await updates.fetchAsset();
    check('second téléchargement : rangé à côté, sans écraser le premier', again2.ok && again2.path === path.join(tmp, mine.replace('.zip', ' (1).zip')) && fs.existsSync(path.join(tmp, mine)));
    served = Buffer.concat([zip.subarray(0, zip.length - 1), Buffer.from([zip[zip.length - 1] ^ 1])]);
    const tampered = await updates.fetchAsset();
    served = Buffer.concat([zip, Buffer.from('en trop')]);
    const longer = await updates.fetchAsset();
    served = zip.subarray(0, 1000);
    const shorter = await updates.fetchAsset();
    const left = fs.readdirSync(tmp).sort();
    check('archive modifiée, plus longue ou tronquée : refusée, rien n’est laissé dans le dossier',
      tampered.error === 'digest' && longer.error === 'size' && shorter.error === 'size' && left.length === 2 && !left.some((f) => f.endsWith('.part')) && revealed.length === 2, JSON.stringify({ tampered, longer, shorter, left }));
    await until(async () => (await js('document.getElementById("update-dl-state").textContent')) === 'Archive refusée : sa taille n’est pas celle annoncée.', 'réglages : refus affiché');
    check('le refus est expliqué dans les réglages', true);
    served = zip;
  }

  // --- Menu ----------------------------------------------------------------------------
  ctx.menu.build();
  const labels = [];
  const walk = (m) => { for (const it of m.items) { labels.push(it.label); if (it.submenu) walk(it.submenu); } };
  walk(Menu.getApplicationMenu());
  check('barre de menus : « Rechercher les mises à jour… »', labels.includes('Rechercher les mises à jour…'));
  check('volet des réglages retenu : Avancé', panes.window === sw && store.state.window.settingsPane === 'advanced');

  sw.close();
  store.state.window.settingsPane = 'general';
  store.state.updates = before;
  updates.configure(real);
  store.save();
  if (server.closeAllConnections) server.closeAllConnections();
  await new Promise((r) => server.close(r));
  if (!ctx.check && failed) throw new Error(`${failed} vérification(s) en échec`);
};
