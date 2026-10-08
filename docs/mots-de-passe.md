# Gestionnaire de mots de passe

Orbe enregistre et remplit les mots de passe lui-même : les extensions de
trousseau (Mots de passe iCloud, entre autres) ont besoin d'un pont natif que
Chromium embarqué n'offre pas.

Ce document décrit ce qui est protégé, contre qui, et ce qui ne l'est pas. Il
sert de base à une relecture de sécurité indépendante, qui reste à faire.

## Ce que fait la fonction

- **Enregistrer** : après l'envoi d'un formulaire de connexion, une proposition
  apparaît en haut à droite de la page (Enregistrer / Jamais pour ce site / Plus
  tard). Jamais en navigation privée.
- **Remplir** : quand un champ de connexion prend le clavier et que des comptes
  existent pour ce site, leur liste s'ouvre sous le champ. Rien n'est rempli
  sans un clic sur un compte. Clic droit dans un champ → « Remplir un mot de
  passe… » sert de secours quand le formulaire n'est pas reconnu.
- **Gérer** : menu Orbe → Mots de passe… (ou Réglages → Mots de passe → Gérer…) :
  recherche, affichage et copie après confirmation d'identité, modification,
  suppression, liste « jamais », import et export CSV.
- **Suggérer** : sur un champ `autocomplete="new-password"` (ou un formulaire à
  deux mots de passe), un mot de passe fort est proposé.

## Architecture

| Élément | Fichier | Rôle |
| --- | --- | --- |
| Coffre et décisions | `src/main/passwords.js` | chiffrement, correspondance des origines, canal de la page, vues, fenêtre de gestion |
| Script de page | `src/preload/page.js` | repère les champs, remplit le compte choisi, signale les envois |
| Liste et proposition | `src/renderer/pw-overlay.{html,js}` | vues d'Orbe posées sur la page |
| Fenêtre de gestion | `src/renderer/passwords.{html,js}` | interface `orbe://` de confiance |

Le script de page est enregistré sur les sessions de profil
(`session.registerPreloadScript`, type `frame`). Les onglets sont créés avec
`sandbox: true` et `contextIsolation: true` : il s'exécute donc dans un **monde
isolé**, avec ses propres objets JavaScript. `nodeIntegrationInSubFrames` est
activé sur les vues d'onglet pour qu'il s'exécute aussi dans les iframes ; avec
le bac à sable, ce réglage ne donne aucun accès à Node.

## Ce qui est protégé

### Au repos

- Fichier à part, `passwords.json` dans le dossier de données, jamais
  `orbe.json`. Écrit en entier à chaque changement : fichier temporaire (droits
  `0600`), `fsync`, puis remplacement ; la version précédente est gardée en
  `.bak`.
- Tout le contenu — mots de passe, identifiants, sites, liste « jamais » — est
  un seul bloc chiffré par `safeStorage` : clé dans le trousseau sur macOS,
  DPAPI sous Windows, libsecret ou kwallet sous Linux.
- **Pas de chiffrement réel, pas d'enregistrement.** Si `isEncryptionAvailable()`
  est faux, ou si Linux retombe sur `basic_text` (clé écrite en dur dans
  Chromium), Orbe refuse d'enregistrer et le dit dans la fenêtre de gestion.
- Coffre illisible (clé perdue, fichier abîmé) : la copie `.bak` est essayée,
  puis plus rien n'est écrit. « Repartir de zéro » met le fichier de côté, sans
  le supprimer.
- Le coffre n'est déchiffré qu'à la première utilisation, pas au démarrage.
- Un compte appartient au profil dans lequel il a été enregistré. Supprimer un
  profil supprime ses comptes.

### Face à la page web

La page est l'adversaire principal : elle exécute du code arbitraire, y compris
avant le script d'Orbe.

- **Elle ne peut pas lire ni énumérer les comptes.** La liste est une vue
  d'Orbe (`WebContentsView`) posée par-dessus la page, hors de son DOM. Le
  script de page ne reçoit jamais la liste ; il ne sait même pas s'il existe un
  compte. Aucun élément n'est inséré dans la page.
