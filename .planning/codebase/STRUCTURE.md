---
last_mapped_commit: 365269253e39931240fee3dcc51fae6d4a664b87
last_mapped_at: 2026-10-24
---
# Codebase Structure

**Analysis Date:** 2026-10-24

## Directory Layout

```text
orbe/
├── src/
│   ├── main/             # Electron main process — 61 CommonJS modules
│   ├── preload/          # 6 sandboxed bridges (UI, passwords, extensions, media, panel, swipe)
│   ├── renderer/         # UI: 16 HTML pages, 24 scripts, CSS, sounds, textures, music
│   │   ├── musique/      # Welcome music (welcome.wav)
│   │   ├── sons/         # UI sounds (capture, close, error, pin, space, tab, unpin)
│   │   └── textures/     # Space background textures (grain, sand, tweed, denim)
│   └── shared/           # locales.js (fr + en)
├── scripts/              # Dev launcher, test launchers, packaging, assets, measurements (15 files)
├── tests/
│   ├── ui/               # Playwright suites, numbered NN-topic.js (42 files)
│   ├── fixtures/         # Bookmark import fixtures (Chrome/Firefox/Safari HTML, browsers JS)
│   ├── ext-fixture/      # Full Chrome extension fixture (manifest, SW, popup, options, panel)
│   ├── ext-fixture-sans/ # Minimal extension fixture
│   └── natif/            # Real-keyboard tests (Swift helpers ctrltab.swift, touche.swift)
├── assets/               # blocklist.txt, app icons (svg/png/icns/ico)
├── docs/                 # French design, security, platform and roadmap docs
│   ├── captures/         # README screenshots
│   └── suivi/            # Large tracking inventories (ameliorations.md, arc-inventaire.md)
├── .github/workflows/    # tests.yml — macOS/Windows CI, Windows packaging checks
├── .planning/            # GSD planning artifacts (not shipped)
├── package.json          # Scripts, app version, Electron versions
├── CLAUDE.md             # Project instructions for agents
├── README.md             # Product overview and commands
├── LICENSE               # MIT
└── .gitattributes        # LF everywhere; binaries marked
```

`.claude/` (GSD install) is gitignored and local-only. Electron itself is installed outside the repository in `~/.orbe-dev` by `scripts/dev.js`.

## Directory Purposes

**`src/main/`:**
- Purpose: all browser state, policy, windows, views, sessions, and privileged features.
- Contains: orchestration (`main.js`, `window.js`, `little.js`, `panes.js`), persistence (`store.js`, `backups.js`), platform (`platform.js`, `win-default.js`), security (`sheets.js`, `permissions.js`, `certs.js`, `auth.js`, `display-media.js`, `popups.js`, `unload.js`, `capture-state.js`), and feature modules.
- Key files:
  - `src/main/main.js` — entry point, module wiring, IPC router.
  - `src/main/window.js` — `OrbeWindow`, ~5 000 lines; the architectural hub.
  - `src/main/store.js` — persistent state, history, archive, downloads.
  - `src/main/sessions.js` — `orbe://` protocol and per-profile sessions.
  - `src/main/commands.js`, `menu.js`, `shortcuts.js` — action table, native menu, keybindings.
  - `src/main/essentials.js` — security/service hook wiring into `window.js`.
- Naming clusters: `ext-*.js` (extensions), `import-*.js` (browser imports), `make-*.js` lives under `scripts/`.

**`src/preload/`:**
- Purpose: narrow bridges into isolated renderer worlds.
- Contains:
  - `ui.js` — exposes `window.orbe` to `orbe://` pages; sync `i18n` boot, async `orbe` invoke, event allowlist.
  - `page.js` — password form observer/filler (profile sessions, isolated world).
  - `ext.js` — `chrome.*` compatibility shim for extension frames and service workers.
  - `media.js` — captures `navigator.mediaSession` action handlers.
  - `panel.js` — exposes `window.orbePanel` for the extension side-panel chrome.
  - `swipe.js` — reports unconsumed horizontal trackpad swipes from web pages.

**`src/renderer/`:**
- Purpose: all UI chrome and internal pages served under `orbe://app/`.
- Contains page/script pairs: `shell` (sidebar), `overlay` (floating modes), `settings`, `library`, `notes`, `easel`, `sheet`, `passwords`, `pw-overlay`, `boost`, `little`, `welcome`, `shortcuts`, `tasks`, `error`, `panel`.
- Shared scripts: `common.js` (i18n, escaping, shortcuts display), `theme.js` (shared theme model), `emojis.js`, `players.js` (mini players), `fx.js` (sidebar micro-animations), `import-ui.js` (import wizard), `libpeek.js`, `folderpeek.js`.
- Key files: `src/renderer/shell.js` (~2 000 lines), `src/renderer/overlay.js`, `src/renderer/base.css` (design tokens/springs).

