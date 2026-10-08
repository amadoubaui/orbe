# Orbe sous Windows

Orbe tourne sous Windows 10 et 11 avec le même code que sous macOS. Tout ce qui
dépend du système est regroupé dans `src/main/platform.js` (processus
principal) et dans un bloc « Plateformes » à la fin de `shell.css` et de
`base.css`, activé par la classe `html.win` (posée par `common.js`).

## Lancer, tester, fabriquer

```sh
npm start                    # lance le navigateur
npm test                     # tests de bout en bout
node scripts/build-win.js    # %USERPROFILE%\.orbe-dev\dist\Orbe-win32-x64\Orbe.exe (+ .zip)
```

L'intégration continue (`.github/workflows/tests.yml`) lance les tests sur
`windows-latest` et `macos-latest`, fabrique l'application Windows, vérifie
qu'elle démarre, et publie l'archive zip et des captures d'écran.

## Ce qui change par rapport à macOS

| Sujet | macOS | Windows |
| --- | --- | --- |
| Boutons de fenêtre | feux tricolores à gauche, dans la barre latérale | boutons du système à droite (`titleBarOverlay`), aux couleurs de l'Espace |
| Haut de la fenêtre | la page monte jusqu'à 8 px du bord | une bande de 32 px reste libre au-dessus de la page (boutons de fenêtre, déplacement) ; avec la barre d'outils, les boutons sont à sa droite |
| Fond | `vibrancy` (translucide) | fond opaque teinté ; Mica (`backgroundMaterial`) sur Windows 11 22H2+ quand « fond translucide » est activé |
| Menu | barre de menus du système | pas de barre : bouton « ⋯ » en haut de la barre latérale, les raccourcis restent actifs |
| Police | San Francisco | Segoe UI Variable |
| Dernière fenêtre fermée | l'application reste ouverte | l'application se ferme |
| Navigateur par défaut | immédiat | Orbe s'inscrit puis ouvre Paramètres → Applications par défaut (Windows impose le choix à la main) |
| Import depuis Arc | `~/Library/Application Support/Arc` | `%LOCALAPPDATA%\Packages\TheBrowserCompany.Arc_*\LocalCache\Local\Arc` (menu masqué si Arc est absent) |
| Données | `~/Library/Application Support/Orbe` | `%APPDATA%\Orbe` |
| Téléchargements | `~/Downloads` | dossier Téléchargements de l'utilisateur |

## Raccourcis clavier

Les commandes sont écrites une seule fois, avec les raccourcis d'Arc pour
macOS (`commands.js`). `platform.accel()` les traduit : **⌘ devient Ctrl**, et
⌥ devient Alt. Les exceptions ci-dessous sont dans la table `WIN_ACCEL`.
`platform.keys()` produit l'affichage (« Ctrl+Shift+T ») pour le menu, la
barre de commande, la page des raccourcis et les textes de l'interface.

Source : les raccourcis d'Arc pour Windows connus (aide d'Arc et relevés
d'utilisateurs : Ctrl+T, Ctrl+L, Ctrl+W, Ctrl+Shift+T, Ctrl+D, Ctrl+S, Ctrl+N,
Ctrl+H, Ctrl+Shift+C, Ctrl+Shift+Alt+C, Ctrl+Shift+=, Ctrl+Alt+flèches,
Ctrl+chiffre, Ctrl+Shift+I), complétés par les usages de Chrome sous Windows.

