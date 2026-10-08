// Barre latérale d'Orbe. Reçoit l'état complet de la fenêtre et ne modifie que
// les éléments qui ont changé, pour rester fluide avec beaucoup d'onglets.
const $ = (id) => document.getElementById(id);
const send = O.send;
let S = null; // dernier état reçu
let editing = null; // id en cours de renommage
let drag = null;
let animate = false;
let present = new Set();
const FLOATING = location.hash === '#flottant';
if (FLOATING) document.documentElement.classList.add('floating');

const icon = (name, cls = 'i') => `<svg class="${cls}"><use href="#i-${name}"/></svg>`;

// --- Rendu ------------------------------------------------------------------
function setIcon(el, it) {
  // Navigation privée : aucune icône n'est téléchargée par l'interface.
  const src = S && S.incognito ? '' : (it.favicon || guessIcon(it.url));
  const key = it.loading ? 'L' : (src || '#' + it.title.charAt(0));
  if (el._icon === key) return;
  el._icon = key;
  const slot = el._ic;
  slot.textContent = '';
  if (it.loading) {
    const sp = document.createElement('span');
    sp.className = 'spinner';
    slot.appendChild(sp);
  } else {
    slot.appendChild(faviconEl(src, it.title));
  }
}

function tabRow(el, it) {
  if (!el._built) {
    el._built = true;
    el.innerHTML = `<span class="ic" data-act="icon"></span><span class="more"></span><span class="slash">/</span><span class="title"></span>`
      + `<button class="act reset" data-act="reset">${icon('reset')}</button>`
      + `<button class="act snd" data-act="mute">${icon('sound')}</button>`
      + `<button class="act x" data-act="close">${icon('x')}</button>`;
    el._ic = el.firstChild;
    el._title = el.children[3];
    el._more = el.children[1];
    el._snd = el.querySelector('.snd use');
    el.draggable = true;
  }
  el.className = 'row tab' + (it.active ? ' active' : '') + (it.shown ? ' shown' : '') + (it.live ? ' live' : '')
    + (it.audible ? ' audible' : '') + (it.muted ? ' muted' : '') + (it.changed ? ' changed' : '') + (it.partners ? ' split' : '') + (it.grouped ? ' grouped' : '');
  // Vue scindée : une seule ligne, avec les icônes et les titres de chaque volet.
  const label = it.partners ? [it.title, ...it.partners.map((p) => p.title)].join('  |  ') : it.title;
  if (editing !== it.id && el._t !== label) {
    el._t = label;
    el._title.textContent = label;
    el.title = label;
  }
  const moreKey = it.partners ? it.partners.map((p) => p.id + p.favicon).join(',') : '';
  if (el._mk !== moreKey) {
    el._mk = moreKey;
    el._more.textContent = '';
    for (const p of it.partners || []) el._more.appendChild(faviconEl(S && S.incognito ? '' : (p.favicon || guessIcon(p.url)), p.title));
  }
  if (el._m !== it.muted) { el._m = it.muted; el._snd.setAttribute('href', it.muted ? '#i-mute' : '#i-sound'); }
  setIcon(el, it);
}

function folderRow(el, it) {
  if (!el._built) {
    el._built = true;
    el.innerHTML = `<div class="row" draggable="true"><span class="ic">${icon('folder')}</span><span class="title"></span>${icon('chevron', 'i chev')}</div><div class="children" data-drop="folder:${it.id}"></div>`;
    el._title = el.querySelector('.title');
    el._children = el.lastChild;
    el._head = el.firstChild;
    el._head.dataset.id = it.id;
    el._head.dataset.folder = '1';
  }
  el.className = 'folder' + (it.open ? ' open' : '');
  if (editing !== it.id && el._t !== it.name) { el._t = it.name; el._title.textContent = it.name; }
  reconcile(el._children, it.children);
}

function tileEl(el, it) {
  if (!el._built) {
    el._built = true;
    el.innerHTML = `<span class="ic"></span><span class="dot"></span>`;
    el._ic = el.firstChild;
    el.draggable = true;
  }
  el.className = 'tile' + (it.active ? ' active' : '') + (it.live ? ' live' : '') + (it.audible ? ' audible' : '');
  el.title = it.title;
  setIcon(el, it);
}

