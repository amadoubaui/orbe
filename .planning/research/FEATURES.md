# Feature Research

**Domain:** navigateur de bureau à barre latérale, modules optionnels, terminal multiplexé et migration de runtime
**Researched:** 2026-10-24
**Confidence:** MEDIUM — documentation officielle et sources primaires pour Herdr, xterm.js, Tauri, Electron et CEF ; plusieurs points de protocole et de parité restent à valider par prototype.

## Cadrage

Ce document couvre trois périmètres distincts, à ne pas mélanger dans une même phase :

1. **Milestone 1 — socle de modules** : registre interne, activation par l'utilisateur, modules désactivés par défaut, chargement paresseux, réglages et persistance.
2. **Milestone 1 — module Terminal/Herdr** : onglets terminaux internes, attache à un serveur Herdr déjà lancé, rendu xterm.js, clavier/IME/clipboard, reconnexion, diagnostic, sécurité.
3. **Analyse de migration** : ce qui devra être conservé, dégradé ou abandonné si Orbe quitte Electron pour Tauri 2 ou un shell Rust avec Chromium/WebKit. Ce n'est pas du travail du milestone 1.

### Décision de périmètre à trancher avant la planification : quel « TUI Herdr » est rendu ?

Le libellé du milestone (« la TUI Herdr est rendue par xterm.js ») admet trois lectures, avec des coûts très différents :

| Option | Ce qu'Orbe affiche | Dépendance | Verdict |
|---|---|---|---|
| **A. Flux terminal par cible** (recommandé) | Le contenu d'un terminal Herdr (pane/terminal/agent), y compris les TUI qui y tournent ; Orbe gère ses onglets, Herdr gère workspaces/tabs/panes | CLI stable `herdr terminal session control` ; pas de PTY côté Orbe | Compatible avec « xterm.js seule dépendance runtime ». Ne montre pas la barre latérale de Herdr. |
| **B. TUI Herdr complète dans chaque onglet** | Le client Herdr complet (sidebar, onglets, panes) | PTY local (`node-pty` ou helper) + protocole du client | Ajoute une deuxième dépendance runtime native, duplique deux barres d'onglets, complique clavier/souris/redimensionnement. À éviter en M1. |
| **C. Client du socket binaire `herdr-client.sock`** | Le client graphique « natif » de Herdr | Protocole binaire non documenté, utilisé par des clients tiers via un bridge | Risque maximal, aucune garantie de compatibilité. Hors périmètre. |

**Recommandation :** le milestone 1 livre l'option A. Si le produit veut réellement l'option B, alors « fournir un PTY » devient une feature P1 à part entière et la contrainte « xterm.js est la première dépendance runtime » doit être rouverte. Les features ci-dessous supposent A, avec les points de vigilance B signalés.

## Feature Landscape

### Table Stakes — socle de modules

Ce que l'utilisateur considère comme acquis dès qu'on parle de « modules ». Complexité relative au code existant d'Orbe.

| Feature | Pourquoi c'est attendu | Complexité | Notes / dépendances |
|---|---|---|---|
| Registre statique de modules avec manifeste | Un module doit être identifiable, versionné et désactivable sans scan de disque | LOW | `id`, `name`, `description`, `version`, `icon`, `defaultEnabled: false`, `requires`, `settingsSchema`, `entry` main/renderer. Registre embarqué, pas de chargement de code arbitraire. |
| Découverte dans les réglages | L'utilisateur doit voir ce qui existe et ce qui est actif | LOW | Nouveau volet « Modules » dans `settings.html` ; liste issue du registre via IPC. Dépend du registre et de la validation des réglages. |
| Désactivé par défaut + activation explicite | Un module terminal donne un accès shell local : il ne doit jamais s'activer par surprise | LOW | Équivalent du « Restricted Mode » d'Obsidian. Gate d'activation avec explication du risque et confirmation. |
| Chargement paresseux sans coût au démarrage | Core Value : fluidité et légèreté avant tout | MEDIUM | Le registre ne fait que des métadonnées ; `require()` du module uniquement à l'activation ; page renderer chargée seulement à l'ouverture d'un onglet. Mesurer le temps de démarrage module off/on. |
| Persistance de l'état activé/désactivé | L'utilisateur ne doit pas réactiver à chaque lancement | LOW | `settings.modules[id] = { enabled, ...settings }` dans `orbe.json` ; migration `store.normalize()` et bump de version si le schéma évolue. |
| Réglages du module + validation en main | Chaque module a ses réglages, mais le renderer ne doit pas écrire n'importe quoi | MEDIUM | `SETTABLE` (`src/main/main.js`) étendu par un validateur de module ; réglages lus/écrits via IPC validé. Dépend du store et de `prefs.js`. |
| Cycle de vie activation/désactivation | Activer doit charger ; désactiver doit tout arrêter et ne rien laisser tourner | MEDIUM | Contrat `activate(ctx)` / `deactivate()` ; `ctx` fournit commandes, IPC namespacé, création d'onglet interne, logs, settings. La désactivation ferme les onglets du module et tue ses processus ; les sessions Herdr survivent car le serveur est externe. |
| Isolation des pannes | Un module qui échoue ne doit jamais empêcher Orbe de démarrer | MEDIUM | `try/catch` autour du chargement et des handlers ; état `ok/error/disabled` visible dans les réglages ; message actionnable et bouton réessayer. Ne pas auto-désactiver silencieusement. |
| Contributions aux commandes et raccourcis | Un module doit s'intégrer à la barre de commande et aux raccourcis sans conflit | MEDIUM | Les commandes ne sont enregistrées qu'activé ; résolution de conflits avec `commands.js` / `shortcuts.js` ; une commande « Activer le terminal » reste visible module off. |
| Frontière de sécurité du module | Un module interne est privilégié : il ne doit pas être joignable depuis une page web | HIGH | IPC validé par expéditeur (`orbe://app/`), payload validé, aucun handler enregistré module off, page du module ouverte uniquement par le main. Voir section sécurité. |
| Diagnostic de module | En cas d'échec, l'utilisateur doit pouvoir comprendre et transmettre l'état | MEDIUM | Statut, version, dernière erreur, chemin des logs, « copier le diagnostic » sans secret. Dépend de `erreurs.log` et d'un début d'export diagnostic. |
| Internationalisation | Orbe est français d'abord, anglais ensuite | LOW | Clés dans `src/shared/locales.js` pour les deux langues ; libellés du registre fournis par clé, pas en dur. |
| Tests de non-régression du cœur | Le module ne doit pas casser le démarrage, les raccourcis ou l'isolation | MEDIUM | Test selftest « module off » (aucun require, aucune commande, aucun coût mesurable) ; test activation/désactivation ; benchmark de démarrage. Le dépôt n'a pas Vitest : utiliser `npm test` et `node --test`. |

