// Barre de commande : interprétation de la saisie et suggestions.
const { net } = require('electron');
const { store } = require('./store');

const ENGINES = {
  google: { name: 'Google', search: 'https://www.google.com/search?q=%s', suggest: 'https://suggestqueries.google.com/complete/search?client=firefox&q=%s' },
  duckduckgo: { name: 'DuckDuckGo', search: 'https://duckduckgo.com/?q=%s', suggest: 'https://duckduckgo.com/ac/?type=list&q=%s' },
  bing: { name: 'Bing', search: 'https://www.bing.com/search?q=%s', suggest: 'https://api.bing.com/osjson.aspx?query=%s' },
  qwant: { name: 'Qwant', search: 'https://www.qwant.com/?q=%s', suggest: 'https://api.qwant.com/v3/suggest?q=%s' },
  ecosia: { name: 'Ecosia', search: 'https://www.ecosia.org/search?q=%s', suggest: 'https://ac.ecosia.org/autocomplete?type=list&q=%s' },
  brave: { name: 'Brave', search: 'https://search.brave.com/search?q=%s', suggest: 'https://search.brave.com/api/suggest?q=%s' },
};

const engine = () => ENGINES[store.state.settings.searchEngine] || ENGINES.google;
const searchUrl = (q) => engine().search.replace('%s', encodeURIComponent(q));

// Renvoie une URL si la saisie ressemble à une adresse, sinon null.
function toUrl(input) {
  const s = input.trim();
  if (!s) return null;
  if (/^(https?|orbe|file|about|view-source|chrome|data|blob):/i.test(s)) return s;
  if (/\s/.test(s)) return null;
  if (/^localhost(:\d+)?(\/.*)?$/i.test(s) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/.*)?$/.test(s)) return 'http://' + s;
  if (/^[^\s/?#]+\.[a-z]{2,}(:\d+)?([/?#].*)?$/i.test(s)) return 'https://' + s;
  return null;
}

const resolve = (input) => toUrl(input) || searchUrl(input.trim());

const strip = (url) => url.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '');

function norm(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Suggestions locales, synchrones : la liste apparaît sans attendre le réseau.
function local(query, { tabs, commands, activeId }) {
  const q = norm(query.trim());
  const out = [];
  if (!q) {
    for (const t of tabs.filter((x) => x.id !== activeId).sort((a, b) => (b.lastActiveAt || 0) - (a.lastActiveAt || 0)).slice(0, 6)) {
      out.push({ kind: 'tab', tabId: t.id, title: t.title || strip(t.url), subtitle: strip(t.url), favicon: t.favicon });
    }
    return out;
  }
  const url = toUrl(query);
  const hist = [];
  const now = Date.now();
  for (const h of Object.values(store.state.history)) {
    const u = norm(strip(h.url));
    const title = norm(h.title);
    let score = 0;
    if (u.startsWith(q)) score = 100;
    else if (u.includes(q)) score = 40;
    else if (title.includes(q)) score = 30;
    if (!score) continue;
    score += Math.min(h.visits, 30) + Math.max(0, 20 - (now - h.last) / 864e5);
    score -= Math.min(u.length, 80) / 8;
    hist.push({ score, h, prefix: u.startsWith(q) });
  }
  hist.sort((a, b) => b.score - a.score);

  const best = hist[0];
  if (url) out.push({ kind: 'url', url, title: strip(url), subtitle: store.t('cmd.open') });
  else if (best && best.prefix) {
    out.push({ kind: 'history', url: best.h.url, title: best.h.title || strip(best.h.url), subtitle: strip(best.h.url), favicon: best.h.favicon, complete: strip(best.h.url) });
    hist.shift();
  }
  out.push({ kind: 'search', url: searchUrl(query.trim()), title: query.trim(), subtitle: store.t('cmd.search', null, { engine: engine().name }) });

  const seen = new Set(out.map((o) => o.url));
  for (const t of tabs) {
    if (t.id === activeId) continue;
    if (norm(t.title).includes(q) || norm(strip(t.url)).includes(q)) {
      out.push({ kind: 'tab', tabId: t.id, title: t.title || strip(t.url), subtitle: store.t('cmd.switchTo'), favicon: t.favicon });
      seen.add(t.url);
      if (out.length >= 4) break;
    }
  }
  for (const c of commands) {
    if (norm(c.title).includes(q)) {
      out.push({ kind: 'command', command: c.command, title: c.title, subtitle: c.shortcut || store.t('cmd.action') });
      if (out.length >= 6) break;
    }
  }
  for (const { h } of hist) {
    if (out.length >= 8) break;
    if (seen.has(h.url)) continue;
    out.push({ kind: 'history', url: h.url, title: h.title || strip(h.url), subtitle: strip(h.url), favicon: h.favicon });
  }
  return out;
}

// Suggestions du moteur de recherche, asynchrones et annulables.
async function remote(query, signal) {
  const q = query.trim();
  if (!q || !store.state.settings.suggestions || toUrl(q)) return [];
  try {
    const res = await net.fetch(engine().suggest.replace('%s', encodeURIComponent(q)), { signal });
    if (!res.ok) return [];
    const json = await res.json();
    const list = Array.isArray(json) && Array.isArray(json[1]) ? json[1] : [];
    return list.filter((s) => typeof s === 'string' && s.toLowerCase() !== q.toLowerCase()).slice(0, 4)
      .map((s) => ({ kind: 'search', url: searchUrl(s), title: s, subtitle: store.t('cmd.search', null, { engine: engine().name }) }));
  } catch {
    return [];
  }
}

module.exports = { ENGINES, resolve, toUrl, searchUrl, strip, local, remote };
