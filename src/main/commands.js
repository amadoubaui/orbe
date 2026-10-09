// Toutes les actions d'Orbe, au même endroit : le menu, la barre de commande
// et la barre latérale appellent les mêmes fonctions.
// `accel` reprend les raccourcis d'Arc ; `keys` est leur affichage.
const { app, clipboard, dialog, shell } = require('electron');
const { store } = require('./store');
const platform = require('./platform');
const easels = require('./easels');

// Page de soutien de l'auteur d'Orbe.
const SUPPORT_URL = 'https://buymeacoffee.com/amadouba';

const REPO_URL = 'https://github.com/amadoubaui/orbe';

const hooks = { newWindow: () => {}, newLittle: () => {}, openSettings: () => {}, settingsChanged: null, openBoost: () => {}, openPasswords: () => {}, importBookmarks: () => {}, menuChanged: () => {}, checkUpdates: () => {} };

const wc = (w) => w.activeWc;

const COMMANDS = [
  // Fichier
  { name: 'newTab', label: 'file.newTab', accel: 'Cmd+T', keys: '⌘T', palette: false, run: (w) => w.openCommand('new') },
  // Comme dans Arc : une fenêtre neuve, sans onglet, s'ouvre sur la barre de commande.
  { name: 'newWindow', label: 'file.newWindow', accel: 'Cmd+N', keys: '⌘N', global: true, run: () => greet(hooks.newWindow({})) },
  { name: 'newIncognito', label: 'file.newIncognito', accel: 'Shift+Cmd+N', keys: '⇧⌘N', global: true, run: () => greet(hooks.newWindow({ incognito: true })) },
  { name: 'newLittle', label: 'file.newLittle', accel: 'Alt+Cmd+N', keys: '⌥⌘N', global: true, run: () => hooks.newLittle('') },
  // ⌘Z / ⇧⌘Z : défait ou refait la dernière action de la barre latérale quand on
  // n'est pas en train d'écrire, sinon annulation classique du texte.
  { name: 'undo', label: 'edit.undo', accel: 'Cmd+Z', keys: '⌘Z', palette: false, run: (w) => undo(w) },
  { name: 'redo', label: 'edit.redo', accel: 'Shift+Cmd+Z', keys: '⇧⌘Z', palette: false, run: (w) => undo(w, 'redo') },
  { name: 'reopen', label: 'file.reopen', accel: 'Shift+Cmd+T', keys: '⇧⌘T', run: (w) => w.reopenClosed() },
  { name: 'commandBar', label: 'file.commandBar', accel: 'Cmd+L', keys: '⌘L', palette: false, run: (w) => w.openCommand('edit') },
  { name: 'closeTab', label: 'file.closeTab', accel: 'Cmd+W', keys: '⌘W', run: (w) => (w.peekState ? w.dismissPeek() : (w.selected().length ? w.closeMany(w.selected()) : (w.activeId ? w.close() : w.win.close()))) },
  { name: 'closeWindow', label: 'file.closeWindow', accel: 'Shift+Cmd+W', keys: '⇧⌘W', run: (w) => w.win.close() },
  { name: 'capture', label: 'file.capture', accel: 'Shift+Cmd+2', keys: '⇧⌘2', run: (w) => w.capture() },
  { name: 'captureFull', label: 'file.captureFull', run: (w) => w.captureFull() },
  { name: 'captureToEasel', label: 'easel.capture', accel: 'Alt+Shift+Cmd+2', keys: '⌥⇧⌘2', run: (w) => easels.capture(w) },
  { name: 'savePage', label: 'file.savePage', accel: 'Shift+Cmd+S', keys: '⇧⌘S', run: (w) => w.savePage() },
  { name: 'print', label: 'file.print', accel: 'Cmd+P', keys: '⌘P', run: (w) => wc(w) && wc(w).print() },
  // « Share… » dans Arc : la feuille de partage de macOS, pour l'adresse de la page.
  ...(platform.isMac ? [{ name: 'share', label: 'tb.share', run: (w) => w.share() }] : []),
  // Édition
  { name: 'copyUrl', label: 'edit.copyUrl', accel: 'Shift+Cmd+C', keys: '⇧⌘C', run: (w) => (w.selected().length > 1 ? w.copyLinks(w.selected()) : w.copyUrl(false)) },
  { name: 'copyUrlMarkdown', label: 'edit.copyUrlMarkdown', accel: 'Alt+Shift+Cmd+C', keys: '⌥⇧⌘C', run: (w) => w.copyUrl(true) },
  { name: 'copyUrlQuote', label: 'edit.copyUrlQuote', accel: 'Ctrl+Shift+Cmd+C', keys: '⌃⇧⌘C', run: (w) => w.copyQuote() },
  { name: 'find', label: 'edit.find', accel: 'Cmd+F', keys: '⌘F', run: (w) => w.openFind() },
  { name: 'findNext', label: 'edit.findNext', accel: 'Cmd+G', keys: '⌘G', palette: false, run: (w) => w.findStep(true) },
  { name: 'findPrev', label: 'edit.findPrev', accel: 'Shift+Cmd+G', keys: '⇧⌘G', palette: false, run: (w) => w.findStep(false) },
  { name: 'useSelectionFind', label: 'edit.useSelection', palette: false, run: (w) => findSelection(w) },
  // ⌥⌘V, comme dans Arc : l'adresse du presse-papiers s'ouvre dans un nouvel onglet.
  { name: 'pasteUrl', label: 'edit.pasteUrl', accel: 'Alt+Cmd+V', keys: '⌥⌘V', run: (w) => w.pasteUrl() },
  // Présentation
  { name: 'toggleSidebar', label: 'view.hideSidebar', accel: 'Cmd+S', keys: '⌘S', run: (w) => w.toggleSidebar() },
  { name: 'toggleToolbar', label: 'view.showToolbar', accel: 'Shift+Cmd+D', keys: '⇧⌘D', run: () => setSetting('showToolbar', !store.state.settings.showToolbar) },
  { name: 'collapsePinned', label: 'view.collapsePinned', run: (w) => w.togglePinnedCollapsed() },
  { name: 'stop', label: 'view.stop', accel: 'Cmd+.', keys: '⌘.', palette: false, run: (w) => wc(w) && wc(w).stop() },
  { name: 'reload', label: 'view.reload', accel: 'Cmd+R', keys: '⌘R', run: (w) => w.reload(false) },
  { name: 'forceReload', label: 'view.forceReload', accel: 'Shift+Cmd+R', keys: '⇧⌘R', run: (w) => w.reload(true) },
  { name: 'clearCookies', label: 'view.clearCookies', run: (w) => w.clearAndReload('cookies') },
  { name: 'clearCache', label: 'view.clearCache', run: (w) => w.clearAndReload('cache') },
  { name: 'addSplit', label: 'view.addSplit', accel: 'Ctrl+Shift+=', keys: '⌃⇧=', run: (w) => w.addSplit() },
  ...[1, 2, 3, 4].map((n) => ({ name: 'pane' + n, label: 'view.pane', accel: `Ctrl+Shift+${n}`, keys: `⌃⇧${n}`, palette: false, run: (w) => w.focusPane(n) })),
  { name: 'splitDirection', label: 'view.splitDirection', run: (w) => w.toggleSplitDirection() },
  { name: 'closeSplit', label: 'view.closeSplit', accel: 'Ctrl+Shift+-', keys: '⌃⇧-', run: (w) => w.closeSplitPane() },
  { name: 'separateSplit', label: 'view.separateSplit', run: (w) => w.separateSplit() },
  { name: 'separateAll', label: 'view.separateAll', run: (w) => w.separateAll() },
  { name: 'expandSplit', label: 'view.expandSplit', run: (w) => w.expandSplit() },
  // ⌃⇧] / ⌃⇧[ : volet suivant, précédent.
  { name: 'nextPane', label: 'view.nextPane', accel: 'Ctrl+Shift+]', keys: '⌃⇧]', palette: false, run: (w) => w.stepPane(1) },
  { name: 'prevPane', label: 'view.prevPane', accel: 'Ctrl+Shift+[', keys: '⌃⇧[', palette: false, run: (w) => w.stepPane(-1) },
  { name: 'actualSize', label: 'view.actualSize', accel: 'Cmd+0', keys: '⌘0', run: (w) => w.zoom(0) },
  { name: 'zoomIn', label: 'view.zoomIn', accel: 'Cmd+Plus', keys: '⌘+', run: (w) => w.zoom(0.5) },
  { name: 'zoomOut', label: 'view.zoomOut', accel: 'Cmd+-', keys: '⌘-', run: (w) => w.zoom(-0.5) },
  { name: 'source', label: 'view.source', accel: 'Alt+Cmd+U', keys: '⌥⌘U', run: (w) => wc(w) && w.newTab('view-source:' + wc(w).getURL()) },
  { name: 'devtools', label: 'view.devtools', accel: 'Alt+Cmd+I', keys: '⌥⌘I', run: (w) => wc(w) && wc(w).toggleDevTools() },
  { name: 'inspect', label: 'view.inspect', accel: 'Alt+Cmd+C', keys: '⌥⌘C', palette: false, run: (w) => wc(w) && wc(w).openDevTools({ mode: 'right', activate: true }) },
  { name: 'console', label: 'view.console', accel: 'Alt+Cmd+J', keys: '⌥⌘J', palette: false, run: (w) => wc(w) && wc(w).openDevTools({ mode: 'bottom', activate: true }) },
  // Mode développeur du site affiché (⌃D dans Arc) : barre d'outils et adresse entière.
  { name: 'toggleDevMode', label: 'view.devMode', accel: 'Ctrl+D', keys: '⌃D', run: (w) => w.toggleDevMode() },
  { name: 'fullscreen', label: 'view.fullscreen', accel: 'Ctrl+Cmd+F', keys: '⌃⌘F', run: (w) => w.win.setFullScreen(!w.win.isFullScreen()) },
  // Espaces
  { name: 'newSpace', label: 'spaces.new', run: (w) => w.newSpace() },
  { name: 'editTheme', label: 'spaces.editTheme', run: (w) => w.openTheme() },
  { name: 'renameSpace', label: 'spaces.rename', run: (w) => w.askRename(w.spaceId) },
  { name: 'deleteSpace', label: 'spaces.delete', palette: false, run: (w) => w.deleteSpace() },
  { name: 'nextSpace', label: 'spaces.next', accel: 'Alt+Cmd+Right', keys: '⌥⌘→', run: (w) => w.stepSpace(1) },
  { name: 'prevSpace', label: 'spaces.prev', accel: 'Alt+Cmd+Left', keys: '⌥⌘←', run: (w) => w.stepSpace(-1) },
  // Onglets
  { name: 'togglePin', label: 'tabs.pin', accel: 'Cmd+D', keys: '⌘D', run: (w) => (w.selected().length > 1 ? w.pinMany(w.selected()) : w.togglePin()) },
  { name: 'newFolder', label: 'tabs.newFolder', run: (w) => w.newFolder() },
  { name: 'openInSpace', label: 'little.openIn', accel: 'Alt+Cmd+O', keys: '⌥⌘O', palette: false, run: () => {} },
  { name: 'expandPeek', label: 'peek.expand', accel: 'Cmd+O', keys: '⌘O', palette: false, run: (w) => w.expandPeek() },
  { name: 'nextTab', label: 'tabs.next', accel: 'Alt+Cmd+Down', keys: '⌥⌘↓', run: (w) => w.stepTab(1) },
  { name: 'prevTab', label: 'tabs.prev', accel: 'Alt+Cmd+Up', keys: '⌥⌘↑', run: (w) => w.stepTab(-1) },
  { name: 'clearToday', label: 'tabs.clearToday', accel: 'Shift+Cmd+K', keys: '⇧⌘K', run: (w) => w.clearToday() },
  { name: 'toggleMute', label: 'tabs.mute', run: (w) => w.toggleMute() },
  { name: 'muteAll', label: 'tabs.muteAll', run: (w) => palette().muteAll(w, true) },
  { name: 'unmuteAll', label: 'tabs.unmuteAll', run: (w) => palette().muteAll(w, false) },
  { name: 'duplicate', label: 'tabs.duplicateTab', run: (w) => w.duplicate() },
  { name: 'renameTab', label: 'tabs.renameTab', run: (w) => { if (w.activeId && w.locate(w.activeId).list !== 'favorites') w.askRename(w.activeId); } },
  // Le libellé suit l'onglet affiché : favori ou non, sorti de son adresse épinglée ou non.
  { name: 'toggleFavorite', label: 'tabs.addFavorite', paletteLabel: (w) => (w.incognito || !w.activeId ? '' : (w.locate(w.activeId).list === 'favorites' ? 'tabs.removeFavorite' : 'tabs.addFavorite')), run: (w) => w.toggleFavorite() },
  { name: 'resetTab', label: 'tabs.resetPinned', paletteLabel: (w) => (strayed(w) ? 'tabs.resetPinned' : ''), run: (w) => w.resetPinned() },
  { name: 'replacePin', label: 'tabs.replacePinned', paletteLabel: (w) => (strayed(w) ? 'tabs.replacePinned' : ''), run: (w) => replacePin(w) },
  // Actions à paramètre de la barre de commande (voir palette.js) : l'argument est vérifié là-bas.
  { name: 'focusSpace', label: 'cmd.space', palette: false, run: (w, id) => palette().focusSpace(w, id) },
  { name: 'moveTabToday', label: 'tabs.moveTo', palette: false, run: (w, id) => palette().moveTab(w, id, 'today') },
  { name: 'moveTabPinned', label: 'tabs.moveTo', palette: false, run: (w, id) => palette().moveTab(w, id, 'pinned') },
  { name: 'openFolder', label: 'cmd.folder', palette: false, run: (w, id) => palette().openFolder(w, String(id)) },
  { name: 'extensionAction', label: 'cmd.extension', palette: false, run: (w, id) => palette().extensionAction(w, String(id)) },
  { name: 'revealTab', label: 'tabs.reveal', run: (w) => w.revealTab() },
  { name: 'resetTabs', label: 'tabs.resetAll', run: (w) => { if (w.resetTabs()) w.toast(store.t('toast.tabsReset')); } },
  { name: 'expandFolders', label: 'tabs.expandFolders', run: (w) => w.setFoldersOpen(true) },
  { name: 'collapseFolders', label: 'tabs.collapseFolders', run: (w) => w.setFoldersOpen(false) },
  // Archive
  { name: 'back', label: 'archive.back', accel: 'Cmd+[', keys: '⌘[', palette: false, run: (w) => wc(w) && wc(w).navigationHistory.goBack() },
  { name: 'forward', label: 'archive.forward', accel: 'Cmd+]', keys: '⌘]', palette: false, run: (w) => wc(w) && wc(w).navigationHistory.goForward() },
  // ⌃⇧N et ⌃⌥N, comme dans Arc (⌃⌘N y ouvre une fenêtre vierge).
  { name: 'newNote', label: 'notes.new', accel: 'Ctrl+Shift+N', keys: '⌃⇧N', run: (w) => w.openInternal('notes.html#new') },
  // « New Note (in Split) » d'Arc : la note s'ouvre à côté de la page affichée.
  { name: 'newNoteSplit', label: 'notes.newSplit', accel: 'Ctrl+Alt+N', keys: '⌃⌥N', run: (w) => noteBeside(w) },
  { name: 'exportNotes', label: 'notes.export', run: (w) => require('./notes').exportNotes(w) },
  { name: 'newEasel', label: 'easel.new', accel: 'Ctrl+Shift+E', keys: '⌃⇧E', run: (w) => easels.open(w) },
  { name: 'exportEasel', label: 'easel.export', run: (w) => easels.exportActive(w) },
  { name: 'easels', label: 'easel.title', run: (w) => w.openInternal('library.html#easels') },
  { name: 'notes', label: 'notes.title', run: (w) => w.openInternal('notes.html') },
  { name: 'media', label: 'lib.media', run: (w) => w.openInternal('library.html#media') },
  { name: 'history', label: 'archive.history', accel: 'Cmd+Y', keys: '⌘Y', run: (w) => w.openInternal('library.html#history') },
  { name: 'viewArchive', label: 'archive.view', run: (w) => w.openInternal('library.html#archive') },
  { name: 'clearArchive', label: 'archive.clear', run: (w) => clearArchive(w) },
  // Fenêtre
  { name: 'library', label: 'window.library', accel: 'Shift+Cmd+L', keys: '⇧⌘L', run: (w) => w.openInternal('library.html#' + librarySection()) },
  { name: 'librarySpaces', label: 'lib.viewSpaces', run: (w) => w.openInternal('library.html#spaces') },
  { name: 'downloads', label: 'window.downloads', accel: 'Shift+Cmd+J', keys: '⇧⌘J', run: (w) => w.openInternal('library.html#downloads') },
  { name: 'stayOnTop', label: 'window.onTop', palette: false, run: (w) => { w.win.setAlwaysOnTop(!w.win.isAlwaysOnTop()); hooks.menuChanged(); } },
  // Application
  { name: 'settings', label: 'app.settings', accel: 'Cmd+,', keys: '⌘,', global: true, run: () => hooks.openSettings() },
  { name: 'passwords', label: 'pw.title', global: true, run: () => hooks.openPasswords() },
  // Volets des réglages, comme « Link Preferences », « Air Traffic Control » et « Edit Keyboard Shortcuts » d'Arc.
  { name: 'linkSettings', label: 'app.linkSettings', global: true, run: () => hooks.openSettings('links') },
  { name: 'editShortcuts', label: 'app.editShortcuts', global: true, run: () => hooks.openSettings('shortcuts') },
  { name: 'manageExtensions', label: 'ext.manage', global: true, run: () => hooks.openSettings('extensions') },
  { name: 'defaultBrowser', label: 'app.defaultBrowser', global: true, run: (w) => { makeDefault(); if (w) w.toast(store.t(platform.isWin ? 'toast.defaultBrowserWin' : 'toast.defaultBrowser')); } },
  // Windows : retire l'inscription d'Orbe comme navigateur (registre de l'utilisateur).
  ...(platform.isWin ? [{ name: 'undoDefaultBrowser', label: 'app.undoDefaultBrowser', global: true, run: async (w) => { const ok = await platform.undoDefault(); if (w && ok) w.toast(store.t('toast.undoDefaultBrowser')); } }] : []),
  { name: 'toggleSiteBlocking', label: 'adblock.toggleSite', run: (w) => w.toggleSiteBlocking() },
  { name: 'boost', label: 'boost.edit', run: (w) => hooks.openBoost(w) },
  { name: 'zap', label: 'boost.zapCmd', run: (w) => { const p = w.activeRt; if (p && !p.internal && !w.incognito) require('./boosts').zap(p.wc); } },
  // « View Boosts… » dans Arc : la liste de tous les Boosts (activer, supprimer, exporter, importer).
  { name: 'boosts', label: 'boost.list', run: (w) => hooks.openBoost(w, 'list') },
  { name: 'checkUpdates', label: 'app.checkUpdates', global: true, run: () => hooks.checkUpdates() },
  { name: 'importArc', label: 'app.importArc', run: (w) => importArc(w) },
  { name: 'importBookmarks', label: 'app.importBookmarks', run: (w) => hooks.importBookmarks(w) },
  { name: 'newProfile', label: 'spaces.newProfile', palette: false, run: (w) => w.newProfile() },
  { name: 'support', label: 'support.menu', run: (w) => w.newTab(SUPPORT_URL) },
  { name: 'welcome', label: 'help.welcome', run: (w) => w.openInternal('welcome.html') },
  { name: 'shortcuts', label: 'help.shortcuts', run: (w) => w.openInternal('shortcuts.html') },
  // Menu de l'application, ouvert depuis la barre latérale (Windows : pas de barre de menus).
  { name: 'appMenu', label: 'side.menu', palette: false, run: (w) => platform.popupAppMenu(w.win) },
  { name: 'github', label: 'help.github', run: (w) => w.newTab(REPO_URL) },
  // Aide : l'équivalent de « Help Center », « Contact the Team » et « What's new » d'Arc.
  { name: 'helpCenter', label: 'help.center', run: (w) => w.newTab(REPO_URL + '#readme') },
  { name: 'reportIssue', label: 'help.contact', run: (w) => w.newTab(REPO_URL + '/issues/new') },
  { name: 'whatsNew', label: 'help.whatsNew', run: (w) => w.newTab(REPO_URL + '/releases') },
  // Aide → Dépannage.
  { name: 'revealData', label: 'help.revealData', global: true, run: () => shell.showItemInFolder(app.getPath('userData')) },
  { name: 'copyInfo', label: 'help.copyInfo', global: true, run: (w) => { clipboard.writeText(appInfo()); if (w) w.toast(store.t('toast.infoCopied')); } },
];
platform.adaptCommands(COMMANDS);

