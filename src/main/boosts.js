// Boosts : personnaliser un site, comme dans Arc. Par domaine : une apparence
// (couleur, luminosité inversée, contraste, police, taille, casse), une liste
// d'éléments masqués (« Zap »), du CSS libre et, si l'utilisateur l'a permis, du
// JavaScript. Appliqué à chaque chargement, dans les onglets seulement.
//
// Sécurité (voir docs/securite-navigation.md, « Boosts ») :
//  - le CSS de l'apparence est fabriqué ici, à partir de valeurs bornées ou
//    choisies dans une liste : rien de ce que contient un Boost n'y est recopié ;
//  - un sélecteur de Zap vient de la page (clic) ou d'un fichier importé : il est
//    vérifié (`validSelector`) et chaque sélecteur a sa propre règle ;
//  - le JavaScript ne s'exécute que dans la page elle-même (son monde principal,
//    sans aucun accès à Orbe), jamais dans une page interne, un aperçu, une
//    feuille ou une vue de l'interface, et seulement si le site affiché par le
//    cadre principal est bien celui du Boost — vérifié ici, au dernier moment ;
//  - un Boost importé arrive désactivé, son script coupé : rien ne s'exécute à l'import.
const { store } = require('./store');

const applied = new WeakMap(); // webContents -> clé du CSS inséré
// `extraCss(wc)` : CSS ajouté par Orbe à la page (bandeaux de cookies, couleurs du thème).
// `canScript(wc)` : la page est-elle un onglet web ordinaire ? (posé par window.js)
const hooks = { extraCss: () => '', canScript: () => false };

const CSS_MAX = 50000;
const JS_MAX = 50000;
const ZAP_MAX = 200;
const SELECTOR_MAX = 500;
const NAME_MAX = 60;
const IMPORT_MAX = 300; // Boosts par fichier importé
const FILE_MAX = 2 * 1024 * 1024;

// Polices proposées (« Aa ») : des familles du système, aucune n'est téléchargée.
const FONTS = {
  sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif',
  serif: '"New York", "Iowan Old Style", Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  rounded: 'ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", "Segoe UI", sans-serif',
  hand: '"Bradley Hand", "Segoe Print", "Comic Sans MS", cursive',
};
const CASES = { upper: 'uppercase', lower: 'lowercase', title: 'capitalize' };
// Nuancier : les pastilles de l'éditeur (toute autre couleur « #rrggbb » est acceptée).
const SWATCHES = ['#f87171', '#fb923c', '#facc15', '#4ade80', '#22d3ee', '#60a5fa', '#a78bfa', '#f472b6', '#1f2937', '#f5f5f4'];
const LOOK_DEFAULT = Object.freeze({ color: '', invert: false, contrast: 100, brightness: 100, saturation: 100, font: '', size: 100, case: '' });

function hostOf(url) {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? u.host.replace(/^www\./, '') : '';
  } catch {
    return '';
  }
}

// Nom d'hôte tel que `hostOf` le rend (clé d'un Boost) : rien d'autre n'est accepté d'un fichier.
const validHost = (h) => typeof h === 'string' && h.length <= 255 && /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/i.test(h) && hostOf('http://' + h) === h.toLowerCase();

// Un sélecteur CSS seul, qui ne peut ni fermer la règle ni en ouvrir une autre :
// pas d'accolade, de point-virgule ni d'arobase, pas de commentaire, parenthèses,
// crochets et guillemets fermés, pas de virgule hors parenthèses.
function validSelector(sel) {
  if (typeof sel !== 'string') return false;
  const s = sel.trim();
  if (!s || s.length > SELECTOR_MAX || s !== sel) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f{};@<]/.test(s) || s.includes('/*') || s.includes('*/')) return false;
  const stack = [];
  let quote = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') { if (i === s.length - 1) return false; i += 1; continue; }
    if (quote) { if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === '(' || c === '[') stack.push(c);
    else if (c === ')') { if (stack.pop() !== '(') return false; }
    else if (c === ']') { if (stack.pop() !== '[') return false; }
    else if (c === ',' && !stack.length) return false;
  }
  return !quote && !stack.length;
}

