---
last_mapped_commit: 365269253e39931240fee3dcc51fae6d4a664b87
last_mapped_at: 2026-10-24
---
<!-- refreshed: 2026-10-24 -->

# Architecture

**Analysis Date:** 2026-10-24

## System Overview

Orbe is an Electron browser with a sidebar-first shell, built without a framework, bundler, or build step. The main process owns all state and policy; the renderer is a projection of that state; every web tab is a `WebContentsView` positioned by the main process.

```text
┌──────────────────────────────────────────────────────────────────────┐
│  UI renderer — Chromium, orbe://app/* pages, sandboxed                │
│  shell.js (sidebar) · overlay.js (command bar/find/toast/peek)        │
│  settings · library · notes · easel · sheet · passwords · panel       │
│  `src/renderer/`                                                      │
├──────────────────────────────────────────────────────────────────────┤
│  Preload bridges — isolated worlds, explicit allowlists               │
│  ui.js (window.orbe) · page.js (passwords) · ext.js (chrome.*)        │
│  media.js · panel.js · swipe.js                                       │
│  `src/preload/`                                                       │
├──────────────────────────────────────────────────────────────────────┤
│  Electron main process — Node, single thread                          │
│  main.js (bootstrap + IPC router + wiring)                            │
│    └── window.js (OrbeWindow hub: tabs, views, layout, state push)    │
│          ├── persistence: store.js, backups.js                        │
│          ├── sessions.js → Chromium sessions per profile              │
│          ├── security: sheets, permissions, certs, auth, popups…      │
│          └── features: extensions*, boosts, passwords, easels, media… │
│  `src/main/` (61 modules)                                             │
├──────────────────────────────────────────────────────────────────────┤
│  Chromium sessions                                                    │
│  persist:orbe (default) · persist:orbe-<profileId> · incognito-*      │
│  defaultSession = UI only (no web permissions)                        │
├──────────────────────────────────────────────────────────────────────┤
│  Persistence — app.getPath('userData')                                │
│  orbe.json · history.json · passwords.json · easels/ · Extensions/    │
│  sauvegardes/ · erreurs.log                                           │
└──────────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| App bootstrap | `app.whenReady`, single-instance lock, protocol registration, module wiring, IPC router, first window | `src/main/main.js` |
| Window hub | `OrbeWindow`: tabs, `WebContentsView` lifecycle, splits, Peek, sidebar layout, state view-model | `src/main/window.js` |
| State store | Single JSON state, debounced atomic writes, history file, archive, downloads, settings defaults | `src/main/store.js` |
| Sessions | `orbe://` protocol, per-profile Chromium sessions, user-agent cleanup, per-session service attach | `src/main/sessions.js` |
| Commands | Canonical action table (menu, palette, shortcuts) with accelerators and labels | `src/main/commands.js` |
| Native menu | Menu bar and Dock menu, rebuilt only when labels change | `src/main/menu.js` |
| Shortcut mapping | User overrides over command defaults, accelerator parsing/display | `src/main/shortcuts.js` |
| Settings | Validation of settable values, profile-scoped overrides, link routing rules, dev mode | `src/main/prefs.js`, `src/main/panes.js` |
| UI bridge | `window.orbe` (`send`, `on`, locales, keys, platform) — UI pages only | `src/preload/ui.js` |
| Sidebar UI | Full-state render with per-row reconciliation, drag/drop, space paging, rename, downloads, players | `src/renderer/shell.js` |
| Floating UI | Command bar, tab switcher, theme editor, find bar, toasts, Peek chrome, status, drop zone, swipe | `src/renderer/overlay.js` |
| Security services | Sheets, permissions, display media, certs, HTTP auth, popups, unload guard | `src/main/essentials.js` + peers |
| Extensions | CRX install/verify, `chrome.*` compatibility, host model, side panel, debugger, UI | `src/main/extensions.js`, `ext-api.js`, `ext-host.js`, `ext-panel.js`, `ext-more.js`, `ext-debug.js`, `ext-ui.js`, `ext-access.js` |
| Persistence extras | Local snapshots/restore, easel documents, password vault, history import | `src/main/backups.js`, `easels.js`, `passwords.js`, `import-*.js` |
| Platform abstraction | Window chrome, shortcuts notation, paths, default-browser registration | `src/main/platform.js`, `win-default.js` |
| Shared i18n | French reference strings and English translations | `src/shared/locales.js` |
| Shared theme engine | DOM-free theme model/validation/palette used by main and renderer | `src/renderer/theme.js` |

