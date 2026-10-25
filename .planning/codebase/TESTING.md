---
last_mapped_commit: 365269253e39931240fee3dcc51fae6d4a664b87
last_mapped_at: 2026-10-24
---
# Testing Patterns

**Analysis Date:** 2026-10-24

## Test Framework

There is no single test framework. The repository uses three complementary layers plus platform-specific helpers.

**1. `node:test` unit suites (pure logic, no Electron):**
- Runner: Node.js built-in test runner (`node:test`), Node 22 in CI.
- Files: `tests/adblock.test.js`, `tests/extensions.test.js`, `tests/pe-resources.test.js`.
- Assertions: `node:assert/strict` in `tests/adblock.test.js` and `tests/extensions.test.js`; `node:assert` with `strictEqual`/`deepStrictEqual` in `tests/pe-resources.test.js`.
- Run: `node --test tests/adblock.test.js` (or the other file).

**2. Custom end-to-end harness inside a real Electron process:**
- Runner: `tests/selftest.js` loaded by `src/main/main.js:528-529` when `--selftest` is passed, driven by `scripts/dev.js --selftest`.
- No framework and no assertion library: a `check(name, ok, detail)` callback performs assertions and prints `✓`/`✗`.
- Default suite: `tests/selftest.js`, which then calls the scenario modules `tests/barre.js`, `tests/laterale.js`, `tests/finitions.js`, `tests/finitions2.js`, `tests/creation-espace.js`, `tests/easels.js`, `tests/passwords.js`, `tests/essentiels.js`, `tests/fenetres.js`, `tests/reglages.js`, `tests/import-navigateurs.js`, `tests/import-arc-donnees.js`, `tests/accueil.js`, `tests/mises-a-jour.js`, `tests/performances.js`, `tests/commande.js`, `tests/bibliotheque.js`, `tests/medias.js`, `tests/details.js`, `tests/sensations.js`, `tests/derniers.js`, `tests/securite.js` (`tests/selftest.js:1160-1225`).
- A single scenario can be run alone with `ORBE_SCENARIO=tests/<file>.js`.

**3. Playwright UI suites (real mouse and keyboard):**
- Driver: `playwright-core`, installed into `~/.orbe-dev` by `scripts/test-ui.js:12-20`; no npm dependency in the repository.
- Runner: `tests/ui/run.js`, harness `tests/ui/harness.js`, per-group files `tests/ui/NN-french-name.js` (39 groups).
- Assertions: `node:assert/strict` inside `t.verifier(...)` callbacks.

**4. Specialized suites:**
- Extension API in the real browser: `scripts/test-ext.js` → `tests/ext-api.js` (bundled fixture, no network) or `tests/ext-reelles.js` with argument `reelles`.
- Native keyboard tests: `tests/natif/bascule.js` and `tests/natif/raccourcis.js`, which invoke Swift helpers compiled from `tests/natif/ctrltab.swift` and `tests/natif/touche.swift`.
- Windows packaging checks: `tests/win-package.js`, `tests/win-default.js`, `tests/win-probe.js`, `tests/pe-resources.test.js`.

**Tooling note:** `CLAUDE.md` says "utiliser vitest run". The repository has no Vitest dependency, configuration, or lockfile, and no test is written with Vitest. Use the commands below; do not add Vitest as part of test work unless the project explicitly migrates.

## Run Commands

```bash
npm test                                  # full end-to-end suite (node scripts/dev.js --selftest)
node tests/adblock.test.js                # ad-block unit suite (CI runs it this way)
node --test tests/extensions.test.js      # extension parsing/CRX unit suite
node --test tests/pe-resources.test.js    # Windows PE/fuses/registry unit suite
ORBE_SCENARIO=tests/securite.js node scripts/dev.js --selftest   # one E2E scenario
npm run test:ui                           # all Playwright UI groups
npm run test:ui -- glisser                # only groups whose name contains the filter
npm run test:ext                          # extension API, bundled fixture (tests/ext-api.js)
npm run test:ext reelles                  # real Chrome Web Store extensions
```

- `npm start` is `node scripts/dev.js`; it installs Electron on first run under `~/.orbe-dev`. The test commands trigger the same installation automatically.
- CI (`.github/workflows/tests.yml`) runs on `macos-latest` and `windows-latest`, Node 22, 25-minute timeout, on every push: `node tests/adblock.test.js`, `node --test tests/extensions.test.js`, `node scripts/dev.js --selftest`, `node scripts/test-ext.js`, then Windows-only packaging, smoke, and registry checks.
- Never run a watch-mode runner; the suites are one-shot processes and CI assumes they terminate.

## Test File Organization

