// Outils partagés par toutes les pages de l'interface.
const O = window.orbe;
let lang = O.lang || 'fr';

// Classe « mac » ou « win » sur <html> : les feuilles de style adaptent
// l'habillage (boutons de fenêtre, police) dans un bloc à part.
document.documentElement.classList.add(O.platform || 'mac');
// Touche « principale » d'un événement clavier ou souris : ⌘ sur macOS, Ctrl ailleurs.
const modKey = (e) => (O.platform === 'mac' || !O.platform ? e.metaKey : e.ctrlKey);

// Raccourcis en vigueur, par nom de commande : suivent les changements faits
// dans les réglages (événement « keys »).
let KEYS = O.keys || {};
// Textes qui citent le raccourci d'une commande.
const KEY_IN_TEXT = { 'side.empty': 'newTab', 'side.toggle': 'toggleSidebar' };

function t(key, vars) {
  let s = (O.locales[lang] && O.locales[lang][key]) || O.locales.fr[key] || key;
  const cmd = KEY_IN_TEXT[key];
  const before = cmd && O.defaultKeys && O.defaultKeys[cmd];
  if (before && KEYS[cmd] !== before) s = KEYS[cmd] ? s.replace(before, KEYS[cmd]) : s.replace(` (${before})`, '').replace(before, '…');
  if (vars) for (const k of Object.keys(vars)) s = s.replace(`{${k}}`, vars[k]);
  return s;
}

function applyI18n(root = document) {
  for (const el of root.querySelectorAll('[data-t]')) el.textContent = t(el.dataset.t);
  for (const el of root.querySelectorAll('[data-t-title]')) el.title = t(el.dataset.tTitle);
  for (const el of root.querySelectorAll('[data-t-ph]')) el.placeholder = t(el.dataset.tPh);
  // Raccourci d'une commande, dans la notation du système.
  for (const el of root.querySelectorAll('[data-key]')) if (KEYS[el.dataset.key]) el.textContent = KEYS[el.dataset.key];
}

// Renvoie true si la langue a changé (la page doit alors se redessiner).
function setLang(next) {
  if (!next || next === lang) return false;
  lang = next;
  document.documentElement.lang = next;
  applyI18n();
  return true;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function host(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'orbe:') return 'Orbe';
    return u.host.replace(/^www\./, '') || url;
  } catch {
    return url || '';
  }
}

// Pastille de remplacement quand un site n'a pas d'icône.
function letterIcon(text) {
  const span = document.createElement('span');
  span.className = 'letter';
  span.textContent = (text || '?').trim().charAt(0).toUpperCase() || '?';
  return span;
}

// Icône probable d'un site dont la page n'a pas encore été chargée :
// demandée au site lui-même, jamais à un service tiers, et une seule fois par
// site : un échec est retenu tant que la vue vit. Sans cela, chaque nouveau
// rendu des lignes (changement d'Espace) redemandait /favicon.ico à tous les
// sites qui n'en ont pas.
const guessedIcons = new Set();
const missingIcons = new Set();
function guessIcon(pageUrl) {
  try {
    const u = new URL(pageUrl);
    if (u.protocol !== 'https:') return '';
    const url = u.origin + '/favicon.ico';
    if (missingIcons.has(url)) return '';
    guessedIcons.add(url);
    return url;
  } catch {
    return '';
  }
}

function faviconEl(url, fallbackText) {
  if (!url || !/^(https?|data):/i.test(url)) return letterIcon(fallbackText);
  const img = document.createElement('img');
  img.className = 'favicon';
  img.draggable = false;
  img.decoding = 'async';
  img.loading = 'lazy';
  img.onerror = () => { if (guessedIcons.has(url)) missingIcons.add(url); img.replaceWith(letterIcon(fallbackText)); };
  img.src = url;
  return img;
}

document.documentElement.lang = lang;
document.addEventListener('DOMContentLoaded', () => applyI18n());
O.on('keys', (k) => { KEYS = k || {}; applyI18n(); });
