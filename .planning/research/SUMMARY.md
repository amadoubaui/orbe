# Project Research Summary — Orbe

**Project:** Orbe
**Domain:** navigateur de bureau Electron 44 (Chromium 152) à barre latérale ; milestone « socle de modules optionnels + Terminal/Herdr » ; évaluation d'une sortie d'Electron vers Rust
**Researched:** 2026-10-24
**Confidence:** MEDIUM — HIGH sur le code d'Orbe, Electron et les versions ; MEDIUM sur Herdr (surface « preview ») ; MEDIUM/LOW sur les estimations de portage.

## Executive Summary

Orbe n'est pas un projet greenfield : c'est un navigateur Electron 0.15.5 (61 modules de main process, 22 133 lignes, sans framework ni bundler) dont le milestone ajoute deux briques et une question d'architecture. Les experts construisent ce type de socle comme un « module host » à la VS Code, mais **in-process** : des manifestes statiques en code, un registre qui ne charge aucune entrée au démarrage, un `require()` paresseux à l'activation, une façade étroite injectée au module et un contrat `activate() → dispose()`. Le terminal doit être un onglet interne au sens du modèle d'onglets existant (`ensureView`, `kind`, preload dédié, canaux IPC dédiés), pas une fenêtre tierce ni une page `orbe://app/` réutilisant le pont générique `window.orbe`.

La pile recommandée est volontairement minimale : **Electron 44.9.3** (patch de sécurité dans la même majeure), **xterm.js 6.0.0 vendorisé** et **Herdr 0.9.5+ comme serveur externe**. Une décision produit reste ouverte et conditionne la phase Terminal : rendre la **TUI Herdr complète dans un PTY** (choix exprimé par l'utilisateur ; nécessite `node-pty`, deuxième dépendance runtime) ou consommer le flux **NDJSON `terminal session control/observe`** (pas de PTY, mais API preview et Orbe doit reconstruire l'UI des panes). La recherche est partagée trois contre un en faveur du NDJSON, mais ARCHITECTURE recommande le PTY. Recommandation de synthèse : **TUI + PTY**, car c'est la seule voie qui respecte « Herdr gère ses workspaces/tabs/panes » et le CLI stable, sous réserve d'un spike de 1 à 2 jours et d'un amendement explicite de la contrainte « xterm.js seule dépendance runtime ».

Les risques ne sont pas là où on les attend. Le risque n°1 est **le modèle d'onglets** (veille, archive, reopen, crash, `sendState`, `chrome.tabs`), pas xterm.js. Le n°2 est **la frontière de confiance** : le terminal est la première page interne qui affiche du contenu produit par un processus local non maîtrisé. Le n°3 est **la surface Herdr**, non contractuelle et en preview. Le n°4 est le **chargement paresseux annulé** par un `require` au démarrage. Enfin, la migration Rust est un **NO-GO sans ambiguïté** : aucune voie ne conserve les extensions Chrome sur macOS, Widevine, les profils et le multi-webview stable sans 9 à 15 mois-personne minimum et des pertes fonctionnelles assumées. L'échéance séparée à ne pas manquer est l'**EOL d'Electron 44 le 2 mars 2027**.

## Key Findings

### Recommended Stack

Rester sur Electron et livrer le socle de modules avec xterm.js vendorisé. Aucune dépendance runtime supplémentaire n'est nécessaire **si** l'intégration Herdr retenue est le flux NDJSON ; elle devient `node-pty` **si** la TUI Herdr dans un PTY est confirmée. Ne pas ajouter de bundler : tous les fichiers sont vendorisés et chargés depuis les pages internes.

**Core technologies :**

