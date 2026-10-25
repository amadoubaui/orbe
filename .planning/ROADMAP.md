# Roadmap: Orbe

## Overview

Ce milestone ajoute un socle de modules optionnels, désactivés par défaut et sans coût au démarrage, puis son premier module : un terminal interne attaché à un serveur Herdr déjà lancé. La progression suit les portes de la recherche : d'abord rendre le travail mesurable et lever les inconnues techniques (CI, Electron 44.9.3, xterm.js 6, `node-pty`, surface Herdr), puis livrer le socle de modules, puis une tranche verticale du terminal macOS, puis le cycle de vie multi-onglets et la reprise, et enfin prouver la sécurité et la non-régression. Chaque phase est livrable et vérifiable seule ; les modules Paint et Notes, l'API de plugins, Windows et les extras terminal restent en v2.

## Milestones

- **v0.16 — Socle de modules et Terminal/Herdr** — Phases 1-5 (in progress)

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Portes, CI et spikes** - CI sur pull_request, Electron 44.9.3, xterm.js 6 et node-pty validés, décision Herdr consignée
- [ ] **Phase 2: Socle de modules** - Registre, activation explicite, persistance, chargement paresseux et containment
- [ ] **Phase 3: Tranche verticale Terminal (macOS)** - Un onglet attaché à Herdr, TUI rendue, clavier, panes, diagnostics et IPC isolé
- [ ] **Phase 4: Cycle de vie multi-onglets et reprise** - Plusieurs sessions, survie aux redémarrages, exclusion des chemins web
- [ ] **Phase 5: Durcissement, sécurité et mesures** - Rédaction des données sensibles et non-régression mesurée

## Phase Details

### Phase 1: Portes, CI et spikes
**Goal**: Rendre le travail mesurable et lever les inconnues bloquantes : CI sur `pull_request`, Electron 44.9.3, xterm.js 6 et `node-pty` validés dans l'app macOS packagée, et décision sur la surface Herdr consignée.
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: CORE-01, CORE-02, CORE-03, CORE-04
**Success Criteria** (what must be TRUE):
  1. Un pull request déclenche la CI, qui exécute `node --test`, le selftest Electron et un smoke Playwright macOS ; un test volontairement cassé bloque le merge.
  2. Electron 44.9.3 démarre l'application et tous les tests existants passent, sans régression fonctionnelle constatée.
  3. xterm.js 6 vendorisé se charge dans une page `orbe://` avec le bon MIME `.mjs` et la CSP stricte, sans erreur de module ni de MIME.
  4. Le spike Herdr valide `node-pty` dans l'app Electron 44 packagée macOS (ou documente le repli NDJSON) et consigne la décision TUI+PTY vs NDJSON avec transcript réel, version minimale et fixtures de test.
**Plans**: TBD

Correspond à la Phase 0 de la recherche : portes et spikes, aucune fonctionnalité utilisateur livrée ici.

### Phase 2: Socle de modules
**Goal**: Les modules existent comme fonctionnalité utilisateur : liste dans Réglages, activation explicite après avertissement, persistance par utilisateur, chargement paresseux mesuré, containment des échecs et commandes conditionnelles.
**Mode:** mvp
**Depends on**: Phase 1 (CI et harnais de mesure)
**Requirements**: MODULE-01, MODULE-02, MODULE-03, MODULE-04, MODULE-05, MODULE-06
**Success Criteria** (what must be TRUE):
  1. Réglages affiche tous les modules disponibles avec titre et description, tous désactivés par défaut sur une installation neuve.
  2. L'utilisateur active un module après un avertissement explicite et peut le désactiver à tout moment ; l'état et les réglages du module survivent au redémarrage et sont conservés après désactivation.
  3. Un module désactivé ne charge aucun code au démarrage — `require.cache` et une mesure de démarrage le prouvent — et son entrée n'est chargée qu'à la première utilisation.
  4. Un module qui échoue à s'activer affiche un état `failed` avec un bouton Réessayer et ne fait jamais planter le navigateur.
  5. Les commandes et entrées de menu d'un module n'apparaissent que lorsque ce module est actif.
**Plans**: TBD
**UI hint**: yes

