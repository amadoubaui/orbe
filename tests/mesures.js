// Mesures de vitesse et de mémoire (pas un test : rien n'y est affirmé).
// Lancé par scripts/mesures.js, qui fournit le serveur local, le profil et
// l'arbre de sources à mesurer :
//   ORBE_BENCH=<mesure> ORBE_BENCH_BASE=http://127.0.0.1:<port> ORBE_SCENARIO=tests/mesures.js
// Chaque mesure écrit une ligne « MESURE {json} » sur la sortie.
const { app, WebContentsView } = require('electron');
const os = require('os');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const round = (v, n = 1) => Math.round(v * 10 ** n) / 10 ** n;
const out = (o) => console.log('MESURE ' + JSON.stringify({ ...o, charge: round(os.loadavg()[0], 1) }));

async function until(fn, timeout = 15000) {
  const t0 = Date.now();
  for (;;) {
    let v;
    try { v = await fn(); } catch { v = false; }
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error('délai dépassé');
    await sleep(15);
  }
}

// Processus d'Orbe : nombre et mémoire (app.getAppMetrics, en Mo).
function processes() {
  const m = app.getAppMetrics();
  const mb = (list) => round(list.reduce((a, p) => a + p.memory.workingSetSize, 0) / 1024, 0);
  const tabs = m.filter((p) => p.type === 'Tab');
  return { processus: m.length, rendu: tabs.length, mo: mb(m), moRendu: mb(tabs) };
}

const paintOf = (wc) => wc.executeJavaScript(`new Promise((r) => {
  const read = () => { const e = performance.getEntriesByName('first-contentful-paint')[0]; if (e) r(performance.timeOrigin + e.startTime); else setTimeout(read, 5); };
  read();
})`);

// Mot de 4 à 9 lettres, toujours le même pour un même numéro.
function word(n) {
  let x = (n * 2654435761 + 97) >>> 0;
  let out = '';
  const len = 4 + (x % 6);
  for (let i = 0; i < len; i++) { x = (x * 1103515245 + 12345) >>> 0; out += 'aeioubcdfglmnprstvéèç'[(x >>> 16) % 21]; }
  return out;
}

