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
| Clic piégé (la page fait cliquer au moment où la feuille apparaît) | Une réponse qui engage (autoriser, partager, continuer, se connecter, ouvrir) est refusée **par le processus principal** pendant 500 ms à compter du moment où la feuille devient visible — y compris quand elle réapparaît parce que celle du dessus s'est fermée, ou au retour sur l'onglet. La vue applique le même délai, remis à zéro par le processus principal. Une feuille non visible ne peut pas être validée. |
| La page ferme ou recouvre la feuille | La feuille est une vue native au-dessus de la page ; la page ne peut ni la fermer ni dessiner par-dessus. |
| Une réponse sert à une autre page | Une feuille se ferme sans réponse quand son onglet change de page (début d'une navigation, **ou arrivée d'une navigation lancée avant elle**) ou disparaît. Avant de retenir une réponse ou d'ouvrir un lien, Orbe vérifie que la page (ou le cadre) qui demandait est toujours là, avec la même origine. |
| Une page noie l'utilisateur sous les feuilles | Quatre feuilles au plus par onglet ; au-delà la demande est refusée. |
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
- Navigation privée : réponses en mémoire seulement. **Chaque profil a ses
  propres réponses** (`store.state.permissions` pour le profil par défaut,
  `profilePermissions[id]` pour les autres) : un accord donné dans un profil ne
  vaut pas dans un autre.
- Caméra et micro demandés par un **cadre intégré à un autre site** : la
  réponse ne vaut que pour le couple (site intégré, site qui l'intègre). Un site
  hostile qui intègre un service déjà autorisé ailleurs (avec `allow="camera"`)
  fait donc réapparaître la question, qui nomme les deux sites.
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

### L'ancienne capture d'écran (`getUserMedia` + `chromeMediaSource`)

Relevé par essai sur Electron 44.7 (revue de sécurité du 9 octobre 2026) :

- `getDisplayMedia` arrive d'abord au gestionnaire d'autorisations comme une
  demande `media` **sans** `mediaTypes`, puis au sélecteur ;
- `getUserMedia({ video: { mandatory: { chromeMediaSource: 'desktop' } } })`
  (avec ou sans identifiant de source, ou `'screen'`, ou `'tab'`) arrive sous la
  **même** forme, sans geste… et, si la réponse est « oui », Electron livre
  aussitôt le flux — écran entier, 3456 × 2234 lors de l'essai — **sans appeler
  le sélecteur** ;
- répondre « non » refuse aussi `getDisplayMedia` ; rien, dans la demande, ne
  distingue les deux ;
- pour un vrai `getDisplayMedia`, le sélecteur est appelé **pendant** l'appel
  `callback(true)` (de façon synchrone).

Réponse d'Orbe (`displayGate`, `answerDisplay` dans `permissions.js`) :

1. la demande est refusée si la page n'est pas un onglet, ou si l'utilisateur
   n'y a pas agi dans les 5 secondes (vraie entrée vue par le processus
   principal). Une page ne peut donc rien obtenir sans un clic ou une frappe ;
2. sinon Orbe répond « oui » et regarde si le sélecteur a été appelé avant le
   retour de l'appel. S'il ne l'a pas été, c'était l'ancienne capture : tous
   les processus de la page (cadres compris) sont **arrêtés sur-le-champ**,
   dans le même tour de boucle, avant que le flux — dont l'ouverture demande
   plusieurs allers-retours entre processus — n'arrive à la page. Un message
   le dit ; la page plantée peut être rechargée.

Limite assumée : la seconde étape est une course gagnée par construction
(l'arrêt est synchrone, l'ouverture du flux ne l'est pas), pas une
impossibilité. Aucun site ordinaire n'emploie cet appel (dans Chrome il est
réservé aux extensions). Si une version d'Electron appelait un jour le
sélecteur de façon différée, l'essai « le partage d'écran par le sélecteur
fonctionne toujours » échouerait aussitôt.

## Certificats (`src/main/certs.js`)

- Un certificat refusé par Chromium **reste refusé** : Orbe ne répond « oui »
  à `certificate-error` que pour une exception posée par l'utilisateur.
