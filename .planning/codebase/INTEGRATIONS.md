---
last_mapped_commit: 365269253e39931240fee3dcc51fae6d4a664b87
last_mapped_at: 2026-10-24
---
# External Integrations

**Analysis Date:** 2026-10-24

## APIs & External Services

**Updates (GitHub):**
- GitHub Releases API - checks once a day (and on demand) for the latest published Orbe release
  - Endpoint: `https://api.github.com/repos/amadoubaui/orbe/releases/latest` (`src/main/updates.js:32-35`)
  - SDK/Client: Electron `session.fromPartition('orbe-mises-a-jour')` + `session.fetch` (`src/main/main.js:318-347`); no GitHub SDK, no token
  - Auth: none; `credentials: 'omit'`, `cache: 'no-store'`, `referrerPolicy: 'no-referrer'`, UA literally `Orbe`
  - Hardening: dedicated in-memory session, no cookies; `webRequest.onBeforeRequest` cancels every hop not on `api.github.com`, `github.com`, `objects.githubusercontent.com`, `release-assets.githubusercontent.com` over HTTPS (`src/main/updates.js:114-121`); response capped at 512 KB; release notes capped and sanitized
  - Asset download: 700 MB cap, SHA-256 digest from the API verified before rename, file marked with `com.apple.quarantine` (macOS) or `Zone.Identifier` zone 3 (Windows), never opened (`src/main/updates.js:327-409`)
  - Opt-out: setting `updateCheck` and env `ORBE_NO_UPDATE_CHECK`
- GitHub repository/donation links - opened in a tab or externally, not API calls: `https://github.com/amadoubaui/orbe` (`src/main/commands.js:12`), `https://buymeacoffee.com/amadouba` (`src/main/commands.js:10`)

**Chrome Web Store (extensions):**
- CRX download endpoint: `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=<Chromium>&acceptformat=crx2,crx3&x=id%3D<ID>%26uc` (`src/main/extensions.js:596-599`)
  - SDK/Client: injected `fetch` backed by Electron `net.fetch` from `src/main/main.js:430`; CRX3 parsing and signature verification implemented in `src/main/extensions.js`
  - Auth: none; response capped, `credentials: 'omit'`, 204/404 treated as "extension not found"
  - Install URLs are accepted only from hosts `chromewebstore.google.com` and `chrome.google.com` (`src/main/extensions.js:40`)
  - Installed extensions live in `<userData>/Extensions` (`src/main/main.js:430`)

**Search engines and autocomplete:**
- Six selectable engines in `src/main/suggest.js:6-13`:
  - Google: `https://www.google.com/search?q=%s`, suggestions `https://suggestqueries.google.com/complete/search?client=firefox&q=%s`
  - DuckDuckGo: `https://duckduckgo.com/?q=%s`, suggestions `https://duckduckgo.com/ac/?type=list&q=%s`
  - Bing: `https://www.bing.com/search?q=%s`, suggestions `https://api.bing.com/osjson.aspx?query=%s`
  - Qwant: `https://www.qwant.com/?q=%s`, suggestions `https://api.qwant.com/v3/suggest?q=%s`
  - Ecosia: `https://www.ecosia.org/search?q=%s`, suggestions `https://ac.ecosia.org/autocomplete?type=list&q=%s`
  - Brave: `https://search.brave.com/search?q=%s`, suggestions `https://search.brave.com/api/suggest?q=%s`
  - SDK/Client: Electron `net.fetch` with abort signal (`src/main/suggest.js:168-181`)
  - Auth: none
  - Gated by the `suggestions` setting; user-controlled via `searchEngine` setting
- Quick-action URL templates in `src/main/palette.js:17-35` (YouTube, GitHub, Google Maps, Amazon, Reddit, X, Stack Overflow, MDN, npm, IMDb, Spotify, eBay, LinkedIn, Twitch, Leboncoin) - plain navigation templates, no API calls

**Video playback (Widevine DRM):**
- castlabs Electron build `electron-releases#v44.5.1+wvcus` - optional engine for protected video; installed at dev time from GitHub via npm (`scripts/dev.js:12-19`)
- Widevine CDM component - Electron `components.whenReady()` triggers Chromium component download when the DRM engine is used (`src/main/main.js:427-428`)
- VMP signing - `python3 -m castlabs_evs.vmp sign-pkg` in `scripts/build-mac.js:107-110`, requires `ORBE_EVS=1` and a castlabs account
- Auth: castlabs EVS account only for signing, never at runtime

**Translation:**
- `https://translate.google.com/translate?sl=auto&tl=<lang>&u=<url>` opened as a normal tab for "translate page" (`src/main/window.js:4735`); no API key

**Blocklist (build-time only):**
- `scripts/update-blocklist.js` downloads three public lists with global `fetch` and merges them into `assets/blocklist.txt`:
  - `https://raw.githubusercontent.com/anudeepND/blacklist/master/adservers.txt` (MIT)
  - `https://raw.githubusercontent.com/AdAway/adaway.github.io/master/hosts.txt` (CC BY 3.0)
  - `https://raw.githubusercontent.com/StevenBlack/hosts/master/data/StevenBlack/hosts` (MIT)
