# Stack Research — Orbe

**Domain:** navigateur de bureau à barre latérale (Electron 44, Chromium 152), milestone « socle de modules + Terminal/Herdr », et décision de sortie d'Electron vers Rust
**Researched:** 2026-10-24
**Confidence:** HIGH sur les versions et l'état des projets ; MEDIUM sur les estimations de portage ; LOW sur les benchmarks comparatifs isolés

## Verdict (à lire en premier)

**Orbe peut-il quitter Electron facilement ? NON.**

Aucune des voies Rust évaluées ne conserve aujourd'hui l'ensemble des fonctions déjà validées d'Orbe sans un portage de plusieurs mois-personne et des pertes fonctionnelles assumées :

- **Tauri 2** (webviews système : WKWebView sur macOS, WebView2 sur Windows) perd les **extensions Chrome sur macOS** (impossible sans forker WebKit), perd **Widevine** sur les deux plateformes, n'expose pas de **mondes JS isolés** comparables aux preloads Electron pour le remplissage de mots de passe, et garde le **multi-webview en fonction `unstable`**.
- **wry sans Tauri** a les mêmes moteurs et les mêmes limites, avec en plus la charge de réécrire le cadre applicatif (menus, updates, dialogues, single-instance).
- **Rust + CEF** est la seule voie qui garde Chromium, mais `cef-rs` est en 0.x, les binaires minimaux pèsent 128 Mo (macOS arm64) à 166 Mo (Windows x64) compressés, et le chargement d'extensions CEF est en transition depuis la dépréciation de `LoadExtension` (CEF 130).
- **Servo 0.7** n'est pas un moteur de navigation généraliste : pas d'extensions, pas de Widevine, compatibilité web incomplète.
- **Tauri 3 alpha + `tauri-runtime-cef` alpha.6** (14 octobre 2026) est la piste la plus prometteuse à terme, mais c'est une alpha publiée il y a dix jours, avec 4 000 téléchargements et un support « windowless browser » tout juste ajouté. Non planifiable.

**Recommandation prescriptive :** rester sur **Electron 44.x** pour ce milestone, passer de 44.7.0 à **44.9.3** (même majeure, Chromium 152.0.7977.167, Node 24.22.0), livrer le socle de modules et le module Terminal avec **xterm.js 6.0.0 vendorisé**. Planifier séparément la montée vers Electron 45/46 **avant l'EOL du 2 mars 2027**. Ne pas migrer vers Rust dans ce milestone ; réévaluer à la frontière de milestone suivante, avec un déclencheur explicite (voir « Go / No-go »).

Si Rust est souhaité à court terme pour la performance, la seule voie à faible risque est **Electron + composants Rust ciblés** (napi-rs ou `utilityProcess` + sidecar), 2 à 6 semaines-personne, sans quitter Chromium ni réécrire l'application.

---

## Recommended Stack (milestone en cours)

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Electron | **44.9.3** (Chromium 152.0.7977.167, Node 24.22.0, V8 15.2) | Runtime applicatif complet | Même majeure que la 44.7.0 actuelle : correctifs de sécurité sans rupture d'API. L'EOL de la 44 est le **2 mars 2027**. La 45.0.0 (Chromium 156.0.8078.48) est sortie le 21 octobre 2026 ; la montée doit être un chantier dédié, pas un effet de bord du milestone. |
| JavaScript ES2022, CommonJS | — | Tout le code applicatif | Contrainte du dépôt : pas de framework, pas de bundler, pas de transpilation. La migration Rust n'est pas justifiée maintenant (voir plus bas). |
| Registre de modules maison | — | Modules internes désactivés par défaut, chargement paresseux | Un fichier manifeste par module (`id`, `nom`, `version`, `actifParDefaut: false`, `réglages`, `entrée`) + un registre dans le processus principal. `require()` du module uniquement à l'activation ; aucun `require` au démarrage. Persistance dans `orbe.json` sous `modules`. C'est le plus petit changement compatible avec l'architecture hub-and-spoke existante. |
| xterm.js (`@xterm/xterm`) | **6.0.0** (publié le 2025-12-22) | Émulation de terminal pour la TUI Herdr | Version courante ; supporte la **sortie synchronisée** (DECSET 2026), utile pour une TUI qui redessine beaucoup. Le renderer canvas a été supprimé en 6.0 (DOM par défaut, WebGL via addon). |
| `@xterm/addon-fit` | **0.11.0** | Redimensionnement du terminal à la taille du panneau | Indispensable pour les volets/onglets redimensionnables et la vue scindée. |
| `@xterm/addon-webgl` | **0.19.0** | Renderer GPU optionnel | À activer seulement si la fluidité du rendu terminal le justifie ; chaque contexte WebGL coûte de la mémoire GPU. Désactivé par défaut, réglable par module. |
| Herdr (serveur externe) | **0.9.5+** (publié le 2026-10-14) | Multiplexeur de terminaux et de panneaux | Orbe s'y attache comme client ; Herdr garde ses workspaces, onglets et panneaux. Aucune bibliothèque à embarquer : utiliser son API socket locale / CLI. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@xterm/addon-web-links` | 0.12.0 | Liens cliquables dans le terminal | Optionnel ; seulement si Herdr n'émet pas déjà des séquences OSC 8 correctes. À vendoriser avec le reste. |
| `@xterm/addon-serialize` | 0.14.0 | Sérialisation du tampon | Optionnel, pour restaurer l'affichage d'un onglet terminal sans rejouer toute la session. À ne pas embarquer au premier jet. |

