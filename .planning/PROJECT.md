# Orbe

## What This Is

Orbe est un navigateur de bureau à barre latérale, en français, construit sur Electron et Chromium. Il reprend l'organisation et les raccourcis d'Arc — Espaces, onglets épinglés, dossiers, barre de commande, vue scindée — en privilégiant la fluidité, la légèreté et la maîtrise locale des données. Version 0.15.5, distribuée sur macOS et Windows.

## Core Value

Rester un navigateur immédiatement fluide et léger : chaque fonctionnalité s'arbitre d'abord sur son coût au démarrage et à l'usage, avant toute autre considération.

## Business Context

- **Customer** : utilisateurs francophones de navigateurs à barre latérale, d'abord l'auteur du projet.
- **Revenue model** : logiciel libre et gratuit, financé par des dons.
- **Success metric** : usage quotidien sans friction ; démarrage rapide et interface réactive.
- **Strategy notes** : `docs/feuille-de-route.md` (partiellement obsolète, voir Contexte).

## Requirements

### Validated

- ✓ Navigateur à barre latérale : Espaces, onglets épinglés, dossiers, favoris, glisser-déposer, renommage — existant
- ✓ Barre de commande (⌘T / ⌘L) : adresse, recherche, bascule d'onglet, historique, actions — existant
- ✓ Vue scindée jusqu'à quatre volets et aperçu des liens (Peek) — existant
- ✓ Profils isolés (cookies, connexions, favoris) et Espaces par profil — existant
- ✓ Import depuis Arc : Espaces, épinglés, favoris, mots de passe, relances non destructives — existant
- ✓ Bloqueur de publicités et de traqueurs (24 000 domaines, exception par site) — existant
- ✓ Extensions Chrome : installation vérifiée, API `chrome.*`, panneau latéral — existant
- ✓ Gestionnaire de mots de passe chiffré (`safeStorage`), remplissage, import/export CSV — existant
- ✓ Notes, médias et tableaux (Easels) dans la bibliothèque — existant
- ✓ Archive, réouverture, mise en veille des onglets, petite fenêtre, navigation privée — existant
- ✓ Thèmes par Espace, animations, sons, français et anglais — existant
- ✓ Distributions macOS et Windows ; mises à jour vérifiées par SHA-256, installation manuelle — existant

### Active

- [ ] Socle de modules : registre de modules internes, activation/désactivation par l'utilisateur, modules désactivés par défaut, chargement paresseux sans coût au démarrage.
- [ ] Module Terminal/Herdr : onglets internes multiples, attache à un serveur Herdr déjà lancé, TUI rendue par xterm.js vendorisé, clavier et sortie fiables.
- [ ] Répartition des responsabilités : Orbe gère les onglets et leur cycle de vie ; Herdr gère ses workspaces, onglets et panneaux internes.
- [ ] Réglages des modules : activer, désactiver et configurer chaque module par utilisateur, avec persistance.
- [ ] Diagnostic et reprise : message clair si Herdr est absent ou injoignable ; reconnexion sans perdre les sessions Herdr.
- [ ] Non-régression du cœur : fluidité au démarrage, raccourcis Arc, isolation des sessions et sécurité IPC.
- [ ] Validation Phase 0 : spike TUI Herdr + `node-pty` + xterm 6 sur l'app packagée macOS ; repli NDJSON si échec.
- [ ] Mise à niveau Electron 44.7.0 → 44.9.3 et CI sur `pull_request` avant le module terminal.

### Out of Scope

- Paint watercolor et prises de notes — modules suivants, planifiés après le terminal.
- API de plugins externe — prévue après le socle de modules internes.
- Réimplémentation de Herdr ou de son serveur — Herdr reste un composant externe.
- Gestion native des panneaux Herdr dans Orbe — Herdr garde la gestion de ses panneaux.
- Lancement, installation ou mise à jour automatique de Herdr — l'utilisateur fournit un serveur déjà lancé.
- Synchronisation entre appareils, version Linux, distribution signée et notarisée — chantiers ultérieurs.
- Support terminal Windows dans le premier jet — macOS d'abord.
- Migration hors Electron (Rust, Tauri, CEF, Servo) — NO-GO pour ce milestone ; réévaluation uniquement si les déclencheurs du `SUMMARY.md` sont réunis.

## Context

