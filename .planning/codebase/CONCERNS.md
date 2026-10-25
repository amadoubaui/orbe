---
last_mapped_commit: 365269253e39931240fee3dcc51fae6d4a664b87
last_mapped_at: 2026-10-24
---
# Codebase Concerns

**Analysis Date:** 2026-10-24

## Tech Debt

**God object in `window.js`:**
- Issue: `src/main/window.js` is 5055 lines and owns window lifecycle, tab model, spare UI views, drag/drop, layout, extensions UI state, downloads, popups, crash recovery, and IPC dispatch. It is the single largest module by an order of magnitude.
- Files: `src/main/window.js`
- Impact: Any tab/window change risks regressions across unrelated features; reviewers cannot hold the file in context; merge conflicts are frequent; the file has no unit tests of its own (only in-app selftest scenarios).
- Fix approach: Extract cohesive units into dedicated modules with the same style used elsewhere (`src/main/veille.js`, `src/main/unload.js` show the pattern): `tab-model.js` (tab/space CRUD + normalize interplay), `spares.js` (spare-view adoption, `DRAG_HOLD`, crash backoff), `state-broadcast.js` (`pushAll`/`sendState`), `popups.js`. Keep `window.js` as orchestration only and pass dependencies explicitly.

**No dependency manifest or lockfile:**
- Issue: `package.json` declares no `dependencies` or `devDependencies`, and there is no `package-lock.json`, `npm-shrinkwrap.json`, or `node_modules` in the repo. Electron is pinned only in the custom `orbe.electron` field (`44.7.0`) and installed at first run by `scripts/dev.js` via `npm install electron@<version>` in `~/.orbe-dev`. `playwright-core` is installed ad hoc, unpinned, by `scripts/test-ui.js`.
- Files: `package.json`, `scripts/dev.js`, `scripts/test-ui.js`
- Impact: No integrity verification of downloaded Electron/playwright tarballs, no reproducible install for contributors/CI, and any upstream tag retag or registry compromise lands directly in the dev environment. CI runs `npm install` implicitly without a lockfile.
- Fix approach: Add `devDependencies` with exact pins for Electron and playwright-core plus a committed lockfile; verify Electron download against the published SHASUMS in `scripts/dev.js` (the update path in `src/main/updates.js` already demonstrates required-digest handling). Keep the runtime dependency-free design, but make dev tooling reproducible.

**Test commands and project instructions diverge:**
- Issue: `CLAUDE.md` instructs "utiliser vitest run / ne jamais lancer Vitest en mode watch", but Vitest is not installed or configured anywhere. Actual test commands are `npm test` (`node scripts/dev.js --selftest`, Electron scenarios), `npm run test:ui` (Playwright), `npm run test:ext`, and three `node:test` suites (`tests/adblock.test.js`, `tests/extensions.test.js`, `tests/pe-resources.test.js`).
- Files: `CLAUDE.md`, `package.json`, `tests/selftest.js`, `scripts/test-ui.js`
- Impact: An agent or contributor following CLAUDE.md will run a command that does not exist, then misreport test status; the instruction also biases toward watch mode which is explicitly forbidden by the same file.
- Fix approach: Rewrite the Test section of `CLAUDE.md` to the real commands (`npm test`, `npm run test:ui`, `node --test tests/adblock.test.js tests/extensions.test.js tests/pe-resources.test.js`), and state that no watcher is used. Add a `test:unit` script alias so the documented command is verifiable in CI.

**Swallowed errors throughout the main process:**
- Issue: 180+ empty `catch {}` blocks and `try {} catch {}` wrappers across `src/main/`. Representative locations include `src/main/main.js` (append of `erreurs.log`), `src/main/window.js` (session/navigation calls), `src/main/store.js` (backup copy, history write), `src/main/passwords.js` (safeStorage/keychain paths), `src/main/updates.js`, `src/main/backups.js`.
- Files: `src/main/main.js`, `src/main/window.js`, `src/main/store.js`, `src/main/passwords.js`, `src/main/updates.js`, `src/main/backups.js`
- Impact: Failures in persistence, keychain, or file permissions are silent by design in many paths; the vault write path is correct (it surfaces errors), but peripheral paths (history save, backup copy, clipboard clear) can fail without anyone noticing, leaving state that looks healthy.
- Fix approach: Adopt a two-tier convention: expected/optional failures stay `catch {}` with a one-line comment explaining why; everything else routes through a small `logError(scope, err)` helper writing to `erreurs.log` (already exists in `src/main/main.js`) with a cap. Audit the 20 highest-value catches first: store writes, backup/restore, password `.bak`, certificate handling, update downloads.