## Pattern Overview

**Overall:** Electron hub-and-spoke with dependency-injected service modules, a single authoritative store, and full-state push with incremental renderer reconciliation.

**Key Characteristics:**
- One state owner: only the main process mutates `store.state` (`src/main/store.js`); the renderer never writes state directly.
- Services are plain modules that expose functions plus a mutable `hooks` object and a `configure({...})`/`setup({...})` function; `main.js` injects dependencies (`src/main/main.js:430-508`).
- IPC is action-based: `ipcRenderer.invoke('orbe', action, payload)` → validated sender → prefix routing → handler (`src/main/main.js:371-391`).
- Every tab is a `WebContentsView` created lazily and tracked in a module-level `live` Map (`src/main/window.js:67-70`, `1046-1083`).
- UI views are sandboxed with `contextIsolation`, no Node integration, and no `<webview>` (`src/main/window.js:39-42`, `551-554`).
- No transpilation, no npm dependencies: Electron is installed outside the repo in `~/.orbe-dev` (`scripts/dev.js`).
- French is the source language for code identifiers' domain vocabulary, comments, and user-facing strings.

## Layers

**Main process (`src/main/`):**
- Purpose: owns browser state, policy, windows, views, persistence, and all privileged operations.
- Location: `src/main/`
- Contains: 61 CommonJS modules: orchestration (`main.js`, `window.js`, `little.js`, `panes.js`), services (`sessions.js`, `store.js`, `sheets.js`, …), platform code.
- Depends on: Electron APIs, Node core, `src/shared/locales.js`, `src/renderer/theme.js`.
- Used by: preload/renderer exclusively through IPC.

**Preload (`src/preload/`):**
- Purpose: minimal, auditable bridges between isolated renderer worlds and main.
- Location: `src/preload/`
- Contains: `ui.js` (UI pages), `page.js` (password form observer, registered per profile session), `ext.js` (extension API shim), `media.js`, `panel.js`, `swipe.js`.
- Depends on: `electron` (`contextBridge`, `ipcRenderer`, `webFrame`).
- Used by: UI views (`UI_PRELOAD` in `src/main/window.js:34`) or registered via `session.registerPreloadScript` (`src/main/passwords.js:1079`, `src/main/ext-api.js:1046-1047`, `src/main/media.js:273`, `src/main/swipe.js:146`).

**Renderer UI (`src/renderer/`):**
- Purpose: all user-visible chrome and internal pages.
- Location: `src/renderer/`
- Contains: 16 HTML pages, 24 scripts, shared CSS (`base.css`, `shell.css`, `overlay.css`, `settings.css`, `panel.css`, `page.css`, `easel.css`), sounds and textures.
- Depends on: `window.orbe` bridge only (plus `window.orbePanel` in `panel.html`).
- Used by: `OrbeWindow.makeUiView`, sheets, settings window, password manager, Boost editor, internal tabs.

**Shared (`src/shared/`):**
- Purpose: code used by both processes without DOM/Node assumptions.
- Location: `src/shared/locales.js` (i18n table), `src/renderer/theme.js` (also required by `src/main/window.js:13`).

**Tooling (`scripts/`):**
- Purpose: development launcher, test launchers, packaging, asset generation, measurements.
- Location: `scripts/`
- Key files: `dev.js`, `test-ui.js`, `test-ext.js`, `build-mac.js`, `build-win.js`, `fuses.js`, `make-*.js`, `mesures.js`, `update-blocklist.js`.

**Tests (`tests/`):**
- Purpose: end-to-end scenarios in the real app, Playwright UI tests, extension API tests, Node unit tests.
- Location: `tests/`, `tests/ui/`, `tests/fixtures/`, `tests/ext-fixture*/`, `tests/natif/`.

## Data Flow

### Primary Request Path (sidebar click → state update → repaint)

