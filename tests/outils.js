// Outils communs aux scénarios de bout en bout (processus principal).
const garde = require('../src/main/test-guard');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const NEVER = Symbol('sans réponse');

// Attend qu'une condition devienne vraie ; renvoie sa valeur.
// La condition elle-même est bornée : une page qui ne répond jamais à un
// executeJavaScript donnait une attente sans fin, que seul le garde-fou général
// arrêtait, sans dire où. L'attente en cours est connue de la garde (src/main/test-guard.js).
async function until(fn, label, timeout = 8000) {
  const t0 = Date.now();
  const done = garde.waiting(label);
  let mute = 0;
  try {
    for (;;) {
      let v;
      let timer;
      const left = Math.max(50, timeout - (Date.now() - t0));
      try {
        v = await Promise.race([
          Promise.resolve().then(fn),
          new Promise((r) => { timer = setTimeout(() => r(NEVER), left + 2000); }),
        ]);
      } catch { v = false; }
      clearTimeout(timer);
      if (v === NEVER) { v = false; mute += 1; }
      if (v) return v;
      if (Date.now() - t0 > timeout) throw new Error('Délai dépassé : ' + label + (mute ? ' (la condition n’a jamais répondu)' : ''));
      await sleep(40);
    }
  } finally { done(); }
}

// --- Milieu de l'essai ------------------------------------------------------------
// Écran verrouillé, en veille ou fenêtre recouverte : Chromium ne présente plus
// aucune image de la fenêtre, ralentit ses minuteries à une par seconde, ne
// capture rien et le système ne joue aucun son. Les vérifications qui ont besoin
// d'un écran vivant ne peuvent alors rien prouver : elles sont ignorées, une par
// une et avec la raison — jamais en silence, jamais en élargissant un seuil.
// La mesure est faite une fois, dans la coque : images présentées
// (requestAnimationFrame) et cadence d'une minuterie de 20 ms.
let measured = null;
const PROBE = `(async () => {
  const t0 = performance.now();
  let frames = 0, stop = false, ticks = 0;
  const frame = () => { frames += 1; if (!stop) requestAnimationFrame(frame); };
  requestAnimationFrame(frame);
  await new Promise((done) => {
    const id = setInterval(() => { ticks += 1; if (ticks >= 25) { clearInterval(id); done(); } }, 20);
    setTimeout(() => { clearInterval(id); done(); }, 1500);
  });
  stop = true;
  return { frames, ticks, ms: Math.round(performance.now() - t0), visible: document.visibilityState };
})()`;
// Lit la mesure : 25 tics de 20 ms font une demi-seconde ; écran vivant, au moins
// dix images sont présentées dans ce temps.
function juger(m) {
  if (!m) m = { frames: 0, ticks: 0, ms: 6000, visible: 'sans réponse' };
  const vivant = m.frames >= 10 && m.ticks >= 25 && m.ms < 1200;
  return {
    ...m,
    vivant,
    raison: vivant ? '' : `écran inactif : ${m.frames} image(s) présentée(s), minuteries ${m.ticks >= 25 && m.ms < 1200 ? 'normales' : 'ralenties'}`,
    resume: `${m.frames} image(s) présentée(s), ${m.ticks}/25 tics de 20 ms en ${m.ms} ms, page « ${m.visible} » → ${vivant ? 'écran vivant' : 'ÉCRAN INACTIF : les vérifications qui en dépendent seront ignorées'}`,
  };
}
async function milieu(w) {
  if (measured) return measured;
  let m = null;
  try { m = await Promise.race([w.ui.webContents.executeJavaScript(PROBE), sleep(6000).then(() => null)]); } catch {}
  measured = juger(m);
  console.log(`  – milieu de l’essai : ${measured.resume}`);
  return measured;
}

// Vérification ignorée : dite, avec sa raison, et comptée.
function ignorer(nom, raison) {
  garde.state.skipped.push({ nom, raison });
  console.log(`  – ignoré : ${nom} (${raison})`);
}

module.exports = { sleep, until, milieu, ignorer, ignores: garde.state.skipped, PROBE, juger };