- Runtime never downloads the blocklist; `src/main/adblock.js` reads the committed `assets/blocklist.txt` only

## Data Storage

**Databases:**
- No database server and no ORM. Application state is JSON on disk (`src/main/store.js`):
  - `<userData>/orbe.json` - spaces, tabs, archive, settings, notes, downloads, permissions, boosts, update state
  - `<userData>/history.json` - browsing history, loaded lazily, capped at 8,000 entries
  - `<userData>/passwords.json` - password vault, whole file encrypted with Electron `safeStorage` (`src/main/passwords.js:105-121`)
  - `<userData>/sauvegardes/` - rolling local backups of `orbe.json` (`src/main/backups.js`)
  - `<userData>/easels/<id>.json` and `<userData>/easels/<id>/` - easel documents and images (`src/main/easels.js:31-32`)
- Chromium owns cookies, localStorage, IndexedDB, service workers and caches inside per-profile partitions (`src/main/sessions.js:102-111`):
  - `persist:orbe` (default profile), `persist:orbe-<profileId>` (additional profiles), `incognito-<timestamp>` (ephemeral), `orbe-mises-a-jour` (update checks)
- SQLite is read-only and import-only, through the OS binary `/usr/bin/sqlite3`:
  - Arc history, logins and cookies (`src/main/import-arc-data.js`)
  - Firefox bookmarks `places.sqlite` (`src/main/import-browsers.js`)
  - Always on a temporary copy under a 0700 directory, then deleted

**File Storage:**
- Local filesystem only. Downloads go to the configured directory or `app.getPath('downloads')` (`src/main/downloads.js:107`); captures go to Downloads by default (`src/main/library.js:28`)
- Imported/exported files: bookmark HTML, password CSV (`src/main/passwords.js:1019,1050`), Boost JSON (`src/main/boost-editor.js`), notes as text files (`src/main/notes.js:96`), easel PNG export (`src/main/easels.js:346`)
- No cloud storage, no S3, no sync service

**Caching:**
- Chromium HTTP cache per session; sessions created with `cache: false` only for the update session (`src/main/main.js:322`)
- In-memory music artwork cache, 24 entries per session, 4 s lookup interval (`src/main/media-art.js:20-28`)
- No external cache service (Redis, CDN, etc.)

## Authentication & Identity

**Auth Provider:**
- None. Orbe has no account system, no OAuth client, no external identity provider, and no sync login
- Local password manager (`src/main/passwords.js`):
  - Encryption: Electron `safeStorage` (macOS Keychain, Windows DPAPI); on Linux the `basic_text` backend is explicitly refused (`src/main/passwords.js:52-64`)
  - Unlock gate: macOS Touch ID via `systemPreferences.promptTouchID` when available (`src/main/passwords.js:432-433`)
  - Vault is per profile, stored in `passwords.json`, 0600 permissions, atomic write, `.bak` fallback
- HTTP authentication: Basic, Digest, NTLM and proxy auth are handled by an Orbe sheet (`src/main/auth.js`); credentials are never persisted, Chromium keeps them for the session
- Arc import: reads the Arc Safe Storage key from the macOS Keychain through `/usr/bin/security` (`src/main/import-arc-data.js:122-134`), derives the Chromium key (PBKDF2-SHA1, `saltysalt`, 1003 rounds, AES-128-CBC), then wipes the derived key
- Web identity (Google, Microsoft, etc.) is ordinary site login inside the browser; the user agent is intentionally left intact, because stripping the `Electron/x` token produced a Chrome-identical UA while the `sec-ch-ua*` Client Hints still identified Electron, an inconsistency rejected by Google sign-in and Cloudflare (`secure.backblaze.com`) (`src/main/sessions.js:69`)

## Monitoring & Observability

**Error Tracking:**
- None. No Sentry, no crash reporter, no analytics, no telemetry (grep for analytics/telemetry/Sentry found no integration; `sentry.io` appears only in the keep-awake host list)
- Main-process uncaught exceptions are logged to `<userData>/erreurs.log` and capped at 20 in memory (`src/main/main.js:61-68`)

**Logs:**
- `console.error` / `console.log` prefixed `[orbe]` to stderr/stdout
- Chromium netlog only when `ORBE_NETLOG=<path>` is set (`src/main/main.js:84`)
- Optional Chromium trace recording from Help -> Troubleshooting, only performance categories, never while a private window is open, auto-stops after 2 minutes, saved to Downloads (`src/main/trace.js`)
- Test watchdog heartbeat file (`ORBE_HEARTBEAT`, `src/main/test-guard.js`) for CI diagnosis only

## CI/CD & Deployment