const int = (v, min, max, dflt) => (Number.isFinite(Number(v)) ? Math.max(min, Math.min(max, Math.round(Number(v)))) : dflt);

// Apparence : chaque champ est ramené à une valeur permise.
function cleanLook(look) {
  const l = look && typeof look === 'object' ? look : {};
  return {
    color: typeof l.color === 'string' && /^#[0-9a-f]{6}$/i.test(l.color) ? l.color.toLowerCase() : '',
    invert: l.invert === true,
    contrast: int(l.contrast, 50, 150, 100),
    brightness: int(l.brightness, 50, 150, 100),
    saturation: int(l.saturation, 0, 200, 100),
    font: Object.hasOwn(FONTS, l.font) ? l.font : '',
    size: int(l.size, 90, 150, 100),
    case: Object.hasOwn(CASES, l.case) ? l.case : '',
  };
}

const plainLook = (l) => Object.keys(LOOK_DEFAULT).every((k) => l[k] === LOOK_DEFAULT[k]);

// Un Boost tel qu'il est rangé : tout champ borné, tout sélecteur vérifié.
function clean(b) {
  const x = b && typeof b === 'object' ? b : {};
  return {
    name: String(x.name || '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX),
    css: String(x.css || '').slice(0, CSS_MAX),
    zaps: [...new Set((Array.isArray(x.zaps) ? x.zaps : []).filter(validSelector))].slice(0, ZAP_MAX),
    look: cleanLook(x.look),
    js: String(x.js || '').slice(0, JS_MAX),
    jsOn: x.jsOn === true,
    enabled: x.enabled !== false,
  };
}

const empty = (b) => !b.css.trim() && !b.zaps.length && !b.js.trim() && plainLook(b.look) && !b.name;

function get(host) {
  return clean(store.state.boosts[host]);
}

const has = (host) => !!host && Object.hasOwn(store.state.boosts, host);

function set(host, patch) {
  if (!host) return get(host);
  const next = clean({ ...get(host), ...(patch && typeof patch === 'object' ? patch : {}) });
  if (empty(next)) delete store.state.boosts[host];
  else store.state.boosts[host] = next;
  store.save();
  return get(host);
}

function remove(host) {
  if (!has(host)) return false;
  delete store.state.boosts[host];
  store.save();
  return true;
}

// Tous les Boosts, pour la liste : site, nom, état, ce qu'ils contiennent.
function list() {
  return Object.keys(store.state.boosts).sort().map((host) => {
    const b = get(host);
    return { host, name: b.name, enabled: b.enabled, css: !!b.css.trim(), zaps: b.zaps.length, look: !plainLook(b.look), js: !!b.js.trim(), jsOn: b.jsOn };
  });
}

// Texte lisible sur une couleur de fond (noir ou blanc, selon sa luminance).
function inkFor(hex) {
  const n = parseInt(hex.slice(1), 16);
  const lin = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const lum = 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return lum > 0.4 ? '#111111' : '#ffffff';
}

// CSS de l'apparence. Tout ce qui y figure vient d'ici ou de `cleanLook`.
function lookCss(look) {
  const l = cleanLook(look);
  let css = '';
  if (l.color) {
    const ink = inkFor(l.color);
    css += `html, body { background: ${l.color} !important; color: ${ink} !important; }\n`
      + 'body :where(header, nav, main, section, article, aside, footer, div, form, table, thead, tbody, tr, td, th, ul, ol, li, dl, pre, blockquote, details, summary, fieldset, figure) { background-color: transparent !important; background-image: none !important; }\n'
      + `body :where(h1, h2, h3, h4, h5, h6, p, span, li, td, th, dt, dd, label, small, strong, em, b, i, blockquote, figcaption, summary) { color: ${ink} !important; }\n`
      + `body :where(a, a *) { color: color-mix(in srgb, ${ink} 78%, ${l.color}) !important; text-decoration-color: currentColor !important; }\n`
      + `body :where(input, textarea, select, button) { background-color: color-mix(in srgb, ${ink} 10%, ${l.color}) !important; color: ${ink} !important; border-color: color-mix(in srgb, ${ink} 30%, ${l.color}) !important; }\n`;
  }
  const filters = [];
  if (l.invert) filters.push('invert(1)', 'hue-rotate(180deg)');
  if (l.contrast !== 100) filters.push(`contrast(${l.contrast}%)`);
  if (l.brightness !== 100) filters.push(`brightness(${l.brightness}%)`);
  if (l.saturation !== 100) filters.push(`saturate(${l.saturation}%)`);
  if (filters.length) css += `html { filter: ${filters.join(' ')} !important; }\n`;
  // Luminosité inversée : les images et les vidéos retrouvent leurs vraies couleurs.
  if (l.invert) css += 'html { background-color: #fff !important; }\nimg, picture, video, canvas, iframe, embed, object, svg image, [style*="background-image"] { filter: invert(1) hue-rotate(180deg) !important; }\n';
  if (l.font) css += `body, body :not(i):not(svg):not(svg *):not(pre):not(code):not(kbd):not(samp):not([class*="icon" i]):not([class*="fa-"]):not([class*="material" i]):not([class*="glyph" i]) { font-family: ${FONTS[l.font]} !important; }\n`;
  if (l.size !== 100) css += `html { zoom: ${l.size / 100} !important; }\n`;
  if (l.case) css += `body, body * { text-transform: ${CASES[l.case]} !important; }\n`;
  return css;
}

function cssFor(host) {
  if (!has(host)) return '';
  const b = get(host);
  if (!b.enabled) return '';
  // Une règle par sélecteur : un sélecteur que le moteur refuse n'emporte pas les autres.
  const zap = b.zaps.map((z) => `${z} { display: none !important; }\n`).join('');
  return lookCss(b.look) + zap + b.css;
}

const globallyOn = () => store.state.settings.boostsEnabled !== false;

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
  const css = (globallyOn() ? cssFor(hostOf(wc.getURL())) : '') + hooks.extraCss(wc);
  if (!css.trim() || wc.isDestroyed()) return;
  const key = await wc.insertCSS(css).catch(() => null);
  if (key) applied.set(wc, key);
}

