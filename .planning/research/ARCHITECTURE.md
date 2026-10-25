# Architecture Research

**Domain:** navigateur Electron existant, socle de modules optionnels, module Terminal/Herdr, évaluation d'une sortie vers Rust
**Researched:** 2026-10-24
**Confidence:** MEDIUM — HIGH sur l'intégration Electron et le socle de modules (code lu + doc officielle), MEDIUM sur Herdr (doc officielle recoupée, APIs jeunes), HIGH sur les blocages Tauri/CEF (doc officielle)

## Verdict en une page

1. **Socle de modules.** Le bon modèle est un **registre de manifestes sans code** chargé au démarrage, avec des **entrées CommonJS chargées à la première utilisation** (`require` paresseux). Les modules désactivés ne coûtent rien ; les modules activés mais jamais ouverts ne coûtent rien non plus. Le cœur garde la propriété de l'état, des vues et des politiques ; le module reçoit une façade étroite, pas `OrbeWindow` ni `store`.
2. **Terminal/Herdr.** Herdr est un multiplexeur serveur/client : le serveur possède les PTY, les workspaces, les tabs et les panes ; le client est une TUI. La seule intégration stable documentée pour rendre la **TUI Herdr** est de lancer le client Herdr dans un **PTY** et de le rendre avec xterm.js. L'API socket JSON ne diffuse pas les octets bruts des panes ; les flux `terminal session control/observe` existent mais sont en **preview** et changent le modèle produit (Orbe devrait reconstruire l'UI des panes).
3. **Conséquence PTY.** Electron n'expose aucune API PTY. Le module doit vendorer une deuxième dépendance runtime, **node-pty 1.1.0** (MIT, prébuilds N-API chargés directement, `spawn-helper` macOS, `conpty.dll`/`OpenConsole.exe` Windows). C'est une décision à acter dans PROJECT.md, car elle dépasse la contrainte « xterm.js première dépendance runtime ». L'alternative sans PTY (flux JSON Herdr) est un autre produit et une API preview.
4. **Migration Rust.** Sortir d'Electron **n'est pas une migration incrémentale du cœur** : c'est une réécriture du main process, du pont IPC, du modèle de vues, des sessions, des extensions et des tests. Tauri 2 ne sait pas faire de Chromium sur macOS ; son multiwebview est `unstable` ; le runtime CEF n'existe qu'en **Tauri 3.0 alpha** et les extensions Chrome n'y sont pas documentées. WebView2 désactive les extensions (non configurable). Un shell Rust+CEF est un projet de 12–24+ mois pour une parité incertaine, sans gain mémoire sur les renderers Chromium. **Recommandation : rester sur Electron pour ce milestone ; n'ouvrir un spike Rust qu'après, avec des critères de sortie explicites.**

---

## 1. Architecture existante et contraintes structurantes

### 1.1 Rappel du modèle actuel

```text
┌─────────────────────────────────────────────────────────────────────┐
│ UI renderer (orbe://app, sandbox, contextIsolation)                 │
│ shell.js · overlay.js · settings · library · notes · easel · sheet  │
├─────────────────────────────────────────────────────────────────────┤
│ Preloads isolés : ui.js (window.orbe) · page.js · ext.js · …        │
├─────────────────────────────────────────────────────────────────────┤
│ Main process (Node, un seul thread)                                 │
│ main.js : bootstrap + routeur IPC `orbe` + câblage                  │
│   └── window.js : OrbeWindow, tabs, WebContentsView, layout, state  │
│         ├── store.js : état JSON unique, écriture atomic différée   │
│         ├── sessions.js : orbe:// + sessions Chromium par profil    │
│         ├── essentials.js, extensions*, passwords, easels, media…   │
├─────────────────────────────────────────────────────────────────────┤
│ Sessions Chromium : persist:orbe, persist:orbe-<profil>, incognito  │
│ Défaut = UI seulement, aucune permission web                        │
├─────────────────────────────────────────────────────────────────────┤
│ userData : orbe.json · history.json · passwords.json · easels/ …    │
└─────────────────────────────────────────────────────────────────────┘
```

Points d'appui à respecter :

- **Un seul propriétaire de l'état** : `store.state`, muté par le main. Le renderer ne fait que projeter le view-model reçu par `state`.
- **Une seule fabrique de vues** : `OrbeWindow.ensureView()` crée/ré-adopte les `WebContentsView`, les inscrit dans `live`, applique la session du profil, les preloads internes et le re-parenting. Créer une vue ailleurs casse veille, split, capture, extension APIs.
- **IPC action-based** : `ipcRenderer.invoke('orbe', action, payload)` → `ok(e)` (sender de confiance + frame `orbe://app/`) → routage par préfixe ou vers `OrbeWindow.handle`.
- **Pas de build** : CommonJS dans main/preload, scripts classiques dans le renderer, aucune transpilation. Le `require` paresseux est donc l'outil naturel de lazy loading.
- **Frontière de confiance explicite** : `trusted` WeakSet + préfixe `orbe://app/` + `tab.internal` posé à la création, jamais déduit de l'URL. Une page web ne doit jamais atteindre un privilège.
- **`window.js` = god object** (5 055 lignes). Toute intégration doit être chirurgicale ; ne pas y ajouter un second système de vues.

### 1.2 Ce que le milestone ajoute

| Ajout | Nature | Contrainte principale |
|-------|--------|-----------------------|
| Registre de modules | Main + settings + commandes | Zéro coût si désactivé ; aucune entrée chargée au démarrage |
| Module Terminal | Main + preload + page renderer + vendor | PTY, Herdr externe, xterm.js, frontière de confiance |
| Onglets terminal | Modèle d'onglets + `ensureView` | Ne pas casser archive, veille, splits, re-parenting |
| Réglages modules | Settings UI + persistance | Activation explicite, validation côté main |
| Migration Rust | Décision d'architecture | Ne pas la planifier comme une phase de ce milestone |

---

## 2. Socle de modules

### 2.1 Vue d'ensemble

```text
┌──────────────────────────────────────────────────────────────────────┐
│ main.js                                                              │
│  store.load() → modules.init(manifests) → setupIpc() → menu.build()  │
│  (init ne charge QUE des données : aucun require d'entrée)           │
├──────────────────────────────────────────────────────────────────────┤
│ src/main/modules/registry.js                                         │
│  manifests[] · enabledIds · activation state · command wrappers      │
│  action(action, payload, sender) · publicState() · setSetting()      │
├──────────────────────────────────────────────────────────────────────┤
│ ModuleHost (façade étroite, injectée à l'activation)                 │
│  createModuleTab · closeModuleTab · tabForWebContents ·             │
│  registerModuleIpc · unregisterModuleIpc · settings · paths · log    │
├──────────────────────────────────────────────────────────────────────┤
│ Entrée du module (require paresseux, une seule fois)                 │
│  src/main/modules/terminal/index.js                                  │
│    activate(host) → Herdr preflight, sessions PTY, IPC handlers      │
│    deactivate()  → kill PTY, unregister IPC                          │
└──────────────────────────────────────────────────────────────────────┘
```

### 2.2 Frontières des composants