**Location:**
- Flat `tests/` for E2E scenarios and unit suites; `tests/ui/` for Playwright groups; `tests/fixtures/` for import fixtures (browser profile builders and bookmark HTML); `tests/ext-fixture/` and `tests/ext-fixture-sans/` for unpacked test extensions; `tests/natif/` for Swift helpers.
- Shared E2E helpers: `tests/outils.js` (`sleep`, `until`, `milieu`, `ignorer`, `profilPret`).
- Shared UI helpers: `tests/ui/harness.js` (`lancer`, `ctx.ouvrir`, `ctx.clic`, `ctx.glisser`, `ctx.menu`, `ctx.etat`, …), `tests/ui/prelude.js` (loaded into the main process via Electron `-r`).

**Naming:**
- Unit suites: `*.test.js`.
- E2E scenarios: French noun after the behavior area (`barre.js`, `laterale.js`, `securite.js`).
- UI groups: `NN-french-name.js`, ordered and executed alphabetically by `tests/ui/run.js:107-109`. Numbers are not unique (`16-apercu.js` and `16-selection.js` both exist); the order is still deterministic because of the full-name sort.
- Test descriptions are full French sentences describing user-visible behavior, often naming the shortcut or gesture: `'⌘D épingle l’onglet'`, `'le × n’apparaît qu’au survol de la ligne'`, `'bloque un domaine listé et ses sous-domaines, vus depuis un autre site'`.

**Structure:**
- E2E scenario module: exports `async function <nom>Tests(ctx)`, receives `{ first: w, check, ...modules }` from `tests/selftest.js`, and prints its own `check` lines.
- UI group module: exports `{ nom: 'Onglets', async test(ctx, t) { ... } }`.
- Unit suite: top-level `test(...)` calls, shared setup in `beforeEach`, cleanup in `test.after`.

## Test Structure

**`node:test` suite pattern (`tests/adblock.test.js:3-14`):**

```js
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const adblock = require('../src/main/adblock');
const { shouldBlock, hostOf, registrableDomain } = adblock;

beforeEach(() => {
  adblock.configure({ enabled: true, allowlist: [], onChange: null, onCount: null });
  adblock.setDomains(['pub.test', 'traceur.co.uk', 'stats.journal.fr']);
});

test('hostOf : extrait l\'hôte des URL http(s) et ws(s) seulement', () => {
  assert.equal(hostOf('https://Ads.Pub.TEST/x.js?a=1'), 'ads.pub.test');
  ...
});
```

- Cleanup with `test.after(...)`: `tests/extensions.test.js:133`.
- Conditional skip via the options object: `{ skip: 'electron.exe absent (voir ORBE_PE_SAMPLE)' }` (`tests/pe-resources.test.js:22-23`).

**E2E scenario pattern (`tests/laterale.js:1-51`, `tests/selftest.js:53-61`):**

```js
// Comment: what the scenario covers and how to run it alone.
const { sleep, until } = require('./outils');

module.exports = async function lateraleTests(ctx) {
  const { first: w, check } = ctx;
  const a = w.newTab(base + '/a');
  await until(() => titleOf(a.id) === 'Page A', 'titre de la page A');
  check('nouvel onglet chargé et actif', w.activeId === a.id && win.live.has(a.id));
};
```

- `check(name, ok, detail)` records the result, increments the failure counter when false, and prints a single diagnostic line (`tests/selftest.js:58-62`).
- Scenarios use the public `OrbeWindow` API (`newTab`, `run`, `move`, `suggest`, `openCommand`) and inspect the real store; they avoid reaching into private fields where a public method exists.

**Playwright UI group pattern (`tests/ui/02-onglets.js:1-30`):**

```js
const assert = require('node:assert/strict');

module.exports = {
  nom: 'Onglets',
  async test(ctx, t) {
    const { shell, jusqua } = ctx;
    await ctx.ouvrir('/a', 'Page A');
    await t.verifier('les nouveaux onglets s’empilent en haut d’Aujourd’hui, le dernier est actif', async () => {
      assert.deepEqual(await ctx.titres(), ['Page C', 'Page B', 'Page A']);
      assert.equal(await actif(), 'Page C');
    });
  },
};
```

- `t.verifier(name, fn)` is a normal check: a failure fails the suite, captures the sidebar state and a screenshot (`tests/ui/run.js:56-70`).
- `t.bogue(name, fn)` marks a known application defect: failure is expected and counted as a known bug; a pass is reported as "BOGUE corrigé ?" and must be converted to `verifier` when the bug is fixed (`tests/ui/run.js:71-83`).
- `t.ignorer(name, raison)` and `t.avecEcran(mode, name, fn)` / `t.avecFocus(mode, name, fn)` skip checks with an explicit reason and count them (`tests/ui/run.js:85-100`).

## Mocking

**Framework:** None. Fakes are hand-written, small, and local to the test.

