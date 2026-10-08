// Barre de menus native, calquée sur celle d'Arc (mêmes rubriques, mêmes
// raccourcis), traduite. Reconstruite seulement quand un libellé change.
const { Menu, BaseWindow, app } = require('electron');
const { store } = require('./store');
const { OrbeWindow } = require('./window');
const commands = require('./commands');
const platform = require('./platform');
const shortcuts = require('./shortcuts');

const t = (k, v) => store.t(k, null, v);
let lastSignature = '';
let timer = null;

function dispatch(name, arg) {
  const focused = BaseWindow.getFocusedWindow();
  const win = OrbeWindow.focused;
  // Fenêtre annexe au premier plan (réglages, petite fenêtre) : elle gère
  // elle-même la fermeture, le reste s'adresse à la fenêtre principale.
  if (focused && !win) {
    if (name === 'closeTab' || name === 'closeWindow') return focused.close();
    if (focused.orbeLittle && focused.orbeLittle.run(name)) return undefined;
  }
  return commands.run(win || OrbeWindow.primary, name, arg);
}

function item(name, extra = {}) {
  const c = commands.byName.get(name);
  return { label: t(extra.labelKey || c.label), accelerator: shortcuts.accelOf(name), click: () => dispatch(name), ...extra, labelKey: undefined };
}

