# Étude : extensions Chrome, DRM, connexion Google, distribution

Relevé fait sur Electron 44.7.0 (Chromium 152), en chargeant réellement les
extensions concernées dans une sonde jetable. Ce document guide les prochains
chantiers ; il ne décrit pas ce qu'Orbe fait déjà.

## Extensions Chrome

Electron charge les extensions dépaquetées (Manifest V3 compris), par profil,
mais n'offre qu'une partie des API de Chrome.

- **Disponibles** : `runtime`, `scripting`, `alarms`, `offscreen`,
  `declarativeNetRequest`, `storage.local`, `storage.session`, `webRequest`,
  `i18n`, et une partie de `tabs` (pas `tabs.create` ni `tabs.remove`).
- **Absentes** : `sidePanel`, `contextMenus`, `windows`, `webNavigation`,
  `identity`, `cookies`, `downloads`, `notifications`, `debugger`, `tabGroups`,
  `tts`, `commands`, `storage.sync`, et la messagerie native.
- Electron n'affiche ni bouton ni fenêtre pour les extensions : c'est à Orbe de
  le faire.

| Extension | Electron seul | Avec une couche `tabs`/`windows`/boutons | Blocage principal |
| --- | --- | --- | --- |
| Dark Reader | Partiel | Probable | — |
| Wappalyzer | Partiel | Probable | `cookies`, `tabs.create` |
| vidIQ | Partiel | Partiel | connexion par `identity` |
| GoFullPage | Non | Incertain | `tabs.captureVisibleTab` |
| Read Aloud | Non | Partiel | `tts`, `identity` |
| CSS Peeper | Non | Non | interface en panneau latéral |
| NaturalReader | Non | Non | panneau latéral, `tts` |
| Claude | Non | Non | panneau latéral, `debugger`, messagerie native |
| Mots de passe iCloud | Non | Non | messagerie native |
| html.to.design | Non | Non | `debugger`, `identity` |

**Conséquence.** Viser d'abord les extensions à scripts de contenu et à
fenêtre surgissante. Pour le reste — capture de page entière, lecture vocale,
mots de passe — mieux vaut des fonctions intégrées à Orbe.

**Couche manquante.** La bibliothèque `electron-chrome-extensions` apporte
`tabs`, `windows`, `contextMenus`, `cookies` et les boutons d'extension, mais
elle est sous licence GPL-3 : l'utiliser ferait passer l'application distribuée
sous GPL-3. Sinon, il faut écrire cette couche (plusieurs semaines).
*Décision à prendre avant de commencer.*

**Installation depuis le Chrome Web Store.** Le fichier CRX se télécharge sans
compte. Il faut vérifier sa signature, le décompresser, puis réinjecter la clé
publique dans le manifeste, faute de quoi l'extension change d'identifiant.
Environ 250 lignes, sans dépendance.

## Vidéo protégée (Netflix, Disney+, Prime Video, Spotify web)

Electron de série lit H.264, AAC, HEVC et AV1, mais pas les contenus protégés
par Widevine : ces services ne fonctionnent pas dans Orbe aujourd'hui. Une
variante d'Electron maintenue par castlabs ajoute Widevine ; elle suit les
versions avec retard et demande une étape de signature supplémentaire.
À étudier sur une branche quand ce besoin deviendra prioritaire.

## Connexion Google

Google refuse parfois les navigateurs qu'il ne reconnaît pas. Orbe se présente
comme un Chromium ordinaire (sans la mention « Electron »). À tester avec un
vrai compte ; prévoir un bouton « ouvrir dans le navigateur par défaut » en
secours. Orbe ne se fera pas passer pour Google Chrome.

## Touch ID, clés d'accès, mots de passe

Touch ID pour les clés d'accès demande une application signée avec un
identifiant de développeur Apple. Les mots de passe iCloud ne sont pas
accessibles (l'extension Apple repose sur la messagerie native). Un
gestionnaire de mots de passe intégré est envisageable à plus long terme.

## Distribution

Orbe est aujourd'hui signé localement : macOS demande de passer par
*Réglages → Confidentialité et sécurité → Ouvrir quand même* au premier
lancement d'une copie téléchargée. Pour une installation sans friction et des
mises à jour automatiques, il faut le programme Apple Developer (payant, à
l'année), une signature « Developer ID » et la notarisation ; ensuite,
publication sur GitHub Releases et mise à jour automatique.

## Windows

À adapter : le fond translucide (`backgroundMaterial` au lieu de `vibrancy`),
les boutons de fenêtre (à droite, via `titleBarOverlay`), les raccourcis
(Ctrl à la place de ⌘), le script de fabrication et l'import depuis Arc.

## Ordre proposé

1. Identifiant de développeur Apple, notarisation, mises à jour automatiques.
2. Installation d'extensions depuis le Chrome Web Store.
3. Décision de licence, puis boutons et API d'extensions.
4. Fonctions intégrées : capture de page entière, lecture vocale.
5. Prototype Widevine.
6. Version Windows.