// Met à jour une liste en réutilisant les éléments existants (clé = id).
function reconcile(container, items, tile) {
  const old = new Map();
  for (const el of container.children) old.set(el.dataset.key, el);
  let prev = null;
  let fresh = null;
  for (const it of items) {
    const key = it.id;
    let el = old.get(key);
    if (el) old.delete(key);
    else {
      el = document.createElement('div');
      el.dataset.key = key;
      if (it.type !== 'folder') el.dataset.id = it.id;
      fresh = animate ? el : null;
    }
    if (tile) tileEl(el, it);
    else if (it.type === 'folder') folderRow(el, it);
    else tabRow(el, it);
    if (fresh === el) { el.classList.add('in'); fresh = null; }
    const ref = prev ? prev.nextSibling : container.firstChild;
    if (el !== ref) container.insertBefore(el, ref);
    prev = el;
  }
  // Disparition : la ligne se replie avant d'être retirée.
  for (const el of old.values()) {
    // Une ligne seulement déplacée (encore présente ailleurs) part sans délai.
    if (!animate || !el.dataset.key || tile || present.has(el.dataset.key)) { el.remove(); continue; }
    el.dataset.key = '';
    el.removeAttribute('data-id');
    el.classList.add('out');
    setTimeout(() => el.remove(), 150);
  }
}

// Pastilles des Espaces, en bas : un point par Espace, l'icône pour l'Espace courant.
function drawSpaces(list, current) {
  const spaces = $('spaces');
  const sig = list.map((x) => x.id + x.icon + x.name).join('|') + '>' + current;
  if (spaces._sig === sig) return;
  spaces._sig = sig;
  spaces.innerHTML = list.length > 1
    ? list.map((x) => `<button class="sp${x.id === current ? ' active' : ''}" data-space="${esc(x.id)}" title="${esc(x.name)}"><span class="em">${esc(x.icon) || '•'}</span></button>`).join('')
    : '';
}