| Composant | Responsabilité | Ne fait pas | Fichier proposé |
|-----------|----------------|-------------|-----------------|
| `registry.js` | Manifestes, états d'activation, wrappers de commandes, validation des réglages de module, routage `mod:` | Ne connaît ni Herdr ni xterm | `src/main/modules/registry.js` |
| `manifests.js` | Données pures : id, titres i18n, entry, page, preload, capabilities, commandes, schéma de réglages | Aucun `require` lourd, aucune fonction | `src/main/modules/manifests.js` |
| `host.js` | Façade injectée ; garantit que le module ne manipule pas `OrbeWindow`/`store` directement | Pas de politique métier | `src/main/modules/host.js` |
| `OrbeWindow` | Fabrique et cycle de vie des vues, entrée dans `live`, layout, splits, veille, view-model | Ne connaît pas le protocole Herdr | `src/main/window.js` |
| `store` | Persiste `settings.modules` et les enregistrements d'onglets ; normalise | Ne persiste jamais le contenu terminal | `src/main/store.js` |
| Page module | UI du module, xterm, états d'erreur | Aucun accès Node, aucun `window.orbe` générique | `src/renderer/modules/terminal/terminal.html` |
| Preload module | Pont minimal et dédié | Pas d'API shell complète | `src/preload/terminal.js` |
| Settings UI | Liste des modules, toggle, champs du schéma | Ne charge pas les entrées de module | `src/renderer/settings.html` + `settings.js` |

### 2.3 Manifeste et états

Manifeste (données seulement, CommonJS) :

```js
// src/main/modules/manifests.js
module.exports = [{
  id: 'terminal',
  titleKey: 'modules.terminal.name',
  descriptionKey: 'modules.terminal.description',
  entry: './terminal/index.js',          // require paresseux
  page: 'modules/terminal/terminal.html', // sous src/renderer, servi par orbe://
  preload: 'terminal.js',                 // sous src/preload
  defaultEnabled: false,
  capabilities: ['process.spawn', 'pty', 'clipboard.write'],
  commands: [
    { name: 'terminal.newTab', label: 'modules.terminal.newTab', accel: 'Alt+Cmd+T', lazy: 'newTab' },
    { name: 'terminal.reconnect', label: 'modules.terminal.reconnect', lazy: 'reconnect' }
  ],
  settings: {
    herdrPath: { type: 'path', default: '' },
    session: { type: 'string', default: '', pattern: '^[A-Za-z0-9._-]{0,64}$' },
    fontSize: { type: 'int', min: 9, max: 24, default: 13 },
    scrollback: { type: 'int', min: 1000, max: 50000, default: 5000 },
    macOptionIsMeta: { type: 'bool', default: false }
  }
}];
```

États runtime :

| État | Persisté | Entrée chargée | IPC module | Processus | Coût au démarrage |
|------|----------|----------------|------------|-----------|-------------------|
| `disabled` | `enabled: false` | non | non | non | manifeste seul (~1 Ko) |
| `enabled-inactive` | `enabled: true` | non | non | non | manifeste + wrappers de commandes |
| `active` | oui | oui, une fois | oui | 0..N selon onglets | payé à la première utilisation |
| `failed` | oui | oui | partiel | non | erreur affichée, pas de boucle de retry |
| `disabled` à chaud | oui | code résident | retiré | tués | mémoire du module non récupérée avant redémarrage |

Règles :

- **L'activation est explicite** : toggle utilisateur ou première invocation d'une commande de module.
- **Le démarrage ne charge aucune entrée**, même pour un module `enabled`. C'est la différence entre « activé par l'utilisateur » et « chargé au boot ».
- **La désactivation à chaud** ferme les onglets du module (après confirmation), tue les processus et retire les handlers IPC. Le code reste dans `require.cache` ; l'UI indique qu'un redémarrage libère la mémoire.
- **Isolation future** : les modules internes sont du code de confiance signé avec l'app. Les `capabilities` sont une déclaration d'audit et une surface d'API, **pas un bac à sable**. Une API de plugins externe devra utiliser un `utilityProcess` + RPC restreint.

### 2.4 Commandes et menus sans charger le module

Le registre enregistre, pour les modules `enabled`, des **wrappers de commandes** construits à partir du manifeste :

```js
commands.register({
  name: 'terminal.newTab',
  label: 'modules.terminal.newTab',
  accel: 'Alt+Cmd+T',
  run: (w, arg) => modules.runCommand('terminal', 'newTab', w, arg)
});
```

`runCommand()` active le module si nécessaire, puis appelle l'action correspondante. Conséquences :

- Le menu et la barre de commande affichent les commandes dès que le module est activé, sans charger node-pty ni Herdr.
- Un module `disabled` n'apparaît pas dans le menu. Le passage à `enabled` appelle `menu.refresh(true)` et `OrbeWindow.pushAll()`.
- Les libellés viennent de `src/shared/locales.js` (fr + en), comme le reste.

### 2.5 IPC, préloads et frontière de confiance

Deux plans distincts :

**Plan de contrôle** (création, suppression, reconnexion, réglages) :

```text
renderer module → window.orbeTerm.action(name, payload)
  → ipcRenderer.invoke('orbe', `mod:terminal:${name}`, payload)
  → ok(e) dans main.js
  → modules.action('mod:terminal:newTab', payload, sender)
  → handler du module (identité dérivée du sender, jamais du payload)
```

Ajout dans `setupIpc()` :

```js
if (action.startsWith('mod:')) return modules.action(action, payload, e.sender);
```

**Plan de données** (octets du terminal, haute fréquence) : canaux dédiés, jamais le routeur `orbe` générique.

```text
preload/terminal.js
  ipcRenderer.send('term:ready', cols, rows)
  ipcRenderer.send('term:input', data)
  ipcRenderer.send('term:binary', data)
  ipcRenderer.send('term:resize', cols, rows)
  ipcRenderer.send('term:ack', bytes)
  ipcRenderer.on('term:data', (e, chunk) => …)
  ipcRenderer.on('term:state', (e, state) => …)
```

Règles de validation :

- `ipcMain.on('term:*')` vérifie d'abord `ok(e)` puis l'identité exacte : `sessionsByWc.get(e.sender.id)` doit exister. Le module ne lit **jamais** un `tabId` fourni par le renderer.
- Le `tabId` est retrouvé par `host.tabForWebContents(e.sender)` (parcours de `live`), ou stocké dans la session au moment de la création de la vue.
- Tailles bornées (`cols` 2..500, `rows` 2..200), chaînes d'entrée bornées (par ex. 1 Mo par message), types stricts, rejet des valeurs non finies.
- `ui.js` n'est **pas** modifié : l'EVENTS whitelist de la coque reste fermée. La page terminal a son propre preload.
- Aucun `sendSync` nouveau. Le seul existant (`i18n` au boot) reste toléré ; la page terminal peut recevoir ses libellés via `term:state` pour éviter tout sync.

### 2.6 Réglages et persistance

```js
// store.state.settings
modules: {
  terminal: {
    enabled: false,
    herdrPath: '',
    session: '',
    fontSize: 13,
    scrollback: 5000,
    macOptionIsMeta: false
  }
}
```

- `DEFAULT_SETTINGS.modules = {}` ; `store.normalize()` fusionne les défauts du manifeste et valide chaque champ.
- Les identifiants inconnus sont **conservés** (downgrade non destructif) mais non rendus.
- `settings:set` reste réservé aux réglages du cœur (`SETTABLE`). Les réglages de module passent par `modules.setSetting(id, key, value, sender)`, validés par le schéma du manifeste. On évite ainsi d'ouvrir `SETTABLE` à des clés arbitraires.
- `settings:get` expose `modules.publicState()` : manifestes + `enabled` + valeurs validées, sans charger les entrées.
- L'activation est par utilisateur (un seul `orbe.json`), pas par profil. Un module global (terminal) n'a pas de sens par profil ; le documente.