**Patterns:**
- Fake Electron session and tab (`tests/adblock.test.js:120-141`):
  ```js
  function fakeSession() {
    const ses = { calls: 0, listener: null };
    ses.webRequest = { onBeforeRequest: (filter, fn) => { ses.calls += 1; ses.listener = fn === undefined ? filter : fn; } };
    ses.request = (details) => { let out; ses.listener({ resourceType: 'script', referrer: '', ...details }, (r) => { out = r; }); return !!out.cancel; };
    return ses;
  }
  ```
  `fakeTab(id, url)` supplies `isDestroyed`, `getURL`, `on`, `once`.
- Local HTTP servers instead of the network: `http.createServer` bound to `127.0.0.1:0` with page routes and hit counters (`tests/ui/harness.js:38-72`, `tests/selftest.js:13-51`, `tests/laterale.js:20-40`).
- Temporary profiles and directories: `fs.mkdtempSync(path.join(os.tmpdir(), 'orbe-ui-'))` (`tests/ui/harness.js:79`); `ORBE_USER_DATA` overrides the Electron profile (`src/main/main.js:70-72`); download directory redirected under the temp profile (`src/main/main.js:90-92`).
- No real keychain: `--use-mock-keychain` (`tests/ui/harness.js:86`, `src/main/main.js:82`).
- No real devices or dialogs: fake media stream (`src/main/main.js:86`), `src/main/test-guard.js` refuses every native dialog and records the request.
- No network for suggestions or dependencies: `store.state.settings.suggestions = false` at harness startup (`tests/ui/harness.js:464`); the extension fixture is served locally.
- Binary formats are built in-test rather than checked in: ZIP/CRX3 assembled with `zlib` and `crypto` (`tests/extensions.test.js:15-80`), PE resources generated by `scripts/pe-resources.js` and checked in `tests/pe-resources.test.js`.
- Deterministic UI conditions are injected through environment variables: `ORBE_UI_CPU` (CPU throttling), `ORBE_UI_ARGS`, animation playback rate via CDP (`tests/ui/harness.js:415-428`), `ORBE_UI_FOCUS`, `ORBE_UI_ECRAN`, `ORBE_UI_DETAIL`, `ORBE_UI_SHOTS`, `ORBE_TEST_VISIBLE`.

**What to Mock:**
- External binaries, sessions, filesystem locations, network endpoints, native dialogs, keychain, and media devices.
- Anything whose real state would make a test non-deterministic on CI or touch the developer's machine.

**What NOT to Mock:**
- Electron itself, the main process, window management, IPC, browser tabs, or the renderer in E2E/UI tests. Those suites run the real application; isolation comes from a temporary profile and blocked network, not from stubs.
- The module under test in a unit suite: only its collaborators are faked (e.g., the session passed to `adblock.attach`).

## Fixtures and Factories

**Test Data:**
- Browser profile factories: `tests/fixtures/navigateurs.js` creates Chrome/Firefox/Safari-style profiles in a temp directory; `tests/fixtures/signets-{chrome,firefox,safari}.html` are bookmark exports.
- Unpacked extensions: `tests/ext-fixture/` (service worker, content script, popup, panel, options) and `tests/ext-fixture-sans/` (extension without certain APIs).
- Local pages are generated in `serve()` factories per scenario; they include deliberately slow (`/lent`, `/relent`), wide (`/large`), login (`/connexion`), audio/video (`/son`, `/video`), and downloadable (`/file.txt`) pages.
- Generated assets used by tests and the app: `scripts/make-sounds.js`, `scripts/make-textures.js`, `scripts/make-springs.js`, `scripts/make-ico.js`, `scripts/make-icon.js`.

**Location:**
- `tests/fixtures/`, `tests/ext-fixture/`, `tests/ext-fixture-sans/`, `assets/`, and `~/.orbe-dev` for the Electron/Playwright runtimes.

**Factories in the UI harness:**
- `ctx.ouvrir(chemin, titre)` opens a local page through the real command bar (`tests/ui/harness.js:310-317`).
- `ctx.creerEspace(nom)` opens the space creation panel and types the name (`tests/ui/harness.js:277-282`).
- `ctx.ligne(titre, zone)`, `ctx.titres(zone)`, `ctx.etat()` query the real state (`tests/ui/harness.js:157-184`, `287-291`).

## Coverage

**Requirements:** None enforced. There is no coverage tool, no coverage configuration, and no threshold in CI.

**View Coverage:** Not available. The project reports the number of checks instead:
- `README.md:118-120` states 1,500+ end-to-end checks, 504 UI checks, and 175 extension checks.
- The UI runner prints a final count of passed/failed/known-bug/skipped checks and exits non-zero on failure (`tests/ui/run.js:150-158`).
- CI runs the complete suites on macOS and Windows; Windows-only steps cover packaging, fuses, version metadata, and default-browser registration.