### Table Stakes — module Terminal/Herdr

Sans ces éléments, le module n'est pas un terminal crédible, même pour l'auteur.

| Feature | Pourquoi c'est attendu | Complexité | Notes / dépendances |
|---|---|---|---|
| Découverte du serveur Herdr | L'utilisateur doit savoir si Herdr tourne et à quelle session se connecter | LOW-MEDIUM | Résolution `--session`, `HERDR_SESSION`, `HERDR_SOCKET_PATH`, socket par défaut `~/.config/herdr/herdr.sock` ; `herdr status`/`ping` ; chemin du binaire configurable. Jamais de lancement automatique. |
| Attache à une cible Herdr | C'est le cœur du module | HIGH | `herdr terminal session control <pane|terminal|agent> --cols N --rows N`, stdout NDJSON `terminal.frame` (ANSI base64) et `terminal.closed` ; stdin NDJSON `terminal.input/resize/scroll/mouse/release`. Un seul controller par terminal ; `--takeover` explicite. Dépend du protocole et d'un spike de validation. |
| Rendu terminal fidèle via xterm.js vendorisé | Les TUI (Claude Code, Codex, vim, htop) doivent s'afficher correctement | MEDIUM-HIGH | xterm.js 6.0 stable : `@xterm/xterm` `lib/xterm.js` utilisable en `<script>` classique, CSS `css/xterm.css` ; addons fit/webgl/unicode11/clipboard/search. Vérifier le build UMD des addons lors du vendoring. |
| Onglets terminaux internes | Le module doit vivre dans le modèle d'onglets Orbe, pas dans une fenêtre à part | MEDIUM-HIGH | Créer les vues via `ensureView` / le seam d'onglet interne, pas un `WebContentsView` ad hoc. `tab.internal = true`, `UI_PRELOAD` uniquement, URL `orbe://app/terminal.html`. Dépend de `window.js` et de `INTERNAL_PAGES`. |
| Cycle de vie des onglets terminaux | Ouvrir, fermer, renommer, changer d'onglet, restaurer après relance | MEDIUM | Un onglet = une cible Herdr persistée (`{kind, id, session}`), jamais une capture de scrollback. Fermer un onglet détache le controller, ne tue pas le pane Herdr. Restaurer réattache si la cible existe encore. |
| Clavier fiable | La latence et la justesse clavier priment sur tout | HIGH | xterm `onData` → `terminal.input` ; touches spéciales, flèches, Home/End, F1-F12, Ctrl/Alt, souris. Priorité des raccourcis Orbe à définir quand le terminal a le focus. Tester avec les TUI réels de l'auteur. |
| IME et CJK | Un terminal qui casse le coréen/japonais/chinois n'est pas fini | HIGH | xterm gère la composition via un textarea caché, mais des défauts récents existent : overlay de pré-édition rogné par une fonte Nerd Font Mono, fenêtre de candidats mal positionnée sous Blink, textarea résiduel, Ctrl+lettre perdu sous IME non latin, composition annulée rejouée. Prévoir des tests et des correctifs applicatifs, pas seulement le vendor. |
| Option comme Meta sur macOS | Les raccourcis readline/Emacs (Option+F/B, Option+Backspace) sont attendus | LOW | `macOptionIsMeta: true` à la construction ; documenter que cela désactive les caractères Option (é, ø). Ne pas changer l'option à chaud. |
| Copier/coller et sélection | Attendu dans tout terminal | MEDIUM | `Cmd+C` sur sélection, `Cmd+V` vers `terminal.input`/paste ; `macOptionClickForcesSelection` pour contourner la capture souris des TUI ; `rightClickSelectsWord` si cohérent avec Orbe. Coller du texte doit passer par les transformations xterm. |
| OSC 52 et presse-papiers | Les TUI et agents demandent souvent l'écriture clipboard | MEDIUM | `@xterm/addon-clipboard` ; politique par défaut : refuser ou demander, jamais écrire silencieusement. Un programme distant ne doit pas pouvoir exfiltrer via le clipboard sans consentement. |
| Souris et reporting | Herdr, vim et les agents capturent la souris | MEDIUM | xterm émet les séquences de souris si l'application active le mode ; le protocole contrôle accepte aussi `terminal.mouse` (down/up/drag/move, boutons, modificateurs, colonne/ligne). Choisir une seule voie et la tester ; prévoir un moyen de sélectionner du texte malgré la capture. |
| Redimensionnement | Un terminal mal dimensionné casse les TUI | MEDIUM | `addon-fit` + `ResizeObserver`, debounce ; `terminal.resize` ou respawn du controller avec `--cols/--rows` (le RPC JSON n'a pas de resize absolu de PTY). Le dernier client à interagir avec un tab Herdr partagé contrôle la taille des panes. |
| Reconnexion et reprise | Herdr garde les sessions ; Orbe doit se rebrancher sans les perdre | HIGH | Superviseur de processus : détecter la fin de `control`, backoff exponentiel, bannière « Herdr injoignable », bouton Réessayer. Après relance d'Orbe, résoudre les `terminal_id` via `session.snapshot` ; si le serveur a redémarré, l'id peut avoir changé : proposer de rattacher au pane ou d'ouvrir un nouveau terminal. Ne jamais relancer Herdr soi-même. |
| États d'erreur explicites | « Ça ne marche pas » n'est pas un diagnostic | MEDIUM | Distinguer : binaire absent, serveur non lancé, socket introuvable, session inconnue, cible disparue, version/protocole incompatible, permission refusée, flux interrompu. Messages FR/EN et action suggérée. |
| Diagnostic et support | L'auteur doit pouvoir réparer sans deviner | MEDIUM | Statut, version Herdr, session, socket, PID du controller, dernière erreur, test de connexion, copie du diagnostic. Ne jamais inclure le contenu du terminal par défaut. |
| Sécurité locale | Le terminal donne un accès shell : c'est la surface la plus sensible d'Orbe | HIGH | Activation explicite, page interne uniquement, aucun accès depuis une page web ou une extension, spawn sans shell avec arguments séparés, chemin de binaire borné, socket local seulement, validation IPC, titres et liens traités comme du texte. |
| Réglages du module | L'utilisateur veut au minimum la taille de police et le chemin Herdr | LOW-MEDIUM | Police, taille, scrollback xterm, session Herdr, chemin du binaire, comportement Option/Meta. Validation en main. |
| Performance | Un terminal doit répondre au clavier, pas seulement s'afficher | MEDIUM-HIGH | WebGL addon si disponible, fallback DOM ; pas de polling ; frames poussées ; mesurer la latence clavier→écho et le débit sur une sortie dense. Aucun coût module off. |
| Accessibilité de base | Un navigateur public doit rester utilisable au clavier | MEDIUM | xterm `screenReaderMode` et navigation clavier ; à traiter en P2 si l'auteur est seul utilisateur au départ, mais à ne pas oublier dans la définition de fini. |

### Differentiators — ce qui distingue Orbe

| Feature | Value Proposition | Complexité | Notes |
|---|---|---|---|
| Terminal dans le navigateur, pas dans une app séparée | Les agents, les logs et la navigation web vivent dans la même fenêtre et la même barre latérale | HIGH | C'est la raison d'être du module. Suppose l'intégration au modèle d'onglets/Espaces, pas une fenêtre tierce. |
| Sessions qui survivent à la fermeture d'Orbe | Herdr possède les PTY ; Orbe ne fait que s'y attacher | MEDIUM | Différenciateur fort face aux terminaux intégrés qui tuent les processus à la fermeture. À condition de ne pas prétendre restaurer le scrollback après un redémarrage du serveur. |
| Modules réellement à coût nul | Un module off ne charge rien et ne coûte rien au démarrage | MEDIUM | À mesurer et à documenter. C'est l'application directe de la Core Value et un argument face aux apps qui chargent tout. |
| Composition par utilisateur | Chacun active terminal, paint ou notes selon son usage | LOW-MEDIUM | Le socle de modules rend cela possible sans flags cachés. |
| Onglets terminaux dans les Espaces | Un terminal peut être épinglé, rangé, retrouvé via la barre de commande | MEDIUM | Dépend du modèle d'onglets existant. Décider si un terminal peut être favori/épinglé ; recommander oui pour les onglets, non pour les favoris (une cible Herdr n'est pas une URL). |
| Badges et notifications d'agent | Voir « bloqué », « terminé » sans regarder chaque pane | MEDIUM | Via `events.subscribe` (`pane.agent_status_changed`, `pane.agent_detected`). Attention : événements non rejoués, abonnements par pane, statuts `done`/`idle` locaux au client. P2 après le socle terminal. |
| Ouverture de liens du terminal dans Orbe | Un lien dans une sortie s'ouvre en onglet ou en Peek, avec validation http(s) | LOW-MEDIUM | `addon-web-links` + validation main ; ne jamais laisser une page web décider d'un privilège. |
| Diagnostic et « safe mode » | Désactiver les modules pour démarrer propre, réactiver ensuite | MEDIUM | Différenciateur de fiabilité ; P2, mais le modèle de modules doit le permettre. |
| Vie privée locale | Aucun télémétrie, aucun cloud, socket local, activation explicite | LOW | Cohérent avec le positionnement Orbe. À expliciter dans l'UI d'activation. |
| Français d'abord | Un terminal utilisable en français, pas une UI anglaise par défaut | LOW | i18n existante. |

