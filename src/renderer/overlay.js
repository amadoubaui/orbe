// Vues flottantes. La même page sert de fenêtre modale (barre de commande,
// bascule d'onglets, thème), de barre de recherche ou de notification.
const $ = (id) => document.getElementById(id);
const send = O.send;
const panels = ['command', 'switcher', 'theme', 'find', 'toast', 'peek', 'status', 'drop', 'swipe'];
let mode = null;

function show(name) {
  mode = name;
  for (const p of panels) $(p).hidden = p !== name;
}

// --- Barre de commande ------------------------------------------------------
const input = $('cmd-input');
const list = $('cmd-list');
let items = [];
let sel = -1;
let seq = 0;
let typed = '';
let deleting = false;
// Portée de la recherche : null (tout), 'actions' (⇥ sur une barre vide), ou
// { site, name } (recherche dans un site : son nom, ⇥ ou espace, la requête).
let scope = null;
let sites = {}; // clé tapée -> [identifiant, nom] (donnée à l'ouverture)

const KIND_ICON = { search: 'search', url: 'globe', history: 'globe', command: 'bolt', tab: 'globe', site: 'search' };

function setScope(next) {
  scope = next;
  const chip = $('cmd-scope');
  chip.hidden = !scope;
  chip.textContent = scope === 'actions' ? t('cmd.actions') : (scope ? scope.name : '');
  input.placeholder = scope === 'actions' ? t('cmd.actionsPlaceholder') : (scope ? t('cmd.searchSite', { site: scope.name }) : t('cmd.placeholder'));
}

// Entre dans une portée : le champ se vide, les suggestions suivent.
function enterScope(next) {
  setScope(next);
  input.value = '';
  typed = '';
  deleting = false;
  input.focus();
  query();
}

// Site désigné par la saisie entière (« yt », « youtube.com »), ou null.
function siteTyped() {
  const hit = sites[typed.trim().toLowerCase()];
  return hit ? { site: hit[0], name: hit[1] } : null;
}

function drawItems() {
  list.textContent = '';
  items.forEach((it, i) => {
    const row = document.createElement('div');
    row.className = 'cmd' + (i === sel ? ' sel' : '');
    row.dataset.i = i;
    const ic = document.createElement('span');
    ic.className = 'ic';
    if (it.favicon) ic.appendChild(faviconEl(it.favicon, it.title));
    else ic.innerHTML = `<svg class="i"><use href="#i-${KIND_ICON[it.kind] || 'globe'}"/></svg>`;
    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = it.title;
    const sub = document.createElement('span');
    sub.className = 'sub';
    sub.textContent = it.subtitle ? '— ' + it.subtitle : '';
    const hint = document.createElement('span');
    hint.className = 'hint';
    hint.textContent = it.kind === 'tab' ? t('cmd.switchTo') + ' ↵' : (it.kind === 'site' ? '⇥' : '↵');
    row.append(ic, title, sub, hint);
    // Suggestion venue de l'historique ou de l'archive : une croix l'oublie.
    if (it.deletable) {
      const del = document.createElement('button');
      del.className = 'del';
      del.tabIndex = -1;
      del.title = t('cmd.forget');
      del.innerHTML = '<svg class="i"><use href="#i-x"/></svg>';
      row.appendChild(del);
    }
    list.appendChild(row);
  });
}

function select(i) {
  sel = i;
  for (const row of list.children) {
    const on = Number(row.dataset.i) === sel;
    row.classList.toggle('sel', on);
    if (on) row.scrollIntoView({ block: 'nearest' });
  }
}

async function query() {
  const q = typed;
  const mine = ++seq;
  const res = (await send('suggest', scope ? { q, scope } : q)) || [];
  if (mine !== seq || mode !== 'command') return;
  items = res;
  sel = q ? 0 : -1;
  // Complète l'adresse la plus probable, comme dans une barre d'adresse.
  const first = items[0];
  if (q && !scope && !deleting && first && first.complete && first.complete.toLowerCase().startsWith(q.toLowerCase()) && input.selectionStart === input.value.length) {
    input.value = q + first.complete.slice(q.length);
    input.setSelectionRange(q.length, input.value.length);
  }
  drawItems();
}