### 2.7 Sandboxing et anti-patterns du socle

- Page module : `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, `webviewTag: false`, preload dédié, navigation interne uniquement, CSP `default-src 'self'`.
- Session de la vue module : **session UI par défaut** (aucune permission web), pas la session du profil de l'Espace. Cela évite d'exécuter les preloads de mots de passe/media/swipe ou l'API `chrome.*` dans la page terminal.
- Le module ne reçoit pas `require` restreint (impossible en CommonJS) ; il reçoit une façade et un code review. Ne pas prétendre à un sandbox.
- Anti-patterns :
  - `require('./modules/terminal')` au top-level de `main.js` → coût au démarrage.
  - Enregistrer les handlers IPC du module au boot → charge inutile et surface permanente.
  - Faire passer les octets du terminal par `ipcRenderer.invoke('orbe', …)` → latence et validation confuse.
  - Laisser le renderer choisir le binaire, les arguments, le nom de session ou le `tabId`.
  - Charger `terminal.html`/xterm dans la coque shell → coût pour tous, frontière brouillée.
  - Stocker du contenu terminal, du scrollback ou des chemins locaux dans `orbe.json`, les backups ou les diagnostics.

---

## 3. Module Terminal/Herdr

### 3.1 Décision d'intégration

| Option | Rendu | PTY requis | Fidélité Herdr | Périmètre Orbe | Verdict |
|--------|-------|------------|----------------|----------------|---------|
| **A. TUI Herdr dans un PTY** | Client Herdr complet dans xterm.js | oui | exacte (tabs, panes, souris, couleurs) | faible : Orbe gère ses onglets, Herdr le reste | **Retenu pour le milestone** |
| B. Flux par pane `herdr terminal session control` | ANSI d'un pane dans xterm.js | non | pas de chrome Herdr ; Orbe doit reconstruire workspaces/tabs/panes | élevé | Post-MVP, API preview |
| C. Snapshot JSON + `pane.read` polling | texte périodique | non | mauvaise (pas de flux continu, pas de clavier) | élevé | Rejeté pour un terminal vivant |
| D. Réimplémenter Herdr / l'embarquer comme bibliothèque | — | — | — | très élevé | Hors périmètre explicite |

Le milestone demande la **TUI Herdr** rendue par xterm.js et laisse Herdr gérer ses workspaces/tabs/panes. L'option A est la seule qui respecte ces deux phrases sans réécrire Herdr. Elle a un coût : un PTY natif et un client Herdr par onglet Orbe.

### 3.2 Vue d'ensemble et flux de données

```text
┌──────────────────────────── Orbe renderer (sandbox) ─────────────────────────┐
│ terminal.html + terminal.js                                                  │
│  Terminal (xterm.js) · FitAddon · WebglAddon · états «Her dd absent / reconnexion» │
└───────────────▲──────────────────────────────────────────┬──────────────────┘
                │ term:data (Uint8Array)                    │ term:input / binary / resize / ack
┌───────────────┴──────────────────────────────────────────▼──────────────────┐
│ preload/terminal.js — pont minimal, allowlist de canaux                      │
├──────────────────────────────────────────────────────────────────────────────┤
│ Main — module terminal (chargé à la première utilisation)                    │
│  TerminalSessions : Map<webContents.id, HerdrSession>                        │
│  HerdrSession : preflight · spawn · write · resize · kill · state            │
│  Flow control : ack window, pause()/resume() du PTY                          │
├──────────────────────────────────────────────────────────────────────────────┤
│ node-pty (vendorisé, prébuilds N-API)                                        │
│  pty.spawn(herdr, args, { cols, rows, env, cwd })                            │
└───────────────▲──────────────────────────────────────────┬──────────────────┘
                │ TUI ANSI (stdout)                         │ frappes / souris (stdin)
                ▼                                          ▼
        client Herdr (Rust) ──── socket Unix / named pipe ──── serveur Herdr
                                                                 │
                                                    workspaces · tabs · panes
                                                    PTY réels · agents · état
```

Flux aller :

1. `xterm.onData` (ou `onBinary`) → `window.orbeTerm.input()`.
2. `ipcMain.on('term:input')` → validation sender → `session.pty.write(data)`.
3. Le client Herdr transmet au serveur ; le serveur écrit dans le PTY du pane.

Flux retour :

1. Le pane produit des octets → serveur Herdr → client Herdr → TUI ANSI sur le PTY master.
2. `pty.onData` → contrôle de flux → `webContents.send('term:data', chunk)`.
3. `preload` → `xterm.write(chunk, ack)` → `term:ack` → reprise du PTY.

Redimensionnement :

```text
FitAddon calcule cols/rows → term:resize → validation → pty.resize(cols, rows)
→ SIGWINCH → le client Herdr reçoit la nouvelle taille → la TUI se réagence
```

### 3.3 Cycle de vie d'un onglet terminal

```text
[Commande terminal.newTab]
  → modules.activate('terminal')
  → OrbeWindow.createModuleTab('terminal')
      enregistrement { id, kind:'terminal', module:'terminal', url:orbe://app/modules/terminal/terminal.html,
                      title, icon, createdAt, lastActiveAt } ; pas d'archive
  → activate(id) → ensureView(id)
      branche kind === 'terminal' : WebContentsView + preload terminal.js + session UI
      chargement de terminal.html (xterm seulement ici)
  → xterm prêt → term:ready(cols, rows)
      → preflight Herdr (status server, session list)
      → pty.spawn(herdr, args, { cols, rows })
      → état 'connected' ; les données circulent