- **L'origine vient d'Electron**, pas du message : `senderFrame.origin`, et
  `senderFrame.url` doit avoir la même origine en http(s). Les champs du message
  ne servent qu'à placer la liste et à savoir quel type de champ a le clavier.
- **Un mot de passe ne part vers le moteur de rendu qu'après un choix
  explicite**, et seulement vers le cadre qui a signalé le champ, après une
  nouvelle vérification de son origine au moment de l'envoi (le cadre a pu
  naviguer entre-temps).
- Le script de page vit dans un monde isolé : altérer les prototypes de la
  page, écouter ses événements ou envoyer des `postMessage` ne l'atteint pas.
- La liste n'est pas falsifiable par la page (autre processus, autre vue). Sa
  position, donnée par la page, est bornée à la vue de l'onglet : elle ne peut
  pas recouvrir l'interface d'Orbe. Un clic arrivé dans les 300 ms qui suivent
  son apparition est ignoré.
- Un formulaire rempli et envoyé par le script de la page, sans saisie réelle
  de l'utilisateur, ne déclenche pas de proposition d'enregistrement.
- Débit du canal limité par page ; longueurs bornées.

### Règles d'origine

| Compte enregistré pour | Page affichée | Résultat |
| --- | --- | --- |
| même schéma, hôte et port | — | proposé ; rempli au clic |
| `https://exemple.fr` | `http://exemple.fr` | **jamais proposé** |
| autre sous-domaine, autre port, ou http → https du même domaine enregistrable | — | proposé avec la mention de son site ; rempli après une boîte de confirmation qui nomme les deux adresses |
| autre domaine | — | jamais proposé |
| iframe d'une autre origine que la page | — | seuls les comptes de l'origine **de l'iframe** ; confirmation qui nomme la page hôte |

Le domaine enregistrable s'appuie sur la liste des suffixes publics embarquée
dans Chromium (`a.github.io` et `b.github.io` ne partagent rien). Electron ne
l'expose pas : Orbe l'interroge en posant un cookie de domaine dans une session
en mémoire qui ne sert à rien d'autre — Chromium le refuse sur un suffixe
public. En cas d'échec, le domaine enregistrable est l'hôte entier (règle la
plus stricte).

### Connexion en deux étapes

À la première étape, seul l'identifiant est rempli ; le mot de passe n'est pas
envoyé au moteur de rendu. Si un champ de mot de passe sans champ identifiant
prend ensuite le clavier dans le même onglet, sur la même origine exacte, dans
les trois minutes, il reçoit le mot de passe du compte choisi sans nouvelle
demande, une seule fois.

### Interface d'Orbe

- Les actions passent par le canal `orbe` existant (vues de la liste
  `trusted`, émetteur en `orbe://`). Lister, afficher, copier, modifier,
  exporter n'obéissent qu'à la fenêtre de gestion ; le choix d'un compte
  n'obéit qu'à la vue de liste de la fenêtre, avec un jeton à usage unique.
- La liste des comptes envoyée à l'interface ne contient aucun mot de passe.
- Afficher, copier, exporter demandent Touch ID (ou le mot de passe de session)
  via `systemPreferences.promptTouchID` quand il existe ; la confirmation vaut
  90 secondes. Un mot de passe affiché est masqué au bout de 30 secondes ou dès
  que la fenêtre passe à l'arrière-plan.
- Un mot de passe copié est effacé du presse-papiers après 60 secondes, et à la
  fermeture d'Orbe, s'il s'y trouve encore.
- Aucun mot de passe n'est écrit dans les journaux, l'historique ou `orbe.json`.

### Navigation privée

Le script de page n'est pas enregistré sur les sessions privées, et le canal
ignore toute session qui n'est pas celle d'un profil : ni liste, ni
proposition, ni enregistrement.

## Import et export CSV

Import : exports de Safari / Mots de passe iCloud
(`Title,URL,Username,Password,Notes,OTPAuth`), Chrome
(`name,url,username,password,note`), Firefox et Bitwarden, reconnus par leurs
en-têtes. Les lignes sans adresse http(s) ou sans mot de passe sont ignorées et
comptées. Un compte déjà présent (même site, même identifiant) est mis à jour.