function run(background) {
  const text = input.value.trim();
  const item = sel >= 0 && items[sel] ? items[sel] : (text ? { kind: 'raw', title: text } : null);
  if (!item) return send('closeOverlay');
  // « Rechercher sur YouTube » : la ligne ouvre la recherche dans ce site.
  if (item.kind === 'site') return enterScope({ site: item.site, name: item.name });
  return send('run', { item, background });
}

// Oublie la suggestion (croix au survol, ou ⌥⌘⌫ sur la ligne sélectionnée).
async function forget(i) {
  const it = items[i];
  if (!it || !it.deletable) return;
  await send('suggestDelete', { url: it.url, deletable: true });
  const keep = Math.min(i, items.length - 2);
  await query();
  if (keep >= 0 && items[keep]) select(keep);
}

input.addEventListener('input', (e) => {
  deleting = !!e.inputType && e.inputType.startsWith('delete');
  typed = input.value;
  query();
});

input.addEventListener('keydown', (e) => {
  if (e.key === 'Tab' && !e.shiftKey && !scope && (!input.value || siteTyped())) {
    // ⇥ sur une barre vide : les actions seules. ⇥ après le nom d'un site : la recherche dans ce site.
    e.preventDefault();
    enterScope(input.value ? siteTyped() : 'actions');
  } else if (e.key === ' ' && !scope && typed.includes('.') && siteTyped() && input.selectionStart === typed.length && typed === typed.trim()) {
    // Domaine d'un site (« youtube.com ») puis espace : même effet que ⇥. Un simple mot
    // (« maps », « google ») garde l'espace : il commence souvent une recherche ordinaire.
    e.preventDefault();
    enterScope(siteTyped());
  } else if (e.key === 'Backspace' && scope && !input.value) {
    // Retour arrière sur un champ vide : on quitte la portée.
    e.preventDefault();
    enterScope(null);
  } else if (e.key === 'Backspace' && e.altKey && modKey(e)) {
    e.preventDefault();
    forget(sel);
  } else if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
    e.preventDefault();
    if (items.length) select((sel + 1) % items.length);
  } else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
    e.preventDefault();
    if (items.length) select(sel <= 0 ? items.length - 1 : sel - 1);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    run(modKey(e));
  }
});

list.addEventListener('mousemove', (e) => {
  const row = e.target.closest('.cmd');
  if (row && Number(row.dataset.i) !== sel) select(Number(row.dataset.i));
});
// Un clic dans la liste ne prend pas le clavier : on continue de taper dans le champ
// (croix « oublier », ligne « Rechercher sur … » qui ouvre une portée).
list.addEventListener('mousedown', (e) => e.preventDefault());
list.addEventListener('click', (e) => {
  const row = e.target.closest('.cmd');
  if (!row) return;
  if (e.target.closest('.del')) return void forget(Number(row.dataset.i));
  sel = Number(row.dataset.i);
  run(modKey(e));
});

// Copier l'adresse entière depuis le champ : le presse-papiers reçoit « https:// »
// même si le champ ne montre que « exemple.fr/page » (adresse complétée ou tapée sans protocole).
input.addEventListener('copy', (e) => {
  const whole = input.selectionStart === 0 && input.selectionEnd === input.value.length && input.value.trim();
  const first = items[0];
  if (!whole || scope || !first || !first.url || !/^https?:/i.test(first.url)) return;
  const shown = input.value.trim().toLowerCase();
  const bare = first.url.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '').toLowerCase();
  if ((first.kind !== 'url' && first.kind !== 'history') || (shown !== bare && shown !== bare + '/' && 'www.' + bare !== shown)) return;
  e.preventDefault();
  e.clipboardData.setData('text/plain', first.url);
});