[Onglet masqué]  → layout détache la vue ; le PTY reste vivant (comportement par défaut)
[Onglet fermé]   → kill PTY → suppression de l'enregistrement ; jamais d'archive
[Vue détruite]   → sleep/crash → kill PTY ; au réveil, nouvelle vue → preflight → respawn
[Quitter Orbe]   → module.deactivate() → kill de tous les clients ; jamais `herdr server stop`
[Serveur mort]   → le client sort → état 'disconnected' → message + bouton « Reconnecter »
```

Détails d'intégration :

- `ensureView()` reste **le seul** créateur de vues. La branche terminal est petite (≈30 lignes) : sélection de page/preload/session depuis le manifeste, puis `live.set` et un `wire` minimal.
- `wire()` pour un onglet terminal : `trusted.add(wc)`, garde de navigation interne, `destroyed` → kill session. On saute les comportements web (media, Peek, before-mouse-event, extensions) qui n'ont pas de sens ici.
- `layout()` est inchangé : une `WebContentsView` terminal se positionne comme une page web, donc splits, ratios, glisser-déposer et tear-off continuent de fonctionner.
- `sendState()` ajoute `kind`, `module` et le titre terminal. Le renderer masque l'adresse, le favicon et les actions de navigation pour `kind === 'terminal'`, et affiche une icône terminal.
- `close()`, `closeMany()` et `deleteTabs()` doivent brancher sur `kind === 'terminal'` : kill de session, suppression sans `archive`, pas de `reopenClosed`. Ces trois chemins sont les plus faciles à oublier.
- La veille : par défaut, **ne pas** inclure les onglets terminal dans `veille.pick()` au premier jet. Un onglet terminal caché garde son client et sa vue ; c'est acceptable pour quelques onglets. Une politique `sleepHidden` pourra être ajoutée après mesure (tuer le client est sans danger : Herdr garde les panes).
- `capturePage()` pour la bascule peut capturer un terminal ; l'image reste en mémoire, jamais persistée. Optionnellement, la désactiver pour les onglets terminal.

### 3.4 PTY : dépendance, packaging et alternatives

**Constat.** Electron n'a pas d'API PTY. `child_process.spawn` avec des pipes ne donne ni `isatty`, ni mode raw, ni `TIOCGWINSZ`. La TUI Herdr a besoin des trois.

**Décision recommandée : vendorer node-pty 1.1.0.**

- Licence MIT, maintenu par Microsoft, utilisé par VS Code et la plupart des terminaux Electron.
- Le paquet npm contient des **prébuilds N-API** chargés directement depuis `prebuilds/<platform>-<arch>/` quand `build/Release` est absent. On a vérifié que `pty.node` (macOS arm64) n'importe que des symboles `napi_*` : il est donc indépendant de l'ABI Node/Electron. Aucun `node-gyp`, aucun `npm install`, aucun build.
- macOS : `pty.node` + `spawn-helper` (exécutable séparé, ~52 Ko). Windows : `pty.node` + `conpty.dll` + `OpenConsole.exe` (ConPTY, Windows 10 1809+ ; winpty a été retiré).
- API utile : `pty.spawn(file, args, { cols, rows, env, cwd, name })`, `onData`, `write`, `resize`, `kill`, `pause`, `resume`.
- Emplacement : `src/main/vendor/node-pty/` (inclus par `build-mac.js`/`build-win.js`, qui copient `src/` dans `resources/app`). Conserver les helpers **hors asar** (l'app n'utilise pas asar aujourd'hui) et les signer : `codesign --deep` les couvre, mais une notarisation future exigera une signature explicite du `spawn-helper`.
- Windows : livrer `conpty.dll` et `OpenConsole.exe` à côté de `pty.node` dans le même dossier `prebuilds/win32-x64/` ; ne pas dépendre du Windows Terminal installé.
- Vérification : charger node-pty **uniquement** à l'activation du module, avec un `try/catch` qui affiche une erreur claire (« module terminal indisponible sur cette plateforme ») et n'entraîne pas le reste d'Orbe. Un smoke test dans le selftest doit spawner `/bin/sh -c 'printf ok'` et vérifier `onData`.

**Alternatives rejetées :**

| Alternative | Pourquoi rejetée |
|-------------|------------------|
| `script -q /dev/null herdr` (macOS) | Donne un PTY, mais aucun moyen portable de fixer/propager la taille ; la TUI ne se redimensionne pas correctement. |
| `expect`, `python3 -c pty`, tmux/screen | Dépendances externes, fragiles, présentes ou non selon la machine ; ne respecte pas « aucune installation supplémentaire ». |
| Helper Rust `portable-pty` en sidecar | Élimine le module natif Node, mais ajoute un binaire compilé par plateforme, un protocole stdio, du packaging et de la signature. À garder comme plan B si node-pty casse avec Electron 44. |
| Flux JSON `herdr terminal session control` | Pas de PTY, mais API preview et change le produit (Orbe doit rendre les panes, pas la TUI). Voir 3.10. |

**Impact planning.** Ce n'est plus « xterm.js première dépendance runtime » mais « xterm.js + node-pty ». C'est une décision à consigner dans PROJECT.md avant la phase terminal, avec la justification : sans PTY, pas de TUI Herdr fidèle.

### 3.5 Lancer et attacher Herdr

Préflight obligatoire avant tout `spawn` :

```text
1. Résoudre le binaire : setting herdrPath (absolu, exécutable), sinon candidats
   /opt/homebrew/bin/herdr, /usr/local/bin/herdr, ~/.local/bin/herdr,
   sinon `which herdr` via PATH de l'app (pas de shell).
2. `herdr status server` (avec timeout ~2 s) : ne démarre RIEN.
   - Si le serveur manque : afficher le message `server_not_running` et un lien vers l'installation.
   - Ne jamais lancer `herdr` nu : la commande « start or attach » démarre le serveur, ce qui viole
     la contrainte « l'utilisateur fournit un serveur déjà lancé ».
3. Si une session nommée est configurée : `herdr session list --json` et vérifier qu'elle existe.
   Ne pas créer de session implicitement.
4. `herdr --version` : consigner dans les diagnostics ; avertir si le protocole semble incompatible.
5. Seulement alors : spawn du client dans le PTY.
```

Commande de spawn :

```js
// session vide : attache à la session par défaut
pty.spawn(herdrPath, [], { name: 'xterm-256color', cols, rows, cwd: home, env });

// session nommée
pty.spawn(herdrPath, ['--session', sessionName], { … });
```

Environnement :

- `TERM=xterm-256color`, `COLORTERM=truecolor`, `LANG`/`LC_ALL` de l'app, `HOME`, `PATH` minimal.
- Retirer `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS`, `ORBE_*` de test, et toute variable contenant un secret.
- `cwd` : dossier personnel ou réglage dédié. Pas le dossier d'un Space (sans rapport avec Herdr).
- Aucun `shell: true`, aucune concaténation de commande. Le nom de session est validé par regex et passé comme argument séparé.

Multi-client :

- Chaque onglet Orbe = un client Herdr = un PTY. Herdr autorise plusieurs clients ; chacun peut regarder son propre workspace/tab. Si deux clients regardent le même tab, **le dernier focus contrôle la géométrie** du tab. C'est une propriété Herdr à assumer.
- Pour éviter les combats de resize : à la création, assigner chaque onglet Orbe à un workspace/tab Herdr distinct (via la CLI ou le socket) ou laisser l'utilisateur choisir. Ne pas envoyer de resize pour une vue masquée.
- Ne pas utiliser `--takeover` avec un client TUI. Pour un futur flux `terminal session control`, `--takeover` vole le contrôle à un autre client : l'éviter sauf action explicite.

Reconnexion et reprise :

- Herdr garde les panes et les processus quand le client se détache ou qu'Orbe quitte. Orbe ne possède **aucun** état de pane.
- À la fermeture d'un onglet : tuer le client. À la fermeture d'Orbe : tuer tous les clients. Ne jamais appeler `herdr server stop`.
- Si le serveur Herdr redémarre : Herdr restaure la disposition mais **pas les processus** ; Orbe reconnects et affiche l'écran courant. Ne pas promettre la reprise des commandes en cours.
- Si le client sort avec un code d'erreur : état `disconnected`, message lisible, bouton « Reconnecter ». Un seul retry automatique avec backoff, puis action utilisateur. Pas de boucle qui spawn des clients en cascade.
- L'onglet terminal Orbe persiste : `{ id, kind, module, title, herdr: { session } }`. Aucun scrollback, aucune sortie, aucun secret.

### 3.6 Intégration xterm.js

Fichiers vendorisés, chargés **uniquement** par `terminal.html` :

```text
src/renderer/modules/terminal/vendor/xterm/
  xterm.js            (@xterm/xterm 6.0.0, UMD, ~489 Ko)
  xterm.css           (~7 Ko)
  addon-fit.js        (@xterm/addon-fit 0.11.0, UMD, global FitAddon)
  addon-webgl.js      (@xterm/addon-webgl 0.19.0, UMD, global WebglAddon)
  LICENSE*            (MIT)
