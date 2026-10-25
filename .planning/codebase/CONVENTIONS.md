---
last_mapped_commit: 365269253e39931240fee3dcc51fae6d4a664b87
last_mapped_at: 2026-10-24
---
# Coding Conventions

**Analysis Date:** 2026-10-24

## Language and Runtime

- Plain JavaScript (CommonJS), HTML and CSS. No TypeScript, no JSX, no bundler, no framework, and no compilation step (`README.md`, "Organisation du code").
- Runtime is Electron `44.7.0` (or `44.5.1+wvcus` for DRM), installed outside the repository in `~/.orbe-dev` by `scripts/dev.js`. `package.json` declares no dependencies.
- Node.js 24 is used locally; CI pins Node 22 (`.github/workflows/tests.yml`).
- Four source layers: `src/main/` (Electron main process), `src/preload/` (context bridge), `src/renderer/` (UI pages), `src/shared/locales.js` (French/English strings).
- Code comments, UI text, test names and commit messages are in French. Identifiers are predominantly English in runtime code, French in test harness code and scenario files. Follow the language of the file you are editing.

## Naming Patterns

**Files:**
- Lowercase kebab-case or single word: `src/main/import-arc.js`, `src/main/page-color.js`, `src/main/win-default.js`, `src/renderer/common.js`.
- Feature modules are named after the concept they own: `src/main/adblock.js`, `src/main/passwords.js`, `src/main/downloads.js`, `src/main/shortcuts.js`.
- A few modules use the French domain term: `src/main/veille.js` (sleep), `src/main/empreinte.js` (fingerprint). Keep the existing name when extending them.
- Renderer pages ship as a trio with the same basename: `src/renderer/shell.js`, `shell.html`, `shell.css`; `settings.*`, `overlay.*`, `easel.*`. Small scripts that only decorate another page have a `.js` file alone (e.g., `src/renderer/fx.js`, `src/renderer/theme.js`).
- Tests: scenario files use French descriptive nouns (`tests/laterale.js`, `tests/securite.js`, `tests/mises-a-jour.js`); `node:test` suites end in `.test.js`; UI groups are numbered `NN-french-name.js` in `tests/ui/`.
- Build/generator scripts: `scripts/build-mac.js`, `scripts/build-win.js`, `scripts/make-ico.js`, `scripts/test-ui.js`, `scripts/test-ext.js`.

**Functions:**
- `lowerCamelCase`, verb-first for actions: `shouldBlock`, `registrableDomain`, `openUrl`, `resetTab`, `place`, `boundsOf` (`src/main/adblock.js`, `src/main/motion.js`).
- Named `function` declarations for module logic and anything hoisted; `const fn = (...) => ...` for short helpers and callbacks (`src/main/commands.js:16`, `src/renderer/shell.js:15-16`).
- Test harness helpers are French: `jusqua`, `delai`, `lancer`, `servir`, `constater`, `verrouillee` (`tests/ui/harness.js`, `tests/outils.js`).
- Boolean predicates read as assertions: `isEnabled`, `isSiteAllowed`, `inFlight`, `arretInattendu`, `commandeOuverte`.

**Variables:**
- `lowerCamelCase`. Domain state gets descriptive names (`sidebarWidth`, `maxLiveTabs`, `blockedByTab`, `historyFile`).
- Short locals (`w`, `wc`, `rt`, `el`, `n`, `i`) are accepted in tight rendering or event code and in test helpers; use them only when the scope is a few lines.
- Module-level constants are `UPPER_SNAKE_CASE`: `HISTORY_MAX`, `ARCHIVE_MAX`, `DEFAULT_SETTINGS` (`src/main/store.js:9-84`), `FILTER`, `CANCEL`, `NOTIFY_MS` (`src/main/adblock.js:24-28`), `MOTION` (`src/main/motion.js:6`).
- Module-level mutable singleton state is `lowerCamelCase`: `flights`, `watched`, `allow`, `domains` (`src/main/adblock.js:30-46`, `src/main/motion.js:24-25`).

**Types:**
- No type annotations, no JSDoc types, no `.d.ts`. Shapes are documented in French comments.
- `class` is reserved for stateful objects with behavior: `Store` (`src/main/store.js:86`), `OrbeWindow` (`src/main/window.js:323`), `LittleWindow` (`src/main/little.js:77`). Everything else is a plain object or closure.
- Use `Map`, `Set`, `WeakMap`, `WeakSet` for caches and registries (`src/main/adblock.js:39-46`, `src/main/motion.js:24-25`).

## Code Style

**Formatting:**
- 2-space indentation; tabs are not used anywhere in `src/`.
- Semicolons are always used.
- Single quotes for strings; template literals for interpolation (`${...}`) and multi-line HTML fragments.
- Spaces inside object braces (`{ name: 'x' }`); `} else {` on the same line.
- Single-line guard bodies are common and accepted: `if (!f) return;`, `try { ... } catch {}`.
- No maximum line length is enforced. Long single-line expressions are used deliberately in hot paths (`src/main/adblock.js`, `src/main/window.js`). Prefer the neighboring file's density over reformatting.