function openCommand(p) {
  show('command');
  const box = $('command');
  box.classList.toggle('anchored', !!p.anchor);
  if (p.anchor) box.style.cssText = `left:${p.anchor.x}px;top:${p.anchor.y}px;width:${p.anchor.width}px`;
  else box.style.cssText = `left:${p.centerX ? p.centerX + 'px' : '50%'}`;
  input.value = p.value || '';
  typed = '';
  deleting = false;
  sites = p.sites || {};
  setScope(null);
  items = p.items || [];
  sel = -1;
  seq++;
  drawItems();
  input.focus();
  input.select();
}

O.on('suggest-more', (p) => {
  if (mode !== 'command' || scope || p.q !== typed) return;
  items = items.concat(p.items).slice(0, 9);
  drawItems();
});

// --- Bascule d'onglets ------------------------------------------------------
function openSwitcher(p) {
  show('switcher');
  const box = $('switcher');
  box.textContent = '';
  p.items.forEach((it, i) => {
    const el = document.createElement('div');
    el.className = 'sw' + (i === p.index ? ' sel' : '');
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = it.title;
    // Vignette de la page quand elle existe, sinon l'icône du site.
    if (it.thumb) {
      const shot = document.createElement('img');
      shot.className = 'shot';
      shot.src = it.thumb;
      const cap = document.createElement('span');
      cap.className = 'cap';
      cap.append(faviconEl(it.favicon, it.title), name);
      el.classList.add('has-shot');
      el.append(shot, cap);
    } else {
      el.append(faviconEl(it.favicon, it.title), name);
    }
    box.appendChild(el);
  });
}

// --- Thème de l'Espace ------------------------------------------------------
// Éditeur : un nuancier où chaque couleur est un point que l'on déplace (teinte
// autour, saturation du centre au bord), « + » et « − » pour passer d'une à trois
// couleurs (aucune : thème par défaut), intensité, texture, apparence, thèmes et
// nuanciers prêts, icône. Chaque geste part aussitôt vers la fenêtre, qui
// repeint la barre : l'aperçu, c'est la barre elle-même.
const ICONS = ['🏠', '💼', '✨', '🎬', '🎨', '🎧', '📚', '🧪', '🛒', '💬', '🧭', '🌍', '🚀', '⚙️', '❤️', '🌙', '☀️', '🌿', '🔥', '🎮', '📷', '✈️', '🍿', '🧠', '💡', '📈', '🔒', '🎓', '⚽️', '🏦', '📝', '⭐️'];
const WHEEL = 140; // diamètre du nuancier
const wheel = $('theme-wheel');
let theme = null; // { dots: [{h, s, v}], sel, intensity, grain, texture, mode, icon, preset }
let themeFrame = 0;
let themePatch = {};

const dotHex = (d) => OrbeTheme.hsvToHex(d.h, d.s, d.v);
// Envoi groupé : un message par image au plus, pendant qu'un point ou un curseur bouge.
function pushTheme(patch) {
  Object.assign(themePatch, patch);
  if (themeFrame) return;
  themeFrame = requestAnimationFrame(() => {
    themeFrame = 0;
    const out = themePatch;
    themePatch = {};
    send('theme', out);
  });
}
const pushColors = () => { theme.preset = ''; pushTheme({ colors: theme.dots.map(dotHex) }); };

