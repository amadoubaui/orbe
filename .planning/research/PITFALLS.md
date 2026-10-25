# Pitfalls Research — Orbe : socle de modules, Terminal/Herdr, sortie d'Electron

**Domaine :** navigateur de bureau Electron 44.7 (Chromium 152), brownfield 0.15.5, sans framework ni bundler
**Recherché :** 2026-10-24
**Confiance globale :** HIGH sur le code d'Orbe et les documentations officielles Electron/Tauri/xterm.js ; MEDIUM sur Herdr (surface documentée en « preview ») ; LOW sur les retours communautaires IME et WebGL.

**Méthode :** lecture directe du dépôt (commit `3652692`) ; documentation officielle Electron, Tauri 2, xterm.js ; documentation et code source Herdr (`herdrdev/herdr`, Apache-2.0, v0.9.5 du 2026-10-14). Les affirmations négatives (absence d'API GUI Herdr, absence d'extensions Chrome dans Tauri, absence de WebDriver macOS) sont vérifiées sur au moins deux sources.

---

## Verdict (à lire avant le roadmap)

1. **Migration Rust/Tauri : NON pour ce milestone, et probablement non tant que les extensions Chrome et le DRM restent des fonctions validées d'Orbe.** Les bloqueurs sont listés séparément plus bas. Si Rust est recherché pour la performance ou la sûreté, la seule voie à faible risque est un **composant Rust ciblé** (sidecar ou addon napi-rs), pas une réécriture du shell.
2. **Ne pas commencer le module Terminal avant d'avoir franchi quatre portes** (section « Portes de passage ») : surface d'intégration Herdr choisie, frontière IPC testée, registre de modules réellement paresseux, CI en état de valider le travail.
3. **Le risque numéro un n'est pas xterm.js : c'est le modèle d'onglets d'Orbe.** Un onglet terminal n'est ni une page web, ni une page interne ordinaire. La veille, l'archive, la reprise après crash, `sendState`, les splits et l'API `chrome.tabs` supposent tous une URL, un historique et une session Chromium. Les traiter comme des onglets web normaux produit des pertes de session et des onglets fantômes.
4. **Le risque numéro deux est la surface Herdr.** Il n'existe pas d'API de client graphique documentée. La seule voie programmatique documentée est le CLI `herdr terminal session observe|control` (NDJSON, frames ANSI en base64), qui encapsule un protocole binaire non documenté. La stabilité de cette surface n'est pas contractuelle.
5. **Le risque numéro trois est la frontière de confiance.** Toute page `orbe://app/` est déjà « trusted » et reçoit le pont générique `window.orbe`. Réutiliser ce pont pour le terminal donne à une page interne le droit d'exécuter des commandes dans les panes Herdr. Il faut un preload dédié, des canaux dédiés et une validation qui ne repose pas sur `ok(e)` seul.

---

## Portes de passage (blockers de démarrage)

À traiter avant la première ligne du module Terminal. Chacune est vérifiable.

| Porte | Pourquoi elle bloque | Critère de sortie | Phase |
|---|---|---|---|
| **G1. Surface Herdr choisie et éprouvée** | Il n'y a pas de contrat GUI. `herdr terminal attach` est destiné à un terminal interactif ; `terminal session observe/control` est la seule surface NDJSON documentée. Le protocole binaire du CLI (handshake sur un socket client distinct, messages `ObserveTerminal`/`ControlTerminal`) n'est pas documenté et peut changer sans préavis. | Un spike de 2 à 3 jours : spawn du CLI, réception de `terminal.frame`, envoi de `terminal.input`, resize, release, reconnexion ; capture d'un transcript réel ; décision consignée sur la version minimale de Herdr et la stratégie d'adaptation. | Phase 0 |
| **G2. Frontière IPC du terminal définie et testée** | `ok(e)` ne vérifie que `trusted.has(sender)` et `senderFrame.url.startsWith('orbe://app/')`. Toutes les pages internes sont dans `trusted`. Ajouter un canal terminal au dispatcher générique agrandit la surface d'attaque de tout Orbe. | Un test qui prouve qu'une page `orbe://app/` non-terminale, une page web et un onglet interne ordinaire ne peuvent pas appeler le canal terminal ; un preload dédié, sans `send` générique. | Phase 0/1 |
| **G3. Registre de modules réellement paresseux** | Le dépôt charge déjà 61 modules au démarrage. Un registre qui lit les manifestes en `require`-ant chaque module, ou qui ajoute le terminal à `commands.js`/`menu.js`, annule la promesse « module inactif = coût nul ». | Test automatisé : après démarrage avec tous les modules désactivés, `require.cache` ne contient aucun `modules/*/index.js` ; le temps de démarrage ne bouge pas de plus de la marge définie ; activation/désactivation deux fois de suite ne duplique ni listener ni handler IPC. | Phase 1 |
| **G4. CI capable de voir le travail** | `.github/workflows/tests.yml` ne se déclenche que sur `push` et `workflow_dispatch`, ne lance ni `npm run test:ui` ni `tests/natif`. `CLAUDE.md` documente Vitest, qui n'existe pas. Un module terminal validé seulement à la main ne peut pas être maintenu. | Ajout de `pull_request`, exécution de `node --test`, du selftest Electron et d'une suite Playwright minimale sur macOS ; commandes réelles documentées ; serveur Herdr factice en CI. | Phase 0 |

**Bloqueur de Windows :** Herdr documente `terminal attach` comme disponible sur Linux/macOS, « not native Windows », et ne documente pas `terminal session` sous Windows. Le support Windows de Herdr est en bêta. **Ne pas exposer le module Terminal sous Windows** tant qu'un test réel n'a pas validé la surface retenue. C'est cohérent avec « macOS d'abord » dans PROJECT.md.

---

## Bloqueurs de migration (séparés des risques ordinaires)

Ces points ne sont pas des « risques » : ce sont des **pertes de fonctionnalité validée** ou des **pertes de données** si Orbe quitte Electron pour Tauri/WKWebView/WebView2 sans les traiter.

### BLOCAGE M1 — Extensions Chrome

**Constat :** les extensions sont une fonction validée et testée d'Orbe (CRX3, `chrome.*` maison, `chrome.sidePanel`, `chrome.debugger`, `chrome.tabs` mappés sur les onglets Orbe). Tauri utilise WKWebView sur macOS, qui n'expose aucune API d'extension Chrome. WebView2 possède une API bas niveau d'ajout d'extension, mais Tauri ne l'expose pas et les namespaces `chrome.*` ne sont pas fournis. Orbe devrait réécrire `extensions.js`, `ext-api.js`, `ext-host.js`, `ext-panel.js`, `ext-debug.js` et perdre macOS au passage.

**Verdict :** bloqueur produit. Aucune migration vers Tauri ne peut revendiquer la parité tant que ce point n'est pas résolu par le moteur lui-même.

### BLOCAGE M2 — DRM / Widevine

**Constat :** Orbe livre un moteur castlabs Electron `44.5.1+wvcus` activé par `ORBE_DRM=1`. WKWebView ne lit pas Widevine ; il s'appuie sur FairPlay, dont l'intégration à un WebView embarqué n'est pas garantie. Tauri ne peut pas ajouter Widevine à WKWebView. WebView2/Windows peut lire du DRM selon les configurations, mais Tauri ne le garantit pas.

**Verdict :** bloqueur pour la variante DRM. La version par défaut (sans DRM) n'est pas concernée, mais la fonction existe et est documentée dans le README.

### BLOCAGE M3 — Coffre de mots de passe, `safeStorage` et Touch ID

**Constat :** `src/main/passwords.js` chiffre le coffre avec `safeStorage` et déverrouille avec `systemPreferences.promptTouchID()`. Sur macOS, Electron adosse la clé au Keychain via le service `<produit> Safe Storage` et le compte `<produit> Key` (ici `Orbe Safe Storage` / `Orbe Key`) ; sur Windows, DPAPI. Tauri n'a pas d'équivalent `safeStorage` ; son plugin officiel de secrets est Stronghold, qui est un coffre différent. Aucune migration automatique n'est fournie.

**Deux pièges s'y ajoutent :**

- **Identité de signature.** La build macOS d'Orbe est signée ad hoc (`codesign --force --deep --sign -`). Electron documente qu'une signature absente ou incohérente peut faire redemander le Keychain à chaque mise à jour. À chaque changement d'identité (ad hoc → Developer ID, ou Electron → Tauri), l'ACL Keychain ne correspond plus.
- **Dépréciation Electron 46.** Les méthodes synchrones `safeStorage.isEncryptionAvailable()`, `encryptString()` et `decryptString()` sont dépréciées et **seront supprimées dans Electron 46**. `passwords.js` utilise encore les trois. La migration vers `isAsyncEncryptionAvailable()`, `encryptStringAsync()` et `decryptStringAsync()` (avec `shouldReEncrypt` et `.result`) doit être planifiée indépendamment de Rust.

**Verdict :** bloqueur de données. Un changement de moteur sans outil d'export/ré-import explicite perd le coffre ou déclenche des demandes Keychain incompréhensibles. Ne pas migrer tant qu'un chemin « export chiffré → ré-import » n'est pas testé sur une machine vierge.

### BLOCAGE M4 — Modèle multi-webviews et onglets

**Constat :** Orbe repose sur `BaseWindow` + un `WebContentsView` par onglet, repositionné par le processus principal, avec jusqu'à quatre volets, des vues d'appoint (`SPARES = 3`) partageant le processus de la coque, Peek, drag-and-drop inter-fenêtres et reprise après crash. Tauri 2 ne propose plusieurs webviews dans une même fenêtre que derrière la feature Cargo `unstable` (`Window::add_child`), desktop uniquement, « basically undocumented », avec des limitations par rapport à `WebviewWindow`. Il n'y a pas d'équivalent stable aux child views d'Electron.

**Verdict :** bloqueur structurel. Le portage implique de réécrire `src/main/window.js` (5 055 lignes) et l'architecture de layout, pas de « porter » le fichier.

### BLOCAGE M5 — Sessions, profils, adblock et hooks navigateur