function render(s) {
  const prev = S;
  // Animations seulement pour un changement dans le même Espace, pas au premier affichage.
  animate = !!prev && prev.space.id === s.space.id && !drag;
  present = new Set();
  const collect = (list) => { for (const it of list) { present.add(it.id); if (it.children) collect(it.children); } };
  collect(s.favorites); collect(s.pinned); collect(s.today);
  S = s;
  setLang(s.lang);
  const b = document.body;
  // Vue flottante : la barre n'y apparaît qu'au survol du bord, barre masquée.
  const open = FLOATING ? s.sidebar.peek && !s.sidebar.visible : s.sidebar.visible;
  if (FLOATING && !open && prev && !(prev.sidebar.peek && !prev.sidebar.visible)) { S = s; b.classList.remove('open'); return; }
  b.style.setProperty('--accent', s.space.color);
  b.style.setProperty('--accent2', s.space.color2 || s.space.color);
  b.style.setProperty('--grain', String(s.space.grain || 0));
  b.classList.toggle('gradient', !!s.space.color2);
  b.style.setProperty('--sw', s.sidebar.width + 'px');
  b.classList.toggle('open', open);
  b.classList.toggle('docked', s.sidebar.visible);
  b.classList.toggle('translucent', s.translucent);
  b.classList.toggle('incognito', s.incognito);
  b.classList.toggle('toolbar', s.toolbar);
  b.classList.toggle('fullscreen', s.fullScreen);
  b.classList.toggle('no-tab', !s.activeId && !FLOATING);

  const label = s.nav.internal ? (s.nav.title || 'Orbe') : host(s.nav.url);
  $('url-text').textContent = label || t('side.search');
  $('url-text').classList.toggle('placeholder', !label);
  $('url').classList.toggle('loading', s.nav.loading);
  $('url').title = s.nav.internal ? '' : s.nav.url;
  const shield = $('shield');
  shield.hidden = !s.activeId || s.nav.internal || false;
  shield.className = s.nav.shield;
  $('shield-n').textContent = s.nav.shield === 'on' && s.nav.blocked ? (s.nav.blocked > 99 ? '99+' : String(s.nav.blocked)) : '';
  $('tb-url-text').textContent = s.nav.internal ? label : (s.nav.url || t('side.search'));
  for (const p of ['b', 'tb']) {
    $(p + '-back').disabled = !s.nav.canBack;
    $(p + '-forward').disabled = !s.nav.canForward;
    $(p + '-reload').disabled = !s.activeId;
  }
  $('reload-icon').setAttribute('href', s.nav.loading ? '#i-stop' : '#i-reload');

  if (editing !== s.space.id) $('space-name').textContent = s.space.name;
  $('space-icon').textContent = s.space.icon;

  reconcile($('fav'), s.favorites, true);
  // Comme dans Arc (relevé sur l'application) : jusqu'à 4 favoris sur une ligne,
  // puis une grille aussi carrée que possible (9 favoris = 3 × 3), 4 colonnes au plus.
  const nf = s.favorites.length;
  $('fav').style.gridTemplateColumns = `repeat(${nf <= 4 ? Math.max(nf, 1) : Math.min(4, Math.ceil(Math.sqrt(nf)))}, 1fr)`;
  reconcile($('pinned'), s.pinned);
  reconcile($('today'), s.today);
  $('b-clear').classList.toggle('can', s.today.length > (s.today.some((x) => x.active) ? 1 : 0));

  drawSpaces(s.spaces, s.space.id);

  // Boutons des extensions : icône, pastille, clic = fenêtre de l'extension.
  const exts = $('exts');
  const extSig = JSON.stringify(s.extensions || []);
  if (exts._sig !== extSig) {
    exts._sig = extSig;
    exts.textContent = '';
    for (const x of s.extensions || []) {
      const b = document.createElement('button');
      b.className = 'ext' + (x.enabled === false ? ' off' : '');
      b.title = x.title;
      b.dataset.ext = x.id;
      b.appendChild(/^data:image\//.test(x.icon) ? Object.assign(document.createElement('img'), { src: x.icon, draggable: false }) : letterIcon(x.title));
      if (x.badge) {
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = String(x.badge).slice(0, 4);
        badge.style.background = x.badgeColor || '';
        badge.style.color = x.badgeTextColor || '';
        b.appendChild(badge);
      }
      exts.appendChild(b);
    }
  }

  const media = $('media');
  media.hidden = !s.media;
  if (s.media) {
    if (media._id !== s.media.id + s.media.favicon) {
      media._id = s.media.id + s.media.favicon;
      $('media-icon').textContent = '';
      $('media-icon').appendChild(faviconEl(s.media.favicon || guessIcon(s.media.url), s.media.title));
    }
    $('media-title').textContent = s.media.title;
    $('media-play-icon').setAttribute('href', s.media.playing ? '#i-pause' : '#i-play');
    $('media-mute-icon').setAttribute('href', s.media.muted ? '#i-mute' : '#i-sound');
  }

  // Poignées entre les volets d'une vue scindée (dans l'espace qui les sépare).
  const dv = $('dividers');
  const list = splitDrag ? null : (s.dividers || []);
  if (list) {
    while (dv.children.length > list.length) dv.lastChild.remove();
    list.forEach((d, i) => {
      let h = dv.children[i];
      if (!h) { h = document.createElement('div'); h.className = 'divider'; h.dataset.i = i; dv.appendChild(h); }
      h.className = 'divider' + (d.v ? ' v' : '');
      h.style.cssText = d.v ? `left:${d.x}px;top:${d.y}px;width:${d.w}px` : `left:${d.x}px;top:${d.y}px;height:${d.h}px`;
    });
  }

  const lib = $('b-library');
  lib.classList.toggle('downloading', !!s.downloads);
  if (s.downloads) lib.querySelector('circle').style.strokeDashoffset = String(75.4 * (1 - s.downloads.progress));

  if (s.spaceDir && prev) {
    const sc = $('scroll');
    sc.classList.remove('slide-next', 'slide-prev');
    void sc.offsetWidth;
    sc.classList.add(s.spaceDir > 0 ? 'slide-next' : 'slide-prev');
  }
}

// --- Renommage sur place ----------------------------------------------------
function startRename(id) {
  if (!S) return;
  let holder;
  let current;
  if (id === S.space.id) {
    holder = $('space-name');
    current = S.space.name;
  } else {
    const row = document.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (!row) return;
    holder = row.querySelector('.title');
    current = holder.textContent;
    row.scrollIntoView({ block: 'nearest' });
  }
  if (!holder || editing) return;
  editing = id;
  const input = document.createElement('input');
  input.className = 'rename';
  input.value = current;
  holder.textContent = '';
  holder.appendChild(input);
  input.focus();
  input.select();
  let done = false;
  const finish = (commit) => {
    if (done) return;
    done = true;
    editing = null;
    const name = input.value.trim();
    holder.textContent = commit && name ? name : current;
    const owner = holder.closest('[data-key]');
    if (owner) owner._t = null;
    if (commit && name !== current) send('rename', { id, name });
    else if (S) render(S);
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
  for (const ev of ['click', 'dblclick', 'mousedown']) input.addEventListener(ev, (e) => e.stopPropagation());
}

// --- Clics ------------------------------------------------------------------
const sidebar = $('sidebar');

sidebar.addEventListener('click', (e) => {
  const act = e.target.closest('[data-act]');
  const row = e.target.closest('[data-id]');
  if (act && row) {
    e.stopPropagation();
    const id = row.dataset.id;
    if (act.dataset.act === 'close') send('close', id);
    else if (act.dataset.act === 'mute') send('toggleMute', id);
    else if (act.dataset.act === 'reset') send('resetPinned', id);
    // Clic sur l'icône d'un épinglé sorti de son adresse : retour à celle-ci.
    else if (act.dataset.act === 'icon') send(row.classList.contains('changed') ? 'resetPinned' : (row.dataset.folder ? 'toggleFolder' : 'activate'), id);
    return;
  }
  if (row) {
    if (row.dataset.folder) send('toggleFolder', row.dataset.id);
    else send('activate', row.dataset.id);
    return;
  }
  const sp = e.target.closest('[data-space]');
  if (sp) send('switchSpace', sp.dataset.space);
});

// Clic molette : archive l'onglet.
sidebar.addEventListener('auxclick', (e) => {
  const row = e.target.closest('[data-id]');
  if (e.button === 1 && row && !row.dataset.folder) send('close', row.dataset.id);
});

sidebar.addEventListener('dblclick', (e) => {
  const row = e.target.closest('[data-id]');
  if (row && row.dataset.folder) return startRename(row.dataset.id);
  if (row && row.closest('#pinned')) return startRename(row.dataset.id);
  if (e.target.closest('#space-head')) return startRename(S.space.id);
  return undefined;
});

sidebar.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const row = e.target.closest('[data-id]');
  const sp = e.target.closest('[data-space]');
  if (row) send('tabMenu', row.dataset.id);
  else if (sp) send('spaceMenu', sp.dataset.space);
  else if (e.target.closest('#space-head')) send('spaceMenu', null);
  else send('sidebarMenu');
});

