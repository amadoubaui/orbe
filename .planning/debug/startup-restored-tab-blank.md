---
status: resolved
trigger: "On app startup, the last restored tab is selected in the sidebar (its title and URL are shown), but its page is not rendered: the content area shows only the app background until the user forces a refresh/reload, after which the page appears. Expected: the restored active tab renders immediately at launch."
created: 2026-10-24T00:00:00Z
updated: 2026-10-25T00:00:00Z
---

## Current Focus
<!-- OVERWRITE on each update - reflects NOW -->

bug_class: bohrbug (deterministic on a cold start with a restored session and an installed extension)

hypothesis: CONFIRMED. At first-window construction, `ensureView` creates the restored tab's WebContentsView and calls `loadURL(tab.url)` while `sessions.profileSession()` is concurrently loading the profile's installed extensions into the same session (`extensions.loadInto`, asynchronous). When the extension lands, Chromium cancels the in-flight first navigation: the `loadURL` promise rejects with `ERR_FAILED (-2)` and the rejection is swallowed by `.catch(() => {})`. The tab stays at `getURL() === ''`, `isLoading() === false`, no document — until the user reloads, which starts a fresh navigation in a settled session.

test: Full-profile-copy probe (ORBE_PAINT_PROBE=1) with the real installed extension: reproducible `ERR_FAILED` at +101–109 ms on two consecutive runs. Same copy with the extension directory removed: `did-navigate 200` at +312 ms. After the fix: `did-navigate 200` at +267 ms with the extension present, no rejection.

next_action: None — resolved; human confirmation of a cold relaunch remains for the user.

## Symptoms
<!-- Written during gathering, then IMMUTABLE -->

expected: At launch, the restored active tab renders its page immediately in the content area.
actual: The restored tab is selected in the sidebar (title and URL shown) but the content area shows only the app gradient background. The page appears only after ⌘R / the toolbar reload button. Clicking the already-selected tab does not fix it. No errors in the main console or userData/erreurs.log. Every startup; long-standing (not a 0.15.5 regression). macOS, Orbe 0.15.5, 2026-10-24.
errors: none
reproduction: Launch Orbe with a restored session (every startup). The last active tab is restored selected, content area blank. Press ⌘R or the toolbar reload: the page renders. Re-clicking the selected tab in the sidebar leaves it blank.
started: long-standing (present across recent versions, per user memory)

## Eliminated
<!-- APPEND only - prevents re-investigating -->

- hypothesis: The page load fails at startup (network/session error) and only reload succeeds.
  evidence: No errors in console or erreurs.log; the app would show its error page on a failed navigation; page loads and paints fine in the same window once navigation restarts. Renderer-side first paint is produced (the startup bench measures it).
  timestamp: 2026-10-24

- hypothesis: The view is missing, detached, or mis-sized at startup.
  evidence: Activating the already-selected tab calls ensureView (view exists) + layout with the same bounds and does not help; the runtime trace shows the view is created, attached and sized; the post-fix test asserts its bounds exceed 100×100.
  timestamp: 2026-10-24

- hypothesis: The shell view covers the tab view (stacking/occlusion).
  evidence: addChildView(rt.view, 1) stacks the tab view above the shell; the same stacking renders the page after reload. What the user sees is the shell gradient through a non-painting tab view.
  timestamp: 2026-10-24