1. Sidebar DOM handler sends an action: `send('activate', id)` (`src/renderer/shell.js:743`).
2. `window.orbe.send` invokes IPC: `ipcRenderer.invoke('orbe', action, payload)` (`src/preload/ui.js:16`).
3. Main validates sender trust and frame URL (`trusted.has(e.sender) && senderFrame.url.startsWith(INTERNAL)`) and routes by prefix or to the owning window (`src/main/main.js:372-390`).
4. `OrbeWindow.handle` switches on the action name (`src/main/window.js:4893-4990`); `activate` updates `activeBySpace`, calls `ensureView`, lays out views, focuses content, and calls `changed()` (`src/main/window.js:1516-1552`).
5. `changed()` delegates to `OrbeWindow.pushAll`, which coalesces a burst of changes into one `setImmediate` pass (`src/main/window.js:341-349`, `760-766`).
6. `sendState` builds the view-model (spaces, favorites, pinned tree, today, nav, extensions, panes, players, downloads) and sends `'state'` to the shell (`src/main/window.js:4739-4875`).
7. `shell.js` `onState` → `render(s)` reconciles only changed rows and reuses unchanged DOM nodes (`src/renderer/shell.js:319`, `1169-1193`, `84-120`).
8. Persisted mutations call `store.save()` (debounced 1.5 s, lazy 8 s) and write atomically via temp file + rename (`src/main/store.js:205-228`).

### Startup Path

1. `scripts/dev.js` installs/locates Electron in `~/.orbe-dev` and spawns it with `src/main/main.js` as `package.json` `main`.
2. Before `ready`: `sessions.registerScheme()` registers `orbe:` and `chrome-extension:` as privileged (`src/main/sessions.js:23-32`); test-only switches and userData isolation are applied (`src/main/main.js:70-93`).
3. `app.whenReady`: load state (`store.load`), migrate routing rules, start backups, configure extensions/API/host, `essentials.setup`, adblock, default session, IPC (`src/main/main.js:416-449`).
4. Hooks are wired to feature modules (`commands.hooks`, `win.hooks`, `passwords.configure`, `updates.configure`, etc. — `src/main/main.js:451-507`).
5. Menu is built, first `OrbeWindow` is constructed (shell view first, tab views later), pending URLs are opened (`src/main/main.js:509-514`).
6. History is warmed after 400 ms; stale-tab archive and sleep sweeps are scheduled (`src/main/main.js:516-523`).

### Tab View Lifecycle

1. A tab record lives in `store.state.tabs[id]` and in an ordered list (`space.today`, `space.pinned` tree, or `favs[profileId]`) — see `locate`/`orderedIds` (`src/main/window.js:720-739`).
2. `ensureView(id)` creates or re-adopts the `WebContentsView`: picks the profile session, sets `UI_PRELOAD` only for `tab.internal === true`, and attaches all `webContents` listeners in `wire()` (`src/main/window.js:1046-1083`, `1085-1305`).
3. Only visible tabs (plus Peek) are attached to the window; `layout()` adds/removes child views and positions them (`src/main/window.js:888-938`).
4. Sleep destroys the view but keeps the tab row (`src/main/veille.js`, `OrbeWindow.sweep`); wake re-runs `ensureView` and restores navigation history if reopened (`src/main/window.js:1076-1080`).
5. Close archives to `store.state.archive` (unless incognito/blank) and keeps an in-memory closed stack for ⇧⌘T/⌘Z (`src/main/window.js:1641-1713`, `store.js:367-375`).

### Link Routing and Peek

1. `setWindowOpenHandler` and `will-navigate` inspect device-provided link data, never page-provided claims (`src/main/window.js:1127-1139`, `1253-1305`).
2. Destinations resolve in order: external-link routing rule (`prefs.routeFor`), meeting URL bypass, little window, target space, current window (`src/main/main.js:100-129`, `src/main/prefs.js:42-89`).
3. Links leaving a pinned tab/favorite or Shift-click open a Peek overlay view instead of a new tab (`OrbeWindow.openPeek`, `src/main/window.js:3307-3470`).

### Profile / Session Flow

1. Each profile maps to a persistent partition `persist:orbe[-<id>]`; incognito maps to an ephemeral partition (`src/main/sessions.js:103-118`).
2. `configure()` attaches adblock, permissions, display media, certs, downloads, swipe, media, and (persistent only) extension API/loading (`src/main/sessions.js:76-100`).
3. The default session is UI-only and denies all web permission requests (`src/main/sessions.js:120-124`).
4. A window uses `sessions.mainSession()` unless incognito; a tab uses the session of its owning space's profile (`src/main/window.js:710-714`).