### Anti-Features — à ne pas construire

| Feature | Pourquoi c'est demandé | Pourquoi c'est problématique | Alternative |
|---|---|---|---|
| Store / marketplace de modules en M1 | « Comme VS Code » | Surface d'attaque énorme, signature, sandbox, revue, mises à jour, support ; contredit « modules internes d'abord » | Registre interne livré avec Orbe ; API externe plus tard, après preuve du socle. |
| Télécharger du code de module à l'exécution | Installer un module sans mise à jour d'Orbe | Exécution de code arbitraire dans un navigateur, chaîne de confiance inexistante | Modules embarqués, versionnés avec l'application. |
| Réimplémenter un PTY ou un multiplexeur dans Orbe | « Pour ne pas dépendre de Herdr » | C'est exactement Herdr ; des années de travail, des bugs de terminal, et cela contredit la décision « Herdr reste externe » | S'attacher au serveur Herdr ; Orbe ne possède que le rendu et le cycle de vie de ses onglets. |
| Afficher la TUI Herdr complète si elle exige un PTY | « Tout dans un onglet » | Ajoute `node-pty`/helper, duplique les barres d'onglets, complique IME/souris/redimensionnement et la promesse « une seule dépendance runtime » | Option A (flux par cible) ; rouvrir la décision si le produit l'exige. |
| Installer, lancer ou mettre à jour Herdr automatiquement | « Pour que ça marche tout seul » | Gestion de version, chemins, permissions, AGPL, support de plusieurs installations ; sort du périmètre | L'utilisateur fournit un serveur déjà lancé ; Orbe explique comment le lancer. |
| Embarquer Herdr dans le paquet Orbe | « Une seule installation » | Licence AGPL-3.0-or-later ou commerciale, taille, mises à jour, responsabilité ; Orbe est MIT | Dépendance externe, détectée et documentée ; aucune copie de code Herdr dans le dépôt. |
| Gérer les panes/workspaces Herdr dans Orbe | « Plus intégré » | Duplique Herdr, crée deux sources de vérité, casse la répartition des responsabilités | Herdr gère ses panes ; Orbe gère ses onglets et affiche un flux par cible. |
| Exposer le terminal aux pages web ou aux extensions | « Pour automatiser » | Une page pourrait lire/écrire un shell local ; violation de la frontière de confiance | Page interne uniquement, IPC validé, aucun bridge exposé aux pages. |
| Terminal dans une fenêtre de navigation privée | « Cohérence » | Le terminal n'est pas isolé par profil ; cela donnerait une fausse impression d'isolation | Refuser ou marquer explicitement « terminal global à la machine », désactivé en incognito. |
| Persister le scrollback et l'historique des panes sur disque | « Reprendre où on était » | Les sorties peuvent contenir des secrets ; Herdr lui-même désactive `pane_history` par défaut pour cette raison | Herdr possède la reprise ; Orbe ne stocke que la cible et le titre. |
| Écrire le presse-papiers via OSC 52 sans consentement | « Pratique » | Un programme distant peut exfiltrer ou piéger le clipboard | Demander, ou refuser par défaut ; réglage explicite. |
| Toujours démarrer le terminal / précharger xterm | « Ouvrir plus vite » | Coût mémoire et démarrage pour un module que l'utilisateur n'utilise peut-être pas | Chargement à l'ouverture du premier onglet terminal. |
| Un processus séparé ou un extension host par module en M1 | « Isolation parfaite » | Complexité de RPC, packaging, debug ; VS Code le fait pour des extensions tierces, pas pour deux modules internes | Modules internes dans le main, avec cycle de vie et containment ; le renderer du terminal est déjà un processus séparé. |
| SSH / machines distantes en M1 | « Herdr le fait » | Multiplie les chemins d'erreur, l'authentification et le support | Plus tard, après le local. |
| Support Windows du terminal en M1 | « Orbe est cross-platform » | Herdr Windows est en beta ; ConPTY et chemins différents ; l'auteur est sur macOS | macOS d'abord, Windows ensuite. |
| Recherche/scrollback réimplémentés par Orbe | « Un vrai terminal » | Herdr et xterm ont déjà leurs modèles ; deux scrollbacks divergent | xterm buffer + `addon-search` si nécessaire ; Herdr reste la source pour ses panes. |
| Migration de runtime pendant le milestone modules | « Tant qu'on y est » | Deux chantiers à haut risque en parallèle ; la migration n'a pas de critère de succès prouvé | Garder Electron pour M1 ; traiter la migration comme un spike séparé. |