function drawTheme() {
  const colors = theme.dots.map(dotHex);
  // Points du nuancier : créés une fois, puis seulement déplacés.
  const dots = wheel.querySelectorAll('.dot');
  for (let i = theme.dots.length; i < dots.length; i++) dots[i].remove();
  theme.dots.forEach((d, i) => {
    let el = wheel.querySelectorAll('.dot')[i];
    if (!el) {
      el = document.createElement('button');
      el.className = 'dot';
      wheel.appendChild(el);
    }
    el.dataset.i = i;
    el.classList.toggle('sel', i === theme.sel);
    el.style.background = colors[i];
    const r = (WHEEL / 2) * d.s;
    const a = (d.h * Math.PI) / 180;
    el.style.transform = `translate(${(WHEEL / 2 + r * Math.sin(a)).toFixed(1)}px, ${(WHEEL / 2 - r * Math.cos(a)).toFixed(1)}px)`;
  });
  wheel.classList.toggle('plain', !theme.dots.length);
  $('theme-n').textContent = String(theme.dots.length);
  $('theme-less').disabled = !theme.dots.length;
  $('theme-more').disabled = theme.dots.length >= OrbeTheme.MAX_COLORS;
  const current = theme.dots.length ? colors[theme.sel] : '';
  for (const b of $('theme-palettes').children) b.classList.toggle('sel', b.dataset.c === current);
  for (const b of $('theme-presets').children) b.classList.toggle('sel', b.dataset.preset === theme.preset);
  for (const b of $('theme-textures').children) b.classList.toggle('sel', b.dataset.tx === theme.texture);
  for (const b of $('theme-modes').children) b.classList.toggle('sel', b.dataset.mode === theme.mode);
  for (const b of $('theme-icons').children) b.classList.toggle('sel', b.textContent === theme.icon);
  // Le panneau suit la couleur principale.
  document.documentElement.style.setProperty('--accent', colors[0] || OrbeTheme.DEFAULT_COLOR);
}

function openTheme(p) {
  show('theme');
  const t0 = OrbeTheme.normalize(p.space);
  theme = { dots: t0.colors.map(OrbeTheme.hexToHsv), sel: 0, intensity: t0.intensity, grain: t0.grain, texture: t0.texture, mode: t0.mode, icon: p.icon, preset: '' };
  $('theme').style.left = (p.x || 260) + 'px';
  $('theme-intensity').value = String(Math.round(t0.intensity * 100));
  $('theme-grain').value = String(Math.round(t0.grain * 100));
  const swatch = (c, family) => `<button class="sw-color" data-c="${esc(c)}" data-family="${family}" style="background:${esc(c)}"></button>`;
  $('theme-palettes').innerHTML = Object.entries(OrbeTheme.PALETTES).map(([family, list]) => list.map((c) => swatch(c, family)).join('')).join('');
  $('theme-presets').innerHTML = OrbeTheme.PRESETS.map((x) => {
    const look = OrbeTheme.palette({ colors: x.colors, accent: x.colors[0], intensity: 1, grain: 0, texture: x.texture, mode: 'light' }, false);
    return `<button class="preset" data-preset="${x.id}" title="${esc(t('theme.preset.' + x.id))}" style="background:${OrbeTheme.paint(look)}"></button>`;
  }).join('');
  $('theme-textures').innerHTML = OrbeTheme.TEXTURES.map((x) => `<button class="tx" data-tx="${x}" title="${esc(t('theme.tx.' + x))}" style="background-image:url(textures/${x}.png)"></button>`).join('');
  $('theme-icons').innerHTML = ICONS.map((e) => `<button class="sw-icon">${e}</button>`).join('');
  drawTheme();
}