```

Ordre de chargement : `xterm.js`, `addon-fit.js`, `addon-webgl.js`, puis `terminal.js`. Aucun bundler : les builds UMD exposent `Terminal`, `FitAddon`, `WebglAddon` sur `globalThis`.

Configuration recommandée :

```js
const term = new Terminal({
  fontFamily: '"SF Mono", Menlo, Consolas, monospace',
  fontSize: settings.fontSize,
  lineHeight: 1.2,
  cursorBlink: true,
  scrollback: settings.scrollback, // 5 000 par défaut, borné
  allowProposedApi: false,
  macOptionIsMeta: settings.macOptionIsMeta, // configurable, false par défaut
  theme: themeFromSpace()
});
term.open(document.getElementById('terminal'));
term.loadAddon(new FitAddon.FitAddon());
try {
  const webgl = new WebglAddon.WebglAddon();
  webgl.onContextLoss(() => webgl.dispose()); // repli DOM automatique
  term.loadAddon(webgl);
} catch {}
```

- **Rendu** : WebGL2 si disponible, sinon DOM. xterm 6 a supprimé le renderer canvas ; le WebGL réduit fortement le coût de repaint d'une TUI dense. Prévoir un réglage `renderer: auto|webgl|dom` si des artefacts apparaissent.
- **Dimensions** : `FitAddon` + `ResizeObserver` sur le conteneur, debounce 30–50 ms, jamais 0×0. Le premier `term:ready` envoie les dimensions calculées pour éviter un premier écran 80×24 qui saute.
- **Clavier** : `term.onData(data => input(data))`. `term.onBinary(data => binary(data))` pour les rapports souris binaires ; côté main, `pty.write(Buffer.from(data, 'binary'))`. IME et touches mortes (accents français) sont gérés par xterm ; tester ⌥ et les compositions.
- **Souris** : Herdr est mouse-first. xterm encode les modes SGR quand l'application les active ; ne pas intercepter les clics dans la page terminal. La sélection native est limitée par le mode souris de la TUI ; Herdr gère sa propre sélection/copie.
- **Presse-papiers** : `⌘C` copie la sélection xterm (via `navigator.clipboard` ou un canal main), ne l'envoie pas au PTY ; `Ctrl+C` reste SIGINT. Le collage passe par le textarea xterm et le bracketed paste. Désactiver OSC 52 par défaut (une application terminale ne doit pas écrire le presse-papiers sans opt-in) ; si activé, demander confirmation.
- **Liens** : `WebLinksAddon` ou link provider maison ; autoriser uniquement `http(s)`, sur geste utilisateur, et ouvrir via le cœur (`newTab`). Jamais `file:`, `javascript:` ou `orbe:`. Les liens OSC 8 sont traités comme du texte non fiable.
- **Thème** : réutiliser les couleurs de l'Espace et le thème sombre/clair. Envoyer un événement `theme` à la vue terminal quand l'Espace change ; ne pas relire le thème dans le renderer.
- **Mémoire** : scrollback borné ; `term.clear()`/`dispose()` à la destruction ; ne jamais persister le buffer. Un terminal d'agent peut contenir des secrets.
- **Raccourcis Orbe** : les combinaisons ⌘ restent des commandes Orbe ; Ctrl/Alt passent au terminal. ⌘W ferme l'onglet terminal, ⌘T ouvre la barre de commande (comportement existant). Prévoir une commande explicite « Nouvel onglet terminal » plutôt que de détourner ⌘T.
- **Accessibilité** : xterm a un textarea et un screen reader mode ; ne pas le masquer. Tester avec VoiceOver si possible.

### 3.7 Contrôle de flux et latence

Le risque principal n'est pas le CPU d'xterm, c'est une **rafale de sortie** (agent bavard, `yes`, build verbeux) qui remplit la file IPC et bloque le main.

```text
pty.onData(chunk)
  → si outstanding < WINDOW : envoyer immédiatement (ou coalescer ≤ 8–16 ms)
  → sinon : mettre en file bornée et pty.pause()
renderer : term.write(chunk, () => ack(chunk.length))
main : outstanding -= bytes ; si outstanding < LOW : pty.resume() et vider la file
```

- `WINDOW` ≈ 1–2 Mo, `LOW` ≈ 256–512 Ko. Ne jamais dropper des octets.
- `pty.pause()/resume()` existe dans node-pty ; ne pas activer `handleFlowControl` (XOFF/XON) car il consomme des octets d'entrée utilisateur.
- Coalescer les petits chunks par tour de boucle, mais privilégier la latence clavier : une frappe doit partir immédiatement, sans attendre un batch.
- Côté renderer, ne pas faire de travail DOM par chunk ; xterm gère son propre parseur. Éviter les `console.log` de données.
- Mesurer : latence frappe→écho (cible < 30 ms sur macOS), débit soutenu, mémoire après 100 Mo de sortie.

### 3.8 Sécurité du module terminal

Modèle de menace : **un terminal est une exécution de code local par conception**. L'utilisateur l'active explicitement ; Herdr tourne avec ses privilèges. La sécurité consiste à empêcher une page web d'y accéder, pas à sandboxer les commandes.

| Risque | Mitigation |
|--------|------------|
| Une page web atteint l'IPC terminal | `ok(e)` + frame `orbe://app/` + vérification exacte du `webContents` terminal ; preload dédié ; pas d'événements terminal dans `ui.js` |
| Le renderer choisit binaire/args/session | Ces valeurs viennent des réglages validés côté main ; arguments séparés ; regex de session ; pas de shell |
| Injection dans l'environnement | env construit par liste blanche ; suppression de `NODE_OPTIONS`, `ELECTRON_RUN_AS_NODE`, variables de test |
| Fuite de secrets dans les logs/backups | Aucune sortie terminal persistée ; backups et diagnostics excluent le buffer ; logs bornés et sans contenu |
| Presse-papiers piloté par la sortie | OSC 52 désactivé par défaut ; copie seulement sur sélection/geste |
| Lien malveillant dans la sortie | http(s) uniquement, geste utilisateur, ouverture via le cœur |
| Élévation via le module | Le module n'a pas `OrbeWindow`/`store` ; la façade limite les opérations ; capabilities déclaratives pour l'audit |
| Accès depuis une session de profil | La vue terminal utilise la session UI par défaut, pas la session du profil |
| Processus orphelins | `destroyed`, `window closed`, `before-quit` et `deactivate` tuent les PTY ; test de non-régression |

Le serveur Herdr est externe et considéré comme fourni par l'utilisateur. Orbe ne l'installe pas, ne le démarre pas, ne le met pas à jour et ne l'arrête pas dans ce milestone.

### 3.9 Alternative post-MVP : flux JSON par pane

Herdr 0.9.x expose (présenté comme **preview**) :

```text
herdr terminal session control <target> [--takeover] [--cols N] [--rows N]
herdr terminal session observe <target> [--cols N] [--rows N]
```

