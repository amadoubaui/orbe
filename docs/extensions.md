# Extensions Chrome

Module : `src/main/extensions.js` — tests : `node --test tests/extensions.test.js`
(Node seul, sans réseau). Aucune dépendance npm. Les API `chrome.*` qu'Electron
n'a pas sont décrites plus bas : « Couche d'API ».

## Principe

1. Téléchargement du CRX, sans compte Google :
   `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=<Chromium>&acceptformat=crx2,crx3&x=id%3D<ID>%26uc`
2. Lecture de l'en-tête CRX3 (`Cr24`, version, longueur, protobuf) et
   vérification des signatures.
3. Décompression du ZIP (`zlib`, entrées stockées ou « deflate ») dans un
   dossier temporaire.
4. Ajout de la clé publique du développeur dans `manifest.json` (`key`) : sans
   elle, une extension dépaquetée prend un identifiant tiré de son chemin.
5. Bascule : `state.json` désigne le dossier de la nouvelle version, puis
   l'ancienne est supprimée.

Le module n'exécute jamais rien de ce qu'il extrait. Il passe le dossier à
`session.extensions.loadExtension`, avec `allowFileAccess: false`.

Sur le disque :

```
<userData>/Extensions/
  state.json                       { extensions: { <id>: { enabled, current, installedAt } } }
  <id>/<version>_<horodatage>/     l'extension dépaquetée, clé injectée
```

## Ce qui est vérifié, ce qui ne l'est pas

Vérifié à chaque installation :

- **Identifiant** : la clé publique du développeur donne l'identifiant demandé
  (SHA-256, 16 premiers octets, écrits de `a` à `p`). Un fichier valide mais
  signé pour une autre extension est refusé (`EXT_ID_MISMATCH`).
- **Intégrité** : toutes les signatures de l'en-tête (RSA PKCS#1 v1.5 et ECDSA,
  SHA-256) sont vérifiées sur `"CRX3 SignedData\0"` + longueur + données
  signées + archive. Une seule signature fausse fait tout refuser, comme dans
  Chromium (`EXT_BAD_SIGNATURE`).
- **Provenance** : l'une des signatures doit venir de la clé de publication du
  Chrome Web Store, reconnue par son empreinte (`kPublisherKeyHash` de
  Chromium). Sinon `EXT_NOT_FROM_STORE`. Désactivable avec
  `configure({ requireStoreSignature: false })` — utile seulement aux tests.
- **Archive** : chemins absolus, lettres de lecteur, `..`, octets nuls, liens
  symboliques, fichiers spéciaux et fichiers chiffrés refusés avant toute
  écriture ; plafonds sur le nombre de fichiers (20 000), la taille totale
  (512 Mo) et la taille par fichier (256 Mo), appliqués aux octets réellement
  produits ; somme de contrôle CRC-32 de chaque fichier ; aucun bit
  d'exécution n'est posé. ZIP64 et archives en plusieurs volumes refusés.

Non vérifié :

- **Le contenu.** Aucune analyse du code, aucune liste noire d'extensions
  retirées du Store pour malveillance.
- **L'intégrité après installation.** `_metadata/verified_contents.json` n'est
  pas extrait (Chromium refuse un dossier dépaqueté qui le contient) : un
  fichier modifié sur le disque après coup n'est pas détecté.
- **Les autorisations.** Le module les renvoie (`permissions`,
  `hostPermissions`) ; c'est à l'interface de les montrer avant d'installer.
- Pas de mise à jour automatique : rappeler `install(id)` remplace la version.

## API

```js
const extensions = require('./extensions');

extensions.configure({ dir, fetch, lang, requireStoreSignature, limits });
extensions.parseStoreInput(texte)       // -> id | null
await extensions.install(idOuAdresse)   // -> fiche + { verified: { developer, store, proofs } }
extensions.list()                       // -> [fiche], triées par nom
extensions.get(id)                      // -> fiche | null
await extensions.remove(id)             // retire des sessions connues, puis du disque
await extensions.loadInto(session)      // -> { loaded, unloaded, failed: [{ id, error }], skipped }
await extensions.unloadFrom(session, id)
await extensions.syncAll()              // loadInto() sur toutes les sessions déjà vues
extensions.setEnabled(id, bool)         // écrit state.json, resynchronise en arrière-plan
extensions.isEnabled(id)
extensions.popupFor(id)                 // -> { url, title, icon } | null
extensions.parseCrx(buffer)             // -> { version, publicKey, id, zip, proofs, signedHeaderData }
extensions.verifyCrx(crx)               // -> { developer, store, proofs } ou lève une erreur
await extensions.unzip(buffer, dossier, { maxFiles, maxBytes, maxEntryBytes, skip })
```