### Phase 3: Tranche verticale Terminal (macOS)
**Goal**: Un onglet terminal interne s'attache à un serveur Herdr déjà lancé et affiche sa TUI complète via xterm.js, avec clavier, copier/coller, panes et diagnostics fiables, sans élargir la frontière de confiance.
**Mode:** mvp
**Depends on**: Phase 1 (décisions de spike) et Phase 2 (socle de modules)
**Requirements**: TERM-01, TERM-02, TERM-03, TERM-04, TERM-05, TERM-08, TERM-10, SEC-01, SEC-02
**Success Criteria** (what must be TRUE):
  1. Activer le module Terminal ajoute des onglets internes de terminal ; aucun onglet terminal n'existe quand le module est désactivé.
  2. Un onglet s'attache à un serveur Herdr déjà lancé et rend la TUI complète via xterm.js (couleurs, truecolor, alt screen, redimensionnement) ; Orbe ne démarre, n'installe et n'arrête jamais Herdr.
  3. Le clavier est fidèle (touches spéciales, AZERTY, Option configurable, IME) sans que les raccourcis Orbe volent les touches du terminal ; copier/coller, sélection, liens `http(s)` et redimensionnement suivent les conventions d'Orbe et OSC 52 est désactivé.
  4. L'utilisateur crée, ferme et redimensionne les panes Herdr depuis la TUI, Herdr conservant la gestion de ses workspaces, onglets et panneaux ; Herdr absent, serveur arrêté, session inconnue ou protocole incompatible produisent un diagnostic clair avec Réessayer.
  5. La vue terminal utilise un preload dédié et des canaux `term:*`, n'obtient jamais `window.orbe`, et les IPC refusent une page web, une page interne non-terminale et un onglet interne ordinaire (tests).
**Plans**: TBD
**UI hint**: yes

### Phase 4: Cycle de vie multi-onglets et reprise
**Goal**: Plusieurs onglets terminaux coexistent, survivent aux redémarrages d'Orbe et traversent les chemins du modèle d'onglets sans perdre leur session Herdr.
**Mode:** mvp
**Depends on**: Phase 3
**Requirements**: TERM-06, TERM-07, TERM-09
**Success Criteria** (what must be TRUE):
  1. L'utilisateur ouvre autant d'onglets terminaux qu'il veut, chacun attaché à une session Herdr, et Orbe gère leur cycle de vie.
  2. Fermer ou redémarrer Orbe ne tue pas les sessions Herdr ; les onglets terminaux se réattachent aux mêmes sessions au lancement suivant.
  3. Une connexion perdue se rétablit avec backoff et resynchronisation ; un pane encore vivant n'est jamais présenté comme terminé.
  4. Un onglet terminal ne passe par aucune voie web (veille, archive, réouverture par URL, `error.html`, `sendState`, `chrome.tabs`) et ne perd jamais sa session à cause de ces chemins.
**Plans**: TBD

### Phase 5: Durcissement, sécurité et mesures
**Goal**: Le module Terminal est prouvé sûr et non régressif : aucune sortie ou secret dans les fichiers persistés, diagnostics rédigés, et démarrage/mémoire conformes à la baseline avec les modules désactivés.
**Mode:** mvp
**Depends on**: Phase 4
**Requirements**: SEC-03, CORE-05
**Success Criteria** (what must be TRUE):
  1. Après une session terminal complète, y compris des erreurs provoquées, aucune sortie terminal, aucun secret et aucun diagnostic sensible n'apparaît dans `orbe.json`, les sauvegardes ou les logs non rédigés.
  2. Le diagnostic ou l'export d'erreurs ne contient que des champs allowlistés et rédigés.
  3. Avec tous les modules désactivés, le démarrage et la mémoire restent dans la baseline, et `require.cache` ne contient aucune entrée de module inactif.
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Portes, CI et spikes | 0/TBD | Not started | - |
| 2. Socle de modules | 0/TBD | Not started | - |
| 3. Tranche verticale Terminal (macOS) | 0/TBD | Not started | - |
| 4. Cycle de vie multi-onglets et reprise | 0/TBD | Not started | - |
| 5. Durcissement, sécurité et mesures | 0/TBD | Not started | - |