$('media-open').onclick = () => S && S.media && send('activate', S.media.id);
$('media-play').onclick = () => send('mediaToggle');
$('media-mute').onclick = () => S && S.media && send('toggleMute', S.media.id);
$('exts').addEventListener('click', (e) => {
  const b = e.target.closest('[data-ext]');
  if (!b) return;
  const r = b.getBoundingClientRect();
  send('ext:popup', { id: b.dataset.ext, x: Math.round(r.left), y: Math.round(r.bottom + 6) });
});
$('b-sidebar').onclick = () => send('toggleSidebar');
$('b-menu').onclick = () => send('command', 'appMenu');
$('url').onclick = () => send('openCommand', 'edit');
$('shield').onclick = () => send('shieldMenu');
$('tb-url').onclick = () => send('openCommand', 'edit');
$('b-newtab').onclick = () => send('openCommand', 'new');
$('b-clear').onclick = () => send('command', 'clearToday');
$('b-library').onclick = () => send('command', S && S.downloads ? 'downloads' : 'library');
$('b-plus').onclick = () => send('sidebarMenu');
for (const p of ['b', 'tb']) {
  $(p + '-back').onclick = () => send('command', 'back');
  $(p + '-forward').onclick = () => send('command', 'forward');
  $(p + '-reload').onclick = () => send('command', S && S.nav.loading ? 'stop' : 'reload');
}

// --- Changement d'Espace : deux listes côte à côte ---------------------------
// La liste de l'Espace courant (#scroll) et celle de l'autre Espace (une image
// fixe, `.ghost`) glissent ensemble dans #pager, pendant que la teinte de l'autre
// Espace (#tint) se fond par-dessus au même pas.
//  - Balayage à deux doigts : les listes suivent les doigts ; passé un seuil, ou
//    sur un geste vif, on change d'Espace ; sinon elles reviennent au ressort. Au
//    bout de la rangée, la liste résiste (élastique) et revient.
//  - Clic sur une pastille ou raccourci : le même glissement, sans les doigts.
// Rien n'est redessiné pendant le mouvement : le nouvel état reçu est gardé de
// côté et rendu à l'arrivée, sous l'image fixe qui montrait déjà la même liste.
// Le mouvement lui-même est une animation composée (Web Animations) dont la
// courbe est un ressort calculé avec la vitesse des doigts au lâcher.
const PAGER = {
  commit: 0.4, // part de la largeur au-delà de laquelle le balayage change d'Espace…
  commitMax: 110, // …sans dépasser tant de pixels
  flick: 1.5, // vitesse (px/ms) d'un geste vif, qui suffit à changer d'Espace
  flickMin: 40, // déplacement minimal pour qu'un geste vif compte
  idle: 90, // sans événement pendant ce temps (ms), les doigts sont considérés levés
  response: 0.2, // ressort du glissement : réponse (s), amortissement critique (≈ 240 ms)
  elastic: 0.55, // raideur de l'élastique au bout de la rangée
};
const pagerEl = $('pager');
const scroller = $('scroll');
const tintEl = $('tint');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let slide = null; // glissement en cours
let wheelIdle = null;
let wheelLocked = false; // suite (inertie) d'un geste déjà décidé : ignorée
let lastWheel = 0;
let swipeSum = 0;

// Image fixe de la liste d'un Espace : mêmes lignes, sans aucune interaction.
function ghostNode(it) {
  const el = document.createElement('div');
  if (it.type === 'folder') {
    el.className = 'folder' + (it.open ? ' open' : '');
    el.innerHTML = `<div class="row"><span class="ic">${icon('folder')}</span><span class="title"></span>${icon('chevron', 'i chev')}</div><div class="children"></div>`;
    el.querySelector('.title').textContent = it.name;
    for (const child of it.children) el.lastChild.appendChild(ghostNode(child));
  } else {
    tabRow(el, it);
    el.draggable = false;
  }
  return el;
}