- **Electron 44.9.3** — runtime applicatif ; passage depuis 44.7.0 dans la même majeure (Chromium 152.0.7977.167, Node 24.22.0), correctifs de sécurité sans rupture d'API. EOL de la branche 44 le **2 mars 2027** ; Electron 45.0.0 (Chromium 156.0.8078.48) est sorti le 21 octobre 2026 mais doit être un chantier dédié.
- **JavaScript ES2022 / CommonJS, sans framework ni transpilation** — contrainte du dépôt ; le `require` paresseux est l'outil naturel du lazy loading.
- **Registre de modules maison** — manifestes statiques en code (`id`, `titleKey`, `entry`, `page`, `preload`, `defaultEnabled: false`, `capabilities`, `commands`, schéma de réglages) ; état persisté sous `settings.modules` ; aucune entrée chargée au boot.
- **xterm.js `@xterm/xterm` 6.0.0** — émulation terminal, sortie synchronisée (DECSET 2026) ; renderer canvas supprimé, DOM par défaut, WebGL via addon.
- **`@xterm/addon-fit` 0.11.0** — redimensionnement ; `@xterm/addon-webgl` 0.19.0 optionnel, activé après mesure seulement. `addon-web-links` 0.12.0 et `addon-serialize` 0.14.0 sont différés.
- **`node-pty` 1.1.0 (conditionnel)** — PTY natif indispensable à la TUI Herdr ; MIT, prébuilds N-API (indépendants de l'ABI Electron), `spawn-helper` macOS, `conpty.dll` + `OpenConsole.exe` Windows. À vendoriser dans `src/main/vendor/node-pty/`, hors asar, avec signature du helper. **Ne pas l'ajouter si le flux NDJSON est retenu.**
- **Herdr 0.9.5+** — serveur externe fourni par l'utilisateur ; Orbe ne l'installe pas, ne le démarre pas et ne l'arrête pas. Communication par CLI/socket local uniquement, aucune bibliothèque embarquée.

**Contraintes de version critiques :** aligner le build DRM castlabs (`44.5.1+wvcus` actuellement) avant toute montée ; ne pas compter sur un bundle UMD xterm 6 (voir décision) ; anticiper la suppression des méthodes synchrones `safeStorage` dans Electron 46 (voir migration et dettes).

### Expected Features

**Must have (table stakes) :**

- Registre + manifestes, découverte dans Réglages, **désactivé par défaut** et activation explicite avec avertissement de risque.
- Chargement paresseux mesuré : aucun `require` d'entrée, aucun CSS/JS xterm dans la coque, aucun coût au démarrage module off.
- Persistance de l'état et des réglages ; réglages validés côté main ; conservation des réglages à la désactivation.
- Cycle de vie `activate` / `deactivate`, containment d'erreur (`failed` visible, réessai, jamais de crash du navigateur), commandes contribuées et i18n FR/EN.
- Découverte et attache Herdr (binaire, session, socket, version), préflight sans démarrage implicite, états d'erreur explicites (binaire absent, serveur arrêté, session inconnue, cible périmée, protocole incompatible).
- Onglet terminal interne dans le modèle Orbe : création/fermeture/renommage, cible persistée, restauration après relance, pas de scrollback persisté.
- Rendu xterm fidèle (monospace, truecolor, alt screen, fit, fallback DOM), clavier fiable (touches spéciales, Option=Meta configurable, IME/CJK), copier/coller et sélection malgré la souris.
- Reconnexion avec backoff, bannière et bouton Réessayer ; jamais de « session terminée » quand le pane vit encore.
- Sécurité : page interne uniquement, preload dédié, IPC validé par identité exacte du `webContents`, spawn sans shell, liens `http(s)` seulement, titres traités comme du texte.
- Diagnostic exportable sans secret.

**Should have (differentiators) :**

- Sessions qui survivent à la fermeture d'Orbe (Herdr possède les PTY, Orbe se réattache).
- Modules réellement à coût nul, mesuré et documenté — application directe de la Core Value.
- Composition par utilisateur (terminal, puis paint/notes) sans flags cachés.
- Onglets terminaux dans les Espaces, épinglables, retrouvables via la barre de commande.
- Ouverture des liens du terminal dans Orbe (onglet ou Peek).
- Badges/notifications d'agent (`blocked`, `done`) — P2, dépend des événements Herdr non rejoués.

**Defer (M2+) :**

- Modules paint watercolor et notes — après validation du socle.
- API de plugins externe / marketplace — nécessite signature, permissions, sandbox (`utilityProcess`), mise à jour.
- Herdr distant via SSH ; sessions nommées multiples ; split terminal ; recherche dans le buffer ; accessibilité complète.
- Support terminal Windows — Herdr Windows en bêta, surface non documentée.
- Persistance du scrollback, démarrage automatique de Herdr, embarquement de Herdr, gestion native des panes, terminal en navigation privée, migration de runtime en parallèle du milestone.

### Architecture Approach

Le socle suit un registre de manifestes sans code chargé au démarrage, avec des entrées CommonJS chargées à la première utilisation et une façade `ModuleHost` étroite. `OrbeWindow.ensureView()` reste **le seul** créateur de vues ; le terminal obtient une petite branche `kind === 'terminal'` (page, preload, session UI par défaut), pas un second système de vues. Les octets du terminal circulent par des canaux dédiés `term:*` avec backpressure, jamais par le dispatcher générique `orbe` ni par `sendState`. Le main possède l'état et résout l'identité Herdr ; le renderer ne fournit jamais un `tabId`, un chemin de binaire ou des arguments.

**Major components :**

1. **`src/main/modules/registry.js`** — manifestes, états d'activation, wrappers de commandes, validation des réglages, route `mod:` ; ne connaît ni Herdr ni xterm.
2. **`src/main/modules/host.js`** — façade injectée (`createModuleTab`, `closeModuleTab`, `tabForWebContents`, `registerModuleIpc`, settings, logs) ; le module ne touche jamais `OrbeWindow` ni `store` directement.
3. **`src/main/window.js`** — branche terminal dans `ensureView`, `layout`, `sendState`, `close`/`deleteTabs`, veille ; god object de 5 055 lignes à modifier chirurgicalement.
4. **`src/main/store.js`** — `settings.modules`, `kind: 'web' | 'terminal'`, normalisation et version de schéma ; ne persiste jamais le contenu terminal, seulement une cible logique.
5. **`src/renderer/modules/terminal/`** — `terminal.html` (CSP stricte), `terminal.js` (xterm + fit + WebGL optionnel), vendor xterm ; chargé uniquement à l'ouverture d'un onglet.
6. **`src/preload/terminal.js`** — pont minimal allowlisté (`connect`, `input`, `resize`, `ack`, `onData`, `onState`, `openLink`, clipboard) ; pas de `window.orbe`, pas de `send` générique.
7. **Adaptateur Herdr (`herdr.js` / `HerdrSession`)** — transport interchangeable TUI/PTY ou NDJSON ; préflight, version, spawn, write, resize, kill, machine d'état. Cette abstraction permet de changer de surface sans toucher xterm, l'IPC ni le modèle d'onglets.

**Règles structurantes :** session UI par défaut (jamais la session du profil de l'Espace) ; `trusted` non accordé à la vue terminal ; `ipcMain.on('term:*')` vérifie `ok(e)` **puis** l'appartenance exacte du `webContents` à une session terminal ; tailles bornées (`cols` 2..500, `rows` 2..200) ; aucun `sendSync` ; aucune sortie terminal dans `orbe.json`, les backups ou les logs.

### Critical Pitfalls

1. **Les onglets terminaux ne rentrent pas dans le modèle d'onglets web** — `veille` endort et détruit la vue, `⌘W` archive, `⇧⌘T` recharge `tab.url`, un crash affiche `error.html`, `sendState` envoie URL/favicon/loading. Ajouter `kind`, un registre runtime séparé, exclure de la veille ou traiter l'endormissement comme un détachement, re-résoudre la cible au reopen, et vérifier que `chrome.tabs` exclut les terminaux.
2. **La frontière de confiance est élargie** — toutes les pages `orbe://app/` sont « trusted » et reçoivent `window.orbe`. Réutiliser ce pont donnerait à une page interne compromise le contrôle des panes et l'accès à `settings:`, `pw:`, etc. Preload dédié, canaux dédiés, URL exacte, map `webContents.id`, tests de refus depuis une page web, une page interne non-terminale et un onglet interne ordinaire.
3. **Le chargement paresseux est annulé** — un `require` en tête de `main.js`, l'ajout de xterm à `shell.html`, l'enregistrement des handlers IPC au boot ou l'ajout des commandes au menu font payer le module même désactivé. Test `require.cache`, mesure du démarrage, `AbortController` et `dispose()` idempotent, aucun handler en double après deux cycles.
4. **Surface Herdr non contractuelle et cycle de vie ambigu** — distinguer pane fermé, serveur arrêté, observateur déconnecté, EOF du CLI et takeover ; machine d'état explicite, re-résolution des pane ids, `--takeover` uniquement sur action utilisateur, jamais de `server stop`. Si le NDJSON est retenu : frames différentielles (`seq`, `full`), resynchronisation sur trou, drainage permanent du `stdout` (déconnexion à 30 s sinon), backpressure par watermark.
5. **PTY et packaging** (si TUI retenue) — prébuilds N-API, `spawn-helper` à signer, ConPTY Windows, test depuis l'app fabriquée et non depuis `npm start`, `PATH` minimal du Finder, échec propre du module sans exception non rattrapée.
6. **Clavier intercepté par le menu natif** — `⌃D`, `⌃1…⌃9`, `⌃⇧…` n'arrivent jamais à xterm, tandis que `⌘W`, `⌘T`, `⌘L` doivent rester des commandes Orbe. Utiliser `wc.setIgnoreMenuShortcuts(!input.meta)` dans `before-input-event`, router `⌘C`/`⌘V` vers `term.getSelection()`/`term.paste()`, tester AZERTY et touches mortes. `macOptionIsMeta` par défaut à `false` pour le public français.

## Implications for Roadmap

Structure recommandée en six phases, alignée sur les portes de PITFALLS et les sous-milestones d'ARCHITECTURE. La Phase 0 peut démarrer immédiatement ; les décisions Herdr et xterm doivent être tranchées avant la Phase 2.

### Phase 0 : Portes, CI et spikes

**Rationale :** la recherche exige quatre portes avant la première ligne du module Terminal : surface Herdr éprouvée (G1), frontière IPC définie (G2), registre réellement paresseux (G3), CI capable de voir le travail (G4). Aujourd'hui, la CI ne se déclenche pas sur `pull_request`, ne lance ni Playwright ni les tests natifs, et deux hypothèses structurantes (surface Herdr, packaging xterm) ne sont pas vérifiées.
**Delivers :** CI sur `pull_request` avec `node --test`, selftest Electron et suite Playwright minimale macOS ; serveur Herdr factice et fixtures ; montée Electron 44.7.0 → 44.9.3 ; spike Herdr de 2 à 3 jours (transcript réel, version minimale, décision TUI/PTY vs NDJSON) ; spike xterm 6 vendorisé dans une page `orbe://` (MIME `.mjs`, CSP, rendu) ; si PTY, smoke test `node-pty` dans l'app packagée ; test de refus IPC.
**Addresses :** enablers, aucune feature utilisateur.
**Avoids :** C3, C7, T1, M1, G4 ; évite de découvrir les blocages en Phase 2.

### Phase 1 : Socle de modules

**Rationale :** le terminal dépend du registre, de l'activation, de la persistance et du containment ; paint et notes réutiliseront le même socle. Cette phase doit être livrable seule, sans Herdr.
**Delivers :** `registry.js` / `manifests.js` / `host.js` ; manifestes statiques ; `require` paresseux ; contrat `activate() → dispose()` ; `settings.modules` + normalisation + version de schéma ; volet Modules dans Réglages avec activation explicite et avertissement ; wrappers de commandes et `menu.refresh()` ; route `mod:` ; état `failed` contenu ; diagnostic ; i18n ; préparation du seam `kind` et, si nécessaire, extraction d'un `TerminalPane` pour ne pas gonfler `window.js`.
**Addresses :** tout le table stakes du socle ; débloque paint/notes.
**Avoids :** C1, C2, C4, C5, C6, C7, G3, M6.

### Phase 2 : Tranche verticale Terminal (macOS)

**Rationale :** c'est la phase la plus risquée (PTY + Herdr + xterm + clavier). Un seul onglet fonctionnel de bout en bout prouve l'intégration avant de multiplier les sessions.
**Delivers :** xterm 6 + addon-fit vendorisés ; `terminal.html`, preload dédié, `terminal.js` ; branche `kind:'terminal'` dans `ensureView` ; session UI par défaut ; canaux `term:*` avec validation d'identité ; préflight Herdr (chemin configurable, chemins connus, `status server`, session, `--version`, jamais de démarrage) ; si TUI, `pty.spawn(herdr, ['--session', …], { cols, rows, env })` avec `TERM=xterm-256color`, `COLORTERM=truecolor`, env allowlisté ; resize ; un onglet : attacher, taper, redimensionner, fermer ; états d'erreur et bouton Réessayer ; politique clavier (⌘ vs ⌃), Option=Meta, copier/coller, OSC 52 désactivé, liens `http(s)` ; tests de sécurité.
**Addresses :** découverte/attache, onglet interne, rendu xterm, clavier/clipboard de base, états d'erreur, sécurité.
**Avoids :** T1, T2, T6, T7, T10, C3, M1, M2 ; partie de T8.

### Phase 3 : Cycle de vie multi-onglets et reprise

**Rationale :** une fois la tranche verticale validée, le risque se déplace vers le modèle d'onglets : veille, archive, reopen, splits, crash, quit. Ces chemins sont les plus faciles à oublier et les plus coûteux en pertes de session.
**Delivers :** map multi-sessions, un client Herdr par onglet, affectation workspace/tab pour éviter les combats de resize ; close/delete/quit avec kill des clients et zéro processus orphelin, jamais `server stop` ; politique de veille (exclusion ou détachement + resynchronisation) ; `⇧⌘T` réattache la cible logique et gère « pane id is stale » ; reprise après crash/reload ; backoff et machine d'état ; contrôle de flux (ack window, `pty.pause()`/`resume()` ou watermark NDJSON, coalescing, conscience de la limite xterm de 50 Mo) ; comportement des splits et du drag-and-drop, explicitement supporté ou interdit ; `sendState` avec `kind`/titre/statut ; `chrome.tabs` exclut les terminaux ; sons, animations, zoom refit.
**Addresses :** cycle de vie, reconnexion, robustesse, performance.
**Avoids :** T3/T4/T5 (ou leurs équivalents PTY), T8, M4, C4, C6.

### Phase 4 : Durcissement UX, sécurité et mesures

**Rationale :** « livré » signifie sécurité prouvée, UX cohérente et performances mesurées, pas seulement « ça s'affiche ».
**Delivers :** audit sécurité complet (injection HTML, OSC 8, titres longs, presse-papiers, liens, CSP, rédaction des diagnostics) ; réglages police/taille/scrollback/session/chemin/renderer avec validation ; thème synchronisé avec l'Espace ; mesures (latence frappe→écho < 30 ms, débit en rafale, mémoire après 100 Mo, démarrage module off, 1/4/8 terminaux) ; WebGL seulement si justifié et libéré explicitement ; accessibilité (`screenReaderMode`, focus, contraste) ; packaging macOS avec signature du helper, test depuis le Finder ; checklist « Looks Done But Isn't ».
**Addresses :** diagnostic, réglages, performance, accessibilité.
**Avoids :** T9, T10, M2, m1–m5.

### Phase 5 : Plateformes et extras (M1.x, optionnel)

**Rationale :** Herdr Windows est en bêta et `terminal session` n'y est pas documenté ; les extras n'ont de valeur qu'après un usage quotidien.
**Delivers :** gate Windows (module masqué ou « non pris en charge » tant qu'un test réel n'est pas concluant) ; badges/notifications d'agent ; recherche dans le buffer ; sessions nommées ; liens terminal vers Orbe ; split terminal ; accessibilité avancée.
**Addresses :** features P2/P3.
**Avoids :** M5, promesses Windows non tenues.

### Tracks hors milestone

- **Montée Electron 45/46 avant le 2 mars 2027** — chantier dédié ; vérifier castlabs `+wvcus`, les tests extensions/DRM et migrer `passwords.js` vers `safeStorage` asynchrone (suppression des méthodes synchrones dans Electron 46).
- **Spike Rust éventuel après la Phase 5**, uniquement si les déclencheurs de la section migration sont réunis.
- **Modules paint/notes en M2**, sur le socle de la Phase 1.
- **API de plugins externe** : modèle de confiance séparé (signature, permissions, `utilityProcess`), jamais un `require` piloté par l'état.

### Phase Ordering Rationale

- Le socle de modules passe en premier parce qu'il est la dépendance de toutes les features et qu'il valide le lazy loading sur un cas réel sans introduire Herdr.
- La Phase 0 existe parce que deux hypothèses structurantes ne sont pas prouvées et parce que la CI actuelle ne peut pas valider le travail.
- La tranche verticale (Phase 2) est isolée de la Phase 3 : `window.js` est un god object de 5 055 lignes ; on prouve l'intégration sur un onglet avant de toucher veille, archive, splits et crash.
- La sécurité IPC doit être terminée avant de déclarer le module livré ; elle n'est pas un polish.
- La migration Rust ne doit jamais être une phase parallèle : elle entre en conflit direct avec la stabilisation du socle.

### Research Flags

Phases nécessitant une recherche ou un spike approfondi lors du planning :

- **Phase 0** — surface Herdr (TUI/PTY vs NDJSON), payloads réels, version minimale ; packaging xterm 6 en ESM sur `orbe://`, MIME `.mjs`, `UI_TYPES`.
- **Phase 2** — `node-pty` dans Electron 44 packagé, signature du `spawn-helper`, IME/AZERTY xterm 6, `setIgnoreMenuShortcuts` ; prévoir un spike de 1 à 2 jours avant l'implémentation complète.
- **Phase 3** — multi-client Herdr, propriété du contrôleur, géométrie des panes, contrôle de flux et resynchronisation.
- **Phase 5** — uniquement si Windows est poursuivi.

Phases aux patterns standards (recherche approfondie non nécessaire) :

- **Phase 1** — les frontières sont documentées dans `.planning/codebase/ARCHITECTURE.md` et le code ; utiliser le plan de composants d'ARCHITECTURE.md.
- **Phase 4** — durcissement et mesures ; les patterns sont connus, la valeur est dans l'exécution et les tests.

## Migration hors Electron

### Go / No-go

**NO-GO pour ce milestone, et probablement NO-GO tant que les extensions Chrome et le DRM restent des fonctions validées.** Aucune option Rust n'est « facile » :

- **Tauri 2** utilise WKWebView sur macOS (pas de Chromium) et WebView2 sur Windows : extensions Chrome impossibles sur macOS, Widevine perdu, pas de mondes JS isolés comparables aux preloads Electron, profils macOS partiels, multi-webview derrière `unstable`.
- **wry sans Tauri** a les mêmes moteurs et limites, plus la réécriture du cadre applicatif.
- **Rust + CEF** est la seule voie qui conserve Chromium, mais `cef-rs` est en 0.x, les binaires pèsent 128 à 166 Mo compressés, et le chargement d'extensions est en transition depuis la dépréciation de `LoadExtension` (CEF 130).
- **Servo 0.7** n'est pas un moteur de navigation généraliste.
- **Tauri 3 alpha + `tauri-runtime-cef` alpha** est la piste la plus prometteuse à terme, mais non planifiable aujourd'hui (alpha d'octobre 2026, sandbox Windows absente selon la doc).

**Si Rust est recherché pour la performance**, la seule voie à faible risque est **Electron + Rust ciblé** (sidecar `utilityProcess` ou addon napi-rs) : 2 à 6 semaines-personne, incrémental, réversible, sans quitter Chromium.

### Effort par option

| Option | Moteur | Effort solo | Parité | Verdict |
|---|---|---|---|---|
| Electron 44.9.3 | Chromium 152 | 0 (montée 44.7→44.9 : quelques jours) | Complète | **GO** |
| Electron + Rust ciblé (sidecar / napi-rs) | Chromium 152 | 2–6 semaines-personne | Complète | **GO si besoin mesurable** |
| Tauri 2.12.5 + wry 0.57.1 | WKWebView / WebView2 | 38–60 semaines-personne (~9–14 mois) | Extensions macOS impossibles, Widevine perdu, profils partiels, multi-webview `unstable` | **NO-GO** |
| wry sans Tauri | WKWebView / WebView2 | 42–68 semaines-personne (~10–16 mois) | Idem + réécriture du framework | **NO-GO** |
| Rust + CEF (`cef-rs` 156.1.0) | Chromium 156 | 40–65 semaines-personne (~9–15 mois) pour un portage partiel ; 12–24+ mois pour une parité Tauri 3 CEF ; 18–36 mois pour un shell maison | Extensions non équivalentes, Widevine non confirmé, distribution lourde | **NO-GO maintenant ; à reconsidérer si les déclencheurs passent** |
| Tauri 3 alpha + `tauri-runtime-cef` | Chromium | Non planifiable | Alpha, sandbox Windows absente | **NO-GO** |
| Servo 0.7 | Servo | 60+ semaines-personne et parité non atteinte | Pas d'extensions, pas de DRM, compatibilité web incomplète | **NO-GO** |

**Lecture :** même la voie la moins chère qui conserve Chromium coûte 9 à 15 mois-personne, soit 5 à 8 fois le budget probable du milestone modules + terminal. La question « peut-on partir d'Electron facilement ? » a une réponse sans ambiguïté : non.

### Bloqueurs de parité (non négociables)

1. **Extensions Chrome sur macOS** — WKWebView n'a aucun modèle d'extension ; WebView2 n'offre qu'un ajout opt-in de dossiers unpacked, sans store ni UI ; CEF ne couvre qu'un sous-ensemble de `chrome.*`.
2. **Widevine** — FairPlay sur WKWebView, PlayReady sur WebView2, Widevine non prouvé sur CEF.
3. **Sessions et profils** — `session.fromPartition('persist:orbe-…')` n'a pas d'équivalent cross-platform stable ; `data_directory` est Windows-only, `incognito` non persistant sur macOS.
4. **Multi-webview stable** — `WebContentsView` + re-parenting + overlays + vues d'appoint n'ont pas d'équivalent stable dans Tauri 2 (feature `unstable`, deadlock Windows documenté).
5. **Adblock et interception réseau** — `webRequest.onBeforeRequest` n'a pas d'API portable ; WKWebView et WebView2 demandent deux implémentations.
6. **Mondes JS isolés et remplissage de mots de passe** — wry n'expose pas `WKContentWorld` ; WebView2 n'a pas d'API équivalente.
7. **Coffre de mots de passe et identité de signature** — `safeStorage`/Keychain/DPAPI + Touch ID ; un changement de moteur ou d'identité de signature casse l'ACL Keychain. Un chemin « export chiffré → ré-import » testé est obligatoire.
8. **Tests et intégrations OS** — 1 500+ vérifications selftest, 504 Playwright, 175 API d'extensions, toutes Electron-specific ; `tauri-driver` ne couvre pas macOS.
9. **Chaîne de mise à jour et données utilisateur** — updater Tauri signé obligatoire, release-pont nécessaire, cookies/sessions Chromium non importables.

### Déclencheurs de réévaluation

Rouvrir la décision **seulement si** l'un de ces ensembles est vrai :

1. **Tauri 3 stable** et `tauri-runtime-cef` stable (pas alpha), sandbox inclus, documentation de production.
2. Une **stratégie de chargement d'extensions** validée sur CEF 156+ (aujourd'hui `LoadExtension` déprécié, `--load-extension` retiré de Chrome 137+).
3. **Widevine** disponible sur au moins une plateforme cible via le runtime choisi.
4. Les **mondes JS isolés** sont exposés (indispensable pour le preload mots de passe).
5. Le **multi-webview** est stable (bounds, focus, z-order, re-parenting, overlays).
6. Les **sessions/profils et l'interception réseau** ont une API cross-platform.
7. Un **outil de migration coffre/profils** est démontré et un **harnais de test macOS** existe.
8. Ou une **décision produit explicite** d'abandonner les extensions Chrome et Widevine, et d'accepter WebKit — auquel cas le projet n'est plus « Orbe tel qu'il est » mais un nouveau produit.