**Linting:**
- No committed linter or formatter configuration: no `.eslintrc*`, `eslint.config.*`, `.prettierrc*`, `.editorconfig`, `biome.json`, or `tsconfig.json` at the repository root.
- Sparse inline suppressions exist and must be preserved when touching those lines: `// eslint-disable-next-line no-eval` (`tests/ui/harness.js:150`), `no-control-regex` (`src/main/updates.js:94`, `src/main/import-bookmarks.js:28`, `src/main/boosts.js:109`), `no-unused-vars` (`src/main/icons.js:24`), `no-undef` in UI tests (`tests/ui/22-themes.js:303`).
- Match the style of the file you edit. Do not introduce a formatter config as part of an unrelated change.

**CSS:**
- Shared tokens live in `:root` in `src/renderer/base.css` as `--kebab-case` custom properties (`--accent`, `--fg`, `--dim`, `--line`, `--spring-snappy`).
- Dark mode is driven by `prefers-color-scheme` plus `html[data-scheme]` overrides (`src/renderer/base.css`).
- Class names are lowercase with hyphens (`.row`, `.row.tab`, `.act.x`, `.addr-host`); state is expressed as extra classes (`active`, `sel`, `out`, `shown`, `live`, `audible`, `changed`) and on `document.body` (`no-tab`, `dragging`).

**HTML:**
- Lowercase tags and attributes; viewport/CSP meta tags in each page head (`src/renderer/shell.html`).
- Localization is declared in markup via `data-t` (text), `data-t-title`, `data-t-tip`, `data-t-ph`, and `data-key` for shortcut labels; `applyI18n()` in `src/renderer/common.js:26-34` fills them.
- UI keys use `area.camelCaseKey` (`app.about`, `side.empty`, `import.syncDetail`) with French as the reference locale and English fallback in `src/shared/locales.js`; placeholders are `{n}`.

## Import Organization

**Order:**
1. Electron: `const { app, ipcMain, ... } = require('electron');`
2. Node built-ins: `path`, `fs`, `os`, `crypto`, `child_process`, `url`.
3. Shared modules: `require('../shared/locales')`.
4. Local main-process modules: `require('./store')`, `require('./window')`, … one per line.

Reference examples: `src/main/main.js:1-32`, `src/main/adblock.js:21-22`, `src/main/commands.js:5-8`.

**Path Aliases:**
- None. Use relative paths only (`./`, `../`).
- Lazy `require()` inside a function is used to break circular dependencies: `require('./window')` inside `src/main/trace.js:23`, `require('./capture')` inside `tests/selftest.js:71`.

**Renderer and Preload:**
- Renderer pages never touch Node or Electron APIs directly. They use the `window.orbe` bridge exposed by `src/preload/ui.js` (aliased `const O = window.orbe` in `src/renderer/common.js:2`).
- The preload validates the page origin (`location.protocol === 'orbe:'`) and whitelists forwarded events before exposing them (`src/preload/ui.js:4-27`).
- Shared renderer helpers (`t`, `esc`, `host`, `applyI18n`, `faviconEl`, …) are globals defined in `src/renderer/common.js` and loaded before page scripts; do not duplicate them in page files.

## Error Handling

**Patterns:**
- Best-effort operations use an empty catch: `try { ... } catch {}`. This is deliberate — 152 occurrences in `src/main/`. Examples: reading a missing backup file (`src/main/store.js:97-101`), probing Electron animation options (`src/main/motion.js:17`), removing a temp file (`scripts/dev.js:105`).
- Unexpected failures that matter are logged with a context string and the message, then execution continues:
  ```js
  try { onChange({ enabled, allowlist: [...allow].sort() }); } catch (err) { console.error('[orbe] adblock onChange', err); }
  ```
  (`src/main/adblock.js:319`; same style in `src/main/display-media.js:39`, `src/main/downloads.js:533`.)
- `throw new Error('...')` is used for invalid state and for test assertions/timeouts: 42 occurrences in `src/main/`, e.g., `src/main/main.js:51-53` refusing `--selftest` on a packaged app.
- No custom error classes, no Result types.
- The main process installs `process.on('uncaughtException')` and writes the stack to `erreurs.log` in the userData directory instead of letting Electron open a blocking native dialog (`src/main/main.js:61-68`).
- In test mode, `src/main/test-guard.js` replaces every native dialog function with a refusing stub; a scenario that requests a dialog without preparing an answer fails and is reported.
- Guard against destroyed Electron objects before use (`isDestroyed()`, `rt.wc.isDestroyed()` in `src/main/window.js`; `try { ... } catch {}` around `getBounds` in `src/main/motion.js:35`).