function ghostPanel(vm) {
  const el = document.createElement('div');
  el.className = 'ghost';
  el.dataset.space = vm.space.id;
  el.innerHTML = `<div class="g-head"><span class="g-icon"></span><span class="g-name grow"></span></div><div class="list"></div>`
    + `<div class="g-divider"><span class="rule"></span></div>`
    + `<div class="row g-new"><span class="ic">${icon('plus')}</span><span class="title"></span></div><div class="list"></div>`;
  el.querySelector('.g-icon').textContent = vm.space.icon;
  el.querySelector('.g-name').textContent = vm.space.name;
  el.querySelector('.g-new .title').textContent = t('side.newTab');
  const lists = el.querySelectorAll('.list');
  for (const it of vm.pinned) lists[0].appendChild(ghostNode(it));
  for (const it of vm.today) lists[1].appendChild(ghostNode(it));
  return el;
}

// Ressort amorti (amortissement critique) de 0 vers 1, parti à la vitesse v0
// (en parts du trajet par seconde). Rend la position à l'instant t (s).
function springAt(t, v0, response = PAGER.response) {
  const w = (2 * Math.PI) / response;
  return 1 + (-1 + (v0 - w) * t) * Math.exp(-w * t);
}
// Durée (ms) et courbe `linear()` de ce ressort, pour une animation composée.
function springTiming(v0, response = PAGER.response) {
  let end = 0.12;
  for (let t = 0.6; t > 0.12; t -= 0.01) if (Math.abs(1 - springAt(t, v0, response)) > 0.004) { end = t + 0.01; break; }
  const pts = [];
  // Jamais au-delà de la cible : un dépassement montrerait un vide entre les listes.
  for (let i = 0; i <= 24; i++) pts.push(i === 24 ? 1 : Math.min(1, Math.max(0, springAt((end * i) / 24, v0, response))).toFixed(3));
  return { duration: Math.round(end * 1000), easing: `linear(${pts.join(', ')})`, at: (ms) => (ms >= end * 1000 ? 1 : Math.min(1, Math.max(0, springAt(ms / 1000, v0, response)))) };
}

const pagerWidth = () => pagerEl.clientWidth || 1;
// Au bout de la rangée : la liste suit de moins en moins (élastique).
const elastic = (x, W) => Math.sign(x) * W * (1 - 1 / ((Math.abs(x) * PAGER.elastic) / W + 1));

// Place les deux listes : `x` > 0 découvre l'Espace suivant (à droite), < 0 le précédent.
function slideSet(x) {
  const W = pagerWidth();
  slide.x = x;
  scroller.style.transform = `translateX(${-x}px)`;
  if (slide.ghost) slide.ghost.style.transform = `translateX(${slide.dir * W - x}px)`;
  tintEl.style.opacity = slide.ghost ? String(Math.min(1, Math.abs(x) / W)) : '0';
}

// Prépare l'image fixe et la teinte de l'Espace `vm`, du côté `dir` (+1 : à droite).
function slideGhost(vm, dir) {
  if (slide.ghost) slide.ghost.remove();
  slide.dir = dir;
  slide.ghost = null;
  if (!vm) return;
  slide.ghost = ghostPanel(vm);
  slide.targetId = vm.space.id;
  pagerEl.appendChild(slide.ghost);
  tintEl.style.setProperty('--accent', vm.space.color);
  tintEl.style.setProperty('--accent2', vm.space.color2 || vm.space.color);
  tintEl.classList.toggle('gradient', !!vm.space.color2);
}

function slideBegin() {
  slide = { x: 0, dir: 0, ghost: null, v: 0, phase: 'drag', commit: false, anims: [], after: [] };
  pagerEl.classList.add('sliding');
}

// Position affichée en ce moment, y compris au milieu d'une animation.
function slideNow() {
  if (!slide.fly) return slide.x;
  const f = slide.fly;
  return f.from + (f.to - f.from) * f.timing.at(performance.now() - f.t0);
}

function slideStop() {
  for (const a of slide.anims) a.cancel();
  slide.anims = [];
  slide.fly = null;
  clearTimeout(slide.timer);
}