## Feature Dependencies

```text
Socle de modules
    ├──requires──> Registre + manifeste
    ├──requires──> Persistance/réglages (store.normalize, SETTABLE)
    ├──requires──> Cycle de vie activate/deactivate
    ├──requires──> Seam d'onglet interne (ensureView, tab.internal, UI_PRELOAD)
    └──requires──> IPC namespacé + validation expéditeur

Terminal/Herdr
    ├──requires──> Socle de modules
    ├──requires──> xterm.js vendorisé (6.0 + addons)
    ├──requires──> Découverte/attache Herdr (terminal session control)
    ├──requires──> Modèle d'onglets Orbe + persistance des cibles
    ├──requires──> Priorité clavier / commandes (commands, shortcuts, menu)
    ├──requires──> Reconnexion/superviseur de processus
    └──requires──> Diagnostic + états d'erreur

Badges/notifications d'agent ──enhances──> Terminal/Herdr
Recherche terminal ──enhances──> Terminal/Herdr
Vue scindée terminal ──enhances──> Terminal/Herdr (et dépend de panes.js)
Modules paint/notes ──requires──> Socle de modules
API de plugins externe ──requires──> Socle de modules + modèle de sécurité + signature

Migration runtime ──conflicts──> Stabilisation du milestone modules
Extensions Chrome ──conflicts──> Tauri 2/WKWebView (non réalisable sur macOS)
Adblock ──conflicts──> Tauri 2/WKWebView (pas d'interception portable)
Profils ──conflicts──> Tauri 2 macOS (data_directory non supporté)
```

### Notes de dépendance

- **Le socle de modules doit précéder le terminal** : sans registre, activation, persistance et containment, le terminal serait un cas particulier codé en dur, non réutilisable pour paint/notes.
- **Le seam d'onglet interne doit être utilisé tel quel** : créer une vue terminal hors de `ensureView` la rendrait invisible à la veille, au split, aux extensions et à la capture. C'est un anti-pattern documenté dans `ARCHITECTURE.md`.
- **La priorité clavier dépend de `commands.js`/`shortcuts.js`/`menu.js`** : les accélérateurs de menu interceptent avant le renderer. Il faut lister les conflits (⌘W, ⌘T, ⌘1-9, ⌃⇥, ⌃1-9, etc.) et décider lesquels restent actifs terminal focus.
- **La reconnexion dépend de Herdr, pas d'Orbe** : Orbe ne peut pas restaurer un processus tué. Il peut seulement se réattacher à un serveur vivant ou recréer un onglet. Le produit doit le dire clairement.
- **Les badges d'agent dépendent de `events.subscribe`** : les événements ne sont pas rejoués ; il faut un `session.snapshot` à la reconnexion et des abonnements par pane. Ne pas promettre un statut global temps réel en M1.
- **Le module terminal et le profil de navigation sont orthogonaux** : Herdr est global à la machine, pas par profil Chromium. Un onglet terminal dans un Espace à profil B donne accès au même shell que dans l'Espace à profil A. À assumer et à afficher.