Si un déclencheur se réalise, budgéter un **spike de 2 à 3 semaines** avec des critères de sortie concrets : charger trois extensions réelles, bloquer une requête avec exception par site, isoler deux profils + incognito, gérer une erreur de certificat, positionner plusieurs vues avec split/Peek, télécharger avec quarantaine/reprise, et lire une vidéo Widevine si la parité DRM est retenue. Si un point échoue sans correctif crédible, la migration reste un NO-GO.

### Ce qui peut réellement être incrémental

- Le **renderer HTML/CSS/JS** se réutilise partiellement, mais `window.orbe`, les origines, la CSP et le protocole interne doivent être réimplémentés.
- Les **services sans état UI** (PTY, updater, keychain, proxy adblock) peuvent devenir des sidecars Rust appelés par Electron : c'est le seul vrai strangler pattern.
- Le **module terminal** peut migrer en sidecar `portable-pty` si `node-pty` pose problème.
- Le **cœur navigateur** (état, onglets, sessions, extensions) ne migre pas par morceaux : le propriétaire de l'état, le pont IPC et le modèle de vues changent ensemble.

### Échéance séparée

**Electron 44 atteint son EOL le 2 mars 2027.** Planifier la montée vers Electron 45/46 (45.0.0 = Chromium 156.0.8078.48) avant cette date, aligner castlabs, et migrer `safeStorage` vers les API asynchrones avant Electron 46. Ce chantier est indépendant du débat Rust et ne doit pas être repoussé par lui.