- **Brownfield** : le code existe déjà et la carte du codebase est complète (`.planning/codebase/`). L'architecture est un hub-and-spoke Electron : le processus principal possède l'état et les politiques, le renderer est une projection, chaque onglet web est un `WebContentsView`.
- **Passif technique notable** : `src/main/window.js` concentre une grande partie de la logique (plus de 5 000 lignes) ; le dépôt n'a ni framework, ni bundler, ni dépendance runtime.
- **Feuille de route historique** : `docs/feuille-de-route.md` mentionne encore des chantiers déjà livrés. La référence de planification devient `.planning/PROJECT.md` et `.planning/ROADMAP.md`.
- **Ajustements immédiats** : les petites retouches visuelles/UX et les bugs se traitent via `/gsd-quick`, hors roadmap de milestone.
- **Herdr** : multiplexeur d'agents en terminal (workspaces, onglets, panneaux, clients multiples) avec un serveur et une interface TUI. Orbe s'y attache comme client graphique ; il ne l'implémente pas.
- **Vision modules** : les fonctions optionnelles (terminal, puis paint et notes) sont des modules désactivés par défaut, activables par chaque utilisateur. Les modules internes viennent d'abord ; une API de plugins externe viendra ensuite.
- **Priorités d'arbitrage**, dans l'ordre : 1. fluidité et légèreté ; 2. fidélité à Arc pour les onglets ; 3. vie privée et sécurité à la Brave.
- **Public** : le milestone terminal s'adresse d'abord à l'auteur ; Orbe reste par ailleurs un navigateur public et open source.
- **Tests** : le dépôt n'a pas de Vitest malgré la consigne de `CLAUDE.md`. Les commandes réelles sont `npm test`, `npm run test:ui`, `npm run test:ext` et `node --test`.
- **Recherche de domaine** : terminée le 2026-10-24, synthèse dans `.planning/research/SUMMARY.md`. Décisions : TUI Herdr complète via PTY ; migration hors Electron NO-GO ; Electron 44 EOL le 2027-03-02.

## Constraints

- **Stack** : Electron 44.7 (Chromium 152), JavaScript ES2022 en CommonJS, sans framework, sans bundler et sans transpilation.
- **Dépendances vendorisées** : xterm.js 6 et, si le spike le confirme, `node-pty` pour le PTY. `node-pty` est natif, hors asar, avec signature du `spawn-helper`. Aucune autre dépendance runtime.
- **Packaging xterm.js 6** : ESM `.mjs` et mise à jour de `UI_TYPES` / MIME à valider en Phase 0 ; pas de bundler.
- **Dépendance externe** : Herdr doit être installé et déjà lancé ; Orbe ne l'installe ni ne le démarre dans ce milestone.
- **Plateforme** : macOS d'abord (machine de l'auteur), Windows à valider ensuite.
- **Performance** : un module inactif ne doit ni se charger ni coûter au démarrage ; la latence clavier et la fluidité priment.
- **Sécurité** : accès terminal local et explicitement activé ; validation des IPC et respect de la frontière de confiance existante ; aucune page web ne doit accéder au terminal.
- **Architecture** : le processus principal garde l'état et les politiques ; le renderer passe par les preloads. Toute extension du modèle doit respecter les patterns existants ou les faire évoluer explicitement, sans aggraver `window.js`.
- **Planning** : ne pas réintroduire les chantiers déjà livrés dans les phases.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Le terminal est le premier module | Valide le socle de modules sur un cas concret et prioritaire pour l'auteur | — Pending |
| S'attacher à un serveur Herdr existant, sans le lancer | Évite la gestion du cycle de vie et de l'installation ; les sessions Herdr persistent | — Pending |
| xterm.js vendorisé | Fidélité d'émulation et clavier fiable ; première dépendance runtime acceptée | — Pending |
| Orbe gère les onglets, Herdr gère les panneaux | Tire parti du modèle Herdr sans réimplémenter son multiplexeur | — Pending |
| Modules désactivés par défaut | Préserve la légèreté et laisse chaque utilisateur composer son Orbe | — Pending |
| Modules internes d'abord, API externe plus tard | Réduit la surface de sécurité et le périmètre du premier milestone | — Pending |
| Paint watercolor et notes après le terminal | Le terminal est la priorité ; le paint viendra dans un milestone ultérieur | — Pending |
| TUI Herdr complète via PTY (`node-pty`) | Respecte le choix utilisateur et le CLI stable ; le NDJSON preview imposerait de reconstruire l'UI Herdr | — Pending : validé par spike Phase 0 |
| Rester sur Electron 44.9.3 ; migration Rust reportée | Aucune option Rust ne préserve extensions Chrome, Widevine, profils et multi-webview sans 9–15 mois-personne | — Pending |
| Adaptateur `HerdrSession` interchangeable | Permet de basculer TUI/PTY ↔ NDJSON sans toucher xterm, l'IPC ni le modèle d'onglets | — Pending |
| Modules à manifestes statiques, désactivés par défaut | Coût nul au démarrage et contrôle utilisateur, conformément à la Core Value | — Pending |

## Evolution

Ce document évolue aux transitions de phase et aux frontières de milestone.

**Après chaque transition de phase** :
1. Des exigences sont invalidées ? → les déplacer vers Hors périmètre avec la raison
2. Des exigences sont validées ? → les déplacer vers Validated avec la référence de phase
3. De nouvelles exigences émergent ? → les ajouter aux exigences actives
4. Des décisions sont prises ? → les consigner dans Key Decisions
5. « What This Is » est-il toujours exact ? → le mettre à jour en cas de dérive

**Après chaque milestone** :
1. Relecture complète de toutes les sections
2. Vérification de la Core Value — est-ce toujours la bonne priorité ?
3. Audit du Hors périmètre — les raisons sont-elles toujours valables ?
4. Mise à jour du Contexte avec l'état courant

---
*Dernière mise à jour : 2026-10-24 après initialisation et recherche*
