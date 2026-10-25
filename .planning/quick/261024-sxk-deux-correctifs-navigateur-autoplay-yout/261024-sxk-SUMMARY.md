---
phase: quick
plan: 261024-sxk
subsystem: navigation
tags: [electron, autoplay, popups, adblock, webcontentsview]
requires: []
provides:
  - "Politique d'autoplay par vue : activation utilisateur exigée pour les pages web"
  - "shouldBlockPopup(url, firstPartyUrl) : refus pur des popups vers un domaine publicitaire listé"
  - "popups.allowed refuse et compte les popups publicitaires avant la consommation du geste"
affects: [window, little, adblock, popups]
tech-stack:
  added: []
  patterns:
    - "Fusion des webPreferences fournies par Electron avant d'ajouter une politique par vue"
    - "Prédicat pur de blocage hors Electron, testable avec node:test"
key-files:
  created: []
  modified:
    - src/main/window.js
    - src/main/little.js
    - src/main/adblock.js
    - src/main/popups.js
    - tests/adblock.test.js
key-decisions:
  - "Politique d'autoplay posée par vue, jamais par switch global, pour préserver les sons d'interface de la coque."
  - "Le filtre publicitaire des popups s'applique après « Toujours autoriser » et avant la consommation du geste."
actuals:
  tokens: 2891
  tasks: 3
  commits: 3
plan_head_before: 7c56a7d479ba6ce53b6a2eb088a6fdf1591a2682
plan_head_after: 89ab9477ccabe6adce413208fc9f8bf6c7cf540b
duration: 1min
completed: 2026-10-24
status: complete
---

# Quick 261024-sxk : autoplay des pages web et popups publicitaires

**Les vues de pages web exigent désormais une activation utilisateur avant de jouer un média, et `popups.allowed` refuse les ouvertures vers un domaine publicitaire listé et tiers — même avec un geste — là où le filtre réseau ne voit rien.**

## Performance

- **Duration:** 1 min
- **Completed:** 2026-10-24T18:53:23Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments

- `AUTOPLAY_PREFS` (`document-user-activation-required`) ajouté à `src/main/window.js` et appliqué par vue dans les deux branches de `ensureView` et d'`openPeek`, avec fusion des `webPreferences` fournies par Electron.
- Même politique posée sur la vue de page de `LittleWindow` (`src/main/little.js`), sans switch global : la coque et ses sons restent inchangés.
- `shouldBlockPopup(url, firstPartyUrl)` ajoutée à `src/main/adblock.js` : pure, exportée, charge la liste via `loadSync()` au premier appel, respecte `enabled`, la liste d'exceptions et « même site ».
- `src/main/popups.js` : enregistrement factorisé dans `record(rt, url)` et refus publicitaire inséré après « Toujours autoriser pour ce site » et avant la consommation du geste.
- `tests/adblock.test.js` étendu : 16 tests, 0 échec.

## Task Commits

1. **Task 1 : autoplay des vues de pages** — `75db173` (fix)
2. **Task 2 : shouldBlockPopup et ses tests** — `fbdcc21` (feat)
3. **Task 3 : refus publicitaire dans popups.allowed** — `89ab947` (fix)

## Files Created/Modified

- `src/main/window.js` — constante `AUTOPLAY_PREFS`, fusion des préférences dans `ensureView` et `openPeek` (options Electron et branches par défaut).
- `src/main/little.js` — `autoplayPolicy` ajouté aux `webPreferences` de la vue de page.
- `src/main/adblock.js` — `shouldBlockPopup` pure placée après `shouldBlock`, exportée.
- `src/main/popups.js` — `require('./adblock')`, `record()` factorisé, filtre publicitaire avant le geste, en-tête mis à jour.
- `tests/adblock.test.js` — deux tests : refus publicitaire (tiers, sous-domaine, même site, exceptions, désactivé, schémas) et chargement de la liste au premier appel.

## Decisions Made

- Politique d'autoplay par vue plutôt que `appendSwitch('autoplay-policy', …)` : la coque et ses sons d'interface ne sont pas affectés.
- Ordre des décisions dans `popups.allowed` : permission permanente, puis filtre publicitaire, puis geste — une autorisation explicite de l'utilisateur reste prioritaire.

## Deviations from Plan

None — plan exécuté tel quel.

## Verification

- `node --check` sur `src/main/window.js`, `src/main/little.js`, `src/main/adblock.js`, `src/main/popups.js` : OK.
- `node --test tests/adblock.test.js` : 16 tests, 16 pass, 0 fail (jamais en mode watch).
- Quatre occurrences `...AUTOPLAY_PREFS` : deux branches d'`ensureView`, deux branches d'`openPeek` ; `autoplayPolicy` présent dans `little.js`.
- Aucun switch global : `grep -rn "autoplay-policy"` ne renvoie rien dans `window.js`, `little.js` et `main.js`.
- Ordre de `popups.allowed` vérifié statiquement : `=== true) return true` < `shouldBlockPopup` < `const fresh`.
- TDD (Task 2) : RED capturé avec `node --test tests/adblock.test.js` — exit 1, les deux tests cibles échouent avec `TypeError: shouldBlockPopup is not a function` (export absent, cause prévue) ; GREEN après implémentation, 16/16. Le plan imposait un commit atomique code + tests, donc pas de commit `test(...)` séparé.
- Application, serveur et tests UI non lancés ; vérification manuelle (YouTube dans un onglet, popup publicitaire) laissée à l'utilisateur.

## Issues Encountered

None.

## Next Phase Readiness

- Vérification manuelle : ouvrir YouTube dans un onglet (la vidéo ne doit pas démarrer seule) et déclencher une popup publicitaire (refusée et comptée dans la pastille).

---
*Quick: 261024-sxk*
*Completed: 2026-10-24*

## Self-Check: PASSED