const byName = new Map(COMMANDS.map((c) => [c.name, c]));

function palette() {
  return require('./palette');
}

// Fenêtre neuve : sans onglet à afficher, la barre de commande s'ouvre d'elle-même.
function greet(w) {
  if (w && typeof w.openCommand === 'function' && !w.activeId && !w.modalMode) w.openCommand('new');
  return w;
}

// Onglet épinglé (ou favori) affiché, sorti de son adresse d'origine ?
function strayed(w) {
  const tab = w.activeId ? w.data.tabs[w.activeId] : null;
  return !!tab && !!tab.homeUrl && tab.homeUrl !== tab.url;
}

// « Remplacer l'adresse épinglée par l'adresse actuelle ».
function replacePin(w) {
  if (!strayed(w)) return false;
  const tab = w.data.tabs[w.activeId];
  tab.homeUrl = tab.url;
  w.changed();
  return true;
}

// Section de la Bibliothèque affichée en dernier (réglage de fenêtre, voir `lib:section`).
const LIBRARY_SECTIONS = ['history', 'archive', 'downloads', 'media', 'easels', 'spaces', 'boosts'];
function librarySection() {
  const last = store.state.window.librarySection;
  return LIBRARY_SECTIONS.includes(last) ? last : 'history';
}

// Nouvelle note à côté de la page affichée (vue scindée) ; sans page, une note seule.
function noteBeside(w) {
  const beside = w.activeId;
  const tab = w.openInternal('notes.html#new');
  if (tab && beside && beside !== tab.id && w.locate(beside)) w.splitWith(beside, tab.id);
  return tab;
}