// Le script d'un Boost a-t-il le droit de s'exécuter pour ce site ?
// Trois accords : le réglage général des Boosts, le réglage « JavaScript des
// Boosts » (coupé par défaut) et la case du Boost lui-même.
function scriptFor(host) {
  if (!has(host) || !globallyOn() || store.state.settings.boostsJs !== true) return '';
  const b = get(host);
  return b.enabled && b.jsOn && b.js.trim() ? b.js : '';
}

// Exécute le script du Boost dans la page qui vient de se charger. Appelé une fois
// par chargement (`dom-ready` du cadre principal) : jamais à chaque modification,
// un script déjà exécuté ne se retire qu'en rechargeant la page.
// Le site est relu sur le cadre lui-même, au moment d'exécuter : si la page a
// changé de site entre-temps, le cadre n'est plus le même et rien ne part.
const ran = { count: 0, last: null }; // pour les essais et l'éditeur
async function runScript(wc) {
  if (!wc || wc.isDestroyed() || !hooks.canScript(wc)) return false;
  const frame = wc.mainFrame;
  if (!frame || frame.isDestroyed()) return false;
  const host = hostOf(frame.url);
  const js = host && hostOf(wc.getURL()) === host ? scriptFor(host) : '';
  if (!js) return false;
  ran.count += 1;
  ran.last = { host, at: Date.now(), error: '' };
  const mine = ran.last;
  // Monde principal de la page (celui de ses propres scripts) : droits de la page, rien de plus.
  // L'erreur du script est rendue comme un texte, pour l'éditeur ; la valeur du script est ignorée.
  const code = `(async () => { try {\n${js}\n} catch (e) { console.error('[Boost]', e); return String((e && e.message) || e).slice(0, 300); } return ''; })()`;
  try { mine.error = String((await frame.executeJavaScript(code, false)) || '').slice(0, 300); } catch (err) { mine.error = String((err && err.message) || err).slice(0, 300); }
  return true;
}