// Position du pointeur dans le nuancier -> teinte et saturation.
function wheelAt(e) {
  const r = wheel.getBoundingClientRect();
  const x = e.clientX - r.left - r.width / 2;
  const y = e.clientY - r.top - r.height / 2;
  return { h: ((Math.atan2(x, -y) * 180) / Math.PI + 360) % 360, s: Math.min(1, Math.hypot(x, y) / (r.width / 2)) };
}
wheel.addEventListener('pointerdown', (e) => {
  if (!theme || e.button !== 0) return;
  e.preventDefault();
  const hit = e.target.closest('.dot');
  if (hit) theme.sel = Number(hit.dataset.i);
  else if (!theme.dots.length) { theme.dots.push({ ...wheelAt(e), v: 1 }); theme.sel = 0; } // thème par défaut : un clic pose la première couleur
  const dot = theme.dots[theme.sel];
  const move = (ev) => {
    Object.assign(dot, wheelAt(ev));
    // Hors du centre, une couleur éteinte (gris des nuanciers) retrouve de l'éclat.
    if (dot.s > 0.15 && dot.v < 0.55) dot.v = 0.9;
    drawTheme();
    pushColors();
  };
  wheel.setPointerCapture(e.pointerId);
  if (!hit) move(e);
  else drawTheme();
  const up = () => {
    wheel.removeEventListener('pointermove', move);
    wheel.removeEventListener('pointerup', up);
    wheel.removeEventListener('pointercancel', up);
  };
  wheel.addEventListener('pointermove', move);
  wheel.addEventListener('pointerup', up);
  wheel.addEventListener('pointercancel', up);
});
// Au clavier : les flèches déplacent le point qui a le focus.
wheel.addEventListener('keydown', (e) => {
  const hit = e.target.closest('.dot');
  const step = { ArrowLeft: [-6, 0], ArrowRight: [6, 0], ArrowUp: [0, 0.05], ArrowDown: [0, -0.05] }[e.key];
  if (!hit || !step) return;
  e.preventDefault();
  theme.sel = Number(hit.dataset.i);
  const dot = theme.dots[theme.sel];
  dot.h = (dot.h + step[0] + 360) % 360;
  dot.s = Math.max(0, Math.min(1, dot.s + step[1]));
  drawTheme();
  pushColors();
});
$('theme-more').onclick = () => {
  if (theme.dots.length >= OrbeTheme.MAX_COLORS) return;
  const last = theme.dots[theme.dots.length - 1];
  // La nouvelle couleur part de la voisine, un peu plus loin sur le cercle.
  theme.dots.push(last ? { h: (last.h + 48) % 360, s: Math.max(0.45, last.s), v: last.v } : OrbeTheme.hexToHsv(OrbeTheme.DEFAULT_COLOR));
  theme.sel = theme.dots.length - 1;
  drawTheme();
  pushColors();
};
$('theme-less').onclick = () => {
  if (!theme.dots.length) return;
  theme.dots.splice(theme.sel, 1);
  theme.sel = Math.max(0, Math.min(theme.sel, theme.dots.length - 1));
  drawTheme();
  pushColors(); // plus aucune couleur : thème par défaut
};
$('theme-palettes').addEventListener('click', (e) => {
  const b = e.target.closest('.sw-color');
  if (!b) return;
  const hsv = OrbeTheme.hexToHsv(b.dataset.c);
  if (theme.dots.length) theme.dots[theme.sel] = hsv; else { theme.dots.push(hsv); theme.sel = 0; }
  drawTheme();
  theme.preset = '';
  // La teinte exacte du nuancier, sans passer par le cercle.
  pushTheme({ colors: theme.dots.map((d, i) => (i === theme.sel ? b.dataset.c : dotHex(d))) });
});
$('theme-presets').addEventListener('click', (e) => {
  const b = e.target.closest('.preset');
  const preset = b && OrbeTheme.PRESETS.find((x) => x.id === b.dataset.preset);
  if (!preset) return;
  Object.assign(theme, { dots: preset.colors.map(OrbeTheme.hexToHsv), sel: 0, intensity: preset.intensity, grain: preset.grain, texture: preset.texture, preset: preset.id });
  $('theme-intensity').value = String(Math.round(preset.intensity * 100));
  $('theme-grain').value = String(Math.round(preset.grain * 100));
  drawTheme();
  pushTheme({ preset: preset.id });
});
$('theme-intensity').addEventListener('input', (e) => { theme.intensity = Number(e.target.value) / 100; theme.preset = ''; pushTheme({ intensity: theme.intensity }); });
$('theme-grain').addEventListener('input', (e) => { theme.grain = Number(e.target.value) / 100; pushTheme({ grain: theme.grain }); });
$('theme-textures').addEventListener('click', (e) => {
  const b = e.target.closest('.tx');
  if (!b) return;
  theme.texture = b.dataset.tx;
  // Choisir une texture sans force réglée la rend visible.
  if (!theme.grain) { theme.grain = 0.3; $('theme-grain').value = '30'; }
  drawTheme();
  pushTheme({ texture: theme.texture, grain: theme.grain });
});
$('theme-modes').addEventListener('click', (e) => {
  const b = e.target.closest('.mode');
  if (!b) return;
  theme.mode = b.dataset.mode;
  drawTheme();
  pushTheme({ mode: theme.mode });
});
$('theme-icons').addEventListener('click', (e) => {
  const b = e.target.closest('.sw-icon');
  if (!b) return;
  theme.icon = b.textContent;
  drawTheme();
  pushTheme({ icon: theme.icon });
});
$('theme-done').onclick = () => send('closeOverlay');

