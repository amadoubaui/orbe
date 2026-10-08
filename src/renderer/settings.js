// Réglages : chaque changement est appliqué immédiatement.
const FIELDS = ['lang', 'searchEngine', 'suggestions', 'archiveAfterHours', 'maxLiveTabs', 'appearance', 'translucent'];
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

async function init() {
  const data = await O.send('settings:get');
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
init();
