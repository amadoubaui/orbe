---
last_mapped_commit: 365269253e39931240fee3dcc51fae6d4a664b87
last_mapped_at: 2026-10-24
---
# Technology Stack

**Analysis Date:** 2026-10-24

## Languages

**Primary:**
- JavaScript (ES2022, CommonJS `require`/`module.exports`) - all application code in `src/main/`, `src/preload/`, `src/renderer/`, `src/shared/`, plus `scripts/` and `tests/`
- HTML5 - renderer surfaces (`src/renderer/*.html`): shell, command bar overlay, settings, library, notes, easels, password manager, welcome
- CSS3 - plain stylesheets (`src/renderer/*.css`): `base.css`, `shell.css`, `overlay.css`, `panel.css`, `settings.css`, `page.css`, `easel.css`

**Secondary:**
- Swift (CoreGraphics) - real-keyboard test helpers only (`tests/natif/touche.swift`, `tests/natif/ctrltab.swift`)
- Bash / PowerShell - CI steps in `.github/workflows/tests.yml` and Windows diagnostics in `scripts/diagnostic-win.ps1`
- No TypeScript, no JSX, no CSS preprocessor

## Runtime

**Environment:**
- Electron 44.7.0 (Chromium 152, bundled Node.js) - declared in `package.json` under `orbe.electron`; main entry `src/main/main.js`
- Node.js 20+ required to run from source (README); CI uses Node 22 (`.github/workflows/tests.yml`)
- Optional DRM engine: castlabs Electron 44.5.1+wvcus (`package.json` `orbe.electronDrm`), selected with `ORBE_DRM=1`

**Package Manager:**
- npm, invoked by hand-written scripts
- Lockfile: missing (no `package-lock.json`, `yarn.lock`, or `pnpm-lock.yaml`)
- No `dependencies` or `devDependencies` in `package.json`; Electron and Playwright are installed outside the repository into `~/.orbe-dev` (or `~/.orbe-dev-drm`) by `scripts/dev.js` and `scripts/test-ui.js`

## Frameworks

**Core:**
- Electron 44.7.0 - desktop shell, Chromium sessions, `BaseWindow` + `WebContentsView` architecture (`src/main/window.js`), `orbe://` privileged protocol (`src/main/sessions.js`)
- No UI framework: the renderer is hand-written DOM code with classic `<script src="...">` tags; no React/Vue/Svelte, no bundler, no transpilation
- Inter-process pattern: `ipcMain.handle('orbe', ...)` dispatcher (`src/main/main.js`) + `contextBridge.exposeInMainWorld('orbe', ...)` (`src/preload/ui.js`)

**Testing:**
- Node.js built-in test runner (`node:test` + `node:assert/strict`) for unit tests: `tests/adblock.test.js`, `tests/extensions.test.js`, `tests/pe-resources.test.js`
- Custom end-to-end harness: `tests/selftest.js` run by `node scripts/dev.js --selftest` through `scripts/dev.js` (`supervise`, heartbeat watchdog `src/main/test-guard.js`)
- Playwright Core for UI tests, installed ad hoc in `~/.orbe-dev`, driven by `scripts/test-ui.js` / `tests/ui/run.js` / `tests/ui/harness.js`
- Extension API tests: `scripts/test-ext.js`, scenarios `tests/ext-api.js` and `tests/ext-reelles.js`
- Native keyboard tests: compiled Swift helpers (`tests/natif/`)
- No Vitest/Jest configuration exists in the repository despite the project instruction mentioning `vitest run`

**Build/Dev:**
- Bespoke, dependency-free build scripts: `scripts/build-mac.js`, `scripts/build-win.js`
- Electron fuses are patched by `scripts/fuses.js` (disables `RunAsNode`, `NODE_OPTIONS`, `--inspect`)
- Windows PE icon/version resources are edited by hand-written `scripts/pe-resources.js`
- Asset generators: `scripts/make-icon.js` (SVG -> PNG via an offscreen Electron window), `scripts/make-ico.js`, `scripts/make-sounds.js` (WAV), `scripts/make-textures.js` (PNG), `scripts/make-springs.js`
- macOS system tools: `ditto`, `sips`, `iconutil`, `codesign --sign -` (ad hoc), `xattr`, `plutil`
- Windows system tools: `reg.exe` (browser registration), `tar.exe` (zip archive), PowerShell