**`src/shared/`:**
- Purpose: process-agnostic shared code.
- Contains: `src/shared/locales.js` — `fr` reference strings and `en` translations, dot-namespaced keys.

**`scripts/`:**
- Purpose: everything run from a terminal.
- Contains:
  - `dev.js` — installs/runs Electron from `~/.orbe-dev`, supervises test runs (`--selftest`).
  - `test-ui.js`, `test-ext.js` — Playwright and extension-API test launchers.
  - `build-mac.js`, `build-win.js`, `fuses.js`, `pe-resources.js`, `make-ico.js` — packaging and binary hardening (Electron fuses).
  - `make-icon.js`, `make-sounds.js`, `make-textures.js`, `make-springs.js` — generated assets.
  - `update-blocklist.js` — regenerates `assets/blocklist.txt`.
  - `mesures.js` — startup/memory/performance measurements; `suivi.js` — updates tracking docs; `diagnostic-win.ps1` — Windows hang diagnostics.

**`tests/`:**
- Purpose: verification against the real browser.
- Contains:
  - E2E scenarios in French (`barre.js`, `laterale.js`, `fenetres.js`, `securite.js`, …) orchestrated by `tests/selftest.js`; shared helpers in `tests/outils.js` and `tests/discret.js`.
  - Unit tests run with `node --test`: `adblock.test.js`, `extensions.test.js`, `pe-resources.test.js`.
  - Scenario entry points for packaged/special runs: `smoke.js`, `ext-api.js`, `ext-reelles.js`, `win-default.js`, `win-package.js`, `win-probe.js`, `mesures.js`.
  - `tests/ui/` — Playwright groups `NN-topic.js` (auto-discovered), with `harness.js`, `prelude.js`, `run.js`.
  - `tests/fixtures/` and `tests/ext-fixture*/` — deterministic input data.

**`assets/`:**
- Purpose: shipped binary/data assets.
- Contains: `blocklist.txt` (adblock domains), `icon.svg` (source), `icon.png`, `orbe.icns`, `orbe.ico`.

**`docs/`:**
- Purpose: design and threat-model documentation, in French.
- Contains: `securite-navigation.md` (authoritative security behavior), `mots-de-passe.md`, `extensions.md`, `windows.md`, `analyse-arc.md`, `bloqueur.md`, `etude-extensions-et-distribution.md`, `feuille-de-route.md`, `captures/`, `suivi/`.

## Key File Locations

**Entry Points:**
- `src/main/main.js`: application entry (declared as `main` in `package.json`).
- `scripts/dev.js`: dev/test launcher; installs Electron outside the repo and supervises `--selftest`.
- `tests/selftest.js`: E2E scenario orchestrator invoked from `src/main/main.js:529`.
- `tests/ui/run.js`: Playwright suite runner; discovers `tests/ui/NN-*.js`.
- `scripts/build-mac.js`, `scripts/build-win.js`: packaging entry points.

**Configuration:**
- `package.json`: scripts, product version, `orbe.electron` / `orbe.electronDrm` versions.
- `.github/workflows/tests.yml`: CI matrix and Windows packaging/registry assertions.
- `.gitattributes`: LF line endings for text, binary flags for images.
- `.gitignore`: `node_modules/`, `dist/`, `.claude/`, logs.
- No linter, formatter, TypeScript, or bundler config exists; conventions are enforced by review and tests.

**Core Logic:**
- `src/main/window.js`: window/tab/view model, layout, Peek, splits, state view-model.
- `src/main/store.js`: state schema, defaults, normalization, atomic persistence.
- `src/main/sessions.js`: profile sessions and internal protocol.
- `src/main/main.js`: composition root and IPC dispatcher.
- `src/renderer/shell.js`: sidebar rendering and gestures.
- `src/renderer/overlay.js`: every floating UI mode.

**Testing:**
- `tests/selftest.js` + scenario files: end-to-end behavior.
- `tests/ui/harness.js`: launches the real browser and exposes Orbe views to Playwright.
- `tests/outils.js`: waits, probes, skip handling, environment checks.
- `tests/discret.js`: invisible/non-focus-stealing test windows on macOS.
- `tests/fixtures/`, `tests/ext-fixture*/`: stable test inputs.

## Naming Conventions