## MVP Definition

### Launch With (M1)

Le minimum pour valider « modules optionnels + terminal utilisable au quotidien ».

- [ ] **Socle de modules** — registre, volet Réglages, activation explicite désactivée par défaut, persistance, chargement paresseux, désactivation propre, containment d'erreur, commandes contribuées, i18n, diagnostic minimal.
- [ ] **Découverte et attache Herdr** — session/socket/chemin binaire, test de connexion, `terminal session control`, gestion des erreurs absentes/injoignables.
- [ ] **Onglet terminal interne** — création/fermeture/renommage, placement dans le modèle d'onglets, persistance de la cible, restauration après relance, pas de scrollback persisté.
- [ ] **Rendu xterm.js** — vendorisé, police monospace, truecolor, alt screen, redimensionnement fit, fallback sans WebGL, performance TUI.
- [ ] **Clavier/IME/clipboard** — touches spéciales, Option=Meta, composition CJK, copier/coller, sélection malgré souris, politique OSC 52.
- [ ] **Reconnexion** — superviseur, backoff, bannière, réessai, résolution de cible après relance, message clair si le serveur a redémarré.
- [ ] **Sécurité** — activation avec avertissement, page interne uniquement, IPC validé, spawn sans shell, aucun accès page/extension, titres/liens sanitizés.
- [ ] **Non-régression** — démarrage module off mesuré, aucun require module off, tests selftest activation/désactivation, raccourcis Arc inchangés.

### Add After Validation (M1.x)

- [ ] Badges/notifications d'agent via événements Herdr — déclencheur : le terminal est utilisé quotidiennement et l'auteur rate des passages à `blocked`.
- [ ] Recherche dans le buffer xterm (`addon-search`) — déclencheur : les sorties longues deviennent pénibles à parcourir.
- [ ] Réglages de police/taille/scrollback — déclencheur : confort quotidien.
- [ ] Ouverture de liens du terminal dans Orbe — déclencheur : usage réel de liens dans les sorties.
- [ ] Vue scindée avec un terminal — déclencheur : le split web existant est utilisé avec le terminal.
- [ ] Sessions Herdr nommées / plusieurs sessions — déclencheur : plusieurs projets.
- [ ] Accessibilité (screen reader) — déclencheur : Orbe reste public.
- [ ] Windows — déclencheur : Herdr Windows stable et validation sur machine réelle.

### Future Consideration (M2+)

- [ ] Modules paint watercolor et notes — après validation du socle.
- [ ] API de plugins externe — après un modèle de permissions, signature, sandbox et mise à jour.
- [ ] Herdr distant via SSH — après le local.
- [ ] Migration éventuelle de runtime — après un spike de parité concluant, jamais en parallèle du socle.

### Explicitly NOT in M1

Paint, notes, marketplace, API externe, installation/lancement/mise à jour de Herdr, bundling Herdr, gestion native des panes Herdr, SSH, terminal Windows, persistance du scrollback, télémétrie, migration runtime.

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---|---|---|---|
| Registre + activation/désactivation | HIGH | MEDIUM | P1 |
| Chargement paresseux mesuré | HIGH | MEDIUM | P1 |
| Réglages/persistance des modules | HIGH | LOW-MEDIUM | P1 |
| Attache Herdr (`terminal session control`) | HIGH | HIGH | P1 |
| Onglet terminal + cycle de vie | HIGH | MEDIUM-HIGH | P1 |
| xterm.js rendu fidèle | HIGH | MEDIUM-HIGH | P1 |
| Clavier + IME + Option/Meta | HIGH | HIGH | P1 |
| Copier/coller + OSC 52 | HIGH | MEDIUM | P1 |
| Reconnexion/erreurs | HIGH | HIGH | P1 |
| Sécurité/activation | HIGH | HIGH | P1 |
| Diagnostic | MEDIUM | MEDIUM | P1-P2 |
| Redimensionnement | HIGH | MEDIUM | P1 |
| Souris/reporting | MEDIUM-HIGH | MEDIUM | P1-P2 |
| Badges/notifications agent | MEDIUM | MEDIUM | P2 |
| Recherche | MEDIUM | LOW | P2 |
| Réglages police/scrollback | MEDIUM | LOW | P2 |
| Liens terminal vers Orbe | MEDIUM | LOW-MEDIUM | P2 |
| Split terminal | MEDIUM | MEDIUM | P2 |
| Sessions nommées | MEDIUM | MEDIUM | P2 |
| Accessibilité | MEDIUM | MEDIUM | P2 |
| Windows | HIGH (produit) | HIGH | P3 (M1) |
| API externe / marketplace | HIGH (vision) | VERY HIGH | P3 |
| Paint/notes | MEDIUM | MEDIUM | P3 |

## Migration de runtime — analyse de parité

### Verdict par cible