// Laisse l'utilisateur cliquer un élément de la page ; renvoie son sélecteur.
const PICKER = `new Promise((resolve) => {
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;background:rgba(255,60,60,.25);outline:2px solid #ff3c3c;border-radius:4px;transition:all 60ms';
  document.documentElement.appendChild(box);
  let target = null;
  const esc = (s) => CSS.escape(s);
  const plain = (s) => !/\\d{4,}/.test(s) && !/[{};@<,]/.test(s);
  const selector = (el) => {
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && n !== document.documentElement && parts.length < 6; n = n.parentElement) {
      if (n.id && plain(n.id)) { parts.unshift('#' + esc(n.id)); break; }
      let p = n.localName;
      const cls = [...n.classList].filter(plain).slice(0, 2);
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

// Le sélecteur est fabriqué dans la page : c'est elle qui le rend. Il est donc
// vérifié comme tout texte venu d'ailleurs, et rangé pour le site que le
// processus principal voit affiché (jamais pour un site que la page nommerait).
async function zap(wc, forHost) {
  const host = hostOf(wc.getURL());
  if (!host || (forHost && forHost !== host)) return null;
  const sel = await wc.executeJavaScript(PICKER, true).catch(() => '');
  if (!validSelector(sel) || wc.isDestroyed() || hostOf(wc.getURL()) !== host) return null;
  const b = get(host);
  set(host, { zaps: [...b.zaps, sel], enabled: true });
  await apply(wc);
  return sel;
}

// --- Export et import ---------------------------------------------------------
// Fichier JSON : { orbeBoosts: 1, boosts: [{ host, name, css, zaps, look, js }] }.
function exportData(hosts) {
  const names = (Array.isArray(hosts) && hosts.length ? hosts : Object.keys(store.state.boosts)).filter(has).sort();
  return {
    orbeBoosts: 1,
    boosts: names.map((host) => { const b = get(host); return { host, name: b.name, css: b.css, zaps: b.zaps, look: b.look, js: b.js }; }),
  };
}

// Reprend un fichier exporté. Rien de ce qu'il contient n'est exécuté ni appliqué :
// chaque Boost arrive désactivé, son script coupé, et ne remplace jamais un Boost
// existant. Renvoie { added: [sites], skipped: [sites déjà pourvus], rejected: n }.
function importData(data) {
  const out = { added: [], skipped: [], rejected: 0 };
  const items = data && typeof data === 'object' && data.orbeBoosts === 1 && Array.isArray(data.boosts) ? data.boosts : null;
  if (!items) return { ...out, error: 'format' };
  for (const raw of items.slice(0, IMPORT_MAX)) {
    const host = raw && typeof raw === 'object' && typeof raw.host === 'string' ? raw.host.toLowerCase() : '';
    if (!validHost(host)) { out.rejected += 1; continue; }
    if (has(host) || out.added.includes(host)) { out.skipped.push(host); continue; }
    // Seuls les champs connus sont lus, chacun selon son type ; le reste est ignoré.
    const b = clean({
      name: typeof raw.name === 'string' ? raw.name : '',
      css: typeof raw.css === 'string' ? raw.css : '',
      zaps: Array.isArray(raw.zaps) ? raw.zaps.filter((z) => typeof z === 'string').slice(0, ZAP_MAX * 2) : [],
      look: raw.look,
      js: typeof raw.js === 'string' ? raw.js : '',
      jsOn: false,
      enabled: false,
    });
    if (empty(b)) { out.rejected += 1; continue; }
    store.state.boosts[host] = b;
    out.added.push(host);
  }
  out.rejected += Math.max(0, items.length - IMPORT_MAX);
  if (out.added.length) store.save();
  return out;
}

// Texte d'un fichier d'import : borné, puis lu comme du JSON et rien d'autre.
function importText(text) {
  if (typeof text !== 'string' || text.length > FILE_MAX) return { added: [], skipped: [], rejected: 0, error: 'size' };
  let data = null;
  try { data = JSON.parse(text); } catch { return { added: [], skipped: [], rejected: 0, error: 'format' }; }
  return importData(data);
}

module.exports = { hostOf, get, set, has, remove, list, apply, zap, cssFor, lookCss, cleanLook, validSelector, validHost, scriptFor, runScript, ran, exportData, importData, importText, hooks, FONTS, CASES, SWATCHES, FILE_MAX };