| Action | macOS | Windows | Pourquoi |
| --- | --- | --- | --- |
| Nouvel onglet / adresse | ⌘T / ⌘L | Ctrl+T / Ctrl+L | règle générale |
| Archiver / rouvrir l'onglet | ⌘W / ⇧⌘T | Ctrl+W / Ctrl+Shift+T | règle générale |
| Épingler | ⌘D | Ctrl+D | règle générale |
| Barre latérale / barre d'outils | ⌘S / ⇧⌘D | Ctrl+S / Ctrl+Shift+D | règle générale |
| Fenêtre / privée / petite | ⌘N / ⇧⌘N / ⌥⌘N | Ctrl+N / Ctrl+Shift+N / Ctrl+Alt+N | règle générale |
| Onglet suivant / précédent | ⌥⌘↓ / ⌥⌘↑ | Ctrl+Alt+↓ / Ctrl+Alt+↑ | comme Arc pour Windows |
| Espace suivant / précédent | ⌥⌘→ / ⌥⌘← | Ctrl+Alt+→ / Ctrl+Alt+← | comme Arc pour Windows |
| Onglets récents | ⌃⇥ | Ctrl+Tab | inchangé |
| Aller à l'onglet 1…9 | ⌘1…⌘9 | Ctrl+1…Ctrl+9 | comme Arc pour Windows |
| **Aller à l'Espace 1…9** | ⌃1…⌃9 | **Alt+1…Alt+9** | Ctrl+chiffre est pris par les onglets |
| Vue scindée / fermer le volet / volet n | ⌃⇧= / ⌃⇧- / ⌃⇧1…4 | Ctrl+Shift+= / Ctrl+Shift+- / Ctrl+Shift+1…4 | inchangé |
| **Capturer la page** | ⇧⌘2 | **Alt+Shift+2** | Ctrl+Shift+2 vise déjà le volet 2 |
| Copier l'URL / en Markdown | ⇧⌘C / ⌥⇧⌘C | Ctrl+Shift+C / Ctrl+Alt+Shift+C | comme Arc pour Windows |
| **Copier en citation** | ⌃⇧⌘C | **Alt+Shift+C** | ⌃ et ⌘ se confondraient en Ctrl+Shift+C |
| **Historique** | ⌘Y | **Ctrl+H** | Ctrl+Y rétablit une frappe sous Windows |
| Bibliothèque | ⇧⌘L | Ctrl+Shift+L | règle générale |
| **Téléchargements** | ⇧⌘J | **Ctrl+J** | usage de Windows ; libère Ctrl+Shift+J |
| **Page précédente / suivante** | ⌘[ / ⌘] | **Alt+← / Alt+→** | usage de Windows |
| **Plein écran** | ⌃⌘F | **F11** | usage de Windows |
| **Outils de développement** | ⌥⌘I | **Ctrl+Shift+I** | usage de Windows |
| **Console** | ⌥⌘J | **Ctrl+Shift+J** | usage de Windows |
| **Inspecter** | ⌥⌘C | **F12** | Ctrl+Shift+C copie l'URL, comme dans Arc |
| **Code source** | ⌥⌘U | **Ctrl+U** | usage de Windows |
| Recherche / suivant / précédent | ⌘F / ⌘G / ⇧⌘G | Ctrl+F / Ctrl+G / Ctrl+Shift+G | règle générale |
| Actualiser / forcer / arrêter | ⌘R / ⇧⌘R / ⌘. | Ctrl+R / Ctrl+Shift+R / Ctrl+. | règle générale |
| Zoom | ⌘+ / ⌘- / ⌘0 | Ctrl++ / Ctrl+- / Ctrl+0 | règle générale |
| Effacer Aujourd'hui | ⇧⌘K | Ctrl+Shift+K | règle générale (un relevé d'Arc pour Windows indique Ctrl+Alt+K) |
| Enregistrer / imprimer | ⇧⌘S / ⌘P | Ctrl+Shift+S / Ctrl+P | règle générale |
| Aperçu → onglet | ⌘O | Ctrl+O | règle générale |
| Réglages | ⌘, | Ctrl+, | règle générale |
| Ouvrir en arrière-plan (barre de commande) | ⌘↩ | Ctrl+Entrée | règle générale |

## Icône de l'exécutable

`scripts/make-ico.js` fabrique `assets/orbe.ico` à partir de `assets/icon.png`
(décodage PNG, réduction et empaquetage ICO écrits en JavaScript, sans
dépendance). Cette icône est celle des fenêtres et de la barre des tâches.

L'icône inscrite **dans** `Orbe.exe` (celle que montre l'Explorateur) et ses
informations de version restent celles d'Electron : les changer demande de
réécrire les ressources de l'exécutable, ce que fait l'outil `rcedit`, et qui
ne se fait pas proprement sans dépendance. À traiter avec l'installateur.

## Navigateur par défaut

`app.setAsDefaultProtocolClient` inscrit Orbe pour `http` et `https` dans le
registre de l'utilisateur, mais Windows 10 et 11 n'acceptent le changement que
depuis Paramètres → Applications → Applications par défaut, qu'Orbe ouvre. Pour
qu'Orbe apparaisse dans cette liste comme navigateur à part entière, il faudra
que l'installateur écrive les clés `StartMenuInternet` et
`RegisteredApplications` (capacités `http`, `https`, `.html`). Sans
installateur, c'est à faire à la main.

## Non vérifié sur un vrai poste Windows

Les tests tournent sur une machine d'intégration continue, sans personne
devant l'écran. Restent à voir sur un vrai poste :

- le rendu de Mica (fond translucide) sous Windows 11 ;
- la place des boutons de fenêtre à 125 %, 150 % et 200 % d'échelle ;
- les raccourcis au clavier réel, notamment Ctrl+Alt+… sur les claviers où
  AltGr produit Ctrl+Alt (AZERTY, polonais…) ;
- l'import depuis Arc sur de vraies données d'Arc pour Windows ;
- l'enregistrement comme navigateur par défaut ;
- un installateur et la signature de l'exécutable.

Les tests natifs de `tests/natif` (frappe au clavier réel) restent propres à
macOS.