- `control` : flux NDJSON `terminal.frame` (octets ANSI en base64) + `terminal.closed` ; accepte sur stdin `terminal.input`, `terminal.resize`, `terminal.scroll`, `terminal.mouse`, `terminal.release`. Un seul contrôleur à la fois.
- `observe` : lecture seule, plusieurs observateurs, pas d'input/resize.
- C'est ce que fait Herdex (client VS Code communautaire) : hydratation via `session.snapshot`, contrôle via `terminal session control`, polling du snapshot pour les titres/agents.

Pourquoi pas maintenant : l'API est preview, il faut construire l'UI des workspaces/tabs/panes côté Orbe (donc réimplémenter une partie de Herdr), et le milestone demande la TUI. Pourquoi la prévoir : elle supprime node-pty et permet la sélection native, un rendu par pane et des onglets Orbe alignés sur les panes Herdr. **Concevoir `HerdrSession` comme un adaptateur de transport** (PTY/TUI vs flux JSON) pour pouvoir l'ajouter sans toucher xterm, le modèle d'onglets ni l'IPC.

### 3.10 Ordre de construction recommandé

| Phase | Livrable | Porte de sortie |
|-------|----------|-----------------|
| **M1. Socle de modules** | Registre, manifestes, schéma de réglages, wrappers de commandes, route `mod:`, section Réglages | Module désactivé absent de `require.cache` ; démarrage inchangé ; activer/désactiver persiste ; désactiver ferme les onglets |
| **M2. Tranche verticale terminal (macOS)** | xterm + node-pty vendorisés, `kind:'terminal'`, `ensureView`, preload dédié, préflight Herdr, un onglet, états d'erreur | Attacher, taper, redimensionner, fermer ; serveur absent → message clair ; jamais de démarrage implicite du serveur |
| **M3. Cycle de vie multi-onglets** | Sessions map, plusieurs clients, reconnexion, splits, close/delete/quit, flow control, presse-papiers | Aucun PTY orphelin ; rafale de sortie sans blocage ; reconnexion après kill du client |
| **M4. Intégration UX et sécurité** | Sidebar/nav, thème, commandes, réglages, désactivation, tests d'accès refusé depuis une page web, mesures | Tests de sécurité, latence, démarrage ; pas d'archive/veille incohérente |
| **M5. Durcissement et plateformes** | Packaging macOS (signature du helper), validation Windows ConPTY, diagnostics, optionnel titres/agents via snapshot Herdr | App packagée : terminal fonctionnel ; Windows validé ou explicitement reporté |

**Implications roadmap :**

- M1 doit être une phase distincte et livrable seule : elle valide le socle sur un cas réel sans introduire Herdr.
- M2 est la phase la plus risquée (PTY + Herdr). Elle doit inclure un spike de 1–2 jours sur node-pty/Electron 44 et sur l'attache Herdr avant l'implémentation complète.
- M3 et M4 peuvent se chevaucher partiellement, mais la sécurité IPC doit être finie avant de considérer le module « livré ».
- La migration Rust ne doit pas être une phase de ce milestone. Un spike séparé, après M5, avec les critères de 4.6.

---

## 4. Migration Electron → Rust/Tauri/CEF

### 4.1 Verdict

| Scénario | Verdict | Raison |
|----------|---------|--------|
| Rester sur Electron pour ce milestone | **Recommandé** | Seul chemin qui préserve extensions, sessions/profils, adblock, WebContentsView par onglet, tests et parité Arc |
| Tauri 2 + wry | **Non** | WebKit sur macOS, pas de Chromium, pas d'extensions Chrome, pas de sessions/profils, multiwebview instable |
| Tauri 3 alpha + CEF | **Trop tôt** | Alpha, runtime séparé, sandbox Windows absente selon la doc, extensions non documentées |
| Shell Rust+CEF maison | **Réécriture majeure** | 12–24+ mois pour une parité incertaine, sans gain mémoire sur les renderers Chromium |
| Migration incrémentale du cœur | **Impossible** | Le propriétaire de l'état, le pont et le modèle de vues changent ensemble |

La priorité « fluidité/légèreté » ne justifie pas CEF : CEF embarque Chromium, donc le coût des renderers reste. Les gains réels sont dans la gestion des processus/vues, le lazy loading et le protocole d'état, pas dans le langage du main process.

### 4.2 Mapping Electron → Tauri 2 (wry) → Rust+CEF

| Capacité Orbe | Electron aujourd'hui | Tauri 2 + wry | Rust + CEF | Verdict |
|---------------|----------------------|---------------|------------|---------|
| Cycle de vie app, single instance, deep links | `app`, `open-url`, `continue-activity`, `second-instance` | Builder + plugins deep-link/single-instance | À réécrire | Faisable, coût moyen |
| Fenêtre + une vue par onglet | `BaseWindow` + `WebContentsView`, `addChildView`, bounds, z-order, re-parenting | `Window::add_child` + `WebviewBuilder` **unstable**, bounds manuels, deadlock Windows, GTK Fixed | CefWindow/Views ou OSR, à construire | **Blocage结构ant** : pas d'équivalent stable |
| Vues d'appoint / overlays partageant un renderer | `window.open` + `adoptSpare`, `SPARES`, `wanted` | Pas d'équivalent | À construire | Electron-specific |
| Sessions/profils par Espace | `session.fromPartition('persist:orbe-…')` | `data_directory` (Windows seulement), `incognito` (macOS nonpersistent), pas de profils nommés cross-platform | `CefRequestContext` par profil | **Blocage** : modèle à refaire |
| Extensions Chrome + API `chrome.*` + side panel + debugger | `session.loadExtension`, `ext-api.js`, `ext-panel.js` | Impossible sur WKWebView ; WebView2 extensions désactivées/non configurables | Non documenté ; le support CEF des extensions Chrome n'est pas équivalent | **Blocage produit** |
| Bloqueur de pubs via `webRequest` | `session.webRequest.onBeforeRequest` | Pas d'API cross-platform | `CefRequestHandler` (CEF uniquement) | **Blocage** pour la priorité vie privée |
| Protocole interne `orbe://` + frontière de confiance | `protocol.handle`, `INTERNAL`, `ok(e)` | `register_uri_scheme_protocol`, origine dépendante de la plateforme (`tauri://localhost` vs `http://tauri.localhost`) | Scheme handler CEF | Faisable, mais toutes les URL/trust checks changent |
| Preloads isolés + `contextBridge` | `contextIsolation`, preloads par session | `initialization_script` (main world) + isolation pattern ; pas de world isolé par vue | À construire (CefV8Context) | Redesign, risque de sécurité |
| Mots de passe `safeStorage` | Keychain/DPAPI via Electron | Rust `keyring`/Stronghold | Keychain/DPAPI direct | Faisable, mais re-chiffrement de l'existant |
| Téléchargements, permissions, certificats, auth HTTP, popups, beforeunload | Événements Electron | Partiel, APIs par plateforme | Handlers CEF | Réécriture plateforme |
| Capture, find, print, zoom, PiP, devtools, menus contextuels | APIs Electron | APIs Tauri partielles | À construire | Réécriture |
| Widevine/DRM | castlabs Electron | Non prouvé | CDM CEF à licencier/configurer | **Blocage** probable |
| Mises à jour vérifiées SHA-256 | `updates.js` maison | Updater Tauri (signature requise) | À construire | Changement de chaîne |
| Tests E2E/UI (selftest, Playwright, clavier réel) | Harnais Electron invisible, 1 500+ vérifications | `tauri-driver` pas sur macOS ; WebDriver limité | À construire | **Coût caché majeur** |
| Intégrations OS (Dock, Handoff, navigateur par défaut, quarantaine, fuses) | Modules Electron + scripts | Partiel/à écrire | À écrire | Réécriture |