**Files:**
- Main modules: lowercase, usually one French domain word (`veille.js`, `sheets.js`, `empreinte.js`, `prefs.js`, `panes.js`, `easels.js`), with conventional English names kept where standard (`window.js`, `store.js`, `sessions.js`, `commands.js`, `menu.js`, `platform.js`).
- Prefixed clusters: `ext-*.js` (extension subsystem), `import-*.js` (browser data import), `make-*.js` (asset generation), `test-*.js` (test-only support).
- Renderer: `<page>.html` + `<page>.js`; a dedicated stylesheet only when the surface needs one (`shell.css`, `settings.css`, `panel.css`, `easel.css`, `page.css`, `overlay.css`); shared scripts have descriptive names (`common.js`, `theme.js`, `emojis.js`, `players.js`, `fx.js`, `import-ui.js`, `libpeek.js`, `folderpeek.js`).
- Tests: scenario files named after the behavior, in French (`barre.js`, `laterale.js`, `fenetres.js`, `bibliotheque.js`, `sensations.js`); Node unit tests use `*.test.js`; UI suites use `NN-topic.js` (duplicate numbers such as `16-`, `22-`, `23-`, `24-` are intentional parallel groups).

**Functions:**
- camelCase verbs (`ensureView`, `sendState`, `openPeek`, `switchSpace`).
- Module-private helpers are plain functions without underscores (`wire`, `layout`, `remember`, `locate`).
- Classes/constructors PascalCase (`OrbeWindow`, `LittleWindow`, `Store`).

**Variables:**
- camelCase (`activeBySpace`, `sidebarVisible`, `peekState`).
- The per-tab runtime record is conventionally `rt`; the last renderer state is `S`.
- Module-level constants UPPER_SNAKE (`UI_PREFS`, `INTERNAL`, `SPARES`, `PEEK_PULL`, `QUIET_ACTIONS`).

**Types:**
- No TypeScript. Data shapes are validated in `store.normalize` and per-module validators.
- IDs: base64url strings from `uid()` (`src/main/store.js:15`); webContents ids are numbers.
- Sidebar tree nodes: `{ type: 'tab', id }` or `{ type: 'folder', id, name, icon?, open?, children }`.
- Tab records: `{ id, url, title, favicon, customTitle?, icon?, homeUrl?, internal?, createdAt, lastActiveAt }`.
- Space records: `{ id, name, icon, color, color2?, color3?, plain?, intensity?, grain?, texture?, mode?, profileId, pinned[], today[], splits[], splitDirs?, splitRatios?, hideHeader?, pinnedCollapsed? }`.

**Strings and namespaces:**
- IPC actions use either `namespace:verb` (`settings:get`, `ext:install`, `easel:save`, `lib:archive`, `dl:cancel`, `update:check`, `import:list`, `pw:...`) or camelCase window verbs (`activate`, `switchSpace`, `toggleSidebar`, `openCommand`).
- i18n keys are dot-namespaced by area (`menu.tabs`, `ext.badUrl`, `lib.emptyArchive`, `set.clearData`); add both `fr` and `en` in `src/shared/locales.js`.
- CSS classes and element IDs are kebab-case (`b-sidebar`, `url-copy`, `drop-line`, `off-view`).

**Style:**
- 2-space indentation, single quotes, semicolons, trailing commas in multiline literals/objects/arrays.
- Comments and user-facing strings in French; Electron/Web vocabulary stays English.
- Renderer scripts are classic scripts (no modules/imports), sharing globals deliberately (`common.js` defines `O`, `t`, `esc`; `shell.js` defines `send`, `S` used by `players.js`, `libpeek.js`, `folderpeek.js`).

## Where to Add New Code

**New main-process feature:**
- Create `src/main/<feature>.js`; export functions plus `hooks` and `configure()`/`setup()` if it needs dependencies.
- Wire it in `src/main/main.js` (composition section around lines 430-508) rather than requiring it from `window.js`.
- If it is per-session (request interception, permissions, downloads), attach it from `sessions.configure` (`src/main/sessions.js:76-100`).
- If it is window/tab behavior, add a method on `OrbeWindow` and a case in `handle` (`src/main/window.js:4893-4990`).

**New IPC namespace:**
- Add a prefix branch in `src/main/main.js:376-390` that delegates to your module's `action(name, payload, sender)`.
- Validate the sender/frame (the dispatcher already checks `trusted` and `INTERNAL`) and validate every payload field in the module.
- Use `ipcRenderer.invoke` via `O.send(action, payload)` from renderer; never expose raw `ipcRenderer`.

**New internal UI page:**
- Add `src/renderer/<page>.html` + `<page>.js` (plus `<page>.css` if needed) and load it via `orbe://app/<page>.html`.
- If it can be an app tab, add it to `INTERNAL_PAGES` (`src/main/window.js:127`) and ensure its tab record sets `internal: true`.
- If it is a transient overlay, prefer adding a mode to `src/renderer/overlay.js` and creating it through `makeUiView('overlay.html#<role>')` / the spare pool.

