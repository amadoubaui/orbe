// Barre latérale d'Orbe. Reçoit l'état complet de la fenêtre et ne modifie que
// les éléments qui ont changé, pour rester fluide avec beaucoup d'onglets.
const $ = (id) => document.getElementById(id);
const send = O.send;
let S = null; // dernier état reçu
let editing = null; // id en cours de renommage
let drag = null;

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
    el.innerHTML = `<span class="ic"></span><span class="title"></span>`
      + `<button class="act reset" data-act="reset">${icon('reset')}</button>`
      + `<button class="act snd" data-act="mute">${icon('sound')}</button>`
      + `<button class="act x" data-act="close">${icon('x')}</button>`;
    el._ic = el.firstChild;
    el._title = el.children[1];
    el._snd = el.querySelector('.snd use');
    el.draggable = true;
  }
  el.className = 'row tab' + (it.active ? ' active' : '') + (it.shown ? ' shown' : '') + (it.live ? ' live' : '')
    + (it.audible ? ' audible' : '') + (it.muted ? ' muted' : '') + (it.changed ? ' changed' : '') + (it.split ? ' split' : '');
  if (editing !== it.id && el._t !== it.title) {
    el._t = it.title;
    el._title.textContent = it.title;
    el.title = it.title;
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
  for (const it of items) {
    const key = it.id;
    let el = old.get(key);
    if (el) old.delete(key);
    else {
      el = document.createElement('div');
      el.dataset.key = key;
      if (it.type !== 'folder') el.dataset.id = it.id;
    }
    if (tile) tileEl(el, it);
    else if (it.type === 'folder') folderRow(el, it);
    else tabRow(el, it);
    const ref = prev ? prev.nextSibling : container.firstChild;
    if (el !== ref) container.insertBefore(el, ref);
    prev = el;
  }
  for (const el of old.values()) el.remove();
}

function render(s) {
  const prev = S;
  S = s;
  setLang(s.lang);
  const b = document.body;
  const open = s.sidebar.visible || s.sidebar.peek;
  b.style.setProperty('--accent', s.space.color);
  b.style.setProperty('--sw', s.sidebar.width + 'px');
  b.classList.toggle('open', open);
  b.classList.toggle('docked', s.sidebar.visible);
  b.classList.toggle('translucent', s.translucent);
  b.classList.toggle('incognito', s.incognito);
  b.classList.toggle('toolbar', s.toolbar);
  b.classList.toggle('fullscreen', s.fullScreen);
  b.classList.toggle('no-tab', !s.activeId);

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
  reconcile($('pinned'), s.pinned);
  reconcile($('today'), s.today);
  $('b-clear').classList.toggle('can', s.today.length > (s.today.some((x) => x.active) ? 1 : 0));

  const spaces = $('spaces');
  const sig = s.spaces.map((x) => x.id + x.icon + x.name).join('|') + '>' + s.space.id;
  if (spaces._sig !== sig) {
    spaces._sig = sig;
    spaces.innerHTML = s.spaces.length > 1
      ? s.spaces.map((x) => `<button class="sp${x.id === s.space.id ? ' active' : ''}" data-space="${esc(x.id)}" title="${esc(x.name)}"><span class="em">${esc(x.icon) || '•'}</span></button>`).join('')
      : '';
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
$('b-sidebar').onclick = () => send('toggleSidebar');
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

// --- Balayage à deux doigts : changer d'Espace ------------------------------
let swipe = 0;
let swipeLock = false;
let swipeTimer = null;
sidebar.addEventListener('wheel', (e) => {
  if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
  e.preventDefault();
  clearTimeout(swipeTimer);
  swipeTimer = setTimeout(() => { swipe = 0; swipeLock = false; }, 220);
  if (swipeLock) return;
  swipe += e.deltaX;
  if (Math.abs(swipe) > 70) {
    swipeLock = true;
    send('stepSpace', swipe > 0 ? 1 : -1);
    swipe = 0;
  }
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

// --- Glisser-déposer --------------------------------------------------------
const line = $('drop-line');

function clearDrop() {
  line.style.display = 'none';
  for (const el of document.querySelectorAll('.drop-into')) el.classList.remove('drop-into');
}

function endDrag() {
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
  if (drag && drag.folder && to !== 'pinned') {
    if (to !== 'folder') return null;
    zone = $('pinned');
    to = 'pinned';
    folderId = null;
  }
  const kids = [...zone.children];
  const grid = to === 'favorites';
  if (grid && drag && drag.folder) return null;

  // Sur l'en-tête d'un dossier : dépose dedans.
  if (!grid && !(drag && drag.folder)) {
    const head = e.target.closest('.folder > .row');
    if (head) {
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

sidebar.addEventListener('dragover', (e) => {
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

O.on('state', render);
O.on('edit', startRename);
send('ready');