**Uncaught exception handler keeps a broken app alive:**
- Issue: `process.on('uncaughtException')` in `src/main/main.js` records the stack to memory and `erreurs.log`, then continues. It is global, including outside test mode.
- Files: `src/main/main.js`
- Impact: After an unexpected throw, the main process can continue in an inconsistent state (half-applied state writes, orphaned WebContentsViews, leaked debugger attachments). Users see odd behavior rather than a clean crash/restart, and crash reporting is reduced to a local log file.
- Fix approach: Restrict continuation to test mode (`testMode` flag already exists). In production, log, show a single "Orbe must restart" dialog, and call `app.quit()` (or `app.relaunch(); app.exit(1)`). Keep the current behavior only for the deliberately tolerated cases (e.g. transient protocol/session errors), which should catch locally instead.

**Stale roadmap documentation:**
- Issue: `docs/feuille-de-route.md` still lists features as future work that are already shipped (Arc import, pinned tabs, spaces, password manager), while `README.md` and commit history show them delivered.
- Files: `docs/feuille-de-route.md`, `docs/suivi/ameliorations.md` (136 KB), `docs/suivi/arc-inventaire.md` (182 KB)
- Impact: Planners and agents reading docs to decide next work may re-plan completed features or miss the actual remaining gaps. The huge tracking docs are not indexed and are too large to load into context.
- Fix approach: Mark `docs/feuille-de-route.md` as archived or regenerate it from open issues; add an "already shipped" section with links to the implementing modules; move the two large tracking docs under `docs/suivi/archive/` or split them per topic.

## Known Bugs

**No confirmed functional bugs at analysis time:**
- Issue: No TODO/FIXME/HACK/XXX markers exist anywhere in `src/` or `scripts/`; no failing tests are checked in; no open bug list is in the repo.
- Files: `src/`, `scripts/`, `tests/`
- Impact: This section must not invent bugs. The risk areas below are failure modes inferred from code structure and documented limitations, not observed defects.
- Note: The most likely latent defects are in the fragile areas below (model normalization, spare views, history loss, extension updates).

## Security Considerations

**Decrypted password vault lives in JS memory:**
- Risk: `src/main/passwords.js` holds decrypted entries in ordinary JS strings; V8 cannot guarantee zeroization. A renderer compromise would not read it (context isolation), but a main-process memory disclosure or crash dump could.
- Files: `src/main/passwords.js`
- Current mitigation: Vault encrypted at rest via Electron `safeStorage`; refuses Linux `basic_text`; write 0600 + fsync + `.bak`; no plaintext on disk; docs disclose the residual risk (`docs/mots-de-passe.md`).
- Recommendations: Keep the documented limitation; add an idle auto-lock that drops the plaintext object (re-unlock via Touch ID/`safeStorage`) after N minutes or on window lock/suspend; consider `Buffer` for the decrypted blob and explicit zeroing after parse, while noting strings still exist.

**Extensions are verified at install, not after:**
- Risk: `src/main/extensions.js` verifies CRX3 signatures and hardened ZIP extraction, but discards `_metadata` and performs no post-install integrity or content analysis. A modified on-disk extension directory after install is loaded as-is; malicious updates from a compromised publisher are accepted if signed.
- Files: `src/main/extensions.js`, `src/main/sessions.js`, `src/main/ext-api.js`
- Current mitigation: Store signature required by default (`STORE_KEY_HASH`), all proofs must verify, developer key must match ID, path traversal/symlink/encryption/ZIP64 rejected, atomic install. Non-guarantees are documented in code comments.
- Recommendations: Persist per-file hashes (from the verified CRX `_metadata`-independent hash list or a self-computed manifest) and verify before each `loadExtension`; refuse to load on mismatch with a UI warning. Add a permission-change prompt on update; keep the documented "no blacklist" caveat visible in the extensions UI.