const BENCHES = {
  // Prépare un profil : un onglet, et au besoin un gros historique et beaucoup d'onglets.
  async prepare({ first: w, store, base }) {
    const history = Number(process.env.ORBE_BENCH_HISTORY) || 0;
    const tabs = Number(process.env.ORBE_BENCH_TABS) || 0;
    const now = Date.now();
    // Historique varié (hôtes et titres tirés d'un vocabulaire), pour que la recherche
    // ait le même genre de travail qu'avec un vrai historique.
    for (let i = 0; i < history; i++) {
      const host = `${word(i % 400)}.exemple.fr`;
      const url = `https://${host}/${word(1000 + (i * 7) % 300)}/${i}-${word(2000 + (i * 13) % 900)}`;
      store.state.history[url] = { url, visits: 1 + (i % 9), last: now - i * 60000, title: `${word(i * 3)} ${word(i * 5 + 1)} ${word(i * 11 + 2)} — ${word(i % 400)}`, favicon: `https://${host}/favicon.ico` };
    }
    for (let i = 0; i < tabs; i++) {
      const tab = w.createTab(`https://site${i}.exemple.fr/page/${i}`);
      tab.title = `Onglet ${i} — exemple`;
    }
    const tab = w.newTab(base + '/leger');
    await until(() => w.data.tabs[tab.id].title === 'Léger');
    store.saveHistory(true);
    await sleep(300);
    store.flush();
    out({ bench: 'prepare', history, tabs });
  },

  // Démarrage : de la création du processus à la coque peinte et à la première page.
  async demarrage({ first: w, win }) {
    const t0 = process.getCreationTime();
    const shown = Date.now();
    const ui = w.ui.webContents;
    const loaded = new Promise((r) => ui.once('did-finish-load', () => r(Date.now())));
    const shellLoaded = await loaded;
    const shellPaint = await paintOf(ui);
    // Barre latérale rendue : l'état est arrivé et une image a suivi.
    const sidebar = await ui.executeJavaScript(`new Promise((r) => { const go = () => (typeof S === 'object' && S ? requestAnimationFrame(() => requestAnimationFrame(() => r(performance.timeOrigin + performance.now()))) : setTimeout(go, 2)); go(); })`);
    const rt = await until(() => w.activeRt);
    const page = await paintOf(rt.wc);
    // Vue modale prête (depuis la 0.12 elle naît de la coque, après son affichage), puis
    // barre de commande prête à répondre. Ouverte avant, la barre naîtrait à part, dans son
    // propre processus (une centaine de millisecondes, et un processus de plus) : ce cas-là
    // n'est pas celui d'une personne, qui n'appuie pas sur ⌘T dans la demi-seconde du lancement.
    await until(() => w.modal && !w.modal.webContents.isLoading(), 3000).catch(() => {});
    const modal = Date.now();
    const t1 = Date.now();
    w.openCommand();
    await until(() => w.modal && !w.modal.webContents.isLoading() && w.modal.webContents.executeJavaScript('!document.getElementById("command").hidden && document.activeElement === document.getElementById("cmd-input")'));
    const command = Date.now() - t1;
    await sleep(1500);
    out({
      bench: 'demarrage', fenetre: round(shown - t0, 0), coqueChargee: round(shellLoaded - t0, 0), coquePeinte: round(shellPaint - t0, 0),
      barreRendue: round(sidebar - t0, 0), pagePeinte: round(page - t0, 0), modalePrete: round(modal - t0, 0), commande: command, ...processes(), vivants: win.live.size,
    });
  },

  // Mémoire : au repos, puis après avoir ouvert toutes les vues d'appoint.
  async memoire({ first: w, base }) {
    const rt = await until(() => w.activeRt);
    await until(() => !rt.wc.isLoading());
    await sleep(2500);
    const repos = processes();
    const t = {};
    // Les ouvertures sont espacées, comme les gestes d'une personne.
    const timed = async (name, fn, ready) => { await sleep(400); const t0 = Date.now(); fn(); await until(ready); t[name] = Date.now() - t0; };
    const shown = (v) => () => { const view = v(); return view && !view.webContents.isDestroyed() && !view.webContents.isLoading() && w.win.contentView.children.includes(view); };
    await timed('toast', () => w.toast('Bonjour'), shown(() => w.toastView));
    await timed('recherche', () => w.openFind(), shown(() => w.findView));
    w.closeFind();
    await timed('statut', () => w.linkStatus(rt, base + '/leger?lien'), shown(() => w.statusView));
    w.linkStatus(rt, '');
    await timed('depot', () => w.dragZone(true), shown(() => w.dropView));
    w.dragZone(false);
    await timed('commande', () => w.openCommand(), () => w.modal && !w.modal.webContents.isLoading());
    w.hideModal();
    await sleep(3000);
    const ouvertes = processes();
    const wait = Number(process.env.ORBE_BENCH_IDLE) || 0;
    let apres = null;
    if (wait) { await sleep(wait); apres = processes(); }
    out({ bench: 'memoire', repos, ouvertes, apres, ouverture: t });
  },

  // Coût d'Orbe par navigation : loadURL → did-finish-load, vue d'onglet ordinaire.
  async navigation({ first: w, base }) {
    const rounds = Number(process.env.ORBE_BENCH_ROUNDS) || 14;
    const pages = ['leger', 'cadres', 'ressources'];
    const view = new WebContentsView({ webPreferences: { session: w.session, sandbox: true, contextIsolation: true, nodeIntegrationInSubFrames: true } });
    w.win.contentView.addChildView(view);
    view.setBounds({ x: 300, y: 60, width: 900, height: 700 });
    const wc = view.webContents;
    const load = async (p, i) => { const t0 = performance.now(); await wc.loadURL(`${base}/${p}?n=${i}`); return performance.now() - t0; };
    for (const p of pages) await load(p, 'chauffe');
    const res = Object.fromEntries(pages.map((p) => [p, []]));
    for (let i = 0; i < rounds; i++) for (const p of pages) res[p].push(await load(p, i));
    const o = { bench: 'navigation' };
    for (const p of pages) o[p] = round(median(res[p]), 2);
    wc.close();
    out(o);
  },

  // Barre de commande : de la frappe à la liste peinte, et calcul côté principal.
  async commande({ first: w, store }) {
    const rt = await until(() => w.activeRt);
    await until(() => !rt.wc.isLoading());
    await sleep(1200);
    w.openCommand();
    const wc = w.modal.webContents;
    await until(() => !wc.isLoading() && wc.executeJavaScript('!document.getElementById("command").hidden'));
    await wc.executeJavaScript(`(() => {
      window.__m = [];
      const input = document.getElementById('cmd-input');
      const list = document.getElementById('cmd-list');
      let t0 = 0;
      input.addEventListener('input', () => { t0 = performance.now(); }, true);
      window.__l = [];
      new MutationObserver(() => { if (!t0) return; const s = t0; t0 = 0; window.__l.push(performance.now() - s); requestAnimationFrame(() => { const c = new MessageChannel(); c.port1.onmessage = () => window.__m.push(performance.now() - s); c.port2.postMessage(0); }); }).observe(list, { childList: true });
    })()`);
    const local = [];
    const orig = w.suggestLocal.bind(w);
    w.suggestLocal = (q) => { const t0 = performance.now(); const r = orig(q); local.push(performance.now() - t0); return r; };
    const words = [word(21), word(40) + '.exemple', word(1003), word(305).slice(0, 5), word(2010), 'exemple.fr/' + word(1001)];
    // La frappe est rejouée dans la vue (valeur + événement « input ») : même chemin que le
    // clavier, sans dépendre de la fenêtre qui a le clavier pendant la mesure.
    const type = async (text) => {
      const n = await wc.executeJavaScript('window.__m.length');
      await wc.executeJavaScript(`(() => { const i = document.getElementById('cmd-input'); i.value = ${JSON.stringify(text)}; i.dispatchEvent(new InputEvent('input', { inputType: 'insertText' })); })()`);
      await until(() => wc.executeJavaScript('window.__m.length').then((x) => x > n), 3000).catch(() => {});
    };
    for (let round = 0; round < 3; round++) {
      for (const word of words) {
        for (let i = 1; i <= word.length; i++) { await type(word.slice(0, i)); await sleep(20); }
      }
    }
    const paints = await wc.executeJavaScript('window.__m');
    const lists = await wc.executeJavaScript('window.__l');
    const sorted = [...paints].sort((a, b) => a - b);
    out({
      bench: 'commande', historique: Object.keys(store.state.history).length, frappes: paints.length,
      frappeVersListe: round(median(lists), 2), listeP90: round([...lists].sort((a, b) => a - b)[Math.floor(lists.length * 0.9)] || 0, 2),
      frappeVersPeinture: round(median(paints), 1), p90: round(sorted[Math.floor(sorted.length * 0.9)] || 0, 1),
      calculPrincipal: round(median(local), 2), calculP90: round([...local].sort((a, b) => a - b)[Math.floor(local.length * 0.9)] || 0, 2),
    });
  },

  // Icônes devinées (/favicon.ico) : requêtes émises par la coque pour des onglets sans icône.
  async icones({ first: w }) {
    const { session } = require('electron');
    let n = 0;
    const hosts = new Set();
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['*://*/favicon.ico'] }, (d, cb) => { n += 1; hosts.add(new URL(d.url).host); cb({ cancel: true }); });
    await sleep(2500);
    const first = n;
    const home = w.spaceId;
    if (w.data.spaces.length < 2) { w.newSpace(); await sleep(1200); w.hideModal(); w.switchSpace(home); await sleep(900); }
    const other = w.data.spaces.find((sp) => sp.id !== home);
    for (let i = 0; i < 3; i++) { w.switchSpace(other.id); await sleep(900); w.switchSpace(home); await sleep(900); }
    out({ bench: 'icones', onglets: Object.keys(w.data.tabs).length, premieres: first, apresSixBascules: n, hotes: hosts.size });
  },

  // État envoyé à la coque : taille, temps d'envoi et nombre d'envois réels.
  async etat({ first: w }) {
    const rt = await until(() => w.activeRt);
    await until(() => !rt.wc.isLoading());
    await sleep(1500);
    const ui = w.ui.webContents;
    const send = ui.send.bind(ui);
    let bytes = 0;
    let sends = 0;
    ui.send = (ch, ...args) => { if (ch === 'state' || ch === 'state-patch') { sends += 1; bytes += JSON.stringify(args).length; } return send(ch, ...args); };
    const run = (n, mutate) => {
      const times = [];
      bytes = 0; sends = 0;
      for (let i = 0; i < n; i++) { mutate(i); const t0 = performance.now(); w.sendState(); times.push(performance.now() - t0); }
      return { ms: round(median(times), 3), octets: Math.round(bytes / n), envois: sends };
    };
    const tab = w.data.tabs[w.activeId];
    const tabs = Object.keys(w.data.tabs).length;
    const identique = run(60, () => {});
    const titre = run(60, (i) => { tab.title = 'Titre ' + i; });
    // Du début de l'envoi au retour de la coque, une fois l'état rendu (horloge du processus principal).
    let ack = null;
    const handle = w.handle.bind(w);
    w.handle = (action, a) => (action === 'mesureRendu' ? (ack && ack(), undefined) : handle(action, a));
    await ui.executeJavaScript(`void O.on('state', () => { O.send('mesureRendu'); })`);
    const lat = [];
    for (let i = 0; i < 40; i++) {
      tab.title = 'Latence ' + i;
      const done = new Promise((r) => { ack = r; });
      const t0 = performance.now();
      w.sendState();
      await done;
      lat.push(performance.now() - t0);
      await sleep(25);
    }
    // Travail de la coque par envoi (fil principal du processus de rendu, désérialisation comprise).
    const dbg = ui.debugger;
    dbg.attach('1.3');
    await dbg.sendCommand('Performance.enable');
    const metric = async () => Object.fromEntries((await dbg.sendCommand('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
    const work = async (mutate) => {
      const a = await metric();
      for (let i = 0; i < 50; i++) { mutate(i); w.sendState(); await sleep(20); }
      const b = await metric();
      return { tache: round((b.TaskDuration - a.TaskDuration) * 1000 / 50, 2), script: round((b.ScriptDuration - a.ScriptDuration) * 1000 / 50, 2) };
    };
    const coqueIdentique = await work(() => {});
    const coqueTitre = await work((i) => { tab.title = 'Travail ' + i; });
    dbg.detach();
    out({ bench: 'etat', onglets: tabs, identique, titre, allerRetour: round(median(lat), 2), coqueIdentique, coqueTitre });
  },

  // Voisins (MEM-6) : dix onglets d'un même site, dont trois qui calculent 150 ms par seconde
  // en arrière-plan. Mémoire et processus, puis fluidité de l'onglet affiché pendant dix secondes
  // (images présentées, plus long trou entre deux images, aller-retour d'un message). Avec
  // `--renderer-process-limit`, les onglets du site partagent des processus : c'est ce qu'on mesure.
  async voisins({ first: w, win, base }) {
    const pidsOf = (id) => { const rt = win.live.get(id); const set = new Set(); try { for (const f of rt.wc.mainFrame.framesInSubtree) set.add(f.osProcessId); } catch {} return set; };
    const temoin = w.newTab(base + '/temoin');
    const lourds = [];
    for (let i = 0; i < 9; i++) lourds.push(w.newTab(`${base}/lourd?i=${i}${i < 3 ? '&travail=150' : ''}`, { background: true }));
    // Deux onglets d'un AUTRE site (même serveur, autre nom) : ils ne doivent jamais partager un processus avec les premiers.
    const autre = base.replace('127.0.0.1', 'localhost');
    const ailleurs = [w.newTab(autre + '/lourd?i=a', { background: true }), w.newTab(autre + '/lourd?i=b', { background: true })];
    await until(() => [...lourds, ...ailleurs].every((x) => /^Lourd/.test(w.data.tabs[x.id].title)) && w.data.tabs[temoin.id].title === 'Témoin', 30000);
    await sleep(4000);
    const site = new Set([temoin, ...lourds].flatMap((x) => [...pidsOf(x.id)]));
    const other = new Set(ailleurs.flatMap((x) => [...pidsOf(x.id)]));
    const mine = pidsOf(temoin.id);
    const voisins = lourds.filter((x) => [...pidsOf(x.id)].some((pid) => mine.has(pid))).length;
    const metrics = app.getAppMetrics().filter((m) => site.has(m.pid));
    const resident = round(metrics.reduce((a, m) => a + m.memory.workingSetSize, 0) / 1024, 0);
    let empreinte = 0;
    try {
      const e = require('../src/main/empreinte');
      if (await e.refresh(metrics.map((m) => ({ pid: m.pid, creationTime: m.creationTime })))) empreinte = round(e.state.total, 0);
    } catch {}
    // Fluidité de l'onglet affiché.
    const wc = win.live.get(temoin.id).wc;
    await wc.executeJavaScript(`window.trous = []; (() => { let last = performance.now(); const f = (t) => { window.trous.push(t - last); last = t; requestAnimationFrame(f); }; requestAnimationFrame(f); })()`, true);
    const lat = [];
    const fin = Date.now() + 10000;
    while (Date.now() < fin) {
      const t0 = performance.now();
      await wc.executeJavaScript('1', true);
      lat.push(performance.now() - t0);
      await sleep(100);
    }
    const trous = await wc.executeJavaScript('window.trous', true);
    const sorted = [...lat].sort((a, b) => a - b);
    out({
      bench: 'voisins', processusDuSite: site.size, voisinsDuTemoin: voisins, partagesEntreSites: [...site].filter((pid) => other.has(pid)).length,
      resident, empreinte, images: trous.length, pireTrou: round(Math.max(...trous), 0), trousDePlusDe50ms: trous.filter((x) => x > 50).length,
      messageMedian: round(median(lat), 1), messageP95: round(sorted[Math.floor(sorted.length * 0.95)], 1), messagePire: round(sorted[sorted.length - 1], 0),
    });
  },
};

module.exports = async function mesures(ctx) {
  const name = process.env.ORBE_BENCH || 'demarrage';
  const base = process.env.ORBE_BENCH_BASE || '';
  if (!BENCHES[name]) throw new Error('mesure inconnue : ' + name);
  await BENCHES[name]({ ...ctx, base });
};