## Décisions à confirmer

### D1. Surface d'intégration Herdr — TUI + PTY vs flux NDJSON

C'est la décision la plus importante du milestone. Les fichiers de recherche ne sont pas d'accord, et **les deux appellent leur option préférée « A »** : ne pas se fier aux lettres, seulement aux descriptions ci-dessous.

| Critère | TUI Herdr complète dans un PTY | Flux NDJSON `terminal session control/observe` |
|---|---|---|
| Ce qu'Orbe affiche | Le client Herdr complet : sidebar, workspaces, tabs, panes, TUIs à l'intérieur | Le contenu ANSI d'un pane/terminal/agent ; Orbe doit construire l'UI des workspaces/tabs/panes |
| Dépendance runtime | xterm.js + **`node-pty`** (natif, vendorisé) | xterm.js seulement |
| Statut de l'API | CLI Herdr stable, documenté pour un terminal interactif ; la TUI est le produit | **Preview** ; champs de `terminal.input/resize/scroll/mouse` non documentés ; un seul contrôleur |
| PTY requis | Oui | Non (mais l'exigence éventuelle d'un TTY n'est pas vérifiée) |
| Redimensionnement | `pty.resize` → SIGWINCH ; le dernier client focalisé contrôle la géométrie | `terminal.resize` ou respawn ; le dernier client à interagir contrôle |
| Cycle de vie | Un process client par onglet ; le serveur survit au détachement | Sémantique observer/controller, déconnexion d'un observateur lent à 30 s |
| Périmètre Orbe | Faible : onglets + spawn/kill + préflight | Élevé : réimplémenter une partie de l'UI Herdr |
| Adéquation au choix utilisateur | Exacte | Partielle : l'onglet Orbe = un pane, pas la TUI Herdr |
| Fichiers de recherche | ARCHITECTURE recommande cette voie | FEATURES, STACK et PITFALLS supposent cette voie |

**Recommandation : TUI + PTY pour M1.** C'est la seule option qui respecte les deux phrases du milestone — « la TUI Herdr est rendue par xterm.js » et « Herdr gère ses workspaces/tabs/panes » — sans réécrire Herdr ni dépendre d'une API preview. Le CLI Herdr est la frontière de compatibilité stable ; le NDJSON est une surface jeune dont les payloads ne sont pas publiés. Coûts à accepter explicitement : `node-pty` comme deuxième dépendance runtime, signature du `spawn-helper`, un process Herdr par onglet, et deux barres d'onglets visibles (celles d'Orbe et celles de Herdr).

