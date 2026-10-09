// Mise en veille des onglets : qui endormir, et pourquoi.
//
// Un onglet en veille garde sa ligne dans la barre latérale ; sa page est
// détruite et rechargée au retour. Trois règles, dans cet ordre :
//   1. le nombre : pas plus de `max` onglets vivants (réglage « maxLiveTabs ») ;
//   2. l'ancienneté : un onglet non affiché depuis `idleMs` s'endort ;
//   3. la mémoire : tant que les processus des onglets dépassent `budgetMb`,
//      les plus anciens s'endorment, sans descendre sous `MIN_LIVE` vivants.
// Ne sont jamais touchés : les onglets affichés, ceux qui jouent du son, ceux
// dont les outils de développement sont ouverts ou qui capturent l'écran, la
// caméra ou le micro (`kept`). Les règles 2 et 3, qui agissent sans que
// l'utilisateur ait rien fait, épargnent en plus les pages où il a saisi du
// texte depuis leur chargement (`typed`) : un formulaire en cours ne se perd pas.
//
// Ce module ne dépend pas d'Electron : il reçoit des relevés et rend des
// identifiants, ce qui le rend vérifiable sans navigateur.

const MIN_LIVE = 4;

// `tabs` : [{ id, lastUsed, mb, kept, typed }] — `mb` : mémoire propre à l'onglet (0 si inconnue).
// `totalMb` : mémoire de l'ensemble des processus d'onglets (les processus partagés comptés une fois).
// Renvoie [{ id, why }] dans l'ordre d'endormissement ; why : 'count', 'idle' ou 'memory'.
function pick(tabs, { max = Infinity, idleMs = 0, budgetMb = 0, totalMb = 0, now = Date.now() } = {}) {
  const out = [];
  const asleep = new Set();
  let alive = tabs.length;
  let total = totalMb;
  const sleep = (t, why) => { asleep.add(t.id); alive -= 1; total -= t.mb || 0; out.push({ id: t.id, why }); };
  const oldest = tabs.filter((t) => !t.kept).sort((a, b) => a.lastUsed - b.lastUsed);
  for (const t of oldest) {
    if (alive <= max) break;
    sleep(t, 'count');
  }
  if (idleMs > 0) {
    for (const t of oldest) if (!asleep.has(t.id) && !t.typed && now - t.lastUsed > idleMs) sleep(t, 'idle');
  }
  if (budgetMb > 0) {
    for (const t of oldest) {
      if (total <= budgetMb || alive <= MIN_LIVE) break;
      if (asleep.has(t.id) || t.typed) continue;
      sleep(t, 'memory');
    }
  }
  return out;
}

// Budget mémoire des onglets, en Mo : une part de la mémoire de la machine.
function budget(totalBytes, percent) {
  return Math.round((totalBytes / 1048576) * (percent / 100));
}

module.exports = { pick, budget, MIN_LIVE };