// Les vues flottantes prennent les couleurs de l'Espace : accent, panneaux et
// messages légèrement teintés, apparence claire ou sombre de l'Espace.
function applyLook(look) {
  if (!look || !look.space) return;
  const p = OrbeTheme.palette(look.space, look.dark);
  const root = document.documentElement;
  root.dataset.scheme = p.dark ? 'dark' : 'light';
  root.style.setProperty('--accent', p.accent);
  root.style.setProperty('--on-accent', p.onAccent);
  root.style.setProperty('--panel-tint', look.space.plain ? '0%' : '9%');
}
O.on('theme', applyLook);
send('themeGet').then(applyLook).catch(() => {});

// --- Balayage de page : la pastille suit les doigts ----------------------------
// `p` : avancée du geste (0 à 1, le seuil) ; `release` : geste abandonné, la
// pastille rentre ; `go` : seuil franchi, elle s'allume et s'efface.
const SWIPE = { hidden: -60, shown: 14 };
function drawSwipe(msg) {
  const box = $('swipe');
  const pill = $('swipe-pill');
  if (mode !== 'swipe') show('swipe');
  const side = msg.dir === 'forward' ? -1 : 1; // la pastille de droite avance vers la gauche
  box.classList.toggle('forward', msg.dir === 'forward');
  box.classList.toggle('release', !!msg.release);
  box.classList.toggle('go', !!msg.go);
  const p = Math.max(0, Math.min(1, Number(msg.p) || 0));
  // Elle sort vite, puis ralentit en approchant du seuil.
  const eased = 1 - (1 - p) ** 2;
  const x = side * (SWIPE.hidden + (SWIPE.shown - SWIPE.hidden) * eased);
  if (msg.go) {
    pill.style.transform = `translateX(${side * (SWIPE.shown + 10)}px) scale(1.12)`;
    pill.style.opacity = '0';
  } else {
    pill.style.transform = `translateX(${x.toFixed(1)}px) scale(${(0.6 + 0.4 * eased).toFixed(3)})`;
    pill.style.opacity = msg.release ? '0' : String(Math.min(1, p * 2.2).toFixed(3));
  }
  box._p = p;
}

// --- Recherche dans la page -------------------------------------------------
const findInput = $('find-input');
findInput.addEventListener('input', () => send('find', { text: findInput.value }));
findInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); send('find', { text: findInput.value, forward: !e.shiftKey, next: true }); }
});
// Les boutons ne prennent pas le clavier : on continue de taper dans le champ.
for (const id of ['find-next', 'find-prev']) $(id).addEventListener('mousedown', (e) => e.preventDefault());
$('find-next').onclick = () => send('find', { text: findInput.value, forward: true, next: true });
$('find-prev').onclick = () => send('find', { text: findInput.value, forward: false, next: true });
$('find-close').onclick = () => send('findClose');
O.on('find-result', (r) => {
  $('find-count').textContent = findInput.value ? (r.matches ? `${r.current}/${r.matches}` : t('find.none')) : '';
});