**Condition :** spike de 1 à 2 jours prouvant, sur l'app packagée macOS, que `node-pty` charge dans Electron 44, que `herdr` se résout depuis le Finder, que la TUI se rend, accepte le clavier et se redimensionne dans xterm 6. Si le spike échoue, ou si l'utilisateur refuse la deuxième dépendance runtime, basculer sur le NDJSON et redéfinir la feature M1 comme « contenu terminal par cible », pas « TUI Herdr ».

**Conséquence sur les pitfalls :** PITFALLS T1/T3/T4/T5 (frames `seq`/`full`, déconnexion à 30 s, `terminal.closed`) décrivent la surface NDJSON ; ils deviennent post-MVP si la TUI est retenue. Leurs équivalents PTY restent : backpressure `pty.pause()/resume()`, cycle de vie du process client, combats de géométrie multi-client. PITFALLS M5 (« ne pas ajouter de PTY ») vise le **fallback de shell local sous Windows**, pas le PTY qui héberge le client Herdr sur macOS ; cette formulation doit être précisée dans le plan. Dans tous les cas, concevoir `HerdrSession` comme un adaptateur de transport pour pouvoir changer de surface sans toucher xterm, l'IPC ni le modèle d'onglets.

### D2. Packaging xterm.js 6 — ESM vs UMD, `.mjs` et `UI_TYPES`