### 4.3 Ce qui ne peut pas être mappé (blocages durs)

1. **Extensions Chrome sur macOS.** WKWebView ne les charge pas ; les mainteneurs Tauri répondent explicitement que ce n'est pas corrigeable et renvoient vers Electron. WebView2 désactive les extensions (« Browser Extensions: Off, Configurable: No »). CEF ne documente pas le chargement des extensions Chrome dans le runtime Tauri.
2. **Sessions/profils par Espace.** Aucune API Tauri cross-platform pour des partitions persistantes nommées. `data_directory` est Windows-only ; `incognito` est un store non persistant sur macOS. Le modèle « un profil = cookies/connexions/favoris isolés » serait à reconstruire.
3. **`WebContentsView` par onglet avec re-parenting, overlays et vues d'appoint.** Le multiwebview Tauri 2 est `unstable`, sans équivalent du partage de process par `window.open`, avec des limites de focus/z-order et un deadlock documenté sous Windows. C'est le cœur de la fidélité Arc.
4. **Interception réseau (adblock), permissions, certificats, auth HTTP, popups, beforeunload.** Pas d'API cross-platform. Sans interception, la priorité « vie privée à la Brave » régresse.
5. **Harnais de tests et intégrations OS.** Le selftest, les tests Playwright et les tests clavier réels sont Electron-specific. `tauri-driver` ne couvre pas macOS. C'est un chantier de plusieurs mois, souvent oublié.
6. **DRM/Widevine.** castlabs Electron est un choix explicite ; l'équivalent CEF/WebView n'est pas prouvé et peut exiger des licences.

### 4.4 Ce qui peut réellement être incrémental

| Élément | Peut migrer seul ? | Comment |
|---------|--------------------|---------|
| Renderer HTML/CSS/JS | Partiellement | Les pages et le CSS se réutilisent ; `window.orbe` doit être réimplémenté sur Tauri IPC/events, et les origines/CSP changent |
| Services sans état UI (PTY, updater, keychain, proxy adblock) | Oui | Sidecar Rust ou processus séparé, appelé par Electron ; c'est le seul vrai strangler pattern |
| Module terminal (PTY + Herdr) | Oui, en sidecar | Un helper Rust `portable-pty` parlerait à Electron par stdio ; intéressant seulement si node-pty pose problème |
| Cœur navigateur (état, onglets, sessions, extensions) | Non | Réécriture couplée ; pas de migration par petits morceaux sans deux navigateurs à maintenir |
| Tests | Non | À reconstruire avec la nouvelle pile |

### 4.5 Tauri wry vs Tauri CEF vs shell CEF

- **Tauri 2 + wry** : binaire léger (~15 Mo annoncés), mais WebKit sur macOS. Pas de Chromium, donc pas de fidélité de rendu Chromium, pas d'extensions, pas de sessions/profils, pas d'interception réseau cross-platform. Ce n'est pas Orbe ; c'est un autre navigateur.
- **Tauri 3 alpha + `tauri-runtime-cef`** : Chromium embarqué, toolchain ~1 Go, bundle et mémoire proches d'Electron, APIs alpha, et la doc indique que Windows tourne **sans le sandbox Chromium** quelle que soit la politique. Pour un navigateur dont la priorité 3 est la sécurité, c'est rédhibitoire aujourd'hui.
- **Shell Rust+CEF via `cef-rs`** : contrôle total, profils via request contexts, scheme handlers, download handler, CDP. Mais il faut réécrire fenêtre, onglets, menus, permissions, certificats, mises à jour, keychain, tests et packaging. Les extensions Chrome restent non équivalentes. Aucun gain de mémoire sur les renderers. C'est un projet, pas une migration.

### 4.6 Critères pour rouvrir la question

Ne rouvrir un spike Rust que si **tous** ces points sont réunis :

1. Tauri CEF sort d'alpha avec un support stable sur macOS/Windows, sandbox inclus.
2. Le multiwebview (ou un équivalent CEF) est stable : bounds, focus, z-order, re-parenting, overlays.
3. Les extensions Chrome (ou une stratégie produit assumée de les abandonner) sont tranchées.
4. Les sessions/profils et l'interception réseau ont une API cross-platform.
5. Une mesure montre un gain réel de démarrage/mémoire sur les scénarios d'Orbe (pas seulement le main process).
6. Le coût de réécriture des tests et des intégrations OS est budgété.

D'ici là, les gains de fluidité se cherchent dans Electron : lazy modules, protocole d'état delta, purge des vues, WebGL, démarrage sérialisé, mesure continue.

### 4.7 Estimation d'effort (ordre de grandeur, confiance MEDIUM)

| Scénario | Effort solo | Risque | Parité |
|----------|-------------|--------|--------|
| Socle modules + terminal dans Electron | Semaines (1 milestone) | Moyen | Complète sur le périmètre |
| Tauri 2 + wry, navigateur partiel | 6–12 mois | Très élevé | Extensions/profils/adblock perdus |
| Tauri 3 CEF, parité à construire | 12–24+ mois | Extrême | Incertaine, alpha |
| Shell Rust+CEF maison | 18–36 mois | Extrême | Incertaine, extensions non équivalentes |

---

## 5. Scaling Considerations

| Sujet | 1 onglet terminal | 10 onglets | 50 onglets |
|-------|-------------------|------------|------------|
| Renderers | 1 `WebContentsView` (~20–30 Mo) | 10 vues | 50 vues : trop ; plafonner et détruire les vues masquées |
| Clients Herdr | 1 process Rust léger | 10 process | 50 process : Herdr reste serveur, mais les clients s'accumulent |
| PTY / sortie | trivial | flow control indispensable | flow control + scrollback réduit + coalescing |
| Mémoire xterm | ~5k lignes | 10 × 5k lignes | réduire le scrollback ou partager un renderer multi-xterm |
| Titres/agents | snapshot unique | snapshot unique | polling léger seulement si l'UI l'affiche |
| Démarrage | 0 si module inactif | 0 si aucun onglet ouvert | idem |

Optimisation future : une **surface terminal unique** (un `WebContentsView` avec plusieurs instances xterm) réduirait le coût des renderers, au prix de la gestion des splits/layout dans la page. À envisager seulement si la mesure le justifie.

---

## 6. Integration Points

### 6.1 Externe

| Service | Pattern | Notes |
|---------|---------|-------|
| Herdr CLI + serveur | `spawn` d'un client dans un PTY, socket Unix/named pipe géré par Herdr | Préflight `status server` ; ne jamais démarrer/arrêter le serveur ; session nommée validée ; multi-client assumé |
| Herdr socket JSON (optionnel) | NDJSON, `session.snapshot`, `events.subscribe` | Pour titres/agents plus tard ; events = invalidation, pas de replay ; pas de flux brut |
| Herdr terminal stream (optionnel) | `terminal session control/observe` NDJSON | Preview ; alternative sans PTY ; à isoler derrière un adaptateur |

### 6.2 Internes

