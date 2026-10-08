// Couche de compatibilité chrome.* : côté extension.
//
// Electron n'offre qu'une partie des API de Chrome. Ce script, enregistré sur
// la session (`registerPreloadScript`, types « frame » et « service-worker »),
// complète l'objet `chrome` des pages d'extension (fenêtre surgissante,
// options, page d'arrière-plan) et des service workers, avant que leur propre
// code ne s'exécute. Chaque appel part vers le processus principal
// (src/main/ext-api.js), qui seul décide : l'identité de l'extension y est
// tirée de l'émetteur du message, jamais de ce que ce script affirme.
//
// Les scripts de contenu ne sont pas concernés : Chrome ne leur donne que
// `runtime`, `storage` et `i18n`, qu'Electron fournit déjà.
//
// Écrit pour Orbe à partir de la documentation publique des API d'extension de
// Chrome ; aucun code tiers.
const { contextBridge, ipcRenderer } = require('electron');

const CHANNEL = 'orbe-ext';
const EVENT = 'orbe-ext-event';

// Dans un service worker, le script de préchargement n'a pas de `location`.
const inWorker = typeof location === 'undefined';
const inExtensionPage = !inWorker && location.protocol === 'chrome-extension:';

// Exécutée dans le monde principal : elle ne voit rien de ce fichier, seulement
// ses arguments (`invoke` et `listen`, relayés par le pont de contexte).
function install(invoke, listen) {
  const c = globalThis.chrome;
  // Service worker d'un site web, ou page sans API d'extension : rien à faire.
  if (!c || !c.runtime || !c.runtime.id || c.__orbe) return;
  Object.defineProperty(c, '__orbe', { value: 1 });

  const manifest = c.runtime.getManifest();
  const strings = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
  const declared = new Set([...strings(manifest.permissions), ...strings(manifest.optional_permissions)]);
  // Seul ce qui se sérialise traverse : fonctions et valeurs exotiques tombent.
  const clean = (v) => { try { return JSON.parse(JSON.stringify(v)); } catch { return null; } };

  // chrome.runtime.lastError, pour les appels à l'ancienne (avec rappel).
  let lastError;
  try {
    const native = Object.getOwnPropertyDescriptor(c.runtime, 'lastError');
    if (!native || native.configurable) {
      let nativeValue = native && 'value' in native ? native.value : undefined;
      Object.defineProperty(c.runtime, 'lastError', {
        configurable: true,
        enumerable: true,
        get() { return lastError || (native && native.get ? native.get.call(c.runtime) : nativeValue); },
        set(v) { if (native && native.set) native.set.call(c.runtime, v); else nativeValue = v; },
      });
    }
  } catch {}

  const call = (name, args) => invoke(name, clean(args) || []).then((r) => {
    if (r && r.error) throw new Error(r.error);
    return r ? r.value : undefined;
  });

  // Une méthode d'API : promesse (Manifest V3) ou rappel en dernier argument.
  const method = (name) => function (...args) {
    const cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
    const p = call(name, args);
    if (!cb) return p;
    p.then((v) => { cb(v); }, (err) => {
      lastError = { message: String((err && err.message) || err) };
      try { cb(); } finally { lastError = undefined; }
    });
    return undefined;
  };

  // Événements : le processus principal n'envoie que ceux qui sont écoutés.
  const events = new Map();
  const event = (name) => {
    const set = new Set();
    events.set(name, set);
    return {
      addListener(fn) {
        if (typeof fn !== 'function' || set.has(fn)) return;
        set.add(fn);
        if (set.size === 1) invoke('_listen', [name, true]);
      },
      removeListener(fn) {
        if (set.delete(fn) && !set.size) invoke('_listen', [name, false]);
      },
      hasListener: (fn) => set.has(fn),
      hasListeners: () => set.size > 0,
    };
  };
  const fire = (name, args) => {
    const set = events.get(name);
    if (!set) return;
    for (const fn of [...set]) {
      try { fn(...args); } catch (err) { console.error(err); }
    }
  };

  // Rappels `onclick` des menus contextuels (Manifest V2) : ils restent ici.
  const menuClicks = new Map();
  let menuSeq = 0;

  listen((name, args) => {
    if (name === 'contextMenus.onClicked') {
      const fn = menuClicks.get(String(args[0] && args[0].menuItemId));
      if (fn) { try { fn(...args); } catch (err) { console.error(err); } }
    }
    fire(name, args);
  });

  // Ajoute méthodes, événements et constantes à un espace de noms, en gardant
  // ce qu'Electron fournit déjà et qui n'est pas redéfini ici.
  const define = (ns, { methods = [], events: evs = [], consts = {}, as = ns }) => {
    let target = c[ns];
    if (!target || typeof target !== 'object') {
      target = {};
      try { c[ns] = target; } catch {}
      if (c[ns] !== target) { try { Object.defineProperty(c, ns, { value: target, configurable: true, enumerable: true, writable: true }); } catch { return null; } }
    }
    const put = (key, value) => {
      try { Object.defineProperty(target, key, { value, configurable: true, enumerable: true, writable: true }); } catch { try { target[key] = value; } catch {} }
    };
    for (const m of methods) put(m, method(`${as}.${m}`));
    for (const e of evs) put(e, event(`${as}.${e}`));
    for (const k of Object.keys(consts)) put(k, consts[k]);
    return target;
  };

  define('permissions', { methods: ['contains', 'getAll', 'request', 'remove'], events: ['onAdded', 'onRemoved'] });

  define('tabs', {
    methods: ['query', 'get', 'getCurrent', 'create', 'remove', 'update', 'reload', 'duplicate', 'goBack', 'goForward', 'captureVisibleTab', 'detectLanguage'],
    events: ['onCreated', 'onRemoved', 'onUpdated', 'onActivated', 'onReplaced'],
    consts: { TAB_ID_NONE: -1 },
  });

  define('windows', {
    methods: ['get', 'getCurrent', 'getLastFocused', 'getAll', 'create', 'update', 'remove'],
    events: ['onCreated', 'onRemoved', 'onFocusChanged'],
    consts: { WINDOW_ID_NONE: -1, WINDOW_ID_CURRENT: -2, WindowType: { NORMAL: 'normal', POPUP: 'popup', PANEL: 'panel', APP: 'app', DEVTOOLS: 'devtools' } },
  });

  if (declared.has('cookies')) {
    define('cookies', { methods: ['get', 'getAll', 'set', 'remove', 'getAllCookieStores'], events: ['onChanged'] });
  }

  if (declared.has('contextMenus')) {
    const menus = define('contextMenus', { methods: ['update', 'remove', 'removeAll'], events: ['onClicked'], consts: { ACTION_MENU_TOP_LEVEL_LIMIT: 6 } });
    const remote = { remove: menus.remove, removeAll: menus.removeAll };
    // create() rend l'identifiant tout de suite, sans attendre le processus principal.
    menus.create = (props, cb) => {
      const p = { ...(props || {}) };
      if (p.id == null) p.id = `orbe-menu-${++menuSeq}`;
      if (typeof p.onclick === 'function') menuClicks.set(String(p.id), p.onclick);
      const done = call('contextMenus.create', [p]);
      if (typeof cb === 'function') {
        done.then(() => cb(), (err) => { lastError = { message: String(err.message) }; try { cb(); } finally { lastError = undefined; } });
      } else done.catch((err) => console.error(err));
      return p.id;
    };
    menus.remove = function (id, ...rest) { menuClicks.delete(String(id)); return remote.remove.call(this, id, ...rest); };
    menus.removeAll = function (...rest) { menuClicks.clear(); return remote.removeAll.apply(this, rest); };
  }

  if (declared.has('webNavigation')) {
    define('webNavigation', {
      methods: ['getFrame', 'getAllFrames'],
      events: ['onBeforeNavigate', 'onCommitted', 'onDOMContentLoaded', 'onCompleted', 'onErrorOccurred', 'onHistoryStateUpdated', 'onReferenceFragmentUpdated', 'onCreatedNavigationTarget', 'onTabReplaced'],
    });
  }

  if (declared.has('notifications')) {
    define('notifications', { methods: ['create', 'update', 'clear', 'getAll', 'getPermissionLevel'], events: ['onClicked', 'onClosed', 'onButtonClicked'] });
  }

  if (declared.has('downloads')) {
    define('downloads', { methods: ['download'], events: ['onChanged', 'onCreated'] });
  }

  if (declared.has('fontSettings')) define('fontSettings', { methods: ['getFontList'] });

  define('commands', { methods: ['getAll'], events: ['onCommand'] });

  // Bouton de l'extension : `action` (V3), `browserAction` / `pageAction` (V2).
  // L'état vit dans le processus principal, où Orbe le lit pour dessiner le bouton.
  const ACTION = ['setTitle', 'getTitle', 'setBadgeText', 'getBadgeText', 'setBadgeBackgroundColor', 'getBadgeBackgroundColor', 'setBadgeTextColor', 'getBadgeTextColor', 'setPopup', 'getPopup', 'enable', 'disable', 'isEnabled', 'openPopup', 'getUserSettings'];
  for (const ns of ['action', 'browserAction', 'pageAction']) {
    const key = ns === 'action' ? 'action' : ns === 'browserAction' ? 'browser_action' : 'page_action';
    if (!manifest[key] && !c[ns]) continue;
    const action = define(ns, { methods: ACTION, events: ['onClicked'], as: 'action' });
    if (ns === 'pageAction') { action.show = method('action.enable'); action.hide = method('action.disable'); }
    const setIcon = method('action.setIcon');
    // Une image fournie en pixels (ImageData) est réduite à un tableau simple.
    const pixels = (img) => (img && img.data && img.width ? { width: img.width, height: img.height, data: Array.from(img.data) } : null);
    action.setIcon = (details, cb) => {
      const d = { ...(details || {}) };
      if (d.imageData) {
        let img = d.imageData;
        if (!img.data) {
          const sizes = Object.keys(img).filter((k) => img[k] && img[k].data && img[k].width <= 128).sort((a, b) => Number(b) - Number(a));
          img = sizes.length ? img[sizes[0]] : null;
        }
        d.imageData = pixels(img);
      }
      return cb ? setIcon(d, cb) : setIcon(d);
    };
  }

  // chrome.storage.sync : Electron l'annonce mais le refuse (« not available
  // in this instance »). Orbe n'a pas de compte : `sync` devient une zone
  // locale à part, rangée dans `storage.local` sous un préfixe. `local` et
  // `onChanged` sont enveloppés pour que ce préfixe ne se voie pas.
  const storage = c.storage;
  if (storage && storage.local && typeof storage.local.get === 'function') {
    const PREFIX = '__orbe_sync__/';
    const native = storage.local;
    const nativeChanged = storage.onChanged;
    const isSync = (k) => k.startsWith(PREFIX);
    const withCallback = (fn) => function (...args) {
      const cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
      const p = fn(...args);
      if (!cb) return p;
      p.then((v) => { cb(v); }, (err) => {
        lastError = { message: String((err && err.message) || err) };
        try { cb(); } finally { lastError = undefined; }
      });
      return undefined;
    };
    const localEvent = () => {
      const set = new Set();
      return {
        set,
        api: { addListener(fn) { if (typeof fn === 'function') { set.add(fn); hook(); } }, removeListener(fn) { set.delete(fn); }, hasListener: (fn) => set.has(fn), hasListeners: () => set.size > 0 },
      };
    };
    const any = localEvent();
    const onLocal = localEvent();
    const onSync = localEvent();
    const run = (set, ...args) => { for (const fn of [...set]) { try { fn(...args); } catch (err) { console.error(err); } } };
    let hooked = false;
    // Un seul écouteur natif, posé au premier abonnement.
    function hook() {
      if (hooked || !nativeChanged) return;
      hooked = true;
      nativeChanged.addListener((changes, areaName) => {
        if (areaName !== 'local') { run(any.set, changes, areaName); return; }
        const local = {};
        const sync = {};
        for (const k of Object.keys(changes)) {
          if (isSync(k)) sync[k.slice(PREFIX.length)] = changes[k]; else local[k] = changes[k];
        }
        if (Object.keys(local).length) { run(any.set, local, 'local'); run(onLocal.set, local); }
        if (Object.keys(sync).length) { run(any.set, sync, 'sync'); run(onSync.set, sync); }
      });
    }
    const allOf = async (sync) => {
      const raw = await native.get(null);
      const out = {};
      for (const k of Object.keys(raw)) if (isSync(k) === sync) out[sync ? k.slice(PREFIX.length) : k] = raw[k];
      return out;
    };
    const syncArea = {
      get: withCallback(async (keys) => {
        if (keys == null) return allOf(true);
        const defaults = typeof keys === 'object' && !Array.isArray(keys) ? keys : null;
        const names = defaults ? Object.keys(defaults) : [].concat(keys);
        const raw = await native.get(names.map((k) => PREFIX + k));
        const out = {};
        for (const k of names) {
          if (Object.prototype.hasOwnProperty.call(raw, PREFIX + k)) out[k] = raw[PREFIX + k];
          else if (defaults && defaults[k] !== undefined) out[k] = defaults[k];
        }
        return out;
      }),
      set: withCallback(async (items) => {
        const raw = {};
        for (const k of Object.keys(items || {})) raw[PREFIX + k] = items[k];
        await native.set(raw);
      }),
      remove: withCallback(async (keys) => { await native.remove([].concat(keys).map((k) => PREFIX + k)); }),
      clear: withCallback(async () => { await native.remove(Object.keys(await allOf(true)).map((k) => PREFIX + k)); }),
      getKeys: withCallback(async () => Object.keys(await allOf(true))),
      getBytesInUse: withCallback(async (keys) => {
        const all = await allOf(true);
        const names = keys == null ? Object.keys(all) : [].concat(keys);
        return names.reduce((n, k) => n + (k in all ? k.length + JSON.stringify(all[k]).length : 0), 0);
      }),
      setAccessLevel: withCallback(async () => {}),
      onChanged: onSync.api,
      QUOTA_BYTES: 102400,
      QUOTA_BYTES_PER_ITEM: 8192,
      MAX_ITEMS: 512,
      MAX_WRITE_OPERATIONS_PER_HOUR: 1800,
      MAX_WRITE_OPERATIONS_PER_MINUTE: 120,
    };
    const localArea = {
      // Tout lire ou tout effacer ne doit pas toucher à la zone « sync ».
      get: function (...args) {
        const first = typeof args[0] === 'function' ? undefined : args[0];
        if (first != null) return native.get(...args);
        return withCallback(() => allOf(false))(...args.filter((x) => typeof x === 'function'));
      },
      set: (...args) => native.set(...args),
      remove: (...args) => native.remove(...args),
      clear: withCallback(async () => { await native.remove(Object.keys(await allOf(false))); }),
      getKeys: withCallback(async () => Object.keys(await allOf(false))),
      getBytesInUse: (...args) => native.getBytesInUse(...args),
      setAccessLevel: (...args) => native.setAccessLevel(...args),
      onChanged: onLocal.api,
      QUOTA_BYTES: native.QUOTA_BYTES || 10485760,
    };
    const put = (key, value) => {
      try { Object.defineProperty(storage, key, { value, configurable: true, enumerable: true, writable: true }); } catch { try { storage[key] = value; } catch {} }
      return storage[key] === value;
    };
    // Les trois ensemble, ou rien : sinon le préfixe deviendrait visible.
    if (put('sync', syncArea)) { put('local', localArea); put('onChanged', any.api); }
  }

  // Compléments à des espaces de noms qu'Electron fournit en partie.
  define('runtime', { methods: ['openOptionsPage'] });
  define('extension', { methods: ['isAllowedIncognitoAccess', 'isAllowedFileSchemeAccess'] });
}

if (inWorker || inExtensionPage) {
  try {
    contextBridge.executeInMainWorld({
      func: install,
      args: [
        (name, args) => ipcRenderer.invoke(CHANNEL, name, args),
        (fn) => { ipcRenderer.on(EVENT, (e, name, args) => fn(name, args)); },
      ],
    });
  } catch (err) {
    console.error('[orbe] API d’extension indisponibles :', err);
  }
}