Les quatre fichiers ne disent pas la même chose :

| Fichier | Affirmation | Statut |
|---|---|---|
| STACK.md | `main: lib/xterm.js` (CJS), `module: lib/xterm.mjs`, **pas de champ UMD/browser** | Le plus précis (métadonnées npm inspectées) |
| PITFALLS.md | xterm 6 n'a plus de bundle UMD ; `.mjs` risque une erreur MIME car `UI_TYPES` ne type que `.html`, `.js`, `.css` | Cohérent avec STACK |
| ARCHITECTURE.md | `lib/xterm.js` est un build UMD (~489 Ko), chargement `<script>` classique | **Contredit STACK et PITFALLS ; à corriger** |
| FEATURES.md | `lib/xterm.js` utilisable en `<script>` classique ; UMD des addons à vérifier | Hypothèse non vérifiée, ambiguë |

**Position de synthèse :** considérer qu'il n'y a **pas de bundle UMD garanti** pour le cœur xterm 6. `lib/xterm.js` est le point d'entrée CommonJS et ne se charge pas tel quel comme script classique dans un navigateur. La voie robuste, qui fonctionne quel que soit le contenu réel du paquet :

1. Vendoriser `lib/xterm.mjs` (et le CSS), avec LICENSE, version et SHA-256 du tarball npm.
2. Faire de `terminal.html` une page à `<script type="module" src="terminal.js">`, avec `import { Terminal } from './vendor/xterm/xterm.mjs'` et les imports d'addons.
3. Ajouter `.mjs` à `UI_TYPES` dans `sessions.js` avec `text/javascript; charset=utf-8` — sinon `net.fetch(file://…)` peut servir un MIME que Chromium refuse pour un module.
4. Vérifier la CSP (`script-src 'self'`) et ajouter un test qui charge `terminal.html` et échoue sur toute erreur MIME/module.
5. Inspecter chaque addon séparément : s'il est ESM-only, vendoriser `.mjs` et l'importer ; s'il est UMD, le global fonctionne, mais ne pas le supposer sans inspection.
6. **Ne pas ajouter de bundler.** Si un `.mjs` pose problème, le renommer en `.js` et le charger via `<script type="module">` est acceptable ; le charger comme script classique ne l'est pas.

