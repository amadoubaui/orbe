// Tableaux : tests de bout en bout, sans réseau.
// Appelé par tests/selftest.js, ou seul :
//   ORBE_SCENARIO=tests/easels.js node scripts/dev.js --selftest
// Les éléments sont créés par le code de la page lui-même : vraies entrées de
// souris et de clavier (sendInputEvent) ou fonctions qu'appellent ces entrées.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Menu } = require('electron');
const platform = require('../src/main/platform');
const easels = require('../src/main/easels');

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

module.exports = async function easelTests(ctx) {
  const { first: w, win, commands } = ctx;
  const standalone = !ctx.check;
  let failed = 0;
  const check = ctx.check || ((name, ok, detail = '') => { if (!ok) failed += 1; console.log(`${ok ? '  ✓' : '  ✗'} ${name}${ok || !detail ? '' : ' — ' + detail}`); });
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end('<!doctype html><meta charset="utf-8"><title>Page source</title><body style="margin:0;font:16px sans-serif"><div style="width:300px;height:200px;background:#c33"></div><h1>Source</h1></body>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const shots = process.env.ORBE_SHOTS;
  const back = w.activeId;

  // --- Création -----------------------------------------------------------------
  const accels = [];
  const collect = (m) => { for (const it of m.items) { if (it.accelerator) accels.push(it.accelerator); if (it.submenu) collect(it.submenu); } };
  collect(Menu.getApplicationMenu());
  const before = easels.list().length;
  w.run('newEasel');
  const tabId = w.activeId;
  const tab = w.data.tabs[tabId];
  const id = new URL(tab.url).searchParams.get('id');
  const file = path.join(easels.root(), id + '.json');
  const dir = path.join(easels.root(), id);
  const page = () => win.live.get(tabId).wc;
  const js = (code) => page().executeJavaScript(code);
  const disk = () => JSON.parse(fs.readFileSync(file, 'utf8'));
  await until(() => js('typeof E === "object" && E.ready.then(() => true)'), 'page du tableau prête');
  check('⌃⇧E crée un tableau : fichier à part, onglet interne', accels.includes(platform.accel('Ctrl+Shift+E')) && easels.list().length === before + 1
    && fs.existsSync(file) && tab.internal === true && /^[a-f0-9]{16}$/.test(id) && !Object.prototype.hasOwnProperty.call(ctx.store.state, 'easels'), tab.url);

  // --- Éléments, par les vrais gestes ----------------------------------------------
  const wc = page();
  const mouse = (type, x, y, extra = {}) => wc.sendInputEvent({ type, x, y, button: 'left', clickCount: 1, ...extra });
  const dragMouse = async (x0, y0, x1, y1) => {
    mouse('mouseDown', x0, y0);
    for (let i = 1; i <= 6; i++) { mouse('mouseMove', x0 + ((x1 - x0) * i) / 6, y0 + ((y1 - y0) * i) / 6, { modifiers: ['leftButtonDown'] }); await sleep(20); }
    mouse('mouseUp', x1, y1);
    await sleep(60);
  };
  const key = (keyCode, modifiers = []) => { wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers }); wc.sendInputEvent({ type: 'char', keyCode, modifiers }); wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers }); };
  wc.focus();
  await js('E.setTool("rect")');
  await dragMouse(200, 200, 360, 300);
  await until(() => js('E.items.length === 1'), 'rectangle dessiné');
  const rect = await js('JSON.stringify(E.items[0])').then(JSON.parse);
  check('glisser avec l’outil rectangle crée un rectangle à la bonne taille', rect.type === 'rect' && Math.abs(rect.w - 160) <= 2 && Math.abs(rect.h - 100) <= 2 && (await js('E.tool')) === 'select', JSON.stringify(rect));

  await dragMouse(280, 250, 380, 330);
  const moved = await js('JSON.stringify(E.items[0])').then(JSON.parse);
  check('glisser un élément le déplace', Math.abs(moved.x - rect.x - 100) <= 2 && Math.abs(moved.y - rect.y - 80) <= 2, JSON.stringify(moved));

  await js(`(() => { const p = { x: 500, y: 150 }; const it = E.addText('text', p); E.startEdit(it.id, true); })()`);
  for (const ch of 'Orbe') key(ch);
  await sleep(150);
  await js('E.endEdit()');
  await js(`E.add([{ type: 'ellipse', x: 40, y: 40, w: 90, h: 90, color: 'red', sw: 2, fill: false }, { type: 'arrow', x: 40, y: 400, w: 200, h: -60, color: 'ink', sw: 2 }, { type: 'note', x: 600, y: 300, w: 180, h: 180, text: 'À faire', size: 18, color: 'yellow' }, { type: 'pen', x: 300, y: 420, w: 80, h: 40, pw: 80, ph: 40, pts: [0, 0, 40, 40, 80, 5], color: 'green', sw: 5 }])`);
  const kinds = await js('E.items.map((it) => it.type).join()');
  const typed = await js('E.items.find((it) => it.type === "text").text');
  check('texte saisi au clavier, formes, flèche, trait et pense-bête', kinds === 'rect,text,ellipse,arrow,note,pen' && typed === 'Orbe', kinds + ' / ' + typed);

  // Rien de collé n'est interprété : le texte reste du texte.
  await js(`(() => { const dt = new DataTransfer(); dt.setData('text/html', '<img src=x onerror="window.__pwn=1">'); dt.setData('text/plain', '<img src=x onerror="window.__pwn=1">'); document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); })()`);
  await sleep(150);
  const pasted = await js('JSON.stringify({ n: E.items.length, pwn: window.__pwn || 0, imgs: document.querySelectorAll("#world .text img").length, text: E.items[E.items.length - 1].text })').then(JSON.parse);
  check('du HTML collé reste du texte brut (rien n’est interprété)', pasted.n === 7 && pasted.pwn === 0 && pasted.imgs === 0 && pasted.text.startsWith('<img'), JSON.stringify(pasted));

  // --- Annuler / rétablir (chemin du menu) -------------------------------------------
  easels.history(wc, 'undo');
  await until(() => js('E.items.length === 6'), 'annulation');
  easels.history(wc, 'redo');
  await until(() => js('E.items.length === 7'), 'rétablissement');
  easels.history(wc, 'undo');
  await until(() => js('E.items.length === 6'), 'annulation');
  check('Annuler et Rétablir du menu agissent sur le tableau', commands.byName.get('redo').accel === platform.accel('Shift+Cmd+Z') && easels.history(win.live.get(back) ? win.live.get(back).wc : null, 'undo') === false);

  // --- Images : des fichiers, jamais du base64 dans le JSON ---------------------------
  const png = await js(`(async () => {
    const c = document.createElement('canvas'); c.width = 64; c.height = 40;
    const g = c.getContext('2d'); g.fillStyle = '#3b82f6'; g.fillRect(0, 0, 64, 40);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const svg = new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="50" height="30"><script>window.__pwn=2</script><rect width="50" height="30" fill="red" onload="window.__pwn=3"/></svg>'], { type: 'image/svg+xml' });
    const added = await E.addImages([new File([blob], 'a.png', { type: 'image/png' }), new File([svg], 'b.svg', { type: 'image/svg+xml' })], { x: 700, y: 120 });
    const bad = await E.addImages([new File(['pas une image'], 'c.png', { type: 'image/png' })], { x: 0, y: 0 });
    const forged = await O.send('easel:putImage', { board: ${JSON.stringify(id)}, data: new TextEncoder().encode('<svg onload=alert(1)>') });
    const outside = await O.send('easel:getImage', { board: ${JSON.stringify(id)}, name: '../${id}.json' });
    return JSON.stringify({ names: added.map((it) => it.img), bad: bad.length, forged, outside, pwn: window.__pwn || 0 });
  })()`).then(JSON.parse);
  const stored = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^[a-f0-9]{16}\.png$/.test(f)) : [];
  check('image collée : enregistrée comme fichier ; SVG réduit à ses pixels', png.names.length === 2 && png.names.every((n) => stored.includes(n))
    && fs.readFileSync(path.join(dir, png.names[1])).subarray(1, 4).toString() === 'PNG' && png.pwn === 0, JSON.stringify([png, stored]));
  check('image invalide ou nom de fichier hors du dossier : refusés', png.bad === 0 && png.forged === null && png.outside === null, JSON.stringify(png));

  // --- Enregistrement automatique ----------------------------------------------------
  await js(`(() => { const el = document.getElementById('title'); el.value = 'Idées de voyage'; el.dispatchEvent(new InputEvent('input')); })()`);
  await until(() => { const d = disk(); return d.items.length === 8 && d.title === 'Idées de voyage'; }, 'enregistrement automatique');
  const raw = fs.readFileSync(file, 'utf8');
  await until(() => fs.existsSync(path.join(dir, 'thumb.png')), 'vignette');
  await until(() => w.data.tabs[tabId].title === 'Idées de voyage', 'titre de l’onglet');
  check('enregistrement automatique sur disque (écriture atomique, images hors du JSON)', !/base64|data:/.test(raw) && raw.length < 6000
    && !fs.readdirSync(easels.root()).some((f) => f.endsWith('.tmp')), `${raw.length} octets`);
  if (shots) { await sleep(300); fs.writeFileSync(path.join(shots, 'tableau.png'), (await wc.capturePage()).toPNG()); }

  // --- Rechargement --------------------------------------------------------------------
  wc.reload();
  await sleep(200);
  await until(() => js('typeof E === "object" && E.ready.then(() => E.items.length === 8)'), 'tableau rechargé');
  await until(() => js('[...document.querySelectorAll("#world .image img")].every((i) => i.complete && i.naturalWidth > 0)'), 'images rechargées');
  const again = await js('JSON.stringify({ n: document.querySelectorAll("#world .it").length, title: document.getElementById("title").value, src: document.querySelector("#world .image img").src.slice(0, 5), text: document.querySelector("#world .text .tx").textContent })').then(JSON.parse);
  check('rechargement : éléments, titre et images restaurés', again.n === 8 && again.title === 'Idées de voyage' && again.src === 'blob:' && again.text === 'Orbe', JSON.stringify(again));

  // --- Capture d'une page vers le tableau ------------------------------------------------
  const src = w.newTab(base + '/source');
  await until(() => w.data.tabs[src.id].title === 'Page source', 'page source chargée');
  await sleep(300);
  const got = await easels.capture(w, { full: true });
  await until(() => js('E.items.length === 9'), 'capture reçue par la page ouverte');
  const cap = await js('JSON.stringify({ it: E.items[8], label: document.querySelector("#world .src span").textContent, sel: E.sel.length })').then(JSON.parse);
  check('« Capturer vers un tableau » : image ajoutée au tableau le plus récent, avec sa source', got && got.board === id && got.via === 'page' && cap.it.type === 'image'
    && cap.it.sourceUrl === base + '/source' && cap.it.sourceTitle === 'Page source' && cap.label === `127.0.0.1:${server.address().port}` && fs.existsSync(path.join(dir, cap.it.img)), JSON.stringify([got && got.via, cap]));

  // Zone choisie à la souris sur la page : voile, glisser, capture de la zone seule.
  const swc = win.live.get(src.id).wc;
  const pending = easels.capture(w);
  await sleep(400);
  swc.sendInputEvent({ type: 'mouseDown', x: 20, y: 20, button: 'left', clickCount: 1 });
  for (let i = 1; i <= 5; i++) { swc.sendInputEvent({ type: 'mouseMove', x: 20 + i * 40, y: 20 + i * 24, button: 'left', modifiers: ['leftButtonDown'] }); await sleep(25); }
  swc.sendInputEvent({ type: 'mouseUp', x: 220, y: 140, button: 'left', clickCount: 1 });
  const region = await Promise.race([pending, sleep(6000).then(() => 'délai')]);
  const veil = await swc.executeJavaScript('document.documentElement.children.length');
  check('capture d’une zone choisie à la souris', region && region.item && Math.abs(region.item.w - 200) <= 2 && Math.abs(region.item.h - 120) <= 2 && veil === 2, JSON.stringify(region && region.item) + ' ' + veil);
  await until(() => js('E.items.length === 10'), 'seconde capture');

  // Clic sur le lien de la source : la page s'ouvre dans un nouvel onglet.
  const count = Object.keys(w.data.tabs).length;
  w.activate(tabId);
  await js('document.querySelector("#world .src").click()');
  await until(() => Object.keys(w.data.tabs).length === count + 1 && w.data.tabs[w.activeId].url === base + '/source', 'onglet de la source');
  check('le lien d’une capture ouvre sa page d’origine dans un nouvel onglet', true);
  w.close(w.activeId);

  // Tableau fermé : la capture est écrite directement dans le fichier.
  w.activate(tabId);
  await js('E.save()');
  w.close(tabId);
  await until(() => !win.live.has(tabId), 'onglet du tableau fermé');
  w.activate(src.id);
  await sleep(200);
  const offline = await easels.capture(w, { rect: { x: 0, y: 0, width: 120, height: 80 } });
  const d2 = disk();
  check('capture vers un tableau fermé : ajoutée au fichier, sous le contenu', offline && offline.via === 'file' && d2.items.length === 11 && d2.items[10].sourceUrl === base + '/source'
    && d2.items[10].y > Math.max(...d2.items.slice(0, 10).map((it) => it.y)), JSON.stringify([offline && offline.via, d2.items.length]));
  w.close(src.id);

  // --- Validation côté processus principal ---------------------------------------------
  const clean = easels.cleanDoc({ title: 'x', evil: 1, items: [
    { id: 'a', type: 'image', img: '../../orbe.json', x: 0, y: 0, w: 10, h: 10 },
    { id: 'b', type: 'image', img: 'aaaaaaaaaaaaaaaa.png', x: 0, y: 0, w: 10, h: 10, sourceUrl: 'javascript:alert(1)', html: '<b>' },
    { id: 'c', type: 'script', x: 0, y: 0, w: 1, h: 1 },
    { id: 'd', type: 'text', text: 'ok', x: 'NaN', y: Infinity, w: 5, h: 5, color: 'url(x)' },
  ] }, id);
  check('le processus principal ne garde d’un tableau que les champs connus', clean.evil === undefined && clean.items.length === 2 && !clean.items[0].sourceUrl && !clean.items[0].html
    && clean.items[1].x === 0 && clean.items[1].color === undefined, JSON.stringify(clean.items));

  // --- Bibliothèque : liste, ouverture, suppression ----------------------------------------
  w.run('easels');
  const libId = w.activeId;
  const lib = (code) => win.live.get(libId).wc.executeJavaScript(code);
  await until(() => lib('document.querySelectorAll("#list .board").length === 1 && !!document.querySelector("#list .board .thumb img")'), 'tableau listé dans la bibliothèque');
  const card = await lib('JSON.stringify({ name: document.querySelector("#list .board .name").textContent, thumb: document.querySelector("#list .board .thumb img").src.slice(0, 22), tab: document.querySelector(".tabs .on").dataset.tab })').then(JSON.parse);
  check('bibliothèque : onglet Tableaux avec vignette, titre et date', card.name === 'Idées de voyage' && card.thumb === 'data:image/png;base64,' && card.tab === 'easels', JSON.stringify(card));
  if (shots) { await sleep(300); fs.writeFileSync(path.join(shots, 'tableaux-bibliotheque.png'), (await win.live.get(libId).wc.capturePage()).toPNG()); }
  await lib('document.querySelector("#list .board .meta").click()');
  await until(() => w.activeId !== libId && w.data.tabs[w.activeId].url.endsWith('easel.html?id=' + id), 'tableau rouvert depuis la bibliothèque');
  const reopened = w.activeId;
  await until(() => win.live.get(reopened).wc.executeJavaScript('typeof E === "object" && E.ready.then(() => E.items.length === 11)'), 'tableau rouvert avec la capture ajoutée');
  check('un clic dans la bibliothèque rouvre le tableau, capture comprise', true);
  w.activate(libId);
  await lib('document.querySelector("#list .board [data-do=delete]").click()');
  await until(() => !fs.existsSync(file) && !fs.existsSync(dir), 'fichiers du tableau supprimés');
  await until(() => win.live.get(reopened).wc.executeJavaScript('!document.getElementById("gone").hidden'), 'page du tableau prévenue');
  await sleep(900);
  check('suppression : fichier et images retirés, la page ouverte ne le recrée pas', easels.list().every((b) => b.id !== id) && !fs.existsSync(file)
    && (await lib('document.querySelectorAll("#list .board").length')) === 0);
  w.close(reopened);
  w.close(libId);
  if (back && w.data.tabs[back]) w.activate(back);

  server.close();
  if (standalone && failed) throw new Error(`${failed} vérification(s) en échec`);
};