Aucune autre dépendance runtime. La règle « zéro dépendance » reste tenable : xterm.js et ses addons sont vendorisés, comme prévu dans PROJECT.md.

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `node:test` + `node --test` | Tests unitaires | Commandes réelles du dépôt ; ne pas introduire Vitest (voir CONCERNS.md). |
| `npm test` / `npm run test:ui` / `npm run test:ext` | Selftest Electron, Playwright, extensions | Ajouter une suite Playwright pour l'activation/désactivation de module et une suite `node:test` pour le registre et le protocole terminal. |
| Scripts maison (`scripts/build-mac.js`, `scripts/build-win.js`, `scripts/fuses.js`) | Packaging et fuses | Inchangés. Le module terminal n'ajoute aucun binaire natif. |
| `scripts/dev.js` | Installation de l'engine Electron | Passer la version épinglée à 44.9.3 ; vérifier les SHASUMS publiés (dette déjà connue). |

## Installation

```bash
# Aucun npm install en production : la règle du dépôt est zéro dépendance runtime.
# 1) Engine de développement (déjà géré par le dépôt)
#    package.json — champ orbe.electron: "44.9.3"
npm start

# 2) xterm.js : vendoriser à la main, sans bundler
#    node_modules/@xterm/xterm/lib/xterm.mjs      -> src/renderer/vendor/xterm/xterm.mjs
#    node_modules/@xterm/xterm/lib/xterm.js       -> (facultatif, CJS, non utilisé par le renderer)
#    node_modules/@xterm/xterm/css/xterm.css      -> src/renderer/vendor/xterm/xterm.css
#    node_modules/@xterm/addon-fit/lib/addon-fit.mjs -> src/renderer/vendor/xterm/addon-fit.mjs
#    Conserver LICENSE et le numéro de version à côté des fichiers.

# 3) Pas de build : le renderer charge le module ESM via <script type="module">
#    (xterm.js 6.0.0 n'a plus de bundle UMD ; main = lib/xterm.js CJS, module = lib/xterm.mjs)
```

**Point de vigilance :** `package.json` de `@xterm/xterm@6.0.0` déclare `main: lib/xterm.js` (CommonJS) et `module: lib/xterm.mjs`, mais **pas de champ `browser`/UMD**. Le renderer d'Orbe utilise des `<script src>` classiques : la page du module Terminal doit donc être une page interne servie par `orbe://` avec `<script type="module">` et un import relatif du fichier vendorisé. C'est compatible « aucun build », mais c'est une exception explicite au pattern « scripts classiques » à documenter dans `ARCHITECTURE.md`.

## Stack Patterns by Variant