Cette décision est technique, pas produit : elle se tranche par inspection du tarball au moment du vendoring, mais **doit être tranchée avant la Phase 2** et ARCHITECTURE.md doit être corrigé pour ne pas induire le plan en erreur.

### D3. Amendement de la contrainte « xterm.js seule dépendance runtime »

Si D1 retient la TUI + PTY, PROJECT.md doit passer de « xterm.js première dépendance runtime » à « xterm.js + node-pty », avec la justification : sans PTY, pas de TUI Herdr fidèle. C'est une décision utilisateur, pas une conséquence automatique.

### D4. Périmètre plateforme

macOS d'abord. Herdr documente `terminal attach` comme non natif Windows et ne documente pas `terminal session` sous Windows ; le support Windows est en bêta. Le module doit être masqué ou explicitement « non pris en charge » sous Windows tant qu'un test réel n'a pas validé la surface retenue. Aucun PTY local de secours dans ce milestone.

### D5. Comportement des onglets terminaux

Décider et documenter : un onglet terminal peut-il être épinglé/favori (recommandation : oui pour l'épinglage, non pour les favoris, une cible Herdr n'étant pas une URL) ? Est-il archivable ? ARCHITECTURE dit « pas d'archive » ; PITFALLS propose de conserver une ligne avec sa cible pour le reopen. Position de synthèse : ne jamais passer un onglet terminal par le chemin d'archive/reopen web (`loadURL`) ; si une ligne est conservée, elle porte une **cible logique** re-résolue à l'attachement, jamais un `terminal_id` opaque.

### D6. Points d'environnement à vérifier avant la Phase 0

- **Test runner :** CLAUDE.md impose `vitest run`, tandis que STACK et PITFALLS indiquent que Vitest n'est pas installé et que le dépôt utilise `node:test`/selftest/Playwright. Vérifier `package.json` et les scripts réels ; ne pas figer le plan de tests avant.
- **Licence Herdr :** PITFALLS a vérifié Apache-2.0 via l'API GitHub ; FEATURES mentionne AGPL-3.0-or-later ou commerciale. Orbe ne copie pas de code Herdr et communique par CLI, donc le risque est faible, mais la notice de distribution doit être vérifiée.
- **`macOptionIsMeta` :** défaut `false` pour le public AZERTY français (sinon `[`, `]`, `{`, `}` deviennent inaccessibles) ; réglage explicite dans les préférences.

## Confidence Assessment

| Area | Confidence | Notes |
|---|---|---|
| Stack | HIGH sur les versions, MEDIUM sur les estimations de portage, LOW sur les benchmarks isolés | Versions et dates vérifiées sur les registres et release notes ; efforts à ±40 % ; le benchmark Electron→Tauri est un cas isolé. |
| Features | MEDIUM | Documentation officielle Herdr/xterm/Electron/Tauri, mais plusieurs points de protocole Herdr restent en preview et à valider par spike. |
| Architecture | HIGH sur Electron et le socle de modules, MEDIUM sur Herdr | Code du dépôt lu directement ; API Herdr jeune. |
| Pitfalls | HIGH sur le code d'Orbe et les docs Electron/Tauri, MEDIUM sur Herdr, LOW sur l'IME et WebGL | Les affirmations négatives ont été recoupées ; les retours IME sont communautaires. |

**Overall confidence:** MEDIUM — les fondations Electron et le socle de modules sont solides, mais la surface d'intégration Herdr (et donc une partie des pitfalls terminal) n'est pas contractuelle et doit être prouvée par spike.

### Gaps to Address

