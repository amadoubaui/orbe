// Notes : export en fichiers texte (Aide → « Exporter les notes… », comme
// « Export Arc Notes »). Une note par fichier, nommé d'après sa première ligne.
const { dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { store } = require('./store');

const t = (key, vars) => store.t(key, null, vars);

// Boîte de dialogue du système ; remplacée pendant les tests.
const env = {
  pickFolder: async (parent, opts) => {
    const r = await (parent ? dialog.showOpenDialog(parent, opts) : dialog.showOpenDialog(opts));
    return r.canceled || !r.filePaths.length ? '' : r.filePaths[0];
  },
  reveal: (dir) => shell.openPath(dir),
};

const titleOf = (note) => (String(note.text || '').split('\n').find((l) => l.trim()) || t('notes.untitled')).trim();

// Nom de fichier tiré d'un titre saisi par l'utilisateur : ni séparateur de dossier,
// ni caractère interdit, ni nom réservé de Windows, ni point en tête.
function fileName(title) {
  const base = String(title).normalize('NFC').replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, ' ').replace(/\s+/g, ' ').replace(/^[. ]+/, '').replace(/[. ]+$/, '').slice(0, 80).trim();
  if (!base || /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(base)) return t('notes.untitled');
  return base;
}

// Écrit chaque note dans `dir` (créé au besoin). Renvoie les fichiers écrits.
function writeAll(dir, notes = store.state.notes) {
  fs.mkdirSync(dir, { recursive: true });
  const used = new Set(fs.readdirSync(dir).map((n) => n.toLowerCase()));
  const files = [];
  for (const note of notes.slice().sort((a, b) => b.at - a.at)) {
    if (!String(note.text || '').trim()) continue;
    const base = fileName(titleOf(note));
    let name = base + '.txt';
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base} (${i}).txt`;
    used.add(name.toLowerCase());
    const file = path.join(dir, name);
    fs.writeFileSync(file, String(note.text), { flag: 'wx' });
    const when = new Date(note.at || Date.now());
    try { fs.utimesSync(file, when, when); } catch {}
    files.push(file);
  }
  return files;
}

// « Exporter les notes… » : l'utilisateur choisit un dossier ; un sous-dossier daté y reçoit les notes.
async function exportNotes(w) {
  const count = store.state.notes.filter((n) => String(n.text || '').trim()).length;
  if (!count) { if (w) w.toast(t('notes.exportNone')); return null; }
  const parent = await env.pickFolder(w ? w.win : null, { title: t('notes.export'), buttonLabel: t('notes.exportHere'), properties: ['openDirectory', 'createDirectory'] });
  if (!parent || typeof parent !== 'string' || !path.isAbsolute(parent)) return null;
  const day = new Date().toISOString().slice(0, 10);
  let dir = path.join(parent, `${t('notes.exportFolder')} ${day}`);
  for (let i = 2; fs.existsSync(dir); i++) dir = path.join(parent, `${t('notes.exportFolder')} ${day} (${i})`);
  let files;
  try { files = writeAll(dir); } catch (err) {
    console.error('[orbe] export des notes', err.message);
    if (w) w.toast(t('notes.exportFailed'), 'error');
    return null;
  }
  if (w) w.toast(t('notes.exported', { n: files.length }));
  env.reveal(dir);
  return { dir, files };
}

module.exports = { exportNotes, writeAll, fileName, titleOf, env };