**Si le module Terminal est désactivé (état par défaut) :**
- Le registre lit le manifeste, ne `require` jamais le module, ne crée aucune vue, n'ouvre aucun socket Herdr.
- Objectif mesurable : aucun coût au démarrage (pas de timer, pas d'écouteur, pas de fichier chargé au-delà du manifeste).

**Si le module Terminal est activé :**
- La page `orbe://app/terminal.html` est une page interne sandboxée, `contextIsolation`, sans Node ; un preload dédié expose uniquement `terminal.connect`, `terminal.write`, `terminal.resize`, `terminal.disconnect`.
- La connexion Herdr vit dans le **processus principal** (ou un `utilityProcess` dédié si le volume de sortie gêne la boucle principale) ; les octets sont relayés par IPC avec backpressure. Aucune page web n'obtient jamais ce canal.
- L'identité Herdr (serveur, session, workspace, onglet) est résolue côté principal, jamais à partir d'un payload de page.

**Si Herdr est absent ou injoignable :**
- Message explicite dans l'onglet terminal, reconnexion avec backoff, conservation de l'onglet côté Orbe ; Herdr garde ses sessions, Orbe ne les détruit pas.

**Si Rust devient un objectif :**
- Commencer par un sidecar Rust (ou un addon napi-rs) pour une fonction mesurable (adblock, parsing, crypto), pas par une réécriture du shell.
- Ne pas réécrire `window.js` en Rust tant que le moteur reste Electron : le gain serait marginal et le coût de rupture élevé.

---

## Alternatives Considered — la décision Electron vs Rust

| Option | Moteur | macOS / Windows | Extensions Chrome | DRM | Profils/sessions isolés | Multi-webviews | Effort de portage | Verdict |
|--------|--------|-----------------|-------------------|-----|--------------------------|----------------|-------------------|---------|
| **(a) Electron 44** | Chromium 152 bundlé | Oui / oui | Oui (déjà livrées) | Widevine via castlabs (déjà livré) | `persist:orbe-<id>` + incognito, complet | `WebContentsView` par onglet, stable | **0** | **Recommandé** |
| **(b) Tauri 2.12.5** | WKWebView / WebView2 | Oui / oui | **Non sur macOS** ; Windows : dossiers unpacked seulement, pas de Web Store, pas d'UI d'extension | FairPlay sur macOS (pas Widevine) ; PlayReady sur Windows (pas Widevine) | `data_store_identifier` macOS 14+ ; dossiers de données WebContext sur Windows ; isolation encore demandée (Tauri #11491) | **`unstable`** uniquement | **38–60 semaines-personne** (~9–14 mois) sans parité | **Non** |
| **(c) wry 0.57.1 sans Tauri** | WKWebView / WebView2 | Oui / oui | Mêmes limites que (b) | Mêmes limites | Mêmes limites | Child webviews stables macOS/Windows/Linux X11 | **42–68 semaines-personne** (~10–16 mois) | **Non** |
| **(d) Rust + CEF (`cef-rs` 156.1.0)** | Chromium 156.0.8078.48 | Oui / oui | Chargement d'extensions CEF déprécié depuis CEF 130 ; relève incertaine | Widevine possible via certification castlabs, non confirmé pour CEF | Request contexts CEF, plusieurs navigateurs | Oui (CEF) | **40–65 semaines-personne** (~9–15 mois), risque élevé | **Plus tard, éventuellement** |
| **(e) Servo 0.7.0** | Servo | Expérimental | Non | Non (Widevine absent) | À construire | API d'embedding pré-1.0 | 60+ semaines-personne et compatibilité web incomplète | **Non** |
| **(f) Electron + Rust ciblé** | Chromium 152 | Oui / oui | Oui | Oui | Oui | Oui | **2–6 semaines-personne** | **Si Rust maintenant** |

### (a) Rester sur Electron 44

**Pourquoi c'est le bon choix maintenant :**
- Toutes les fonctions validées d'Orbe reposent sur des API Electron qui n'ont pas d'équivalent portable ailleurs : `session.fromPartition`, `webRequest` (adblock), `safeStorage`, `webContents.debugger` (unload shield, extensions), `findInPage`, `print`, `capturePage`, `certificate-error`, `login`, `will-download`, `WebContentsView`.
- Le code est déjà optimisé pour la légèreté : pas de framework, pas de bundler, 3 vues UI en réserve, mise en veille des onglets, chargement différé de l'adblock. Le surcoût d'Electron n'est pas dû au shell mais aux processus de rendu des pages — que Tauri remplacerait par d'autres processus de rendu, pas par « zéro processus ».
- La montée 44.7.0 → 44.9.3 est un correctif de sécurité dans la même majeure ; l'EOL du 2 mars 2027 laisse le temps de planifier 45/46.

**Coût / risque :** zéro migration. Le seul risque est de rater l'EOL ; il faut une phase « montée Electron » avant mars 2027, avec vérification de la disponibilité du moteur castlabs `+wvcus` aligné sur la nouvelle majeure.

### (b) Tauri 2 + webviews système

**Ce qui marcherait :** fenêtre native légère, bundler Tauri, updater signé, capabilités par webview, `data_store_identifier` pour des profils persistants macOS 14+, child webviews pour la barre latérale et les onglets.

**Ce qui casse le contrat produit :**
1. **Extensions Chrome sur macOS : impossible.** WKWebView n'a aucun modèle d'extension. Les navigateurs qui le font (Orion) maintiennent un fork de WebKit, ce qui casse la chaîne FairPlay/VMP. Or Orbe a déjà un sous-système complet (7 modules `ext-*.js`) et l'extension est une fonction validée, macOS d'abord.
2. **Widevine : perdu.** WKWebView ne lit que FairPlay ; WebView2 prend PlayReady mais pas Widevine (demande ouverte). `ORBE_DRM=1` n'aurait plus d'équivalent.
3. **Mondes JS isolés : non exposés.** Le preload `page.js` d'Orbe vit dans un monde isolé et sert de frontière de confiance pour les mots de passe. wry 0.57 n'expose pas le choix de `WKContentWorld` ; WebView2 n'a pas d'API documentée de monde isolé (seulement `AddScriptToExecuteOnDocumentCreated` / `ExecuteScript`, monde principal). Réinjecter le preload dans le monde de la page dégraderait la sécurité — inacceptable au vu de la priorité « vie privée à la Brave ».
4. **Multi-webviews : `unstable`.** L'API officielle Tauri 2 refuse la création de webviews enfants sans la feature `unstable` ; `reparent` est aussi unstable. Pour un navigateur à onglets, c'est le cœur du produit qui reposerait sur une API explicitement non stable.
5. **Parité de services navigateur :** pas de find-in-page, pas de capture d'écran dans wry, pas d'API d'erreur de certificat, pas de `debugger` CDP pour le unload shield, downloads récents mais moins contrôlables qu'Electron (pas de progression/annulation riche dans l'abstraction wry).
6. **Adblock :** deux implémentations divergentes (WKContentRuleList sur macOS, filtres WebView2 sur Windows) au lieu d'une seule couche `webRequest`. Les 24 000 domaines, la logique tiers et les exceptions par site sont à revalider sur chaque moteur.

**Effort : 38–60 semaines-personne** pour un portage partiel avec pertes documentées. Confiance MEDIUM.

### (c) wry sans Tauri

Mêmes moteurs, mêmes limites, plus la réécriture de ce que Tauri fournit (fenêtres, dialogues, menus, updater, single-instance, bundler, permissions). **Aucun avantage** sur (b) pour Orbe, sauf si l'on veut un contrôle total du shell — ce qui est précisément le coût. **42–68 semaines-personne.** Non.

### (d) Rust + CEF

**Ce qui marcherait :** Chromium 156, extensions au niveau moteur (mais voir ci-dessous), request contexts séparés, plusieurs navigateurs, rendu identique à Electron/Chrome, Widevine possible via un build certifié castlabs.

**Pourquoi ce n'est pas prêt :**
- `cef` crate **156.1.0+156.0.8**, maintenu par `tauri-apps/cef-rs`, mais API 0.x et écosystème jeune (~314 000 téléchargements, pas de garantie de stabilité).
- **Chargement d'extensions en transition :** `CefRequestContext::LoadExtension` est déprécié depuis CEF 130 (janvier 2025) ; le remplacement par `--load-extension` a lui-même été retiré de Chrome 137+. La stratégie de chargement d'extensions sur CEF 156 n'est pas garantie.
- **Distribution lourde :** binaires minimaux CEF **128 Mo** (macOS arm64) et **166 Mo** (Windows x64) compressés, avant extraction ; helper processes, sandbox, signature et notarisation à gérer.
- **Widevine :** castlabs certifie Electron et des adaptations Chromium, mais ses offres publiques documentées ne mentionnent pas CEF ; il faudrait une validation commerciale.

**Effort : 40–65 semaines-personne**, confiance LOW-MEDIUM. À reconsidérer seulement si Tauri 3 + runtime CEF stabilise l'intégration.

### (e) Servo

`servo` crate **0.7.0** (crates.io, mise à jour du 2026-10-05), API d'embedding pré-1.0, LTS depuis avril 2026. Pas de modèle d'extension Chrome, pas de Widevine, compatibilité web incomplète. Convient à un moteur embarqué pour du contenu contrôlé, pas à un navigateur généraliste qui doit afficher les sites des utilisateurs. **Non.**

### (f) Electron + Rust ciblé (la seule voie Rust raisonnable à court terme)

- Garder Electron 44 pour le shell, les sessions, les extensions, le DRM et les vues.
- Ajouter un **sidecar Rust** lancé par `utilityProcess`/`child_process` (JSON-RPC ou socket local) ou un addon **napi-rs** (Node-API, ABI stable, chargement dans le processus principal ; `.node` à exclure de l'asar).
- Cas d'usage mesurables : adblock à très grande échelle, parsing Arc/Chrome, crypto, compression, inférence locale. Effort **2–6 semaines-personne**, incrémental, réversible.

### Packaging, mises à jour, signature

- **Electron :** scripts maison, fuses, signature ad hoc sur macOS et binaire non signé sur Windows ; mises à jour manuelles vérifiées par SHA-256. Un changement de moteur ne résout pas cette dette — il la déplace.
- **Tauri :** bundler et updater signé obligatoire (`.app.tar.gz` macOS, MSI/NSIS Windows) ; il faudrait tout de même obtenir Developer ID/notarisation et Authenticode pour une distribution sans avertissement.
- **CEF :** binaires de 128–166 Mo compressés, helper processes, sandbox, signature et notarisation à la charge du projet ; aucun updater fourni.
- **Conclusion :** aucun gain net sur ce plan. La signature/notarisation reste un chantier prioritaire indépendant du choix Electron/Rust.

---

## Chromium vs WebKit — conséquences explicites

| Sujet | Chromium (Electron aujourd'hui / CEF) | WebKit (WKWebView, option Tauri) |
|-------|----------------------------------------|----------------------------------|
| Extensions Chrome | Modèle complet ; Orbe a déjà CRX3, `chrome.*`, side panel, debugger | **Aucun** ; un fork WebKit casse FairPlay/VMP |
| DRM | Widevine via castlabs (déjà livré) | FairPlay seulement ; **pas de Widevine** ; VMP réservé au WebKit système |
| Adblock | `webRequest` par session, logique tiers, exceptions | `WKContentRuleList` statique ; sémantique différente, listes à recompiler |
| Content scripts / preload | Preload dans un monde isolé, `executeJavaScriptInIsolatedWorld` | `WKContentWorld` existe, mais **non exposé par wry** ; WebView2 n'a pas d'API équivalente |
| Isolation par profil | `persist:orbe-<id>`, cookies/cache/extensions par session | `WKWebsiteDataStore` par identifiant (macOS 14+), pas de répertoire libre ; support récent et partiel |
| Isolation par onglet | `WebContentsView` = contexte de rendu séparé, debugger, capture, find | `WKProcessPool` déprécié, pools multiples sans effet ; isolation de processus non pilotable finement |
| Protocole `orbe://` | Scheme privilégié, contexte sécurisé, handler en mémoire | Protocoles custom wry, mais statut « secure context » et comportements CSP/localStorage à revalider |
| Erreurs de certificat | `certificate-error`, `setCertificateVerifyProc`, sheets | Pas d'API de contournement ; rejet ATS, pas de « continuer quand même » |
| Téléchargements | `will-download`, progression, annulation, quarantaine | `WKDownload` ; handlers wry récents mais abstraction plus pauvre |
| Trouver / imprimer / capturer | `findInPage`, `print`, `capturePage` | find absent de wry, print présent, capture absente |
| Mots de passe | `safeStorage` + preload isolé + origin dérivée d'Electron | Keychain via crate Rust + script injecté sans monde isolé exposé → frontière à repenser |
| Fidélité de rendu | Chromium (même moteur que Chrome) | WebKit : différences CSS/JS/APIs, tests de non-régression à refaire |

**Conséquence stratégique :** pour Orbe, le choix du moteur n'est pas un détail d'implémentation. C'est le contrat fonctionnel (extensions, DRM, adblock, mots de passe). Passer à WebKit n'est pas « porter Orbe » ; c'est **changer de produit**.

### Performances : ce que disent les données

- Un benchmark publié d'une réécriture Electron → Tauri 2 (MarkShot, Windows 11 ARM64) montre une empreinte très inférieure (291 Mo → 25 Mo de working set) mais un **démarrage plus lent** (418 ms → 644 ms). C'est une mesure isolée, confiance LOW.
- Les tableaux comparatifs généralistes annoncent 3 à 10× moins de mémoire pour Tauri ; ces chiffres concernent des applications simples, pas un navigateur à 10–30 onglets.
- Dans un navigateur, l'essentiel de la mémoire vient des processus de rendu des pages, pas du shell. Tauri réduit le coût du **shell**, pas celui des pages ; et WebView2 sur Windows est lui aussi Chromium.
- Orbe a déjà supprimé les surcoûts évitables (pas de bundler, pas de framework, veille des onglets, vues UI en réserve). Un portage ne garantit donc **ni** un démarrage plus rapide, **ni** une mémoire par onglet inférieure ; il garantit en revanche une régression fonctionnelle à court terme.

---

## Estimation d'effort — base de calcul

Mesures locales du dépôt (commit `3652692`, 2026-10-24) :

| Élément | Volume |
|---------|--------|
| Processus principal | **61 modules, 22 133 lignes JS** (`src/main/`) |
| Preloads | 6 fichiers, **1 026 lignes** |
| Renderer (JS) | **8 418 lignes** + 3 055 lignes HTML/CSS |
| Partagé | 2 561 lignes (locales + thème) |
| Tests | 99 fichiers (selftest, Playwright, extensions, natif) |
| Scripts | 15 fichiers, 1 914 lignes |
| Surface IPC | **65 actions** dans `OrbeWindow.handle` + 7 handlers `ipcMain` |
| Dépendance à Electron | 136 `webContents.`, 120 `app.`, 45 `dialog.`, 23 `clipboard.`, 17 `shell.`, 14 `session.`, 14 `nativeTheme.`, 7 `net.`, 7 `Menu`, 5 `systemPreferences.`, 4 `safeStorage.`, 4 `protocol.` |

Hypothèses : 1 développeur expérimenté, à plein temps, incluant tests, CI, packaging et non-régression ; hors gel fonctionnel ; fourchettes ±40 %. Conversion : 1 mois-personne ≈ 4,33 semaines-personne.

| Option | Fondation | Portage du cœur (état, fenêtres, onglets) | Sessions/profils | Adblock | Mots de passe | Extensions | DRM | Services navigateur (certificats, downloads, find, print, capture) | Tests/CI/packaging | **Total** | Confiance |
|--------|-----------|-------------------------------------------|------------------|---------|---------------|------------|-----|-------------------------------------------------------------------|--------------------|-----------|-----------|
| (a) Electron 44 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 (montée 44.7→44.9 = quelques jours) | **0** | HIGH |
| (b) Tauri 2 | 4–6 | 10–16 | 3–5 | 2–4 | 3–5 | 4–6 (Windows seulement ; macOS impossible) | 0 (perdu) | 8–12 | 4–6 | **38–60 sem.** (~9–14 mois) | MEDIUM |
| (c) wry sans Tauri | 8–14 | 10–16 | 3–5 | 2–4 | 3–5 | 4–6 (idem) | 0 (perdu) | 8–12 | 4–6 | **42–68 sem.** (~10–16 mois) | LOW-MEDIUM |
| (d) CEF + cef-rs | 6–10 | 12–20 | 3–5 | 1–2 (une seule implémentation) | 3–5 | 4–6 (stratégie incertaine) | 3–5 (castlabs) | 5–8 | 3–4 | **40–65 sem.** (~9–15 mois) | LOW-MEDIUM |
| (e) Servo | 10+ | 16+ | 5+ | 4+ | 5+ | 8+ (à créer) | 0 (absent) | 10+ | 6+ | **60+ sem.** et parité non atteinte | LOW |
| (f) Electron + Rust ciblé | 2–6 selon le composant | 0 | 0 | 0 | 0 | 0 | 0 | 0 | inclus | **2–6 sem.** | HIGH |

**Lecture :** même l'option la moins chère qui conserve Chromium (d) coûte **9 à 15 mois-personne**, soit environ 5 à 8 fois le budget probable du milestone modules + terminal. L'option (b), présentée comme « la migration facile », coûte 9 à 14 mois et **ne permet pas la parité**. La réponse à « est-ce facile ? » est donc sans ambiguïté : non.

---

## Go / No-go

### NO-GO pour ce milestone

- Ne pas créer de projet Tauri, wry, CEF ou Servo.
- Ne pas ajouter Rust au build.
- Ne pas remplacer Electron.
- Ne pas ajouter de bundler pour consommer xterm.js.

### GO pour ce milestone

1. **Electron 44.9.3** (patch de sécurité dans la même majeure).
2. **Registre de modules** en JavaScript simple, modules désactivés par défaut, chargement paresseux.
3. **Module Terminal** avec xterm.js 6.0.0 + addon-fit 0.11.0 vendorisés, Herdr 0.9.5+ via socket/CLI depuis le processus principal.
4. Tests : `node:test` pour le registre/le protocole, Playwright pour l'activation/désactivation, selftest pour la non-régression.
5. Documenter l'exception ESM (`<script type="module">`) dans `ARCHITECTURE.md`.

### Déclencheurs de réévaluation (à la frontière du milestone suivant)

Réévaluer la sortie d'Electron **seulement si** l'un de ces éléments est vrai :

1. **Tauri 3 stable** est publié **et** `tauri-runtime-cef` est stable (pas alpha), avec une documentation de production. Aujourd'hui : alpha.5 / alpha.6, octobre 2026.
2. Une **stratégie de chargement d'extensions** est validée sur CEF 156+ (aujourd'hui `LoadExtension` est déprécié et `--load-extension` a disparu de Chrome 137+).
3. **Widevine** est disponible sur au moins une des deux plateformes cibles via le runtime choisi.
4. **Les mondes JS isolés** sont exposés par le runtime (indispensable pour le preload mots de passe).
5. Ou une **décision produit explicite** d'abandonner les extensions Chrome et Widevine, et d'accepter WebKit — auquel cas le projet n'est plus « Orbe tel qu'il est » mais un nouveau produit.

Si un déclencheur se réalise, budgéter un **spike de 2 à 3 semaines** (prototype : 2 onglets isolés, un profil persistant, un preload isolé, un téléchargement, une extension factice) avant tout engagement plus large.

### Échéance séparée à ne pas manquer

**Electron 44 atteint son EOL le 2 mars 2027.** Planifier une phase de montée vers Electron 45/46 (45.0.0 = Chromium 156.0.8078.48) avant cette date. Vérifier à ce moment la disponibilité du moteur castlabs `+wvcus` aligné, et refaire passer les tests de non-régression extensions/DRM. Ce chantier est indépendant du débat Rust et ne doit pas être repoussé par lui.

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| **Tauri 2 avec webviews système pour Orbe** | Perte des extensions Chrome sur macOS, de Widevine, des mondes isolés ; multi-webview `unstable` ; moteur différent selon l'OS | Electron 44 ; réévaluer Tauri 3 + CEF quand stable |
| **wry sans Tauri** | Mêmes limites que Tauri, plus la réécriture du framework | Electron, ou Tauri 3 + CEF si un jour stable |
| **Servo 0.7** | Pré-1.0, pas d'extensions, pas de DRM, compatibilité web incomplète | Chromium (Electron/CEF) |
| **Tauri 3 alpha / `tauri-runtime-cef` alpha** | Alpha de septembre-octobre 2026, API mouvante, ~4 000 téléchargements, support windowless tout récent | Tauri 2 stable si l'on veut expérimenter hors produit ; aucune dépendance de production |
| **`cef-rs` pour un portage immédiat** | 0.x, binaires 128–166 Mo, extensions CEF en transition, Widevine non confirmé | Attendre la stabilisation ; sinon Electron |
| **Injecter le preload mots de passe dans le monde principal de la page** | Toute page pourrait lire/altérer le script et usurper des messages ; rupture de la frontière de confiance | Garder Electron, ou attendre un runtime exposant les mondes isolés |
| **Bundle/transpilation pour xterm.js** | Casserait la règle « pas de build » et le démarrage rapide | Fichier `xterm.mjs` vendorisé + `<script type="module">` |
| **Vitest** | Non installé, non configuré ; la consigne du dépôt est obsolète | `node:test`, selftest, Playwright (voir CONCERNS.md) |
| **Renderer canvas de xterm.js** | Supprimé en 6.0.0 | Renderer DOM par défaut ; WebGL addon optionnel |

---

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| Electron 44.9.3 | Chromium 152.0.7977.167, Node 24.22.0, V8 15.2.124.43 | Même majeure que 44.7.0 ; l'engine dev est téléchargé par `scripts/dev.js`. |
| Electron 45.0.0 | Chromium 156.0.8078.48, Node 24.22.0 | Sortie du 2026-10-21 ; chantier de montée séparé, avant l'EOL de la 44 (2027-03-02). |
| castlabs Electron `44.x+wvcus` | Electron 44.x | Le build DRM suit sa propre version (actuellement `44.5.1+wvcus` dans `package.json`) ; aligner avant toute montée. |
| xterm.js 6.0.0 | `@xterm/addon-fit` 0.11.0, `@xterm/addon-webgl` 0.19.0, `@xterm/addon-web-links` 0.12.0, `@xterm/addon-serialize` 0.14.0 | Vérifier les peer ranges au moment du vendor ; 6.0 a retiré le renderer canvas et `windowsMode`/`fastScrollModifier`. |
| Herdr 0.9.5+ | Orbe (client socket/CLI) | API socket locale et CLI ; Herdr gère PTY, workspaces, onglets, panneaux. Le support terminal Windows est partiel côté Herdr. |
| Tauri 2.12.5 | wry 0.57.1 | Non adopté pour ce milestone ; référence de veille. |
| Tauri 3.0.0-alpha.5 | `tauri-runtime-cef` 3.0.0-alpha.6, `cef` 156.1.0+156.0.8 | Alpha ; ne pas utiliser en production. |

---

## Sources

Sources primaires (registres, release notes, documentation officielle) — confiance HIGH pour les versions et dates :

- [Electron Releases — schedule](https://releases.electronjs.org/schedule) — Electron 44 stable 2026-08-25, Chromium 152, EOL 2027-03-02 ; politique des 3 dernières majeures.
- [Electron releases.json](https://releases.electronjs.org/releases.json) — 44.9.3 (Chromium 152.0.7977.167, Node 24.22.0), 45.0.0 (Chromium 156.0.8078.48, 2026-10-21).
- [npm registry — electron](https://registry.npmjs.org/electron) — dist-tags : `44-x-y` = 44.9.3, `latest` = 45.0.0.
- [Electron — Process Model](https://www.electronjs.org/docs/latest/tutorial/process-model) — processus principal, renderers, preloads, context isolation.
- [Tauri 2 — Start](https://v2.tauri.app/start/) et [Architecture](https://v2.tauri.app/concept/architecture/) — webview système, cœur Rust, pas de Chromium embarqué.
- [Tauri 2 — Webview JS API](https://v2.tauri.app/reference/javascript/api/namespacewebview/) — webviews enfants sous feature `unstable`, `reparent` unstable.
- [Tauri 2 — Capabilities](https://v2.tauri.app/security/capabilities/) — permissions par fenêtre/webview, `remote.urls`, limites de la surface de commandes.
- [Tauri 2 — Updater](https://v2.tauri.app/plugin/updater/) — signature obligatoire, `.app.tar.gz` macOS, MSI/NSIS Windows.
- [GitHub — tauri-apps/tauri releases](https://github.com/tauri-apps/tauri/releases) — tauri 2.12.5 (2026-10-21), 3.0.0-alpha.5, `tauri-runtime-cef` 3.0.0-alpha.6 (2026-10-14).
- [crates.io — tauri](https://crates.io/crates/tauri), [tauri-runtime-cef](https://crates.io/crates/tauri-runtime-cef), [wry](https://crates.io/crates/wry), [cef](https://crates.io/crates/cef), [servo](https://crates.io/crates/servo) — versions et téléchargements au 2026-10-24.
- [docs.rs — wry 0.57.1 WebViewBuilder](https://docs.rs/wry/latest/wry/struct.WebViewBuilder.html) et [WebView](https://docs.rs/wry/latest/wry/struct.WebView.html) — downloads, incognito, proxy, permissions, custom protocols, print, zoom, cookies ; absence de find/capture/isolated world.
- [wry — WebContext](https://docs.rs/wry/latest/wry/webview/struct.WebContext.html) — contexte partagé, directory de données.
- [wry 0.53.0 release](https://tauri.app/release/wry/v0.53.0/) — téléchargements activés par défaut, handlers de download.
- [wry discussion #1198](https://github.com/tauri-apps/wry/discussions/1198) et [Tauri issue #11491](https://github.com/tauri-apps/tauri/issues/11491) — isolation macOS par `data_store_identifier`, limites historiques.
- [CEF build index](https://cef-builds.spotifycdn.com/index.json) — CEF 156.0.8 stable (Chromium 156.0.8078.48), minimal 128 Mo macOS arm64 / 166 Mo Windows x64.
- [CEF — CefExtensionHandler](https://cef-builds.spotifycdn.com/docs/112.2/classCefExtensionHandler.html) et [forum CEF](https://www.magpcss.org/ceforum/viewtopic.php?f=6&t=20154) — `LoadExtension` déprécié depuis CEF 130 ; `--load-extension` retiré de Chrome 137+.
- [Microsoft Learn — ICoreWebView2Profile7](https://learn.microsoft.com/en-us/dotnet/api/microsoft.web.webview2.core.corewebview2profile.addbrowserextensionasync) — extensions WebView2 : dossiers unpacked uniquement, pas de store, pas d'UI d'extension.
- [WebView2Feedback #4828](https://github.com/MicrosoftEdge/WebView2Feedback/issues/4828) — PlayReady supporté, Widevine demandé.
- [Apple — WKContentWorld](https://developer.apple.com/documentation/webkit/wkcontentworld) et [WKProcessPool](https://developer.apple.com/documentation/webkit/wkprocesspool) — mondes isolés WebKit, pools dépréciés.
- [Tauri issue #7400](https://github.com/tauri-apps/tauri/issues/7400) et [Vuplex — Widevine](https://support.vuplex.com/articles/how-to-enable-widevine) — WKWebView sans Widevine, FairPlay/VMP.
- [Orion feedback](https://orionfeedback.org/d/12203-disney-plus-not-working-on-orion/29) — fork WebKit, extensions vs FairPlay.
- [npm — xterm.js latest](https://registry.npmjs.org/@xterm/xterm/latest) et [GitHub xterm.js releases](https://github.com/xtermjs/xterm.js/releases) — 6.0.0 du 2025-12-22, CJS + ESM, pas d'UMD, sortie synchronisée.
- [npm — addons xterm](https://registry.npmjs.org/@xterm/addon-fit/latest) — fit 0.11.0, webgl 0.19.0, web-links 0.12.0, serialize 0.14.0.
- [GitHub — herdrdev/herdr](https://github.com/herdrdev/herdr) et [release v0.9.5](https://github.com/herdrdev/herdr/releases/tag/v0.9.5) — serveur, CLI, socket local, workspaces/onglets/panneaux.
- [MarkShot v2.0.0 release](https://github.com/tsubasagit/MarkShot/releases/tag/v2.0.0) — benchmark Electron → Tauri 2 (mémoire, démarrage), confiance LOW car cas isolé.
- [napi.rs — Electron integrations](https://napi.rs/docs/more/integrations) et [support/compatibility](https://napi.rs/docs/more/support-compatibility) — Node-API, ABI stable, asarUnpack.
- [Servo on crates.io](https://lwn.net/Articles/1067467/) et [servo.org blog](https://servo.org/blog/) — crate 0.1 en avril 2026, LTS, pré-1.0.

Sources internes (mesures locales) — confiance HIGH :

- `/Users/lmarques/Dev/orbe/src/main/` (61 modules, 22 133 lignes), `/Users/lmarques/Dev/orbe/src/preload/` (1 026 lignes), `/Users/lmarques/Dev/orbe/src/renderer/` (8 418 lignes JS + 3 055 HTML/CSS), `/Users/lmarques/Dev/orbe/src/shared/` (2 561 lignes), `/Users/lmarques/Dev/orbe/tests/` (99 fichiers).
- `/Users/lmarques/Dev/orbe/.planning/codebase/STACK.md`, `ARCHITECTURE.md`, `CONCERNS.md` — inventaire des API Electron utilisées, sessions, extensions, DRM, limites connues.
- `/Users/lmarques/Dev/orbe/.planning/PROJECT.md` — priorités (fluidité, fidélité Arc, vie privée), contraintes, décisions.

---

*Stack research for: Orbe — milestone modules + Terminal/Herdr et décision Electron → Rust*
*Researched: 2026-10-24*
