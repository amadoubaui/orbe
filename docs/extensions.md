# Extensions Chrome

Module : `src/main/extensions.js` — tests : `node --test tests/extensions.test.js`
(Node seul, sans réseau). Aucune dépendance npm. Le module n'est **pas encore
branché** dans Orbe : voir « Branchement ».

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

## Relevé sur Electron 44.7.0 (Chromium 152)

Installation réelle depuis le Store, session `persist:test-ext`, pages
`example.com` et `fr.wikipedia.org`.

| | Dark Reader 4.9.133 | Wappalyzer 6.12.7 |
| --- | --- | --- |
| Signatures (développeur, Store) | valides, 3 preuves | valides, 3 preuves |
| Identifiant après chargement | celui du Store | celui du Store |
| Service worker | démarre | démarre |
| Scripts de contenu | s'exécutent | s'exécutent |
| Fenêtre surgissante | se charge, reste sur « Loading, please wait » | se charge, « This page cannot be scanned » |
| Rechargement au démarrage suivant | oui | oui |

- **Dark Reader** : les pages sont sombres, mais par la seule feuille de
  secours (`<style class="darkreader darkreader--fallback">`, fond
  `rgb(24, 26, 27)`). Le thème dynamique n'arrive jamais : le service worker
  s'arrête à l'initialisation sur `chrome.permissions.onRemoved`
  (`chrome.permissions` n'existe pas dans Electron), donc ni les pages ni la
  fenêtre surgissante ne reçoivent les réglages. Images non adaptées, icônes
  de Wikipédia absentes, aucun réglage possible.
- **Wappalyzer** : erreurs `chrome.tabs.create is not a function` et
  `chrome.cookies` absent ; la fenêtre surgissante ne trouve pas d'« onglet
  actif » (`getDetections: no active tab found`), donc aucune technologie
  n'est affichée.
- Avertissements au chargement : autorisations inconnues (`fontSettings`,
  `contextMenus`, `cookies`, `downloads`).
- Désactiver, réactiver, retirer et recharger dans une même session
  fonctionnent (service worker arrêté puis relancé, styles retirés puis remis).

Conclusion : l'installation et le chargement sont au point ; l'usage réel de
ces deux extensions demande la couche d'API manquante décrite dans
`etude-extensions-et-distribution.md` (`permissions`, `tabs` avec onglet actif,
`cookies`, `contextMenus`).
