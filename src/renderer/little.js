// Barre de la petite fenêtre : une adresse et un bouton « Ouvrir dans Orbe ».
const u = document.getElementById('u');
const open = document.getElementById('open');
let url = '';

O.on('state', (s) => {
  setLang(s.lang);
  url = s.url;
  if (document.activeElement !== u) u.value = host(s.url);
  open.disabled = !s.url;
  document.title = s.title || 'Orbe';
});
O.on('edit', () => { u.focus(); });
u.addEventListener('focus', () => { u.value = url; u.select(); });
u.addEventListener('blur', () => { u.value = host(url); });
u.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && u.value.trim()) { O.send('navigate', u.value.trim()); u.blur(); }
  if (e.key === 'Escape') u.blur();
});
open.onclick = () => O.send('openInOrbe');
O.send('ready');
if (!url) u.focus();