- **Surface Herdr et payloads réels** (`terminal.frame`, `terminal.input/resize/scroll/mouse`, exigence éventuelle d'un TTY) : spike en Phase 0, transcript et fixtures en CI ; décision D1 avant la Phase 2.
- **Packaging xterm 6 sur `orbe://`** (ESM/MIME/`UI_TYPES`) : inspection du tarball + test de chargement en Phase 0 ; correction d'ARCHITECTURE.md.
- **`node-pty` dans Electron 44 packagé** (prébuilds N-API, `spawn-helper`, signature) : smoke test en Phase 0 si D1 = PTY.
- **IME et clavier AZERTY avec xterm 6 dans Electron 44** : reproduire sur machine réelle avec un clavier français ; les rapports communautaires ne suffisent pas.
- **Support Windows de Herdr** : non documenté ; gate explicite, aucun engagement avant test réel.
- **Licence Herdr** (Apache-2.0 vs AGPL selon les fichiers) : vérifier la notice avant distribution.
- **Test runner** (Vitest vs `node:test`) : vérifier l'état réel du dépôt avant la Phase 0.
- **Estimations de portage** : fourchettes ±40 %, confiance MEDIUM/LOW ; ne pas les utiliser comme engagement.
- **Archive/reopen des onglets terminaux** : trancher en Phase 3 (D5).

## Sources

### Primary (HIGH confidence)

- [Electron Releases — schedule](https://releases.electronjs.org/schedule) et [releases.json](https://releases.electronjs.org/releases.json) — 44.9.3, Chromium 152.0.7977.167, Node 24.22.0 ; 45.0.0 ; EOL 2027-03-02.
- [Electron — Process Model](https://www.electronjs.org/docs/latest/tutorial/process-model), [safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage), [WebContents](https://www.electronjs.org/docs/latest/api/web-contents) — contexte, dépréciation `safeStorage` en Electron 46, `before-input-event`, `setIgnoreMenuShortcuts`.
- [npm — @xterm/xterm](https://registry.npmjs.org/@xterm/xterm/latest), [xterm.js releases](https://github.com/xtermjs/xterm.js/releases), [Terminal API](https://xtermjs.org/docs/api/terminal/classes/terminal/), [flow control](https://xtermjs.org/docs/guides/flowcontrol/) — 6.0.0, `lib/xterm.js` CJS, `lib/xterm.mjs`, suppression du renderer canvas, buffer 50 Mo.
- [Herdr — CLI reference](https://herdr.dev/docs/cli-reference/), [Concepts](https://herdr.dev/docs/preview/concepts/), [Socket API](https://herdr.dev/docs/preview/socket-api/), [Session state](https://herdr.dev/docs/preview/session-state/), [dépôt](https://github.com/herdrdev/herdr) — CLI, `terminal session control/observe`, frames base64, workspaces/tabs/panes, licence à vérifier.
- [node-pty](https://github.com/microsoft/node-pty) et paquet npm 1.1.0 — PTY, prébuilds N-API, `spawn-helper`, ConPTY, `pause`/`resume`.
- [Tauri 2 — WebviewBuilder](https://docs.rs/tauri/latest/tauri/webview/struct.WebviewBuilder.html), [Updater](https://v2.tauri.app/plugin/updater/), [WebDriver](https://v2.tauri.app/develop/tests/webdriver/) — multi-webview `unstable`, signature obligatoire, pas de WebDriver macOS.
- [Tauri — CEF preview](https://deploy-preview-4126--tauri-v2.netlify.app/develop/cef/), [cef-rs](https://github.com/tauri-apps/cef-rs), [CEF builds](https://cef-builds.spotifycdn.com/index.json) — alpha, extensions en transition, binaires 128–166 Mo.
- Code et configuration d'Orbe (commit `3652692`) — `src/main/main.js`, `window.js` (5 055 lignes), `store.js`, `sessions.js`, `commands.js`, `menu.js`, `passwords.js`, `veille.js`, `src/preload/ui.js`, `scripts/build-mac.js`, `package.json`, `.github/workflows/tests.yml`, `.planning/codebase/*` — HIGH, lecture directe.

### Secondary (MEDIUM confidence)

- [Herdr — agent guide](https://herdr.dev/agent-guide.md), [Configuration](https://herdr.dev/docs/preview/configuration/), [Herdex](https://github.com/mkellerman/herdex) — intégration GUI par snapshot + `terminal session control` ; événements non rejoués.
- [Tauri issue #9285](https://github.com/tauri-apps/tauri/issues/9285), [#4899](https://github.com/tauri-apps/tauri/issues/4899), [#11491](https://github.com/tauri-apps/tauri/issues/11491), [discussion #2685](https://github.com/orgs/tauri-apps/discussions/2685) — profils macOS, interception réseau, isolation, extensions impossibles.
- [WebView2 — browser features](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/browser-features), [WebView2Feedback #4828](https://github.com/MicrosoftEdge/WebView2Feedback/issues/4828) — extensions off, pas de Widevine.
- [CEF — extension support](https://github.com/chromiumembedded/cef/issues/1947), [CefExtensionHandler](https://cef-builds.spotifycdn.com/docs/112.2/classCefExtensionHandler.html) — sous-ensemble de `chrome.*`, `LoadExtension` déprécié.
- [Obsidian — plugin security](https://help.obsidian.md/Extending+Obsidian/Plugin+security), [VS Code — extension host](https://github.com/microsoft/vscode-docs/blob/main/api/advanced-topics/extension-host.md) — Restricted Mode, activation events, isolation.
- Rapports IME xterm.js ([#6161](https://github.com/xtermjs/xterm.js/issues/6161), [#5012](https://github.com/xtermjs/xterm.js/issues/5012)) — défauts de composition, à reproduire sur AZERTY.

### Tertiary (LOW confidence)

- [MarkShot v2.0.0](https://github.com/tsubasagit/MarkShot/releases/tag/v2.0.0) — benchmark Electron→Tauri isolé (mémoire et démarrage), non généralisable à un navigateur.
- Documentation Herdr « preview » pour les schémas de frames et le handshake binaire — à traiter comme non contractuel jusqu'au spike.

---

*Research completed: 2026-10-24*
*Ready for roadmap: yes — la Phase 0 peut démarrer ; D1 (surface Herdr) et D2 (packaging xterm) bloquent la Phase 2.*