**Keychain "Always allow" exposes the Arc key to any local process:**
- Risk: Arc import in `src/main/import-arc-data.js` reads the Arc Safe Storage key via `/usr/bin/security find-generic-password`. If the user chooses "Always allow", the key is readable by any process running as the user, not just Orbe.
- Files: `src/main/import-arc-data.js`, `docs/mots-de-passe.md`
- Current mitigation: The command uses a 120 s timeout; the key buffer is zeroed at the end; the import is explicit and user-initiated; docs state the risk.
- Recommendations: Detect and warn when `security` will prompt, explicitly recommend "Allow" once rather than "Always allow"; re-check the item's ACL after retrieval if feasible; never persist the key.

**Heuristic eTLD+1 for password matching and ad blocking:**
- Risk: `src/main/adblock.js` and the registrable-domain logic used for password origin matching use a hand-written heuristic rather than the Public Suffix List. Misclassification can either over-block/under-block or, for passwords, treat unrelated sites as same-site (or vice versa).
- Files: `src/main/adblock.js`, `src/main/passwords.js`
- Current mitigation: Same-site exception, third-party-only blocking, main frame never blocked; password matching additionally validates against Electron's real origin and requires explicit user choice; docs disclose the limitation.
- Recommendations: Embed a compact PSL snapshot (generated file, checked in) and use it in both places; keep the heuristic as a fallback when the host is absent. Add a unit test suite for known multi-label suffixes (`co.uk`, `github.io`, `s3.amazonaws.com`).

**Custom protocol handler is security-critical and centralized:**
- Risk: `orbe://` is privileged and its handler in `src/main/sessions.js` (`serveInternal`) is the gate for all UI assets and `orbe://app/` trust. Path traversal is guarded today, but any future change to directory layout, URL parsing, or cache can reopen it.
- Files: `src/main/sessions.js`, `src/main/window.js`
- Current mitigation: Path must resolve under `RENDERER_DIR`; only UI text files are cached; `INTERNAL` prefix check on IPC sender frame; `nodeIntegrationInSubFrames: true` is limited to tab views with the sandbox on.
- Recommendations: Add a dedicated `node:test` suite for `serveInternal` covering encoded traversal (`%2e%2e`, backslashes, null bytes, symlinks), and require it to pass in CI. Consider moving handler logic to `src/main/internal-protocol.js` so it can be tested without Electron.

**Certificates: in-memory exceptions and fail-closed HSTS probe:**
- Risk: `src/main/certs.js` stores certificate exceptions per session keyed by host+fingerprint in memory only (safe default), but the HSTS probe via `net.request` fails closed, which may surprise users behind proxies; hard errors never offer "proceed".
- Files: `src/main/certs.js`
- Current mitigation: `setCertificateVerifyProc` only records; Chromium decides by default; hard errors are not overridable; exceptions vanish on restart.
- Recommendations: Document the proxy/HSTS interaction in `docs/securite-navigation.md`; keep exceptions non-persistent by design and state that explicitly in the UI.

**Page preload trust boundary is correctly narrow but subtle:**
- Risk: `src/preload/page.js` runs in an isolated world inside arbitrary web pages and reports field focus, armed credentials, and generated passwords. The main process must never trust its claims about origin or account identity.
- Files: `src/preload/page.js`, `src/main/passwords.js`
- Current mitigation: Main derives `frameInfo` from Electron, rate-limits per frame/subframe, requires explicit user choice to fill, and only fills the single currently reported field. The preload inserts nothing into the page DOM.
- Recommendations: Add a regression test in `tests/` for the fill path asserting that a spoofed `focus` message with a different origin cannot retrieve credentials; keep the comment block at the top of `page.js` in sync if the channel changes.

**Unsigned distribution:**
- Risk: `scripts/build-mac.js` ad-hoc signs (`codesign --force --deep --sign -`) and `scripts/build-win.js` produces an unsigned executable. macOS Gatekeeper and Windows SmartScreen will warn; users are trained to bypass warnings.
- Files: `scripts/build-mac.js`, `scripts/build-win.js`, `src/main/updates.js`
- Current mitigation: Update archives require a published SHA-256 and are quarantined, never executed automatically; docs explain the unsigned status; no auto-update install.
- Recommendations: Prioritize Developer ID signing + notarization for macOS and Authenticode for Windows; until then, surface the expected warning and checksum verification steps in the download UI and README.

