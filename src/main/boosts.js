// Boosts : personnaliser un site, comme dans Arc. Par domaine, du CSS libre
// et une liste d'éléments masqués (« Zap »). Appliqué à chaque chargement.
const { store } = require('./store');

const applied = new WeakMap(); // webContents -> clé du CSS inséré
// `extraCss(wc)` : CSS ajouté par Orbe à la page (bandeaux de cookies, couleurs du thème).
const hooks = { extraCss: () => '' };

function hostOf(url) {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? u.host.replace(/^www\./, '') : '';
  } catch {
    return '';
  }
}

function get(host) {
  const b = store.state.boosts[host];
  return { css: (b && b.css) || '', zaps: (b && b.zaps) || [], enabled: !b || b.enabled !== false };
}

function set(host, patch) {
  if (!host) return get(host);
  const next = { ...get(host), ...patch };
  next.css = String(next.css || '').slice(0, 50000);
  next.zaps = (next.zaps || []).filter((z) => typeof z === 'string' && z.length < 500).slice(0, 200);
  if (!next.css.trim() && !next.zaps.length) delete store.state.boosts[host];
  else store.state.boosts[host] = next;
  store.save();
  return get(host);
}

function cssFor(host) {
  const b = get(host);
  if (!b.enabled) return '';
  const zap = b.zaps.length ? b.zaps.join(',\n') + ' { display: none !important; }\n' : '';
  return zap + b.css;
}

// (Ré)applique le Boost du site affiché dans cette page. Les appels sont mis
// à la file par page : deux applications simultanées laisseraient un CSS orphelin.
const queue = new WeakMap();
function apply(wc) {
  if (!wc || wc.isDestroyed()) return Promise.resolve();
  const next = (queue.get(wc) || Promise.resolve()).then(() => applyNow(wc)).catch(() => {});
  queue.set(wc, next);
  return next;
}

async function applyNow(wc) {
  if (!wc || wc.isDestroyed()) return;
  const old = applied.get(wc);
  if (old) { applied.delete(wc); await wc.removeInsertedCSS(old).catch(() => {}); }
  const css = (store.state.settings.boostsEnabled === false ? '' : cssFor(hostOf(wc.getURL()))) + hooks.extraCss(wc);
  if (!css.trim() || wc.isDestroyed()) return;
  const key = await wc.insertCSS(css).catch(() => null);
  if (key) applied.set(wc, key);
}

// Laisse l'utilisateur cliquer un élément de la page ; renvoie son sélecteur.
const PICKER = `new Promise((resolve) => {
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;background:rgba(255,60,60,.25);outline:2px solid #ff3c3c;border-radius:4px;transition:all 60ms';
  document.documentElement.appendChild(box);
  let target = null;
  const esc = (s) => CSS.escape(s);
  const selector = (el) => {
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && n !== document.documentElement && parts.length < 6; n = n.parentElement) {
      if (n.id && !/\\d{4,}/.test(n.id)) { parts.unshift('#' + esc(n.id)); break; }
      let p = n.localName;
      const cls = [...n.classList].filter((c) => !/\\d{4,}/.test(c)).slice(0, 2);
      if (cls.length) p += '.' + cls.map(esc).join('.');
      const same = n.parentElement ? [...n.parentElement.children].filter((c) => c.localName === n.localName) : [];
      if (same.length > 1 && !cls.length) p += ':nth-of-type(' + (same.indexOf(n) + 1) + ')';
      parts.unshift(p);
    }
    return parts.join(' > ');
  };
  const move = (e) => {
    target = e.target;
    const r = target.getBoundingClientRect();
    box.style.left = r.left + 'px'; box.style.top = r.top + 'px'; box.style.width = r.width + 'px'; box.style.height = r.height + 'px';
  };
  const done = (value) => {
    removeEventListener('mousemove', move, true); removeEventListener('click', click, true); removeEventListener('keydown', key, true);
    box.remove();
    resolve(value);
  };
  const click = (e) => { e.preventDefault(); e.stopPropagation(); done(target ? selector(target) : ''); };
  const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); done(''); } };
  addEventListener('mousemove', move, true); addEventListener('click', click, true); addEventListener('keydown', key, true);
})`;

async function zap(wc) {
  const host = hostOf(wc.getURL());
  if (!host) return null;
  const sel = await wc.executeJavaScript(PICKER, true).catch(() => '');
  if (!sel) return null;
  const b = get(host);
  set(host, { zaps: [...b.zaps, sel], enabled: true });
  await apply(wc);
  return sel;
}

module.exports = { hostOf, get, set, apply, zap, cssFor, hooks };