**Constat :** les fonctions cœur utilisent des API sans équivalent portable : `session.fromPartition` (profils, incognito), `webRequest.onBeforeRequest` (bloqueur, un seul listener), `webContents.debugger` (unload shield, `chrome.debugger`), `session.registerPreloadScript` (mots de passe, médias, swipe), `findInPage`, `capturePage`, `print`, `will-download`, `certificate-error`, `login`, `setWindowOpenHandler`, `navigationHistory`, `protocol.handle('orbe')`. WKWebView et WebView2 exposent des primitives différentes ; l'adblock devrait être réécrit par plateforme (content blockers WKWebView, `WebResourceRequested` WebView2), et les preloads en mondes isolés devraient être reconstruits côté Rust/Swift.

**Verdict :** bloqueur fonctionnel. Chaque module listé devrait être re-porté et re-testé ; le risque de régression silencieuse est élevé.

### BLOCAGE M6 — Données utilisateur, cookies et connexions

**Constat :** `app.getPath('userData')` donne `~/Library/Application Support/Orbe` ; Tauri `appDataDir()` donne `~/Library/Application Support/<bundleIdentifier>` (par exemple `org.pixework.orbe`). Les cookies et sessions Chromium (`Partitions/…`) ne sont pas lisibles par WKWebView. Une migration de moteur perd donc les connexions, les sessions et probablement l'historique récent, même si `orbe.json` est copié.

**Verdict :** bloqueur d'expérience utilisateur. Un import de favoris/historique est faisable ; un import de cookies ne l'est pas. Le produit doit l'assumer explicitement ou rester sur Chromium.

### BLOCAGE M7 — Mises à jour, signature et notarisation

**Constat :** `src/main/updates.js` vérifie un SHA-256 publié et laisse l'installation manuelle ; la build macOS est ad hoc, la build Windows non signée. Tauri impose sa propre signature d'updater (clé minisign, « cannot be disabled ») et, pour macOS, une signature Developer ID + notarisation + stapling ; l'archive d'update doit être fabriquée à partir de l'app déjà signée. On ne peut pas réutiliser le schéma SHA-256 actuel, et une installation Electron existante ne peut pas être mise à jour silencieusement vers une app Tauri : il faut une release-pont et un téléchargement manuel.

**Verdict :** bloqueur de distribution. Faisable, mais c'est un chantier de release complet (compte Apple payant, certificat Windows, clés d'updater, pont de migration), pas un effet de bord.

### BLOCAGE M8 — Tests et CI

**Constat :** Orbe s'appuie sur plus de 1 500 vérifications de selftest Electron, 504 vérifications Playwright et 175 vérifications d'API d'extensions. Tauri ne fournit pas de WebDriver macOS : `tauri-driver` supporte Windows et Linux, pas macOS (pas de pilote WKWebView). Les 32 suites Playwright devraient être réécrites ou perdues sur la plateforme principale de l'auteur.

**Verdict :** bloqueur de qualité. Sans harnais équivalent, la migration se ferait à l'aveugle sur macOS.

### Risques ordinaires de migration (non bloquants)

| Risque | Pourquoi ce n'est pas un bloqueur | Atténuation |
|---|---|---|
| Incompatibilités WebKit du shell | Réparable, mais étendu : `-webkit-app-region` (drag de fenêtre), `window.open` utilisé pour les vues d'appoint, `chrome-extension://` privilégié, protocole custom, CSP, APIs `Intl` selon la version de macOS. | Auditer chaque page `src/renderer/*.html` ; remplacer les drag regions par le mécanisme Tauri ; tester sur la plus vieille macOS supportée. |
| Performance non démontrée | Le coût mémoire d'Electron est surtout celui des processus de rendu des pages ; Tauri les remplace par d'autres processus. Le gain de shell est réel mais partiel. | Benchmarker time-to-first-paint, mémoire à 50 onglets, latence clavier avant/après ; ne pas migrer pour une hypothèse. |
| Coût et compétences Rust | 38 à 60 semaines-personne estimées (STACK.md) ; l'auteur est seul. | Sidecar Rust ciblé si un besoin mesurable existe. |
| Intégrations macOS natives | Handoff (`continue-activity`), menu Services, Speech/Substitutions, feuille de partage, Dock menu, enregistrement comme navigateur par défaut, Touch ID, `nativeTheme`. | Les uns ont un équivalent Tauri, d'autres non ; les lister et les tester un par un. |
| Licence et provenance | Herdr est Apache-2.0 (vérifié via l'API GitHub), xterm.js MIT. Un composant séparé ne contamine pas Orbe (MIT). | Conserver LICENSE et notices ; ne pas copier de code Herdr sans vérifier les obligations. |

**Déclencheur de réévaluation (à inscrire au roadmap) :** rouvrir la décision seulement si (a) Tauri ou CEF offre un multi-webview stable et une histoire crédible pour les extensions et Widevine sur macOS, (b) un outil de migration coffre/profils est démontré, (c) un harnais de test macOS existe. Sinon, planifier la montée Electron 44 → 45/46 avant l'EOL du **2 mars 2027** (branche 44 supportée jusqu'à cette date ; dernier correctif 44.9.3 au 21 octobre 2026).

---

## Critical Pitfalls — socle de modules

### C1. Le chargement paresseux est annulé par un `require` au démarrage

**Ce qui casse :** le module est déclaré « désactivé par défaut » mais son code est chargé parce que `main.js`, `commands.js`, `menu.js`, `window.js` ou un autre module le `require` en haut de fichier. Le coût de démarrage est payé même module éteint ; le code du module peut enregistrer des listeners ou des timers au chargement.

**Pourquoi :** le dépôt câble tous les services dans `main.js` avec des `require` en tête et des objets `hooks`. La tentation est d'ajouter `const terminal = require('./modules/terminal')` puis `terminal.configure(...)`, comme les 20 autres modules.

**Comment éviter :**
- Un registre unique (`src/main/modules.js`) avec des manifestes **statiques en code** (`id`, `nom`, `version`, `entry`, `défaut: false`, schéma de réglages). `main.js` ne require que le registre.
- `activate(id)` fait le `require(entry)` à l'activation, appelle `setup(deps)` et retourne un objet `dispose()`.
- Aucun effet de bord au niveau module : pas de `setInterval`, pas de `ipcMain.handle`, pas de `session` hook en haut de fichier.
- Test : avec tous les modules désactivés, `Object.keys(require.cache)` ne contient aucun `src/modules/*/index.js` ; le module n'apparaît pas non plus dans les commandes/menus.

**Signes précoces :** temps de démarrage qui augmente alors que le module est off ; `require.cache` contient le module ; un `console.log` du module apparaît au lancement ; `ipcMain` lève « Attempted to register a second handler » après deux activations.

**Phase :** 1 (socle), vérifié en Phase 2.

---

### C2. La désactivation ne libère ni listeners, ni timers, ni canaux IPC, ni sockets

**Ce qui casse :** activer → désactiver → réactiver duplique les listeners `webContents`, les handlers `ipcMain`, les sockets Herdr et les entrées de menu. Les sorties arrivent en double, les fuites mémoire s'accumulent, et un handler supprimé peut encore recevoir des événements d'un onglet fermé.

**Pourquoi :** CommonJS ne décharge pas un module du `require.cache`. `delete require.cache[...]` recrée une seconde copie et casse les singletons. Orbe n'a pas de convention de disposition pour ses modules ; `window.js` gère la sienne à la main (`dispose`, `gone`).

**Comment éviter :**
- Contrat `activate()` → `{ dispose() }` obligatoire, testé.
- Chaque module possède un `AbortController` : tous les `addEventListener`, timers et sockets sont créés avec `{ signal }` ou enregistrés dans une liste locale.
- Le registre vérifie l'idempotence : deux `activate` sans `dispose` = erreur de programmation, pas un doublon silencieux.
- Les handlers IPC du module sont nommés et retirés avec `ipcMain.removeHandler` / `removeListener`.
- Test de cycle : activer/désactiver deux fois, vérifier zéro listener résiduel et zéro socket ouvert (`process._getActiveHandles()` en test, avec prudence).

**Signes précoces :** double écho dans le terminal après réactivation ; `MaxListenersExceededWarning` ; mémoire qui croît à chaque cycle ; `Attempted to register a second handler`.

**Phase :** 1.

---

### C3. La frontière de confiance est élargie par réutilisation de `trusted` et de `ok(e)`