## Performance Bottlenecks

**Full-state broadcast on every change:**
- Issue: `sendState()` in `src/main/window.js` rebuilds the complete tab/space/favorites/panes/extensions/downloads payload for every window on each state change; `pushAll()` coalesces only within a `setImmediate` tick.
- Files: `src/main/window.js`
- Cause: Single coarse state event with no delta protocol; payload grows with tab count and download history.
- Improvement path: Send deltas (`tabs:add`, `tabs:update`, `state:meta`) and a full snapshot only on window creation/reconnect. Measure serialization time in `tests/performances.js` before and after; keep the current event name for compatibility and add a `version` field.

**Synchronous full-file state rewrites:**
- Issue: `src/main/store.js` writes the entire `orbe.json` on a debounce (1.5 s normal, 8 s lazy) with an atomic rename, and copies `.bak` per launch. History is a separate `history.json` with a 20 s debounce and an 8000-URL cap.
- Files: `src/main/store.js`
- Cause: Whole-document persistence; no incremental journal; archive capped at 2000 and downloads at 300 to bound size.
- Improvement path: Keep the atomic write, but split rarely changing settings from frequently changing tab state so a tab switch does not serialize settings/extensions. Add a size guard that logs when `orbe.json` exceeds a threshold, and a test in `tests/ui/` that creates 500 tabs and asserts save latency and file size.

**Peek polling timer:**
- Issue: `peekTimer = setInterval(..., 80)` in `src/main/window.js` runs continuously and is not `unref()`ed, unlike the other maintenance intervals.
- Files: `src/main/window.js`
- Cause: Polling instead of event-driven updates for the peek overlay.
- Improvement path: Drive peek from mouse events already received by the shell renderer, or `unref()` the timer and gate it on an active peek session. Confirm with a timer audit that all other intervals are unref'd except `archiveStale` (also not unref'd, `src/main/main.js` line ~519).

**Memory footprint sampling via `/usr/bin/top`:**
- Issue: `src/main/empreinte.js` parses `top` output to estimate per-tab memory; `src/main/veille.js` uses that for the memory rule and `MIN_LIVE=4`.
- Files: `src/main/empreinte.js`, `src/main/veille.js`
- Cause: External process spawn and text parsing; accurate enough for sleeping decisions but coarse.
- Improvement path: Throttle more aggressively when battery saver is on; cache per-process values between samples; fall back to `app.getAppMetrics()` (already Electron-native) if `top` parsing fails, and log the fallback.

**Startup work is deliberately serialized:**
- Issue: `src/main/main.js` delays adblock load by 1.2 s and runs startup hooks; UI shell load is prioritized.
- Files: `src/main/main.js`, `src/main/sessions.js`
- Cause: Avoiding contention with first paint.
- Improvement path: Keep the delay, but make it configurable and log time-to-first-paint in a benchmark scenario; ensure new startup hooks are registered before the delay so they do not run on the critical path.

## Fragile Areas

**State normalization and migration:**
- Files: `src/main/store.js`
- Why fragile: `normalize()` repairs orphan tabs, folders, splits, favorites, splits/panes, and migrates version<2 internal pages via URL regex. Any new model field must be normalized here or old state files will load half-valid. The `.bak` fallback on parse failure can silently replace a newer file with an older one.
- Safe modification: Add a new `version` bump with a deterministic migration, extend `normalize()` in the same commit, and add a fixture-based test that loads representative v0/v1 state files. Never change field semantics without a migration.
- Test coverage: Not covered by an automated fixture suite; relies on selftest scenarios.

**Spare UI views and crash recovery:**
- Files: `src/main/window.js` (`adoptSpare`, `fillSpares`, `DRAG_HOLD`, `uiGone`, backoff 150 ms → 60 s)
- Why fragile: Spare views are created via `window.open` from the shell to share its renderer process; `adoptSpare` only accepts URLs in `this.wanted`. A redirect or a changed URL allowlist silently leaves the shell without a spare, and the drag workaround (`DRAG_HOLD = 8000`) is timing-sensitive.
- Safe modification: Always add new shell URLs to `wanted`; keep spare creation failures non-fatal and logged; test drag-and-drop and shell crash recovery manually via the selftest `fenetres` scenario after changes.
- Test coverage: In-app selftest only; no Playwright test for drag or renderer crash.