Fiche : `{ id, name, version, description, permissions, hostPermissions, icon,
dir, enabled, manifestVersion }`. `icon` est un chemin absolu ou `''`.
`hostPermissions` réunit `host_permissions`, les motifs d'URL de `permissions`
(Manifest V2) et les `matches` des scripts de contenu. Les noms `__MSG_x__`
sont résolus dans `_locales` : langue d'Orbe (`lang`, `fr` par défaut), puis
`en`, puis `default_locale`.

`parseCrx` ne vérifie **aucune** signature : appeler `verifyCrx` ensuite.

`loadInto` est une synchronisation : elle charge ce qui manque, retire ce qui a
été désactivé, désinstallé ou mis à jour, et ne fait rien si tout est en place.
Elle ne touche pas aux extensions chargées depuis un autre dossier. Une session
non persistante (navigation privée) est ignorée (`skipped: true`).

Les erreurs portent un `code` stable : `EXT_BAD_ID`, `EXT_NOT_FOUND`,
`EXT_DOWNLOAD`, `EXT_BAD_CRX`, `EXT_ID_MISMATCH`, `EXT_BAD_SIGNATURE`,
`EXT_NOT_FROM_STORE`, `EXT_BAD_ZIP`, `EXT_UNSAFE_ZIP`, `EXT_ZIP_TOO_BIG`,
`EXT_BAD_MANIFEST`, `EXT_UNSUPPORTED` (thèmes, applications Chrome),
`EXT_NOT_CONFIGURED`.

## Branchement

Dans `main.js`, après `store.load(...)` dans `app.whenReady()` :

```js
extensions.configure({
  dir: path.join(app.getPath('userData'), 'Extensions'),
  fetch: (url, options) => net.fetch(url, options), // suit le proxy du système
  lang: store.state.settings.lang,
});
```

Dans `sessions.js`, à la fin de `configure(ses, { persist })` :

```js
if (persist) extensions.loadInto(ses).then((r) => {
  for (const f of r.failed) console.error('[orbe] extension', f.id, f.error);
});
```

`loadExtension` doit être rappelé à chaque démarrage et pour chaque profil :
c'est ce que fait cet appel, puisque `profileSession()` passe par `configure`.
Il faut donc que `extensions.configure` ait été appelé avant la première
`profileSession()`. Le chargement est asynchrone : un onglet restauré avant sa
fin s'affiche d'abord sans script de contenu.

Interface à écrire :

- **Barre de commande** : si `parseStoreInput(saisie)` renvoie un identifiant,
  proposer « Installer l'extension ». Montrer nom et autorisations avant de
  confirmer (elles ne sont connues qu'après téléchargement : installer
  désactivé, ou télécharger puis confirmer).
- **Réglages** : `list()` (icône, nom, version, autorisations), interrupteur
  `setEnabled`, bouton `remove`, bouton « Mettre à jour » (`install(id)`).
- **Bouton et fenêtre surgissante** : Electron n'affiche rien. Pour chaque
  extension où `popupFor(id)` n'est pas nul, un bouton ouvre une petite
  fenêtre sur `popup.url`, **dans la session du profil**.

À savoir : « effacer les données du profil » (`clearStorageData`) efface aussi
le stockage des extensions. Les requêtes `chrome-extension://` ne passent pas
par le bloqueur.

## Couche d'API `chrome.*`

Electron ne fournit qu'une partie des API de Chrome. Orbe ajoute le reste avec
sa propre couche, écrite à partir de la documentation publique de Chrome et
d'Electron (licence MIT, aucun code tiers, aucune dépendance) :