// Lance les listes vers `to` (0 : retour ; ±largeur : l'autre Espace) au ressort.
function slideFly(to, done) {
  const W = pagerWidth();
  const from = slideNow();
  slideStop();
  const dist = to - from;
  // Vitesse des doigts, en parts du trajet restant par seconde.
  const v0 = Math.abs(dist) > 1 ? Math.max(0, Math.min(40, (slide.v * 1000) / dist)) : 0;
  const timing = springTiming(v0);
  const opts = { duration: timing.duration, easing: timing.easing, fill: 'forwards' };
  slide.phase = 'settle';
  slide.fly = { from, to, t0: performance.now(), timing };
  slide.x = to;
  const move = (el, a, b) => slide.anims.push(el.animate({ transform: [`translateX(${a}px)`, `translateX(${b}px)`] }, opts));
  move(scroller, -from, -to);
  if (slide.ghost) {
    move(slide.ghost, slide.dir * W - from, slide.dir * W - to);
    slide.anims.push(tintEl.animate({ opacity: [Math.min(1, Math.abs(from) / W), Math.min(1, Math.abs(to) / W)] }, opts));
  }
  // La fin est donnée par une minuterie plutôt que par l'animation : celle-ci ne
  // « finit » pas dans une vue qui n'est pas affichée.
  slide.timer = setTimeout(done, timing.duration);
}

// Fin du glissement : tout revient à sa place, puis l'état gardé de côté est rendu.
function slideEnd() {
  if (!slide) return;
  const { pending, other, after, ghost } = slide;
  slideStop();
  slide = null;
  if (ghost) ghost.remove();
  scroller.style.transform = '';
  tintEl.style.opacity = '';
  pagerEl.classList.remove('sliding');
  const next = pending || other;
  if (next) render(next);
  for (const fn of after) fn();
}

// Le balayage a franchi le seuil : on change d'Espace et les listes finissent leur course.
function slideCommit() {
  const W = pagerWidth();
  slide.commit = true;
  wheelLocked = true;
  drawSpaces(S.spaces, slide.targetId); // la pastille change tout de suite
  send('switchSpace', slide.targetId);
  slideFly(slide.dir * W, () => {
    // L'état du nouvel Espace arrive d'ordinaire bien avant ; sinon on l'attend un peu.
    if (slide.pending) return slideEnd();
    slide.waiting = true;
    slide.timer = setTimeout(slideEnd, 600);
    return undefined;
  });
}

// Les doigts sont levés (ou le geste s'est arrêté) : retour à l'Espace courant.
function slideRelease() {
  if (!slide || slide.phase !== 'drag') return;
  slideFly(0, slideEnd);
}

// Changement d'Espace décidé ailleurs (pastille, raccourci, menu) : même glissement.
function slideTo(s) {
  const from = s.spaces.findIndex((x) => x.id === S.space.id);
  const to = s.spaces.findIndex((x) => x.id === s.space.id);
  slideBegin();
  slideGhost({ space: s.space, pinned: s.pinned, today: s.today }, from >= 0 && to < from ? -1 : 1);
  slide.commit = true;
  slide.pending = s;
  slideSet(0);
  drawSpaces(s.spaces, s.space.id);
  slideFly(slide.dir * pagerWidth(), slideEnd);
}

// Tout état reçu passe par ici : pendant un glissement, il attend la fin.
function onState(s) {
  if (slide && slide.commit) {
    if (s.space.id === slide.targetId) {
      slide.pending = s;
      if (slide.waiting) slideEnd();
      return;
    }
    if (S && s.space.id === S.space.id) { slide.other = s; return; }
    slideEnd(); // un troisième Espace : on termine d'abord celui-ci
  } else if (slide && S && s.space.id !== S.space.id) {
    slideEnd(); // changement venu d'ailleurs pendant un balayage : le balayage est abandonné
  }
  const visible = FLOATING ? s.sidebar.peek && !s.sidebar.visible : s.sidebar.visible;
  if (S && !slide && s.space.id !== S.space.id && visible && document.body.classList.contains('open') && !reducedMotion.matches && !drag) return slideTo(s);
  const first = !S;
  render(s);
  // Premier affichage : la barre paraît en fondu, sans glisser.
  if (first && !FLOATING) {
    const b = document.body;
    b.classList.add('ready', 'no-anim');
    requestAnimationFrame(() => requestAnimationFrame(() => b.classList.remove('no-anim')));
  }
  return undefined;
}

