// Couche d'API chrome.* (src/main/ext-api.js, src/preload/ext.js) : essai de
// bout en bout dans le vrai navigateur, sans réseau, avec l'extension
// tests/ext-fixture et un petit serveur local.
//   npm run test:ext      (ou : ORBE_SCENARIO=tests/ext-api.js node scripts/dev.js --selftest)
const http = require('http');
const path = require('path');
const { BrowserWindow } = require('electron');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(fn, label, timeout = 8000) {
  const t0 = Date.now();
  for (;;) {
    let v;
    try { v = await fn(); } catch { v = false; }
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error('Délai dépassé : ' + label);
    await sleep(40);
  }
}

function serve() {
  const server = http.createServer((req, res) => {
    const name = new URL(req.url, 'http://x').pathname.slice(1) || 'accueil';
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><meta charset="utf-8"><title>Page ${name}</title><body><h1>${name}</h1><a id="lien" href="/autre">lien</a></body>`);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

module.exports = async function extApiTest({ first: w, OrbeWindow, win, extApi, extHost }) {
  const results = [];
  let failed = 0;
  const check = (name, ok, detail = '') => {
    results.push(name);
    if (!ok) failed += 1;
    console.log(`${ok ? '  ✓' : '  ✗'} ${name}${ok || !detail ? '' : ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail))}`);
  };
  // Une exception non rattrapée ferait apparaître une boîte d'erreur bloquante.
  const uncaught = [];
  process.on('uncaughtException', (err) => { uncaught.push(String((err && err.stack) || err)); });
  console.log('\nOrbe — API des extensions\n');

  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const ses = w.session;
  const swLogs = [];
  ses.serviceWorkers.on('console-message', (e, d) => swLogs.push(d.message));
  // Pas de boîte de dialogue pendant l'essai : la demande est notée, puis acceptée.
  const asked = [];
  extApi.host.confirmPermissions = async (ext, names) => { asked.push(names.join(',')); return true; };

  const ext = await ses.extensions.loadExtension(path.join(__dirname, 'ext-fixture'));
  // Ouvert après le chargement de l'extension : son script de contenu s'y exécute.
  const a = w.newTab(base + '/a');
  await until(() => w.data.tabs[a.id].title === 'Page a', 'page a');
  const rtA = win.live.get(a.id);
  // Juste après le chargement de l'extension, Chromium peut ne pas avoir encore
  // transmis ses scripts de contenu au nouveau processus : on recharge alors la page.
  for (let i = 0; i < 4; i++) {
    if (await until(() => rtA.wc.executeJavaScript('!!document.documentElement.dataset.orbeTab'), 'script de contenu', 1500).catch(() => false)) break;
    rtA.wc.reload();
  }
  // Page d'extension pilotée par le test : ni onglet, ni fenêtre surgissante.
  const pilot = new BrowserWindow({ show: false, webPreferences: { session: ses, sandbox: true, contextIsolation: true } });
  await pilot.loadURL(ext.url + 'options.html');
  const page = (js) => pilot.webContents.executeJavaScript(js);
  const sw = (msg) => page(`sw(${JSON.stringify(msg)})`);
  const call = async (p, ...args) => {
    const r = await sw({ type: 'call', path: p, args });
    if (!r || r.error) throw new Error((r && r.error) || 'sans réponse');
    return r.value;
  };
  const events = async (name) => (await sw({ type: 'log' })).filter((e) => e.name === name);

  // Motifs d'URL et couleurs (fonctions pures)
  const mp = extApi.matchPattern;
  check('motifs d’URL de Chrome', mp('<all_urls>', 'https://a.fr/x') && !mp('<all_urls>', 'chrome://settings/') && mp('*://*.exemple.fr/*', 'http://www.exemple.fr/a?b=1') && mp('*://*.exemple.fr/*', 'https://exemple.fr/')
    && !mp('*://*.exemple.fr/*', 'https://mauvaisexemple.fr/') && !mp('https://exemple.fr/*', 'http://exemple.fr/') && mp('https://exemple.fr/a/*', 'https://exemple.fr/a/b') && !mp('https://exemple.fr/a/*', 'https://exemple.fr/b')
    && mp('http://127.0.0.1/*', 'http://127.0.0.1:8080/x') && !mp('*://*/*', 'file:///etc/hosts') && !mp('n’importe quoi', 'https://a.fr/'));
  check('couleurs de pastille', extApi.parseColor('#f00').join() === '255,0,0,255' && extApi.parseColor([1, 2, 3]).join() === '1,2,3,255' && extApi.parseColor('rgba(0, 128, 255, 0.5)').join() === '0,128,255,128' && extApi.parseColor('#11223344').join() === '17,34,51,68');

  // Mise en place
  const early = await until(() => sw({ type: 'early' }), 'service worker');
  check('le service worker voit les API ajoutées dès sa première ligne', early.permissions === 'object' && early.onRemoved === 'function' && early.windows === 'object' && early.cookies === 'object', early);
  check('`browser`, quand Chromium le fournit, est complété comme `chrome`', early.browser === 'absent' || early.browser === 'function', early.browser);
  check('les pages d’extension les voient aussi', await page('typeof chrome.permissions.contains === "function" && typeof chrome.windows.getAll === "function" && typeof chrome.cookies.get === "function"'));
  check('une API non déclarée reste absente (notifications)', await page('typeof chrome.notifications === "undefined"'));

  // permissions
  const all = await call('permissions.getAll');
  check('permissions.getAll reprend le manifeste', all.permissions.includes('tabs') && all.permissions.includes('cookies') && !all.permissions.includes('contextMenus') && all.origins.includes('http://127.0.0.1/*'), all);
  check('permissions.contains : requise oui, optionnelle non', await call('permissions.contains', { permissions: ['tabs'] }) === true && await call('permissions.contains', { permissions: ['contextMenus'] }) === false);
  check('une API optionnelle non accordée est refusée', await call('contextMenus.removeAll').then(() => false, (e) => /contextMenus/.test(e.message)));
  check('permissions.request refuse ce qui n’est pas au manifeste', await call('permissions.request', { permissions: ['history'] }).then(() => false, () => true));
  check('permissions.request refuse une origine hors manifeste', await call('permissions.request', { origins: ['https://exemple.fr/*'] }) === false);
  check('permissions.request demande, puis accorde', await call('permissions.request', { permissions: ['contextMenus'] }) === true && asked.join() === 'contextMenus' && await call('permissions.contains', { permissions: ['contextMenus'] }) === true);
  await until(async () => (await events('permissions.onAdded')).length === 1, 'permissions.onAdded');
  check('permissions.onAdded est émis', true);

  // tabs
  let tabs = await call('tabs.query', {});
  check('tabs.query liste les onglets d’Orbe, avec l’identifiant du webContents', tabs.length === 1 && tabs[0].id === rtA.wc.id && tabs[0].url === base + '/a' && tabs[0].title === 'Page a' && tabs[0].windowId === w.win.id, tabs);
  let active = await call('tabs.query', { active: true, currentWindow: true });
  check('tabs.query({ active, currentWindow }) donne l’onglet actif d’Orbe', active.length === 1 && active[0].id === rtA.wc.id && active[0].active === true);
  check('l’identifiant d’onglet est celui qu’Electron attend (tabs.sendMessage natif)', await call('tabs.sendMessage', rtA.wc.id, 'titre') === 'Page a');
  check('le script de contenu reçoit le même identifiant (sender.tab.id)', await until(() => rtA.wc.executeJavaScript('document.documentElement.dataset.orbeTab'), 'script de contenu') === String(rtA.wc.id));

  const created = await call('tabs.create', { url: base + '/b' });
  const bId = Object.keys(w.data.tabs).find((id) => win.live.get(id) && win.live.get(id).wc.id === created.id);
  check('tabs.create ouvre un onglet actif dans Orbe', !!bId && w.activeId === bId && created.active === true && created.windowId === w.win.id, created);
  await until(() => w.data.tabs[bId].title === 'Page b', 'page b');
  await until(async () => (await events('tabs.onUpdated')).some((e) => e.args[0] === created.id && e.args[1].status === 'complete'), 'tabs.onUpdated');
  const upd = (await events('tabs.onUpdated')).filter((e) => e.args[0] === created.id);
  check('tabs.onCreated, onActivated et onUpdated sont émis', (await events('tabs.onCreated')).some((e) => e.args[0].id === created.id) && (await events('tabs.onActivated')).some((e) => e.args[0].tabId === created.id)
    && upd.some((e) => e.args[1].url === base + '/b') && upd.some((e) => e.args[1].title === 'Page b') && upd.every((e) => e.args[2].id === created.id), upd.map((e) => e.args[1]));
  check('webNavigation.onCommitted et onCompleted suivent la page', (await events('webNavigation.onCommitted')).some((e) => e.args[0].tabId === created.id && e.args[0].url === base + '/b' && e.args[0].frameId === 0)
    && (await events('webNavigation.onCompleted')).some((e) => e.args[0].tabId === created.id));
  const bg = await call('tabs.create', { url: base + '/c', active: false });
  check('tabs.create({ active: false }) n’active pas l’onglet', w.activeId === bId && bg.active === false);
  check('tabs.get et tabs.query({ url })', (await call('tabs.get', bg.id)).id === bg.id && (await call('tabs.query', { url: base + '/c*' })).length === 1 && (await call('tabs.query', { url: 'https://*/*' })).length === 0);
  await call('tabs.update', rtA.wc.id, { active: true });
  check('tabs.update({ active }) change d’onglet', w.activeId === a.id);
  await call('tabs.update', bg.id, { url: base + '/d' });
  await until(async () => (await call('tabs.get', bg.id)).title === 'Page d', 'tabs.update url');
  check('tabs.update({ url }) navigue', true);
  check('tabs.update sans identifiant vise l’onglet actif', (await call('tabs.update', { muted: true })).id === rtA.wc.id && rtA.wc.isAudioMuted());
  rtA.wc.setAudioMuted(false);
  check('tabs.create refuse file: et les pages d’Orbe', await call('tabs.create', { url: 'file:///etc/hosts' }).then(() => false, () => true) && await call('tabs.create', { url: 'orbe://app/settings.html' }).then(() => false, () => true));
  await call('tabs.remove', [bg.id]);
  check('tabs.remove ferme l’onglet', (await call('tabs.query', {})).length === 2 && !Object.keys(w.data.tabs).some((id) => win.live.get(id) && win.live.get(id).wc.id === bg.id));
  await until(async () => (await events('tabs.onRemoved')).some((e) => e.args[0] === bg.id), 'tabs.onRemoved');
  check('tabs.onRemoved est émis', true);
  const failedGet = await sw({ type: 'callback', path: 'tabs.get', args: [987654] });
  check('appel avec rappel : erreur dans runtime.lastError', failedGet.value === undefined && /987654/.test(failedGet.lastError || ''), failedGet);
  const okGet = await sw({ type: 'callback', path: 'tabs.get', args: [rtA.wc.id] });
  check('appel avec rappel : résultat', okGet.value && okGet.value.id === rtA.wc.id && okGet.lastError === null);
  const nativeErr = await sw({ type: 'callback', path: 'tabs.sendMessage', args: [987654, 'x'] });
  check('runtime.lastError d’Electron reste lisible', typeof nativeErr.lastError === 'string' && nativeErr.lastError.length > 0, nativeErr);
  // Écran éteint ou fenêtre masquée : Chromium ne peut rien capturer, ce n'est pas la couche d'API.
  const shot = await call('tabs.captureVisibleTab').catch((err) => err);
  if (shot instanceof Error && /Viz|capture/i.test(shot.message)) console.log('  – tabs.captureVisibleTab non vérifié : ' + shot.message);
  else check('tabs.captureVisibleTab rend une image', /^data:image\/jpeg;base64,.{100,}/.test(shot), String(shot).slice(0, 80));

  // windows
  const cur = await call('windows.getCurrent', { populate: true });
  check('windows.getCurrent décrit la fenêtre d’Orbe', cur.id === w.win.id && cur.type === 'normal' && cur.tabs.length === 2 && cur.width > 0, cur);
  check('windows.getAll et getLastFocused', (await call('windows.getAll')).length === OrbeWindow.all.length && (await call('windows.getLastFocused')).id === w.win.id);

  // cookies
  await call('cookies.set', { url: base + '/', name: 'orbe', value: 'bonjour', expirationDate: Math.floor(Date.now() / 1000) + 3600 });
  const cookie = await call('cookies.get', { url: base + '/', name: 'orbe' });
  check('cookies.set puis cookies.get', cookie && cookie.value === 'bonjour' && cookie.domain === '127.0.0.1' && cookie.session === false, cookie);
  check('le cookie est bien dans la session du profil', (await ses.cookies.get({ url: base + '/', name: 'orbe' })).length === 1);
  check('cookies.getAll filtre par nom', (await call('cookies.getAll', { name: 'orbe' })).length === 1);
  check('cookies.get refuse un site hors des autorisations', await call('cookies.get', { url: 'https://exemple.fr/', name: 'x' }).then(() => false, () => true));
  await ses.cookies.set({ url: 'https://exemple.fr/', name: 'secret', value: '1' });
  check('cookies.getAll ne rend que les sites autorisés', !(await call('cookies.getAll', {})).some((c) => c.name === 'secret'));
  await call('cookies.remove', { url: base + '/', name: 'orbe' });
  check('cookies.remove', await call('cookies.get', { url: base + '/', name: 'orbe' }) === null);
  await until(async () => (await events('cookies.onChanged')).some((e) => e.args[0].removed && e.args[0].cookie.name === 'orbe'), 'cookies.onChanged');
  check('cookies.onChanged est émis, sans les cookies des autres sites', !(await events('cookies.onChanged')).some((e) => e.args[0].cookie.name === 'secret'));

  // contextMenus
  await call('contextMenus.create', { id: 'm1', title: 'Chercher « %s »', contexts: ['selection'] });
  await call('contextMenus.create', { id: 'm2', title: 'Sur la page', contexts: ['page'] });
  await call('contextMenus.create', { id: 'm3', title: 'Coché', type: 'checkbox', contexts: ['all'] });
  let menu = extApi.contextMenuItems(rtA.wc, { pageURL: base + '/a', selectionText: 'orbe' });
  check('contextMenus : éléments regroupés sous le nom de l’extension', menu.length === 1 && menu[0].label === ext.name && menu[0].submenu.map((m) => m.label).join('|') === 'Chercher « orbe »|Coché', menu);
  menu = extApi.contextMenuItems(rtA.wc, { pageURL: base + '/a' });
  check('contextMenus : le contexte choisit les éléments', menu[0].submenu.map((m) => m.label).join('|') === 'Sur la page|Coché');
  menu[0].submenu[1].click();
  await until(async () => (await events('contextMenus.onClicked')).length === 1, 'contextMenus.onClicked');
  const clicked = (await events('contextMenus.onClicked'))[0].args;
  check('contextMenus.onClicked reçoit l’élément et l’onglet', clicked[0].menuItemId === 'm3' && clicked[0].checked === true && clicked[0].pageUrl === base + '/a' && clicked[1].id === rtA.wc.id, clicked);
  await call('contextMenus.update', 'm2', { title: 'Renommé' });
  await call('contextMenus.remove', 'm1');
  check('contextMenus.update et remove', extApi.contextMenuItems(rtA.wc, { pageURL: base + '/a' })[0].submenu.map((m) => m.label).join('|') === 'Renommé|Coché');
  let tpl = null;
  const popupMenu = w.popup;
  w.popup = (t) => { tpl = t; };
  w.pageMenu(rtA, { pageURL: base + '/a', x: 5, y: 5 });
  w.popup = popupMenu;
  check('le menu contextuel d’Orbe contient ceux de l’extension', !!tpl && tpl.some((i) => i.label === ext.name && i.submenu.length === 2));
  await call('contextMenus.removeAll');
  check('contextMenus.removeAll', extApi.contextMenuItems(rtA.wc, { pageURL: base + '/a' }).length === 0);
  check('permissions.remove retire l’API optionnelle', await call('permissions.remove', { permissions: ['contextMenus'] }) === true && await call('permissions.contains', { permissions: ['contextMenus'] }) === false);
  await until(async () => (await events('permissions.onRemoved')).length === 1, 'permissions.onRemoved');
  check('permissions.onRemoved est émis', true);

  // action et fenêtre surgissante
  await call('action.setBadgeText', { text: '7' });
  await call('action.setBadgeBackgroundColor', { color: '#ff0000' });
  await call('action.setBadgeText', { text: '9', tabId: created.id });
  await call('action.setTitle', { title: 'Titre changé' });
  let info = extHost.actionsFor(w).find((x) => x.id === ext.id);
  check('action : pastille, couleur et titre lus par Orbe', info && info.badgeText === '7' && info.badgeColor === 'rgba(255, 0, 0, 1.000)' && info.title === 'Titre changé' && info.popup === ext.url + 'popup.html' && info.enabled, info);
  check('action : valeur propre à un onglet', await call('action.getBadgeText', { tabId: created.id }) === '9' && await call('action.getBadgeText', {}) === '7' && extApi.actionInfo(ses, ext.id, created.id).badgeText === '9');
  check('action.getBadgeBackgroundColor rend [r, v, b, a]', (await call('action.getBadgeBackgroundColor', {})).join() === '255,0,0,255');

  const pop = extHost.openPopup(w, ext.id, { x: 240, y: 60 }, { keepOpen: true });
  check('openPopup ouvre une fenêtre sur la page de l’extension', pop instanceof BrowserWindow);
  const seen = await until(() => pop.webContents.executeJavaScript('window.activeTab'), 'onglet actif vu par la fenêtre surgissante');
  check('la fenêtre surgissante trouve l’onglet actif d’Orbe', seen.id === rtA.wc.id && seen.url === base + '/a' && seen.title === 'Page a', seen);
  check('…et n’apparaît pas elle-même parmi les onglets', (await pop.webContents.executeJavaScript('call("tabs.query", {})')).every((t) => t.id !== pop.webContents.id) && await pop.webContents.executeJavaScript('call("tabs.getCurrent")') === undefined);
  await until(() => pop.getContentSize()[0] === 300 && pop.getContentSize()[1] === 180, 'taille de la fenêtre surgissante').then(() => check('elle prend la taille de son contenu (300 × 180)', true), () => check('elle prend la taille de son contenu (300 × 180)', false, pop.getContentSize().join('×')));
  const wb = w.win.getContentBounds();
  check('elle est ancrée dans la fenêtre d’Orbe', pop.getBounds().x === wb.x + 240 && pop.getBounds().y === wb.y + 60 && pop.getParentWindow() === w.win, pop.getBounds());
  check('le service worker voit la même fenêtre courante pendant ce temps', (await call('tabs.query', { active: true, lastFocusedWindow: true }))[0].id === rtA.wc.id);
  extHost.closePopup(w);
  await until(() => pop.isDestroyed(), 'fermeture de la fenêtre surgissante');
  check('closePopup la referme', extHost.popups.size === 0);

  await call('action.setPopup', { popup: '' });
  check('sans fenêtre surgissante, le clic émet action.onClicked', extHost.openPopup(w, ext.id) === true);
  await until(async () => (await events('action.onClicked')).length === 1, 'action.onClicked');
  check('action.onClicked reçoit l’onglet actif', (await events('action.onClicked'))[0].args[0].id === rtA.wc.id);

  // Fenêtre d'Orbe fermée alors que la fenêtre surgissante est ouverte.
  await call('action.setPopup', { popup: 'popup.html' });
  const w2 = new OrbeWindow();
  await until(() => w2.win.isVisible(), 'seconde fenêtre');
  const pop2 = extHost.openPopup(w2, ext.id, null, { keepOpen: true });
  await until(() => pop2.webContents.executeJavaScript('document.readyState === "complete"'), 'seconde fenêtre surgissante');
  w2.win.close();
  await until(() => pop2.isDestroyed() && OrbeWindow.all.length === 1, 'fermeture de la seconde fenêtre');
  await sleep(300);
  check('fermer la fenêtre d’Orbe ferme sa fenêtre surgissante, sans erreur', extHost.popups.size === 0 && uncaught.length === 0, uncaught.join(' | '));
  await until(async () => (await call('windows.getAll')).length === 1, 'windows.getAll');
  w.win.focus();

  // divers
  check('fontSettings.getFontList', (await call('fontSettings.getFontList')).some((f) => f.fontId === 'Arial'));
  check('commands.getAll lit le manifeste', (await call('commands.getAll')).map((c) => c.name).join() === 'essai');
  await call('storage.sync.set', { cle: 'valeur' });
  await call('storage.local.set', { ici: 1 });
  const syncAll = await call('storage.sync.get', null);
  const localAll = await call('storage.local.get', null);
  check('storage.sync garde ses valeurs, à part de storage.local', (await call('storage.sync.get', 'cle')).cle === 'valeur' && Object.keys(syncAll).join() === 'cle' && Object.keys(localAll).join() === 'ici'
    && (await call('storage.sync.get', { cle: 0, absente: 5 })).absente === 5 && (await call('storage.local.get', 'cle')).cle === undefined, { syncAll, localAll });
  // Electron n'annonce pas les changements de stockage au service worker : il
  // les calcule pour ses propres écritures, et reçoit ceux des pages par relais.
  await page('chrome.storage.local.set({ page: 2 })');
  await until(async () => (await events('storage.onChanged')).length >= 3, 'storage.onChanged', 4000).catch(() => {});
  await sleep(600);
  const changed = await events('storage.onChanged');
  check('storage.onChanged arrive au service worker, une seule fois, avec la bonne zone', changed.map((e) => e.args[0].join() + ':' + e.args[1]).join(' ') === 'cle:sync ici:local page:local', changed.map((e) => e.args));
  check('…et dans les pages de l’extension', await page('new Promise((r) => { chrome.storage.onChanged.addListener((c, a) => r(Object.keys(c).join() + ":" + a)); chrome.storage.sync.set({ vu: 1 }); })') === 'vu:sync');
  await call('storage.sync.remove', 'vu');
  await call('storage.sync.clear');
  check('storage.sync.clear ne touche pas à storage.local', Object.keys(await call('storage.sync.get', null)).length === 0 && (await call('storage.local.get', 'ici')).ici === 1);
  await call('runtime.openOptionsPage');
  const optRt = await until(() => win.live.get(w.activeId) && win.live.get(w.activeId).wc.getURL() === ext.url + 'options.html' && win.live.get(w.activeId), 'page d’options');
  await until(() => optRt.wc.executeJavaScript('typeof window.call === "function"'), 'page d’options chargée');
  check('runtime.openOptionsPage ouvre la page dans un onglet d’Orbe', (await optRt.wc.executeJavaScript('call("tabs.getCurrent")')).id === optRt.wc.id);
  check('un site web ne reçoit aucune API ajoutée', await rtA.wc.executeJavaScript('typeof chrome === "undefined" || typeof chrome.permissions === "undefined"'));

  // Service worker endormi (Chromium l'arrête après 30 s d'inactivité) : un
  // événement doit le réveiller. Son journal, en mémoire, repart alors de zéro.
  pilot.destroy();
  const asleep = () => !Object.values(ses.serviceWorkers.getAllRunning()).some((i) => i.scope === ext.url);
  if (await until(asleep, 'arrêt du service worker', 50000).catch(() => false)) {
    const late = w.newTab(base + '/tard');
    await until(() => w.data.tabs[late.id].title === 'Page tard', 'page tard');
    const pilot2 = new BrowserWindow({ show: false, webPreferences: { session: ses, sandbox: true, contextIsolation: true } });
    await pilot2.loadURL(ext.url + 'options.html');
    const log = await until(async () => { const l = await pilot2.webContents.executeJavaScript('sw({ type: "log" })'); return l.some((e) => e.name === 'tabs.onUpdated' && e.args[1].title === 'Page tard') && l; }, 'événement après réveil');
    check('un événement réveille le service worker endormi', !log.some((e) => e.name === 'permissions.onAdded') && log.some((e) => e.name === 'tabs.onCreated'), log.map((e) => e.name));
    check('les autorisations accordées survivent au réveil', (await pilot2.webContents.executeJavaScript('sw({ type: "call", path: "permissions.contains", args: [{ permissions: ["contextMenus"] }] })')).value === false);
    pilot2.destroy();
  } else console.log('  – réveil du service worker non vérifié : il ne s’est pas arrêté');

  const errors = swLogs.filter((m) => /error|not a function|undefined/i.test(m));
  check('aucune erreur dans la console du service worker', errors.length === 0, errors.join(' | '));

  check('aucune exception dans le processus principal', uncaught.length === 0, uncaught.join(' | '));
  server.close();
  console.log(`\n${results.length - failed}/${results.length} vérifications réussies\n`);
  if (failed) throw new Error(`${failed} vérification(s) en échec`);
};