| Fichier | Rôle |
| --- | --- |
| `src/preload/ext.js` | complète `chrome` (et `browser`) dans les pages d'extension et les service workers |
| `src/main/ext-api.js` | les API elles-mêmes, les autorisations, les événements |
| `src/main/ext-host.js` | onglets et fenêtres d'Orbe vus comme ceux de Chrome, fenêtre surgissante |

Tests : `npm run test:ext` (extension `tests/ext-fixture`, sans réseau) et
`node scripts/test-ext.js reelles` (vraies extensions, demande Internet).

### Mécanisme

- `session.registerPreloadScript` enregistre `ext.js` sur chaque session de
  profil, pour les types `frame` et `service-worker`. Le script s'exécute
  **avant** le code de l'extension ; `contextBridge.executeInMainWorld` lui
  permet de compléter l'objet `chrome` du monde principal. Dans un service
  worker d'un site web ou une page ordinaire, il ne fait rien.
- Chaque appel part par IPC (`ipcMain` pour les pages, `ServiceWorkerMain.ipc`
  pour les service workers). L'extension appelante est déduite de l'émetteur
  — origine du cadre ou portée du service worker —, jamais de ce que le script
  affirme, puis les autorisations du manifeste sont vérifiées.
- Les événements ne sont envoyés qu'aux contextes qui les écoutent. Un service
  worker endormi est réveillé (`startWorkerForScope`) et gardé éveillé quelques
  secondes (`startTask`).
- Identifiant d'onglet = identifiant du `webContents` : c'est déjà celui
  qu'Electron donne dans `sender.tab.id` et attend dans `tabs.sendMessage` et
  `scripting.executeScript`. Seuls les onglets vivants existent pour une
  extension ; un onglet en veille, une page interne ou la fenêtre surgissante
  n'en sont pas.
- Chromium expose aussi `browser`, objet distinct de `chrome` : les deux sont
  complétés (uBlock Origin Lite utilise `self.browser || self.chrome`).

Ce qui ne marche pas : un script de préchargement n'atteint pas le monde isolé
des **scripts de contenu**. Ils gardent les API d'Electron (`runtime`,
`storage.local`, `i18n`) ; `storage.sync` n'y est donc pas corrigé.

### API fournies

