// Réglages : chaque changement est appliqué immédiatement.
const FIELDS = ['lang', 'searchEngine', 'suggestions', 'archiveAfterHours', 'maxLiveTabs', 'appearance', 'translucent', 'externalLinks', 'autoPip', 'adblock', 'peekLinks'];
const NUMERIC = new Set(['archiveAfterHours', 'maxLiveTabs']);
const el = (id) => document.getElementById(id);

function fill(s) {
  for (const f of FIELDS) {
    const input = el(f);
    if (input.type === 'checkbox') input.checked = !!s[f];
    else input.value = String(s[f]);
  }
  document.title = t('set.title');
}

// Profils : nom modifiable ; suppression possible si aucun Espace ne l'utilise.
function drawProfiles(list) {
  const box = el('profiles');
  box.textContent = '';
  for (const p of list) {
    const line = document.createElement('div');
    line.className = 'line';
    const body = document.createElement('div');
    body.className = 'grow';
    const name = document.createElement('input');
    name.className = 'pname';
    name.value = p.name;
    name.spellcheck = false;
    name.addEventListener('change', async () => drawProfiles(await O.send('settings:renameProfile', { id: p.id, name: name.value })));
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') name.blur(); });
    const sub = document.createElement('div');
    sub.className = 'sub';
    sub.textContent = p.spaces.join(' · ') || t('set.profileUnused');
    body.append(name, sub);
    line.appendChild(body);
    if (p.id !== 'default' && !p.spaces.length) {
      const del = document.createElement('button');
      del.className = 'btn';
      del.textContent = t('set.profileDelete');
      del.onclick = async () => drawProfiles(await O.send('settings:deleteProfile', p.id));
      line.appendChild(del);
    }
    box.appendChild(line);
  }
}

// Extensions Chrome (expérimental)
function drawExtensions(list) {
  const box = el('ext-list');
  box.textContent = '';
  for (const x of list || []) {
    const line = document.createElement('div');
    line.className = 'line';
    line.style.borderTop = '0.5px solid var(--line)';
    const body = document.createElement('div');
    body.className = 'grow';
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = `${x.name} ${x.version}`;
    const sub = document.createElement('div');
    sub.className = 'sub';
    sub.textContent = x.description;
    body.append(name, sub);
    line.appendChild(body);
    if (x.popup) {
      const open = document.createElement('button');
      open.className = 'btn';
      open.textContent = t('lib.open');
      open.onclick = () => O.send('ext:popup', x.id);
      line.appendChild(open);
    }
    const on = document.createElement('input');
    on.type = 'checkbox';
    on.checked = x.enabled;
    on.onchange = async () => drawExtensions(await O.send('ext:toggle', { id: x.id, enabled: on.checked }));
    const del = document.createElement('button');
    del.className = 'btn';
    del.textContent = t('set.profileDelete');
    del.onclick = async () => drawExtensions(await O.send('ext:remove', x.id));
    line.append(on, del);
    box.appendChild(line);
  }
}

el('ext-add').onclick = async () => {
  const input = el('ext-url');
  if (!input.value.trim()) return;
  el('ext-add').disabled = true;
  el('ext-msg').textContent = t('ext.installing');
  const r = await O.send('ext:install', input.value.trim());
  el('ext-add').disabled = false;
  el('ext-msg').textContent = r && r.error ? r.error : t('ext.hint');
  if (r && r.list) { input.value = ''; drawExtensions(r.list); }
};

// Aiguillage des liens venus d'autres applications
let routes = [];
let spaceNames = [];
function drawRoutes() {
  const box = el('routes');
  box.textContent = '';
  routes.forEach((r, i) => {
    const line = document.createElement('div');
    line.className = 'line';
    const body = document.createElement('div');
    body.className = 'grow name';
    const dest = r.to === 'little' ? t('set.externalLittle') : ((spaceNames.find((x) => x.id === r.to) || {}).name || '?');
    body.textContent = `« ${r.match} »  →  ${dest}`;
    const del = document.createElement('button');
    del.className = 'btn';
    del.textContent = t('set.profileDelete');
    del.onclick = () => { routes.splice(i, 1); O.send('settings:set', { routes }); drawRoutes(); };
    line.append(body, del);
    box.appendChild(line);
  });
  el('route-to').innerHTML = spaceNames.map((x) => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('') + `<option value="little">${esc(t('set.externalLittle'))}</option>`;
}
el('route-add').onclick = () => {
  const match = el('route-match').value.trim();
  if (!match) return;
  routes.push({ match, to: el('route-to').value });
  O.send('settings:set', { routes });
  el('route-match').value = '';
  drawRoutes();
};

async function init() {
  drawExtensions(await O.send('ext:list'));
  const data = await O.send('settings:get');
  drawProfiles(data.profiles);
  routes = (data.settings.routes || []).slice();
  spaceNames = data.spaces;
  drawRoutes();
  el('searchEngine').innerHTML = data.engines.map((e) => `<option value="${esc(e.id)}">${esc(e.name)}</option>`).join('');
  el('version').textContent = `Orbe ${data.version} · Chromium ${data.chrome}`;
  fill(data.settings);
}

for (const f of FIELDS) {
  el(f).addEventListener('change', (e) => {
    const input = e.target;
    let value = input.type === 'checkbox' ? input.checked : input.value;
    if (NUMERIC.has(f)) value = Number(value);
    O.send('settings:set', { [f]: value });
  });
}

const flash = (btn) => { const old = btn.textContent; btn.textContent = '✓'; setTimeout(() => { btn.textContent = old; }, 1200); };
el('makeDefault').onclick = async (e) => { await O.send('settings:makeDefault'); flash(e.target); };
el('resetPerms').onclick = async (e) => { await O.send('settings:resetPerms'); flash(e.target); };
el('clearData').onclick = async (e) => { if (await O.send('settings:clearData')) flash(e.target); };

O.on('settings', (s) => { setLang(s.lang); fill(s); });
window.addEventListener('focus', async () => drawProfiles((await O.send('settings:get')).profiles));
init();