- L'exception vaut pour **un hôte (avec son port) + l'empreinte de ce
  certificat + la session en cours**. Elle n'est jamais écrite sur disque
  (vérifié) et ne passe pas d'un profil ou d'une fenêtre privée à l'autre.
  La retirer coupe les connexions ouvertes (`closeAllConnections`), sinon
  Chromium continuerait à s'en servir.
- « Continuer quand même » n'est **pas proposé** pour un certificat révoqué
  (−206), invalide (−207) ou incohérent (−203), la transparence exigée (−214),
  une interception connue (−217), ni pour un site qui impose HTTPS (**HSTS**).
  Electron n'expose pas l'état HSTS : Orbe le lit par une sonde, une requête
  `HEAD http://hôte/` sans cookies ni suivi de redirection dans la session ; un
  site HSTS répond par une redirection interne de Chromium (307,
  `Non-Authoritative-Reason: HSTS`) avant tout échange.
- **Vérifié par essai** (hôte de la liste préchargée détourné vers un serveur
  local par `--host-resolver-rules`) : la sonde répond « HSTS » en quelques
  millisecondes sans trafic ; Electron 44 émet bien `certificate-error` pour un
  site HSTS, et **`callback(true)` passerait outre HSTS**. La sonde d'Orbe est
  donc la seule barrière : elle **échoue fermée**. Seule une preuve que le site
  n'impose pas HTTPS rend « continuer » possible — une réponse HTTP, une
  redirection ordinaire, ou une erreur de transport en HTTP simple (connexion
  refusée, nom introuvable… : la demande est partie en clair, donc Chromium ne
  l'a pas convertie). Délai dépassé (1,5 s), demande bloquée ou annulée : pas
  de « continuer ». Conséquence : un hôte dont le port 80 ne répond pas du tout
  (pare-feu qui avale les paquets) ne peut pas être accepté malgré son
  certificat. Limite : pour un site sans HSTS, la sonde peut ouvrir une
  connexion HTTP vers l'hôte déjà contacté (abandonnée aussitôt).
- La pastille dit « Non sécurisé » dès le refus du certificat (pendant la
  sonde, et si une autre navigation part avant sa fin), et tant qu'un
  avertissement attend, même recouvert par une autre feuille.
- Le choix par défaut de l'avertissement est « Revenir en lieu sûr » ;
  « Continuer » est derrière « Détails » et soumis au délai anti-clic.
- La pastille d'adresse reste « Non sécurisé » tant que l'exception existe.
- `setCertificateVerifyProc` ne sert qu'à relever le certificat présenté
  (pour le résumé) : il répond toujours −3, « décision de Chromium ».

## Authentification HTTP et certificats clients (`src/main/auth.js`)

- La feuille nomme l'hôte donné par Electron (`authInfo`) ; le domaine (realm)
  est cité comme message du serveur.
- Quand c'est **la page en cours de chargement** qui demande (reconnue à
  l'adresse de la navigation principale en cours, suivie par Orbe), la feuille
  **couvre entièrement l'ancienne page** et affiche l'adresse demandée : la
  question ne peut pas passer pour celle du site encore affiché.
- Un **cadre ou une ressource d'un autre hôte** que la page (publicité, image,
  script, requête) ne fait pas apparaître la question : demande annulée
  (hameçonnage classique). Un cadre du même hôte le peut.
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
- Une page qui ne répond pas ne retient rien (délai de 4 s). Ce délai est celui
  d'Orbe : Chromium, lui, ferme d'office une page consultée qui n'a pas répondu
  en une seconde, puis de nouveau une seconde après la réponse de l'utilisateur
  si la page tarde à en accuser réception. Sur une machine chargée, la page
  disparaissait donc juste après « Rester ». Chromium n'applique pas ce délai à
  une page dont le débogueur est attaché : Orbe attache celui d'Electron, sans
  rien lui demander, le temps de la consultation (« bouclier », `shield`), et le
  rend dès que la page a répondu (au plus dix secondes). Une extension ou la
  capture de page entière qui veut le débogueur à cet instant le reçoit.
