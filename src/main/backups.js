// Sauvegardes locales de l'état (Espaces, onglets, dossiers, réglages) : une copie
// d'orbe.json à chaque lancement puis toutes les heures, rangée dans
// « sauvegardes ». Comme dans Arc, on garde les dix dernières du jour et une
// par jour pour les dix jours d'avant. Aide → Dépannage → « Restaurer une
// sauvegarde » remet l'une d'elles en place et relance Orbe.
// L'historique (history.json) n'en fait pas partie.
const { app, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { store } = require('./store');

const TODAY_MAX = 10;
const DAYS_MAX = 10;
const NAME = /^orbe-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.json$/;

// Boîte de dialogue et relance ; remplacées pendant les tests.
const env = {
  confirm: async (opts) => (await dialog.showMessageBox(opts)).response === 0,
  relaunch: () => { app.relaunch(); app.exit(0); },
};

const t = (key, vars) => store.t(key, null, vars);
const dirOf = (file) => path.join(path.dirname(file), 'sauvegardes');
const pad = (n) => String(n).padStart(2, '0');
const stamp = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
const dayOf = (name) => name.slice(5, 13);

// Noms à garder parmi `names`, pour un instant donné : les dix plus récentes du
// jour, puis la plus récente de chacun des dix jours précédents qui en ont.
function keep(names, now = new Date()) {
  const sorted = names.filter((n) => NAME.test(n)).sort().reverse();
  const today = stamp(now).slice(0, 8);
  const kept = new Set(sorted.filter((n) => dayOf(n) === today).slice(0, TODAY_MAX));
  const days = [];
  for (const n of sorted) {
    const day = dayOf(n);
    if (day === today || days.includes(day)) continue; // (un jour « futur », horloge reculée, compte comme un autre jour)
    if (days.length >= DAYS_MAX) break;
    days.push(day);
    kept.add(n);
  }
  return kept;
}

// Copie l'état enregistré (s'il est lisible) et retire les copies en trop. Renvoie le fichier créé, ou null.
function snapshot(file = store.file, now = new Date()) {
  if (!file) return null;
  try {
    const raw = fs.readFileSync(file, 'utf8');
    JSON.parse(raw); // un fichier abîmé ne chasse pas une bonne sauvegarde
    const dir = dirOf(file);
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, `orbe-${stamp(now)}.json`);
    fs.writeFileSync(target, raw);
    const names = fs.readdirSync(dir);
    const kept = keep(names, now);
    for (const n of names) if (NAME.test(n) && !kept.has(n)) { try { fs.unlinkSync(path.join(dir, n)); } catch {} }
    return target;
  } catch {
    return null;
  }
}

// Sauvegardes présentes, de la plus récente à la plus ancienne : { name, file, at }.
function list(file = store.file) {
  if (!file) return [];
  let names = [];
  try { names = fs.readdirSync(dirOf(file)); } catch { return []; }
  return names.filter((n) => NAME.test(n)).sort().reverse().map((name) => {
    const m = NAME.exec(name);
    return { name, file: path.join(dirOf(file), name), at: new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() };
  });
}

const label = (b) => new Date(b.at).toLocaleString(store.state.settings.lang, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

// Remet une sauvegarde en place : l'état du moment est d'abord copié, puis Orbe est relancé.
// `name` doit être l'un des fichiers listés (jamais un chemin).
async function restore(name) {
  const b = list().find((x) => x.name === name);
  if (!b || !store.file) return false;
  let parsed;
  let raw;
  try { raw = fs.readFileSync(b.file, 'utf8'); parsed = JSON.parse(raw); } catch { return false; }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.spaces)) return false;
  const ok = await env.confirm({ type: 'warning', message: t('backup.confirm'), detail: t('backup.detail', { date: label(b) }), buttons: [t('backup.restore'), t('sheet.cancel')], defaultId: 1, cancelId: 1 });
  if (!ok) return false;
  const file = store.file;
  store.flush();
  snapshot(file); // l'état quitté reste lui aussi récupérable (ce passage peut retirer la copie choisie : elle est déjà lue)
  fs.writeFileSync(file, raw);
  store.file = null; // plus rien ne doit réécrire l'état avant la relance
  env.relaunch();
  return true;
}

// Articles du menu Aide → Dépannage → « Restaurer une sauvegarde ».
function menuItems(max = 14) {
  const all = list().slice(0, max);
  if (!all.length) return [{ label: t('backup.none'), enabled: false }];
  return all.map((b) => ({ label: label(b), click: () => { restore(b.name); } }));
}

let timer = null;
function start() {
  snapshot();
  if (timer) clearInterval(timer);
  timer = setInterval(() => snapshot(), 60 * 60e3);
  if (timer.unref) timer.unref();
}

module.exports = { snapshot, list, keep, restore, menuItems, start, env, dirOf, TODAY_MAX, DAYS_MAX };