### Extension API Flow

1. Extension frames get `src/preload/ext.js`, which funnels `chrome.*` calls to `ipcMain` (`src/main/ext-api.js:1026`).
2. Main resolves extension identity from the sender, never from payload claims, and exposes `tabs`, `windows`, `cookies`, `permissions`, `contextMenus`, `action`, `webNavigation`, etc. (`src/main/ext-api.js`).
3. `ext-host.js` maps Orbe tabs/windows to Chrome equivalents and emits tab events; `ext-panel.js` hosts `chrome.sidePanel` as a right-side view; `ext-debug.js` gates `chrome.debugger` to real tabs.

### Password Flow

1. `src/preload/page.js` runs in an isolated world on profile sessions and only reports focus/submit and fills the chosen account.
2. Main derives frame origin from Electron (`senderFrame`), stores the vault encrypted with `safeStorage`, and opens UI in Orbe views (`pw-overlay.html` or `passwords.html`) — never in page DOM (`src/main/passwords.js`).

**State Management:**
- Authority: `store.state` (spaces, tabs, favs, archive, profiles, settings, permissions, boosts, notes, downloads, updates).
- History is a separate lazily loaded `history.json` with cap 8 000 (`src/main/store.js:104-116`, `240-284`).
- Incognito and blank windows hold their own detached `data` object instead of `store.state` (`src/main/window.js:355-363`).
- Shared windows all reference the same state object; only one persistent window records bounds/space (`src/main/window.js:644-653`).
- The renderer holds only the last received view-model `S` and pending local interactions (drag, rename, selection).

## Key Abstractions

**`OrbeWindow`:**
- Purpose: one native window with one shell view, its content views, overlays, and undo history.
- Examples: `src/main/window.js:323-4992`; auxiliary `LittleWindow` in `src/main/little.js`.
- Pattern: large cohesive class; registries `windows` and `live` at module scope; hooks for services.

**View runtime (`rt`):**
- Purpose: pairs a tab id with its `WebContentsView`, `webContents`, owner, loading/lastUsed state, and runtime-only flags.
- Examples: `live` Map (`src/main/window.js:68`), `wire()` listener installation (`1085-1305`).
- Pattern: tab metadata persisted; heavy view state ephemeral and reconstructed.

**`hooks` + `configure`/`setup`:**
- Purpose: break dependency cycles and let `main.js` own composition.
- Examples: `win.hooks` (`src/main/window.js:90-105`), `sessions.hooks` (`src/main/sessions.js:19`), `passwords.configure` (`src/main/main.js:457`), `essentials.setup` (`src/main/essentials.js:176-266`).
- Pattern: modules export defaults (no-op hooks) so they can be required before wiring; `main.js` replaces them at startup.

**Trust boundary:**
- Purpose: only Orbe UI pages may call privileged IPC.
- Examples: `trusted` WeakSet, `INTERNAL = 'orbe://app/'`, `UI_PREFS` (`src/main/window.js:34-42`, `69`), `tab.internal` boolean set at creation, not inferred from URL (`src/main/window.js:1063-1065`; `src/main/store.js:154-155`).
- Pattern: sender check plus frame URL prefix; page content never decides privileges.

**Sheets:**
- Purpose: Orbe-owned overlays stacked per tab for permissions, screen share, HTTP auth, certificate warnings, crash/hang.
- Examples: `src/main/sheets.js:137-207`, `src/renderer/sheet.js`.
- Pattern: one view per sheet, bounded stack, result promise, message sender identified by view id.

**Spare UI views:**
- Purpose: pre-create auxiliary overlay views in the shell's renderer process to cut per-view process cost.
- Examples: `SPARES = 3`, `adoptSpare`, `fillSpares`, `makeUiView` (`src/main/window.js:485-570`).
- Pattern: shell `window.open`s only URLs registered in `wanted`; privileged views bypass this path and keep their own process.

**Command table:**
- Purpose: single definition of user actions, accelerators, labels, palette visibility.
- Examples: `COMMANDS` in `src/main/commands.js:18-200`; consumed by `menu.js`, `shortcuts.js`, `window.commandList`.
- Pattern: entries `{ name, label, accel?, keys?, palette?, global?, run(w) }`.

