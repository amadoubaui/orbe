// Outils partagés par toutes les pages de l'interface.
const O = window.orbe;
let lang = O.lang || 'fr';

function t(key, vars) {
  let s = (O.locales[lang] && O.locales[lang][key]) || O.locales.fr[key] || key;
  if (vars) for (const k of Object.keys(vars)) s = s.replace(`{${k}}`, vars[k]);
  return s;
}

function applyI18n(root = document) {
  for (const el of root.querySelectorAll('[data-t]')) el.textContent = t(el.dataset.t);
  for (const el of root.querySelectorAll('[data-t-title]')) el.title = t(el.dataset.tTitle);
  for (const el of root.querySelectorAll('[data-t-ph]')) el.placeholder = t(el.dataset.tPh);
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
// demandée au site lui-même, jamais à un service tiers.
function guessIcon(pageUrl) {
  try {
    const u = new URL(pageUrl);
    return u.protocol === 'https:' ? u.origin + '/favicon.ico' : '';
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
  img.onerror = () => img.replaceWith(letterIcon(fallbackText));
  img.src = url;
  return img;
}

document.documentElement.lang = lang;
document.addEventListener('DOMContentLoaded', () => applyI18n());