| Cible | Verdict | Raison principale |
|---|---|---|
| **Rester sur Electron 44** | **Recommandé pour M1 et M2** | Seule option qui préserve aujourd'hui l'ensemble extensions + adblock + profils + certificats + WebContentsView. Le coût est connu. |
| **Tauri 2 + WKWebView (macOS)** | **NO-GO pour un navigateur** | Pas d'extensions Chrome, pas d'interception réseau portable pour l'adblock, pas de profils par data directory sur macOS, contrôle limité des certificats, pas de Widevine, multi-webview instable. Orbe perdrait trois promesses du README. |
| **Tauri 2 + WebView2 (Windows)** | **Partiel seulement** | Extensions navigateur opt-in et adblock via COM natif sur Windows, mais aucune parité macOS ; deux moteurs à certifier ; multi-webview instable ; APIs de session/certificats différentes. Inacceptable comme stratégie cross-platform. |
| **Rust + CEF (`cef-rs`)** | **MAYBE, à prouver par spike** | Seule voie qui garde Chromium embarqué et la cohérence macOS/Windows. Mais CEF ne supporte qu'un sous-ensemble des API `chrome.*` ; l'extension host et l'UI d'extensions seraient à reconstruire. Coût et risque très élevés. |
| **Servo 0.1** | **NO-GO** | API d'embedding pré-1.0, couverture web partielle, pas de WebExtensions, pas de render-to-texture fiable. Pas un moteur de navigateur généraliste en 2026. |
| **Tauri v3 + backend CEF optionnel** | **À surveiller** | Alpha au printemps 2026 ; pourrait changer la donne, mais aucune base de décision aujourd'hui. |

### Classification des fonctionnalités existantes

Légende : **MUST** = parité non négociable ; **DEGRADE** = peut être différé ou simplifié ; **DROP** = peut disparaître.

| Fonctionnalité | Verdict | Pourquoi | Complexité Tauri 2 | Complexité Rust + CEF |
|---|---|---|---|---|
| Barre latérale, Espaces, épinglés, dossiers, favoris, glisser-déposer | MUST | C'est l'identité du produit ; renderer réutilisable | HIGH (multi-webview instable) | HIGH |
| Onglets web, `WebContentsView`, split, Peek, veille, archive | MUST | Modèle central du navigateur ; le renderer seul ne suffit pas | VERY HIGH / partiel | HIGH |
| Profils isolés, cookies, connexions, favoris par profil, incognito | MUST | Promesse de vie privée et d'isolation ; les profils sont dans le README | HIGH (data_directory macOS non supporté ; issue ouverte) | MEDIUM (RequestContext CEF) |
| Extensions Chrome : installation vérifiée, `chrome.*`, side panel, debugger, boutons | MUST | Fonctionnalité phare du README ; sans elle Orbe n'est plus Orbe | **NO-GO macOS**, partiel Windows | **VERY HIGH et partiel** (CEF ne couvre qu'un sous-ensemble de `chrome.*`) |
| Mots de passe chiffrés + remplissage + import/export | MUST | Fonction de sécurité attendue ; `safeStorage` est remplaçable par le keychain OS | HIGH (keychain OK, autofill/engine à refaire) | HIGH |
| Adblock/traqueurs 24k domaines + exceptions par site | MUST | Positionnement vie privée ; 24k domaines et décision par requête | **NO-GO macOS**, HIGH Windows | MEDIUM (request handler) |
| Import Arc (Espaces, épinglés, favoris, mots de passe, relances) | DEGRADE | Différenciateur d'adoption, pas de correction du navigateur ; peut être différé après migration | MEDIUM | MEDIUM |
| Easels, notes, médias, captures | DEGRADE | Fonctions riches mais indépendantes du moteur ; peuvent attendre | LOW-MEDIUM | LOW-MEDIUM |
| Téléchargements, reprise, quarantaine, PDF | MUST (base) / DEGRADE (reprise, quarantaine) | Un navigateur doit télécharger et ouvrir un PDF ; les raffinements peuvent attendre | MEDIUM | MEDIUM |
| Certificats HTTPS, exceptions, certificats client, auth HTTP | MUST | Sécurité de navigation ; sans cela Orbe n'est pas un navigateur sûr | HIGH / partiel | MEDIUM |
| Protocole `orbe://`, pages internes, IPC validé | MUST | Toute l'UI et la frontière de confiance en dépendent | MEDIUM | MEDIUM |
| Médias PiP, capture, impression, recherche, zoom, DevTools | MUST basique / DEGRADE avancé | Un navigateur doit imprimer, chercher, zoomer ; PiP/capture peuvent attendre | MEDIUM | LOW-MEDIUM |
| Petite fenêtre, navigation privée, multi-fenêtres | MUST / DEGRADE | Arc-like et multi-fenêtres partagées ; incognito doit rester | MEDIUM | MEDIUM |
| Thèmes, sons, animations, i18n | MUST (identité) | Peu coûteux à préserver, fort effet perçu | LOW | LOW |
| Mises à jour vérifiées SHA-256, installation manuelle | DEGRADE | Aujourd'hui manuel ; une migration peut améliorer avec un updater signé | LOW (plugin updater) | HIGH |
| DRM Widevine (optionnel `ORBE_DRM=1`) | DROP ou DEGRADE | Déjà optionnel ; WKWebView ne fait que FairPlay, CEF exige CDM+VMP | **NO-GO macOS WKWebView** | HIGH |
| Build Windows | MUST à terme | Orbe est distribué sur Windows ; la parité macOS/Windows est nécessaire | HIGH (deux moteurs) | MEDIUM-HIGH |
| Build Linux | DROP | Non distribué aujourd'hui | LOW | LOW |

### Parity blockers non négociables

