// Bibliothèque : historique, archive des onglets fermés, téléchargements.
const KINDS = ['history', 'archive', 'downloads', 'media'];
const CLEAR = { history: 'lib.clearHistory', archive: 'lib.clearArchive', downloads: 'lib.clearDownloads', media: 'lib.clearDownloads' };
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
    list.innerHTML = `<div class="empty">${esc(t('lib.empty'))}</div>`;
    return;
  }
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
      const status = r.state === 'progressing' ? `${t('lib.inProgress')} — ${pct} %` : (r.state === 'completed' ? size(r.total || r.received) : t('lib.failed'));
      body.innerHTML = `<div class="name">${esc(r.name)}</div><div class="sub">${esc(status)} · ${esc(host(r.url))}</div>`
        + (r.state === 'progressing' ? `<div class="bar"><i style="width:${pct}%"></i></div>` : '');
      line.append(letterIcon(r.name), body);
      if (r.exists) {
        line.insertAdjacentHTML('beforeend', `<button class="btn" data-do="open">${esc(t('lib.open'))}</button><button class="btn" data-do="reveal">${esc(t('lib.reveal'))}</button>`);
      }
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

async function load() {
  const data = await O.send('lib:get', { q: q.value });
  rows = (data && data[kind]) || [];
  draw();
  clearTimeout(timer);
  if (kind === 'downloads' && rows.some((r) => r.state === 'progressing')) timer = setTimeout(load, 700);
}

document.querySelector('.tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]');
  if (!b) return;
  kind = b.dataset.tab;
  history.replaceState(null, '', '#' + kind);
  load();
});
document.getElementById('clear').onclick = async () => { await O.send('lib:clear', kind === 'media' ? 'downloads' : kind); load(); };
q.addEventListener('input', load);
list.addEventListener('click', (e) => {
  const line = e.target.closest('.line');
  if (!line) return;
  const r = rows[Number(line.dataset.i)];
  const act = e.target.closest('[data-do]');
  if (kind === 'downloads' || kind === 'media') {
    if (act) O.send(act.dataset.do === 'open' ? 'lib:openFile' : 'lib:reveal', r.id);
  } else O.send('open', r.url);
});
window.addEventListener('hashchange', () => {
  const h = location.hash.slice(1);
  if (KINDS.includes(h) && h !== kind) { kind = h; load(); }
});
window.addEventListener('focus', load);
O.on('settings', (s) => { if (setLang(s.lang)) draw(); });
load();
