# Sécurité de la navigation de tous les jours

Notes de menace, fonction par fonction, pour ce qu'un navigateur doit décider
à la place de l'utilisateur ou lui demander : autorisations, partage d'écran,
certificats, identifiants HTTP, « quitter la page ? », fenêtres surgissantes,
téléchargements, liens vers d'autres applications.

Principes communs à tout ce qui suit :

- **La décision se prend dans le processus principal**, à partir de ce
  qu'Electron rapporte (origine du cadre demandeur, hôte, certificat, session).
  Jamais d'après un texte fourni par la page.
- **Ce qui vient du site est affiché comme du texte** (`textContent`), tronqué,
  et présenté comme une citation quand c'est le site qui l'a choisi (domaine
  d'authentification, nom d'une fenêtre, adresse d'un lien).
- **Rien n'affaiblit l'existant** : les pages web n'ont toujours ni
  préchargement privilégié ni `window.orbe` ; le gestionnaire de mots de passe
  et l'isolement des extensions ne sont pas touchés.

## Feuilles d'onglet (`src/main/sheets.js`, `src/renderer/sheet.*`)

Toutes les questions liées à une page passent par une « feuille » : une vue
d'Orbe (`orbe://app/sheet.html`, son propre `webContents`) posée par-dessus
l'onglet concerné, aux dimensions exactes de sa page.

| Menace | Réponse |
| --- | --- |
| La page imite la question (fausse fenêtre dessinée en HTML) | La vraie feuille n'est pas dans la page : elle couvre toute la page et suit l'onglet. Limite : rien n'empêche une page de dessiner une imitation ; elle ne peut pas en obtenir d'effet, aucune décision ne passant par elle. |
| La page répond à la place de l'utilisateur | La réponse (`sheet:answer`) n'est acceptée que de la vue de la feuille, reconnue à son `webContents` ; une page web n'a aucun canal vers le processus principal. Vérifié : « une page ne peut pas répondre à la place de la feuille ». |
| Clic piégé (la page fait cliquer au moment où la feuille apparaît) | Les boutons qui engagent (Autoriser, Partager, Continuer, Se connecter, Ouvrir) ignorent tout clic pendant 500 ms après l'affichage. |
| La page ferme ou recouvre la feuille | La feuille est une vue native au-dessus de la page ; la page ne peut ni la fermer ni dessiner par-dessus. |
| Une réponse sert à une autre page | Une feuille se ferme sans réponse quand son onglet change de page ou disparaît. |
| Un autre onglet usurpe la demande | La feuille n'est visible que sur l'onglet demandeur, et nomme l'origine rapportée par Electron. |

Les pages qui ne sont pas des onglets (aperçu, petite fenêtre) n'ont pas de
feuille : la demande est refusée, ou passe par une boîte de dialogue du système
pour les autorisations simples.

## Caméra, micro et autres autorisations (`src/main/permissions.js`)

- Question par origine du **cadre demandeur** ; si elle vient d'un cadre
  intégré, la feuille dit dans quel site.
- Caméra et micro sont deux autorisations distinctes (la clé commune `media`
  des anciennes versions est encore lue). Une origine opaque (`file:`, `data:`)
  n'est jamais retenue.
- Navigation privée : réponses en mémoire seulement.
- **Accord du système** (macOS : `askForMediaAccess` ; Windows : réglage de
  confidentialité) demandé *après* l'accord du site ; s'il manque, la page
  n'obtient rien et une feuille dit lequel manque et ouvre les réglages.
- **Témoin** (`src/main/capture-state.js`) : allumé quand Orbe accorde l'accès,
  éteint quand la page est remplacée, détruite ou arrêtée par l'utilisateur.
  Electron ne dit pas si un flux est encore ouvert : le témoin peut donc rester
  allumé après qu'une page a rendu la caméra, jamais l'inverse. Un témoin
  qu'une page pourrait éteindre ne vaudrait rien, d'où ce choix. « Arrêter »
  recharge la page : c'est le seul arrêt garanti.
- Appareils USB, HID, série, Bluetooth : aucun n'est jamais accordé. Sans
  écouteur, Electron choisirait **le premier appareil** (Bluetooth) : Orbe
  annule la demande et le dit.

## Partage d'écran (`src/main/display-media.js`)

| Menace | Réponse |
| --- | --- |
| Capture sans consentement | Aucune autorisation retenue : chaque partage passe par le sélecteur. La demande doit venir d'un geste (`request.userGesture`). |
| La feuille renvoie une source arbitraire | Elle ne renvoie qu'un identifiant ; il est relu dans la liste dressée par le processus principal. Une source hors liste est refusée (vérifié). |
| Nom de fenêtre piégé (HTML) | Affiché comme du texte. |
| Vignettes : fuite vers la page | Les vignettes ne vont qu'à la feuille d'Orbe, jamais à la page. |
| Le son du système part sans le dire | Case décochée par défaut, proposée seulement là où c'est possible (onglet ; écran sous Windows). |

Sans l'accord de macOS pour l'enregistrement de l'écran, seul « Cet onglet »
est utilisable ; le sélecteur l'explique et ouvre les réglages.

## Certificats (`src/main/certs.js`)

- Un certificat refusé par Chromium **reste refusé** : Orbe ne répond « oui »
  à `certificate-error` que pour une exception posée par l'utilisateur.
- L'exception vaut pour **un hôte (avec son port) + l'empreinte de ce
  certificat + la session en cours**. Elle n'est jamais écrite sur disque
  (vérifié) et ne passe pas d'un profil ou d'une fenêtre privée à l'autre.
  La retirer coupe les connexions ouvertes (`closeAllConnections`), sinon
  Chromium continuerait à s'en servir.
- « Continuer quand même » n'est **pas proposé** pour un certificat révoqué
  (−206), la transparence exigée (−214), une interception connue (−217), ni
  pour un site qui impose HTTPS (**HSTS**). Electron n'expose pas l'état HSTS :
  Orbe le lit par une sonde, une requête `HEAD http://hôte/` sans cookies ni
  suivi de redirection dans la session ; un site HSTS répond par une
  redirection interne de Chromium (307, `Non-Authoritative-Reason: HSTS`)
  avant tout échange. Limite : pour un site sans HSTS, cette sonde peut ouvrir
  une connexion HTTP vers l'hôte déjà contacté (abandonnée aussitôt).
- Le choix par défaut de l'avertissement est « Revenir en lieu sûr » ;
  « Continuer » est derrière « Détails » et soumis au délai anti-clic.
- La pastille d'adresse reste « Non sécurisé » tant que l'exception existe.
- `setCertificateVerifyProc` ne sert qu'à relever le certificat présenté
  (pour le résumé) : il répond toujours −3, « décision de Chromium ».

## Authentification HTTP et certificats clients (`src/main/auth.js`)

- La feuille nomme l'hôte donné par Electron (`authInfo`) ; le domaine (realm)
  est cité comme message du serveur.
- Une **ressource d'un autre hôte** que la page (image, script, requête) ne
  fait pas apparaître la question : demande annulée (hameçonnage classique).
  Une navigation, y compris d'un cadre, le peut.
- En HTTP simple, la feuille prévient que le mot de passe partira en clair.
- Rien n'est retenu par Orbe (Chromium garde l'identification pour la session).
- **À faire** : proposer les comptes du gestionnaire de mots de passe. Il
  faudrait une clé « hôte + domaine » et passer par le déverrouillage du
  coffre ; ce n'est ni trivial ni sans risque, donc laissé de côté.