**Tab sleeping heuristics:**
- Files: `src/main/veille.js`, `src/main/window.js` (`kept`, `typed`)
- Why fragile: `pick()` depends on accurate `lastUsed`, `mb`, `kept`, and `typed` inputs from `window.js`. A missing `typed` signal (e.g. keyboard input not detected in some page) lets a tab with unsaved work sleep; an over-eager `kept` defeats the feature. `MIN_LIVE=4` and battery-saver thresholds are hard-coded.
- Safe modification: Changes to `typed` detection or `kept` computation must be paired with the existing node test for `pick()` and a manual check of form-filling pages; never sleep a tab with an active download, media capture, or DevTools.
- Test coverage: `pick()` is unit-tested via selftest; real-world detection of user gestures is not.

**History persistence:**
- Files: `src/main/store.js` (lazy-loaded `history.json`, 20 s debounce, 8000-URL cap, 4 MB limit)
- Why fragile: History loads lazily via `defineProperty`; a crash before the debounce loses recent entries; exceeding 4 MB or 8000 URLs silently trims. Concurrent access from imports can race with the periodic save.
- Safe modification: Flush history on `before-quit` and on window close; make the cap a named constant; add a test that appends 10k URLs and asserts trimming and file size.
- Test coverage: No dedicated unit test.

**Arc import secret handling:**
- Files: `src/main/import-arc-data.js`
- Why fragile: Depends on the exact Arc Chromium DB schema (requires version ≥24), `/usr/bin/security`, and cookie host-hash validation. A macOS update or Arc schema change breaks the import; secrets are handled in JS strings; the temp copy must remain 0700.
- Safe modification: Keep strict bounds (file sizes, node/depth limits, timeouts) and zero the key buffer. Fail with a clear message rather than partial import; never relax host-hash validation. Add a test fixture with a synthetic DB for the version gate.
- Test coverage: Manual/in-app scenario; no automated fixture.

**Extension install transaction:**
- Files: `src/main/extensions.js`
- Why fragile: Install writes versioned directories and switches state atomically; failure between extraction and state switch leaves orphaned directories, and removal of old versions happens after sync. Unpacked/developer extensions alter assumptions about signatures.
- Safe modification: Keep extraction, verification, and state switch ordered and idempotent; on load, prune unreferenced version dirs; never load a directory without a verified `.crx`-derived record unless the user explicitly chose unpacked.
- Test coverage: `tests/extensions.test.js` covers parsing/verification; install transaction and crash-between-steps are not covered.

**Unload shield and close timeout:**
- Files: `src/main/unload.js`
- Why fragile: Attaches the Electron debugger temporarily to run `beforeunload` logic; `closeAll` has a 4 s timeout. Detaching at the wrong moment or a debugger conflict leaves a window that cannot close.
- Safe modification: Always detach in `finally`; keep the timeout; log detach failures; avoid attaching to non-tab webContents.
- Test coverage: Selftest scenario only.

**IPC dispatch surface:**
- Files: `src/main/main.js` (single `ipcMain.handle('orbe', ...)`), `src/preload/ui.js`
- Why fragile: One channel routes `boost:`, `pw:`, `easel:`, `sheet:`, `dl:`, `update:`, `import:`, `welcome:`, `lib:`, settings/shortcuts/ext/notes/tasks, and the window handle. Trust is a single `ok(e)` check; every new action must re-validate its payload and its sender frame, and the UI event whitelist in `ui.js` must be extended.
- Safe modification: Add payload validation next to each action; never add a default `else` that forwards arbitrary actions; keep `ok(e)` first. Add a test asserting `ok` rejects non-`orbe://app/` frames.
- Test coverage: Trust check has no dedicated unit test.

## Scaling Limits

**Tab count:**
- Current capacity: `SPARES = 3` spare UI views; sleeping keeps at most `maxLiveTabs` alive with `MIN_LIVE=4`; memory budget from `src/main/veille.js` `budget()`.
- Limit: State payload size and `sendState()` serialization grow linearly with tabs; each live tab is a full renderer process; sidebar rendering in the shell must handle hundreds of rows.
- Scaling path: Delta state protocol (above), virtualized sidebar list, incremental tab creation, and a benchmark scenario at 500/1000 tabs in `tests/performances.js`.