function makeDefault() {
  return platform.makeDefault();
}

// « Utiliser la sélection pour rechercher » : le texte sélectionné dans la page
// devient la recherche de la barre « Rechercher dans la page ».
async function findSelection(w) {
  const page = wc(w);
  if (!page) return;
  const text = String(await page.executeJavaScript('String(getSelection())').catch(() => '')).trim().slice(0, 200);
  if (!text) return;
  w.openFind(text);
}

// « Vider l'archive » : rien ne la ramène, la question est posée d'abord.
async function clearArchive(w) {
  const n = store.state.archive.length;
  if (!n) return false;
  const r = await dialog.showMessageBox(w ? w.win : undefined, {
    type: 'warning',
    message: store.t('archive.clearConfirm'),
    detail: store.t('archive.clearDetail', null, { n }),
    buttons: [store.t('archive.clear'), store.t('edit.undo')],
    defaultId: 1,
    cancelId: 1,
  });
  if (r.response !== 0) return false;
  store.state.archive = [];
  store.save();
  // Vidée ici, vidée aussi dans les sauvegardes de l'état (avec les onglets fermés depuis).
  require('./backups').forget({ archiveAll: true });
  return true;
}

// « Copier les infos d'Orbe » : de quoi décrire son installation dans un rapport de bogue.
function appInfo() {
  return [`Orbe ${app.getVersion()}`, `Electron ${process.versions.electron}`, `Chromium ${process.versions.chrome}`, `${process.platform} ${process.arch} ${require('os').release()}`].join('\n');
}

async function undo(w, way = 'undo') {
  const target = require('electron').webContents.getFocusedWebContents();
  // Un tableau au premier plan annule lui-même (ses éléments, ou le texte en cours de saisie).
  if (easels.history(target, way)) return;
  let typing = false;
  if (target) {
    typing = await target.executeJavaScript('(() => { const e = document.activeElement; return !!e && (e.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.tagName)); })()').catch(() => true);
  }
  // Dans un champ de texte, ou sans action de la barre latérale à défaire : la page.
  if ((typing || !w.replay(way)) && target) target[way]();
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
    require('./sounds').arm(win); // une commande est un geste : le son du changement peut suivre
    return cmd.run(win, arg);
  } catch (err) {
    console.error('[orbe] commande', name, err);
    return undefined;
  }
}

module.exports = { COMMANDS, byName, run, hooks, makeDefault, setSetting, appInfo, clearArchive, LIBRARY_SECTIONS, librarySection, REPO_URL };