**Ce qui casse :** une page interne `orbe://app/terminal.html` reçoit `UI_PRELOAD` (`window.orbe.send`) et est ajoutée à `trusted` par `wire()` si `tab.internal === true`. Le dispatcher `ipcMain.handle('orbe')` accepte alors toutes les actions (`settings:`, `pw:`, `easel:`, `lib:`, `update:`…) depuis cette page. Une injection dans la page terminal (sortie d'agent, OSC 8, HTML mal échappé) devient une compromission complète du navigateur. Et si le canal terminal est ajouté au dispatcher générique, n'importe quelle page interne compromise peut piloter Herdr.

**Pourquoi :** `ok(e)` a été conçu pour une seule classe de pages internes, toutes également dignes de confiance. Le terminal est la première page interne qui rend du contenu **fourni par un processus externe** (Herdr, agents, commandes shell). Sa surface d'injection est bien plus grande que celle des réglages ou de la bibliothèque.

**Comment éviter :**
- Un preload dédié `src/preload/terminal.js` exposant uniquement `connect`, `input`, `resize`, `scroll`, `mouse`, `release`, `onFrame`, `onState`, `openLink`. Pas de `send` générique, pas d'accès aux événements `state`/`settings`.
- Des canaux IPC dédiés (`terminal:input`, `terminal:frame`, …) avec un validateur qui vérifie : (1) `senderFrame.url` **exactement** la page terminal, (2) le `webContents` appartient au registre des vues terminal, (3) le module est actif, (4) l'onglet terminal existe encore.
- Ne pas ajouter `terminal:` au routeur par préfixe de `main.js` ; un module séparé installe ses propres handlers.
- Ne pas marquer la vue terminal `trusted` : elle n'a pas besoin du pont UI. Si `ensureView` l'ajoute automatiquement, ajouter une exception explicite `kind === 'terminal'`.
- Test : une page `orbe://app/shell.html`, une page `orbe://app/library.html`, une page web et un onglet interne ordinaire appellent `terminal:input` → refus.

**Signes précoces :** `window.orbe` disponible dans la console de la page terminal ; une action `settings:` réussit depuis le terminal ; `trusted.has(wc)` vrai pour la vue terminal ; `tab.internal` utilisé comme unique discriminant.

**Phase :** 0 (test de la frontière) et 2 (implémentation).

---

### C4. Le modèle d'état ignore les modules, les onglets terminaux et leurs réglages

**Ce qui casse :** `store.normalize()` ne connaît que le schéma actuel. Un réglage de module absent donne `undefined` ; un onglet terminal persisté est traité comme un onglet web (il a une URL `orbe://app/terminal.html`, un historique, une session) ; un module désactivé laisse des onglets orphelins au redémarrage ; l'`internal` global est accordé à tort.

**Pourquoi :** `normalize()` fusionne `DEFAULT_SETTINGS` au premier niveau seulement, répare les onglets par `s.tabs[id]`, les splits, les favoris, et migre l'`internal` par regex d'URL. Tout nouveau champ doit être normalisé dans la même livraison, sinon les anciens `orbe.json` chargent à moitié.

**Comment éviter :**
- Introduire `kind: 'web' | 'terminal'` (et plus tard `note` / `paint`) sur chaque onglet, avec un défaut `web` pour les états existants.
- Un onglet terminal ne porte pas d'URL de site : il porte `{ kind: 'terminal', module: 'terminal', target: { session, workspace, tab, pane } }` ou un identifiant de session Orbe résolu au runtime. Ne pas persister un `terminal_id` Herdr opaque et instable.
- Ajouter une version de schéma et une migration déterministe : `version < 3` → tous les onglets sans `kind` deviennent `web` ; les onglets `kind: 'terminal'` dont le module est inconnu ou désactivé sont conservés comme lignes « module désactivé » **ou** déplacés dans l'archive, jamais rechargés comme pages web.
- Les réglages de modules vivent sous `state.settings.modules[id]`, validés par le schéma du manifeste, avec valeurs par défaut ; ne jamais supprimer les réglages à la désactivation (réactivation = mêmes préférences).
- Test par fixtures : un `orbe.json` v2 avec des onglets normaux, un avec un onglet terminal, un avec un module inconnu.

**Signes précoces :** `tab.url` d'un terminal affiché dans la barre d'adresse ; un onglet terminal rechargé sur une page blanche ; `settings.modules` qui contient des clés non validées ; un onglet terminal qui survit à la désactivation du module et tente de se reconnecter.

**Phase :** 1 (schéma) et 3 (onglets).

---

### C5. Le registre est piloté par l'état, pas par le code

**Ce qui casse :** si le manifeste ou le chemin d'entrée d'un module vient de `orbe.json` (ou, plus tard, d'un plugin externe), une valeur modifiée à la main ou injectée fait `require()` un fichier arbitraire dans le processus principal. C'est une exécution de code non signée, avec les droits du navigateur et l'accès au coffre via `safeStorage`.

**Pourquoi :** la vision « API de plugins externe plus tard » pousse naturellement vers un registre data-driven. Or `require()` d'un chemin fourni par l'utilisateur ou par le réseau est un vecteur d'exécution classique.

**Comment éviter :**
- Pour les modules internes, le manifeste et l'entrée sont **dans le code** (`src/main/modules/registry.js`), pas dans l'état. L'état ne contient que `enabled: boolean` et les réglages validés.
- Si une API de plugins externe arrive, elle devra avoir son propre modèle de confiance (signature, permissions déclaratives, exécution en `utilityProcess`), pas un `require` dans le processus principal.
- Ne jamais résoudre un chemin depuis une valeur de renderer. Le renderer ne fait qu'activer/désactiver un `id` présent dans le registre.

**Signes précoces :** un `entry` ou un `path` dans `orbe.json` ; un `require` dont l'argument vient de `store.state` ; un module chargé depuis `userData`.

**Phase :** 1.

---

### C6. Le coût de démarrage se cache dans le rendu, pas dans le `require`

**Ce qui casse :** le module n'est pas require, mais son CSS/JS est ajouté à `shell.html`, son icône est chargée, ses commandes sont ajoutées à `COMMANDS` et ses entrées au menu. Résultat : le shell paie le prix au premier paint, et le menu doit être reconstruit à chaque activation.

**Pourquoi :** Orbe n'a pas de bundler ni de chargement conditionnel côté renderer ; tout script ajouté à une page est chargé avec elle. `menu.js` ne se reconstruit que lorsque les libellés changent ; il n'a pas de notion de module.

**Comment éviter :**
- Ne rien ajouter à `shell.html` pour le terminal. La page `terminal.html` est une vue séparée, chargée uniquement à l'ouverture d'un onglet terminal.
- Ne pas importer xterm.js depuis `shell.js`, `overlay.js` ou `common.js`.
- Les commandes du module sont enregistrées à l'activation et retirées à la désactivation, avec un `menu.refresh()` explicite ; mesurer le coût d'un rebuild de menu et le limiter aux transitions d'état du module.
- Les icônes de module sont des SVG inline dans la page de réglages, pas des fichiers chargés au démarrage.
- Mesure : `time-to-first-paint` et temps de démarrage à froid avec modules off, dans `tests/performances.js`.

**Signes précoces :** xterm apparaît dans le waterfall de la coque ; le menu contient « Terminal » alors que le module est off ; le démarrage à froid gagne 20 à 50 ms sans module actif.

**Phase :** 1 et 2.

---

### C7. Une activation qui échoue laisse l'application dans un état incohérent

**Ce qui casse :** `activate()` lève parce que `herdr` est absent, le socket est refusé ou le CLI renvoie une erreur. Si l'exception remonte, `process.on('uncaughtException')` de `main.js` la journalise et **continue** : le processus principal reste vivant avec un module à moitié initialisé, des vues orphelines et des handlers partiels. L'utilisateur voit un navigateur qui « bugge » au lieu d'un message clair.

**Pourquoi :** Orbe a délibérément un gestionnaire global qui garde l'application en vie (pour ne pas ouvrir de dialogue natif bloquant pendant les tests). C'est adapté aux erreurs de page, pas à l'initialisation d'un module.

**Comment éviter :**
- `activate()` est une transaction : toute erreur est attrapée par le registre, le module est marqué `failed` avec une raison, ses ressources partielles sont libérées, et l'UI affiche « Terminal indisponible : <raison> ».
- Ne jamais laisser une exception d'activation remonter au handler global. En test, faire échouer le scénario.
- Un module en échec ne doit pas bloquer le démarrage du navigateur ni les autres modules.
- Ajouter un diagnostic exportable (version Herdr, chemin du binaire, chemin du socket, extrait d'erreur) sans secret.

**Signes précoces :** exception `uncaughtException` dans `erreurs.log` au premier lancement du module ; module listé « actif » alors qu'aucun socket n'est ouvert ; navigateur qui continue après une erreur d'initialisation.

**Phase :** 1 (registre) et 2 (terminal).

---

## Critical Pitfalls — Terminal / Herdr

### T1. S'attacher à une surface non contractuelle

**Ce qui casse :** Orbe dépend d'un protocole que Herdr ne documente pas comme API de client graphique. `herdr terminal attach <terminal_id>` est prévu pour un terminal interactif (detach `ctrl+b q`, `--takeover`) ; `herdr terminal session observe|control <target>` est la surface NDJSON documentée, mais elle est décrite dans une documentation « preview » et le CLI encapsule un handshake binaire sur un socket client distinct. Une mise à jour de Herdr peut changer les champs, les raisons de fermeture ou le handshake sans casser son propre TUI.

**Pourquoi :** Herdr est un multiplexeur TUI, pas une plateforme de clients. Sa compatibilité annoncée concerne les versions de CLI/serveur entre eux (« compatible release versions do not need to match »), pas un contrat pour un client tiers. Le pont VS Code existant confirme un « protocol 17 » mais n'est pas une garantie.

**Comment éviter :**
- Utiliser **le CLI** `herdr terminal session observe/control`, pas le protocole binaire interne, pas le socket client. Le CLI est la frontière de compatibilité : il négocie `RenderEncoding::TerminalAnsi` et le handshake à la place d'Orbe.
- Isoler l'adaptateur dans `src/main/modules/terminal/herdr.js` avec une version de protocole explicite et un `minVersion`/`maxTestedVersion` dans le manifeste.
- Au démarrage du module : `herdr --version`, puis vérifier la présence des sous-commandes (`herdr terminal session observe --help` ou un probe équivalent). Si la surface manque, désactiver proprement le module avec un message, pas une exception.
- Capturer un transcript réel (frames, closed, erreurs) dans `tests/fixtures/herdr/` et faire tourner l'adaptateur contre ce transcript en CI.
- Ne pas parser les messages d'erreur en anglais du CLI comme contrat : classer par code de sortie et par motif stable, avec un fallback lisible.

**Signes précoces :** `terminal.frame` sans `seq` ou `full` ; `terminal.closed` avec une raison inconnue ; le CLI imprime `protocol` ou `unsupported encoding` ; une mise à jour Herdr change la forme d'un frame.

**Phase :** 0 (spike) et 2 (adaptateur), 4 (veille de compatibilité).

---

### T2. Le binaire `herdr` et la session ne sont pas résolus comme en développement

**Ce qui casse :** lancé depuis le Finder, un `.app` macOS hérite d'un `PATH` minimal (`/usr/bin:/bin:/usr/sbin:/sbin`). `herdr` installé par Homebrew (`/opt/homebrew/bin`), mise, cargo ou nix n'est pas trouvé. Pire : `npm start` lancé depuis le terminal de l'auteur hérite du `PATH` complet, donc le bug n'apparaît **qu'après la fabrication**. Le CLI peut aussi se connecter à la mauvaise session si `HERDR_SESSION` ou `HERDR_SOCKET_PATH` diffèrent de ceux du shell de l'utilisateur.

**Pourquoi :** Orbe n'a aujourd'hui aucun code de résolution de binaire utilisateur : il appelle des chemins absolus (`/usr/bin/security`, `/usr/bin/sqlite3`, `/usr/bin/xattr`) ou `reg.exe`. `herdr` est le premier binaire **utilisateur** que le processus principal doit lancer.

**Comment éviter :**
- Résolution explicite au premier usage : config `terminal.herdrPath` (chemin absolu choisi par l'utilisateur), sinon recherche dans une liste connue (`/opt/homebrew/bin/herdr`, `/usr/local/bin/herdr`, `~/.local/bin/herdr`, `~/.cargo/bin/herdr`, `~/.local/share/mise/shims/herdr`, `~/.nix-profile/bin/herdr`), sinon `/bin/zsh -lic 'command -v herdr'` avec timeout.
- Valider que le chemin est un fichier exécutable, pas un répertoire, avant de le lancer. Ne jamais accepter un chemin venu du renderer sans confirmation utilisateur.
- Résoudre la session explicitement : `terminal.session` (nom de session Herdr) ou « défaut », et passer `HERDR_SESSION` / `--session` / `HERDR_SOCKET_PATH` de façon cohérente. Ne pas compter sur l'environnement hérité du shell.
- Afficher le chemin résolu et la version dans les réglages du module ; proposer « Choisir le binaire… ».
- Test : lancer l'app fabriquée depuis le Finder (pas depuis le terminal) avant de considérer le module terminé.

**Signes précoces :** `spawn herdr ENOENT` uniquement dans `Orbe.app` ; le terminal fonctionne avec `npm start` et pas après `npm run build` ; deux sessions Herdr différentes selon le mode de lancement.

**Phase :** 2.

---

### T3. Les frames sont différentielles : en perdre une corrompt l'écran

**Ce qui casse :** les frames Herdr portent `seq`, `full`, `width`, `height` et des octets ANSI. Une frame `full: false` n'est valide que si toutes les précédentes ont été appliquées. Si Orbe jette des frames quand l'onglet est caché, si le renderer est lent, ou si un `webContents.send` est perdu (rechargement de la vue), l'écran diverge silencieusement : du texte reste, d'autres manquent, le curseur est au mauvais endroit. L'utilisateur croit que l'agent a produit une sortie incorrecte.

**Pourquoi :** on traite naturellement un flux de terminal comme un flux d'octets continu (ce que fait un PTY), alors que Herdr fournit un flux **stateful** avec un marqueur de resynchronisation.

**Comment éviter :**
- Décoder le base64 dans le processus principal et transmettre un `Uint8Array` au renderer ; appliquer les frames dans l'ordre.
- Suivre `seq` par session. Si un trou est détecté (frame manquante, vue recréée, rechargement), ne pas tenter de « rattraper » : fermer le flux, rouvrir un `observe` (ou `control`) et attendre la première frame `full`.
- Ne jamais supprimer une frame pour cause de lenteur. Si la file dépasse un seuil, resynchroniser plutôt que jeter.
- Au retour d'un onglet caché, ne pas supposer que l'écran est à jour : demander/attendre une frame `full`.
- Test : injecter des frames synthétiques avec un trou de `seq` et vérifier que l'adaptateur redemande un `full` au lieu d'afficher un écran faux.

**Signes précoces :** texte fantôme, lignes manquantes, curseur décalé ; `seq` non contigu ; l'écran se corrige après un resize ou un changement d'onglet ; le rendu est correct dans le terminal Herdr d'origine mais pas dans Orbe.

**Phase :** 2 (transport), 4 (resynchronisation).

---

### T4. Le backpressure déconnecte l'observateur (30 s) ou perd de la sortie

**Ce qui casse :** le CLI écrit chaque frame sur son `stdout` et `flush`. Si Orbe ne draine pas `stdout` (onglet caché, main thread occupé, renderer bloqué), le pipe se remplit ; le CLI cesse de lire le socket ; côté serveur, un observateur dont l'écriture socket ne progresse pas pendant **30 secondes** est déconnecté (Linux/macOS). Le flux peut se terminer **sans `terminal.closed`**. À l'inverse, si Orbe bufferise sans borne, la mémoire croît et xterm jette les données au-delà de son buffer d'écriture (limite dure de 50 Mo, débit de l'ordre de 5 à 35 Mo/s).

**Pourquoi :** un terminal d'agent produit des rafales (build, tests, logs) très supérieures à une interaction humaine. Le design naïf « `stdout` → `send` IPC → `term.write` » ne surveille ni le pipe ni le buffer xterm.

**Comment éviter :**
- Toujours drainer le `stdout` du CLI, même onglet caché. Le buffer borné vit dans le processus principal, pas dans un flux qu'on met en pause.
- Backpressure par watermark : compter les octets en attente de `term.write(..., callback)` ; au-delà d'un seuil (par exemple 512 Ko), arrêter temporairement la lecture du pipe ; reprendre dans le callback.
- Si la file dépasse un plafond dur, fermer et resynchroniser (nouvelle frame `full`) au lieu de jeter des frames.
- Traiter `EOF` sans `terminal.closed` comme une déconnexion, pas comme une fermeture de pane.
- Ne pas router la sortie terminale par `sendState()` ni par le canal `state` global.
- Mesurer un `cat` de 50 Mo et une rafale d'agent dans un test de performance, avec onglet visible puis caché.

**Signes précoces :** terminal qui se fige après une grosse sortie ; `terminal.closed` absent ; mémoire du processus principal qui monte ; CPU à 100 % dans le renderer ; messages `events_lost` si Orbe utilise aussi `events.subscribe`.

**Phase :** 2 (MVP) et 4 (robustesse).

---

### T5. Cycle de vie : confondre fin de flux, pane fermé, serveur arrêté et contrôleur volé

**Ce qui casse :** `terminal.closed` peut signifier que le pane s'est fermé, que le serveur s'arrête ou qu'un observateur a été déconnecté. Un `EOF` du CLI peut être un crash du CLI. Un `--takeover` par le TUI Herdr de l'utilisateur, ou par une autre fenêtre Orbe, retire le contrôle sans que l'onglet le sache. Orbe affiche alors « session terminée » alors que les agents tournent toujours, ou continue d'envoyer des frappes dans un pane qui ne les reçoit plus.

**Pourquoi :** Herdr conserve les panes quand le client se détache (« The server and agents continue running »). La sémantique de fermeture est côté serveur, pas côté client. Le CLI ne fournit pas de code d'erreur structuré pour tous les cas.

**Comment éviter :**
- Machine d'état explicite par onglet : `connecting → observing → controlling → reconnecting → unavailable → closed`. L'UI affiche l'état, pas un message unique.
- Sur `terminal.closed`, utiliser la raison si elle est connue ; sinon afficher « flux interrompu » et proposer « Se reconnecter », pas « session terminée ».
- Sur `EOF`/code de sortie non nul du CLI : « Herdr injoignable » + diagnostic, avec backoff exponentiel borné.
- Au retour : re-résoudre la cible (le pane id `w1:p1` peut être périmé ; Herdr renvoie « pane id is stale »), puis réattacher. Ne jamais réutiliser un `terminal_id` persistant comme clé de session.
- `--takeover` uniquement sur action explicite de l'utilisateur, jamais automatiquement. Afficher qui détient le contrôle.
- Ne jamais envoyer `kill`, `close` ou `server stop` à Herdr depuis Orbe. Fermer un onglet Orbe = se détacher.

**Signes précoces :** deux vues Orbe qui se volent le clavier ; un pane Herdr qui reçoit des frappes alors que le focus est ailleurs ; « session terminée » alors que `herdr` montre le pane vivant ; pane id périmé après redémarrage du serveur.

**Phase :** 3 (propriété) et 4 (reprise).

---

### T6. Le clavier est intercepté par le menu natif avant xterm

**Ce qui casse :** les raccourcis du menu Electron sont traités au niveau application. Orbe enregistre de nombreux accélérateurs `Ctrl` : `⌃D` (mode développeur), `⌃1…⌃9` (Espaces), `⌃⇧=` (split), `⌃⇧1…4` (volets), `⌃⇧-`, `⌃⇧[`, `⌃⇧]`, `⌃⇧⌘C`. Dans un terminal, `⌃D` est EOF, `⌃1…9` peuvent être utilisés par Herdr/tmux, et `⌃⇧…` par les agents. Ils n'arrivent jamais à xterm. À l'inverse, si on ignore tous les raccourcis du menu pour le terminal, `⌘W`, `⌘T`, `⌘L` et `⌘1…9` cessent de fonctionner, ce qui surprend dans un navigateur.

**Pourquoi :** `menu.js` construit un menu natif global ; `commands.js` est la table canonique ; il n'existe pas de notion de « surface clavier active ». `setIgnoreMenuShortcuts` est par `webContents` et n'est pas utilisé aujourd'hui.

**Comment éviter :**
- Dans `before-input-event` de la vue terminal, appeler `wc.setIgnoreMenuShortcuts(!input.meta)` (le motif documenté par Electron) : les raccourcis `⌘` restent des raccourcis de navigateur, les raccourcis `⌃` vont au terminal.
- Traiter à part `⌘C` / `⌘V` : les rôles de menu `copy`/`paste` opèrent sur la sélection DOM, pas sur la sélection xterm. Intercepter ces touches pour le terminal et router vers `term.getSelection()` / `term.paste()`.
- `attachCustomKeyEventHandler` pour les touches que xterm ne doit pas encoder (par exemple `⌘K`, si Orbe décide de le garder).
- Tester les conflits avec la liste réelle de `commands.js`, pas de mémoire : `⌃D`, `⌃1-9`, `⌃⇧=`, `⌃⇧1-4`, `⌃⇧-`, `⌃⇧[`, `⌃⇧]`.
- Documenter la politique dans les réglages du module : « Les raccourcis ⌘ restent ceux d'Orbe ; les raccourcis ⌃ vont au terminal. »

**Signes précoces :** `⌃D` ferme le mode développeur au lieu d'envoyer EOF ; `⌃1` change d'Espace depuis le terminal ; `⌘W` ne ferme plus l'onglet terminal ; Herdr ne reçoit jamais certains `⌃`.

**Phase :** 2.

---

### T7. La sélection, le presse-papiers et le collage ne sont pas ceux d'un terminal

**Ce qui casse :** xterm.js ne fournit pas le copier/coller système. Sa sélection vit dans son propre modèle, pas dans la sélection DOM ; le rôle `copy` du menu copie donc du texte vide ou obsolète. `navigator.clipboard.readText()` dans une vue interne sandboxée peut être refusé par la politique de permissions d'Orbe (`clipboard-read` est dans `ASKABLE`, pas dans `AUTO_ALLOW`), et le presse-papiers doit passer par le processus principal. Le collage doit respecter le bracketed paste, sinon les agents reçoivent chaque ligne comme une soumission séparée.

**Pourquoi :** l'application est un navigateur, pas un émulateur de terminal ; le menu Édition est partagé avec les pages web et ses rôles sont génériques.

**Comment éviter :**
- Exposer dans le preload terminal `clipboard.readText()` / `clipboard.writeText()` via le module `clipboard` d'Electron, avec validation de longueur et sans lecture silencieuse.
- Copier avec `term.getSelection()` ; ne rien copier si la sélection est vide.
- Coller avec `term.paste(text)` (transformations de collage) ou envoyer `terminal.input` avec les octets attendus ; tester le bracketed paste sur un agent qui pose une question.
- Désactiver OSC 52 (écriture du presse-papiers par la sortie distante) ou l'exiger par geste explicite. Ne pas ajouter d'addon presse-papiers sans revue.
- Tester `⌘C`, `⌘V`, clic droit, sélection à la souris, sélection au clavier, et collage multi-lignes.

**Signes précoces :** `⌘C` ne copie rien ; `⌘V` colle deux fois ; un collage multi-lignes déclenche plusieurs soumissions ; une sortie d'agent modifie le presse-papiers.

**Phase :** 2.

---

### T8. Les onglets terminaux ne rentrent pas dans le modèle d'onglets web

**Ce qui casse :** `veille.js` endort un onglet caché en détruisant sa vue ; `kept` ne protège que le visible, l'audio, les DevTools et `hooks.busy`. Un onglet terminal caché peut donc être endormi par la règle de nombre, d'ancienneté ou de mémoire, ce qui détruit xterm et perd le scrollback local. `⌘W` archive l'onglet ; `⇧⌘T` le rouvre par `loadURL(tab.url)`, ce qui recharge la page terminal sans réattacher le bon pane. Un crash de la vue passe par `hooks.gone`, prévu pour une page web. Un split redimensionne une vue qui ne sait peut-être pas encore se réattacher. `sendState()` envoie `url`, `favicon`, `loading` et l'état de navigation, qui n'ont pas de sens pour un terminal.

**Pourquoi :** toute la mécanique d'Orbe suppose `tab.url` et une session Chromium. Le flag `internal` ne suffit pas : il donne le pont UI générique et ne décrit pas le cycle de vie.

**Comment éviter :**
- Ajouter `kind` et un registre runtime séparé (`terminalRuntime` keyed by tab id) ; ne pas réutiliser `live` pour les terminaux.
- Exclure les terminaux de `veille.pick()` ou les marquer `kept` tant qu'ils sont attachés ; si on les endort, considérer cela comme un détachement et réattacher avec une frame `full` au réveil. Décider et documenter.
- `close` d'un onglet terminal = libérer la vue + détacher le CLI, archiver la ligne avec son `target` ; `reopen` = recréer la vue et réattacher, avec un état « pane introuvable » si Herdr l'a fermé.
- `render-process-gone` d'une vue terminal : recréer la vue et réattacher, pas afficher `error.html`.
- `sendState` : ajouter `kind`, `title` Herdr, `status` (working/blocked/done/idle si disponible), et ne jamais inclure le contenu du terminal.
- `store.normalize` : traiter les onglets `kind: 'terminal'` avec le même soin que les splits.
- Les splits et le drag-and-drop doivent fonctionner avec un terminal, ou être explicitement interdits dans un premier temps.
- `ext-host.tabs()` exclut déjà les onglets `internal` ; vérifier que les terminaux n'apparaissent pas dans `chrome.tabs`.

**Signes précoces :** onglet terminal qui devient blanc après quelques minutes ; scrollback perdu après un changement d'Espace ; `⇧⌘T` ouvre une page terminal vide ; crash d'une vue terminal qui affiche la page d'erreur du navigateur ; `chrome.tabs.query` retourne l'onglet terminal.

**Phase :** 3.

---

### T9. xterm.js : performances, WebGL et buffer fini

**Ce qui casse :** plusieurs terminaux ouverts avec le renderer WebGL épuisent la limite de contextes WebGL de Chromium (environ 16 par processus de rendu) ; les contextes les plus anciens sont perdus et le terminal devient noir ou cesse de peindre, alors que l'entrée continue d'arriver. Le renderer canvas a été supprimé en xterm.js 6.0 : il reste DOM (par défaut) ou WebGL (addon). Le buffer d'écriture a une limite dure de 50 Mo et jette les données au-delà ; le scrollback par défaut est de 1 000 lignes.

**Pourquoi :** on ouvre un terminal par onglet et on garde les vues montées. Chaque contexte WebGL coûte de la mémoire GPU et un contexte par onglet ne passe pas l'échelle.

**Comment éviter :**
- Commencer avec le renderer DOM ; activer WebGL seulement après mesure, par terminal visible, et le libérer quand l'onglet est caché (`onContextLoss` → `dispose()` de l'addon, repli DOM par terminal, pas global).
- Explicitement `WEBGL_lose_context.loseContext()` avant de détruire une vue, car `addon-webgl` 0.19 ne le fait pas toujours.
- Borner `scrollback` (par exemple 5 000 lignes) et documenter que le scrollback d'Orbe ne remonte pas avant l'attachement ; ne pas promettre l'historique Herdr complet.
- Décoder le base64 côté main ; transmettre `Uint8Array` ; envisager `MessagePortMain` pour la sortie à haut débit.
- Ne pas créer de contexte WebGL pour les onglets en arrière-plan ou les splits non focalisés.
- Mesurer le rendu d'un `yes`/`cat` massif et d'une TUI d'agent avec 1, 4 et 8 terminaux.

**Signes précoces :** `WARNING: Too many active WebGL contexts. Oldest context will be lost` ; terminal noir après ouverture de plusieurs onglets ; `onContextLoss` non géré ; mémoire GPU qui croît ; chute de fps dans la coque.

**Phase :** 2 (choix du renderer) et 4 (mesure).

---

### T10. La sortie terminale est du contenu non fiable dans une origine privilégiée

**Ce qui casse :** la page terminal est servie par `orbe://app/`, une origine qui, dans Orbe, peut appeler le processus principal. Le contenu affiché vient d'agents et de commandes : il peut contenir des séquences ANSI, des liens OSC 8 (`javascript:`, `file://`, `data:`), des titres, des séquences de contrôle de fenêtre, des requêtes de presse-papiers. Toute injection HTML dans cette page, ou tout `shell.openExternal` sans allowlist, transforme une sortie de terminal en action privilégiée.

**Pourquoi :** le terminal est le premier endroit où Orbe affiche du texte produit par un processus local non maîtrisé. Les autres pages internes affichent des données structurées et validées.

**Comment éviter :**
- Ne jamais rendre la sortie avec `innerHTML`. xterm rend les cellules ; les éléments autour (titre d'onglet, statut, erreur) utilisent `textContent`.
- Fournisseur de liens : autoriser uniquement `http:` et `https:` ; ouvrir via le routeur d'Orbe (`openUrl`) après validation, jamais `window.open` ni `shell.openExternal` direct.
- CSP stricte pour `terminal.html` : `default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'`. Aucun contenu distant.
- Désactiver OSC 52 ; désactiver les titres OSC qui pourraient écraser le titre d'onglet sans validation ; borner la longueur des titres.
- Le preload terminal ne doit exposer aucune fonction qui prenne un chemin, une URL ou une commande sans validation côté main.
- Test : une sortie contenant `<img onerror=...>`, `javascript:`, `file:///etc/passwd`, OSC 52, et un titre de 10 000 caractères.

**Signes précoces :** `innerHTML` dans `terminal.html` ou dans le code du module ; `shell.openExternal` appelé avec une URL issue d'un frame ; lien `file://` qui ouvre le Finder ; titre d'onglet qui change sans action de l'utilisateur.

**Phase :** 2.

---

## Moderate Pitfalls

### M1. Vendoriser xterm.js sans build : MIME, CSP, licence et mise à jour

**Ce qui casse :** `serveInternal` ne met en cache et ne type que `.html`, `.js` et `.css` (`UI_TYPES`). Un fichier `xterm.mjs` passe par `net.fetch(file://…)` ; selon le type MIME renvoyé, Chromium refuse le module avec « Failed to load module script: Expected a JavaScript module script but the server responded with a MIME type of … ». Le renderer d'Orbe utilise des `<script src>` classiques ; xterm.js 6 n'a plus de bundle UMD. Enfin, le premier fichier vendorisé devient du code de confiance dans le dépôt : sans lockfile, sa provenance et sa mise à jour ne sont pas traçables.

**Comment éviter :** soit ajouter `.mjs` à `UI_TYPES` avec `text/javascript; charset=utf-8`, soit vendoriser sous un nom `.js` ; ajouter un test qui charge `terminal.html` et vérifie l'absence d'erreur MIME dans la console ; conserver `LICENSE`, la version et un fichier `README` de provenance ; vérifier un SHA-256 du tarball npm au moment du vendor ; ne pas ajouter de bundler.

**Phase :** 2.

### M2. Le redimensionnement à zéro ou en vue cachée

**Ce qui casse :** `FitAddon.fit()` sur une vue `display:none` ou de taille nulle produit des dimensions invalides ; Herdr refuse `terminal.resize` si `cols` ou `rows` vaut 0 (le CLI renvoie « cols and rows must be greater than 0 »). Un resize en rafale pendant un drag de split peut envoyer des dizaines de `SIGWINCH` et faire redessiner les TUI sans arrêt.

**Comment éviter :** ne fitter qu'une vue visible avec des dimensions > 0 ; clamper à 1×1 minimum ; débouncer (par exemple 50 à 100 ms) ; envoyer les dimensions de cellule (`cell_width_px`, `cell_height_px`) si le protocole les accepte ; ignorer les resizes quand l'onglet est caché, puis fitter et envoyer une fois au retour.

**Phase :** 2 et 3.

### M3. Les liens, le scroll et la souris ne suivent pas le modèle de Herdr

**Ce qui casse :** la molette fait défiler le scrollback local d'xterm, pas le pane Herdr en mode alterné ; les TUI plein écran ne défilent donc pas. Les événements souris d'xterm sont encodés en séquences envoyées à `onData`, alors que Herdr attend des messages `terminal.mouse` structurés. Envoyer les séquences brutes peut être interprété comme du texte par l'application.

**Comment éviter :** traiter d'abord le cas « pas de souris » et le documenter ; pour le scroll, intercepter la molette sur `.xterm-screen`, détecter `term.buffer.active.type === 'alternate'` et envoyer `terminal.scroll` avec `direction` et `lines` ; pour la souris, spike séparé avec capture-phase sur l'élément xterm, calcul de cellule zéro-basée, `preventDefault`, puis `terminal.mouse` (`down`/`up`/`drag`/`move`). Ne pas exposer la souris si le spike n'est pas concluant.

**Phase :** 3 (optionnel), 4 (polish).

### M4. Le contrôleur est unique : les fenêtres et les splits se disputent le clavier

**Ce qui casse :** une seule session peut contrôler un terminal ; `--takeover` remplace le contrôleur. Deux fenêtres Orbe, ou deux splits sur le même pane, peuvent se voler le contrôle en boucle. Le TUI Herdr de l'utilisateur peut aussi reprendre la main après un attachement Orbe.

**Comment éviter :** un registre de propriété dans le processus principal, par pane Herdr, partagé entre fenêtres. Une seule vue est `control` ; les autres sont `observe`. Le focus transfère le contrôle explicitement (avec un court délai de grâce). Ne jamais prendre le contrôle au chargement d'un onglet caché. Afficher « contrôlé par une autre vue » et proposer « Prendre le contrôle ».

**Phase :** 3 et 4.

### M5. Windows et PTY : la tentation du fallback local

**Ce qui casse :** Herdr est en bêta sous Windows ; l'attache directe n'est pas native Windows et `terminal session` n'y est pas documenté. La tentation est de « au moins lancer un shell local » si Herdr manque. Cela introduit `node-pty`, un module natif : rebuild ABI Electron, DLL ConPTY (`conpty.dll`, `OpenConsole.exe`) à copier dans `build/Release/conpty/`, architecture x64/arm64, `asarUnpack`, signature de chaque binaire, et une surface d'exécution locale supplémentaire.

**Comment éviter :** ne pas ajouter de PTY dans ce milestone. Sous Windows, masquer le module ou afficher « non pris en charge » tant que Herdr ne documente pas la surface. Si un jour un PTY local est ajouté, le traiter comme un chantier séparé avec packaging ConPTY, tests sur machine réelle et signature.

**Phase :** 5 (Windows), hors périmètre sinon.

### M6. Le module terminal augmente `window.js` au lieu de le désenclaver

**Ce qui casse :** l'intégration des onglets terminaux (création de vue, layout, splits, focus, close, crash) est ajoutée directement dans `window.js`, déjà à 5 055 lignes. Chaque évolution du terminal augmente le risque de régression sur les onglets web, les vues d'appoint et le drag-and-drop.

**Comment éviter :** extraire d'abord (ou en même temps) une unité `tab-model.js` / `views.js` avec des dépendances explicites, puis brancher le terminal sur cette unité. À défaut, créer un `TerminalPane` qui possède sa vue et son cycle de vie, et ne laisser dans `window.js` que l'orchestration et le layout. Refuser toute nouvelle branche `if (tab.kind === 'terminal')` dispersée dans le fichier.

**Phase :** 1 (préparation) et 3.

---

## Minor Pitfalls

### m1. Le titre et l'icône de l'onglet terminal

Un titre Herdr peut changer en flux (OSC 0/2) et contenir des caractères de contrôle. Borner la longueur, retirer les séquences, utiliser `textContent`, et ne pas laisser un agent renommer l'onglet sans indication. L'icône doit venir d'une table statique, jamais d'une URL distante.

### m2. Les sons et les animations

Orbe déduit des sons des diffs d'état. Un terminal qui produit du texte ne doit pas déclencher de son ; un changement d'onglet terminal ne doit pas être interprété comme un nouvel onglet web. Vérifier `sounds.js` et `motion.js` après l'ajout de `kind`.

### m3. La barre de commande et la recherche

`⌘L`/`⌘T` ne doivent pas proposer « rechercher dans la page » pour un terminal. `findInPage` n'a pas de sens sur xterm ; prévoir une recherche dans le buffer xterm (API de recherche) ou désactiver l'action pour ce `kind`.

### m4. Le zoom

Le zoom d'Orbe (`⌘+`, `⌘-`) change la taille de police de la page ; xterm doit être re-fitté après un changement de zoom. Sinon les colonnes/lignes divergent de l'affichage et les TUI se cassent. Écouter les changements de zoom et re-fitter.

### m5. L'accessibilité

Activer `screenReaderMode` quand VoiceOver est utilisé ; vérifier le focus clavier, le contraste (`minimumContrastRatio: 4.5`) et la réduction des animations. Un terminal inaccessible est un recul par rapport au reste d'Orbe.

### m6. Le mode test et le trousseau factice

Les tests utilisent `--use-mock-keychain` et des scénarios qui interdisent les dialogues natifs. Le module terminal doit avoir un mode test : binaire factice, serveur factice, pas de vraie socket Herdr, pas de vrai presse-papiers. Sinon `npm test` devient dépendant de la machine de l'auteur.

---

## Technical Debt Patterns

| Raccourci | Bénéfice immédiat | Coût à long terme | Quand c'est acceptable |
|---|---|---|---|
| Ajouter le terminal au dispatcher `ipcMain.handle('orbe')` | Une ligne de routage, réutilise `ui.js` | Toute page interne compromise obtient le contrôle des panes | Jamais |
| Faire de l'onglet terminal un onglet `internal` ordinaire | Réutilise `ensureView` et le layout | `trusted`, préload générique, veille/archive inadaptées | Jamais sans `kind` dédié |
| Stocker la sortie ou le scrollback dans `orbe.json` | Restaure l'écran au redémarrage | Fichier d'état qui grossit, écritures synchrones, secrets dans les sauvegardes | Jamais |
| Garder un `terminal_id` Herdr en état | Réattachement « simple » | ID périmé, mauvais pane, confusion après redémarrage serveur | Jamais ; stocker une cible logique |
| Lancer un PTY local si Herdr manque | Le module « marche » partout | `node-pty`, ConPTY, ABI, signature, surface d'exécution | Jamais dans ce milestone |
| Réimplémenter le protocole binaire de `terminal attach` | Pas de processus CLI par onglet | Handshake non documenté, casse à chaque version | Jamais ; spawner le CLI |
| Ajouter un bundler pour xterm.js | Import facile | Casse la contrainte « aucun build », ralentit le démarrage et complexifie la distribution | Jamais |
| Signer avec `codesign --deep` en ajoutant un binaire | Une commande | Signature de code imbriqué fragile, notarisation qui échoue | Uniquement tant qu'il n'y a aucun code imbriqué ; sinon signer de l'intérieur vers l'extérieur |
| Charger xterm.js dans `shell.html` « pour plus tard » | Pas de page séparée | Coût au premier paint, module non paresseux | Jamais |
| Tester contre un vrai Herdr en CI | Fidélité | CI instable, dépendante de la version installée | Jamais ; fixtures + test manuel de compatibilité |

---

## Integration Gotchas — Herdr

| Intégration | Erreur fréquente | Approche correcte |
|---|---|---|
| Binaire `herdr` | `spawn('herdr')` en comptant sur le `PATH` du shell | Résoudre un chemin absolu, valider, stocker en réglage, tester depuis l'app fabriquée |
| Session Herdr | Ignorer `HERDR_SESSION` / `HERDR_SOCKET_PATH` | Exposer le choix de session, passer l'environnement explicitement, vérifier le socket |
| Flux terminal | Traiter les frames comme un flux d'octets continu | Respecter `seq`, `full`, l'ordre ; resynchroniser sur trou |
| `terminal.closed` | Le traduire par « session terminée » | Distinguer pane fermé, serveur arrêté, observateur déconnecté, EOF du CLI |
| Observateur lent | Mettre le `stdout` en pause quand l'onglet est caché | Toujours drainer ; watermark ; resynchroniser si dépassement |
| Contrôle | Prendre le contrôle automatiquement | `observe` par défaut ; `control` sur focus explicite ; `release` en quittant |
| Pane id | Persister `w1:p1` ou `term_…` | Re-résoudre à chaque attache ; traiter « pane id is stale » |
| `--takeover` | L'utiliser pour « réparer » un attachement | Seulement sur action utilisateur, avec confirmation et affichage du propriétaire |
| Erreurs CLI | Parser des messages anglais instables | Code de sortie + motifs stables + fallback lisible |
| Version | Supposer que la dernière version installée est compatible | `herdr --version`, version minimale et version testée, message clair sinon |
| Windows | Supposer la parité macOS | Gater le module ; tester sur une vraie machine Windows avant toute promesse |

---

## Performance Traps

| Piège | Symptômes | Prévention | Seuil de rupture |
|---|---|---|---|
| Sortie terminale dans le state global | Chaque frame reconstruit et sérialise tout l'état | Canal dédié, frames binaires, jamais `sendState` pour le terminal | Dès la première rafale de build |
| Base64 + JSON + IPC pour chaque frame | CPU élevé, allocations, latence | Décoder dans le main, `Uint8Array`, `MessagePort` si nécessaire | Quelques Mo/s de sortie |
| `term.write` sans backpressure | Buffer xterm plein, données jetées au-delà de 50 Mo | Watermark + callback de `write` + resynchronisation | Rafale d'agent ou `cat` de gros fichier |
| WebGL par onglet | Contextes perdus, terminaux noirs | WebGL seulement visible, libération explicite, repli DOM | Environ 16 contextes par processus de rendu |
| Terminaux cachés qui continuent de peindre | CPU et GPU inutiles | Détacher la vue ou suspendre le rendu, mais continuer à drainer le flux | 4 à 8 terminaux |
| `FitAddon.fit()` en rafale | `SIGWINCH` storms, TUI qui clignote | Débounce, fit seulement visible, clamp 1×1 | Drag de split ou resize de fenêtre |
| Scrollback non borné | Mémoire par onglet qui croît | `scrollback` borné, politique de rétention | Agents longs |
| `require` des modules au démarrage | Temps de démarrage qui augmente | Registre paresseux, test `require.cache` | Dès le premier module |
| Scan du dossier de modules au démarrage | `fs` synchrone sur le chemin critique | Manifestes statiques en code | 10 modules et plus |

---

## Security Mistakes

| Erreur | Risque | Prévention |
|---|---|---|
| Réutiliser `ui.js` pour le terminal | Une page interne compromise pilote Herdr et peut exécuter des commandes | Preload dédié, canaux dédiés, validation stricte |
| Valider seulement `ok(e)` | Toute page `orbe://app/` est acceptée | Vérifier l'URL exacte de la page terminal, l'appartenance de la vue, l'état du module |
| Rendre la sortie avec `innerHTML` | XSS dans une origine privilégiée | `textContent`, xterm pour les cellules, CSP stricte |
| `shell.openExternal` sur une URL de sortie | `file://`, `javascript:`, `data:` | Allowlist `http`/`https`, routeur Orbe, confirmation |
| OSC 52 activé | Écriture du presse-papiers par un agent | Désactiver ou geste explicite |
| Chemin `herdr` fourni par le renderer | Exécution arbitraire | Chemin choisi par l'utilisateur, validé, stocké côté main |
| Entrée de module depuis `orbe.json` | `require()` arbitraire | Manifeste en code, état limité à `enabled` + réglages validés |
| Socket Herdr sans authentification | Tout processus local peut s'y connecter ; le contenu n'est pas de confiance | Ne pas exposer le socket au renderer ; traiter la sortie comme non fiable ; pas de canal réseau |
| `--takeover` automatique | Vol de contrôle silencieux | Action explicite, affichage du propriétaire |
| Journalisation de la sortie terminale | Fuite de secrets (tokens, chemins) | Ne pas logger les frames ; diagnostic borné et expurgé |

---

## UX Pitfalls

| Piège | Impact utilisateur | Meilleure approche |
|---|---|---|
| « Session terminée » alors que le pane vit | L'utilisateur croit avoir perdu son agent | Distinguer « flux interrompu », « pane fermé », « Herdr injoignable » ; bouton « Se reconnecter » |
| Onglet terminal endormi sans indication | Scrollback perdu, écran qui se vide | Exclure de la veille ou afficher « déconnecté, se reconnecte au retour » |
| `⇧⌘T` qui rouvre une page vide | Rupture du raccourci Arc | Réattacher la cible ; si le pane n'existe plus, le dire clairement |
| `⌘W` qui archive un terminal actif | L'utilisateur croit avoir tué son agent | Archiver la vue, pas le pane ; message « le pane Herdr continue » |
| Deux vues qui se volent le clavier | Frappes dans le mauvais pane | Propriété visible, transfert explicite |
| Pas de copier/coller | Le terminal est inutilisable pour les agents | Implémenter tôt, tester les raccourcis |
| Option = Meta par défaut sur AZERTY | Impossible de taper `[`, `]`, `{`, `}` | `macOptionIsMeta: false` par défaut en français, réglage explicite |
| Liens non cliquables | Le terminal perd son intérêt de navigateur | Fournisseur de liens http/https, ouverture en onglet/Peek |
| Aucun indicateur d'état Herdr | L'utilisateur ne sait pas si l'agent travaille | Statut Herdr (working/blocked/done/idle) si disponible, sinon état de connexion |
| Module désactivé mais réglages perdus | Réactivation qui repart de zéro | Conserver les réglages à la désactivation |

---

## "Looks Done But Isn't" Checklist

- [ ] **Module désactivé :** vérifier `require.cache` (aucun module), temps de démarrage, absence de socket, absence de menu/commande, absence de CSS/JS xterm dans la coque.
- [ ] **Activer/désactiver deux fois :** aucun listener, timer, handler IPC ou socket en double ; pas de `MaxListenersExceededWarning`.
- [ ] **Désactiver avec des onglets terminaux ouverts, puis redémarrer :** les onglets ne rechargent pas une page terminal morte ; l'état est cohérent ; les réglages sont conservés.
- [ ] **Herdr absent :** message clair, module non chargé, navigateur intact, aucune exception non rattrapée.
- [ ] **Herdr d'une autre version :** détection, message, pas de crash ; la version minimale est vérifiée.
- [ ] **Pane fermé :** l'onglet affiche un état explicite, pas une page blanche ; « Se reconnecter » ne boucle pas.
- [ ] **Pane id périmé après redémarrage du serveur :** re-résolution ou message, pas un attachement silencieux au mauvais pane.
- [ ] **Quitter Orbe avec des terminaux ouverts :** aucun processus `herdr terminal session` orphelin ; `terminal.release` envoyé ; les panes Herdr continuent.
- [ ] **Reconnecter après une rafale de sortie :** l'écran est complet (frame `full`), pas de texte fantôme.
- [ ] **Onglet caché pendant une rafale :** le flux est drainé, l'observateur n'est pas déconnecté à 30 s, le retour affiche l'état correct.
- [ ] **Split et redimensionnement :** dimensions > 0, pas de `SIGWINCH` storm, la TUI reste lisible.
- [ ] **Clavier :** `⌃D` arrive au terminal ; `⌃1…9` sont testés dans les deux sens ; `⌘W`, `⌘T`, `⌘L` fonctionnent ; AZERTY et touches mortes ; Option+5/6/8/9.
- [ ] **Presse-papiers :** `⌘C` copie la sélection xterm ; `⌘V` colle une fois ; collage multi-lignes correct ; pas d'OSC 52.
- [ ] **Liens :** `http`/`https` ouvrent un onglet/Peek ; `javascript:`, `file:`, `data:` refusés.
- [ ] **Injection :** une sortie contenant du HTML, un titre long, des séquences de contrôle ne casse pas l'UI et n'exécute rien.
- [ ] **Sécurité IPC :** une page `orbe://app/` non-terminale, une page web et un onglet interne ne peuvent pas appeler `terminal:*`.
- [ ] **Vendorisation :** `terminal.html` charge sans erreur MIME ; CSP respectée ; LICENSE/version présents ; build fabriquée contient les fichiers.
- [ ] **App fabriquée lancée depuis le Finder :** `herdr` est trouvé (ou le message est clair) ; ce n'est pas seulement `npm start` qui marche.
- [ ] **CI :** les tests du registre, de l'IPC et de l'adaptateur tournent sur `pull_request` ; un serveur Herdr factice remplace le vrai.
- [ ] **Windows :** le module est masqué ou explicitement non pris en charge ; aucun `node-pty` ajouté.

---

## Recovery Strategies

| Piège | Coût de récupération | Étapes |
|---|---|---|
| Frontière IPC élargie | HIGH | Révoquer le canal, ajouter un preload dédié, rotation des secrets éventuellement compromis, audit des journaux |
| État corrompu par des onglets terminaux mal normalisés | MEDIUM | Version de schéma, migration de réparation, restauration `.bak`, test de fixtures |
| Frames perdues / écran faux | LOW | Fermer le flux, rouvrir `observe`, attendre `full`, réinitialiser xterm |
| Observateur déconnecté à 30 s | LOW | Redémarrer le CLI, backoff, message « reconnexion », ne pas recréer l'onglet |
| Pane id périmé | LOW | Re-résoudre la cible, proposer les panes disponibles, ne pas deviner |
| Processus CLI orphelins au quit | MEDIUM | Envoyer `release`, fermer stdin, attendre, `SIGTERM`, vérifier `ps` au prochain lancement |
| Coffre inaccessible après changement d'identité | HIGH | Export préalable, ré-import, sinon saisie manuelle ; ne jamais réinitialiser le coffre sans confirmation |
| Migration moteur interrompue | HIGH | Conserver l'installation Electron, chemin de retour, sauvegarde `orbe.json` + coffre exporté, release-pont |
| xterm.js mis à jour et cassé | MEDIUM | Version vendorisée figée, test de fumée, retour arrière par copie de fichiers (pas de lockfile) |

---

## Pitfall-to-Phase Mapping

Phases recommandées pour le roadmap (noms indicatifs ; le roadmap peut les fusionner ou les scinder).

| Pitfall | Phase de prévention | Vérification |
|---|---|---|
| C1 faux chargement paresseux | Phase 1 — Socle de modules | Test `require.cache` + mesure du démarrage |
| C2 désactivation incomplète | Phase 1 | Cycle activer/désactiver ×2, zéro listener/socket |
| C3 frontière IPC élargie | Phase 0 (test) + Phase 2 | Tests de refus depuis pages non-terminales |
| C4 état/normalisation | Phase 1 + Phase 3 | Fixtures v2/v3, onglets terminaux, module inconnu |
| C5 registre piloté par l'état | Phase 1 | Revue : aucun chemin d'entrée dans `orbe.json` |
| C6 coût caché au démarrage | Phase 1 + Phase 2 | Mesure avant/après, waterfall de la coque |
| C7 activation non contenue | Phase 1 + Phase 2 | Herdr absent/erreur → module `failed`, navigateur intact |
| T1 surface Herdr non contractuelle | Phase 0 (spike) + Phase 2 + Phase 4 | Transcript fixture, probe de version, message clair |
| T2 résolution du binaire/session | Phase 2 | Test depuis l'app fabriquée, sans PATH du shell |
| T3 frames différentielles | Phase 2 + Phase 4 | Test de trou de `seq` → resynchronisation |
| T4 backpressure | Phase 2 + Phase 4 | Rafale avec onglet caché, pas de déconnexion 30 s |
| T5 cycle de vie | Phase 3 + Phase 4 | Matrice pane fermé / serveur arrêté / takeover / EOF |
| T6 clavier et menu | Phase 2 | Tests réels AZERTY, `⌃D`, `⌃1-9`, `⌘W/T/L` |
| T7 presse-papiers | Phase 2 | Tests copier/coller, collage multi-lignes, OSC 52 |
| T8 intégration au modèle d'onglets | Phase 3 | Veille, archive, reopen, crash, splits, `sendState`, `chrome.tabs` |
| T9 performances xterm/WebGL | Phase 2 + Phase 4 | 1/4/8 terminaux, contextes WebGL, buffer 50 Mo |
| T10 sortie non fiable | Phase 2 | Tests d'injection, liens, titres, CSP |
| M1 vendorisation/MIME | Phase 2 | Chargement de `terminal.html` sans erreur MIME |
| M2 resize | Phase 2 + Phase 3 | Split, vue cachée, dimensions 1×1 |
| M3 scroll/souris | Phase 3 (optionnel) | TUI en mode alterné, molette, clic |
| M4 propriété du contrôleur | Phase 3 + Phase 4 | Deux fenêtres, deux splits, takeover |
| M5 Windows/PTY | Phase 5 | Module masqué/non pris en charge, aucun `node-pty` |
| M6 `window.js` | Phase 1 + Phase 3 | Extraction ou `TerminalPane` isolé, pas de branches dispersées |
| Bloqueurs de migration M1–M8 | Hors milestone ; décision à la frontière | Relecture des bloqueurs, déclencheurs explicites, pas de migration partielle |
| Maintenance Electron 44 → 45/46 | Phase dédiée avant le 2027-03-02 | `safeStorage` async, castlabs aligné, tests de fumée |

---

## Ce qui n'a pas été vérifié

- **Stabilité du protocole de flux Herdr.** La documentation consultée est en « preview » ; `terminal.frame`/`closed` et le handshake binaire du CLI ne sont pas présentés comme un contrat public. Le « protocol 17 » vient d'un pont VS Code tiers, pas d'une documentation officielle.
- **Support Windows de `terminal session`.** Non documenté ; à tester sur une vraie machine avant toute promesse Windows.
- **Sémantique exacte des frames différentielles.** Le champ `full` et le `seq` sont dans le code source, mais la politique de delta (ce que couvre une frame non `full`) n'est pas documentée.
- **Comportement d'xterm.js 6 servi par `orbe://` en ESM.** Le risque MIME est identifié dans le code (`UI_TYPES`), mais un spike est nécessaire pour confirmer le comportement de `net.fetch(file://…)` sur `.mjs`.
- **Notarisation d'Electron avec les entitlements JIT** si Orbe décide de signer. Non testé dans ce dépôt ; à valider avant d'ajouter un binaire natif.
- **IME et claviers français sur xterm.js 6.** Les modes d'échec (candidate window, composition, Meta pendant composition) viennent de rapports communautaires ; à reproduire sur la machine de l'auteur avec un clavier AZERTY réel.
- **Tauri 3 alpha / CEF** n'a pas été réévalué en profondeur ici ; STACK.md le documente comme non planifiable à ce jour.

---

## Sources

### Code et configuration d'Orbe (HIGH — lecture directe, commit `3652692`)

- `src/main/main.js` — dispatcher IPC, `ok(e)`, `SETTABLE`, handler `uncaughtException`.
- `src/main/window.js` — `UI_PREFS`, `trusted`, `INTERNAL`, `ensureView`, `wire`, `sendState`, `kept`, `veille`.
- `src/main/store.js` — `normalize`, version de schéma, `.bak`.
- `src/main/sessions.js` — `serveInternal`, `UI_TYPES`, sessions par profil.
- `src/main/passwords.js` — `safeStorage` synchrone, Touch ID.
- `src/main/veille.js` — règles de mise en veille, `MIN_LIVE`.
- `src/main/commands.js`, `src/main/menu.js` — accélérateurs `Ctrl` et `Cmd`.
- `src/preload/ui.js` — `window.orbe`, `EVENTS`.
- `scripts/build-mac.js`, `scripts/fuses.js`, `package.json`.
- `.github/workflows/tests.yml` — déclencheurs et couverture CI.
- `.planning/codebase/CONCERNS.md`, `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/STACK.md`.

### Electron (HIGH — documentation officielle)

- safeStorage, y compris la dépréciation des méthodes synchrones et leur suppression dans Electron 46 : https://www.electronjs.org/docs/latest/api/safe-storage
- WebContents, `before-input-event`, `setIgnoreMenuShortcuts`, `sendInputEvent` : https://www.electronjs.org/docs/latest/api/web-contents
- utilityProcess : https://www.electronjs.org/docs/latest/api/utility-process
- Calendrier de support et EOL de la branche 44 (2 mars 2027) : https://endoflife.date/electron
- Notes de version Electron 45 / 46 alpha et dépréciations : https://github.com/electron/electron/releases
- Patches Chromium/Electron sur le Keychain (`<produit> Safe Storage`, `<produit> Key`) : https://raw.githubusercontent.com/electron/electron/main/patches/chromium/feat_ensure_mas_builds_of_the_same_application_can_use_safestorage.patch

### Tauri 2 (HIGH pour les docs officielles, MEDIUM pour les points communautaires)

- Webviews système et versions : https://v2.tauri.app/reference/webview-versions/
- Updater (signature obligatoire, clés, artefacts) : https://v2.tauri.app/plugin/updater/
- Signature et notarisation macOS : https://v2.tauri.app/distribute/sign/macos/
- Installation Windows et modes WebView2 (`downloadBootstrapper`, `embedBootstrapper`, `offlineInstaller`, `fixedRuntime`) : https://v2.tauri.app/distribute/windows-installer/
- Chemins `appDataDir` = `${dataDir}/${bundleIdentifier}` : https://v2.tauri.app/reference/javascript/path/
- WebDriver : support Windows/Linux, pas macOS : https://v2.tauri.app/develop/tests/webdriver/
- Multi-webview derrière `unstable`, `Window::add_child`, desktop uniquement (MEDIUM) : https://docs.rs/tauri/latest/tauri/window/struct.Window.html
- Absence d'extensions Chrome / limites WKWebView (MEDIUM, discussions officielles) : https://github.com/orgs/tauri-apps/discussions/2685
- DRM/Widevine sur macOS (MEDIUM) : https://github.com/tauri-apps/tauri/issues/7400
- Stronghold, coffre de secrets (pas un équivalent de `safeStorage`) : https://v2.tauri.app/plugin/stronghold/

### xterm.js (HIGH pour les docs officielles, MEDIUM/LOW pour les rapports communautaires)

- Notes de version 6.0.0 (suppression du renderer canvas, changements de viewport, ESM) : https://github.com/xtermjs/xterm.js/releases
- Flow control, buffer de 50 Mo, débit 5–35 Mo/s : https://xtermjs.org/docs/guides/flowcontrol/
- API `Terminal` (`onData`, `onBinary`, `write`, `onWriteParsed`, `attachCustomKeyEventHandler`, `getSelection`, `paste`, `resize`) : https://xtermjs.org/docs/api/terminal/classes/terminal/
- Options (`macOptionIsMeta`, `macOptionClickForcesSelection`, `scrollback`, `minimumContrastRatio`, `screenReaderMode`) : https://xtermjs.org/docs/api/terminal/interfaces/iterminaloptions/
- Limite de contextes WebGL et perte de contexte (MEDIUM) : https://github.com/xtermjs/xterm.js/issues et rapports de projets hôtes.
- Problèmes IME/Electron macOS (LOW, à reproduire) : rapports communautaires sur `CompositionHelper`, `.xterm-helpers { left: 0 }`, `compositionstart`.

### Herdr (HIGH pour le code source et le CLI, MEDIUM pour la stabilité)

- Dépôt et licence Apache-2.0, dernière release v0.9.5 du 2026-10-14 : https://github.com/herdrdev/herdr
- CLI reference (formes exactes de `terminal attach`, `terminal session observe/control`, `--takeover`, `terminal.frame`, `terminal.closed`, timeouts observateur) : https://raw.githubusercontent.com/herdrdev/herdr/master/docs/next/website/src/content/docs/cli-reference.mdx
- Persistence et remote (attache directe Linux/macOS, pas Windows natif ; un seul contrôleur) : https://raw.githubusercontent.com/herdrdev/herdr/master/docs/next/website/src/content/docs/persistence-remote.mdx
- Socket API (NDJSON, socket `~/.config/herdr/herdr.sock`, `session.snapshot`, `events.subscribe`, `events_lost`) : https://herdr.dev/docs/preview/socket-api/
- Concepts (serveur + clients, sessions persistantes, panes survivent au détachement) : https://herdr.dev/docs/preview/concepts/
- Code source `src/client/terminal_sessions.rs` (handshake binaire, `terminal.frame` avec `seq`, `full`, base64, `terminal.resize` cols/rows > 0) : https://github.com/herdrdev/herdr/blob/master/src/client/terminal_sessions.rs
- Pont VS Code `herdr-bridge` (protocol 17, socket, `terminal attach`) : https://marketplace.visualstudio.com/items?itemName=clement-micol.herdr-bridge

---

*Pitfalls research pour Orbe — socle de modules, Terminal/Herdr, migration Electron vers Rust/Tauri*
*Recherché le 2026-10-24*
