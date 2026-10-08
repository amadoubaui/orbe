// Mots de passe : liste des comptes sous un champ de connexion, et proposition
// d'enregistrement. Ces vues ne reçoivent jamais de mot de passe : seulement
// des identifiants et un jeton, renvoyé au processus principal avec le choix.
const $ = (id) => document.getElementById(id);
let token = null;
let shownAt = 0;

function icon(name) {
  const span = document.createElement('span');
  span.className = 'key';
  span.innerHTML = `<svg class="i"><use href="#i-${name}"/></svg>`;
  return span;
}

function row(item, p) {
  const b = document.createElement('button');
  b.className = 'acc ' + item.kind;
  b.dataset.id = item.id;
  const txt = document.createElement('span');
  txt.className = 'txt';
  const name = document.createElement('div');
  name.className = 'name';
  const sub = document.createElement('div');
  sub.className = 'sub';
  if (item.kind === 'generate') {
    name.textContent = t('pw.pickGenerate');
    sub.textContent = p.site;
  } else if (item.kind === 'manage') {
    name.textContent = t('pw.pickManage');
    name.style.fontWeight = '500';
  } else {
    name.textContent = item.label;
    // Compte d'une autre adresse du même site : dit en toutes lettres.
    sub.textContent = item.kind === 'related' ? t('pw.pickOther', { site: item.sub }) : (p.embedded ? t('pw.pickEmbedded', { site: p.site }) : item.sub);
  }
  txt.append(name);
  if (sub.textContent) txt.append(sub);
  if (item.kind !== 'manage') b.append(icon(item.kind === 'generate' ? 'spark' : 'key'));
  b.append(txt);
  // Un clic tombé au moment même où la liste apparaît n'est pas un choix.
  b.onclick = () => { if (Date.now() - shownAt > 300) O.send('pw:pick', { token, id: item.id }); };
  return b;
}

function showPick(p) {
  const box = $('pick');
  box.textContent = '';
  for (const item of p.items) box.append(row(item, p));
  box.append(row({ id: 'manage', kind: 'manage' }, p));
  $('save').hidden = true;
  box.hidden = false;
}

function showSave(p) {
  $('pick').hidden = true;
  $('save-title').textContent = t(p.update ? 'pw.updateAsk' : 'pw.saveAsk', { site: p.site });
  $('save-user').value = p.username || '';
  $('save-user').readOnly = !!p.update;
  $('save-ok').textContent = t(p.update ? 'pw.updateBtn' : 'pw.saveBtn');
  $('save').hidden = false;
}

const answer = (choice) => O.send('pw:prompt', { token, choice, username: $('save-user').value });
$('save-ok').onclick = () => answer('save');
$('save-never').onclick = () => answer('never');
$('save-later').onclick = () => answer('later');
$('save-user').addEventListener('keydown', (e) => { if (e.key === 'Enter') answer('save'); });

O.on('overlay', (p) => {
  token = p.token || null;
  shownAt = Date.now();
  if (p.mode === 'pw-pick') showPick(p);
  else if (p.mode === 'pw-save') showSave(p);
  else { $('pick').hidden = true; $('save').hidden = true; }
});
O.on('settings', (s) => setLang(s.lang));
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !token) return;
  if (!$('pick').hidden) O.send('pw:pick', { token, id: 'close' });
  else answer('later');
});
// La liste a pris le clavier puis le perd (clic ailleurs) : elle se ferme.
window.addEventListener('blur', () => { if (!$('pick').hidden && token) O.send('pw:pick', { token, id: 'dismiss' }); });
