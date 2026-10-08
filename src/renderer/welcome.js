// Page d'accueil du premier lancement.
document.title = t('welcome.title');
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-cmd]');
  if (b) O.send('command', b.dataset.cmd);
});
O.send('welcome:info').then((info) => {
  if (!info || !info.arc) document.getElementById('row-import').style.display = 'none';
});
O.on('settings', (s) => { if (setLang(s.lang)) document.title = t('welcome.title'); });
