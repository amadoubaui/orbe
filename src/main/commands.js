// Toutes les actions d'Orbe, au même endroit : le menu, la barre de commande
// et la barre latérale appellent les mêmes fonctions.
// `accel` reprend les raccourcis d'Arc ; `keys` est leur affichage.
const { dialog } = require('electron');
const { store } = require('./store');
const platform = require('./platform');

const hooks = { newWindow: () => {}, newLittle: () => {}, openSettings: () => {}, settingsChanged: null, openBoost: () => {} };

const wc = (w) => w.activeWc;

const COMMANDS = [
  // Fichier
  { name: 'newTab', label: 'file.newTab', accel: 'Cmd+T', keys: '⌘T', palette: false, run: (w) => w.openCommand('new') },
  { name: 'newWindow', label: 'file.newWindow', accel: 'Cmd+N', keys: '⌘N', global: true, run: () => hooks.newWindow({}) },
  { name: 'newIncognito', label: 'file.newIncognito', accel: 'Shift+Cmd+N', keys: '⇧⌘N', global: true, run: () => hooks.newWindow({ incognito: true }) },
  { name: 'newLittle', label: 'file.newLittle', accel: 'Alt+Cmd+N', keys: '⌥⌘N', global: true, run: () => hooks.newLittle('') },
  // ⌘Z : annule l'archivage quand on n'est pas en train d'écrire, sinon annulation classique.
  { name: 'undo', label: 'edit.undo', accel: 'Cmd+Z', keys: '⌘Z', palette: false, run: (w) => undo(w) },
  { name: 'reopen', label: 'file.reopen', accel: 'Shift+Cmd+T', keys: '⇧⌘T', run: (w) => w.reopenClosed() },
  { name: 'commandBar', label: 'file.commandBar', accel: 'Cmd+L', keys: '⌘L', palette: false, run: (w) => w.openCommand('edit') },
  { name: 'closeTab', label: 'file.closeTab', accel: 'Cmd+W', keys: '⌘W', run: (w) => (w.peekState ? w.closePeek() : (w.activeId ? w.close() : w.win.close())) },
  { name: 'closeWindow', label: 'file.closeWindow', accel: 'Shift+Cmd+W', keys: '⇧⌘W', run: (w) => w.win.close() },
  { name: 'capture', label: 'file.capture', accel: 'Shift+Cmd+2', keys: '⇧⌘2', run: (w) => w.capture() },
  { name: 'captureFull', label: 'file.captureFull', run: (w) => w.captureFull() },
  { name: 'savePage', label: 'file.savePage', accel: 'Shift+Cmd+S', keys: '⇧⌘S', run: (w) => w.savePage() },
  { name: 'print', label: 'file.print', accel: 'Cmd+P', keys: '⌘P', run: (w) => wc(w) && wc(w).print() },
  // Édition
  { name: 'copyUrl', label: 'edit.copyUrl', accel: 'Shift+Cmd+C', keys: '⇧⌘C', run: (w) => w.copyUrl(false) },
  { name: 'copyUrlMarkdown', label: 'edit.copyUrlMarkdown', accel: 'Alt+Shift+Cmd+C', keys: '⌥⇧⌘C', run: (w) => w.copyUrl(true) },
  { name: 'copyUrlQuote', label: 'edit.copyUrlQuote', accel: 'Ctrl+Shift+Cmd+C', keys: '⌃⇧⌘C', run: (w) => w.copyQuote() },
  { name: 'find', label: 'edit.find', accel: 'Cmd+F', keys: '⌘F', run: (w) => w.openFind() },
  { name: 'findNext', label: 'edit.findNext', accel: 'Cmd+G', keys: '⌘G', palette: false, run: (w) => w.findStep(true) },
  { name: 'findPrev', label: 'edit.findPrev', accel: 'Shift+Cmd+G', keys: '⇧⌘G', palette: false, run: (w) => w.findStep(false) },
  // Présentation
  { name: 'toggleSidebar', label: 'view.hideSidebar', accel: 'Cmd+S', keys: '⌘S', run: (w) => w.toggleSidebar() },
  { name: 'toggleToolbar', label: 'view.showToolbar', accel: 'Shift+Cmd+D', keys: '⇧⌘D', run: () => setSetting('showToolbar', !store.state.settings.showToolbar) },
  { name: 'stop', label: 'view.stop', accel: 'Cmd+.', keys: '⌘.', palette: false, run: (w) => wc(w) && wc(w).stop() },
  { name: 'reload', label: 'view.reload', accel: 'Cmd+R', keys: '⌘R', run: (w) => w.reload(false) },
  { name: 'forceReload', label: 'view.forceReload', accel: 'Shift+Cmd+R', keys: '⇧⌘R', run: (w) => w.reload(true) },
  { name: 'clearCookies', label: 'view.clearCookies', run: (w) => w.clearAndReload('cookies') },
  { name: 'clearCache', label: 'view.clearCache', run: (w) => w.clearAndReload('cache') },
  { name: 'addSplit', label: 'view.addSplit', accel: 'Ctrl+Shift+=', keys: '⌃⇧=', run: (w) => w.addSplit() },
  ...[1, 2, 3, 4].map((n) => ({ name: 'pane' + n, label: 'view.pane', accel: `Ctrl+Shift+${n}`, keys: `⌃⇧${n}`, palette: false, run: (w) => w.focusPane(n) })),
  { name: 'closeSplit', label: 'view.closeSplit', accel: 'Ctrl+Shift+-', keys: '⌃⇧-', run: (w) => w.closeSplitPane() },
  { name: 'actualSize', label: 'view.actualSize', accel: 'Cmd+0', keys: '⌘0', run: (w) => w.zoom(0) },
  { name: 'zoomIn', label: 'view.zoomIn', accel: 'Cmd+Plus', keys: '⌘+', run: (w) => w.zoom(0.5) },
  { name: 'zoomOut', label: 'view.zoomOut', accel: 'Cmd+-', keys: '⌘-', run: (w) => w.zoom(-0.5) },
  { name: 'source', label: 'view.source', accel: 'Alt+Cmd+U', keys: '⌥⌘U', run: (w) => wc(w) && w.newTab('view-source:' + wc(w).getURL()) },
  { name: 'devtools', label: 'view.devtools', accel: 'Alt+Cmd+I', keys: '⌥⌘I', run: (w) => wc(w) && wc(w).toggleDevTools() },
  { name: 'inspect', label: 'view.inspect', accel: 'Alt+Cmd+C', keys: '⌥⌘C', palette: false, run: (w) => wc(w) && wc(w).openDevTools({ mode: 'right', activate: true }) },
  { name: 'console', label: 'view.console', accel: 'Alt+Cmd+J', keys: '⌥⌘J', palette: false, run: (w) => wc(w) && wc(w).openDevTools({ mode: 'bottom', activate: true }) },
  { name: 'fullscreen', label: 'view.fullscreen', accel: 'Ctrl+Cmd+F', keys: '⌃⌘F', run: (w) => w.win.setFullScreen(!w.win.isFullScreen()) },
  // Espaces
  { name: 'newSpace', label: 'spaces.new', run: (w) => w.newSpace() },
  { name: 'editTheme', label: 'spaces.editTheme', run: (w) => w.openTheme() },
  { name: 'renameSpace', label: 'spaces.rename', run: (w) => w.askRename(w.spaceId) },
  { name: 'deleteSpace', label: 'spaces.delete', palette: false, run: (w) => w.deleteSpace() },
  { name: 'nextSpace', label: 'spaces.next', accel: 'Alt+Cmd+Right', keys: '⌥⌘→', run: (w) => w.stepSpace(1) },
  { name: 'prevSpace', label: 'spaces.prev', accel: 'Alt+Cmd+Left', keys: '⌥⌘←', run: (w) => w.stepSpace(-1) },
  // Onglets
  { name: 'togglePin', label: 'tabs.pin', accel: 'Cmd+D', keys: '⌘D', run: (w) => w.togglePin() },
  { name: 'newFolder', label: 'tabs.newFolder', run: (w) => w.newFolder() },
  { name: 'openInSpace', label: 'little.openIn', accel: 'Alt+Cmd+O', keys: '⌥⌘O', palette: false, run: () => {} },
  { name: 'expandPeek', label: 'peek.expand', accel: 'Cmd+O', keys: '⌘O', palette: false, run: (w) => w.expandPeek() },
  { name: 'nextTab', label: 'tabs.next', accel: 'Alt+Cmd+Down', keys: '⌥⌘↓', run: (w) => w.stepTab(1) },
  { name: 'prevTab', label: 'tabs.prev', accel: 'Alt+Cmd+Up', keys: '⌥⌘↑', run: (w) => w.stepTab(-1) },
  { name: 'clearToday', label: 'tabs.clearToday', accel: 'Shift+Cmd+K', keys: '⇧⌘K', run: (w) => w.clearToday() },
  { name: 'toggleMute', label: 'tabs.mute', run: (w) => w.toggleMute() },
  { name: 'duplicate', label: 'tabs.duplicate', run: (w) => w.duplicate() },
  // Archive
  { name: 'back', label: 'archive.back', accel: 'Cmd+[', keys: '⌘[', palette: false, run: (w) => wc(w) && wc(w).navigationHistory.goBack() },
  { name: 'forward', label: 'archive.forward', accel: 'Cmd+]', keys: '⌘]', palette: false, run: (w) => wc(w) && wc(w).navigationHistory.goForward() },
  { name: 'newNote', label: 'notes.new', accel: 'Ctrl+Cmd+N', keys: '⌃⌘N', run: (w) => w.openInternal('notes.html#new') },
  { name: 'notes', label: 'notes.title', run: (w) => w.openInternal('notes.html') },
  { name: 'media', label: 'lib.media', run: (w) => w.openInternal('library.html#media') },
  { name: 'history', label: 'archive.history', accel: 'Cmd+Y', keys: '⌘Y', run: (w) => w.openInternal('library.html#history') },
  { name: 'viewArchive', label: 'archive.view', run: (w) => w.openInternal('library.html#archive') },
  { name: 'clearArchive', label: 'archive.clear', palette: false, run: () => { store.state.archive = []; store.save(); } },
  // Fenêtre
  { name: 'library', label: 'window.library', accel: 'Shift+Cmd+L', keys: '⇧⌘L', run: (w) => w.openInternal('library.html#history') },
  { name: 'downloads', label: 'window.downloads', accel: 'Shift+Cmd+J', keys: '⇧⌘J', run: (w) => w.openInternal('library.html#downloads') },
  // Application
  { name: 'settings', label: 'app.settings', accel: 'Cmd+,', keys: '⌘,', global: true, run: () => hooks.openSettings() },
  { name: 'defaultBrowser', label: 'app.defaultBrowser', global: true, run: (w) => { makeDefault(); if (w) w.toast(store.t('toast.defaultBrowser')); } },
  { name: 'toggleSiteBlocking', label: 'adblock.toggleSite', run: (w) => w.toggleSiteBlocking() },
  { name: 'boost', label: 'boost.edit', run: (w) => hooks.openBoost(w) },
  { name: 'zap', label: 'boost.zapCmd', run: (w) => { const p = w.activeRt; if (p && !w.incognito) require('./boosts').zap(p.wc); } },
  { name: 'importArc', label: 'app.importArc', run: (w) => importArc(w) },
  { name: 'newProfile', label: 'spaces.newProfile', palette: false, run: (w) => w.newProfile() },
  { name: 'welcome', label: 'help.welcome', run: (w) => w.openInternal('welcome.html') },
  { name: 'shortcuts', label: 'help.shortcuts', run: (w) => w.openInternal('shortcuts.html') },
  // Menu de l'application, ouvert depuis la barre latérale (Windows : pas de barre de menus).
  { name: 'appMenu', label: 'side.menu', palette: false, run: (w) => platform.popupAppMenu(w.win) },
  { name: 'github', label: 'help.github', run: (w) => w.newTab('https://github.com/amadoubaui/orbe') },
];
platform.adaptCommands(COMMANDS);