## Logging

**Framework:** `console`, no logging library.

**Patterns:**
- Application errors use `console.error` with the `[orbe]` prefix and a short French context: `[orbe] partage d’écran`, `[orbe] corbeille`, `[orbe] adblock onCount` (`src/main/display-media.js`, `src/main/downloads.js`, `src/main/adblock.js`).
- `console.log` is reserved for scripts, benchmarks and tests (4 occurrences in `src/main/`, generally diagnostics). Do not add `console.log` to runtime paths.
- User-facing feedback goes through the localization layer and toasts (`w.toast(t('...'))`), never through console output.
- Diagnostic traces are opt-in: `src/main/trace.js` records Chromium traces with explicit privacy guardrails; `src/main/test-guard.js` records stalls and dialog requests only in test mode.

## Comments

**When to Comment:**
- Comments are dense, in French, and explain *why* and what was measured, not *what* the line does. See `src/main/motion.js:56-77` (observed Electron animation behavior), `src/main/store.js:102-116` (why history lives in its own file), `src/main/adblock.js:1-20` (module contract and the single-listener constraint).
- Module headers start with a one-to-four-line summary of the module's responsibility.
- Section dividers use `// --- Titre ---...` padded with dashes to roughly the 78th column: `src/main/adblock.js:48`, `src/main/motion.js`, `tests/ui/harness.js:37`, `src/renderer/shell.js:18`.
- Inline comments after a branch explain edge cases: `// point final`, `// identifiants@` (`src/main/adblock.js:69-77`).

**JSDoc/TSDoc:**
- Not used. Do not introduce JSDoc blocks; follow the existing prose style.
- Backticks and symbol names are written directly in comments (`onChange({ enabled, allowlist })`).

## Function Design

**Size:** Small helpers are preferred; long functions exist in UI code by necessity (`src/renderer/shell.js`, `src/main/window.js`). Split out pure logic so it can be tested with `node:test` (the pattern that made `shouldBlock`/`hostOf` testable in `src/main/adblock.js`).

**Parameters:**
- Use an options object with defaults when a function has more than two optional knobs: `configure(opts = {})` (`src/main/adblock.js`), `place(view, rect, ms = 0, easing = 'ease-out')` (`src/main/motion.js:78`), `glisser(de, vers, { pause = 120, avantLacher = null } = {})` (`tests/ui/harness.js:325`).
- Inject dependencies explicitly for testability: the Electron session is passed to `adblock.attach(session)`; `src/main/display-media.js` takes an `env` object; test scenarios receive a `ctx`.
- Environment-dependent behavior is switched with `ORBE_*` environment variables, never hardcoded test branches in production logic.

**Return Values:**
- Return early for impossible or empty cases (`if (!f) return null;`).
- Async functions use `async`/`await`; callback-style Electron APIs are wrapped in promises where a promise reads better.
- Modules that maintain state expose small query helpers rather than returning the internal object (`stats()`, `info()`, `state: () => ({...})` in `src/main/adblock.js`, `src/main/boost-editor.js`).

## Module Design

**Exports:**
- CommonJS only. `module.exports = { ... }` at the bottom of each file (60 occurrences in `src/main/`), listing public functions in call order or grouped by purpose.
- Testing seams are exported deliberately and labeled in a comment: `internals` (`src/main/auth.js:120`), `hooks`, `state`, `loadSync`, `setDomains` (`src/main/adblock.js:372-378`).
- Classes are exported as named properties (`OrbeWindow`, `store`), not as default exports.

**Barrel Files:**
- None. Import the specific module path.

**Singleton and Hooks Pattern:**
- Feature modules keep private module-level state and expose `setup`/`install`/`configure`/`attach`; `src/main/main.js` wires them once.
- Cross-module callbacks use a `hooks` object of no-op defaults, replaced by `main.js`, to avoid circular imports:
  ```js
  const hooks = { newWindow: () => {}, newLittle: () => {}, openSettings: () => {}, ... };
  ```
  (`src/main/commands.js:14`, `src/main/trace.js:23`, `src/main/boosts.js`, `src/main/passwords.js`.)
- When a direct dependency is unavoidable and circular, require it lazily inside the function (`src/main/trace.js:23`).

**Prescriptive Rules for New Code:**
- Put main-process features in `src/main/<feature>.js`; wire them from `src/main/main.js` and expose actions through `src/main/commands.js`.
- Put renderer pages in `src/renderer/` with matching `.html`/`.css`; add UI strings to `src/shared/locales.js` under a new `area.key` and mark elements with `data-t`.
- Keep new pure logic free of Electron imports so it can be covered by `node --test` (see `src/main/adblock.js:19-20`).
- Use French comments and French test descriptions, English identifiers, 2-space indentation, single quotes, and `[orbe]`-prefixed `console.error` for unexpected failures.

---

*Convention analysis: 2026-10-24*
