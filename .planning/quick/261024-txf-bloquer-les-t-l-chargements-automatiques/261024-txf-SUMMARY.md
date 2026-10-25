---
phase: quick
plan: 261024-txf
subsystem: navigation
tags: [electron, popups, downloads, permissions, locales]
requires: []
provides:
  - "popups.mark(wc) / popups.isMark(wc) : WeakSet des fenêtres ouvertes par une page"
  - "hooks.popupOpened posé sur popups.mark, appelé dans les trois branches de setWindowOpenHandler qui créent une vue enfant"
  - "permissions.env.popup et contrôle popup dans downloadGate avant le geste hérité de Chromium"
  - "Toast dl.popupBlocked, une fois par page de popup"
affects: [popups, window, essentials, permissions, locales]
tech-stack:
  added: []
  patterns:
    - "WeakSet interne au processus principal pour identifier les vues ouvertes par une page"
    - "Hook inerte par défaut puis câblé par essentials.js, comme les autres raccords de window.js"
key-files:
  created: []
  modified:
    - src/main/popups.js
    - src/main/window.js
    - src/main/essentials.js
    - src/main/permissions.js
    - src/shared/locales.js
key-decisions:
  - "Le contrôle popup passe avant l'early return de item.hasUserGesture : le geste hérité de la page ouvrante ne crédite pas la popup."
  - "Une popup dont le dernier geste date de plus de 5 s est refusée, au lieu de bénéficier du premier téléchargement automatique réservé aux onglets normaux."
  - "dlPopupBlocked est remis à faux par did-navigate : un toast au plus par page de popup."
actuals:
  tokens: 2274
  tasks: 2
  commits: 2
plan_head_before: 87e26edc82973d7f37ff5796008e6b017951bc2a
plan_head_after: 200db2ff177c602bbc1665a8bef4c1c05dbe4360
duration: 4min
completed: 2026-10-24
status: complete
---

# Quick 261024-txf : bloquer les téléchargements automatiques des popups

**Une fenêtre ouverte par une page est désormais marquée comme popup dans le processus principal, et son téléchargement est refusé tant que l'utilisateur n'a pas réellement interagi en son sein, même quand Chromium rapporte le geste de la page ouvrante.**

## Performance

- **Duration:** 4 min
- **Completed:** 2026-10-24
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- `src/main/popups.js` : WeakSet `marked`, `mark(wc)` défensif (null, webContents détruit) et `isMark(wc)` exportés, sans toucher au comportement de `gesture`, `allowed`, `reset`, `count` ou `menu`.
- `src/main/window.js` : hook `popupOpened: () => {}` et marquage des trois branches de `setWindowOpenHandler` qui créent une vue enfant — `background-tab`, `shifted`/`newTab`, `createWindow` —, jamais pour `peek`/`route` ni pour un onglet ouvert par l'utilisateur.
- `src/main/essentials.js` : `hooks.popupOpened = (wc) => popups.mark(wc)` et `popup: (wc) => popups.isMark(wc)` passé à `permissions.setup`.
- `src/main/permissions.js` : `env.popup` faux par défaut, contrôle popup dans `downloadGate` après `env.gesture(wc)` et avant `if (gesture) return true;`, toast `dl.popupBlocked` limité une fois par page, `dlPopupBlocked` remis à faux par `did-navigate`.
- `src/shared/locales.js` : `dl.popupBlocked` en français et en anglais, apostrophe typographique.

## Task Commits

1. **Task 1 : marquer les fenêtres ouvertes par une page** — `a145adf` (feat)
2. **Task 2 : refuser les téléchargements automatiques des popups** — `200db2f` (feat)

## Files Created/Modified

- `src/main/popups.js` — WeakSet `marked`, `mark`, `isMark`, exports `menu, mark, isMark, WINDOW`.
- `src/main/window.js` — hook `popupOpened`, commentaire des raccords, marquage des branches background-tab, shifted/newTab et createWindow.
- `src/main/essentials.js` — câblage du hook et du prédicat popup.
- `src/main/permissions.js` — `env.popup`, contrôle popup dans `downloadGate`, remise à zéro de `dlPopupBlocked`.
- `src/shared/locales.js` — clé `dl.popupBlocked` (fr + en).

## Decisions Made

- Le contrôle popup est évalué avant `if (gesture) return true;` : `item.hasUserGesture()` peut être vrai par héritage du clic d'ouverture, il ne doit pas créditer la popup.
- Une popup sans entrée récente (geste absent, `Infinity`, ou plus de 5 s) est refusée avant l'increment de `st.downloads` : elle ne bénéficie pas du premier téléchargement automatique des onglets normaux.
- `mark` s'appuie sur un WeakSet : le marquage disparaît avec la vue, sans IPC ni donnée exposée à la page.

## Deviations from Plan

None — plan exécuté tel quel.

## Verification

- `node --check` sur `src/main/popups.js`, `src/main/window.js`, `src/main/essentials.js`, `src/main/permissions.js`, `src/shared/locales.js` : OK.
- Marquage : trois occurrences de `hooks.popupOpened` dans `window.js`, défaut inerte `popupOpened: () => {}`, aucun marquage dans les branches `peek`/`route` ni dans les `newTab` déclenchés par l'utilisateur.
- Ordre statique de `downloadGate` vérifié : `env.gesture(wc)` → `env.popup(wc)` et `!(since < GESTURE)` → `if (gesture) return true;` → `if (since === null) return true;` → logique existante (`st.dlGesture` intact).
- Anti-répétition : `dlPopupBlocked` consulté avant le toast et remis à faux par `did-navigate`.
- Les deux locales portent `dl.popupBlocked` ; `grep -c` vaut 2.
- Application, serveur et tests UI non lancés ; vérification manuelle laissée à l'utilisateur (popup avec téléchargement refusé + toast, clic réel puis téléchargement autorisé, onglet normal inchangé).

## Issues Encountered

None.

## Next Phase Readiness

- Vérification manuelle : une page avec geste qui ouvre une popup lançant un téléchargement doit voir le téléchargement refusé et le toast « Téléchargement automatique bloqué » ; un clic réel dans la popup suivi d'un téléchargement doit passer ; les téléchargements d'un onglet normal restent inchangés.

---
*Quick: 261024-txf*
*Completed: 2026-10-24*

## Self-Check: PASSED