sidebar.addEventListener('wheel', (e) => {
  const dragging = slide && slide.phase === 'drag';
  if (!dragging && Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
  e.preventDefault();
  const now = performance.now();
  const dt = Math.max(4, Math.min(64, lastWheel ? now - lastWheel : 16));
  lastWheel = now;
  clearTimeout(wheelIdle);
  wheelIdle = setTimeout(() => { wheelLocked = false; lastWheel = 0; slideRelease(); }, PAGER.idle);
  if (wheelLocked || !S || drag || editing) return;
  if (reducedMotion.matches) {
    // Sans animation : un geste franc change d'Espace, rien ne glisse.
    swipeSum += e.deltaX;
    if (Math.abs(swipeSum) > 70) { wheelLocked = true; send('stepSpace', swipeSum > 0 ? 1 : -1); swipeSum = 0; }
    return;
  }
  if (slide && slide.commit) return; // un glissement décidé va à son terme
  let x = e.deltaX;
  if (!slide) slideBegin();
  else { x += slideNow(); slideStop(); slide.phase = 'drag'; } // reprise en plein retour
  const W = pagerWidth();
  const v = e.deltaX / dt;
  slide.v = slide.v ? slide.v * 0.6 + v * 0.4 : v;
  const dir = Math.sign(x) || slide.dir || 1;
  const vm = S.near && (dir > 0 ? S.near.next : S.near.prev);
  if (dir !== slide.dir || !!vm !== !!slide.ghost) slideGhost(vm, dir);
  if (!vm) {
    // Bout de la rangée : la liste résiste, et ce qui a été tiré se relâche peu à peu.
    slide.raw = (slide.raw || 0) * 0.92 + e.deltaX;
    slideSet(elastic(slide.raw, W));
    return;
  }
  slide.raw = 0;
  slideSet(Math.max(-W, Math.min(W, x)));
  const far = Math.abs(slide.x) >= Math.min(W * PAGER.commit, PAGER.commitMax);
  const brisk = Math.abs(slide.v) >= PAGER.flick && Math.abs(slide.x) >= PAGER.flickMin && Math.sign(slide.v) === dir;
  if (far || brisk) slideCommit();
}, { passive: false });

// --- Redimensionnement ------------------------------------------------------
$('resize').addEventListener('pointerdown', (e) => {
  const el = e.currentTarget;
  el.setPointerCapture(e.pointerId);
  document.body.classList.add('no-anim');
  let frame = 0;
  let x = e.clientX;
  const move = (ev) => {
    x = ev.clientX;
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; send('sidebarWidth', x); });
  };
  const up = () => {
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    document.body.classList.remove('no-anim');
  };
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
});

// --- Largeur des volets d'une vue scindée -----------------------------------
let splitDrag = false;
$('dividers').addEventListener('pointerdown', (e) => {
  const h = e.target.closest('.divider');
  if (!h) return;
  h.setPointerCapture(e.pointerId);
  splitDrag = true;
  h.classList.add('on');
  const i = Number(h.dataset.i);
  let frame = 0;
  const vertical = h.classList.contains('v');
  let x = vertical ? e.clientY : e.clientX;
  const move = (ev) => {
    x = vertical ? ev.clientY : ev.clientX;
    if (vertical) h.style.top = (x - 4) + 'px'; else h.style.left = (x - 4) + 'px';
    // 30 envois par seconde suffisent : au-delà, la page ne se remet pas en page plus vite.
    if (!frame) frame = setTimeout(() => { frame = 0; send('splitResize', { i, at: x }); }, 33);
  };
  const up = () => {
    h.removeEventListener('pointermove', move);
    h.removeEventListener('pointerup', up);
    h.classList.remove('on');
    splitDrag = false;
    send('splitResize', { i, at: x });
  };
  h.addEventListener('pointermove', move);
  h.addEventListener('pointerup', up);
});

// --- Glisser-déposer --------------------------------------------------------
const line = $('drop-line');

function clearDrop() {
  line.style.display = 'none';
  for (const el of document.querySelectorAll('.drop-into')) el.classList.remove('drop-into');
}

function endDrag() {
  if (drag) send('dragZone', false);
  zoneOn = false;
  clearDrop();
  document.body.classList.remove('dragging');
  for (const el of document.querySelectorAll('.dragging-self')) el.classList.remove('dragging-self');
  drag = null;
}

sidebar.addEventListener('dragstart', (e) => {
  const row = e.target.closest('[data-id]');
  if (!row || editing) return e.preventDefault();
  const item = row.dataset.folder ? row.parentElement : row;
  drag = { id: row.dataset.id, folder: !!row.dataset.folder };
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', row.dataset.id);
  e.dataTransfer.setData('application/x-orbe-item', row.dataset.id);
  // Les zones de dépôt ne s'agrandissent qu'après le départ du glisser :
  // déplacer la ligne saisie pendant « dragstart » annule le geste.
  requestAnimationFrame(() => {
    if (!drag) return;
    item.classList.add('dragging-self');
    document.body.classList.add('dragging');
    if (!drag.folder) send('dragZone', true);
  });
  return undefined;
});
sidebar.addEventListener('dragend', endDrag);

