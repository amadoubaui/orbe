// Essai répété (provisoire) : fermer la fenêtre, « Rester », la page doit rester.
//   RESTER_N : répétitions ; RESTER_BOUCLIER=0 : sans le bouclier (ancien comportement) ;
//   RESTER_CHARGE : processus qui occupent les cœurs ; RESTER_ONGLETS : onglets vivants en plus.
const http = require('http');
const os = require('os');
const { spawn } = require('child_process');
const outils = require('./outils');

const { sleep } = outils;
const until = (fn, label, timeout = 20000) => outils.until(fn, label, timeout);

module.exports = async function rester({ first: w, OrbeWindow, store, win, essentials }) {
  const { unload } = essentials;
  const N = Number(process.env.RESTER_N || 100);
  const charge = Number(process.env.RESTER_CHARGE || 0);
  const extra = Number(process.env.RESTER_ONGLETS || 0);
  if (process.env.RESTER_BOUCLIER === '0') unload.env.shield = false;
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end('<!doctype html><title>Brouillon</title><textarea></textarea><script>window.addEventListener("beforeunload", (e) => { if (window.sale) { e.preventDefault(); e.returnValue = "x"; } });</script>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const A = `http://127.0.0.1:${server.address().port}`;
  await outils.profilPret(w);
  const asks = [];
  unload.env.ask = (parent, opts) => { asks.push(Date.now()); return 1; };
  const open = async (owner) => {
    const tab = owner.newTab(A + '/sale');
    await until(() => owner.data.tabs[tab.id] && owner.data.tabs[tab.id].title === 'Brouillon', 'page');
    const rt = win.live.get(tab.id);
    return { id: tab.id, rt, wc: rt.wc };
  };
  const dirty = async (d) => {
    await until(() => d.wc.executeJavaScript('document.readyState === "complete"'), 'chargée');
    d.rt.gesture = 0;
    for (const type of ['mouseDown', 'mouseUp']) d.wc.sendInputEvent({ type, x: 30, y: 30, button: 'left', clickCount: 1 });
    await until(() => d.rt.gesture > 0, 'entrée');
    await d.wc.executeJavaScript('window.sale = true; 1', true);
    d.gone = 0;
    d.wc.once('destroyed', () => { d.gone = Date.now(); });
    return d;
  };
  store.state.settings.maxLiveTabs = 60;
  for (let i = 0; i < extra; i++) await open(w);
  const burners = [];
  for (let i = 0; i < charge; i++) burners.push(spawn(process.execPath, ['-e', 'for(;;){}'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'ignore' }));
  console.log(`  – ${N} répétitions, bouclier ${unload.env.shield ? 'en place' : 'COUPÉ'}, ${charge} processus de charge, ${extra} onglets en plus, ${os.cpus().length} cœurs`);

  const w2 = new OrbeWindow();
  let d = await dirty(await open(w2));
  const lost = [];
  let worst = 0;
  for (let i = 0; i < N; i++) {
    asks.length = 0;
    unload.forget(d.wc);
    const t0 = Date.now();
    w2.win.close();
    await until(() => asks.length >= 1 || d.gone, 'question');
    const asked = asks[0] || 0;
    worst = Math.max(worst, asked - t0);
    await sleep(1400);
    if (d.gone || d.wc.isDestroyed()) {
      lost.push({ i, questions: asks.length, apresQuestion: asked ? d.gone - asked : null, journal: d.rt.trail });
      console.log(`  ✗ répétition ${i} : page détruite ${asked ? d.gone - asked : '?'} ms après la question — ${JSON.stringify(d.rt.trail)}`);
      // L'onglet a gardé sa ligne et s'est rechargé (ou pas) : on repart d'une page neuve.
      d = await dirty(await open(w2));
    }
  }
  for (const b of burners) { try { b.kill('SIGKILL'); } catch {} }
  server.close();
  console.log(`RÉSULTAT ${process.platform} bouclier=${unload.env.shield ? 1 : 0} : ${lost.length} page(s) perdue(s) sur ${N} « Rester » ; question la plus lente : ${worst} ms`);
  if (process.env.RESTER_STRICT && lost.length) throw new Error(`${lost.length} page(s) perdue(s) après « Rester »`);
};