| Espace | Ce qui est fait |
| --- | --- |
| `permissions` | `contains`, `getAll`, `request`, `remove`, `onAdded`, `onRemoved`. Une autorisation optionnelle est demandée à l'utilisateur, puis retenue (`Extensions/api-state.json`). Une **origine** hors du manifeste est refusée : Electron ne sait pas l'accorder après coup. |
| `tabs` | `query` (onglet actif, fenêtre courante, motifs d'URL…), `get`, `getCurrent`, `create`, `remove`, `update`, `reload`, `duplicate`, `goBack`, `goForward`, `captureVisibleTab`, `onCreated`, `onUpdated`, `onActivated`, `onRemoved`. `url` et `title` ne sont donnés qu'avec `tabs`, un accès au site ou `activeTab`. Le reste (`sendMessage`, `connect`, zoom) est celui d'Electron. |
| `windows` | `get`, `getCurrent`, `getLastFocused`, `getAll`, `update` (premier plan), `onFocusChanged`, `onCreated`, `onRemoved`. `create` ouvre les adresses en onglets ; `remove` est refusé. |
| `cookies` | `get`, `getAll`, `set`, `remove`, `getAllCookieStores`, `onChanged`, limités aux sites du manifeste. |
| `contextMenus` | `create`, `update`, `remove`, `removeAll`, `onClicked` (et `onclick` en Manifest V2). Les éléments s'ajoutent au menu contextuel des pages. |
| `action` (`browserAction`, `pageAction`) | titre, pastille, couleurs, icône, fenêtre surgissante, activation, par onglet ou globalement ; `openPopup`, `onClicked`. |
| `storage.sync` | zone locale à part (Electron la refuse) ; `local` et `onChanged` sont enveloppés pour que les deux zones restent séparées. |
| `webNavigation` | `onBeforeNavigate`, `onCommitted`, `onDOMContentLoaded`, `onCompleted`, `onHistoryStateUpdated`, `getFrame`, `getAllFrames`. |
| `notifications`, `downloads` | minimum : `create`/`clear`/`onClicked`, `download`. |
| `fontSettings`, `commands` | `getFontList` (liste fixe), `commands.getAll` ; aucun raccourci n'est attribué, `onCommand` n'est jamais émis. |
| `runtime`, `extension` | `openOptionsPage` (dans un onglet), `isAllowedIncognitoAccess`, `isAllowedFileSchemeAccess`. |

Un espace de noms n'apparaît que si le manifeste déclare l'autorisation
correspondante. Absents : `sidePanel`, `debugger`, `identity`, messagerie
native, `tts`, `tabGroups`, `history`, `bookmarks`, `management` complet.

### Bouton et fenêtre surgissante

```js
const extHost = require('./ext-host');
extHost.actionsFor(orbeWindow)                 // [{ id, name, title, icon, badgeText, badgeColor, badgeTextColor, popup, enabled }]
extHost.openPopup(orbeWindow, id, { x, y })    // fenêtre ancrée, ou action.onClicked s'il n'y a pas de fenêtre
extHost.closePopup(orbeWindow)
```

Depuis l'interface : `O.send('ext:actions')` et
`O.send('ext:popup', { id, x, y })` (`x`, `y` : point dans la fenêtre). L'état
envoyé à la coque est rafraîchi quand une extension change son bouton
(`extApi.hooks.actionChanged`). La fenêtre surgissante est une fenêtre sans
cadre, enfant de la fenêtre d'Orbe, dans la session du profil de l'onglet
actif ; elle prend la taille de son contenu (800 × 600 au plus) et se ferme en
perdant le focus ou avec Échap. Le bouton lui-même reste à dessiner dans la
barre latérale ; en attendant, Réglages → Extensions → « Ouvrir ».

## Relevé sur Electron 44.7.0 (Chromium 152)

Installation réelle depuis le Store dans un profil jetable d'Orbe, pages
`fr.wikipedia.org`, `wordpress.org` et `www.lemonde.fr`.

| | Dark Reader 4.9.133 | Wappalyzer 6.12.7 | uBlock Origin Lite 2026.1006 |
| --- | --- | --- | --- |
| Signatures (développeur, Store) | valides | valides | valides |
| Service worker | démarre, sans erreur | démarre, sans erreur | démarre, sans erreur |
| Scripts de contenu | s'exécutent | s'exécutent | s'exécutent |
| Fenêtre surgissante | réglages affichés, 276 × 580 | technologies de l'onglet actif, 496 × 544 | site de l'onglet actif, mode de filtrage |
| Rechargement au démarrage suivant | oui, réglages conservés | oui | non vérifié |

Avant la couche d'API (Electron seul) :

- **Dark Reader** : service worker arrêté sur `chrome.permissions.onRemoved`,
  feuille de secours seule, fenêtre bloquée sur « Loading, please wait ».
- **Wappalyzer** : `chrome.tabs.create is not a function`, `chrome.cookies`
  absent, « getDetections: no active tab found ».
- **uBlock Origin Lite** : tant que `browser.permissions` manque, `Cannot read
  properties of undefined (reading 'onRemoved')` et fenêtre surgissante vide.

Avec elle (`tests/ext-reelles.js`) :

- **Dark Reader** : thème dynamique sur `fr.wikipedia.org` (11 feuilles
  `darkreader--sync`, feuille de secours vidée, liens `rgb(92, 152, 214)`) ;
  le bouton du site rend la page claire (`rgb(248, 249, 250)`) puis sombre ;
  la luminosité passe de 100 à 105, s'applique (`rgb(24, 26, 27)` →
  `rgb(25, 27, 28)`) et se retrouve après redémarrage.
- **Wappalyzer** : sur `wordpress.org`, la fenêtre liste WordPress, PHP, MySQL,
  Gutenberg, Google Tag Manager… ; pastille « 10 » ; page d'accueil ouverte par
  `tabs.create` dans un onglet d'Orbe.
- **uBlock Origin Lite** : fenêtre « www.lemonde.fr — filtering mode optimal ».

Reste à faire : dessiner les boutons dans la barre latérale, raccourcis des
commandes d'extension, accès aux sites accordé après coup (modes « complet »
d'uBlock Origin Lite), `storage.sync` dans les scripts de contenu.