**Un fichier CSV est en clair.** À l'import, Orbe propose de mettre le fichier
à la corbeille ; la corbeille n'efface pas le disque. À l'export, il demande
la confirmation d'identité, avertit, puis écrit le fichier en `0600`.

## Ce qui n'est pas protégé

- **Un moteur de rendu compromis** (faille de Chromium exploitée par une page)
  peut se faire passer pour le script de page de sa propre origine. Il peut
  alors : faire apparaître la liste des comptes de cette origine (sans la
  lire), obtenir le mot de passe du compte que l'utilisateur choisit — que la
  page aurait reçu de toute façon —, et provoquer des propositions
  d'enregistrement avec des valeurs inventées, pour son origine. Il ne peut pas
  obtenir un compte d'une autre origine, ni un compte non choisi, sauf le cas
  des deux étapes ci-dessus (mot de passe du compte que l'utilisateur vient de
  choisir sur cette origine). L'isolation des sites de Chromium fait que ce
  processus n'héberge en principe qu'un site.
- **Une page malveillante ou une injection de script sur le site légitime**
  reçoit le mot de passe dès que l'utilisateur le remplit. Aucun gestionnaire
  n'y peut rien.
- **Un logiciel malveillant sous le compte de l'utilisateur** peut demander la
  clé au trousseau (macOS affiche une demande pour un autre programme), lire la
  mémoire d'Orbe, ou enregistrer les frappes. Le coffre déchiffré reste en
  mémoire du processus principal tant qu'Orbe est ouvert.
- **Pas d'intégrité cryptographique du fichier** : `safeStorage` chiffre sans
  authentifier. Qui peut écrire dans le dossier de données peut abîmer ou
  remplacer le coffre (pas le lire).
- **Sans Touch ID** (Windows, Linux, Mac sans capteur), afficher, copier et
  exporter ne demandent qu'une confirmation : elle n'arrête pas quelqu'un qui a
  la main sur la session ouverte. Et quiconque utilise la session peut de toute
  façon remplir un compte sur son site.
- Le presse-papiers est lisible par toute application pendant les 60 secondes ;
  les gestionnaires d'historique de presse-papiers peuvent garder la copie.
- **Sous Windows**, DPAPI protège contre les autres comptes de la machine, pas
  contre un programme du même utilisateur.
- **Détection des formulaires par heuristique** : un formulaire peut ne pas
  être reconnu (secours : clic droit), et une connexion refusée par un site
  classique peut tout de même déclencher la proposition d'enregistrement.
- Pas de synchronisation, pas de clés d'accès (passkeys), pas de codes à usage
  unique (le champ `OTPAuth` d'un import est conservé et réexporté, pas utilisé).

## Tests

`tests/passwords.js` (53 vérifications, sans réseau, appelées par `npm test`) :
proposition à l'envoi, remplissage sur l'origine exacte, refus sur une autre
origine et en http, sous-domaine avec confirmation, deux étapes, application
monopage, iframe d'une autre origine, navigation privée, profils, page hostile
(prototypes altérés avant chargement, `postMessage`, événements, envoi par
script), chiffrement au repos, coffre abîmé, presse-papiers, CSV aller-retour.
En test, le trousseau du système n'est jamais touché (`use-mock-keychain`).

`tests/passwords-sites.js` (Internet) relève ce qui est reconnu sur de vraies
pages de connexion, sans rien saisir.

## À faire relire

1. `onPageMessage`, `frameInfo`, `fill` et `onPick` : la chaîne qui mène d'un
   message de page à l'envoi d'un mot de passe.
2. La règle des deux étapes (envoi sans second clic).
3. `relation` et `registrable` : le recours aux cookies pour la liste des
   suffixes publics.
4. `nodeIntegrationInSubFrames` sur les vues d'onglet.
5. Les heuristiques de `src/preload/page.js` face à un formulaire piégé
   (champs cachés, formulaire d'un autre usage).
6. La valeur réelle de `promptTouchID` comme barrière, et le délai de 90 s.