**Hosting:**
- Desktop application; no hosted backend in this repository
- Distribution channel implied by the updater: GitHub Releases of `amadoubaui/orbe`, with assets named `Orbe-<version>-mac-arm64.zip` and `Orbe-<version>-windows-x64.zip` (`src/main/updates.js:86-90`)

**CI Pipeline:**
- GitHub Actions, `.github/workflows/tests.yml`
- Triggers: `push`, `workflow_dispatch`
- Matrix: `windows-latest`, `macos-latest`; Node 22; 25-minute timeout
- Steps: ad-block tests (`node tests/adblock.test.js`), extension unit tests (`node --test tests/extensions.test.js`), end-to-end suite (`node scripts/dev.js --selftest`), extension API suite (`node scripts/test-ext.js`), PE-resource tests (`node --test tests/pe-resources.test.js`)
- Windows-only steps: 1920x1080 display, `node scripts/build-win.js --icon`, packaged-app smoke test, `tests/win-package.js`, default-browser register/unregister verification through the registry and PowerShell
- Artifacts: screenshots per OS (`actions/upload-artifact@v4`) and the Windows zip `Orbe-<version>-windows-x64`
- No release/publish workflow, no code-signing secrets, no notarization, no deployment step in the repository

## Environment Configuration

**Required env vars:**
- Production: none. The app runs without environment configuration
- Optional production toggles: `ORBE_DRM` (Widevine engine), `ORBE_NO_UPDATE_CHECK`, `ORBE_NO_WELCOME`, `ORBE_NO_MATERIAL`, `ORBE_USER_DATA`, `ORBE_RUNTIME`
- Development/test: `ORBE_SCENARIO`, `ORBE_TEST_VISIBLE`, `ORBE_TEST_FROZEN`, `ORBE_TEST_LIMIT`, `ORBE_TEST_STALL`, `ORBE_SHOTS`, `ORBE_NETLOG`, `ORBE_UI_*`, `ORBE_BENCH_*`, `ORBE_PE_SAMPLE`, `ORBE_WIN_DIST`, `ORBE_WIN_ARCH`, `ORBE_WIN_DEFAULT_STEP`, `ORBE_EVS`, plus standard `APPDATA`, `LOCALAPPDATA` (full list in STACK.md)

**Secrets location:**
- No secrets are committed and no `.env` file exists
- User secrets live in the OS keychain: macOS Keychain (via `safeStorage` for Orbe's vault, and `security` for Arc import), Windows DPAPI (via `safeStorage`)
- CI uses the default `GITHUB_TOKEN` only implicitly for `actions/checkout` and artifact upload; no repository secrets are referenced

## Webhooks & Callbacks

**Incoming:**
- None. No HTTP server is exposed (tests start local `127.0.0.1` servers only, e.g. `tests/selftest.js`)
- OS-level entry points instead: `app.on('open-url')`, `app.on('open-file')`, macOS Handoff `continue-activity` (`NSUserActivityTypeBrowsingWeb`), `second-instance` command line, and the `orbe://app/...` internal protocol (`src/main/main.js:393-414`, `src/main/sessions.js:23-31`)

**Outgoing:**
- No webhooks. Network requests are limited to the GitHub update API/asset hosts, the Chrome Web Store CRX endpoint, search suggestion endpoints, page-initiated traffic, extension-initiated traffic, and media artwork fetches made on behalf of a page (`src/main/media-art.js`)
- `shell.openExternal` opens system settings or `ms-settings:defaultapps` for default-browser setup (`src/main/platform.js:220-230`, `src/main/imports.js:160`)

## OS and Local Integrations

**macOS:**
- Keychain (`safeStorage`, `/usr/bin/security`), Touch ID, Handoff, default browser (`app.setAsDefaultProtocolClient`), quarantine attribute via `/usr/bin/xattr`, `NSUserActivityTypes`/`CFBundleURLTypes` in the built `Info.plist`
- Full Disk Access is required to import Safari bookmarks (`src/main/import-browsers.js:67-69`)

**Windows:**
- User registry browser registration under `HKCU\Software\Classes\OrbeHTML`, `HKCU\Software\Clients\StartMenuInternet\Orbe`, `HKCU\Software\RegisteredApplications` via `reg.exe` (`src/main/win-default.js`)
- SmartScreen zone marking via `file:Zone.Identifier`, `ms-settings:defaultapps` deep link, Mica material on Windows 11 22H2+

**Cross-platform Electron surfaces used:**
- `Notification` (extension notifications), `desktopCapturer` (screen sharing picker), `globalShortcut` (little-window shortcut), `systemPreferences` (media permissions, reduced motion, Touch ID), `clipboard`, `shell`, `nativeTheme`, `contentTracing`
- Import sources: Arc (Spaces via `StorableSidebar.json`, plus history/logins/cookies), Chrome, Brave, Edge, Vivaldi, Opera, Chromium, Firefox, Safari bookmarks (`src/main/import-browsers.js:36-45`), and CSV password import

---

*Integration audit: 2026-10-24*
