// Notes : de simples textes, enregistrés au fil de la frappe.
const $ = (id) => document.getElementById(id);
let notes = [];
let current = null;
let timer = null;

const titleOf = (n) => (n.text.split('\n').find((l) => l.trim()) || t('notes.untitled')).slice(0, 80);

function drawList() {
  const box = $('items');
  box.textContent = '';
  for (const n of notes) {
    const el = document.createElement('div');
    el.className = 'note' + (current && n.id === current.id ? ' on' : '');
    const b = document.createElement('b');
    b.textContent = titleOf(n);
    const s = document.createElement('span');
    s.textContent = new Date(n.at).toLocaleDateString(lang, { day: 'numeric', month: 'short' });
    el.append(b, s);
    el.onclick = () => select(n.id);
    box.appendChild(el);
  }
  document.title = current ? titleOf(current) : t('notes.title');
}

function select(id) {
  current = notes.find((n) => n.id === id) || null;
  $('editor').textContent = current ? current.text : '';
  $('editor').contentEditable = current ? 'plaintext-only' : 'false';
  $('del').hidden = !current;
  $('saved').textContent = '';
  drawList();
  if (current) $('editor').focus();
}

async function load(selectId) {
  notes = (await O.send('notes:list')) || [];
  select(selectId || (current && current.id) || (notes[0] && notes[0].id));
}

$('editor').dataset.ph = t('notes.placeholder');
$('editor').addEventListener('input', () => {
  if (!current) return;
  current.text = $('editor').innerText;
  current.at = Date.now();
  drawList();
  clearTimeout(timer);
  timer = setTimeout(async () => { await O.send('notes:save', { id: current.id, text: current.text }); $('saved').textContent = t('notes.saved'); }, 400);
});
$('new').onclick = async () => { const n = await O.send('notes:save', { text: '' }); await load(n.id); };
$('del').onclick = async () => { if (!current) return; await O.send('notes:delete', current.id); current = null; await load(); };
O.on('settings', (s) => { if (setLang(s.lang)) drawList(); });
load(location.hash === '#new' ? null : undefined).then(async () => {
  if (location.hash === '#new' || !notes.length) $('new').click();
});