**Persistence size:**
- Current capacity: Archive capped at 2000, downloads at 300, history at 8000 URLs / 4 MB.
- Limit: Full-file rewrite cost grows with state; `.bak` doubles peak disk; backup snapshots retain 10 daily + 10 hourly copies (0700/0600).
- Scaling path: Split settings/tabs/history files, add a size telemetry log, and prune archive/downloads by age in addition to count.

**Extension count:**
- Current capacity: `src/main/extensions.js` limits ZIP entries to 20k, 512 MB total, 256 MB per entry; no explicit extension count limit.
- Limit: Each extension adds a background service worker/process and `chrome.*` surface in `src/main/ext-api.js`; sidebar/popup UI and permission checks scale linearly.
- Scaling path: Add a soft cap with a clear UI message, lazy-load extension APIs per extension, and measure startup time with N extensions in the selftest.

**Password vault size:**
- Current capacity: Encrypted JSON rewritten on each change; per-frame rate limiting in `src/main/passwords.js`.
- Limit: Linear scan for origin matches; full rewrite per save; Touch ID/cookies integration.
- Scaling path: Keep full rewrite (vaults are small), but index by registrable domain in memory and add a benchmark at 5k entries.

## Dependencies at Risk

**Electron pinned outside a manifest:**
- Risk: `package.json` `orbe.electron = "44.7.0"` and `orbe.electronDrm = "44.5.1+wvcus"` are installed by `scripts/dev.js` without a lockfile or checksum. The DRM variant tracks a different version, increasing drift.
- Impact: A corrupted or substituted Electron download compromises the entire browser; CI and developer machines may diverge silently.
- Migration plan: Add exact `devDependencies` + lockfile, verify SHASUMS, and assert the downloaded version at startup.

**Unpinned `playwright-core`:**
- Risk: `scripts/test-ui.js` installs `playwright-core` on demand without a version; browser binaries are not pinned.
- Impact: UI tests can break or behave differently between runs and CI.
- Migration plan: Pin in `devDependencies`, install browsers in CI with a fixed revision, and cache them.

**System binaries as dependencies:**
- Risk: `/usr/bin/sqlite3`, `/usr/bin/security`, `/usr/bin/xattr`/`xattr`, `/usr/bin/top` are invoked by `src/main/import-arc-data.js`, `src/main/import-browsers.js`, `src/main/empreinte.js`, and backup/quarantine code. macOS changes to `sqlite3` (e.g. removal in future releases) or sandbox restrictions break features.
- Impact: Arc/bookmark import, memory sampling, and quarantine marking can fail; most call sites swallow errors.
- Migration plan: Detect availability at feature start and show a precise message; consider a bundled SQLite for imports; keep `top` parsing behind `app.getAppMetrics()` fallback.

**Native Swift keyboard tests:**
- Risk: `tests/natif/` requires a Swift toolchain and macOS APIs; not run in CI (`tests.yml` covers macOS/Windows Electron tests but not `tests/natif`).
- Impact: Keyboard-layout regressions ship unnoticed.
- Migration plan: Add a macOS CI job that builds and runs the Swift tests, or port the assertions to the Electron selftest where possible.

## Missing Critical Features

**Automatic update installation:**
- Issue: `src/main/updates.js` checks for releases, verifies a required SHA-256, and quarantines downloads, but never installs or executes. `README.md` documents manual installation.
- Blocks: Users on old versions (including security fixes) do not receive them; the unsigned build also prevents a trustworthy self-update path.
- Fix approach: After Developer ID/Authenticode signing, add a signed sparkle-style update or a verified manual installer handoff; keep the digest requirement and the never-execute-from-download rule.

**UI/native tests in CI:**
- Issue: `.github/workflows/tests.yml` runs on `push` only (plus manual), covering adblock, extensions, Electron selftest, extension-in-browser, pe-resources, Windows build/smoke/registry. It does not run `npm run test:ui` (32 Playwright suites) or `tests/natif`.
- Blocks: UI regressions merge on pull requests without detection; there is no `pull_request` trigger at all.
- Fix approach: Add `pull_request` to the trigger, run `test:ui` on macOS, add a Swift job, and cache Electron/playwright installs. Keep the Electron selftest as the gate for main-process behavior.

