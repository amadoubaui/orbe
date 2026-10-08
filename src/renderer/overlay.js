// Vues flottantes. La même page sert de fenêtre modale (barre de commande,
// bascule d'onglets, thème), de barre de recherche ou de notification.
const $ = (id) => document.getElementById(id);
const send = O.send;
const panels = ['command', 'switcher', 'theme', 'find', 'toast', 'peek', 'status', 'drop'];
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

const KIND_ICON = { search: 'search', url: 'globe', history: 'globe', command: 'bolt', tab: 'globe' };

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
    hint.textContent = it.kind === 'tab' ? t('cmd.switchTo') + ' ↵' : '↵';
    row.append(ic, title, sub, hint);
    list.appendChild(row);
  });
}

function select(i) {
  sel = i;
  for (const row of list.children) row.classList.toggle('sel', Number(row.dataset.i) === sel);
}

async function query() {
  const q = typed;
  const mine = ++seq;
  const res = (await send('suggest', q)) || [];
  if (mine !== seq || mode !== 'command') return;
  items = res;
  sel = q ? 0 : -1;
  // Complète l'adresse la plus probable, comme dans une barre d'adresse.
  const first = items[0];
  if (q && !deleting && first && first.complete && first.complete.toLowerCase().startsWith(q.toLowerCase()) && input.selectionStart === input.value.length) {
    input.value = q + first.complete.slice(q.length);
    input.setSelectionRange(q.length, input.value.length);
  }
  drawItems();
}

function run(background) {
  const text = input.value.trim();
  const item = sel >= 0 && items[sel] ? items[sel] : (text ? { kind: 'raw', title: text } : null);
  if (!item) return send('closeOverlay');
  return send('run', { item, background });
}

input.addEventListener('input', (e) => {
  deleting = !!e.inputType && e.inputType.startsWith('delete');
  typed = input.value;
  query();
});

input.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
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
list.addEventListener('click', (e) => {
  const row = e.target.closest('.cmd');
  if (!row) return;
  sel = Number(row.dataset.i);
  run(modKey(e));
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
  items = p.items || [];
  sel = -1;
  seq++;
  drawItems();
  input.focus();
  input.select();
}

O.on('suggest-more', (p) => {
  if (mode !== 'command' || p.q !== typed) return;
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
const ICONS = ['🏠', '💼', '✨', '🎬', '🎨', '🎧', '📚', '🧪', '🛒', '💬', '🧭', '🌍', '🚀', '⚙️', '❤️', '🌙', '☀️', '🌿', '🔥', '🎮', '📷', '✈️', '🍿', '🧠', '💡', '📈', '🔒', '🎓', '⚽️', '🏦', '📝', '⭐️'];
let theme = null;

function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)))).toString(16).padStart(2, '0');
  return '#' + f(0) + f(8) + f(4);
}

function drawTheme() {
  document.body.style.setProperty('--accent', theme.color);
  for (const b of $('theme-colors').children) b.classList.toggle('sel', b.dataset.c === theme.color);
  for (const b of $('theme-icons').children) b.classList.toggle('sel', b.textContent === theme.icon);
  for (const b of $('theme-colors2').children) b.classList.toggle('sel', b.dataset.c === (theme.color2 || ''));
}

function openTheme(p) {
  show('theme');
  theme = { color: p.color, icon: p.icon, color2: p.color2 || '' };
  $('theme-grain').value = String(Math.round((p.grain || 0) * 100));
  $('theme-colors2').innerHTML = `<button class="sw-color none" data-c="">∅</button>` + p.colors.slice(0, 11).map((c) => `<button class="sw-color" data-c="${esc(c)}" style="background:${esc(c)}"></button>`).join('');
  $('theme').style.left = (p.x || 260) + 'px';
  $('theme-colors').innerHTML = p.colors.map((c) => `<button class="sw-color" data-c="${esc(c)}" style="background:${esc(c)}"></button>`).join('');
  $('theme-icons').innerHTML = ICONS.map((e) => `<button class="sw-icon">${e}</button>`).join('');
  drawTheme();
}

$('theme-colors').addEventListener('click', (e) => {
  const b = e.target.closest('.sw-color');
  if (!b) return;
  theme.color = b.dataset.c;
  drawTheme();
  send('theme', { color: theme.color });
});
$('theme-hue').addEventListener('input', (e) => {
  theme.color = hslToHex(Number(e.target.value), 68, 60);
  drawTheme();
  send('theme', { color: theme.color });
});
$('theme-icons').addEventListener('click', (e) => {
  const b = e.target.closest('.sw-icon');
  if (!b) return;
  theme.icon = b.textContent;
  drawTheme();
  send('theme', { icon: theme.icon });
});
$('theme-colors2').addEventListener('click', (e) => {
  const b = e.target.closest('.sw-color');
  if (!b) return;
  theme.color2 = b.dataset.c;
  drawTheme();
  send('themeExtra', { color2: theme.color2 });
});
$('theme-grain').addEventListener('input', (e) => send('themeExtra', { grain: Number(e.target.value) / 100 }));
$('theme-done').onclick = () => send('closeOverlay');

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
    findInput.focus();
    findInput.select();
    if (findInput.value) send('find', { text: findInput.value });
  } else if (p.mode === 'peek') {
    show('peek');
    document.body.classList.add('peek');
  } else if (p.mode === 'drop') {
    show('drop');
    $('drop-label').textContent = p.label;
    $('drop').classList.toggle('over', !!p.over);
  } else if (p.mode === 'status') {
    show('status');
    $('status').textContent = p.text;
  } else if (p.mode === 'toast') {
    show('toast');
    const el = $('toast');
    el.textContent = p.text;
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

$('peek-close').onclick = () => send('peekClose');
$('peek-expand').onclick = () => send('peekExpand');
$('peek-split').onclick = () => send('peekSplit');

$('backdrop').addEventListener('mousedown', () => {
  if (mode === 'command' || mode === 'theme') send('closeOverlay');
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