1. **Extensions Chrome.** C'est le bloqueur absolu sur macOS : WKWebView n'expose pas d'API d'extensions Chrome, et WebView2 n'en offre qu'une version opt-in côté Windows. CEF ne fournit qu'un sous-ensemble des `chrome.*` et laisse l'hôte gérer l'UI, l'installation et le debugger. Sans un spike qui charge réellement Dark Reader, uBlock Origin Lite et CSS Peeper, toute migration est un pari produit.
2. **Adblock et filtrage réseau.** Orbe bloque par `session.webRequest.onBeforeRequest`. Tauri/Wry n'a pas d'API portable d'interception (issue #4899) ; WKWebView n'a pas d'équivalent Wry aux content blockers ; un proxy local serait un contournement lourd. CEF a un request handler, mais il faut réécrire la logique.
3. **Profils et sessions.** Les partitions `persist:orbe-<profileId>` sont le cœur de l'isolation. Tauri ne propose pas de profil par data directory sur macOS (issue #9285) ; CEF le fait avec `CefRequestContext`, mais il faut recâbler cookies, permissions, téléchargements, extensions et mots de passe.
4. **Certificats et auth.** `setCertificateVerifyProc`, les exceptions en mémoire, les certificats client et l'auth HTTP sont des fonctions de navigateur. Tauri n'expose pas d'équivalent complet ; CEF le peut, mais c'est du travail natif.
5. **Remplissage de mots de passe.** Le coffre est portable (keychain OS), mais le bridge de page, la détection d'origine et le remplissage dépendent du moteur et de son modèle d'injection.
6. **Modèle multi-vues.** `WebContentsView` + positionnement + split + Peek + veille n'a pas d'équivalent stable dans Tauri 2 (multi-webview derrière `unstable`). CEF est plus proche, mais il faut réécrire `window.js`, déjà le point fragile du dépôt.

### Critères de kill / spike de migration

Avant toute décision de migration, un spike jetable doit prouver, sur macOS et Windows :

- charger et utiliser trois extensions réelles (Dark Reader, uBlock Origin Lite, CSS Peeper) avec `chrome.tabs`, `chrome.webRequest`, `chrome.storage`, side panel et popup ;
- bloquer une requête publicitaire tierce sur une vraie page, avec exception par site ;
- isoler deux profils (cookies, connexions, favoris) et une session incognito ;
- afficher une erreur de certificat, accepter une exception en mémoire, gérer un certificat client ;
- positionner plusieurs vues dans une fenêtre, avec split et Peek ;
- télécharger, mettre en quarantaine et reprendre un fichier ;
- lire une vidéo Widevine (si la parité DRM est retenue).

Si l'un de ces points échoue sans correctif crédible, la migration est un NO-GO, quelle que soit la qualité du reste.

### Recommandation de séquencement

1. **M1/M2 : rester sur Electron.** Le socle de modules et le terminal n'ont aucun besoin de la migration et seraient ralentis par elle.
2. **Après M1 : spike de parité** sur CEF (pas Tauri) si la migration reste une ambition. Le renderer (HTML/CSS/JS) est réutilisable ; le main process, les sessions, les extensions et le packaging sont à réécrire.
3. **Ne pas choisir Tauri 2 pour un navigateur** tant que les extensions, l'adblock et les profils ne sont pas résolus sur macOS. Tauri reste pertinent pour des apps web classiques, pas pour ce produit.
4. **Surveiller Tauri v3 + CEF**, mais ne pas fonder de roadmap dessus avant une version stable.

## Competitor Feature Analysis

| Feature | VS Code (terminal intégré) | Herdr / Herdr Studio | Obsidian | Orbe (plan) |
|---|---|---|---|---|
| Modèle d'extension/module | Extension host séparé, activation events, extensions intégrées | Plugins externes + socket API | Plugins communautaires, Restricted Mode par défaut | Registre interne, modules désactivés par défaut, chargement paresseux |
| Terminal | xterm.js, onglets, splits, profils, recherche | Multiplexeur serveur, workspaces/tabs/panes, agents | Pas de terminal natif | xterm.js + attache Herdr, onglets Orbe |
| Persistance des sessions | Terminaux locaux liés à la fenêtre | Serveur persistant, détache/reattache | N/A | Herdr possède les PTY, Orbe se réattache |
| Isolation | Processus extension séparé | Serveur/client, socket local | Plugins dans le même processus | Modules internes dans le main, renderer terminal séparé |
| Navigation web | Non | Non | Non | Oui, c'est le produit |
| Vie privée | Télémétrie VS Code | Pas de télémétrie Herdr | Plugins non sandboxés | Locale, sans télémétrie, activation explicite |

## Open Questions / Gaps

- **Schéma exact de `terminal.frame` et `terminal.input`** : la doc stable décrit les types et le base64 ANSI, pas les champs complets. `terminal.input`, `terminal.resize`, `terminal.scroll` et `terminal.release` n'ont pas de payload documenté. Spike obligatoire avant de figer le plan ; sinon, fallback documenté sur `pane.send_text`/`pane.send_keys`.
- **TTY ou non pour `terminal session control`** : la doc ne le dit pas. Un essai avec stdio pipe est nécessaire. Si un TTY est exigé, l'option A tombe et il faut rouvrir la décision PTY.
- **Sémantique des frames** : état complet initial puis deltas ANSI (probable d'après la doc d'attache directe) ou frames complètes à chaque fois ? Cela change l'écriture xterm et le coût.
- **Redimensionnement** : `terminal.resize` suffit-il, ou faut-il respawn le controller à chaque changement de taille ? La recherche tierce recommande le respawn, ce qui peut faire clignoter le terminal.
- **Souris** : faut-il laisser xterm envoyer les séquences de souris via `terminal.input`, ou traduire en `terminal.mouse` ? Les deux chemins existent ; il faut choisir et tester avec Herdr et avec des TUI qui capturent la souris.
- **Priorité clavier** : la liste exacte des raccourcis Orbe à conserver terminal focus n'est pas décidée. Les accélérateurs de menu Electron interceptent avant le renderer ; il faut un audit `commands.js`/`menu.js`/`shortcuts.js`.
- **IME xterm.js 6 dans Electron 44** : les défauts documentés sont-ils corrigés en 6.0.0 ou faut-il des workarounds ? Tests CJK réels nécessaires.
- **Vendoring xterm.js sans build** : confirmer que `lib/xterm.js` et les builds UMD des addons (fit, webgl, unicode11, clipboard, search) se chargent en `<script>` classique dans une page `orbe://` avec la CSP actuelle.
- **Herdr AGPL** : Orbe ne copie pas de code Herdr et ne l'embarque pas ; la communication par CLI/socket doit rester la seule dépendance. Faire valider la distribution si un bridge ou du code dérivé est envisagé.
- **Parité CEF** : le sous-ensemble `chrome.*` de CEF est le risque n°1 d'une migration ; aucun chiffre officiel récent ne permet de conclure sans spike.
- **Widevine** : la parité n'est pas exigée aujourd'hui (option `ORBE_DRM=1`), mais la décision de la conserver ou de l'abandonner doit être explicite si une migration est lancée.