function build() {
  const w = OrbeWindow.focused || OrbeWindow.primary;
  const s = store.state.settings;
  const sep = { type: 'separator' };
  const loc = w && w.activeId ? w.locate(w.activeId) : null;
  const pinned = !!loc && loc.list !== 'today';
  const tab = w && w.activeId ? w.data.tabs[w.activeId] : null;
  const setAppearance = (v) => () => commands.setSetting('appearance', v);

  const spaces = w ? w.data.spaces : [];
  const template = [
    {
      label: 'Orbe',
      submenu: [
        { label: t('app.about'), role: 'about' },
        sep,
        item('settings'),
        item('passwords'),
        item('defaultBrowser'),
        ...(platform.isWin ? [item('undoDefaultBrowser')] : []),
        sep,
        ...(platform.arcSidebarFile() || platform.isMac ? [item('importArc')] : []),
        item('importBookmarks'),
        sep,
        { label: t('app.services'), role: 'services' },
        sep,
        { label: t('app.hide'), role: 'hide' },
        { label: t('app.hideOthers'), role: 'hideOthers' },
        { label: t('app.showAll'), role: 'unhide' },
        sep,
        { label: t('app.quit'), role: 'quit' },
      ],
    },
    {
      label: t('menu.file'),
      submenu: [
        item('newTab'), item('newWindow'), item('newIncognito'), item('newLittle'), item('newNote'), item('newEasel'), item('reopen'),
        sep, item('commandBar'),
        sep, item('closeTab'), item('closeWindow'),
        sep, item('capture'), item('captureFull'), item('captureToEasel'), item('savePage'), item('print'),
      ],
    },
    {
      label: t('menu.edit'),
      submenu: [
        // Comme dans Arc : le libellé nomme l'action de la barre latérale concernée.
        item('undo', { label: [t('edit.undo'), w && w.pendingLabel('undo') ? t(w.pendingLabel('undo')) : ''].join(' ').trim() }),
        item('redo', { label: [t('edit.redo'), w && w.pendingLabel('redo') ? t(w.pendingLabel('redo')) : ''].join(' ').trim() }),
        sep,
        { label: t('edit.cut'), role: 'cut' },
        { label: t('edit.copy'), role: 'copy' },
        item('copyUrl'), item('copyUrlMarkdown'), item('copyUrlQuote'),
        { label: t('edit.paste'), role: 'paste' },
        { label: t('edit.pasteMatch'), role: 'pasteAndMatchStyle' },
        { label: t('edit.selectAll'), role: 'selectAll' },
        sep,
        item('find'), item('findNext'), item('findPrev'),
      ],
    },
    {
      label: t('menu.view'),
      submenu: [
        {
          label: t('view.appearance'),
          submenu: [
            { label: t('view.auto'), type: 'radio', checked: s.appearance === 'auto', click: setAppearance('auto') },
            { label: t('view.light'), type: 'radio', checked: s.appearance === 'light', click: setAppearance('light') },
            { label: t('view.dark'), type: 'radio', checked: s.appearance === 'dark', click: setAppearance('dark') },
          ],
        },
        sep,
        item('toggleSidebar', { labelKey: w && !w.sidebarVisible ? 'view.showSidebar' : 'view.hideSidebar' }),
        item('toggleToolbar', { labelKey: s.showToolbar ? 'view.hideToolbar' : 'view.showToolbar' }),
        sep,
        item('stop'), item('reload'), item('forceReload'), item('clearCookies'), item('clearCache'),
        sep,
        item('addSplit'), item('splitDirection'), item('closeSplit'),
        ...[1, 2, 3, 4].map((n) => item('pane' + n, { label: `${t('view.pane')} ${n}`, visible: false, acceleratorWorksWhenHidden: true })),
        sep,
        item('boost'), item('zap'),
        sep,
        item('actualSize'), item('zoomIn'), item('zoomOut'),
        sep,
        { label: t('view.developer'), submenu: [item('source'), item('devtools'), item('inspect'), item('console'), sep, item('toggleDevMode', { type: 'checkbox', checked: !!tab && require('./prefs').devMode(tab.url), enabled: !!tab && !!require('./prefs').hostOf(tab.url) && !w.incognito })] },
        sep,
        item('fullscreen'),
      ],
    },
    {
      label: t('menu.spaces'),
      submenu: [
        item('newSpace'), item('editTheme'), item('renameSpace'),
        {
          label: t('spaces.profile'),
          enabled: !!w && !w.incognito,
          submenu: [
            ...(w ? w.data.profiles : []).map((p) => ({
              label: p.name,
              type: 'radio',
              checked: !!w && w.space.profileId === p.id,
              click: () => { const win = OrbeWindow.focused || OrbeWindow.primary; if (win) win.setProfile(p.id); },
            })),
            sep,
            item('newProfile'),
          ],
        },
        item('deleteSpace', { enabled: spaces.length > 1 }),
        sep, item('nextSpace'), item('prevSpace'),
        sep,
        ...spaces.map((sp, i) => ({
          label: `${sp.icon}  ${sp.name}`,
          type: 'checkbox',
          checked: !!w && sp.id === w.spaceId,
          accelerator: i < 9 ? platform.accel(`Ctrl+${i + 1}`) : undefined,
          click: () => { const win = OrbeWindow.focused || OrbeWindow.primary; if (win) win.switchSpace(sp.id); },
        })),
      ],
    },
    {
      label: t('menu.tabs'),
      submenu: [
        item('newTab', { accelerator: undefined }),
        item('togglePin', { labelKey: pinned ? 'tabs.unpin' : 'tabs.pin' }),
        item('newFolder'),
        item('duplicate'),
        item('expandPeek', { enabled: !!w && !!w.peekState }),
        item('openInSpace', { visible: false, acceleratorWorksWhenHidden: true }),
        item('toggleMute', { labelKey: tab && tab.muted ? 'tabs.unmute' : 'tabs.mute' }),
        sep, item('nextTab'), item('prevTab'),
        sep, item('clearToday'),
        // ⌘1…⌘9 : accès direct aux onglets, dans l'ordre de la barre latérale.
        ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({
          label: `Onglet ${n}`,
          visible: false,
          acceleratorWorksWhenHidden: true,
          accelerator: platform.accel(`Cmd+${n}`),
          click: () => { const win = OrbeWindow.focused; if (win) win.tabAt(n); },
        })),
      ],
    },
    {
      label: t('menu.archive'),
      submenu: [item('back'), item('forward'), sep, item('history'), item('viewArchive'), item('clearArchive')],
    },
    {
      label: t('menu.window'),
      role: 'window',
      submenu: [
        {
          label: t('window.onTop'),
          type: 'checkbox',
          checked: !!w && w.win.isAlwaysOnTop(),
          click: () => { const f = BaseWindow.getFocusedWindow(); if (f) { f.setAlwaysOnTop(!f.isAlwaysOnTop()); refresh(true); } },
        },
        { label: t('window.minimize'), role: 'minimize' },
        { label: t('window.zoom'), role: 'zoom' },
        sep, item('library'), item('downloads'), item('media'), item('notes'), item('easels'),
        sep, { label: t('window.front'), role: 'front' },
      ],
    },
    { label: t('menu.help'), role: 'help', submenu: [item('welcome'), item('shortcuts'), item('support'), item('github')] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(platform.menuTemplate(template)));
}

// Appelé à chaque changement d'état : ne reconstruit le menu que si ce qu'il
// affiche a réellement changé.
function refresh(force) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    const w = OrbeWindow.focused || OrbeWindow.primary;
    const s = store.state.settings;
    const loc = w && w.activeId ? w.locate(w.activeId) : null;
    const tab = w && w.activeId ? w.data.tabs[w.activeId] : null;
    const sig = JSON.stringify([
      s.lang, s.appearance, s.showToolbar, w && w.id, w && w.sidebarVisible, w && w.spaceId,
      loc && loc.list, tab && tab.muted, w ? w.data.spaces.map((x) => x.icon + x.name) : 0,
      w && w.space.profileId, w ? w.data.profiles.length : 0, !!(w && w.peekState),
      w && w.pendingLabel('undo'), w && w.pendingLabel('redo'),
      s.shortcuts, s.devSites, tab && tab.url && require('./prefs').hostOf(tab.url),
    ]);
    if (!force && sig === lastSignature) return;
    lastSignature = sig;
    build();
  }, force ? 0 : 120);
}

module.exports = { refresh, build };