**Lint/format/security scanning:**
- Issue: No ESLint/Prettier/Biome config and no dependency or secret scanning in CI. Style is maintained by convention alone.
- Blocks: Inconsistent style in a 5k-line file, unnoticed unused code, and no automated check for accidental secret commits.
- Fix approach: Add ESLint (flat config) with a narrow ruleset (no-unused-vars, no-empty with comment allowance, eqeqeq) and run it in CI; add `npm audit`/secret scanning only after a lockfile exists. Avoid a formatting rewrite to keep diffs reviewable.

**Crash reporting and diagnostics export:**
- Issue: Errors go to `erreurs.log` and `console.error`; there is no opt-in crash report, no diagnostics bundle, and no way for a user to send state safely.
- Blocks: Triage of field issues relies on asking users to find files.
- Fix approach: Add an explicit "Export diagnostics" action that bundles version, platform, `erreurs.log`, and redacted settings (never vault/cookies/history) into a zip; never upload automatically.

## Test Coverage Gaps

**`window.js` tab/window logic:**
- What's not tested: Tab creation/closing, spare-view adoption, popup gating, crash backoff, drag-and-drop, and `sendState()` payload shape have no unit tests; only in-app selftest scenarios exercise them.
- Files: `src/main/window.js`, `tests/selftest.js`
- Risk: Any refactor of the god object can break windowing in ways selftest may not observe.
- Priority: High

**Store migrations and normalization:**
- What's not tested: `normalize()` repairs and version migrations have no fixture tests; `.bak` fallback and history trimming are untested.
- Files: `src/main/store.js`
- Risk: Old state files can lose tabs or favorites after an upgrade; the fallback can silently revert newer data.
- Priority: High

**Password origin matching and fill path:**
- What's not tested: Registrable-domain matching edge cases, subframe rate limiting, spoofed preload messages, Touch ID grace, and clipboard TTL.
- Files: `src/main/passwords.js`, `src/preload/page.js`
- Risk: A matching bug could offer credentials on the wrong site; spoofed messages could request fills.
- Priority: High

**Update verification and redirects:**
- What's not tested: `hopAllowed` redirect allowlist, missing-digest rejection, asset URL reconstruction, size/idle caps, and quarantine marking.
- Files: `src/main/updates.js`
- Risk: A regression could download an unverified asset or follow a redirect off-allowlist.
- Priority: High

**Certificate exceptions and HSTS probe:**
- What's not tested: In-memory exception lifecycle, hard-error no-proceed behavior, probe failure handling.
- Files: `src/main/certs.js`
- Risk: A change could turn a warning into an accepted certificate.
- Priority: Medium

**Backup/restore:**
- What's not tested: Retention computation, scrub-on-delete across snapshots, restore permission preservation, disabling modified/removed Boosts and Boost JS, corrupted-backup handling.
- Files: `src/main/backups.js`, `src/main/boosts.js`
- Risk: "Deleted means deleted" or restore safety can regress silently.
- Priority: Medium

**Custom protocol handler:**
- What's not tested: Path traversal variants on `serveInternal`, cache invalidation by mtime, user-agent cleanup.
- Files: `src/main/sessions.js`
- Risk: Any parser change can expose arbitrary files to `orbe://`.
- Priority: High

**UI suites and native tests in CI:**
- What's not tested in CI: 32 Playwright suites under `tests/ui/` and Swift tests under `tests/natif/`.
- Files: `.github/workflows/tests.yml`, `tests/ui/`, `tests/natif/`
- Risk: Sidebar, settings, command bar, and keyboard-layout regressions merge undetected.
- Priority: High

**Arc and browser import:**
- What's not tested: No synthetic DB fixtures for Arc schema version gate, cookie host-hash mismatch, partial import, Firefox DB copy isolation.
- Files: `src/main/import-arc-data.js`, `src/main/import-browsers.js`
- Risk: OS/browser updates break imports or relax validation.
- Priority: Medium

---

*Concerns audit: 2026-10-24*