## Sources

- Herdr, *Concepts* — https://herdr.dev/docs/preview/concepts/ (HIGH pour le modèle serveur/client, workspaces/tabs/panes ; préversion)
- Herdr, *Socket API* — https://herdr.dev/docs/preview/socket-api/ (HIGH pour l'inventaire des méthodes ; MEDIUM pour les schémas non publiés)
- Herdr, *CLI Reference* (stable 0.9.5) — https://herdr.dev/docs/cli-reference/ (HIGH pour `terminal attach`, `terminal session control/observe`, frames base64, takeover, timeouts)
- Herdr, *Session state* — https://herdr.dev/docs/preview/session-state/ (HIGH pour détache/restauration, pane_history opt-in, reprise des agents)
- Herdr, *Configuration* — https://herdr.dev/docs/preview/configuration/ (MEDIUM pour scrollback, keybindings, IME macOS, notifications)
- Herdr, dépôt GitHub — https://github.com/herdrdev/herdr (HIGH pour l'existence et la licence AGPL-3.0-or-later/commerciale)
- Herdr, *Herdr Studio* — https://web.archive.org/web/20260911051551/https://powerfooi.github.io/herdr-studio/ (MEDIUM, client tiers : bridge + socket binaire non documenté)
- Herdr, recherche tierce sur le socket — https://github.com/mkellerman/herdex/blob/HEAD/docs/research/herdr-socket-api.md (MEDIUM, utile pour les gaps : pas d'événement global de sortie, pas de resize absolu, contrôle via CLI)
- xterm.js, *Terminal API* — https://xtermjs.org/docs/api/terminal/classes/terminal/ (HIGH pour `write`, `input`, `resize`, `onData`, `onBinary`, `onResize`, `onTitleChange`, `onBell`, `attachCustomKeyEventHandler`)
- xterm.js, README et releases — https://github.com/xtermjs/xterm.js (HIGH pour 6.0.0, `lib/xterm.js`, `lib/xterm.mjs`, CSS, addons ; MEDIUM pour le détail des versions d'addons)
- xterm.js, discussions script-tag — https://github.com/xtermjs/xterm.js/discussions/4621 (MEDIUM pour l'usage UMD sans bundler)
- xterm.js, défauts IME documentés par des intégrateurs — https://github.com/xtermjs/xterm.js/issues/6161, https://github.com/xtermjs/xterm.js/issues/5012 (MEDIUM, rapports d'applications, pas doc officielle)
- Tauri 2, *Webview Versions* — https://v2.tauri.app/reference/webview-versions/ (HIGH pour WKWebView/WebView2/WebKitGTK et leurs limites)
- Tauri 2, *Develop* — https://v2.tauri.app/develop/ (MEDIUM, pas de détails multi-webview)
- Tauri 2, *Updater* — https://v2.tauri.app/plugin/updater/ (HIGH pour la signature d'updates et les artefacts)
- Tauri, issue #9285 (profils navigateur) — https://github.com/tauri-apps/tauri/issues/9285 (MEDIUM, data_directory non supporté sur macOS)
- Tauri, issue #4899 (web request callbacks) — https://github.com/tauri-apps/tauri/issues/4899 (MEDIUM, absence d'interception portable)
- Tauri, discussion #14273 (multi-webview `add_child`) — https://github.com/orgs/tauri-apps/discussions/14273 (MEDIUM, fonctionnalité unstable/non documentée)
- Tauri, issue #13224 (protocoles personnalisés par webview) — https://github.com/tauri-apps/tauri/issues/13224 (MEDIUM, gap de sécurité des custom protocols)
- Microsoft, `AreBrowserExtensionsEnabled` — https://learn.microsoft.com/dotnet/api/microsoft.web.webview2.core.corewebview2environmentoptions.arebrowserextensionsenabled (HIGH pour Windows seulement)
- CEF, extension support issue #1947 — https://github.com/chromiumembedded/cef/issues/1947 (MEDIUM, sous-ensemble des API `chrome.*`)
- `cef-rs` — https://github.com/tauri-apps/cef-rs (MEDIUM, bindings Rust actifs, CEF 152 ; couverture à valider)
- Servo embedding — https://crates.io/crates/servo, https://www.phoronix.com/news/Servo-Embed-Crates-LTS (MEDIUM, expérimental, pas de WebExtensions)
- VS Code, extension host — https://github.com/microsoft/vscode-docs/blob/main/api/advanced-topics/extension-host.md (HIGH pour l'isolation et les activation events)
- Obsidian, plugin security — https://help.obsidian.md/Extending+Obsidian/Plugin+security (HIGH pour Restricted Mode et l'absence de sandbox)
- Electron, `safeStorage` et `session` — https://www.electronjs.org/docs/latest/api/safe-storage, https://www.electronjs.org/docs/latest/api/session (HIGH pour les API actuellement utilisées)
- Orbe, codebase — `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/CONCERNS.md`, `src/main/*` (HIGH pour l'inventaire réel, les tailles et les dépendances)

---

*Feature research for: Orbe — modules optionnels, terminal Herdr, parité de migration*
*Researched: 2026-10-24*
