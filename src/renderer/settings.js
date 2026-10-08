// Réglages : chaque changement est appliqué immédiatement.
const FIELDS = ['lang', 'searchEngine', 'suggestions', 'archiveAfterHours', 'maxLiveTabs', 'appearance', 'translucent', 'externalLinks'];
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

async function init() {
  const data = await O.send('settings:get');
  drawProfiles(data.profiles);
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