const byName = new Map(COMMANDS.map((c) => [c.name, c]));

function makeDefault() {
  platform.makeDefault();
}

async function undo(w) {
  const target = require('electron').webContents.getFocusedWebContents();
  let typing = false;
  if (target) {
    typing = await target.executeJavaScript('(() => { const e = document.activeElement; return !!e && (e.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.tagName)); })()').catch(() => true);
  }
  if (typing || !w.closed.length) { if (target) target.undo(); return; }
  w.reopenClosed();
}

async function importArc(w) {
  const arc = require('./import-arc');
  const t = (k, v) => store.t(k, null, v);
  if (w.incognito) return;
  let data;
  try { data = arc.read(); } catch { data = null; }
  if (!data || !data.spaces.length) {
    await dialog.showMessageBox(w.win, { type: 'info', message: t('import.none') });
    return;
  }
  const n = arc.count(data);
  const r = await dialog.showMessageBox(w.win, {
    type: 'question',
    message: t('import.title'),
    detail: t('import.detail', { spaces: n.spaces, pinned: n.pinned, folders: n.folders, favorites: n.favorites, today: n.today }) + '\n\n' + t('import.note'),
    buttons: [t('import.go'), t('edit.undo')],
    defaultId: 0,
    cancelId: 1,
  });
  if (r.response !== 0) return;
  const before = store.state.spaces.length;
  const added = arc.merge(data);
  store.save();
  const { OrbeWindow } = require('./window');
  for (const win of OrbeWindow.all) { win.layout(); }
  if (added) {
    const firstNew = store.state.spaces[Math.min(before, store.state.spaces.length - 1)];
    const target = store.state.spaces.find((s) => s.arcId) || firstNew;
    w.spaceId = target.id;
    w.layout();
    w.remember();
  }
  OrbeWindow.pushAll();
  w.toast(t(added ? 'import.done' : 'import.already', { n: added }));
}

function setSetting(key, value) {
  const { OrbeWindow } = require('./window');
  store.state.settings[key] = value;
  store.save();
  // Passe par la même porte que la fenêtre des réglages (thème, menu, pages).
  if (hooks.settingsChanged) return hooks.settingsChanged();
  for (const w of OrbeWindow.all) w.layout();
  OrbeWindow.pushAll();
}

// Exécute une commande pour la fenêtre donnée. Sans fenêtre Orbe ouverte,
// seules les commandes globales s'exécutent directement ; les autres ouvrent
// d'abord une fenêtre.
function run(win, name, arg) {
  const cmd = byName.get(name);
  if (!cmd) return undefined;
  if (!win && !cmd.global) win = hooks.newWindow({});
  try {
    return cmd.run(win, arg);
  } catch (err) {
    console.error('[orbe] commande', name, err);
    return undefined;
  }
}

module.exports = { COMMANDS, byName, run, hooks, makeDefault, setSetting };