- Certificat client : Electron enverrait le premier du trousseau ; Orbe n'en
  envoie aucun sans un choix explicite.

## « Quitter la page ? » (`src/main/unload.js`)

- Texte fixe, boîte de dialogue du système ; le texte voulu par la page est
  ignoré. « Rester » est le choix par défaut.
- Chromium n'émet l'événement que si l'utilisateur a agi dans la page : une
  page jamais touchée ne peut retenir ni un onglet ni une fenêtre.
- Une page qui ne répond pas ne retient rien (délai de 4 s).
- L'archivage automatique des vieux onglets et la mise en veille ne posent pas
  la question (pas de boîte de dialogue surgie de nulle part).

## Fenêtres surgissantes (`src/main/popups.js`)

Electron 44 ne dit pas à `setWindowOpenHandler` si l'ouverture vient d'un
geste, et n'embarque pas le bloqueur de Chrome. Heuristique d'Orbe :

- un geste = une vraie entrée reçue par la page (`before-mouse-event`,
  `before-input-event`), qu'un script ne peut pas fabriquer ;
- il vaut 5 s (activation passagère de Chromium : laisse passer les connexions
  OAuth qui ouvrent leur fenêtre après un aller-retour réseau) et il est
  **consommé** par l'ouverture ;
- « Toujours autoriser pour ce site » est une autorisation par origine,
  visible et réinitialisable dans les informations du site.

Limites : le geste profite à tous les cadres de la page pendant 5 s (Chromium
suit l'activation cadre par cadre) ; « Ouvrir quand même » ouvre l'adresse dans
un onglet sans lien `window.opener` avec la page.

## Téléchargements (`src/main/downloads.js`)

- Nom proposé par le site réduit à un simple nom ; jamais d'écrasement.
- Fichiers exécutables (`.dmg`, `.pkg`, `.exe`, `.app`, `.command`, scripts…) :
  signalés, jamais ouverts automatiquement ; les ouvrir depuis Orbe demande
  une confirmation qui nomme l'hôte d'origine.
- Seuls les PDF s'ouvrent seuls, dans la visionneuse de Chromium (bac à
  sable), jamais dans une application du système.
- Reprise : même session (mêmes cookies) que le téléchargement d'origine ;
  validée par Chromium avec `ETag` / `Last-Modified`.

## Liens vers d'autres applications (`permissions.js`, `openExternal`)

- Toujours une question, qui montre l'adresse et le site demandeur.
- « Toujours autoriser » se retient par **site + schéma**, et reste limité à
  une ouverture toutes les 3 s par page (sinon la question revient).
- Schémas jamais transmis au système : `file:`, `javascript:`, `data:`,
  `ms-msdt:`, `search-ms:`, `ms-officecmd:`, `shell:`, `smb:`… (liste dans
  `BLOCKED_SCHEMES`).
- Orbe ouvre le lien lui-même (`shell.openExternal`) et répond toujours « non »
  à Chromium : une seule porte, vérifiable.

## Ce qui demande une vérification humaine

- Les vraies questions du système (caméra, micro, enregistrement de l'écran)
  avec l'application signée ; le partage d'un écran ou d'une fenêtre réels.
- Un vrai proxy avec authentification ; un vrai certificat client.
- Un site HSTS réel avec un certificat refusé (la sonde est testée par
  substitution).