- hypothesis: setBackgroundThrottling(false)-while-hidden (Electron #52864) leaves the view blank.
  evidence: Orbe never sets backgroundThrottling anywhere (grep of src/); AUTOPLAY_PREFS only sets autoplayPolicy. Different trigger.
  timestamp: 2026-10-24

- hypothesis: The restored tab view is created while the window is hidden and can never be shown (the #52864 class directly).
  evidence: The opposite is the case in the normal path: show() ran before layout created the view. The deferred ORBE_HIDE_UNTIL_READY path (view created hidden, shown later) is the canonical lifecycle and is not the default.
  timestamp: 2026-10-24

- hypothesis: The constructor ordering (show() before layout()/view attach) is the root cause of the blank restored tab.
  evidence: Human relaunch with the reorder active still showed a blank restored tab; resizing did not help; only reload did. Both orderings produce the identical symptom. The reorder was reverted; it was not the fix.
  timestamp: 2026-10-25

- hypothesis: Frame-level gating — the restored tab's webContents/RenderWidgetHostView is treated as hidden, so the renderer produces no frames until a navigation reallocates a surface.
  evidence: Probe run with ORBE_PAINT_PROBE=1: tab visibilityState = visible from +101 ms; view.getVisible() true, bounds valid, window visible. Staged non-navigation repaints (wc.invalidate(), view.setVisible(false→true), 1 px bounds nudge + restore, wc.setBackgroundThrottling(false)) all left getURL() at "" and the screen blank. Renderer visibility/compositor gating is not the mechanism.
  timestamp: 2026-10-25

- hypothesis: The page loads but never paints (renderer has a document, rAF dead).
  evidence: In-page probe at +8 s returned {"timeout":true}: no document was ever committed; getURL() "" and isLoading() false throughout. The startup load never began — a navigation-level failure, not first-paint.
  timestamp: 2026-10-25

- hypothesis: The initial loadURL is never invoked, or the navigation stays pending forever.
  evidence: Instrumented run (probe v2) shows `chargement demandé` from ensureView at +0 ms, did-start-loading and did-start-navigation at +2 ms; the loadURL promise then REJECTS with `ERR_FAILED (-2)` at +101–113 ms. It is invoked and starts, then is cancelled.
  timestamp: 2026-10-25

- hypothesis: The blank tab depends on the window being unfocused/occluded at launch.
  evidence: In the instrumented reproduction the window was active (focus at +76 ms) and the load still failed with ERR_FAILED; the copy-only run without extensions loaded fine regardless. Focus is not the trigger.
  timestamp: 2026-10-25

- hypothesis: The installed extension itself blocks YouTube (content/network policy).
  evidence: The same extension is present when the re-issued loadURL at +5.5 s loads the same URL with HTTP 200, and after the fix the very first navigation loads it. The failure is a timing race with extension registration, not content blocking.
  timestamp: 2026-10-25

## Evidence
<!-- APPEND only - facts discovered -->

- timestamp: 2026-10-24
  checked: user report details via questionnaire
  found: clicking the selected tab (which re-runs activate() -> layout()) does NOT make the page appear; only webContents reload does. Blank on every startup, long-standing, no errors logged.
  implication: The view exists, is attached and sized (layout runs on tab click without effect). The defect is in the navigation/first-paint lifecycle, not restore selection, view creation or bounds.

- timestamp: 2026-10-24
  checked: src/main/window.js constructor and layout/ensureView
  found: ensureView creates the WebContentsView, wires it, then calls wc.loadURL(tab.url) (rejection swallowed by .catch(() => {})); layout attaches it with addChildView + place(); the shell did-finish-load triggers a second layout(); clicking a tab re-runs layout with identical bounds.
  implication: The initial navigation is issued while the profile session is being configured; any failure is silent.

- timestamp: 2026-10-25
  checked: ORBE_PAINT_PROBE=1 cold-start run on the user's real profile (probe v1)
  found: the tab stayed at URL "", isLoading false, no document, for 6 minutes; invalidate/setVisible/bounds nudge/backgroundThrottling(false) had no effect; capturePage wedged until window activation; only ⌘R started the load.
  implication: The startup navigation is dropped/aborted at cold start. Needs call-site attribution.

- timestamp: 2026-10-25
  checked: cold-start automation harness (tests/ui/33-demarrage-froid.js) with a seeded profile
  found: a minimal synthetic profile passes (load starts) — the harness does not reproduce the user's condition; a faithful reproduction requires the installed extension.
  implication: The trigger lives in the real profile's session startup (extensions), not in the restore path itself.

- timestamp: 2026-10-25
  checked: direct Electron launch on a full copy of the real profile (ORBE_USER_DATA, caches excluded, probe v2)
  found: `chargement demandé` from ensureView at +0 ms; did-start-navigation at +2 ms; at +101–113 ms `did-stop-loading` and `promesse loadURL initial REJETÉE ERR_FAILED (-2) loading 'https://www.youtube.com/watch?v=kHDsfGvMlPU'`; wc stays URL ""/not loading. The probe's re-issued loadURL at +5.5 s loads the same URL (did-navigate 200 at +5689 ms). Reproduced on two consecutive runs.
  implication: Root cause identified: the first navigation is cancelled during startup with ERR_FAILED, and the rejection is swallowed.

- timestamp: 2026-10-25
  checked: same full-profile copy with the Extensions directory removed
  found: initial navigation loads normally — did-navigate 200 at +312 ms, page title present at T0.
  implication: Installed extensions' session registration is the perturbing factor; without extensions there is no race.

- timestamp: 2026-10-25
  checked: sessions.js configure/sessionFor and ext-api attach/equip
  found: `profileSession()` -> `configure()` calls `extApi.attach(ses)` then starts `extensions.loadInto(ses)` asynchronously (Promise), which registers the extension into the session (`sync`, `hooks.equip`, `loadExtension`) while `ensureView` proceeds immediately with `loadURL(tab.url)`; `extApi.equip` registers session preload scripts on `extension-loaded`.
  implication: The first navigation and the extension registration overlap; Chromium cancels the in-flight navigation when the extension lands.

- timestamp: 2026-10-25
  checked: fix applied — the initial load waits for `sessions.whenReady(ses)` (the extensions' loadInto promise) before loadURL, with a guard against overriding a user-started navigation; full-profile copy with extensions, probe enabled
  found: `chargement demandé` after readiness; `did-navigate 200` at +267 ms; no ERR_FAILED, page committed.
  implication: Serializing session readiness before the first navigation fixes the startup race deterministically.

- timestamp: 2026-10-25
  checked: test suites after the fix
  found: tests/ui/33-demarrage-froid.js (cold start, seeded extension, slow page) 2/2; UI groups 01-commande and 02-onglets 35/35 (2 ignored); node --test adblock/extensions/pe-resources: 42 pass, 7 skipped, 0 fail.
  implication: Fix verified by automated suites; user-visible confirmation on the real app remains.

## Resolution
<!-- OVERWRITE as understanding evolves -->

root_cause: "At first-window construction, ensureView issues the restored tab's loadURL while the profile session is asynchronously loading its installed extensions (extensions.loadInto inside sessions.configure). When the extension is registered, Chromium cancels the in-flight first navigation and the loadURL promise rejects with ERR_FAILED (-2); the rejection is swallowed by .catch(() => {}). The tab stays empty (URL '', not loading) until the user triggers a new navigation (⌘R), which starts in a settled session."
fix: "sessions.js exposes whenReady(ses) — the promise of the session's extension loading (resolved for non-persistent sessions). OrbeWindow.ensureView waits for it before loading a newly created view's initial URL (history restore or loadURL), and skips the deferred load if the tab already has a URL or a navigation in flight. The provisional constructor reordering was reverted (not the cause)."
verification: "Full profile copy with the real extension: initial navigation commits (did-navigate 200 at +267 ms, no ERR_FAILED) versus ERR_FAILED at ~+105 ms before the fix; same copy without extensions also loads. tests/ui/33-demarrage-froid.js (cold start + installed extension + slow page) 2/2; UI 01/02 35/35; node suites 42 pass / 7 skipped / 0 fail. User confirmation on a cold relaunch of the real app is the final gate."
files_changed:
  - src/main/sessions.js
  - src/main/window.js
  - tests/ui/harness.js
  - tests/ui/33-demarrage-froid.js
