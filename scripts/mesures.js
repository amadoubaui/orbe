#!/usr/bin/env node
// Mesures de vitesse et de mémoire d'Orbe (voir docs/suivi/ameliorations.md).
//   node scripts/mesures.js <mesure> [--tours 8] [--arbre <dossier>]… [--app <Orbe.app>] [--historique 8500] [--onglets 300] [--pause 0]
// Mesures : demarrage, memoire, navigation, commande, etat (tests/mesures.js).
// Plusieurs --arbre (ou --app) : les lancements alternent (A, B, A, B…) pour annuler
// la dérive d'une machine chargée ; la médiane de chaque valeur est affichée avec
// la charge moyenne relevée. Les profils sont temporaires, jamais le vrai.
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { ensure, root } = require('./dev');

const args = process.argv.slice(2);
const bench = args[0] && !args[0].startsWith('--') ? args.shift() : 'demarrage';
const opt = (name, def) => { const out = []; for (let i = 0; i < args.length; i++) if (args[i] === '--' + name) out.push(args[i + 1]); return out.length ? out : def; };
const rounds = Number(opt('tours', [8])[0]);
const pause = Number(opt('pause', [0])[0]);
const history = Number(opt('historique', [0])[0]);
const tabs = Number(opt('onglets', [0])[0]);
const targets = [
  ...opt('arbre', []).map((dir) => ({ name: path.basename(path.resolve(dir)), dir: path.resolve(dir) })),
  ...opt('app', []).map((p) => ({ name: path.basename(p), app: path.resolve(p) })),
];
if (!targets.length) targets.push({ name: 'sources', dir: root });

function serve() {
  const page = (title, body) => `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:16px sans-serif">${body}</body>`;
  const form = '<form action="/leger" method="post"><input name="login" autocomplete="username"><input type="password" name="pass"><button>Connexion</button></form>';
  const px = Buffer.from('R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==', 'base64');
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    res.setHeader('content-type', 'text/html; charset=utf-8');
    if (url.pathname === '/leger') return res.end(page('Léger', '<h1>Bonjour</h1><p>Une page légère.</p>'));
    if (url.pathname === '/cadre') return res.end(page('Cadre', form));
    if (url.pathname === '/cadres') return res.end(page('Cadres', Array.from({ length: 12 }, (_, i) => `<iframe src="/cadre?i=${i}" width="200" height="90"></iframe>`).join('')));
    if (url.pathname === '/ressources') return res.end(page('Ressources', Array.from({ length: 150 }, (_, i) => `<img src="/px?i=${i}&n=${url.searchParams.get('n')}" width="4" height="4">`).join('')));
    if (url.pathname === '/px') { res.setHeader('content-type', 'image/gif'); return res.end(px); }
    res.statusCode = 404;
    return res.end(page('404', ''));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// Fenêtre recouverte par une autre (machine partagée) : sans cela Chromium ralentit ses minuteries.
const SWITCHES = ['--disable-backgrounding-occluded-windows'];

function launch(target, env) {
  const scenario = path.join(root, 'tests', 'mesures.js');
  const base = { ...process.env, ORBE_SCENARIO: scenario, ...env };
  const child = target.app
    ? spawn(path.join(target.app, 'Contents', 'MacOS', 'Orbe'), ['--selftest', '--orbe-test', ...SWITCHES], { env: base })
    : spawn(process.execPath, [ensure(), target.dir, '--selftest', ...SWITCHES], { env: base });
  let text = '';
  child.stdout.on('data', (d) => { text += d; });
  child.stderr.on('data', (d) => { text += d; });
  return new Promise((resolve) => child.on('exit', (code) => {
    const line = text.split('\n').find((l) => l.startsWith('MESURE '));
    if (!line) console.error(`[${target.name}] sans mesure (code ${code})\n${text.slice(-1600)}`);
    resolve(line ? JSON.parse(line.slice(7)) : null);
  }));
}

function flatten(o, prefix = '', into = {}) {
  for (const [k, v] of Object.entries(o || {})) {
    if (v && typeof v === 'object') flatten(v, prefix + k + '.', into);
    else if (typeof v === 'number') into[prefix + k] = v;
  }
  return into;
}

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orbe-mesures-'));
  for (const t of targets) {
    t.profile = path.join(tmp, t.name + '-' + targets.indexOf(t));
    t.runs = [];
    await launch(t, { ORBE_BENCH: 'prepare', ORBE_BENCH_BASE: base, ORBE_USER_DATA: t.profile, ORBE_BENCH_HISTORY: String(history), ORBE_BENCH_TABS: String(tabs) });
  }
  for (let i = 0; i < rounds; i++) {
    for (const t of targets) {
      if (pause) await sleep(pause * 1000);
      const r = await launch(t, { ORBE_BENCH: bench, ORBE_BENCH_BASE: base, ORBE_USER_DATA: t.profile });
      if (r) t.runs.push(flatten(r));
    }
  }
  server.close();
  const keys = [...new Set(targets.flatMap((t) => t.runs.flatMap((r) => Object.keys(r))))];
  console.log(`\n${bench} — ${rounds} tours${pause ? `, ${pause} s de pause` : ''}${history ? `, ${history} visites` : ''}${tabs ? `, ${tabs} onglets` : ''} — médianes (min–max)`);
  console.log(['mesure'.padEnd(28), ...targets.map((t) => t.name.padStart(26))].join(''));
  for (const k of keys) {
    const cells = targets.map((t) => {
      const v = t.runs.map((r) => r[k]).filter((x) => typeof x === 'number');
      return (v.length ? `${median(v)} (${Math.min(...v)}–${Math.max(...v)})` : '—').padStart(26);
    });
    console.log([k.padEnd(28), ...cells].join(''));
  }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
})();
