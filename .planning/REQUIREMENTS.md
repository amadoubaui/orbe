# Requirements: Orbe

**Defined:** 2026-10-24
**Core Value:** Rester un navigateur immédiatement fluide et léger : chaque fonctionnalité s'arbitre d'abord sur son coût au démarrage et à l'usage.

## v1 Requirements

Exigences du milestone « socle de modules + Terminal/Herdr ». Chacune sera mappée à une phase du roadmap.

### Socle de modules

- [ ] **MODULE-01**: L'utilisateur voit dans Réglages la liste des modules disponibles, avec titre, description et état désactivé par défaut
- [ ] **MODULE-02**: L'utilisateur peut activer un module explicitement après un avertissement, et le désactiver à tout moment
- [ ] **MODULE-03**: L'activation et les réglages d'un module sont persistés par utilisateur, restaurés au redémarrage et conservés à la désactivation
- [ ] **MODULE-04**: Un module désactivé ne charge aucun code au démarrage (vérifié par test et mesure) ; son entrée est chargée à la première utilisation
- [ ] **MODULE-05**: Un module qui échoue à s'activer est contenu : état `failed` visible, bouton Réessayer, aucun crash du navigateur
- [ ] **MODULE-06**: Les commandes et entrées de menu d'un module n'apparaissent que lorsque le module est actif

### Terminal / Herdr

- [ ] **TERM-01**: L'utilisateur peut activer le module Terminal, qui ajoute des onglets internes de terminal dans Orbe
- [ ] **TERM-02**: Un onglet terminal s'attache à un serveur Herdr déjà lancé ; Orbe ne démarre, n'installe et n'arrête jamais Herdr
- [ ] **TERM-03**: La TUI Herdr complète est rendue par xterm.js vendorisé : couleurs, truecolor, alt screen, redimensionnement
- [ ] **TERM-04**: Le clavier est fidèle : touches spéciales, IME/CJK, AZERTY, Option configurable ; les raccourcis Orbe ne volent pas les touches du terminal
- [ ] **TERM-05**: L'utilisateur peut créer, fermer et redimensionner les panneaux Herdr depuis la TUI ; Herdr garde la gestion de ses workspaces, onglets et panneaux
- [ ] **TERM-06**: L'utilisateur peut ouvrir autant d'onglets terminaux qu'il veut, chacun attaché à une session Herdr ; Orbe gère leur cycle de vie
- [ ] **TERM-07**: Les sessions Herdr survivent à la fermeture ou au redémarrage d'Orbe ; Orbe se réattache sans tuer les sessions
- [ ] **TERM-08**: Herdr absent, serveur arrêté, session inconnue ou protocole incompatible produisent un diagnostic clair avec Réessayer
- [ ] **TERM-09**: Un onglet terminal ne passe pas par les chemins web (veille, archive, réouverture par URL, crash `error.html`, `sendState`, `chrome.tabs`) et ne perd jamais sa session à cause d'eux
- [ ] **TERM-10**: Copier/coller, sélection, ouverture de liens `http(s)` et redimensionnement suivent les conventions d'Orbe ; OSC 52 est désactivé

### Sécurité

- [ ] **SEC-01**: La vue terminal utilise un preload dédié et des canaux `term:*` ; elle n'obtient pas `window.orbe` et n'accède pas aux actions privilégiées
- [ ] **SEC-02**: Les IPC terminal vérifient l'identité exacte du `webContents` et l'appartenance à une session terminal ; une page web, une page interne non-terminale et un onglet interne ordinaire sont refusés (tests)
- [ ] **SEC-03**: Aucune sortie terminal, secret ou diagnostic sensible n'est écrite dans `orbe.json`, les sauvegardes ou les logs non rédigés

### Socle de livraison

- [ ] **CORE-01**: Electron passe de 44.7.0 à 44.9.3 (même majeure) et les tests existants passent
- [ ] **CORE-02**: La CI se déclenche sur `pull_request` et exécute `node --test`, le selftest Electron et un smoke Playwright macOS
- [ ] **CORE-03**: xterm.js 6 est vendorisé et se charge dans une page `orbe://` (MIME `.mjs`, CSP), validé par spike
- [ ] **CORE-04**: `node-pty` se charge dans l'app Electron 44 packagée macOS, validé par spike ; sinon, repli NDJSON documenté
- [ ] **CORE-05**: Démarrage et mémoire avec modules désactivés restent dans la baseline ; aucun module inactif dans `require.cache`

## v2 Requirements

Différées. Suivies mais hors du roadmap courant.

### Modules suivants

- **PAINT-01**: Module paint watercolor avec prises de notes
- **NOTES-01**: Module notes lié au paint

### Plateforme de modules

- **PLUGIN-01**: API de plugins externe avec signature, permissions et sandbox

### Terminal

- **TERM-11**: Support Windows du terminal
- **TERM-12**: Badges et notifications d'agent
- **TERM-13**: Recherche dans le buffer, sessions nommées, split terminal, accessibilité avancée
- **HERDR-01**: Herdr distant via SSH

### Maintenance

- **CORE-06**: Montée Electron 45/46 avant l'EOL du 2027-03-02

## Out of Scope

| Feature | Reason |
|---------|--------|
| Migration hors Electron (Rust, Tauri, CEF, Servo) | NO-GO : 9 à 15 mois-personne et perte des extensions Chrome sur macOS, de Widevine, des profils et du multi-webview stable |
| Installation, lancement ou gestion de Herdr par Orbe | Herdr est un serveur externe fourni par l'utilisateur ; Orbe s'y attache |
| Gestion native des panneaux Herdr | Herdr reste propriétaire de ses workspaces, onglets et panneaux |
| API de plugins externe dans M1 | Le socle de modules internes doit être validé d'abord |
| Paint watercolor et notes dans M1 | Deuxième milestone, après validation du socle |
| Terminal Windows dans M1 | Herdr Windows en bêta, surface non documentée ; macOS d'abord |
| Persistance du scrollback et terminal en navigation privée | Non nécessaire au premier usage ; risque de fuite de données |

## Traceability

Rempli lors de la création du roadmap (2026-10-24).

| Requirement | Phase | Status |
|-------------|-------|--------|
| MODULE-01 | Phase 2 | Pending |
| MODULE-02 | Phase 2 | Pending |
| MODULE-03 | Phase 2 | Pending |
| MODULE-04 | Phase 2 | Pending |
| MODULE-05 | Phase 2 | Pending |
| MODULE-06 | Phase 2 | Pending |
| TERM-01 | Phase 3 | Pending |
| TERM-02 | Phase 3 | Pending |
| TERM-03 | Phase 3 | Pending |
| TERM-04 | Phase 3 | Pending |
| TERM-05 | Phase 3 | Pending |
| TERM-06 | Phase 4 | Pending |
| TERM-07 | Phase 4 | Pending |
| TERM-08 | Phase 3 | Pending |
| TERM-09 | Phase 4 | Pending |
| TERM-10 | Phase 3 | Pending |
| SEC-01 | Phase 3 | Pending |
| SEC-02 | Phase 3 | Pending |
| SEC-03 | Phase 5 | Pending |
| CORE-01 | Phase 1 | Pending |
| CORE-02 | Phase 1 | Pending |
| CORE-03 | Phase 1 | Pending |
| CORE-04 | Phase 1 | Pending |
| CORE-05 | Phase 5 | Pending |

**Coverage:**
- v1 requirements: 24 total
- Mapped to phases: 24
- Unmapped: 0

---
*Requirements defined: 2026-10-24*
*Last updated: 2026-10-24 after roadmap creation*