- Si une page disparaît malgré tout dans les quinze secondes qui suivent
  « Rester » sans qu'Orbe l'ait demandé, son onglet garde sa ligne et se
  recharge : il n'est pas archivé comme une page qui se ferme d'elle-même, et le
  journal de la page est écrit dans la console.
- Veille automatique et fermeture demandée en même temps sur la même page : la
  réponse de la page vaut pour la demande de l'utilisateur, la question est posée.
- Limite connue : un aperçu ou une petite fenêtre se ferment sans consulter la page.
- Pas de boîtes en rafale (elles bloquent toute l'application) : pendant les
  2 secondes qui suivent « Rester », une nouvelle tentative de quitter la même
  page est refusée sans rien demander. « Quitter la page » reste toujours
  possible à la boîte suivante.
- L'archivage automatique des vieux onglets et la mise en veille ne posent pas
  la question (pas de boîte de dialogue surgie de nulle part).

## Fenêtres surgissantes (`src/main/popups.js`)

Electron 44 ne dit pas à `setWindowOpenHandler` si l'ouverture vient d'un
geste, et n'embarque pas le bloqueur de Chrome. Heuristique d'Orbe :

- un geste = une vraie entrée reçue par la page (`before-mouse-event`,
  `before-input-event`), qu'un script ne peut pas fabriquer ;
- il vaut 5 s (activation passagère de Chromium : laisse passer les connexions
  OAuth qui ouvrent leur fenêtre après un aller-retour réseau) et il est
  **consommé** par l'ouverture : un clic ouvre une fenêtre, une seule (le
  relâchement du bouton ne redonne pas de geste si l'appui a déjà servi) ;
- il **ne survit pas à un changement de page** ;
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
  sable), jamais dans une application du système. « PDF » se juge sur le
  fichier enregistré : extension `.pdf` **et** contenu qui commence par
  `%PDF-`. Le type annoncé par le serveur ne compte jamais : un fichier
  `.html` servi comme `application/pdf` serait sinon ouvert en `file://` dans
  un onglet (trouvé par la revue de sécurité, corrigé et couvert par un essai).
  L'ouverture automatique exige en plus que le téléchargement vienne d'un
  geste de l'utilisateur (`DownloadItem.hasUserGesture()`).
- « Exécutable » se juge au moment d'ouvrir, sur le fichier tel qu'il est sur
  disque ; les caractères invisibles (inversion du sens de lecture, espaces de
  largeur nulle) et les points ou espaces en fin de nom sont retirés avant de
  lire l'extension. La liste couvre aussi les scripts et raccourcis de Windows
  (`.js`, `.vb`, `.chm`, `.settingcontent-ms`, `.xll`, `.vhdx`…) et de macOS
  (`.inetloc`, `.fileloc`, `.mobileconfig`, `.prefpane`, `.xip`).
- « Toujours demander » : sans geste de l'utilisateur, une page n'obtient pas
  deux fenêtres d'enregistrement à moins de 10 s d'intervalle.
- Reprise : même session (mêmes cookies) que le téléchargement d'origine ;
  validée par Chromium avec `ETag` / `Last-Modified`.

## Liens vers d'autres applications (`permissions.js`, `openExternal`)

- Toujours une question, qui montre l'adresse et le site demandeur.
- « Toujours autoriser » se retient par **site + schéma**, et reste limité à
  une ouverture toutes les 3 s par page (sinon la question revient). Le site
  est celui du **cadre qui lance le lien** : vérifié par essai, un cadre
  publicitaire qui fait `top.location = 'schéma:…'` est vu par Electron comme
  le demandeur (`requestingUrl` = son adresse, `isMainFrame: false`) ; il
  n'hérite donc pas de l'accord donné au site qui l'intègre, et la feuille dit
  qu'il est intégré.
- « Annuler » vaut pour ce schéma tant que l'onglet reste sur la page ; sans
  geste récent de l'utilisateur, une page ne fait apparaître la question
  qu'une fois (une page d'invitation qui lance son application reste
  possible, pas une boucle).
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
