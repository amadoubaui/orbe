// Réglages ajoutés par la fenêtre à volets : validation de chaque valeur reçue
// de l'interface, et réglages propres à un profil (moteur de recherche,
// suggestions, archivage, dossier des téléchargements), qui priment sur le
// réglage général quand ils sont définis.
const fs = require('fs');
const path = require('path');
const { store } = require('./store');

const bool = (v) => typeof v === 'boolean';
const ARCHIVE_HOURS = [0, 12, 24, 168, 720];
const HOST = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/;

function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}
// '' : dossier Téléchargements du système.
const downloadDir = (v) => typeof v === 'string' && (v === '' || (v.length < 1024 && path.isAbsolute(v) && isDir(v)));
const searchEngine = (v) => typeof v === 'string' && Object.hasOwn(require('./suggest').ENGINES, v);

// Réglages qu'un profil peut redéfinir.
const PROFILE_KEYS = {
  searchEngine,
  suggestions: bool,
  archiveAfterHours: (v) => ARCHIVE_HOURS.includes(v),
  downloadDir,
};

function profileSettings(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const ids = new Set(store.state.profiles.map((p) => p.id));
  return Object.entries(v).every(([id, o]) => ids.has(id) && o && typeof o === 'object' && !Array.isArray(o)
    && Object.entries(o).every(([k, x]) => Object.hasOwn(PROFILE_KEYS, k) && PROFILE_KEYS[k](x)));
}

// Liens des autres applications : fenêtre principale (Espace le plus récent),
// petite fenêtre, ou un Espace précis (« space:<id> »).
const externalLinks = (v) => v === 'window' || v === 'little'
  || (typeof v === 'string' && v.startsWith('space:') && store.state.spaces.some((sp) => sp.id === v.slice(6)));

const SETTABLE = {
  showToolbar: bool,
  showFullUrl: bool,
  warnOnQuit: bool,
  restoreSession: bool,
  haptics: bool,
  peekShift: bool,
  littleAltClick: bool,
  littleArchiveHours: (v) => ARCHIVE_HOURS.includes(v),
  cookieBanners: bool,
  themeData: bool,
  boostsEnabled: bool,
  mediaControls: bool,
  tabKeysFavorites: bool,
  tabKeysNinthLast: bool,
  devSites: (v) => Array.isArray(v) && v.length <= 200 && v.every((h) => typeof h === 'string' && HOST.test(h)) && new Set(v).size === v.length,
  downloadDir,
  // Téléchargements (downloads.js) : demander où enregistrer, PDF ouverts dans un onglet.
  downloadAsk: bool,
  downloadOpenPdf: bool,
  profileSettings,
  shortcuts: (v) => require('./shortcuts').validMap(v),
};

// Valeur d'un réglage pour un profil : la sienne s'il en a une, sinon la générale.
function get(key, profileId) {
  const s = store.state.settings;
  const own = s.profileSettings && profileId && s.profileSettings[profileId];
  return own && Object.hasOwn(own, key) && Object.hasOwn(PROFILE_KEYS, key) ? own[key] : s[key];
}

// Définit (ou, avec null, rend au réglage général) un réglage de profil.
function setForProfile(profileId, key, value) {
  const s = store.state.settings;
  if (!store.state.profiles.some((p) => p.id === profileId) || !Object.hasOwn(PROFILE_KEYS, key)) return false;
  if (value !== null && !PROFILE_KEYS[key](value)) return false;
  const all = { ...(s.profileSettings || {}) };
  const own = { ...(all[profileId] || {}) };
  if (value === null) delete own[key]; else own[key] = value;
  if (Object.keys(own).length) all[profileId] = own; else delete all[profileId];
  s.profileSettings = all;
  store.save();
  return true;
}

function forgetProfile(profileId) {
  const all = store.state.settings.profileSettings;
  if (all && all[profileId]) { delete all[profileId]; store.save(); }
}

// Dossier où ranger un téléchargement du profil ; '' si le réglage ne vaut plus
// (dossier supprimé depuis) : l'appelant retombe alors sur celui du système.
function downloadDirFor(profileId) {
  const dir = get('downloadDir', profileId);
  return dir && isDir(dir) ? dir : '';
}

// Hôte d'une adresse, tel que noté dans la liste du mode développeur.
function hostOf(url) {
  try { const u = new URL(url); return /^https?:$/.test(u.protocol) ? u.host.toLowerCase() : ''; } catch { return ''; }
}
const devMode = (url) => { const h = hostOf(url); return !!h && (store.state.settings.devSites || []).includes(h); };

module.exports = { SETTABLE, PROFILE_KEYS, ARCHIVE_HOURS, externalLinks, get, setForProfile, forgetProfile, downloadDirFor, hostOf, devMode };