// --- Messages ---------------------------------------------------------------
O.on('overlay', (p) => {
  if (p.mode === 'command') openCommand(p);
  else if (p.mode === 'switcher') openSwitcher(p);
  else if (p.mode === 'theme') openTheme(p);
  else if (p.mode === 'find') {
    show('find');
    $('find-count').textContent = '';
    // « Utiliser la sélection pour rechercher » : le texte vient de la page.
    if (typeof p.text === 'string') findInput.value = p.text;
    findInput.focus();
    findInput.select();
    if (findInput.value) send('find', { text: findInput.value });
  } else if (p.mode === 'peek-url') {
    // Adresse de l'aperçu (barre d'outils affichée) : au-dessus de la carte.
    $('peek-url').textContent = p.text || '';
    $('peek-url').hidden = !p.text;
  } else if (p.mode === 'peek') {
    // Ouverture : le voile et les boutons paraissent en fondu ; `leaving` : ils s'effacent
    // pendant que la carte se réduit ou s'étend (durée donnée par le processus principal).
    show('peek');
    document.body.style.setProperty('--peek-ms', (p.ms || 0) + 'ms');
    document.body.classList.remove('peek', 'peek-out');
    void document.body.offsetWidth;
    document.body.classList.add(p.leaving ? 'peek-out' : 'peek');
  } else if (p.mode === 'drop') {
    show('drop');
    $('drop-label').textContent = p.label;
    $('drop').classList.toggle('over', !!p.over);
    // Côté visé (moitié d'un volet), donné par le processus principal ; sinon la moitié droite.
    const z = p.zone;
    $('drop-label').style.cssText = z ? `position:absolute;margin:0;left:${z.x + 6}px;top:${z.y + 6}px;width:${Math.max(40, z.w - 12)}px;height:${Math.max(40, z.h - 12)}px` : '';
  } else if (p.mode === 'swipe') {
    drawSwipe(p);
  } else if (p.mode === 'status') {
    show('status');
    $('status').textContent = p.text;
  } else if (p.mode === 'toast') {
    show('toast');
    const el = $('toast');
    el.textContent = p.text;
    el.style.cursor = p.action ? 'pointer' : '';
    el.classList.remove('in');
    void el.offsetWidth;
    el.classList.add('in');
  } else {
    show(null);
  }
});
O.on('settings', (s) => setLang(s.lang));

// Zone de dépôt : un onglet de la barre latérale lâché ici crée une vue scindée.
const dropBox = $('drop');
dropBox.addEventListener('dragover', (e) => {
  if (![...e.dataTransfer.types].includes('application/x-orbe-item')) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  dropBox.classList.add('over');
});
dropBox.addEventListener('dragleave', () => dropBox.classList.remove('over'));
dropBox.addEventListener('drop', (e) => {
  e.preventDefault();
  dropBox.classList.remove('over');
  const id = e.dataTransfer.getData('application/x-orbe-item');
  if (id) send('dropSplit', id);
});

// Clic sur un message : son action (aller à l'onglet…), ou simple disparition.
$('toast').onclick = () => send('toastClick');
$('peek-close').onclick = () => send('peekClose');
$('peek-expand').onclick = () => send('peekExpand');
$('peek-split').onclick = () => send('peekSplit');

$('backdrop').addEventListener('mousedown', (e) => {
  // Barre de commande : le point du clic part avec la fermeture (la barre latérale reste cliquable).
  if (mode === 'command') send('closeOverlay', { x: e.clientX, y: e.clientY });
  else if (mode === 'theme') send('closeOverlay');
  else if (mode === 'peek') send('peekClose');
});
// Bascule d'onglets : Tab ne déplace pas le focus, relâcher ⌃ valide.
document.addEventListener('keyup', (e) => {
  if (mode === 'switcher' && e.key === 'Control') send('switcherCommit');
});
document.addEventListener('keydown', (e) => {
  if (mode === 'switcher' && e.key === 'Tab') e.preventDefault();
  if (e.key !== 'Escape') return;
  if (mode === 'find') send('findClose');
  else if (mode === 'peek') send('peekClose');
  else if (mode) send('closeOverlay');
});