| Frontière | Communication | Notes |
|-----------|---------------|-------|
| `registry` ↔ `main.js` | appels directs + wrappers de commandes | Aucune entrée chargée à l'init |
| `registry` ↔ `OrbeWindow` | `host.createModuleTab`, `host.tabForWebContents`, route `mod:` | Le module ne touche pas `window.js` directement |
| `OrbeWindow` ↔ vue terminal | `ensureView`, `layout`, `sendState`, événements `term:*` | La vue reste dans `live` ; pas de création sauvage |
| `preload/terminal.js` ↔ main | canaux dédiés `term:*` | Validation sender exacte ; pas de `tabId` du renderer |
| `store` ↔ module | `settings.modules` + métadonnées d'onglet | Jamais de contenu terminal |
| Settings UI ↔ registry | `settings:get` + `modules.setSetting` | Schéma du manifeste, validation main |

---

## 7. Riskiest Integration Points

| Rang | Point | Risque | Mitigation | Phase |
|------|-------|--------|------------|-------|
| 1 | PTY natif dans Electron 44 | Prébuild N-API incompatible, `spawn-helper` mal signé, ConPTY absent du package Windows | Vendoriser node-pty 1.1.0, smoke test à l'activation, fallback helper Rust, tester l'app packagée | M2 |
| 2 | Présence/cycle de vie Herdr | `herdr` nu démarre un serveur ; session nommée inexistante ; serveur qui meurt ; multi-client qui se bat sur les tailles | Préflight `status server`, `session list`, jamais de takeover, un workspace/tab par onglet, états d'erreur explicites | M2/M3 |
| 3 | Débit IPC et latence | Rafale de sortie qui bloque le main ou noie le renderer ; frappe lente | Canaux dédiés, ack window, pause/resume, coalescing, WebGL, mesure | M3 |
| 4 | Intégration au modèle d'onglets | Archive, veille, splits, re-parenting, sendState oubliés | Brancher `kind` dans `ensureView`/close/delete/sendState ; tests de non-régression ; pas de refonte de `window.js` | M2/M4 |
| 5 | Frontière de confiance | Une page web atteint l'IPC terminal ; `tabId` usurpé | Preload dédié, map `webContents.id`, `ok(e)` + frame, tests d'accès refusé | M2/M4 |
| 6 | Fidélité xterm | Souris, IME, ⌥, OSC 52, WebGL context loss, thème | Tester avec Herdr réel, addons vendorisés, réglages, fallback DOM | M2/M4 |
| 7 | Hypothèses de migration | Planifier Tauri/CEF comme une phase et découvrir les blocages trop tard | Ne pas migrer ; spike séparé avec critères de 4.6 | post-M5 |

---

## 8. Sources

| Source | Usage | Confiance |
|--------|-------|-----------|
| `/Users/lmarques/Dev/orbe/.planning/codebase/ARCHITECTURE.md`, `STACK.md`, `CONCERNS.md` | Modèle existant, contraintes, points fragiles | HIGH (code lu) |
| `src/main/main.js`, `window.js`, `store.js`, `commands.js`, `sessions.js`, `preload/ui.js` | Frontières IPC, vues, état, protocole interne, settings | HIGH (code lu) |
| [Herdr — Agent guide](https://herdr.dev/agent-guide.md) | Architecture serveur/client, CLI, sessions | MEDIUM (doc officielle, recoupée ; seam web = LOW) |
| [Herdr — Concepts](https://herdr.dev/docs/concepts/) | Session/workspace/tab/pane, multi-client | MEDIUM |
| [Herdr — Session state](https://herdr.dev/docs/session-state/) | Détachement, restart, pane history, live handoff | MEDIUM |
| [Herdr — Socket API](https://herdr.dev/docs/socket-api/) | NDJSON, snapshot, events, absence de flux brut | MEDIUM |
| [Herdr — CLI reference](https://herdr.dev/docs/cli-reference/) | `status server`, `session list/attach`, `terminal attach`, `terminal session control/observe` | MEDIUM (certaines commandes terminal = preview) |
| [Herdr — CLI reference preview (zh)](https://herdr.dev/zh-cn/docs/preview/cli-reference/) | Schéma `terminal.frame` base64, `terminal.input/mouse/resize` | LOW (preview) |
| [Herdex — VS Code client for Herdr](https://marketplace.visualstudio.com/items?itemName=mkellerman.herdex) | Précédent d'intégration GUI : snapshot + `terminal session control` | LOW (communauté) |
| [@xterm/xterm 6.0.0 (npm)](https://registry.npmjs.org/@xterm/xterm/latest) + tarball inspecté | UMD `lib/xterm.js`, CSS, version, addons | HIGH (paquet inspecté) |
| [xterm.js Terminal API](https://xtermjs.org/docs/api/terminal/classes/terminal/) | `write`, `onData`, `onBinary`, `loadAddon`, `open`, scrollback | HIGH |
| [xterm.js 6.0.0 release notes](https://github.com/xtermjs/xterm.js/releases) | Canvas renderer supprimé, changements v6 | HIGH |
| [node-pty (GitHub)](https://github.com/microsoft/node-pty) et paquet npm 1.1.0 inspecté | API PTY, ConPTY, prébuilds, `spawn-helper`, pause/resume | MEDIUM (paquet inspecté + README) |
| [Electron 44.7.0 release](https://releases.electronjs.org/release/v44.7.0) | Node 24.21.0, Chromium 152 | MEDIUM (officiel, seam package = LOW) |
| [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage) | Keychain/DPAPI, dépréciation de l'API sync pour Electron 46 | MEDIUM |
| [Tauri — WebviewBuilder (docs.rs)](https://docs.rs/tauri/latest/tauri/webview/struct.WebviewBuilder.html) | `unstable`, `data_directory`, `incognito`, `on_download` | HIGH |
| [Tauri — Window (docs.rs)](https://docs.rs/tauri/latest/tauri/window/struct.Window.html) | `add_child`, `set_bounds`, reparenting | HIGH |
| [Tauri — Shell plugin](https://v2.tauri.app/plugin/shell/) | Spawn/sidecar, capabilities, absence de PTY | HIGH |
| [Tauri — Capabilities](https://v2.tauri.app/security/capabilities/) | Permissions par label de fenêtre/webview, remote URLs | HIGH |
| [Tauri — CEF preview](https://deploy-preview-4126--tauri-v2.netlify.app/develop/cef/) | Tauri 3 alpha, runtime CEF, sandbox Windows absente, limites | HIGH (doc officielle preview) |
| [Tauri discussion #2685](https://github.com/orgs/tauri-apps/discussions/2685) | Extensions Chrome impossibles dans wry/WKWebView | MEDIUM |
| [WebView2 — Differences from Edge](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/browser-features) | Extensions « Off », non configurables ; profils/identité off | HIGH |

**Note de confiance.** Le seam `classify-confidence` classe les sources web non packagées en LOW et les docs de paquets vérifiés en MEDIUM/HIGH. Les affirmations Herdr sont donc étiquetées MEDIUM même si elles proviennent de la documentation officielle, car l'API évolue vite (0.9.x) et les flux terminal sont en preview. Les éléments Electron/module sont HIGH car vérifiés dans le code. Les blocages Tauri/WebView2 sont HIGH car documentés officiellement.

---

*Architecture research for: Orbe — modules optionnels, Terminal/Herdr, sortie Electron*
*Researched: 2026-10-24*
