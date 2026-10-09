// Extensions : ce que l'interface d'Orbe en montre et en fait (réglages, bouton
// de la barre latérale, menu contextuel du bouton) : page d'options, bouton
// épinglé ou non, mise à jour depuis le Chrome Web Store, désactivation,
// désinstallation. Aucune de ces actions n'est offerte aux extensions
// elles-mêmes : elles ne viennent que des pages de l'interface (orbe://).
const fs = require('fs');
const path = require('path');
const { dialog } = require('electron');
const { store } = require('./store');
const extensions = require('./extensions');
const extApi = require('./ext-api');
const extHost = require('./ext-host');
const { OrbeWindow } = require('./window');

const t = (k, v) => store.t(k, null, v);
const ID = /^[a-p]{32}$/;
const hooks = { openSettings: () => {}, changed: () => {} };

const hidden = () => (Array.isArray(store.state.settings.extHidden) ? store.state.settings.extHidden : []);
const isPinned = (id) => !hidden().includes(id);

// Adresse de la page d'options, d'après le manifeste installé ; '' s'il n'y en a pas.
// Le chemin vient de l'extension : il est résolu dans son origine, et refusé s'il en sort.
function optionsUrl(id) {
  const x = extensions.get(id);
  if (!x) return '';
  let m;
  try { m = JSON.parse(fs.readFileSync(path.join(x.dir, 'manifest.json'), 'utf8').replace(/^﻿/, '')); } catch { return ''; }
  const page = (m.options_ui && m.options_ui.page) || m.options_page;
  if (typeof page !== 'string' || !page) return '';
  try {
    const u = new URL(page, `chrome-extension://${id}/`);
    return u.protocol === 'chrome-extension:' && u.host === id ? u.href : '';
  } catch { return ''; }
}

function list() {
  return extensions.list().map((x) => ({
    id: x.id, name: x.name, version: x.version, description: (x.description || '').slice(0, 160),
    enabled: extensions.isEnabled(x.id), popup: !!extensions.popupFor(x.id), options: !!optionsUrl(x.id), pinned: isPinned(x.id),
  }));
}

function setPinned(id, pinned) {
  if (!ID.test(id)) return false;
  const next = hidden().filter((x) => x !== id && ID.test(x));
  if (!pinned) next.push(id);
  store.state.settings.extHidden = next.slice(-200);
  store.save();
  OrbeWindow.pushAll();
  hooks.changed();
  return true;
}

function openOptions(w, id) {
  const url = optionsUrl(id);
  if (!url || !w || w.incognito || !extensions.isEnabled(id)) return false;
  // Déjà ouverte : on y revient.
  for (const [tid, tab] of Object.entries(w.data.tabs)) if ((tab.url || '').split(/[?#]/)[0] === url) { const loc = w.locate(tid); if (loc && loc.space.id !== w.spaceId) w.switchSpace(loc.space.id); w.activate(tid); return true; }
  const tab = w.createTab(url);
  w.activate(tab.id);
  return true;
}

// Réinstalle depuis le Store : même vérification de signature qu'à l'installation.
async function update(id) {
  const before = extensions.get(id);
  if (!before) return { error: t('ext.failed') };
  let after;
  try { after = await extensions.install(id); } catch (err) { return { error: `${t('ext.updateFailed')} (${err.code || err.message})` }; }
  const changed = after.version !== before.version;
  return { list: list(), updated: changed, message: changed ? t('ext.updated', { name: after.name, from: before.version, to: after.version }) : t('ext.upToDate', { name: after.name, version: after.version }) };
}

async function remove(id) {
  await extensions.remove(id).catch(() => {});
  extApi.forget(id);
  extHost.more.forgetKeys(id);
  if (!isPinned(id)) setPinned(id, true);
  OrbeWindow.pushAll();
  return list();
}

// Menu contextuel du bouton d'une extension (barre latérale).
function menuTemplate(w, id) {
  const x = extensions.get(id);
  const action = (extHost.actionsFor(w) || []).find((a) => a.id === id);
  if (!x && !action) return [];
  const name = (x && x.name) || action.name || action.title || id;
  const sep = { type: 'separator' };
  return [
    { label: name, enabled: false },
    sep,
    { label: t('ext.options'), enabled: !!optionsUrl(id), click: () => openOptions(w, id) },
    { label: t('ext.unpin'), click: () => setPinned(id, false) },
    ...(x ? [
      { label: t('ext.disable'), click: () => { extensions.setEnabled(id, false); OrbeWindow.pushAll(); hooks.changed(); } },
      sep,
      { label: t('ext.removeFrom'), click: () => confirmRemove(w, id, name) },
    ] : []),
    sep,
    { label: t('ext.manage'), click: () => hooks.openSettings('extensions') },
  ];
}

async function confirmRemove(w, id, name) {
  const r = await dialog.showMessageBox(w.win, {
    type: 'warning', message: t('ext.removeAsk', { name }), detail: t('ext.removeDetail'),
    buttons: [t('ext.removeBtn'), t('edit.undo')], defaultId: 1, cancelId: 1,
  });
  if (r.response !== 0) return false;
  await remove(id);
  hooks.changed();
  return true;
}

async function action(name, a, sender) {
  const w = OrbeWindow.ownerOf(sender) || OrbeWindow.primary;
  const id = String((a && typeof a === 'object' ? a.id : a) || '');
  if (!ID.test(id)) return undefined;
  switch (name) {
    case 'ext:options': return openOptions(OrbeWindow.primary || w, id);
    case 'ext:pin': setPinned(id, !!a.pinned); return list();
    case 'ext:update': return update(id);
    case 'ext:menu': { const tpl = w ? menuTemplate(w, id) : []; if (tpl.length) w.popup(tpl); return tpl.length > 0; }
    default: return undefined;
  }
}

module.exports = { list, action, remove, update, setPinned, isPinned, optionsUrl, openOptions, menuTemplate, hooks };
