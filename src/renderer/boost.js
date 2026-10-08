// Éditeur de Boost : CSS du site et éléments masqués, appliqués en direct.
const $ = (id) => document.getElementById(id);
let timer = null;

function draw(b) {
  if (!b) return;
  $('host').textContent = 'Boost · ' + b.host;
  document.title = 'Boost · ' + b.host;
  if (document.activeElement !== $('css')) $('css').value = b.css;
  $('on').checked = b.enabled;
  const box = $('zaps');
  box.textContent = '';
  b.zaps.forEach((z, i) => {
    const line = document.createElement('div');
    line.className = 'zap';
    const s = document.createElement('span');
    s.textContent = z;
    const x = document.createElement('button');
    x.className = 'btn';
    x.textContent = '×';
    x.onclick = async () => draw(await O.send('boost:set', { zaps: b.zaps.filter((_, j) => j !== i) }));
    line.append(s, x);
    box.appendChild(line);
  });
}

$('css').addEventListener('input', () => {
  clearTimeout(timer);
  timer = setTimeout(async () => draw(await O.send('boost:set', { css: $('css').value })), 250);
});
$('on').addEventListener('change', async () => draw(await O.send('boost:set', { enabled: $('on').checked })));
$('zap').onclick = async () => draw(await O.send('boost:zap'));
O.send('boost:get').then(draw);