// Calcule la destination sous le pointeur : liste, position et repère visuel.
function dropTarget(e) {
  let zone = e.target.closest('[data-drop]');
  if (!zone) {
    const inScroll = e.target.closest('#scroll');
    if (!inScroll) return null;
    zone = $('today');
  }
  let to = zone.dataset.drop;
  let folderId = null;
  if (to.startsWith('folder:')) { folderId = to.slice(7); to = 'folder'; }
  // Un dossier se dépose dans les épinglés ou dans un autre dossier, pas dans lui-même.
  if (drag && drag.folder && to !== 'pinned' && to !== 'folder') return null;
  if (drag && drag.folder && zone.closest(`[data-key="${CSS.escape(drag.id)}"]`)) return null;
  const kids = [...zone.children];
  const grid = to === 'favorites';
  if (grid && drag && drag.folder) return null;

  // Sur l'en-tête d'un dossier : dépose dedans.
  if (!grid) {
    const head = e.target.closest('.folder > .row');
    if (head && !(drag && drag.folder && head.closest(`[data-key="${CSS.escape(drag.id)}"]`))) {
      const r = head.getBoundingClientRect();
      if (e.clientY > r.top + r.height * 0.25 && e.clientY < r.bottom - r.height * 0.25) {
        return { to: 'folder', folderId: head.dataset.id, into: head.parentElement };
      }
    }
  }
  let index = kids.length;
  let rect = null;
  for (let i = 0; i < kids.length; i++) {
    const r = kids[i].getBoundingClientRect();
    const before = grid
      ? (e.clientY < r.bottom && e.clientX < r.left + r.width / 2) || e.clientY < r.top
      : e.clientY < r.top + r.height / 2;
    if (before) { index = i; rect = r; break; }
  }
  const zr = zone.getBoundingClientRect();
  let pos;
  if (grid) {
    const last = kids.length ? kids[kids.length - 1].getBoundingClientRect() : zr;
    pos = rect ? { x: rect.left - 4, y: rect.top, h: rect.height, v: true } : { x: (kids.length ? last.right + 2 : zr.left), y: last.top, h: last.height || 40, v: true };
  } else {
    const last = kids.length ? kids[kids.length - 1].getBoundingClientRect() : null;
    pos = { x: zr.left + 4, y: rect ? rect.top - 1 : (last ? last.bottom : zr.top), w: zr.width - 8 };
  }
  return { to, folderId, index, pos };
}

// Au-dessus de la page : lâcher l'onglet crée une vue scindée. Pendant un
// glisser, c'est la coque qui reçoit les événements, même au-dessus des pages.
const overPage = (e) => !!drag && !drag.folder && !!S && S.sidebar.visible && !!S.activeId && e.clientX > S.sidebar.width + 12;
let zoneOn = false;
function setZone(on) {
  if (on === zoneOn) return;
  zoneOn = on;
  send('dragZoneOver', on);
}
document.addEventListener('dragover', (e) => {
  if (!overPage(e)) return setZone(false);
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  clearDrop();
  setZone(true);
}, true);
document.addEventListener('drop', (e) => {
  if (!overPage(e)) return;
  e.preventDefault();
  e.stopPropagation();
  const id = drag.id;
  endDrag();
  send('dropSplit', id);
}, true);

sidebar.addEventListener('dragover', (e) => {
  if (overPage(e)) return;
  const types = [...e.dataTransfer.types];
  const external = !drag && !types.includes('application/x-orbe-item') && types.some((x) => x === 'text/uri-list' || x === 'text/plain');
  if (!drag && !external) return;
  const target = drag ? dropTarget(e) : { external: true };
  clearDrop();
  if (!target) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = drag ? 'move' : 'copy';
  if (target.into) target.into.classList.add('drop-into');
  else if (target.pos) {
    const p = target.pos;
    line.className = p.v ? 'v' : '';
    line.style.cssText = `display:block;left:${p.x}px;top:${p.y}px;` + (p.v ? `height:${p.h}px` : `width:${p.w}px`);
  }
});

sidebar.addEventListener('drop', (e) => {
  if (overPage(e)) return;
  e.preventDefault();
  if (!drag) {
    // Ligne venue d'une autre fenêtre Orbe : ce n'est pas une adresse.
    if ([...e.dataTransfer.types].includes('application/x-orbe-item')) return endDrag();
    const url = (e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain') || '').split('\n')[0].trim();
    if (url) send('dropUrl', url);
    return endDrag();
  }
  const target = dropTarget(e);
  if (target) send('move', { id: drag.id, to: target.to, folderId: target.folderId, index: target.index });
  return endDrag();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && drag) endDrag();
});

O.on('state', onState);
// Renommer pendant un glissement (nouvel Espace) : après l'arrivée.
O.on('edit', (id) => (slide && slide.commit ? slide.after.push(() => startRename(id)) : startRename(id)));
// Sons d'interface (fichiers originaux, src/renderer/sons).
const sounds = {};
O.on('sound', (name) => {
  if (!/^[a-z-]+$/.test(String(name))) return;
  const a = sounds[name] || (sounds[name] = new Audio(`sons/${name}.wav`));
  a.volume = 0.5;
  a.currentTime = 0;
  a.play().catch(() => {});
});
send('ready');
