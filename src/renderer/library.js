// Bibliothèque : historique, archive des onglets fermés, téléchargements, tableaux.
const KINDS = ['history', 'archive', 'downloads', 'media', 'easels'];
const CLEAR = { history: 'lib.clearHistory', archive: 'lib.clearArchive', downloads: 'lib.clearDownloads', media: 'lib.clearDownloads', easels: 'easel.new' };
const list = document.getElementById('list');
const q = document.getElementById('q');
let kind = KINDS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'history';
let rows = [];
let timer = null;

function dayLabel(ts) {
  const d = new Date(ts);
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (ts >= start) return t('lib.today');
  if (ts >= start - 864e5) return t('lib.yesterday');
  return d.toLocaleDateString(lang, { weekday: 'long', day: 'numeric', month: 'long', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

const time = (ts) => new Date(ts).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });

function size(n) {
  if (!n) return '';
  const u = lang === 'fr' ? ['o', 'Ko', 'Mo', 'Go'] : ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < 3) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
}

function draw() {
  document.title = t('lib.title') + ' — ' + t('lib.' + kind);
  for (const b of document.querySelectorAll('[data-tab]')) b.classList.toggle('on', b.dataset.tab === kind);
  document.getElementById('clear').textContent = t(CLEAR[kind]);
  list.textContent = '';
  if (!rows.length) {
    list.innerHTML = `<div class="empty">${esc(t(kind === 'easels' ? 'easel.empty' : 'lib.empty'))}</div>`;
    return;
  }
  if (kind === 'easels') return drawBoards();
  let card = null;
  let day = '';
  rows.forEach((r, i) => {
    const label = dayLabel(r.at);
    if (label !== day) {
      day = label;
      const h = document.createElement('h2');
      h.textContent = label;
      card = document.createElement('div');
      card.className = 'card';
      list.append(h, card);
    }
    const line = document.createElement('div');
    const files = kind === 'downloads' || kind === 'media';
    line.className = 'line' + (files ? '' : ' click');
    line.dataset.i = i;
    const body = document.createElement('div');
    body.className = 'grow';
    if (files) {
      const pct = r.total ? Math.round((r.received / r.total) * 100) : 0;
      const running = r.state === 'progressing';
      const progress = `${pct} %${r.total ? ' — ' + size(r.received) + ' / ' + size(r.total) : (r.received ? ' — ' + size(r.received) : '')}`;
      let status = t('lib.failed');
      if (running) status = `${t(r.paused ? 'dl.paused' : (r.stalled ? 'dl.stalled' : 'lib.inProgress'))} — ${progress}`;
      else if (r.state === 'completed') status = size(r.total || r.received);
      else if (r.state === 'cancelled') status = t('dl.cancelled');
      else if (r.received) status = `${t('lib.failed')} — ${progress}`;
      body.innerHTML = `<div class="name">${esc(r.name)}</div><div class="sub">${esc(status)} · ${esc(host(r.url))}</div>`
        + (r.danger ? `<div class="sub danger">${esc(t('dl.dangerNote'))}</div>` : '')
        + (running ? `<div class="bar"><i style="width:${pct}%"></i></div>` : '');
      line.dataset.state = r.state;
      line.append(letterIcon(r.name), body);
      const btn = (act, key) => `<button class="btn" data-do="${act}">${esc(t(key))}</button>`;
      let buttons = '';
      // En cours : pause ou reprise, et annulation. Interrompu ou annulé : reprise (ou nouveau départ).
      if (running && kind === 'downloads') buttons += (r.paused || r.stalled ? btn('resume', 'dl.resume') : btn('pause', 'dl.pause')) + btn('cancel', 'dl.cancel');
      else if ((r.state === 'interrupted' || r.state === 'cancelled') && kind === 'downloads') buttons += btn('resume', r.state === 'interrupted' && r.canResume ? 'dl.resume' : 'dl.retry');
      if (r.exists) buttons += btn('open', 'lib.open') + btn('reveal', 'lib.reveal');
      line.insertAdjacentHTML('beforeend', buttons);
    } else {
      body.innerHTML = `<div class="name">${esc(r.title)}</div><div class="sub">${esc(r.url)}</div>`;
      const at = document.createElement('span');
      at.className = 'muted';
      at.textContent = time(r.at);
      line.append(faviconEl(r.favicon, r.title), body, at);
    }
    card.appendChild(line);
  });
}

// Tableaux : vignette, titre, date ; un clic ouvre le tableau dans un onglet.
function drawBoards() {
  const grid = document.createElement('div');
  grid.className = 'boards';
  rows.forEach((r, i) => {
    const card = document.createElement('div');
    card.className = 'card board';
    card.dataset.i = i;
    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    if (r.thumb) { const img = document.createElement('img'); img.src = r.thumb; img.alt = ''; img.draggable = false; thumb.appendChild(img); }
    const meta = document.createElement('div');
    meta.className = 'meta';
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = r.title || t('easel.untitled');
    const sub = document.createElement('div');
    sub.className = 'sub muted';
    sub.textContent = `${dayLabel(r.updated)} · ${t('easel.items', { n: r.count })}`;
    meta.append(name, sub);
    const del = document.createElement('button');
    del.className = 'btn del';
    del.dataset.do = 'delete';
    del.textContent = t('easel.delete');
    card.append(thumb, meta, del);
    grid.appendChild(card);
  });
  list.appendChild(grid);
}

async function load() {
  if (kind === 'easels') {
    const needle = q.value.trim().toLowerCase();
    rows = ((await O.send('easel:list')) || []).filter((b) => !needle || (b.title || t('easel.untitled')).toLowerCase().includes(needle));
    draw();
    return;
  }
  const data = await O.send('lib:get', { q: q.value });
  rows = (data && data[kind]) || [];
  draw();
  clearTimeout(timer);
  // Tant qu'un téléchargement avance, la liste se rafraîchit (sauf pendant un clic sur un bouton).
  if (kind === 'downloads' && rows.some((r) => r.state === 'progressing' && !r.paused)) timer = setTimeout(load, 700);
}

document.querySelector('.tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]');
  if (!b) return;
  kind = b.dataset.tab;
  history.replaceState(null, '', '#' + kind);
  load();
});
document.getElementById('clear').onclick = async () => {
  // Onglet Tableaux : le bouton crée un tableau et l'ouvre.
  if (kind === 'easels') { await O.send('easel:open'); return; }
  await O.send('lib:clear', kind === 'media' ? 'downloads' : kind);
  load();
};
q.addEventListener('input', load);
list.addEventListener('click', async (e) => {
  const board = e.target.closest('.board');
  if (board && kind === 'easels') {
    const b = rows[Number(board.dataset.i)];
    if (e.target.closest('[data-do=delete]')) { await O.send('easel:delete', b.id); load(); } else O.send('easel:open', b.id);
    return;
  }
  const line = e.target.closest('.line');
  if (!line) return;
  const r = rows[Number(line.dataset.i)];
  const act = e.target.closest('[data-do]');
  if (kind === 'downloads' || kind === 'media') {
    const what = act && act.dataset.do;
    if (what === 'open') O.send('lib:openFile', r.id);
    else if (what === 'reveal') O.send('lib:reveal', r.id);
    else if (what) { await O.send('dl:' + what, r.id); load(); }
  } else O.send('open', r.url);
});
window.addEventListener('hashchange', () => {
  const h = location.hash.slice(1);
  if (KINDS.includes(h) && h !== kind) { kind = h; load(); }
});
window.addEventListener('focus', load);
O.on('settings', (s) => { if (setLang(s.lang)) draw(); });
load();