**New setting:**
- Add the default to `DEFAULT_SETTINGS` in `src/main/store.js:20-84`.
- Add a validator to `SETTABLE` in `src/main/main.js:161-183` (or `prefs.SETTABLE` for settings-window values).
- Add the control to `src/renderer/settings.html` and its key to `FIELDS` in `src/renderer/settings.js:4-5`; add profile-scoped keys to `prefs.PROFILE_KEYS` if needed.
- Add `fr` and `en` labels in `src/shared/locales.js`.

**New command / shortcut:**
- Add an entry to `COMMANDS` in `src/main/commands.js:18-200` with `name`, `label`, optional `accel`/`keys`, `palette`, `global`, and `run(w)`.
- Add it to the relevant group in `src/main/menu.js:50-256`; user overrides are handled automatically by `src/main/shortcuts.js`.

**New renderer surface behavior:**
- Sidebar: `src/renderer/shell.js` and `shell.css`; send new events through `O.send('verb', payload)`.
- Floating UI: `src/renderer/overlay.js` + `overlay.css`, with payload sent by `overlay` events.
- Shared helpers/i18n: `src/renderer/common.js`; theme calculations: `src/renderer/theme.js` (keep it DOM-free so main can require it).

**New extension API:**
- Implement in `src/main/ext-api.js`, extend with `api.extend` in `ext-more.js`/`ext-panel.js`/`ext-debug.js` where appropriate.
- Enforce manifest permissions and derive extension identity from the sender.
- If it needs tab/window mapping, extend `src/main/ext-host.js`; document behavior in `docs/extensions.md`.
- Tests: `tests/extensions.test.js` (unit), `tests/ext-api.js` (live browser), fixture in `tests/ext-fixture/`.

**New tests:**
- E2E scenario: `tests/<name>.js` taking `ctx` + `check`, then require it from `tests/selftest.js` in the appropriate section.
- Playwright UI test: add `tests/ui/NN-<name>.js`; it is auto-discovered by `tests/ui/run.js` (`/^\d\d-.*\.js$/`).
- Node unit test: `tests/<name>.test.js`, run with `node --test`.
- Stable inputs belong in `tests/fixtures/` or a new `tests/*-fixture/` directory.

**Shared strings and generated assets:**
- Strings: `src/shared/locales.js` (`fr` first, then `en`).
- Generated binaries: add or extend a `scripts/make-*.js` and write into `src/renderer/` or `assets/`; never hand-edit generated files.

## Special Directories

**`assets/`:**
- Purpose: shipped data and icons.
- Generated: `blocklist.txt` (via `scripts/update-blocklist.js`), `icon.png`/`orbe.icns`/`orbe.ico` (via `scripts/make-icon.js` and build scripts).
- Committed: yes.

**`src/renderer/sons/`, `src/renderer/textures/`, `src/renderer/musique/`:**
- Purpose: sound effects, space textures, welcome music.
- Generated: sounds and textures by `scripts/make-sounds.js` / `scripts/make-textures.js`; music file is committed.
- Committed: yes.

**`docs/suivi/`:**
- Purpose: long-running tracking inventories (feature gaps vs. Arc, improvement entries with IDs such as `BL-10`, `PERF-26`).
- Generated: partly, updated by `scripts/suivi.js`.
- Committed: yes.

**`.planning/`:**
- Purpose: GSD planning/mapping artifacts, including this document.
- Generated: by GSD commands.
- Committed: currently untracked; not part of the application bundle.

**`.claude/`:**
- Purpose: project-local GSD install and agent config.
- Generated: yes.
- Committed: no (gitignored).

**`~/.orbe-dev/` and `~/.orbe-dev-drm/`:**
- Purpose: Electron runtime, Playwright, and build output (`dist/Orbe.app`, `dist/Orbe/`, zip) kept outside the repo.
- Generated: yes.
- Committed: no.

**Browser userData (`~/Library/Application Support/Orbe` on macOS):**
- Purpose: `orbe.json` (state), `history.json`, `passwords.json`, `easels/`, `Extensions/`, `sauvegardes/`, `erreurs.log`, `Telechargements/` during tests.
- Generated: at runtime.
- Committed: no.

**`tests/natif/`:**
- Purpose: tests that take the real keyboard (Swift helpers + JS drivers).
- Generated: no.
- Committed: yes; run separately, not part of `npm test`.

---

*Structure analysis: 2026-10-24*
