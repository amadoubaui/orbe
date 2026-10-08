// « Quitter la page ? » : quand une page demande à ne pas être quittée
// (`beforeunload`), Orbe pose la question au lieu de passer outre.
//
// Chromium n'émet `will-prevent-unload` que si l'utilisateur a déjà agi dans la
// page : une page jamais touchée ne peut retenir personne. La question est une
// boîte de dialogue du système, avec un texte fixe : celui que la page voudrait
// afficher est ignoré (comme dans tous les navigateurs), et « Rester » est le
// choix par défaut.
const { app, dialog } = require('electron');
const { store } = require('./store');

const env = {
  // Renvoie l'indice du bouton choisi : 0 = quitter la page, 1 = rester. Remplacé pendant les tests.
  ask: (parent, opts) => (parent && !parent.isDestroyed() ? dialog.showMessageBoxSync(parent, opts) : dialog.showMessageBoxSync(opts)),
};
const state = { quitting: false, asked: 0 };

// Pose la question, de façon synchrone (l'événement d'Electron l'exige).
// Renvoie true si l'utilisateur accepte de quitter la page.
function confirm(parent, wc) {
  let host = '';
  try { host = new URL(wc.getURL()).host; } catch {}
  state.asked += 1;
  const t = (key, vars) => store.t(key, null, vars);
  let choice = 1;
  try {
    choice = env.ask(parent, {
      type: 'question',
      message: t('unload.title'),
      detail: (host ? host + '\n' : '') + t('unload.detail'),
      buttons: [t('unload.leave'), t('unload.stay')],
      defaultId: 1,
      cancelId: 1,
    });
  } catch (err) { console.error('[orbe] beforeunload', err.message); }
  return choice === 0;
}

// Ferme une à une des pages qui peuvent avoir quelque chose à perdre (fermeture
// d'une fenêtre). `close(rt)` lance la fermeture avec `beforeunload` ; la
// promesse renvoyée dit si toutes ont accepté. La première qui refuse arrête tout.
async function closeAll(rts, close) {
  for (const rt of rts) {
    if (rt.wc.isDestroyed()) continue;
    const ok = await new Promise((resolve) => {
      let timer = null;
      const done = (v) => { clearTimeout(timer); rt.unloadAnswer = null; resolve(v); };
      rt.unloadAnswer = done; // appelé avec false si l'utilisateur choisit de rester
      rt.wc.once('destroyed', () => done(true));
      // Page qui ne répond pas : elle ne retient pas la fenêtre.
      timer = setTimeout(() => { if (rt.unloadAnswer === done) { done(true); if (!rt.wc.isDestroyed()) rt.wc.close({ waitForBeforeUnload: false }); } }, 4000);
      close(rt);
    });
    if (!ok) return false;
  }
  return true;
}

function setup() {
  app.on('before-quit', () => { state.quitting = true; });
}

module.exports = { confirm, closeAll, setup, env, state };
