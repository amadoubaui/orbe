# Inventaire d'Arc, point par point, et état dans Orbe

> Version de travail du 8 octobre 2026. Référence : Arc 1.166 pour macOS, installé sur ce Mac.
> Inventaire complet à cette date. Le bilan chiffré et la liste « À faire ensuite » sont en fin de fichier.

## Comment lire ce fichier

États : ✅ fait et vérifié (code + test ou vérification) · 🟡 partiel ou non vérifié · ⬜ à faire · ➖ écarté (avec la raison).

Provenance de chaque affirmation sur Arc :

- **mesuré** : chiffre relevé sur l'application réelle (capture d'écran ou enregistrement à 60 images/s, fenêtre de navigation privée ouverte pour l'occasion puis refermée) ;
- **observé** : lu dans l'application réelle (barre de menus par l'accessibilité, fenêtre) ;
- **binaire** : texte ou fichier présent dans `/Applications/Arc.app` (libellés de l'interface, fichiers son, polices, vidéos) ; prouve que la fonction existe et donne son libellé exact, pas son comportement ;
- **source : URL** : documentation ou article ;
- **non vérifié** : connu de mémoire ou déduit, à confirmer avant de s'y fier.

## Mesures relevées sur Arc 1.166 (fenêtre 1728 × 1035 pt, thème sombre, « Réduire les animations » désactivé)

| Réf. | Élément | Valeur | Provenance |
| --- | --- | --- | --- |
| M-1 | Largeur de la barre latérale | 228 pt (réglage de l'utilisateur) | mesuré |
| M-2 | Marge entre le bord de la fenêtre et la page, barre masquée | 10 pt à gauche | mesuré |
| M-3 | Masquer la barre latérale (⌘S) | instantané : la barre disparaît en une image (≤ 17 ms), sans glissement | mesuré |
| M-4 | Réafficher la barre latérale (⌘S) | 3 images, environ 50 ms (bord à 114 pt, 207 pt, puis 228 pt) | mesuré |
| M-5 | ⌘S sans aucun onglet ouvert | sans effet (l'article de menu est grisé) | mesuré + observé |
| M-6 | Barre de commande : largeur | environ 763 pt, centrée sur la fenêtre entière (pas sur la page) | mesuré |
| M-7 | Barre de commande : position verticale | bord haut à environ 350 pt du haut d'une fenêtre de 1035 pt (un tiers) | mesuré |
| M-8 | Barre de commande : hauteur avec 5 suggestions | environ 330 pt ; ligne de suggestion de 46 pt | mesuré |
| M-9 | Barre de commande : fond | aucun assombrissement de la page derrière ; grande ombre portée (environ 70 pt) | mesuré |
| M-10 | Barre de commande : ligne sélectionnée | aplat bleu sur toute la largeur intérieure | mesuré |
| M-11 | Nouvelle fenêtre sans onglet | la barre de commande s'ouvre d'elle-même | mesuré |
| M-12 | ⌘T quand la barre de commande est ouverte | la referme (bascule) | mesuré |
| M-13 | Ajouter une vue scindée (⌃⇧=) | le volet vide apparaît à droite sans animation visible, avec la barre de commande ouverte dedans ; chaque volet reçoit une petite barre d'adresse en haut | mesuré |
| M-14 | Fermer le volet (⌃⇧-) | retour immédiat à une seule page | mesuré |

Non mesuré, et pourquoi : le changement d'Espace, l'aperçu (Peek), le glisser-déposer et les gestes du pavé tactile demandent soit la souris, soit les Espaces réels du propriétaire ; ils n'ont pas été déclenchés pour ne rien modifier chez lui. La durée du fondu de la barre de commande n'a pas pu être chiffrée (l'enregistrement n'a pas produit d'images intermédiaires exploitables).

## Abréviations des preuves

Arc :
- `HC n` = article du centre d'aide, `https://resources.arc.net/hc/en-us/articles/n` (les notes de version sont les articles 20498417809815 pour 2021-2022, 20498377604887 pour 2023, 20498293324823 pour 2024 et après) ;
- `inverse` = https://www.inverse.com/gear/arc-web-browser-the-browser-company-josh-miller ; `warren` = https://blog.warrenweb.net/arc-setup/ ; `hongkiat` = https://www.hongkiat.com/blog/arc-browser-keyboard-shortcuts/ ; `howtogeek` = https://www.howtogeek.com/888738/ways-arc-transforms-your-web-browser-experience/ ; `allthings` = https://allthings.how/15-arc-browser-tips-tricks-to-make-web-browsing-effortless/ ; `slashgear` = https://www.slashgear.com/1634601/best-arc-browser-features/ ; `popsci` = https://www.popsci.com/diy/arc-browser-tips/ ;
- `M-n` = mesure du tableau ci-dessus ; `menu` = barre de menus d'Arc lue par l'accessibilité le 8 octobre 2026 ; `binaire` = libellé ou fichier trouvé dans l'application.

Orbe : `W` = `src/main/window.js`, `C` = `commands.js`, `M` = `menu.js`, `MA` = `main.js`, `SH` = `src/renderer/shell.js`, `SC` = `shell.css`, `OV`/`OC` = `overlay.js`/`overlay.css`, `SU` = `suggest.js`. Tests : `self` = `tests/selftest.js` (179 vérifications sur 179 réussies le 8 octobre 2026, profil temporaire), `ui NN` = `tests/ui/NN-*.js`, `nat` = `tests/natif/raccourcis.js`. Les tests `ui` et `nat` sont cités d'après leur lecture, ils n'ont pas été relancés pour cet inventaire.

Règle appliquée pour ✅ : le code existe **et** un test nommé le couvre. Du code sans test est noté 🟡, même s'il a l'air juste.

## BL — Barre latérale

| Id | Ce que fait Arc | Preuve Arc | État | Preuve Orbe | Note |
| --- | --- | --- | --- | --- | --- |
| BL-1 | Toute la navigation tient dans une barre à gauche : adresse et boutons en haut, favoris, titre de l'Espace, épinglés, séparateur, « + New Tab », onglets du jour, rangée du bas | allthings ; observé | ✅ | SH, `shell.html` ; self « la barre latérale reçoit son état » | |
| BL-2 | Largeur réglable en tirant le bord | HC 20498463803799 | ✅ | W:setSidebarWidth ; ui 07 (250 par défaut, 200 à 420) | |
| BL-3 | Double-clic sur le bord : retour à la largeur par défaut | HC 20498463803799 | ⬜ | SH:405-422 (pas de double-clic) | Ajouter `dblclick` sur `#resize` |
| BL-4 | Tirer le bord tout à gauche masque la barre | HC 20498293324823 | ⬜ | aucun code | Sous 200 px moins un seuil, masquer |
| BL-5 | Mode étroit : la barre très resserrée garde précédent/suivant | HC 20498417809815 | ⬜ | minimum 200 px | À étudier, faible priorité |
| BL-6 | ⌘S masque et réaffiche la barre | menu ; M-3, M-4 | ✅ | W:animate ; self « ⌘S masque… », « ⌘S la réaffiche » | |
| BL-7 | La bascule ⌘S est quasi instantanée (0 à 50 ms) | M-3, M-4 | ✅ | Orbe anime sur 180 ms (W:415-428, SC:20) | Fait le 8 oct. (cotes et durées d'Arc) |
| BL-8 | ⌘S est sans effet quand aucun onglet n'est ouvert | M-5 | 🟡 | non vérifié dans Orbe | Détail, à décider |
| BL-9 | Barre masquée : approcher le bord gauche la fait apparaître par-dessus la page, y compris en plein écran | howtogeek | ✅ | W:setPeek ; self « survol du bord : la barre flotte, la page ne bouge pas » | Plein écran non testé |
| BL-10 | Marge de 10 pt autour de la page | M-2 | ✅ | 8 px (W:14-16) | Fait le 8 oct. (cotes et durées d'Arc) |
| BL-11 | La page est dans un cadre coloré aux coins arrondis, volontairement visible | inverse (entretien) ; observé | ✅ | W:layout, rayon 10 ; ui 02 | Rayon exact d'Arc non mesuré |
| BL-12 | Zone vide de la barre : sert à déplacer la fenêtre | HC 20498417809815 | 🟡 | zones `drag` dans `#top` et `#empty` ; aucun test | Vérifier sur la zone des onglets |
| BL-13 | On peut déplacer la fenêtre par le haut de la page (réglage, ⌘ pour neutraliser) | HC 20498377604887 ; binaire « Allow window dragging from the top of webpages » | ⬜ | aucun code | Bande de 8 px au-dessus de la page |
| BL-14 | Double-clic dans le vide de la barre : nouvel onglet (barre de commande) | HC 20498377604887 | ⬜ | aucun code | Simple |
| BL-15 | Glisser du texte sur la barre : recherche dans un nouvel onglet | HC 20498377604887 | 🟡 | SH:581-590 ; seul le refus des adresses `file:` et `orbe:` est testé (self) | Tester le dépôt d'un texte |
| BL-16 | La barre s'estompe légèrement quand la fenêtre perd le focus | HC 20498377604887 | ⬜ | aucun code | Classe `blur` sur `body`, opacité du contenu |
| BL-17 | Indicateur de débordement quand l'onglet actif est hors de vue dans la liste | HC 20498377604887 | ⬜ | aucun code | |
| BL-18 | Infobulles maison avec le raccourci, au survol des boutons | HC 20498417809815 | 🟡 | attribut `title` natif | Infobulle maison avec raccourci |
| BL-19 | Boutons en haut : afficher/masquer la barre, précédent, suivant, actualiser | observé (capture) | ✅ | `shell.html` ; ui 09 | |
| BL-20 | Appui long ou clic droit sur précédent/suivant : historique de l'onglet | HC 20498377604887 | ⬜ | aucun code | `navigationHistory.getAllEntries()` |
| BL-21 | ⌘clic ou clic molette sur précédent/suivant : ouvre dans un nouvel onglet | HC 20498377604887 | ⬜ | aucun code | |
| BL-22 | ⌘clic sur actualiser : duplique l'onglet | HC 20498377604887 | ⬜ | aucun code | |
| BL-23 | Le bouton actualiser a un menu d'options (forcer, effacer cookies) | binaire « A button that shows a list of reload options » | ⬜ | aucun code | |
| BL-24 | Échap ou double-clic sur actualiser arrête le chargement | HC 20498377604887 | 🟡 | bouton qui devient ✕ ; ⌘. ; ui 09 | Échap non géré |
| BL-25 | Boutons animés (plus, fermer, actualiser, précédent, suivant) | HC 20498417809815 | ⬜ | transitions de fond seulement | Voir ANI |
| BL-26 | Pastille d'adresse : 35 pt de haut, coins de 11 pt, adresse raccourcie | `docs/analyse-arc.md` (mesuré) | ✅ | SC `#url` 36 px r11 ; ui 11 | |
| BL-27 | Texte par défaut « Search or Enter URL… » | observé | ✅ | locales | |
| BL-28 | Pas de cadenas pour un site sûr ; icône explicite pour un site non sûr | HC 20498377604887 | ⬜ | aucun indicateur | Icône d'alerte en http |
| BL-29 | Bouton de copie du lien dans la pastille, au survol | HC 20498377604887 | ⬜ | aucun code | |
| BL-30 | Extensions épinglées visibles dans la pastille au survol | HC 19434259167767 | 🟡 | boutons `#exts` sous la pastille ; ui 14 | Emplacement différent |
| BL-31 | Bouton du centre de contrôle du site, à droite de l'adresse | HC 19434259167767 ; binaire | 🟡 | bouclier + menu natif (W:shieldMenu) | Voir EXT |
| BL-32 | Indicateur de chargement animé, en haut au centre de la fenêtre (lueur) | HC 20498377604887 ; binaire `ARC_GlowProgressLoadingIndicator` (shader Metal) | 🟡 | balayage dans la pastille (SC `sweep` 1,1 s) | Refaire en haut de page, lueur |
| BL-33 | Favoris : tuiles en haut, communes aux Espaces d'un même profil | HC 19230755904151 | ✅ | SH `#fav` ; self « ajout aux favoris » | |
| BL-34 | 12 favoris au plus | HC 19230755904151 | 🟡 | pas de limite lue dans le code | Fixer 12 |
| BL-35 | Tuile de 47 pt de haut, coins de 14 pt, espacement de 8 pt ; 3 × 3 pour 9, 4 colonnes pour 11 | `docs/analyse-arc.md` (mesuré) | ✅ | SC `.tile` ; ui 04 | |
| BL-36 | État vide des favoris : « Drag to add Favorites » | binaire | 🟡 | zone en pointillés pendant un glisser seulement | |
| BL-37 | Pastilles de notification sur les favoris (Gmail, Slack, WhatsApp, X, Agenda) | https://arc.net/integrations ; binaire (couleurs de badge) | ⬜ | aucun code | Lire le titre « (3) » de l'onglet |
| BL-38 | Favori d'un site de musique qui joue : icône animée par des notes | HC 20498417809815 | 🟡 | point de 4 px si audible | |
| BL-39 | Icône d'un favori personnalisable | HC 20498293324823 | ⬜ | aucun code | |
| BL-40 | Titre de l'Espace cliquable pour renommer ; « … » au survol | HC 20498377604887 | 🟡 | double-clic ; ui 03 | Clic simple + bouton « … » |
| BL-41 | Chevron pour replier la section épinglée | HC 19231060187159 ; menu « Collapse Pinned Tabs » | ⬜ | aucun code | |
| BL-42 | Séparateur avec « Clear » au survol | HC 20498377604887 | ✅ | SH `#b-clear` ; ui 02 | |
| BL-43 | Ligne « + New Tab » en tête des onglets du jour | observé | ✅ | `#b-newtab` ; ui 01 | |
| BL-44 | Les nouveaux onglets arrivent en haut | observé | ✅ | W:createTab ; self | |
| BL-45 | Pas des lignes d'onglet de 41 pt, texte d'environ 14 pt | `docs/analyse-arc.md` | ✅ | SC `.row` ; ui 11 | |
| BL-46 | Croix de fermeture au survol d'une ligne | observé (habituel) ; binaire (infobulle) | ✅ | ui 02 | |
| BL-47 | Bouton haut-parleur sur un onglet qui joue ; clic = muet | binaire « mutes the tab » | 🟡 | SH:61,308 ; aucun test | Ajouter un test |
| BL-48 | Indicateur animé micro/caméra ; onglet partagé surligné en jaune | HC 25590627478935 | 🟡 | témoin caméra / micro / écran sur la ligne de l’onglet et dans la pastille d’adresse (capture-state.js) ; self « le témoin apparaît dans la pastille d’adresse et sur la ligne de l’onglet » ; ui « témoin de partage… » | Pas d’animation ni de surlignage jaune ; le témoin reste allumé jusqu’au changement de page (Electron ne dit pas si un flux est encore ouvert) |
| BL-49 | « / » sur un épinglé qui a quitté son adresse ; clic sur l'icône = retour | HC 25625148480279 | 🟡 | SH:36-37 ; aucun test | Ajouter un test |
| BL-50 | ⌘clic sur l'icône d'un épinglé : retour à l'adresse, l'ancienne page part dans un nouvel onglet | HC 20498293324823 | ⬜ | aucun code | |
| BL-51 | Double-clic sur un onglet pour le renommer | HC 19231060187159 ; binaire « Double-click to rename » | 🟡 | épinglés seulement ; ui 03 | Étendre aux onglets du jour |
| BL-52 | Icône d'un onglet personnalisable (émoji) ; « Reset Name and Icon » | HC 20498293324823 ; binaire | ⬜ | aucun code | |
| BL-53 | Sélection multiple (⇧clic, ⌘clic) ; ⌘W et ⇧⌘C agissent sur la sélection ; menu commun, glisser le lot | HC 20498417809815 | ✅ | `SH:setSel`, `W:checkIds` (listes d’identifiants vérifiées) ; self « sélection : … » (tests/barre.js) ; ui 16 | La sélection part de l’onglet affiché, comme dans Chrome (non vérifié sur Arc) ; ⌘D et Suppr agissent aussi sur elle ; menu de la sélection : copier les liens, dupliquer, épingler, favoris, dossier, déplacer vers un Espace, archiver |
| BL-54 | Rangée du bas : Bibliothèque, icônes des Espaces, « + » | observé | ✅ | `#bottom` ; ui 06 | |
| BL-55 | « + » du bas : New Space, New Folder, New Split View, New Easel, New Boost, New Note | HC 19231142050071 ; binaire (icônes `add-space`, `folder`, `split-add-right`…) | 🟡 | menu : onglet, dossier, Espace, thème | Ajouter scinder, tableau, Boost, note |
| BL-56 | Bandeau de mise à jour en bas de la barre | observé « New Arc Version Available » ; HC 21489650267031 | ⬜ | pas de mise à jour automatique | Voir DIV |
| BL-57 | Téléchargement en cours affiché en bas de la barre (taille, temps restant, annuler) | HC 20498377604887 | 🟡 | anneau de progression sur le bouton Bibliothèque | |
| BL-58 | Lecteur audio miniature en bas de la barre | HC 19234766331799 | 🟡 | `#media` ; voir BIB | |
| BL-59 | Fenêtre privée : barre noire, mention « Incognito » | observé (capture) ; HC 20498377604887 | ✅ | `#incognito` ; self « navigation privée » | |
| BL-60 | Survol d'un lien : pastille d'état en bas, qui s'étend à l'adresse entière après 1,5 s et s'écarte de la souris | HC 20498377604887, 20498293324823 | 🟡 | statut de lien (W:1498) | Extension à 1,5 s et évitement absents |

### Dossiers

| Id | Ce que fait Arc | Preuve Arc | État | Preuve Orbe | Note |
| --- | --- | --- | --- | --- | --- |
| BL-70 | Dossiers dans la section épinglée | HC 19228419623447 | ✅ | W:newFolder ; ui 05 | |
| BL-71 | Dossiers imbriqués | HC 20498377604887 ; binaire « New Nested Folder » | ✅ | W:move ; self « dossier imbriqué… » | |
| BL-72 | Un dossier fermé laisse voir l'onglet actif qu'il contient | HC 20498377604887 | ✅ | SC:378-380 ; ui 05 | |
| BL-73 | Ouverture/fermeture animée | non vérifié | 🟡 | chevron animé, contenu sans animation | Animer la hauteur |
| BL-74 | Aperçu du dossier au survol : liste cherchable de ses onglets | HC 19228419623447 | ⬜ | aucun code | |
| BL-75 | Icône du dossier modifiable (« Change Icon ») | HC 20498377604887 | ⬜ | aucun code | |
| BL-76 | Un dossier fermé ne s'ouvre pas quand on glisse dessus ; animation de dépôt | HC 20498377604887 | 🟡 | dépôt géré (ui 04), sans animation | |
| BL-77 | Supprimer un dossier archive ses onglets, avec message et annulation | binaire « Deleting this folder will archive the tabs inside it. » | 🟡 | W:deleteFolder : le contenu remonte, sans message | Comportement différent d'Arc |
| BL-78 | Dossier transformable en Espace, et Espace en dossier | binaire « Turn into Folder » | ⬜ | aucun code | |
| BL-79 | « New Folder from Selection » | binaire | ✅ | `W:folderFromSelection` ; self « Nouveau dossier avec la sélection » ; ui 16 | Le dossier prend la place du premier onglet épinglé de la sélection |
| BL-80 | Commandes « Expand All Folders » / « Collapse All Folders » | binaire | ⬜ | aucun code | Simple |
| BL-81 | Dossiers vivants GitHub (demandes de fusion) | HC 22731612065815 | ➖ | | Dépend d'un service tiers ; hors du socle |

### Glisser-déposer

| Id | Ce que fait Arc | Preuve Arc | État | Preuve Orbe | Note |
| --- | --- | --- | --- | --- | --- |
| BL-90 | Réordonner les onglets | observé (habituel) | ✅ | ui 04 | |
| BL-91 | Glisser à travers le séparateur pour épingler ou désépingler | HC 19231060187159 | ✅ | ui 04 | |
| BL-92 | Glisser vers ou depuis les favoris | HC 19230755904151 | ✅ | ui 04 | |
| BL-93 | Glisser dans un dossier | HC 19228419623447 | ✅ | ui 04 ; self | |
| BL-94 | Glisser un onglet à gauche ou à droite vers un autre Espace | HC 20498417809815 | ⬜ | pas de dépôt sur les pastilles | |
| BL-95 | Glisser un onglet hors de la fenêtre : nouvelle fenêtre | HC 20498377604887 | ⬜ | aucun code | |
| BL-96 | Glisser entre deux fenêtres | non vérifié | ⬜ | ignoré volontairement (SH:586) | |
| BL-97 | Glisser un onglet sur la page : vue scindée, le côté dépend de l'endroit du dépôt | HC 20498293324823 | 🟡 | moitié droite seulement ; self « lâcher un onglet sur la page… » | Quatre côtés |
| BL-98 | Glisser un onglet sur un autre dans la barre : vue scindée | HC 20498293324823 | ⬜ | aucun code | |
| BL-99 | ⌥glisser un onglet : le duplique | HC 19231060187159 | ⬜ | aucun code | |
| BL-100 | Retour haptique léger pendant le déplacement d'un onglet | HC 20498377604887 ; binaire « Haptic feedback when reordering tabs » | ⬜ | aucun code | Voir SON |
| BL-101 | Les lignes voisines s'écartent pendant le glisser | non vérifié | ✅ | `SH:measure`, `SH:part` ; ui 17 (9 vérifications, dont 404 lignes) | Place libre teintée à la place du trait ; la ligne emportée laisse la sienne ; « Réduire les animations » respecté. Le trait vertical reste dans la grille des favoris |
| BL-102 | Réordonner les Espaces en glissant leur icône | binaire « Drag to Reorder Space » | ⬜ | aucun code | |
| BL-103 | Message « Tab moved! Click to go there. » après un déplacement | binaire | ⬜ | aucun code | |

### Menus contextuels de la barre

| Id | Ce que fait Arc | Preuve Arc | État | Preuve Orbe | Note |
| --- | --- | --- | --- | --- | --- |
| BL-110 | Onglet : Copy Link | binaire ; HC 20498417809815 | 🟡 | W:tabMenu ; aucun test du menu | |
| BL-111 | Onglet : Copy link as Markdown | binaire | ⬜ | absent du menu (commande ⌥⇧⌘C existe) | |
| BL-112 | Onglet : Duplicate | HC 19231060187159 | 🟡 | W:duplicate ; aucun test | |
| BL-113 | Onglet : Rename | HC 19231060187159 | ✅ | ui 03 | |
| BL-114 | Onglet : Change Icon | HC 20498417809815 | ⬜ | | |
| BL-115 | Onglet : Mute / Unmute | binaire | 🟡 | W:toggleMute ; aucun test | |
| BL-116 | Onglet : Move to (favoris, Espaces, dossiers) | HC 19230755904151 | 🟡 | vers un Espace (self) et favoris ; pas vers un dossier | |
| BL-117 | Onglet : Pin / Unpin | binaire | ✅ | self ⌘D | |
| BL-118 | Onglet : Open in Split View | binaire | 🟡 | W:tabMenu | |
| BL-119 | Onglet : Archive this tab | binaire | ✅ | self ⌘W | |
| BL-120 | Onglet : Archive Tabs Below | binaire | 🟡 | présent ; aucun test | |
| BL-121 | Onglet : Archive Tabs Above | binaire | ⬜ | | |
| BL-122 | Onglet : Archive Other Tabs | binaire | ⬜ | | |
| BL-123 | Onglet : New Folder with… (sélection) | binaire | ✅ | `W:tabsMenu` ; ui 16 « menu de la sélection : Nouveau dossier avec la sélection » | |
| BL-124 | Onglet : Share | HC 19228534606743 | ➖ | | Demande un serveur de partage |
| BL-125 | Épinglé : Edit Pinned Page → Replace Pinned URL with Current, Edit… | HC 25541939922199 ; binaire | ⬜ | | Simple : `homeUrl = url` |
| BL-126 | Épinglé : Close and Keep Pinned | binaire | 🟡 | ⌘W le fait (self) ; pas d'entrée de menu | |
| BL-127 | Vue scindée : Separate All Tabs, muet par onglet, Duplicate | HC 19335393146775 | ⬜ | | |
| BL-128 | Dossier : Rename | HC 19228419623447 | ✅ | ui 05 | |
| BL-129 | Dossier : Delete | HC 19228419623447 | ✅ | self « dossier supprimé » | |
| BL-130 | Dossier : Duplicate, Change Icon, Copy All Links, Copy All Links as Markdown, New Nested Folder, Paste URL as New Tab, Close This Folder | HC 20498377604887 ; binaire | ⬜ | | |
| BL-131 | Espace : Rename, Edit Theme Color, Change Space Icon, Profile, Delete | HC 19228534606743 ; binaire | 🟡 | W:spaceMenu (renommer, thème, supprimer) ; aucun test du menu | Icône et profil à ajouter ici |
| BL-132 | Espace : Show/Hide Space Header, Manage Spaces, Export | binaire | ⬜ | | |
| BL-133 | Zone vide : thème, profil | HC 19228064149143 | 🟡 | W:sidebarMenu | |
| BL-134 | Favori : Show Unread Badge, Show Hover Preview | binaire | ⬜ | | |

## CMD — Barre de commande

| Id | Ce que fait Arc | Preuve Arc | État | Preuve Orbe | Note |
| --- | --- | --- | --- | --- | --- |
| CMD-1 | ⌘T ouvre la barre, sans créer d'onglet tant que rien n'est validé | HC 20595231349911 ; menu | ✅ | W:openCommand ; self ; ui 01 | |
| CMD-2 | ⌘L modifie l'adresse de l'onglet actif | menu ; HC 20498377604887 | ✅ | self « ⌘L remplace l'adresse… » | |
| CMD-3 | Le même raccourci referme la barre | M-12 | ✅ | ui 01 ; nat | |
| CMD-4 | Largeur d'environ 763 pt, centrée sur la fenêtre | M-6 | ✅ | 680 px (OC) | Fait le 8 oct. (cotes et durées d'Arc) |
| CMD-5 | Bord haut à un tiers de la hauteur | M-7 | ✅ | 19 vh | Fait le 8 oct. (cotes et durées d'Arc) |
| CMD-6 | Lignes de 46 pt | M-8 | ✅ | 42 px | Fait le 8 oct. (cotes et durées d'Arc) |
| CMD-7 | Pas d'assombrissement derrière, grande ombre | M-9 | 🟡 | non vérifié côté Orbe | Comparer à l'œil |
| CMD-8 | Sélection en aplat de couleur, texte blanc | M-10 | ✅ | OC:41-56 ; ui 01 | |
| CMD-9 | Elle prend les couleurs de l'Espace | HC 20498417809815 | 🟡 | fond neutre `--panel` | |
| CMD-10 | Nouvelle fenêtre : la barre s'ouvre seule | M-11 | 🟡 | écran vide « Appuie sur ⌘T » | À décider |
| CMD-11 | Sources : onglets ouverts de tous les Espaces, historique, archive, épinglés, suggestions du moteur, actions | howtogeek | ✅ | SU ; self (historique, actions, bascule) | |
| CMD-12 | Ligne « Switch to Tab », y compris vers une vue scindée | HC 20498417809815 ; binaire « Switch to Split View » | ✅ | self « Basculer vers l'onglet » | Mention de vue scindée absente |
| CMD-13 | ⇥ juste après ⌘T : cherche seulement dans les actions | HC 20498293324823 | ⬜ | ⇥ = suivant | |
| CMD-14 | Recherche dans un site : raccourci du site, ⇥ ou espace, requête | HC 20855018192791 ; binaire | ⬜ | | |
| CMD-15 | Survol d'une suggestion : croix pour la supprimer ; ⌥⌘⌫ au clavier | HC 20498377604887 ; binaire « Delete Suggestion » | ⬜ | | |
| CMD-16 | ⌘L puis Entrée sans rien changer : recharge | HC 20498293324823 | 🟡 | non vérifié | |
| CMD-17 | La barre latérale reste cliquable quand la barre est ouverte | HC 20498293324823 | 🟡 | clic sur le fond ferme la barre | |
| CMD-18 | Complétion de l'adresse dans le champ | observé (habituel) | ✅ | OV:query ; ui 01 | |
| CMD-19 | Dédoublonnage par titre et site pour certains domaines (Figma, Notion, GitHub…) | binaire `command_bar_behavior.json` | ⬜ | | |
| CMD-20 | Taper le nom d'une extension la déclenche | HC 19434259167767 | ⬜ | | |
| CMD-21 | Taper le nom d'un Espace : « Focus on <space> » | binaire | ⬜ | | |
| CMD-22 | Taper le nom d'un dossier : l'ouvre | HC 20498417809815 | ⬜ | | |
| CMD-23 | État vide : suggestions d'aide (Contact the Team, The Browser Company, Air Traffic Control, Tips for Organizing, Help Center) | mesuré (capture) | 🟡 | 6 onglets récents | Choix différent, défendable |
| CMD-24 | Message de confidentialité des suggestions de recherche | binaire | ⬜ | | Peu utile |
| CMD-25 | ⌘Entrée : ouvre en arrière-plan | non vérifié | ✅ | ui 01 | |
| CMD-26 | ⇧Entrée : ouvre directement le premier résultat (Instant Links) | HC 20498293324823 | ➖ | | Fonction d'IA, écartée |
| CMD-27 | ChatGPT dans la barre (⌥⌘G) | HC 19335160678679 | ➖ | | Fonction d'IA, écartée |
| CMD-28 | Copier depuis la barre ajoute https | HC 20498417809815 | ⬜ | | |

Actions de la barre de commande relevées dans Arc (libellés du binaire et du centre d'aide). État : ✅ si Orbe propose l'action (test self « la barre de commande propose des actions »), ⬜ sinon.

| Id | Action d'Arc | État | Note |
| --- | --- | --- | --- |
| CMD-40 | Pin Tab / Unpin | ✅ | |
| CMD-41 | Reset Tab (retour à l'adresse épinglée) | 🟡 | W:resetPinned existe ; présence dans la palette à vérifier |
| CMD-42 | Replace Pin with Current Page | ⬜ | |
| CMD-43 | Duplicate Current Tab | 🟡 | |
| CMD-44 | Rename Current Tab | 🟡 | |
| CMD-45 | Move to Favorites / Remove from Favorites | 🟡 | |
| CMD-46 | Move to Today in <Espace> / Move to Pinned in <Espace> | ⬜ | |
| CMD-47 | New Folder ; Expand All Folders ; Collapse All Folders | 🟡 | Nouveau dossier seulement |
| CMD-48 | Collapse Pinned / Expand Pinned | ⬜ | |
| CMD-49 | New Space ; Manage Spaces ; Focus on <Espace> | 🟡 | Nouvel Espace seulement |
| CMD-50 | Add Split View ; Add Right/Left/Top/Bottom Split | 🟡 | Sans choix du côté |
| CMD-51 | Convert to Horizontal/Vertical Split View | ✅ | self « vue scindée empilée » |
| CMD-52 | New Window ; New Blank Window ; New Incognito Window ; Open Little Arc | 🟡 | Pas de fenêtre vierge |
| CMD-53 | View Archive ; Clear Archive ; Open Library ; View Downloads | 🟡 | « Vider l'archive » n'est pas proposé dans la barre (`palette: false`) |
| CMD-54 | Capture ; Capture Full Page ; Capture in Portrait Mode | 🟡 | Pas de mode portrait |
| CMD-55 | New Easel ; New Note ; New Note (in Split) | 🟡 | Pas de note en vue scindée |
| CMD-56 | New Boost ; View Boosts | 🟡 | |
| CMD-57 | Turn on Developer Mode for this site | ⬜ | |
| CMD-58 | Settings ; Link Preferences ; Edit Keyboard Shortcuts ; Air Traffic Control ; Manage Passwords | 🟡 | Réglages et mots de passe |
| CMD-59 | Add Extension ; Manage Extensions | 🟡 | |
| CMD-60 | Mute all tabs / Unmute all tabs | ⬜ | |
| CMD-61 | Toggle Sidebar ; Show Toolbar ; Theme | ✅ | |
| CMD-62 | Copy URL ; Copy URL as Markdown ; Paste URL as New Tab | 🟡 | Pas de « coller comme onglet » (⌥⌘V) |
| CMD-63 | Help Center ; Contact the Team ; What's new ; Getting Started | ⬜ | |
| CMD-64 | New Google Doc, New Linear Issue, New Google Meet, etc. | ➖ | Raccourcis vers des services tiers |

## ESP — Espaces et profils

| Id | Ce que fait Arc | Preuve Arc | État | Preuve Orbe | Note |
| --- | --- | --- | --- | --- | --- |
| ESP-1 | Un Espace a ses épinglés, ses onglets du jour, son thème, son icône | HC 19228064149143 | ✅ | self « nouvel Espace créé et affiché » | |
| ESP-2 | Création par le « + » : nom, icône, profil, thème, puis « Create Space » | HC 19228064149143 ; binaire `ARC_SpaceCreation` | 🟡 | création directe puis renommage ; ui 06 | Pas d'écran de création |
| ESP-3 | Le nouvel Espace se place à côté de l'Espace actif | HC 20498377604887 | 🟡 | non vérifié | |
| ESP-4 | Changer d'Espace : clic sur l'icône du bas | HC 19228064149143 | ✅ | ui 06 | |
| ESP-5 | Balayage horizontal à deux doigts sur la barre | HC 19228064149143 ; binaire `space_swiping.mp4` | ✅ | SH:378-383 (seuil 70 px) ; ui 06 | Voir GES-1 |
| ESP-6 | ⌃1 … ⌃9 | menu | ✅ | self « ⌃2 va au deuxième Espace » ; nat | |
| ESP-7 | ⌥⌘→ / ⌥⌘← | menu | ✅ | self ; nat | |
| ESP-8 | Boutons 3 et 4 de la souris | HC 20498417809815 | ⬜ | | `app-command` ou `mouseup` bouton 3/4 |
| ESP-9 | Le contenu de la barre glisse d'un Espace à l'autre, avec transition de l'icône | HC 20498377604887 | ✅ | fondu-glissé de 36 px sur 220 ms (SC:103-106) | deux listes côte à côte qui suivent le doigt, teinte fondue, ressort (SH PAGER) ; l'icône grossit dans sa pastille ; self ; ui 06. Durées à régler face à Arc |
| ESP-10 | Au-delà du dernier Espace : résistance élastique, puis création d'un Espace | inverse | ⬜ | | |
| ESP-11 | Revenir dans un Espace réactive son dernier onglet | HC 20498377604887 | ✅ | W:210 ; self « ⌥⌘← revient… avec son onglet » | |
| ESP-12 | Renommer : clic sur le titre, ou menu Spaces → Rename Space | HC 20498377604887 ; menu | ✅ | ui 03 | |
| ESP-13 | Icône : sélecteur d'émojis avec recherche et teintes de peau | HC 20498293324823 ; binaire `ARC_Emojis` | 🟡 | icône émoji (choix limité) | |
| ESP-14 | Supprimer : confirmation qui nomme l'Espace ; « This will archive all the tabs and folders inside it. » | HC 20498377604887 ; binaire | 🟡 | W:deleteSpace ; aucun test | |
| ESP-15 | ⌘Z annule la suppression ou la création d'un Espace | binaire (« Undo/Redo prompt for deleting a space ») | ✅ | `W:removeSpace` ; self « ⌘Z rétablit l’Espace : même rang, épinglés, dossier, onglets du jour, thème », « ⌘Z défait la création d’un Espace » ; ui 18 | Les pages de l’Espace rétabli se rechargent à la demande ; pas de message « Undo/Redo » à l’écran, seulement le menu |
| ESP-16 | Réordonner les Espaces | binaire « Drag to Reorder Space » | ⬜ | | |
| ESP-17 | Gestionnaire d'Espaces (Manage Spaces…) dans la Bibliothèque | menu ; HC 20498377604887 | ⬜ | | |
| ESP-18 | Masquer l'en-tête de l'Espace | binaire « Hide Space Header » | ⬜ | | |
| ESP-19 | Message à la création d'un Espace | HC 20498417809815 | ⬜ | | |
| ESP-20 | Profil : identifiants, historique, cookies, favoris, extensions et délai d'archivage séparés | HC 19227964556183 | ✅ | self « le profil a sa propre session » | Extensions et délai par profil à vérifier |
| ESP-21 | Attribuer un profil à un Espace | menu « Change Profile » | ✅ | self « nouveau profil attribué à l'Espace » | |
| ESP-22 | File → New Profile | menu | ✅ | M | |
| ESP-23 | Supprimer un profil seulement s'il n'est lié à aucun Espace ; le profil par défaut ne se supprime pas | binaire | 🟡 | Réglages ; self « les réglages listent les profils » | Suppression non testée |
| ESP-24 | Pastille de profil dans les menus | binaire « profile indicator » | ⬜ | | |

## ONG — Vie des onglets

| Id | Ce que fait Arc | Preuve Arc | État | Preuve Orbe | Note |
| --- | --- | --- | --- | --- | --- |
| ONG-1 | ⌘W archive l'onglet (« Archive Tab ») | menu | ✅ | self | |
| ONG-2 | ⌘W sur un épinglé : le décharge, il reste dans la barre | non vérifié (comportement connu) | ✅ | self « ⌘W sur un onglet épinglé le met en veille » | |
| ONG-3 | ⇧⌘T rouvre le dernier onglet fermé, avec son historique | menu ; HC 20498377604887 | 🟡 | self ; ui 02 ; même identifiant et même rang (`W:restoreClosed`) ; l’historique de navigation de l’onglet n’est pas rendu | |
| ONG-4 | ⌘Z annule les actions de la barre : déplacement, personnalisation, effacement, fermeture d’onglet ou d’aperçu | HC 20498377604887 ; menu « Annuler Close Peek » | ✅ | `W:record`, `W:replay`, `C:undo` ; self « ⌘Z défait toute la suite, état pour état » ; ui 18 | Pile de 50 actions par fenêtre, jamais enregistrée : archiver, déplacer (liste, dossier, rang), épingler, favoris, renommer, Effacer, dossiers, Espaces, aperçu. Hors pile : nouvel onglet, dupliquer, thème, vue scindée. Dans un champ de texte, ⌘Z reste l’annulation du texte |
| ONG-5 | ⇧⌘Z rétablit | menu | ✅ | `W:replay` ; self « ⇧⌘Z refait toute la suite, état pour état » ; ui 18 | |
| ONG-6 | Archivage automatique après 12 h par défaut ; 12 h, 24 h, 7 jours, 30 jours | HC 19228855311127 ; warren ; binaire « Archive tabs after » | 🟡 | W:archiveStale (mêmes valeurs, plus « jamais ») ; aucun test | Écrire un test |
| ONG-7 | Délai réglable par profil | HC 19228855311127 | ⬜ | réglage global | |
| ONG-8 | Voir ou cliquer un onglet remet son délai à zéro | HC 19228855311127 | 🟡 | `lastUsed` | |
| ONG-9 | Un onglet qui joue un média n'est ni effacé ni archivé | HC 20498417809815 | 🟡 | épargne les onglets audibles | |
| ONG-10 | Bandeau unique expliquant l'archivage automatique | HC 20498293324823 ; binaire | ⬜ | | |
| ONG-11 | ⇧⌘K efface les onglets du jour, avec une animation propre | menu ; HC 20498377604887 | 🟡 | self ; sans animation dédiée ; ⌘Z rétablit tout (ui 18) | Voir ANI-14 |
| ONG-12 | « Reset all tabs in this Space » | menu | ⬜ | | |
| ONG-13 | ⌃⇥ : sélecteur des onglets récents, comme ⌘⇥ | binaire ; HC 25619402657303 | ✅ | SH `#switcher` ; nat (`ctrltab.swift`) | Arc montre 5 onglets, Orbe 8 |
| ONG-14 | Dans le sélecteur, ⌃ maintenu + W ferme l'onglet désigné | HC 25619402657303 | ⬜ | | |
| ONG-15 | ⌥⌘↓ / ⌥⌘↑ | menu | ✅ | self ; nat | |
| ONG-16 | ⌘1 … ⌘8, ⌘9 = neuvième ou dernier, favoris inclus ou non (réglage) | binaire ; HC 25619402657303 | 🟡 | self « ⌘2 active le deuxième onglet » ; pas de réglage | |
| ONG-17 | Onglets en arrière-plan suspendus ; pas ceux qui utilisent le micro | HC 20498293324823 | ✅ | W:trimLive + hooks.busy ; self « mise en veille au-delà de la limite », « un onglet qui capte n’est pas mis en veille » |  |
| ONG-18 | Certains sites restent vivants (Slack, Gmail, Agenda, Notion, Spotify, WhatsApp…) | binaire `web_content_behavior.json` (`keepaliveAllowList`) | ⬜ | | Reprendre la liste |
| ONG-19 | Favoris chargés seulement s'ils ont servi récemment | HC 20498377604887 | 🟡 | chargés au clic | |
| ONG-20 | Un onglet n'existe qu'en un exemplaire entre les fenêtres (« Tab Handoff ») | HC 20498377604887 | ✅ | self « un onglet n'est actif que dans une seule fenêtre » | |
| ONG-21 | Les fenêtres d'un même Espace montrent les mêmes onglets | HC 25590417429783 | 🟡 | à vérifier | |
| ONG-22 | Session restaurée au redémarrage | HC 20498293324823 ; binaire | ✅ | self « état enregistré sur disque » | Une seule fenêtre mémorisée |
| ONG-23 | Page « onglet planté » | HC 20498377604887 ; binaire `ARC_SadTab` | ⬜ | rechargé à l'activation | |
| ONG-24 | Mode économie de batterie sous 20 % | HC 20498377604887 | ⬜ | | |
| ONG-25 | ⌥⌘V : colle l'adresse du presse-papiers dans un nouvel onglet | HC 20498377604887 | ⬜ | | |
| ONG-26 | « Reveal Tab in Sidebar » | menu | ⬜ | | |
| ONG-27 | Lien ouvert en arrière-plan : message « New Tab Created » si la barre est masquée | HC 20498417809815 | ⬜ | | |
| ONG-28 | Titres d'onglets raccourcis automatiquement à l'épinglage | HC 19335160678679 | ➖ | | Fonction d'IA, écartée |
| ONG-29 | Rangement automatique des onglets (« Tidy Tabs ») | allthings | ➖ | | Fonction d'IA, écartée |

## SCI — Vue scindée

| Id | Ce que fait Arc | Preuve Arc | État | Preuve Orbe | Note |
| --- | --- | --- | --- | --- | --- |
| SCI-1 | Jusqu'à 4 pages | HC 20498417809815 | ✅ | W:splitWith ; self | |
| SCI-2 | ⌃⇧= ajoute un volet, avec la barre de commande dedans | menu ; M-13 | ✅ | self ; nat | |
| SCI-3 | ⌃⇧- ferme le volet actif | menu ; M-14 | ✅ | self ; nat | |
| SCI-4 | Côte à côte ou empilée ; bascule depuis le bouton du volet | HC 20498377604887 | ✅ | self « vue scindée empilée », « retour côte à côte » | Pas de bouton sur le volet |
| SCI-5 | Chaque volet a une petite barre en haut (adresse, fermer, options) | M-13 ; binaire « Split View Controls Menu » | ⬜ | | Manque visible |
| SCI-6 | ⌥clic sur un onglet ou un lien : l'ouvre en vue scindée | HC 20498293324823 | ⬜ | | |
| SCI-7 | Séparateur déplaçable | HC 19335393146775 | ✅ | self « la séparation se déplace à la souris » | |
| SCI-8 | Tailles conservées | non vérifié | 🟡 | perdues au redémarrage d'après la lecture du code | À corriger et tester |
| SCI-9 | ⌃⇧1 … 4 : aller au volet | binaire ; hongkiat | ✅ | nat | |
| SCI-10 | Volet suivant / précédent | binaire | ⬜ | | |
| SCI-11 | Le volet actif se distingue | non vérifié | ⬜ | aucun repère | Liseré discret |
| SCI-12 | La vue scindée est un seul élément dans la barre, épinglable, renommable, déplaçable | HC 20498417809815 | 🟡 | une ligne par groupe (ui 12) | Épingler le groupe non vérifié |
| SCI-13 | « Separate Page from Split View », « Separate All Tabs » | menu ; binaire | 🟡 | ⌃⇧- seulement | |
| SCI-14 | « Expand Current Split » | menu | ⬜ | | |
| SCI-15 | Vue scindée enregistrée avec l'Espace | non vérifié | ✅ | self | |
| SCI-16 | ⌘L change l'adresse du volet actif | HC 19335393146775 | 🟡 | non testé | |
| SCI-17 | Pendant le glisser : zone de dépôt aux couleurs du thème, l'onglet devient une bulle, petit rebond au dépôt | inverse | 🟡 | zone en pointillés, sans bulle ni rebond | Voir ANI-12 |
| SCI-18 | Messages affichés au-dessus du volet concerné | HC 20498293324823 | ⬜ | | |

## APE — Aperçu (Peek)

| Id | Ce que fait Arc | Preuve Arc | État | Preuve Orbe | Note |
| --- | --- | --- | --- | --- | --- |
| APE-1 | Depuis un épinglé ou un favori, un lien vers un autre site s'ouvre en aperçu | HC 19335302900887 ; binaire | ✅ | self (deux vérifications) | |
| APE-2 | ⇧clic sur n'importe quel lien : aperçu | HC 20498377604887 ; binaire | 🟡 | code présent ; aucun test | |
| APE-3 | Deux réglages distincts pour ces deux déclencheurs | binaire | 🟡 | un seul (`peekLinks`) | |
| APE-4 | Boutons à côté : fermer, ouvrir en onglet (⌘O), ouvrir en vue scindée | HC 19335302900887 | ✅ | self « ⌘O transforme l'aperçu en onglet sans recharger » | |
| APE-5 | Fermer : clic à l'extérieur, croix, ⌘W, Échap | HC 20498377604887 | ✅ | self « ⌘W ferme l'aperçu… » | |
| APE-6 | Geste de fermeture interactif | HC 20498377604887 | ⬜ | | |
| APE-7 | ⌘Z ou ⇧⌘T rouvre un aperçu fermé | HC 20498377604887 ; menu « Annuler Close Peek » | ✅ | `W:dismissPeek` ; self « ⌘Z rouvre l’aperçu fermé », « ⇧⌘T rouvre aussi un aperçu fermé » ; ui 18 | La page de l’aperçu est rechargée (son défilement et ses saisies ne sont pas rendus) |
| APE-8 | Animation d'ouverture et de fermeture | HC 20498417809815 (existence) ; durée non mesurée | ✅ | fondu du voile seul, la page apparaît d'un coup | la carte grandit depuis le lien (200 ms), se réduit à la fermeture (150 ms) ; self ; ui 16. Durées d'Arc non mesurées |
| APE-9 | La barre d'outils s'affiche aussi dans l'aperçu | HC 20498293324823 | ⬜ | | |
| APE-10 | Les liens de réunion s'ouvrent en onglet, pas en aperçu | HC 20498377604887 | ⬜ | | |
| APE-11 | L'aperçu respecte les règles d'aiguillage | HC 20498293324823 | 🟡 | non vérifié | |
| APE-12 | Tableaux et notes ouverts depuis la Bibliothèque : en aperçu | HC 20498377604887 | ⬜ | ouverts en onglet | |

## PET — Petite fenêtre (Little Arc)

| Id | Ce que fait Arc | Preuve Arc | État | Preuve Orbe | Note |
| --- | --- | --- | --- | --- | --- |
| PET-1 | ⌥⌘N ouvre une petite fenêtre sans barre latérale | menu ; HC 19235387524503 | ✅ | self | |
| PET-2 | Les liens venus d'autres applications s'y ouvrent (par défaut) | HC 19235387524503 ; binaire | 🟡 | MA:openUrl selon réglage ; défaut à vérifier | |
| PET-3 | ⌥⌘clic sur un lien ou un onglet | slashgear ; binaire | ⬜ | menu contextuel seulement | |
| PET-4 | Bouton « Open In » ; ⌘O vers l'Espace le plus récent ; ⌥⌘O pour choisir | HC 19235387524503 | ✅ | self « Ouvrir dans Orbe crée un onglet » | |
| PET-5 | Recherche d'Espace dans le menu « Open In » | binaire « Search Spaces » | ⬜ | | |
| PET-6 | Plusieurs petites fenêtres ; le même lien externe refocalise celle qui existe | HC 20498377604887 | 🟡 | non vérifié | |
| PET-7 | Fermées d'office après 6 h ; elles vont dans l'archive, filtre « Little Arc » | HC 19235387524503 ; binaire | ⬜ | | |
| PET-8 | Flotte au-dessus du plein écran, s'ouvre sur le bureau courant | HC 20498377604887 | 🟡 | non vérifié | |
| PET-9 | Extensions disponibles ; bouton de copie du lien | binaire (infobulles) | ⬜ | | |
| PET-10 | Menu du Dock : afficher/masquer toutes les petites fenêtres, nouvelle fenêtre privée | HC 20498377604887 | ⬜ | | `app.dock.setMenu` |
| PET-11 | Retient le profil choisi pour un domaine | HC 20498377604887 | ⬜ | | |
| PET-12 | Taille mémorisée | binaire (préférence `LittleBrowserWindow_size`) | 🟡 | 860 × 640 fixes | |
| PET-13 | Animation d'ouverture | HC 20498417809815 | ⬜ | | |
| PET-14 | Première fois : bulle d'explication | binaire | ⬜ | | |
| PET-15 | Aiguillage : règle « contient » ou « est égal à » → Espace ; défaut Little Arc, Espace le plus récent ou un Espace précis | HC 22932014625431 | ✅ | self « aiguillage : le lien s'ouvre dans l'Espace de la règle » | « est égal à » absent |
| PET-16 | Les liens Google Meet vont dans l'Espace le plus récent | HC 20498377604887 | ⬜ | | |

## THM — Thèmes et apparence

| Id | Ce que fait Arc | Preuve Arc | État | Preuve Orbe | Note |
| --- | --- | --- | --- | --- | --- |
| THM-1 | Apparence Automatic / Light / Dark, commune à tous les Espaces ; libellé « Websites, Easels, and Notes will use: » | menu ; HC 19228064149143 | ✅ | MA:applyAppearance ; self « le thème clair s'applique » | |
| THM-2 | Dans le sélecteur de thème : trois boutons animés (étoiles, soleil, lune) | binaire `automatic.json`, `sun.json`, `moon.json` (Lottie) | ⬜ | menu et réglages seulement | Les mettre dans le panneau de thème |
| THM-3 | Couleurs choisies en déplaçant des points sur un nuancier, « + » et « − » pour ajouter ou retirer une couleur | HC 25625261733143 | 🟡 | 12 couleurs + curseur de teinte | Nuancier à deux dimensions |
| THM-4 | Jusqu'à trois couleurs en dégradé | slashgear ; variables `--arc-background-gradient-color0/1/2` (HC 19212718608151) | 🟡 | deux couleurs ; self « thème d'Espace en dégradé avec grain » | Troisième couleur |
| THM-5 | Retirer toutes les couleurs rend le thème par défaut | HC 25625261733143 | ⬜ | | |
| THM-6 | Palettes prêtes : 9 pastel, 9 ternes, 9 gris | binaire `ColorPickerPastel1-9`, `ColorPickerDrab1-9`, `ColorPickerGreyscale1-9` | 🟡 | 12 couleurs vives | Reprendre les trois familles (teintes exactes non relevées) |
| THM-7 | Réglage d'intensité | HC 20498417809815 | ⬜ | | Curseur sur le taux de mélange (18 % / 24 % aujourd'hui) |
| THM-8 | Réglage de grain par une molette | HC 20498417809815 ; binaire `GrainKnob` | ✅ | SC:368-376 ; self | Molette au lieu d'un curseur : à voir |
| THM-9 | Quatre textures : grain, sable, tweed, denim | binaire `GrainKnob`, `SandKnob`, `TweedKnob`, `DenimKnob` ; images `grain`, `sand`, `tweed`, `denim` | 🟡 | une seule (bruit fractal SVG) | Trois textures à ajouter ; le rendu exact d'Arc reste à observer |
| THM-10 | Fond de fenêtre rendu par un shader (Metal) | binaire `ARC_WindowThemeUI/default.metallib` | 🟡 | dégradé CSS + bruit SVG | Suffisant si le rendu est comparé à l'œil |
| THM-11 | Retour haptique en tournant les molettes du thème | inverse ; HC 20498377604887 | ⬜ | | Voir SON-6 |
| THM-12 | Les couleurs du thème gagnent menus, champs, barre de commande, sélecteur d'onglets, messages | HC 20498417809815 | 🟡 | barre latérale et sélection | Étendre à la barre de commande et aux messages |
| THM-13 | Barre latérale translucide sur le bureau | non vérifié (mesure faite en thème sombre opaque) | 🟡 | réglage `translucent`, effet `sidebar` ; aucun test | |
| THM-14 | Fenêtre privée noire | observé | ✅ | W:105-112 | |
| THM-15 | Barre d'outils teintée par la couleur de la page | HC 20498293324823 ; binaire `TopBarColorCache` | ⬜ | | |
| THM-16 | Le redimensionnement de la fenêtre utilise la couleur de fond de la page | HC 20498293324823 | ⬜ | fond blanc fixe | `setBackgroundColor` d'après la page |
| THM-17 | Les sites peuvent lire les couleurs du thème (variables CSS `--arc-palette-*`), réglage « Allow websites to get your theme data » | binaire ; HC 19212718608151 | ⬜ | | Injecter `--orbe-palette-*` |
| THM-18 | Icône de l'application au choix (colorful, schoolbook, neon, hologram, fluted glass, candy, original) | binaire ; HC 20498293324823 | ⬜ | | Faible priorité |
| THM-19 | Polices embarquées pour l'interface et les Boosts (Inter, Nunito, Marlin Soft, ABC Favorit, Söhne, etc.) | binaire `ARCClients_FontsManager` | ➖ | police du système | Polices sous licence, non reprises |
| THM-20 | Ouvrir le thème : menu Spaces → Edit Theme…, clic droit dans la barre, commande « Theme » | menu ; HC 19228064149143 | ✅ | M, W:sidebarMenu | Panneau lui-même sans test d'interface |

## ANI — Animations et mouvement

Chiffres d'Arc : seuls ANI-1 à ANI-4 ont été mesurés. Pour le reste, l'existence de l'animation est attestée par la documentation, pas sa durée ni sa courbe ; ces lignes demandent un enregistrement d'écran avec le propriétaire avant d'être réglées au chiffre près.

| Id | Ce que fait Arc | Preuve Arc | État | Preuve Orbe | Note |
| --- | --- | --- | --- | --- | --- |
| ANI-1 | Masquer la barre : instantané | M-3 | ✅ | 180 ms | Fait le 8 oct. (cotes et durées d'Arc) |
| ANI-2 | Réafficher la barre : environ 50 ms | M-4 | ✅ | 180 ms | Fait le 8 oct. (cotes et durées d'Arc) |
| ANI-3 | Barre de commande : apparition sans délai perceptible | mesuré (pas d'image intermédiaire à 60 images/s) | ✅ | `pop` 130 ms | Fait le 8 oct. (cotes et durées d'Arc) |
| ANI-4 | Vue scindée : ouverture et fermeture immédiates | M-13, M-14 | ✅ | sans animation ; self | Identique |
| ANI-5 | Miroitement au démarrage | HC 20498417809815 | ⬜ | | |
| ANI-6 | Animation de fenêtre au redémarrage | HC 20498417809815 | ⬜ | | |
| ANI-7 | Boutons plus, fermer, actualiser, précédent, suivant animés | HC 20498417809815 | ⬜ | | Rotation d'actualiser, glissé des flèches |
| ANI-8 | Indicateur de chargement en lueur en haut de la fenêtre | HC 20498377604887 ; binaire (shader) | 🟡 | balayage dans la pastille | |
| ANI-9 | Téléchargement : le fichier « saute » dans l'icône de la Bibliothèque ; plusieurs à la fois | HC 20498377604887 | ⬜ | anneau de progression | |
| ANI-10 | Changement d'Espace : la barre glisse d'un Espace à l'autre en suivant le doigt, l'icône se transforme | HC 20498377604887 ; binaire `space_swiping.mp4` | ✅ | glissé-fondu de 36 px, 220 ms | deux listes côte à côte qui suivent le doigt, teinte fondue, ressort (SH PAGER) ; l'icône grossit dans sa pastille ; self ; ui 06. Durées à régler face à Arc |
| ANI-11 | Aperçu : ouverture et fermeture animées, fermeture interactive | HC 20498417809815, 20498377604887 | 🟡 | la carte grandit depuis le lien (200 ms), se réduit à la fermeture (150 ms), s'étend pour ⌘O (220 ms) ; self, ui 16 | Reste la fermeture interactive (tirer la carte) ; durées d'Arc non mesurées |
| ANI-12 | Glisser vers une vue scindée : l'onglet devient une bulle, rebond au dépôt | inverse | ⬜ | | |
| ANI-13 | Dépôt dans un dossier animé | HC 20498377604887 | ⬜ | | |
| ANI-14 | Effacement des onglets du jour animé | HC 20498377604887 | 🟡 | `row-out` 150 ms par ligne | Cascade |
| ANI-15 | Messages (toasts) animés, aux couleurs du thème | HC 20498293324823 | 🟡 | entrée au ressort (`--spring-bouncy`), sortie de 180 ms ; pilule sombre | Restent les couleurs du thème |
| ANI-16 | Petite fenêtre : animation d'ouverture | HC 20498417809815 | ⬜ | | |
| ANI-17 | Passage en plein écran simplifié | HC 20498417809815 | 🟡 | natif | |
| ANI-18 | Image dans l'image : élastique sous la taille minimale, lancer vers un coin | inverse ; HC 20498417809815 | ⬜ | fenêtre native de Chromium | |
| ANI-19 | Le lecteur audio rejoint la position de l'image dans l'image en s'animant | HC 20498377604887 | ⬜ | | |
| ANI-20 | Pastille d'état du lien : s'étend après 1,5 s, s'écarte de la souris | HC 20498377604887 | ⬜ | | |
| ANI-21 | Apparition et retrait d'une ligne d'onglet | non vérifié | ✅ | `row-in` 170 ms, `row-out` 150 ms ; aucun test | entrée au ressort (--spring-snappy, 240 ms), retrait 150 ms ; état pressé : ui 11 |
| ANI-22 | Les lignes s'écartent pendant un glisser | non vérifié | ✅ | ui 17 ; transformations de 140 ms, relevé unique des positions, aucune mise en page pendant le geste | Mesures dans ameliorations.md (PERF-25) |
| ANI-23 | Ouverture d'un dossier : hauteur animée | non vérifié | ⬜ | | |
| ANI-24 | Changement d'onglet : coupe franche | non vérifié | 🟡 | coupe franche | Sans doute identique |
| ANI-25 | Sélecteur ⌃⇥ : apparition | non vérifié | ✅ | sans animation | apparition au ressort (240 ms, échelle 0,96 → 1) ; durée d'Arc non vérifiée |
| ANI-26 | Bandeau de mise à jour : replié, s'ouvre au survol, bouton en dégradé ; cœur animé | HC 21489650267031 ; binaire `update-heart-animation.json` | ⬜ | | |
| ANI-27 | Icônes animées de la Bibliothèque (archive, captures, Espaces, tableaux, téléchargements, Boosts) | binaire `ARC_HomeButton/*.json` (Lottie) | ⬜ | | |
| ANI-28 | Logo animé (vague) et orbe vidéo | binaire `logo-wave.json`, `orb.mp4`, `background.mp4` | ⬜ | | Accueil |
| ANI-29 | « Réduire les animations » du système respecté | non vérifié | ⬜ | aucune règle `prefers-reduced-motion` relevée | À ajouter de toute façon |

## SON — Sons et retour haptique

Arc contient en tout trois fichiers son. Aucun autre son n'existe dans l'application (recherche de tous les fichiers audio du paquet).

| Id | Ce que fait Arc | Preuve Arc | État | Preuve Orbe | Note |
| --- | --- | --- | --- | --- | --- |
| SON-1 | Son de capture : `capture.wav`, 0,63 s, stéréo 48 kHz 24 bits | binaire `ARC_SoundEffects.bundle` | ✅ | aucun son dans Orbe (recherche dans `src/`) | Fait le 8 oct. (zone + choix de l'action, son original, réglage) |
| SON-2 | Son `event.m4a`, 3,52 s, stéréo 44,1 kHz | binaire | ⬜ | | Moment où il joue : non vérifié (probablement un événement d'accueil ou de carte de membre) ; à écouter avec le propriétaire |
| SON-3 | Musique d'accueil `intro-music.mp3`, 21,3 s, pendant la création du compte ; vidéo `demo.mov` | binaire `ARC_AuthFeature` ; inverse | ⬜ | accueil silencieux | Musique originale courte, coupable |
| SON-4 | Réglage « Play Arc sound effects » (Advanced) | binaire ; HC 20498417809815 | ✅ | | Fait le 8 oct. (zone + choix de l'action, son original, réglage) |
| SON-5 | Pas de son pour copier l'adresse, changer d'Espace, fermer un onglet ou finir un téléchargement | binaire (seuls trois fichiers) | ✅ | Orbe est muet aussi | Vérifié par l'absence de fichiers ; un son système reste possible mais non constaté |
| SON-6 | Retour haptique en réordonnant les onglets, réglage « Haptic feedback when reordering tabs » | binaire ; HC 20498293324823, 20498377604887 | ⬜ | | Electron n'expose pas `NSHapticFeedbackManager` : petit module natif à écrire |
| SON-7 | Retour haptique au dépôt d'un glisser-déposer | binaire `dropHapticSubject`, `isDragDropHapticFeedbackEnabled` | ⬜ | | Même module |
| SON-8 | Retour haptique dans le sélecteur de thème | inverse ; HC 20498377604887 | ⬜ | | Même module |
| SON-9 | Retour haptique dans le lecteur vidéo miniature (taille maximale atteinte) | HC 20498377604887 ; binaire `_shouldPerformMaxScaleHaptic` | ⬜ | | Même module |
| SON-10 | Cran haptique en changeant de page | binaire `performsPageDetentHaptics` | ⬜ | | Lié au balayage d'Espace, à confirmer |
| SON-11 | Notifications des sites avec son | binaire `UNAuthorizationOptions.sound` | 🟡 | notifications natives d'Electron ; non testé | |

## GES — Gestes du pavé tactile

Aucun geste n'a été rejoué sur Arc pendant cet inventaire (ils demandent la main du propriétaire). Les lignes viennent de la documentation.

| Id | Ce que fait Arc | Preuve Arc | État | Preuve Orbe | Note |
| --- | --- | --- | --- | --- | --- |
| GES-1 | Balayage horizontal à deux doigts sur la barre : change d'Espace, le contenu suit le doigt | HC 19228064149143 | ✅ | SH `PAGER` : les deux listes suivent le doigt 1 px pour 1 px, seuil 40 % de la largeur (110 px au plus) ou geste vif, retour au ressort ; self ; ui 06 (sept vérifications, molette simulée) | Seuil, vitesse et inertie à régler face à Arc, main sur le pavé |
| GES-2 | Au bout de la liste des Espaces : résistance élastique puis nouvel Espace | inverse | 🟡 | résistance élastique et retour au ressort (SH `PAGER`) ; self, ui 06 | Reste la création d'un Espace en tirant plus loin |
| GES-3 | Balayage à deux doigts sur la page : précédent / suivant | non vérifié (comportement de Chromium) | 🟡 | rien dans le code d'Orbe, comportement d'Electron non testé | Vérifier, puis ajouter la flèche d'indication |
| GES-4 | Pincer pour zoomer la page | non vérifié | 🟡 | défaut d'Electron, non testé | |
| GES-5 | Image dans l'image : pincer pour redimensionner, deux doigts pour déplacer, ⌘défilement pour zoomer, double-clic pour revenir à l'onglet | HC 20498417809815 | ⬜ | fenêtre native | |
| GES-6 | Tableaux : pincer pour zoomer | HC 20498293324823 | 🟡 | zoom 0,1 à 8 à la molette ; pincement non testé | |
| GES-7 | Capture : zoomer et déplacer l'image avant de l'enregistrer | binaire « Zoom and pan to edit your screenshot » | ⬜ | | |
| GES-8 | Lecteur miniature : glisser vers le haut pour chercher précisément | binaire « Drag upwards to seek precisely » | ⬜ | | |
| GES-9 | Défilement élastique des listes de la barre | non vérifié | 🟡 | défilement natif | |

## BIB — Bibliothèque, archive, téléchargements, médias

| Id | Ce que fait Arc | Preuve Arc | État | Preuve Orbe | Note |
| --- | --- | --- | --- | --- | --- |
| BIB-1 | Bibliothèque ouverte par l'icône du bas ou ⇧⌘L | menu ; HC 19230634389911 | ✅ | M ; nat | S'ouvre dans un onglet, pas dans un panneau |
| BIB-2 | Sections : Media, Downloads, Easels & Notes, Spaces, Archived Tabs, Boosts | HC 19230634389911 ; menu Window | 🟡 | Historique, Archive, Téléchargements, Médias, Tableaux | Espaces et Boosts absents |
| BIB-3 | Elle rouvre sur la dernière section utilisée | HC 20498377604887 | ⬜ | | |
| BIB-4 | Survol de l'icône : fichiers récents, à ouvrir ou à glisser dehors | HC 19230634389911 | ⬜ | | Noté dans la feuille de route |
| BIB-5 | Clic droit sur l'icône : types de fichiers affichés (captures, téléchargements, médias) | HC 19230634389911 ; binaire | ⬜ | | |
| BIB-6 | Glisser un fichier hors de la Bibliothèque, même Arc en arrière-plan | HC 20498417809815 | ⬜ | | `webContents.startDrag` |
| BIB-7 | Médias du Bureau, de Documents et de Téléchargements à côté des captures ; filtre « Show media from: » | binaire | ⬜ | téléchargements et captures d'Orbe, en liste | Grille de vignettes |
| BIB-8 | Les vidéos se lisent en aperçu | HC 20498417809815 | ⬜ | | |
| BIB-9 | Supprimer un élément l'envoie à la corbeille | HC 20498293324823 ; binaire « Move to Trash » | 🟡 | à vérifier | |
| BIB-10 | Menu d'un téléchargement : Open, Copy, Show in Finder, Hide from Arc, Move to Trash, Cancel | binaire « Download Context Menu » | 🟡 | Ouvrir, Afficher, Pause, Reprendre, Réessayer, Annuler (downloads.js) ; self « pause depuis la Bibliothèque », « annulation… » ; ui « Bibliothèque : pause, reprise et annulation » | Copier, masquer, corbeille |
| BIB-11 | Envoyer une capture par iMessage ou AirDrop ; ouvrir dans Aperçu | binaire | ⬜ | | Feuille de partage macOS |
| BIB-12 | Regroupement par période (« Earlier This Week »…) | binaire | 🟡 | groupes par jour dans `library.js` ; pas de test du regroupement | |
| BIB-13 | Archive : recherche et filtres (fermé à la main ou d'office, par Espace, Little Arc) | allthings ; binaire « How was the tab closed? », « Where was the tab? » | 🟡 | recherche seule | Enregistrer la cause de fermeture |
| BIB-14 | Restaurer un onglet archivé : il retourne dans son Espace d'origine | HC 20498377604887 | 🟡 | rouvert dans l'Espace courant, l'entrée reste | |
| BIB-15 | Supprimer une entrée d'archive | binaire | ⬜ | | |
| BIB-16 | Clear Archive avec confirmation « This action is permanent. » | binaire ; menu | 🟡 | sans confirmation | |
| BIB-17 | État vide de l'archive : « Nothing here yet! » | binaire | ⬜ | | |
| BIB-18 | View History ⌘Y | menu | ✅ | self | |
| BIB-19 | Emplacement des téléchargements par profil : dossier, « Other… », « Ask every time » | warren ; binaire `arc.promptForDownload` | 🟡 | réglages « Dossier des téléchargements » et « Toujours demander où enregistrer » ; self « dossier des téléchargements choisi dans les réglages », « Toujours demander où enregistrer… » | Réglage commun à tous les profils |
| BIB-20 | Avertissements de sécurité du système sur les fichiers téléchargés | HC 20498377604887 | 🟡 | non vérifié | |
| BIB-21 | « Downloads in progress » à la fermeture | binaire | ⬜ | | |
| BIB-22 | Téléchargements renommés automatiquement | HC 19335160678679 | ➖ | | Fonction d'IA, écartée |
| BIB-23 | Sauvegardes locales de la barre, Help → Restore Data (10 du jour, 1 par jour sur 10 jours…) | HC 25625071960215 ; menu | 🟡 | une copie `.bak` | Historique de sauvegardes |
| BIB-24 | Lecteur audio miniature en bas de la barre en quittant un onglet qui joue ; plusieurs lecteurs empilés ; titre défilant ; croix | HC 19234766331799 | 🟡 | un seul média, lecture/pause et muet ; aucun test | |
| BIB-25 | Lecteur : précédent/suivant (Spotify), ±15 s, volume de l'onglet, micro | binaire | ⬜ | | `navigator.mediaSession` |
| BIB-26 | Touches multimédia du clavier | HC 20498417809815 | 🟡 | défaut de Chromium, non testé | |
| BIB-27 | Image dans l'image automatique en quittant un onglet vidéo ; pas si l'onglet est muet | HC 19234766331799 ; binaire | ✅ | self (deux vérifications) | |
| BIB-28 | Fenêtre d'image dans l'image propre à Arc : retour à l'onglet, fermer, réduire, vitesse, flèches pour chercher, espace pour pause | HC 20498377604887 ; binaire | 🟡 | fenêtre native de Chromium | |
| BIB-29 | Désactivable par site et globalement | HC 25590734716823 | 🟡 | réglage global `autoPip` | |
| BIB-30 | Google Meet : image dans l'image avec commandes de réunion | HC 20498293324823 | ➖ | | Propre à un service |
| BIB-31 | Cast | menu | ⬜ | | Electron ne fournit pas Chromecast ; à écarter sans doute |

## BOO — Boosts

| Id | Ce que fait Arc | Preuve Arc | État | Preuve Orbe | Note |
| --- | --- | --- | --- | --- | --- |
| BOO-1 | Un Boost par domaine, actif dans tous les profils | HC 19212718608151 | ✅ | `boosts.js` ; self « Boost : le CSS du site et le Zap s'appliquent » | |
| BOO-2 | Créer : « + » → New Boost, commande, pinceau du centre de contrôle | HC 19212718608151 | 🟡 | menu Présentation, bouclier, palette | |
| BOO-3 | Nuancier de couleurs à points | HC 19212718608151 | ⬜ | CSS à la main | |
| BOO-4 | Inverser la luminosité ; curseurs Contrast, Brightness, Original Saturation ; remise à zéro | HC 19212718608151 | ⬜ | | Filtres CSS |
| BOO-5 | Polices prêtes (Aa), taille 90 à 150 %, casse | HC 19212718608151 | ⬜ | | |
| BOO-6 | Zap : cliquer un élément pour le retirer ; le rétablir | HC 19212718608151 | ✅ | self | |
| BOO-7 | Éditeur CSS | HC 19212718608151 | ✅ | self « réappliqué à chaque chargement », « retiré quand il est vidé » | |
| BOO-8 | Éditeur JavaScript (désactivé par défaut) | HC 26681118599191 | ⬜ | CSS seulement | Risque de sécurité, à peser |
| BOO-9 | Renommer, « Reset all Edits » | HC 19212718608151 | ⬜ | | |
| BOO-10 | Activer/désactiver depuis le centre de contrôle (pinceau gris) | HC 19212718608151 | 🟡 | case dans l'éditeur | |
| BOO-11 | Liste des Boosts dans la Bibliothèque, suppression | HC 19212718608151 ; menu « View Boosts… » | ⬜ | | |
| BOO-12 | Réglage global « Enable Boosts on websites you visit » | binaire | ⬜ | | |
| BOO-13 | Partage de Boosts | HC 19212718608151 (retiré d'Arc) | ➖ | | Retiré d'Arc lui-même |

## TAB — Tableaux (Easels) et capture

| Id | Ce que fait Arc | Preuve Arc | État | Preuve Orbe | Note |
| --- | --- | --- | --- | --- | --- |
| TAB-1 | New Easel ⌃⇧E | menu | ✅ | self « ⌃⇧E crée un tableau » | |
| TAB-2 | Le tableau s'ouvre comme onglet épinglé de l'Espace | HC 19231142050071 | 🟡 | onglet interne | |
| TAB-3 | Dessin, texte, images, formes | HC 20498293324823 | ✅ | self (rectangle, texte, formes, flèche, image collée) ; `tests/easels.js` | |
| TAB-4 | Guides d'alignement et magnétisme | HC 20498293324823 | ⬜ | | |
| TAB-5 | Correcteur dans le texte | HC 20498293324823 | 🟡 | non vérifié | |
| TAB-6 | Vidéos intégrées depuis une adresse collée | HC 20498293324823 | ⬜ | | |
| TAB-7 | Captures vivantes (lecture/pause, ⌘R les rafraîchit) | HC 20498417809815 | ⬜ | captures figées | Gros morceau |
| TAB-8 | Le lien d'une capture rouvre la page d'origine | binaire `CaptureLinkIconBackground` | ✅ | self | |
| TAB-9 | Texte alternatif d'une image | binaire | ⬜ | | |
| TAB-10 | Annuler / rétablir | binaire | ✅ | self | |
| TAB-11 | Export PNG (« Share Via… »), File → Save As | HC 19231142050071 | ⬜ | | |
| TAB-12 | Partage en lecture ou en édition, collaborateurs, commentaires | HC 19231142050071 ; binaire | ➖ | | Demande un serveur |
| TAB-13 | Liste des tableaux dans la Bibliothèque | menu « View Easels… » | ✅ | self (vignette, réouverture, suppression) | |
| TAB-14 | Capture… ⇧⌘2 : choisir une zone, les éléments de la page sont détectés ; infobulle « Click or drag to capture a portion of this page » ; curseur en appareil photo | menu ; HC 20498417809815 ; binaire | ✅ | ⇧⌘2 capture toute la partie visible ; la zone n'existe que pour « vers un tableau » (self « capture d'une zone choisie à la souris ») | Fait le 8 oct. (zone + choix de l'action, son original, réglage) |
| TAB-15 | Après la capture : envoyer, enregistrer, copier, reprendre, ajouter à un tableau | HC 20498417809815 ; binaire | ✅ | copie + fichier d'office | Fait le 8 oct. (zone + choix de l'action, son original, réglage) |
| TAB-16 | Son à la capture | binaire `capture.wav` | ⬜ | | Voir SON-1 |
| TAB-17 | Capture Full Page (PNG dans le dossier de téléchargement) | menu ; HC 25481392111895 | ✅ | self | |
| TAB-18 | Capture in Portrait Mode (page posée sur un fond) | menu ; HC 20468488031511 | ⬜ | | |
| TAB-19 | Maintenir ⌘⇧ pour lancer une capture (option) | binaire | ⬜ | | |

## NOT — Notes

| Id | Ce que fait Arc | Preuve Arc | État | Preuve Orbe | Note |
| --- | --- | --- | --- | --- | --- |
| NOT-1 | Les notes d'Arc ont été retirées en avril 2024 ; « New Note » ouvre l'application de documents du profil (Notion, Google Docs, Word, Confluence) | HC 22557798824855 | ✅ | Orbe garde des notes locales ; self « ⌃⌘N crée une note » | Orbe fait plus qu'Arc actuel |
| NOT-2 | Raccourci ⌃⇧N d'après les notes de version ; Orbe utilise ⌃⌘N | HC 22557798824855 | 🟡 | M | Divergence à trancher (⌃⌘N est « Blank Window » dans Arc) |
| NOT-3 | Note à côté de la page (en vue scindée) | binaire « Creates a new Note beside your current page » | ⬜ | | |
| NOT-4 | Help → Export Arc Notes | menu | ⬜ | | Export en fichiers texte |
| NOT-5 | Mise en forme (titres 1 à 3, image, lien) | binaire `TextEditor` | 🟡 | texte brut, première ligne en titre | |

## EXT — Extensions et contrôles du site

| Id | Ce que fait Arc | Preuve Arc | État | Preuve Orbe | Note |
| --- | --- | --- | --- | --- | --- |
| EXT-1 | Extensions Chrome installables depuis le Chrome Web Store | HC 19434259167767 | 🟡 | `extensions.js` ; `tests/ext-*.js`, ui 14 (non relancés ici) | Marqué expérimental dans la feuille de route |
| EXT-2 | Menu Extensions : liste, Add Extension…, Manage Extensions… | menu | ⬜ | réglages seulement | Menu dédié |
| EXT-3 | Épingler une extension ; visible dans la pastille au survol ou dans la barre d'outils | HC 19434259167767 | 🟡 | boutons sous la pastille | |
| EXT-4 | ⌘E fait défiler les extensions | HC 19434259167767 | ⬜ | | |
| EXT-5 | Clic droit sur une extension : « Remove from Arc » | HC 19434259167767 | 🟡 | suppression dans les réglages | |
| EXT-6 | Extension qui plante : désactivée avec un message | HC 20498377604887 ; binaire | ⬜ | | |
| EXT-7 | Raccourcis des extensions | binaire « Extension Shortcuts » | 🟡 | à vérifier dans `ext-api.js` | |
| EXT-8 | Centre de contrôle du site : un panneau avec autorisations, mode développeur, aperçus, Boosts, extensions, capture, effacement du cache et des cookies | HC 19434259167767 | 🟡 | menu natif du bouclier (W:shieldMenu) | Vrai panneau |
| EXT-9 | Demande d'autorisation dans une bulle : « Allow %@ to access your %@? », « Click the lock to change this any time » | binaire `PermissionRequestPopoverView` | 🟡 | feuille d’Orbe posée sur l’onglet (sheets.js), pas une boîte native ; self « caméra : la question est une feuille d’Orbe… » ; ui « demande d’autorisation : feuille sur l’onglet » | Feuille centrée sur la page, pas une bulle ancrée au cadenas |
| EXT-10 | Autorisations : notifications, stockage, téléchargements multiples, détection d'inactivité, `mailto:` | binaire | 🟡 | caméra, micro (séparés, avec l’accord du système), position, notifications, MIDI, presse-papiers, fenêtres surgissantes, liens `mailto:` et autres applications ; vue par site avec réinitialisation ; self « informations du site : autorisations accordées et refusées » | Stockage, téléchargements multiples, détection d’inactivité |
| EXT-11 | Partage d'écran | binaire (« tab is being screen-shared ») | ✅ | sélecteur d’Orbe : cet onglet, écrans, fenêtres, vignettes, son (display-media.js) ; self « sélecteur : « Cet onglet », puis les écrans et fenêtres », « « Cet onglet » : la page reçoit un flux vidéo », « une source absente de la liste proposée est refusée » ; ui « partage d’écran : sélecteur d’Orbe » | Écran et fenêtre réels, et question de macOS : à vérifier à la main (application signée) |
| EXT-12 | « This tab is using your camera or microphone » | binaire | ✅ | témoin + menu « Arrêter (recharge la page) » ; self « témoin : la page utilise la caméra », « « Arrêter » recharge la page » ; ui « « Arrêter » recharge la page et l’éteint » | Voir BL-48 pour la limite du témoin |
| EXT-13 | Bloqueur : uBlock Origin installé d'office ; bloqueur natif en option ; « Block Cookie Banners » | HC 19335714372759 ; binaire | ✅ | bloqueur intégré ; self « le bloqueur annule la requête tierce… », `tests/adblock.test.js` | Bandeaux de cookies non traités |
| EXT-14 | Exception par site | binaire | ✅ | self | |
| EXT-15 | Traduction proposée quand la page est dans une autre langue | HC 25626093607703 ; binaire | ⬜ | | |
| EXT-16 | Mode développeur par site (⌃D) : barre d'adresse pleine largeur, liseré jaune et noir, automatique sur localhost | menu ; HC 20468488031511 | ⬜ | | |
| EXT-17 | Clear Cookies and Refresh ; Clear Cache and Refresh | menu | 🟡 | commandes présentes ; aucun test | |
| EXT-18 | Mots de passe : gestionnaire, import depuis Chrome ou Safari | binaire | ✅ | self (plus de 70 vérifications), `tests/passwords.js` | |
| EXT-19 | Clés d'accès du trousseau iCloud | HC 20498293324823 (v1.120) | ⬜ | | |
| EXT-20 | Cartes bancaires et remplissage automatique | warren | ⬜ | | |
| EXT-21 | Erreurs de certificat, authentification HTTP | non vérifié (comportement de Chromium) | ✅ | avertissement de certificat (certs.js), feuille d’identifiants HTTP et proxy, choix du certificat client (auth.js) ; self « certificat refusé : avertissement d’Orbe… », « site HSTS : « Continuer quand même » n’est pas proposé », « l’exception n’est jamais écrite sur disque », « bons identifiants : la page protégée s’affiche » ; ui « certificat refusé… », « identifiant et mot de passe tapés au clavier » | À faire : proposer les comptes du gestionnaire de mots de passe pour l’authentification HTTP (docs/securite-navigation.md) ; vrai proxy à vérifier à la main |
| EXT-22 | Gestionnaire de tâches | menu Help → Troubleshooting | ⬜ | | |

## REG — Réglages

Les libellés d'Arc viennent du binaire (texte exact) ; leur rangement par volet vient de `warren` et du centre d'aide. La fenêtre de réglages d'Arc n'a pas été ouverte, pour ne rien modifier.
Orbe : une seule page de réglages (`settings.html`), sans volets. Test : self « les réglages listent les profils », ui 10 (langue). Les autres options n'ont pas de test d'interface, d'où les 🟡.

| Id | Volet d'Arc → option | Preuve Arc | État | Preuve Orbe | Note |
| --- | --- | --- | --- | --- | --- |
| REG-1 | Fenêtre à volets : Account, General, Profiles, Max, Links, Shortcuts, Icon, Advanced | binaire (titres de volets) ; warren | 🟡 | page unique | Découper en volets |
| REG-2 | Account → carte de membre, nom, courriel, mot de passe, suppression du compte | HC 19401542261911 | ➖ | | Orbe n'a pas de compte, par choix |
| REG-3 | Account → Arc Sync (chiffré de bout en bout), carte de récupération | HC 20272860828823 | ⬜ | | Synchronisation : prévue à la feuille de route |
| REG-4 | General → navigateur par défaut (« … is not your default web browser ») | binaire | 🟡 | bouton, sans état « déjà par défaut » | Afficher l'état |
| REG-5 | General → Automatically update my Arc | binaire ; HC 21489650267031 | ⬜ | pas de mise à jour | |
| REG-6 | General → Warn before quitting | binaire | ⬜ | | |
| REG-7 | General → bloqueur : activer, Advanced Ad Block Settings, Block Cookie Banners | binaire | 🟡 | une case ; self (bloqueur) | |
| REG-8 | General → Previews Settings (« Show Arc Previews: » dossiers, Google, Outlook, Notion…) | binaire | ➖ | | Aperçus de services tiers, écartés pour l'instant |
| REG-9 | General → renvoi vers les réglages du profil | binaire | ➖ | | Sans objet avec une page unique |
| REG-10 | Profiles → liste des profils, nombre d'Espaces liés | binaire | ✅ | self | |
| REG-11 | Profiles → renommer, supprimer (si aucun Espace) | binaire | 🟡 | présent ; non testé | |
| REG-12 | Profiles → Default Search Engine (Google, Perplexity, Bing, DuckDuckGo, Yahoo, Yandex), Search Settings | warren ; binaire | 🟡 | Google, DuckDuckGo, Bing, Qwant, Ecosia, Brave ; global | Par profil ; moteur personnalisé |
| REG-13 | Profiles → Include search engine suggestions | binaire | 🟡 | case globale | |
| REG-14 | Profiles → Archive tabs after (12 h, 24 h, 7 jours, 30 jours), avec la question « tous les profils ou seulement celui-ci ? » | binaire | 🟡 | global, plus « Jamais » | |
| REG-15 | Profiles → Default Document App (Notion, Google Docs, Word, Confluence) | binaire ; HC 22557798824855 | ➖ | | Orbe a ses notes |
| REG-16 | Profiles → Download location | binaire | ⬜ | | |
| REG-17 | Profiles → Privacy and Security, mots de passe, cartes, Clear Browsing Data | binaire | 🟡 | mots de passe et effacement présents | |
| REG-18 | Max → toutes les fonctions d'IA | binaire | ➖ | | Écarté |
| REG-19 | Links → Air Traffic Control | binaire | ✅ | self « aiguillage » | |
| REG-20 | Links → Open a Peek window when clicking on links to other sites (favoris et épinglés) | binaire | 🟡 | `peekLinks` | |
| REG-21 | Links → Open a Peek window when clicking on links with Shift held | binaire | ⬜ | | |
| REG-22 | Links → Links from other apps open in Little Arc | binaire | 🟡 | choix fenêtre principale / petite fenêtre | |
| REG-23 | Links → Open Little Arc when clicking on links with ⌥⌘ held | binaire | ⬜ | | |
| REG-24 | Links → Open Little Arc when I press (raccourci global) | binaire | ⬜ | aucun raccourci global | `globalShortcut` |
| REG-25 | Links → Archive Little Arcs after | binaire | ⬜ | | |
| REG-26 | Shortcuts → recherche (« Type a feature name or shortcut »), raccourcis modifiables, description de chaque action | binaire | ⬜ | table fixe ; page en lecture seule | Gros chantier utile |
| REG-27 | Shortcuts → Reset All Shortcuts, Reset Shortcut to Default, Remove, Remove Conflicting Shortcut | binaire | ⬜ | | |
| REG-28 | Shortcuts → priorité par raccourci : Arc gagne, le site gagne, ou une fois le site puis Arc | binaire | ⬜ | | |
| REG-29 | Shortcuts → Extension Shortcuts | binaire | ⬜ | | |
| REG-30 | Shortcuts → « Include Favorites in ordering », « Switch to ninth tab » (pour ⌘1…⌘9) | binaire | ⬜ | | |
| REG-31 | Shortcuts → Learn the Essential Shortcuts | binaire ; menu Help | 🟡 | `shortcuts.html`, générée depuis la table des commandes ; aucun test | |
| REG-32 | Icon → choix de l'icône | binaire | ⬜ | | |
| REG-33 | Advanced → Enable Boosts on websites you visit | binaire | ⬜ | | |
| REG-34 | Advanced → Allow websites to get your theme data | binaire | ⬜ | | |
| REG-35 | Advanced → Enable Picture in Picture when you leave a video tab | binaire | 🟡 | `autoPip` | |
| REG-36 | Advanced → Allow window dragging from the top of webpages | binaire | ⬜ | | |
| REG-37 | Advanced → Enable Shared Quotes when highlighting text | binaire | ➖ | | Lié au partage en ligne |
| REG-38 | Advanced → Show full URL when Toolbar is enabled | binaire | 🟡 | adresse entière toujours | |
| REG-39 | Advanced → When opening Arc, restore windows from previous session | binaire | 🟡 | toujours restauré | |
| REG-40 | Advanced → Haptic feedback when reordering tabs | binaire | ⬜ | | |
| REG-41 | Advanced → Play Arc sound effects | binaire | ⬜ | | |
| REG-42 | Advanced → Reset Translated-site Prompts | binaire | ⬜ | | |
| REG-43 | Advanced → More Settings (réglages de Chromium : langues, contenu, sécurité) | binaire ; HC 25628125368087 | ⬜ | | Pas de `chrome://settings` dans Electron |
| REG-44 | Orbe en plus : langue de l'interface, onglets gardés en mémoire, translucidité | | ✅ | ui 10 (langue) | Arc n'est qu'en anglais |

## MEN — Barre de menus, article par article

Relevé complet d'Arc par l'accessibilité. Orbe : `menu.js` ; test self « les 42 raccourcis d'Arc sont dans le menu » (présence des raccourcis) et `nat` (touches réelles). Un article ✅ renvoie à la ligne de fonction correspondante quand elle existe.

| Id | Menu → article d'Arc | Raccourci | État | Note |
| --- | --- | --- | --- | --- |
| MEN-1 | Arc → About Arc | | ✅ | |
| MEN-2 | Arc → Preferences… | ⌘, | ✅ | |
| MEN-3 | Arc → Share Arc | | ➖ | Parrainage |
| MEN-4 | Arc → Set as Default Browser (coché quand c'est le cas) | | 🟡 | Sans coche d'état |
| MEN-5 | Arc → Import from Another Browser… | | 🟡 | Import depuis Arc seulement |
| MEN-6 | Arc → Check for Updates… / Update Available… | | ⬜ | |
| MEN-7 | Arc → Services, Hide Arc ⌘H, Hide Other Windows ⌥⌘H, Show All, Quit ⌘Q | | ✅ | Rôles natifs |
| MEN-8 | Arc → Privacy Policy | | ➖ | |
| MEN-9 | Arc → Sign Out | | ➖ | Pas de compte |
| MEN-10 | File → New Tab… | ⌘T | ✅ | |
| MEN-11 | File → New Window | ⌘N | ✅ | |
| MEN-12 | File → Blank Window | ⌃⌘N | ⬜ | ⌃⌘N est pris par « Nouvelle note » dans Orbe |
| MEN-13 | File → New Incognito Window | ⇧⌘N | ✅ | |
| MEN-14 | File → New Little Arc Window | ⌥⌘N | ✅ | |
| MEN-15 | File → Restore Last Closed Tab | ⇧⌘T | ✅ | |
| MEN-16 | File → Open Command Bar | ⌘L | ✅ | |
| MEN-17 | File → New Profile | | 🟡 | Dans Espaces → Profil |
| MEN-18 | File → New Easel | ⌃⇧E | ✅ | |
| MEN-19 | File → Close Window | ⇧⌘W | ✅ | |
| MEN-20 | File → Archive Tab | ⌘W | ✅ | |
| MEN-21 | File → Share… | | ⬜ | Feuille de partage macOS (`ShareMenu` d'Electron) |
| MEN-22 | File → Capture… | ⇧⌘2 | 🟡 | Voir TAB-14 |
| MEN-23 | File → Capture Full Page | | ✅ | |
| MEN-24 | File → Capture in Portrait Mode | | ⬜ | |
| MEN-25 | File → Save Page As | ⇧⌘S | 🟡 | Présent, non testé |
| MEN-26 | File → Print | ⌘P | 🟡 | Présent, non testé |
| MEN-27 | Edit → Undo (libellé dynamique, par exemple « Close Peek ») / Redo | ⌘Z / ⇧⌘Z | ✅ | `M:build` ; self « menu Édition : Annuler Archiver l’onglet » ; ui 18 (libellés après chaque geste) |
| MEN-28 | Edit → Cut, Copy, Paste, Paste and Match Style ⇧⌘V, Delete, Select All | | ✅ | Rôles natifs ; « Delete » à vérifier |
| MEN-29 | Edit → Copy URL | ⇧⌘C | ✅ | |
| MEN-30 | Edit → Copy URL as Markdown | ⌥⇧⌘C | ✅ | |
| MEN-31 | Edit → Copy URL as Quote | ⌃⇧⌘C | 🟡 | Présent, non testé |
| MEN-32 | Edit → Find → Find… | ⌘F | ✅ | |
| MEN-33 | Edit → Find → Find and Replace | ⌥⌘F | ⬜ | |
| MEN-34 | Edit → Find → Find Next / Find Previous | ⌘G / ⇧⌘G | ✅ | |
| MEN-35 | Edit → Find → Use Selection to Find | | ⬜ | |
| MEN-36 | Edit → Find → Jump to Selection | ⌘J | ⬜ | |
| MEN-37 | Edit → Spelling and Grammar (sous-menu complet) | | ⬜ | Suggestions au clic droit seulement |
| MEN-38 | Edit → Substitutions, Transformations, Speech | | ⬜ | Rôles natifs à ajouter (une ligne chacun) |
| MEN-39 | Edit → Format → Font → Bold, Italic, Underline | ⌘B, ⌘I, ⌘U | ⬜ | |
| MEN-40 | View → Appearance → Automatic, Light, Dark | | ✅ | |
| MEN-41 | View → Hide Sidebar | ⌘S | ✅ | |
| MEN-42 | View → Show Toolbar | ⇧⌘D | ✅ | ui 07 |
| MEN-43 | View → Collapse Pinned Tabs | | ⬜ | |
| MEN-44 | View → Stop Loading | ⌘. | ✅ | |
| MEN-45 | View → Refresh the Page | ⌘R | ✅ | |
| MEN-46 | View → Force Refresh the Page | ⇧⌘R | ✅ | |
| MEN-47 | View → Clear Cookies and Refresh | | 🟡 | Non testé |
| MEN-48 | View → Clear Cache and Refresh | | 🟡 | Non testé |
| MEN-49 | View → Add Split View | ⌃⇧= | ✅ | |
| MEN-50 | View → Close this Split Pane | ⌃⇧- | ✅ | |
| MEN-51 | View → Separate Page from Split View | | ⬜ | |
| MEN-52 | View → Expand Current Split | | ⬜ | |
| MEN-53 | View → Zoom to Actual Size, Zoom In, Zoom Out | ⌘0, ⌘+, ⌘- | 🟡 | Présents, sans test |
| MEN-54 | View → Cast | | ⬜ | |
| MEN-55 | View → Developer → View Source | ⌥⌘U | 🟡 | Non testé |
| MEN-56 | View → Developer → Developer Tools, Inspect Elements, JavaScript Console | ⌥⌘I, ⌥⌘C, ⌥⌘J | 🟡 | Non testés |
| MEN-57 | View → Developer → Network Inspector | | ⬜ | |
| MEN-58 | View → Developer → Allow JavaScript from Apple Events | | ⬜ | Pas d'AppleScript dans Orbe |
| MEN-59 | View → Developer → Turn on Developer Mode for this site | ⌃D | ⬜ | |
| MEN-60 | View → Enter Full Screen | ⌃⌘F | 🟡 | Non testé |
| MEN-61 | Spaces → New Space… | | ✅ | |
| MEN-62 | Spaces → Edit Theme… | | ✅ | |
| MEN-63 | Spaces → Rename Space | | ✅ | |
| MEN-64 | Spaces → Change Profile | | ✅ | |
| MEN-65 | Spaces → Next Space / Previous Space | ⌥⌘→ / ⌥⌘← | ✅ | |
| MEN-66 | Spaces → liste des Espaces | ⌃1 … ⌃9 | ✅ | |
| MEN-67 | Spaces → Manage Spaces… | | ⬜ | |
| MEN-68 | Tabs → New Tab… | ⌘T | ✅ | |
| MEN-69 | Tabs → Pin Tab | ⌘D | ✅ | |
| MEN-70 | Tabs → New Folder… | | ✅ | |
| MEN-71 | Tabs → Next Tab / Previous Tab | ⌥⌘↓ / ⌥⌘↑ | ✅ | |
| MEN-72 | Tabs → Reveal Tab in Sidebar | | ⬜ | |
| MEN-73 | Tabs → Clear Today | ⇧⌘K | ✅ | |
| MEN-74 | Tabs → Reset all tabs in this Space | | ⬜ | |
| MEN-75 | Archive → Go Back / Go Forward | ⌘[ / ⌘] | ✅ | |
| MEN-76 | Archive → View History | ⌘Y | ✅ | |
| MEN-77 | Archive → View Archive… | | ✅ | |
| MEN-78 | Archive → Clear Archive | | 🟡 | Sans confirmation |
| MEN-79 | Extensions → une ligne par extension | | ⬜ | |
| MEN-80 | Extensions → Add Extension…, Manage Extensions… | | ⬜ | |
| MEN-81 | Window → Stay On Top | | 🟡 | Présent, non testé |
| MEN-82 | Window → Minimize ⌘M, Minimize All ⌥⌘M, Zoom | | 🟡 | Rôles natifs partiels |
| MEN-83 | Window → disposition en moitiés et quarts (fournie par macOS) | | 🟡 | À vérifier : macOS l'ajoute au menu de rôle `window` |
| MEN-84 | Window → Open Library… | ⇧⌘L | ✅ | |
| MEN-85 | Window → View Downloads… | ⇧⌘J | ✅ | |
| MEN-86 | Window → View Easels… | | ✅ | |
| MEN-87 | Window → View Media… | | 🟡 | Liste simple |
| MEN-88 | Window → View Boosts… | | ⬜ | |
| MEN-89 | Window → Bring All to Front, liste des fenêtres | | ✅ | Rôle natif |
| MEN-90 | Help → Getting Started | | ✅ | « Bienvenue dans Orbe » ; self « la page d'accueil s'affiche » |
| MEN-91 | Help → Essential Keyboard Shortcuts | | 🟡 | Page présente, sans test |
| MEN-92 | Help → Contact the Team, Visit Help Center | | 🟡 | Liens vers GitHub |
| MEN-93 | Help → Restore Data | | ⬜ | |
| MEN-94 | Help → Export Arc Notes | | ⬜ | |
| MEN-95 | Help → Troubleshooting → Record Trace, Open Task Manager, Reveal Arc Data, Copy Arc Info | | ⬜ | « Afficher les données d'Orbe » et « Copier les infos » sont simples |
| MEN-96 | Menu du Dock : New Incognito Window, Show/Hide All Little Arc Windows | HC 20498377604887 | ⬜ | |

## RAC — Raccourcis

Arc : `menu` pour ceux de la barre de menus, sinon la source indiquée. Orbe : `nat` = vérifié par touche réelle (`tests/natif/raccourcis.js`, à lancer à la main), `self` = présence dans le menu.

| Id | Raccourci | Action dans Arc | Preuve Arc | État | Note |
| --- | --- | --- | --- | --- | --- |
| RAC-1 | ⌘T | Barre de commande, nouvel onglet | menu | ✅ | |
| RAC-2 | ⌘L | Modifier l'adresse | menu | ✅ | |
| RAC-3 | ⌘N / ⇧⌘N / ⌥⌘N | Fenêtre, fenêtre privée, petite fenêtre | menu | ✅ | |
| RAC-4 | ⌃⌘N | Fenêtre vierge | menu | ⬜ | Conflit avec « Nouvelle note » |
| RAC-5 | ⌘W / ⇧⌘W | Archiver l'onglet, fermer la fenêtre | menu | ✅ | |
| RAC-6 | ⇧⌘T | Rouvrir | menu | ✅ | |
| RAC-7 | ⌘Z / ⇧⌘Z | Annuler, rétablir (actions de la barre) | menu | 🟡 | |
| RAC-8 | ⌘D | Épingler | menu | ✅ | |
| RAC-9 | ⌘S | Barre latérale | menu | ✅ | |
| RAC-10 | ⇧⌘D | Barre d'outils | menu | ✅ | |
| RAC-11 | ⇧⌘K | Effacer les onglets du jour | menu | ✅ | |
| RAC-12 | ⇧⌘C / ⌥⇧⌘C / ⌃⇧⌘C | Copier l'adresse, en Markdown, en citation | menu | ✅ | Citation non testée |
| RAC-13 | ⌘1 … ⌘9 | Élément n de la barre | binaire | ✅ | |
| RAC-14 | ⌃1 … ⌃9 | Espace n | menu | ✅ | |
| RAC-15 | ⌃⇥ / ⌃⇧⇥ | Onglets récents | HC 25619402657303 | ✅ | |
| RAC-16 | ⌃` | Onglets récents (variante) | HC 25619402657303 | ⬜ | |
| RAC-17 | ⌥⌘↓ / ⌥⌘↑ | Onglet suivant, précédent | menu | ✅ | |
| RAC-18 | ⌥⌘→ / ⌥⌘← | Espace suivant, précédent | menu | ✅ | |
| RAC-19 | ⌘[ / ⌘] | Page précédente, suivante | menu | ✅ | |
| RAC-20 | ⌘← / ⌘→ | Page précédente, suivante | HC 20595231349911 | ⬜ | À vérifier hors champ de saisie |
| RAC-21 | ⌘R / ⇧⌘R / ⌘. | Actualiser, forcer, arrêter | menu | ✅ | |
| RAC-22 | ⌃⇧= / ⌃⇧- | Ajouter, fermer un volet | menu | ✅ | |
| RAC-23 | ⌃⇧1 … ⌃⇧4 | Aller au volet | binaire ; hongkiat | ✅ | |
| RAC-24 | ⌃⇧[ / ⌃⇧] | Volet précédent, suivant | hongkiat (peu fiable) | ⬜ | |
| RAC-25 | ⌘F / ⌘G / ⇧⌘G | Chercher, suivant, précédent | menu | ✅ | |
| RAC-26 | ⌥⌘F / ⌘J | Chercher et remplacer, aller à la sélection | menu | ⬜ | |
| RAC-27 | ⌘0 / ⌘+ / ⌘- | Zoom | menu | 🟡 | Sans test |
| RAC-28 | ⌘Y | Historique | menu | ✅ | |
| RAC-29 | ⇧⌘L / ⇧⌘J | Bibliothèque, téléchargements | menu | ✅ | |
| RAC-30 | ⇧⌘2 | Capture | menu | 🟡 | |
| RAC-31 | ⌃⇧E | Nouveau tableau | menu | ✅ | |
| RAC-32 | ⌃⇧N / ⌃⌥N | Nouvelle note, note en vue scindée | HC 22557798824855 | 🟡 | ⌃⌘N dans Orbe |
| RAC-33 | ⇧⌘S / ⌘P | Enregistrer la page, imprimer | menu | 🟡 | Sans test |
| RAC-34 | ⌥⌘U / ⌥⌘I / ⌥⌘C / ⌥⌘J | Source, outils, inspecteur, console | menu | 🟡 | Sans test |
| RAC-35 | ⌃D | Mode développeur du site | menu | ⬜ | |
| RAC-36 | ⌃⌘F | Plein écran | menu | 🟡 | |
| RAC-37 | ⌘O / ⌥⌘O | Dans un aperçu ou une petite fenêtre : ouvrir en onglet, choisir l'Espace | HC 19235387524503 | ✅ | ⌥⌘O sans effet dans la fenêtre principale d'Orbe (corps vide) |
| RAC-38 | ⌥⌘V | Coller l'adresse dans un nouvel onglet | HC 20498377604887 | ⬜ | |
| RAC-39 | ⌘E | Faire défiler les extensions | HC 19434259167767 | ⬜ | |
| RAC-40 | ⌥⌘⌫ | Supprimer la suggestion désignée | HC 20498377604887 | ⬜ | |
| RAC-41 | ⌥⌘G | ChatGPT | HC 19335160678679 | ➖ | |
| RAC-42 | ⌃⌘J | Rejoindre la prochaine réunion | HC 24158102740631 | ➖ | |
| RAC-43 | ⌘, / ⌘H / ⌥⌘H / ⌘M / ⌥⌘M / ⌘Q | Réglages et raccourcis du système | menu | ✅ | |
| RAC-44 | ⇧⌘V | Coller en adaptant le style | menu | ✅ | |
| RAC-45 | Échap | Préfère le site ; maintenu ou doublé, quitte le plein écran | HC 25619348451223 | 🟡 | Ferme aperçu, recherche, sélecteur |
| RAC-46 | ⇧clic / ⌥clic / ⌥⌘clic sur un lien | Aperçu, vue scindée, petite fenêtre | HC 20498377604887 | 🟡 | ⇧clic seulement |
| RAC-47 | Raccourci global pour la petite fenêtre | Réglable | binaire | ⬜ | |
| RAC-48 | Tous les raccourcis modifiables | Volet Shortcuts | binaire | ⬜ | Voir REG-26 |

## IMP — Import, accueil, mises à jour

| Id | Ce que fait Arc | Preuve Arc | État | Preuve Orbe | Note |
| --- | --- | --- | --- | --- | --- |
| IMP-1 | Accueil en plusieurs étapes : compte, import, thème, sites favoris, bloqueur, navigateur par défaut, carte de membre | popsci ; inverse | 🟡 | une page d'accueil (`welcome.html`) ; self | Étapes thème et favoris à ajouter |
| IMP-2 | Accueil avec éclat de couleurs et musique | inverse ; binaire `intro-music.mp3`, `orb.mp4` | ⬜ | | Voir SON-3 |
| IMP-3 | Petites vidéos d'apprentissage : épingler, changer d'Espace, nouvel onglet, vue scindée | binaire `pinning.mp4`, `space_swiping.mp4`, `new_tab.mp4`, `split_view.mp4` | ⬜ | six raccourcis listés | Enregistrer quatre vidéos d'Orbe |
| IMP-4 | Textes d'accueil : « Open your first tab », « Pin tabs to save for later », « Spaces for work and life », « Multitask with Split View » | binaire | 🟡 | textes propres à Orbe | |
| IMP-5 | Onglets et dossier « Arc Basics » posés au départ | binaire | ⬜ | | |
| IMP-6 | Import depuis Chrome, Safari, Firefox, Brave, Edge, Opera, Vivaldi : signets vers les épinglés, mots de passe, cookies, plusieurs profils | HC 19335089616791 ; binaire | 🟡 | import depuis Arc (self, trois vérifications) et mots de passe par CSV (self) | Import Chrome et Safari |
| IMP-7 | Choix du profil de destination ; « Replace existing cookies with imported cookies » | binaire | ⬜ | | |
| IMP-8 | Favoris suggérés d'après l'historique importé | HC 20498377604887 | ⬜ | | |
| IMP-9 | Invite « Arc works best as your default browser », avec essai d'une semaine | binaire | ⬜ | | |
| IMP-10 | Mise à jour automatique (Sparkle), bandeau « Restart and Update », notes de version | binaire ; HC 21489650267031 | ⬜ | aucun mécanisme | Demande une application signée et notariée |
| IMP-11 | Fenêtre « Essential Keyboard Shortcuts » | menu ; binaire | 🟡 | `shortcuts.html` ; aucun test | |
| IMP-12 | Interface en anglais seulement | HC 19437072655255 | ✅ | français et anglais ; ui 10 | Orbe fait mieux |
| IMP-13 | Pilotage par AppleScript (fenêtres, Espaces, onglets, JavaScript) | binaire `Arc.sdef` | ⬜ | | Faible priorité |
| IMP-14 | Handoff depuis iOS ; Touch ID pour les sites | HC 20498417809815 | ⬜ | | |

## DIV — Divers

| Id | Ce que fait Arc | Preuve Arc | État | Preuve Orbe | Note |
| --- | --- | --- | --- | --- | --- |
| DIV-1 | Barre d'outils (⇧⌘D) : précédent, suivant, actualiser, adresse, extensions épinglées à droite | HC 25625617866263 | 🟡 | bandeau de 38 px sans extensions ; ui 07 | |
| DIV-2 | Clic droit sur la barre d'outils : Show Full URL, copier, capture, partager | HC 20498377604887 | ⬜ | | |
| DIV-3 | En vue scindée, la barre d'outils montre l'adresse de chaque volet | HC 20498377604887 | ⬜ | | |
| DIV-4 | Recherche dans la page | menu | ✅ | self « ⌘F trouve le texte dans la page » ; ui 08 | |
| DIV-5 | Zoom : pourcentage affiché | HC 20498293324823 | 🟡 | message « Zoom N % » ; aucun test | |
| DIV-6 | Messages (toasts) au-dessus de la page, cliquables | HC 20498417809815 | 🟡 | W:toast ; aucun test | |
| DIV-7 | Copie de l'adresse sans les paramètres de pistage (« Super Copy », cas d'Amazon et d'Instagram) | HC 20498293324823 ; binaire « without any trackers » | 🟡 | copie simple (self) | Retirer `utm_*`, `fbclid`, etc. |
| DIV-8 | Fenêtre privée | menu | ✅ | self (deux vérifications) | |
| DIV-9 | Fenêtre vierge (hors Espaces, non synchronisée) | menu ; HC 20498377604887 | ⬜ | | |
| DIV-10 | Stay On Top | menu | 🟡 | présent | |
| DIV-11 | Plein écran : nouvelles fenêtres en plein écran, barre au survol | HC 20498377604887 | 🟡 | natif | |
| DIV-12 | Page d'erreur | non vérifié | ✅ | self (deux vérifications) ; ui 09 | |
| DIV-13 | Menu de page, lien : ouvrir dans un nouvel onglet, en vue scindée, en aperçu, dans Little Arc, copier | slashgear ; binaire « Open in Background Tab », « Open in Split View » | 🟡 | W:pageMenu ; aucun test du menu | |
| DIV-14 | Menu de page, sélection : chercher, « Share Quote » | HC 20498293324823 ; binaire « Search With Google » | 🟡 | Copier, Rechercher | |
| DIV-15 | Menu de page, image : ouvrir, copier, enregistrer | non vérifié (Chromium) | 🟡 | présent ; aucun test | |
| DIV-16 | Menu de page, vidéo : image dans l'image | HC 19234766331799 | ⬜ | | |
| DIV-17 | Menu de page : traduire, « Customize Page » (Boost) | HC 25626093607703 ; binaire | ⬜ | | |
| DIV-18 | Menu de page : Inspecter | non vérifié | 🟡 | présent | |
| DIV-19 | Boîte « quitter la page ? » (`beforeunload`) | non vérifié (Chromium) | ✅ | question « Quitter la page ? » à la navigation, à la fermeture de l’onglet, de plusieurs onglets et de la fenêtre (unload.js) ; self « fermer l’onglet puis « Rester » : l’onglet revient… », « archiver plusieurs onglets : une question par page… », « fermer la fenêtre puis « Rester »… » ; ui « page modifiée au clavier… » | Aperçu fermé sans question |
| DIV-20 | Fenêtres surgissantes bloquées | non vérifié (Chromium) | ✅ | bloquées sans geste, mention dans la pastille, « Ouvrir quand même », « Toujours autoriser pour ce site » (popups.js) ; self « window.open sans geste : bloqué », « après un vrai clic : la fenêtre s’ouvre, avec window.opener » ; ui « fenêtre ouverte sans geste : bloquée… » | Heuristique de geste documentée dans popups.js |
| DIV-21 | Lecture de PDF | non vérifié (Chromium) | ✅ | visionneuse de Chromium (aucun réglage à changer) ; PDF téléchargé ouvert dans un onglet ; self « un PDF s’affiche dans la visionneuse de Chromium », « PDF téléchargé : ouvert dans un onglet » |  |
| DIV-22 | Vidéos protégées (Netflix, etc.) | non vérifié | ⬜ | seulement avec le moteur optionnel | Limite connue |
| DIV-23 | La boîte « Quitter » montre l'icône choisie | HC 20498293324823 | ➖ | | Détail lié aux icônes |
| DIV-24 | Aperçus au survol des favoris (Gmail, Agenda, Notion, Linear, Figma) et agenda vivant | HC 19335284431639, 24158102740631 | ➖ | | Services tiers, écartés pour l'instant |
| DIV-25 | Partage d'Espaces, de dossiers, d'onglets par lien | HC 19228534606743 | ➖ | | Demande un serveur |
| DIV-26 | Résumés au survol des liens, questions à la page | HC 19335160678679 | ➖ | | Fonctions d'IA |
| DIV-27 | Cadenas / « Non sécurisé » dans la pastille d’adresse ; clic : résumé du certificat | usage courant des navigateurs | ✅ | certs.state + feuille « site » ; self « pastille d’adresse : « Non sécurisé » pendant l’avertissement », « résumé du certificat pour le cadenas » ; ui « après « continuer » : la pastille reste « Non sécurisé » » |  |
| DIV-28 | Page plantée (« La page a planté », Recharger) ; page qui ne répond plus (Attendre / Recharger) | usage courant des navigateurs | ✅ | essentials.js (render-process-gone, unresponsive) ; self « page plantée : feuille… », « page qui ne répond plus… » |  |
| DIV-29 | Liens vers d’autres applications (`mailto:`, `tel:`, liens d’application) : question, mémorisée par site et par schéma | usage courant des navigateurs | ✅ | permissions.js (openExternal) ; self « lien mailto: : Orbe demande avant d’ouvrir une autre application », « schémas dangereux… : jamais ouverts » |  |
| DIV-30 | Appareils USB, HID, série, Bluetooth demandés par une page | usage courant des navigateurs | 🟡 | demande annulée proprement avec un message, jamais d’appareil choisi d’office ; self « Bluetooth : la demande est annulée tout de suite… », « USB… », « port série… » | Pas de sélecteur d’appareil |
| DIV-31 | Certificat client demandé par un site : choix explicite | usage courant des navigateurs | ✅ | auth.js ; self « certificat client : Electron n’envoie pas le premier d’office ; Orbe demande lequel » | Vrai certificat du trousseau : à vérifier à la main |
| DIV-32 | Téléchargements : reprise après interruption (même après fermeture), mise en garde pour les exécutables | usage courant des navigateurs | ✅ | downloads.js ; self « « Reprendre » demande la suite au serveur (Range)… », « interrompu par la fermeture d’Orbe : repris… », « ouvrir un exécutable demande confirmation… » |  |

## À faire ensuite : les 30 premiers, par gain ressenti rapporté à l'effort

1. **ANI-1, ANI-2, ANI-3, BL-7** — raccourcir la bascule de la barre (180 ms → 50 ms ou moins) et l'apparition de la barre de commande. Arc est presque instantané ; c'est la différence de « nervosité » la plus facile à corriger (deux constantes).
2. **CMD-4, CMD-5, CMD-6** — barre de commande aux cotes d'Arc : 760 de large, à un tiers de la hauteur, lignes de 46.
3. **BL-10** — marge de la page à 10.
4. **SON-1, TAB-16, SON-4** — un son de capture original et le réglage pour le couper. C'est le seul son d'usage courant d'Arc.
5. **TAB-14, TAB-15** — ⇧⌘2 choisit une zone (le code existe déjà pour « vers un tableau »), puis propose copier, enregistrer, ajouter à un tableau.
6. **SON-6, SON-7** — retour haptique au déplacement et au dépôt d'un onglet (petit module natif `NSHapticFeedbackManager`), avec le réglage REG-40.
7. ✅ **ANI-22, BL-101** — les lignes s'écartent sous l'onglet qu'on déplace. *(fait : ui 17)*
8. **ANI-10, ESP-9, GES-1** — vrai glissement côte à côte entre deux Espaces, qui suit le doigt ; à régler caméra en main avec Arc à côté.
9. **ANI-11, APE-8** — l'aperçu s'ouvre en s'agrandissant et se referme en se réduisant.
10. ✅ **BL-53** — sélection multiple d'onglets (⇧clic, ⌘clic), puis fermer, déplacer, copier, mettre en dossier. *(fait : ui 16)*
11. ✅ **ONG-4, ONG-5, ESP-15, APE-7** — une vraie pile d'annulation pour la barre (déplacer, renommer, effacer, supprimer, aperçu fermé), avec le libellé dynamique du menu. *(fait : ui 18)*
12. **SCI-5, SCI-11** — petite barre en haut de chaque volet (adresse, fermer) et repère du volet actif.
13. **BL-97, BL-98, SCI-6** — déposer à gauche, à droite, en haut, en bas ; déposer un onglet sur un autre ; ⌥clic.
14. **BL-94, BL-102** — glisser un onglet vers un autre Espace ; réordonner les Espaces.
15. **THM-4, THM-7, THM-9, THM-3** — troisième couleur, intensité, trois textures de plus, nuancier à deux dimensions.
16. **BL-32, ANI-8** — indicateur de chargement en lueur en haut de la page.
17. **BL-16, THM-12, CMD-9** — barre estompée quand la fenêtre est inactive ; couleurs du thème dans la barre de commande et les messages.
18. **ANI-23, BL-73, ANI-14** — hauteur des dossiers animée ; effacement des onglets du jour en cascade.
19. **ANI-9, BL-57** — le téléchargement saute dans l'icône de la Bibliothèque ; détail du téléchargement en cours avec annulation.
20. **BIB-4, BIB-6, BIB-7** — fichiers récents au survol de l'icône, à glisser dehors ; médias en grille.
21. **REG-26, RAC-48** — raccourcis modifiables.
22. ~~**EXT-11, EXT-21, DIV-19**~~ — fait (branche `essentiels`) : partage d'écran, erreurs de certificat et authentification HTTP, boîte `beforeunload`, avec les fenêtres surgissantes (DIV-20) et les points DIV-27 à DIV-32. Notes de sécurité : `docs/securite-navigation.md`.
23. **EXT-8, EXT-9** — vrai panneau de contrôle du site et bulle d'autorisation.
24. **BL-3, BL-4, BL-14, BL-20, BL-21, BL-22** — petits gestes de la barre : double-clic sur le bord, tirer pour masquer, double-clic dans le vide, historique sur appui long, ⌘clic.
25. **BL-125, BL-121, BL-122, BL-111, BL-130** — compléter les menus contextuels (remplacer l'adresse épinglée, archiver au-dessus, archiver les autres, copier en Markdown, menu du dossier).
26. **CMD-13, CMD-14, CMD-15, CMD-21, CMD-22** — barre de commande : actions seules avec ⇥, recherche dans un site, suppression d'une suggestion, Espaces et dossiers par leur nom.
27. **BIB-13, BIB-14, BIB-16, PET-7** — archive : cause de fermeture, filtres, retour dans l'Espace d'origine, confirmation.
28. **DIV-7** — copie de l'adresse sans paramètres de pistage.
29. **IMP-10, MEN-6, BL-56** — mises à jour automatiques (suppose la signature et la notarisation).
30. **IMP-6, IMP-3, SON-3** — import depuis Chrome et Safari ; accueil avec courtes vidéos et musique.

## Ce qui n'a pas pu être observé sur Arc, et pourquoi

- **Changement d'Espace, glisser-déposer, gestes du pavé tactile, retour haptique** : ils se jouent dans les Espaces réels du propriétaire ou demandent sa main. Rien n'a été déclenché. Les durées et courbes correspondantes sont donc « non mesurées ».
- **Aperçu (Peek)** : il fallait cliquer dans la page avec la souris alors que d'autres fenêtres (essais automatiques d'Orbe en cours sur la machine) prenaient le focus par moments. Non tenté.
- **Fenêtre de réglages** : non ouverte. Les libellés viennent du binaire, leur rangement de la documentation.
- **Moment où joue `event.m4a`** : inconnu. Le fichier n'a pas été écouté ni relié à un événement.
- **Rendu exact des textures et teintes des palettes** : les noms sont dans le binaire, les images n'ont pas été extraites.
- **Menus contextuels** : aucun n'a été ouvert sur Arc ; les articles viennent des libellés du binaire et du centre d'aide. L'ordre et les séparateurs sont inconnus.
- Les mesures ont été faites dans une fenêtre de navigation privée ouverte pour l'occasion, sur `example.com`, puis refermée. Les captures ont été supprimées.

## Bilan chiffré

650 lignes au total : 170 ✅, 198 🟡, 255 ⬜, 27 ➖.

| Domaine | ✅ | 🟡 | ⬜ | ➖ | Total |
| --- | --- | --- | --- | --- | --- |
| Barre latérale (BL) | 29 | 34 | 46 | 2 | 111 |
| Barre de commande (CMD) | 11 | 24 | 15 | 3 | 53 |
| Espaces et profils (ESP) | 10 | 6 | 8 | 0 | 24 |
| Vie des onglets (ONG) | 6 | 10 | 11 | 2 | 29 |
| Vue scindée (SCI) | 7 | 5 | 6 | 0 | 18 |
| Aperçu (APE) | 3 | 4 | 5 | 0 | 12 |
| Petite fenêtre (PET) | 3 | 4 | 9 | 0 | 16 |
| Thèmes (THM) | 4 | 7 | 8 | 1 | 20 |
| Animations (ANI) | 1 | 11 | 17 | 0 | 29 |
| Sons et haptique (SON) | 1 | 1 | 9 | 0 | 11 |
| Gestes (GES) | 1 | 4 | 4 | 0 | 9 |
| Bibliothèque et médias (BIB) | 3 | 13 | 13 | 2 | 31 |
| Boosts (BOO) | 3 | 2 | 7 | 1 | 13 |
| Tableaux et capture (TAB) | 6 | 4 | 8 | 1 | 19 |
| Notes (NOT) | 1 | 2 | 2 | 0 | 5 |
| Extensions et site (EXT) | 3 | 8 | 11 | 0 | 22 |
| Réglages (REG) | 3 | 14 | 21 | 6 | 44 |
| Menus (MEN) | 45 | 21 | 27 | 3 | 96 |
| Raccourcis (RAC) | 26 | 9 | 11 | 2 | 48 |
| Import et accueil (IMP) | 1 | 4 | 9 | 0 | 14 |
| Divers (DIV) | 3 | 11 | 8 | 4 | 26 |

Lecture : un 🟡 recouvre deux cas, que les colonnes « Preuve Orbe » et « Note » distinguent : du code présent mais sans test (un test suffit à le passer en ✅), ou une fonction réellement incomplète. La part de chacun n'a pas été comptée.