## Test Types

**Unit Tests:**
- Scope: pure logic with no Electron dependency.
- `tests/adblock.test.js` covers host parsing, registrable-domain approximation, allowlists, listener attachment, counters, and loading the real 20,000+ domain blocklist from `assets/blocklist.txt`.
- `tests/extensions.test.js` covers CRX3/manifest parsing, ZIP validation, and extension installation rules without network access.
- `tests/pe-resources.test.js` covers Windows PE resources, Electron fuses, icon decoding, and registry association generation; real-binary checks are skipped when `electron.exe` is unavailable.

**Integration / End-to-End Tests:**
- Scope: the real Electron app booted through `src/main/main.js` with `--selftest`, a temporary profile, and a local HTTP server.
- Assertions combine the main-process API (`w.newTab`, `win.live`, `store.state`) with DOM reads in the renderer (`w.ui.webContents.executeJavaScript`).
- Scenarios cover tabs, spaces, folders, command bar, settings, passwords, extensions, imports (Arc and other browsers), media, security, performance, and update flows.

**UI Tests:**
- Scope: the real Electron app driven by Playwright with real mouse and keyboard events, plus CDP for CPU throttling, animation rate, and drag interception (`tests/ui/harness.js:385-428`).
- The harness verifies that a click reaches the intended native view (`ctx.vueAu`), waits for elements to be stable, and uses the native application menu for accelerators (`ctx.menu`).

**Native Tests:**
- Scope: real system keystrokes, used for shortcuts that cannot be triggered through Playwright (`⌃Tab`, global shortcuts).
- Require compiling the Swift helper first; see the header of `tests/natif/bascule.js` for the exact commands.

**Windows-Packaging Tests:**
- Run only on Windows in CI: `node scripts/build-win.js --icon`, smoke test of the packaged `Orbe.exe`, `node tests/win-package.js`, PowerShell verification of version metadata, and registry checks for default-browser registration (`tests/win-default.js` driven by `ORBE_WIN_DEFAULT_STEP`).

## Common Patterns

**Async Testing:**
- Poll with an explicit label and timeout; never use a bare delay as the only synchronization:
  ```js
  await until(() => titleOf(a.id) === 'Page A', 'titre de la page A');            // tests/outils.js
  await jusqua(async () => (await actif()) === 'Page A', 'ligne A active');       // tests/ui/harness.js
  ```
  `until` (E2E) defaults to 8 s and `jusqua` (UI) to 6 s; polling intervals are 40-50 ms.
- Bound any promise that could hang:
  ```js
  const { delai } = require('./harness');
  await delai(Promise.resolve().then(fn), 40000, 'vérification');
  ```
  (`tests/ui/run.js:48-54`, `tests/ui/harness.js:18-22`.)
- `sleep(ms)` is used only for short settling after an awaited event.

**Error Testing:**
- `assert.throws(() => fuses.fuseStates(buf), /RunAsNode encore actif/)` (`tests/pe-resources.test.js`).
- Invalid inputs are asserted to return safe values rather than throw: `hostOf(null)` returns `''` (`tests/adblock.test.js:26-28`).
- Timeouts throw `Error('Délai dépassé : ' + label)`; the message is expected to name the missing condition.

**Failure Diagnostics:**
- E2E: `src/main/test-guard.js` tracks the last check, pending waits, unanswered `executeJavaScript` calls, dialog requests, and uncaught exceptions. `ORBE_TEST_LIMIT` (default 480 s) and `ORBE_TEST_STALL` (default 150 s) bound the run. `scripts/dev.js:41-110` watches a heartbeat file written by the main process and dumps a native stack sample (`sample` on macOS, PowerShell on Windows) if the main thread freezes.
- UI: on failure, `constater()` records the sidebar state (rows, selection, body classes, running animations) and screenshots the shell (`tests/ui/run.js:23-41`); `ORBE_UI_SHOTS` selects the output directory; the full main-process journal is written next to the captures for a failed group (`tests/ui/run.js:137-144`).
- Screenshots can also be produced for the E2E suite via `ORBE_SHOTS` (`tests/selftest.js:66-72`, `tests/smoke.js`).

**Known Bugs and Skips:**
- Prefix a check with `t.bogue(...)` for a defect in `src/`; remove the marker when the check starts passing. Do not hide real failures with `t.bogue`.
- Use `t.ignorer(...)`/`t.avecEcran(...)`/`t.avecFocus(...)` for environment-dependent checks (locked screen, missing focus permission). Every skip must carry a reason and is counted in the final report.
- In `tests/outils.js`, `ignorer(nom, raison)` records skips for the E2E summary.

---

*Testing analysis: 2026-10-24*