**Internal pages:**
- Purpose: Orbe UI served over a custom scheme instead of remote/dev-server content.
- Examples: `orbe://app/shell.html`, `overlay.html`, `settings.html`, `library.html`, `sheet.html`, `pw-overlay.html`, `panel.html`.
- Pattern: `protocol.handle('orbe', serveInternal)` serves `src/renderer` from memory with traversal protection (`src/main/sessions.js:55-67`); `INTERNAL_PAGES` decides which may open as tabs (`src/main/window.js:127`).

## Entry Points

**Application entry:**
- Location: `src/main/main.js` (declared in `package.json` `main`)
- Triggers: `npm start` → `scripts/dev.js`; packaged app launch; `open-url`, `open-file`, `continue-activity`, second-instance.
- Responsibilities: lifecycle, security switches, module wiring, IPC router, first window, test scenario runner.

**Test entry (E2E):**
- Location: invoked via `scripts/dev.js --selftest`; scenario `tests/selftest.js` orchestrated from `src/main/main.js:525-541`.
- Triggers: `npm test`, `ORBE_SCENARIO=...`; `scripts/test-ext.js` for extension scenarios.
- Responsibilities: drive real app, assert behavior, fail on uncaught exceptions or unanswered native dialogs.

**Test entry (UI):**
- Location: `scripts/test-ui.js` → `tests/ui/run.js`; each `tests/ui/NN-*.js` starts a fresh browser via `tests/ui/harness.js`.
- Triggers: `npm run test:ui`.

**Build entry:**
- Location: `scripts/build-mac.js`, `scripts/build-win.js`
- Triggers: `npm run build`, `npm run build:win`; CI `.github/workflows/tests.yml` on macOS and Windows.
- Outputs: `~/.orbe-dev/dist/Orbe.app` or `Orbe/Orbe.exe` + zip (outside the repo).

## Architectural Constraints

- **Threading:** All orchestration runs on the single Node main thread; expensive work must be deferred, incremental, or moved to a `WebContentsView`. The renderer UI is a separate process.
- **Global state:** `store` singleton (`src/main/store.js`), `windows`, `live`, `trusted`, `wcOwner`, `spareSeq` (`src/main/window.js:67-72`), extension registries (`ext-api.js`, `ext-host.js`, `ext-panel.js`), password vault state (`passwords.js`). Treat these as single-owner main-process registries.
- **Circular imports:** `window.js` is imported by `little.js`, `menu.js`, `imports.js`, extension modules and others. Break cycles with the `hooks` seam or a lazy `require('./window')` inside a function (`src/main/commands.js:479-486`, `src/main/ext-panel.js:31-32`, `src/main/extra` patterns).
- **Window and view lifecycle:** a tab view belongs to exactly one window at a time; `ensureView` re-parents it and updates the previous owner's layout (`src/main/window.js:1046-1060`). Anything deferred must check `gone`/`isDestroyed()`.
- **IPC surface:** only `i18n` uses `sendSync` (bootstrap); everything else is `invoke`/`send`. New IPC must be validated in main and routed through an existing namespace or `OrbeWindow.handle`.
- **Security defaults:** sandbox, context isolation, no Node in renderers, no `<webview>`, navigation guards on UI views, `http(s)`-only for page-supplied URLs, text-only rendering of page data.
- **No build step:** source files ship as-is; do not add TypeScript, JSX, or bundler-only syntax. CommonJS in main/preload; plain classic scripts in renderer.
- **Platform code:** platform differences belong in `src/main/platform.js`; callers do not branch on `process.platform` except where a feature is inherently OS-specific (Dock menu, PowerShell diagnostics).

## Anti-Patterns

### Creating tab views outside `ensureView`

**What happens:** Instantiating `new WebContentsView` for a tab directly in a feature module.
**Why it's wrong:** It bypasses profile session selection, internal-page preload rules, listener wiring, the `live` registry, and re-parenting; the tab becomes invisible to sleep, capture, split, and extension APIs.
**Do this instead:** Add the tab through `createTab`/`newTab` and let `ensureView` create the view (`src/main/window.js:1046-1083`).