## Key Dependencies

**Critical:**
- Electron 44.7.0 - entire application runtime; no application code runs without it
- Chromium 152 (embedded) - page engine, sessions, cookies, downloads, certificates, extensions
- castlabs `electron-releases#v44.5.1+wvcus` - optional Widevine-capable engine, installed from GitHub via npm when `ORBE_DRM=1`

**Infrastructure:**
- `playwright-core` - installed at test time only, never shipped (`scripts/test-ui.js`)
- Node.js standard library only in production code (`fs`, `path`, `crypto`, `http` in tests); no third-party runtime libraries
- System binaries used at runtime: `/usr/bin/sqlite3`, `/usr/bin/security`, `/usr/bin/xattr` (macOS); `reg.exe`, `taskkill` (Windows)

## Configuration

**Environment:**
- No `.env` files and no `.env*` present
- Runtime settings are persisted in `orbe.json` / `history.json` under `app.getPath('userData')` (`src/main/store.js`); defaults in `DEFAULT_SETTINGS` (`src/main/store.js:20`)
- Environment variables are for development, testing and packaging, not for production secrets. Key ones:
  - `ORBE_USER_DATA` - isolate the user-data directory
  - `ORBE_DRM`, `ORBE_EVS` - Widevine engine and castlabs VMP signing
  - `ORBE_RUNTIME` - override the `~/.orbe-dev` runtime directory
  - `ORBE_SCENARIO`, `ORBE_TEST_*`, `ORBE_SHOTS`, `ORBE_NETLOG` - test scenarios, watchdog, screenshots, Chromium netlog
  - `ORBE_NO_UPDATE_CHECK`, `ORBE_NO_WELCOME`, `ORBE_NO_MATERIAL` - runtime opt-outs
  - `ORBE_UI_*`, `ORBE_BENCH_*` - UI tests and benchmarks
  - `ORBE_WIN_DIST`, `ORBE_WIN_ARCH`, `ORBE_PE_SAMPLE` - cross-platform Windows packaging and PE tests

**Build:**
- `package.json` - scripts `start`, `test`, `test:ui`, `test:ext`, `build`, `build:win`; Electron versions under the `orbe` key
- `scripts/build-mac.js` - copies `Electron.app`, renames the binary to `Orbe`, embeds `src/`, `package.json`, `assets/blocklist.txt`, writes `Info.plist` keys (URL schemes, Handoff, camera/mic/location usage), cuts fuses, signs ad hoc; output `~/.orbe-dev/dist/Orbe.app`
- `scripts/build-win.js` - copies the Windows Electron distribution, renames `electron.exe` to `Orbe.exe`, embeds app files, cuts fuses, patches PE icon/version info, writes a zip `Orbe-<version>-windows-<arch>.zip`
- `scripts/fuses.js` - fuse table patching and verification
- `.github/workflows/tests.yml` - CI definition (see INTEGRATIONS.md)
- `assets/blocklist.txt` - generated by `scripts/update-blocklist.js`, committed, ~24,000 domains
- No `tsconfig.json`, ESLint, Prettier, Biome, or bundler config

## Platform Requirements

**Development:**
- Node.js 20+ and npm
- macOS or Windows for full test coverage; UI tests assume macOS paths (`tests/ui/harness.js` uses `Electron.app/Contents/MacOS/Electron`)
- Electron runtime downloaded on first `npm start` into `~/.orbe-dev`; Playwright Core downloaded on first `npm run test:ui`
- macOS native keyboard tests require `swiftc` and the `Touch`/Accessibility permissions (`tests/natif/`)
- Windows packaging requires Windows (or a pre-extracted Windows engine via `ORBE_WIN_DIST`)

**Production:**
- Desktop application, not a web service; no server, database, or container
- Shipped targets: macOS arm64 (`Orbe-<version>-mac-arm64.zip`) and Windows x64 (`Orbe-<version>-windows-x64.zip`), matching names expected by `src/main/updates.js:86`
- Unsigned builds: ad hoc signature on macOS (Gatekeeper confirmation), no signature on Windows (SmartScreen warning)
- Linux code paths exist in `src/main/platform.js` and `src/main/import-browsers.js`, but no Linux build script or release asset
- Version 0.15.5, MIT license

---

*Stack analysis: 2026-10-24*