### Requiring `./window` at module top level from a window dependency

**What happens:** A module that `window.js` already requires also requires `window.js` eagerly, producing a partially initialized export.
**Why it's wrong:** It breaks at startup depending on require order and makes hooks injection ineffective.
**Do this instead:** Export `hooks`/`configure`, inject in `main.js`, or lazy-require inside the function (`src/main/commands.js:479-486`, `src/main/imports.js:349-350`).

### Mutating `store.state` silently

**What happens:** Changing tabs/spaces/settings without `store.save()` or without pushing state to windows.
**Why it's wrong:** The change is lost on restart or the sidebar shows stale data; multiple windows diverge.
**Do this instead:** Mutate through `OrbeWindow` methods or modules that call `store.save()` and `OrbeWindow.pushAll()` (e.g. `changed()`, `src/main/window.js:760-766`).

### Trusting renderer or page payloads

**What happens:** Using an action payload as a path, URL, origin, or HTML without validation.
**Why it's wrong:** Renderer content can be influenced by page text; privileged operations must derive identity from Electron.
**Do this instead:** Validate against closed lists/tables in main (`SETTABLE` in `src/main/main.js:161-183`, `prefs.js`), resolve IDs from state, and render text with `textContent`/`esc`.

### Adding timers or listeners tied to a window without cleanup

**What happens:** Scheduling `setTimeout`/`setInterval` or attaching `webContents` listeners owned by a window that can close.
**Why it's wrong:** Callbacks then touch a destroyed window ("Object has been destroyed"), a recurring class of bug documented in `dispose()` and `gone`.
**Do this instead:** Check `this.gone`/`isDestroyed()` at callback start and clear timers in `dispose()` (`src/main/window.js:1026-1045`, `686-688`).

### Creating a fresh auxiliary view for every overlay

**What happens:** Loading `overlay.html` in a new `WebContentsView` for each toast/menu/peek chrome.
**Why it's wrong:** Each view costs a renderer process and startup latency; the shell deliberately keeps a reserve.
**Do this instead:** Use `makeUiView('overlay.html#<role>')` and the spare pool (`src/main/window.js:485-570`), or extend an existing overlay mode in `src/renderer/overlay.js`.

## Error Handling

**Strategy:** Fail soft in the main process, keep the browser usable, and make failures diagnosable; in tests, fail loudly.

**Patterns:**
- Uncaught main-process exceptions are logged to console and `userData/erreurs.log`, then execution continues; in selftest they fail the run (`src/main/main.js:55-68`, `525-541`).
- Commands are wrapped in `try/catch` and log `[orbe] commande …` (`src/main/commands.js:498-509`).
- Page failures load an Orbe error page (`error.html`), while certificate failures open an Orbe warning sheet (`src/main/window.js:1240-1249`, `src/main/certs.js`).
- Page crash/hang/unload produce sheets with explicit choices (`src/main/essentials.js:231-251`, `unload.js`).
- Test guard forbids unanswered native dialogs and aborts stalled scenarios with a state dump (`src/main/test-guard.js`, `src/main/main.js:75-93`, `scripts/dev.js`).
- Promise rejections from Electron APIs are generally caught and logged where the result matters; background failures are not allowed to escape.

## Cross-Cutting Concerns

**Logging:** `console.error('[orbe] …')` in main; diagnostics are user-triggered via trace (`src/main/trace.js`) and test-guard. No logger dependency.
**Validation:** Central settings table (`SETTABLE`), state normalization and orphan repair (`store.normalize`), per-module allowlists (URLs, selectors, file names, origins).
**Authentication:** No Orbe account. Per-profile Chromium sessions isolate cookies; site permissions are origin-scoped and stored per profile; passwords use OS `safeStorage`.
**Internationalization:** `src/shared/locales.js` (`fr` reference, `en` fallback) consumed via `store.t()` in main and `t()` in `src/renderer/common.js`; new keys must be added to both.
**Motion and sound:** Centralized durations and reduced-motion handling in `src/main/motion.js`; sounds are inferred from state diffs after gestures (`src/main/sounds.js`).
**Security documentation:** `docs/securite-navigation.md` is the authoritative threat-model/behavior reference for security-sensitive modules.

---

*Architecture analysis: 2026-10-24*
