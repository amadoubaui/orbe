# Améliorations : vitesse, fluidité, agrément

Liste de contrôle **mesurée** des pistes pour rendre Orbe plus rapide, plus fluide et
plus agréable. Chaque point donne le problème avec un chiffre relevé sur cette machine,
le changement proposé, le gain attendu, le risque, l'effort (S = quelques heures,
M = un à deux jours, L = plus) et un état.

États : ✅ fait et vérifié · 🟡 partiel ou non vérifié · ⬜ à faire · ➖ écarté (avec la raison).

Ce document est un travail de recherche : aucun fichier source d'Orbe n'a été modifié.

## 1. Comment les chiffres ont été pris

| | |
| --- | --- |
| Date | 8 octobre 2026 |
| Machine | MacBook Pro M2 Pro (12 cœurs), 16 Go, macOS 26.4, écran intégré 3456 × 2234 à **120 Hz** (relevé : `screen.getPrimaryDisplay().displayFrequency` = 120) |
| Moteur | Electron 44.7.0 (`~/.orbe-dev`), lancé depuis les sources |
| Code mesuré | branche `main`, commit `9988bbf`, **plus** les modifications en cours dans le dossier pendant la séance (marge de 10 pt, barre latérale à 50 ms, barre de commande ; enregistrées depuis, jusqu'au commit `95b3c75`) — voir la remarque ci-dessous |
| Fenêtre | 1360 × 860 points, barre latérale de 250 points |
| Profils | toujours temporaires (`ORBE_USER_DATA=<dossier temporaire>` + `--selftest`, trousseau factice) ; le vrai profil n'a jamais été ouvert |

**Méthode.** Orbe est lancé par `Electron -r hook.js <dépôt> --selftest` avec
`ORBE_SCENARIO=<scénario>`. `hook.js` (chargé avant `main.js`) chronomètre les `require`,
les appels coûteux et les événements des vues sans toucher au code ; les scénarios pilotent
la fenêtre (`OrbeWindow`, `store`) et lisent :

- les temps : `performance.now()`, `process.getCreationTime()`, `performance.timeOrigin` des pages ;
- la mémoire : `app.getAppMetrics()` pour la liste des processus, puis `/usr/bin/footprint <pid>`
  pour l'empreinte réelle (`phys_footprint`, la colonne « Mémoire » du Moniteur d'activité) ;
- les images réellement affichées : `contentTracing` (catégories `cc`, `benchmark`, `viz`,
  `devtools.timeline`), événements `PipelineReporter` (une image présentée ou perdue) et durées
  `Layout` / `Paint` / `PrePaint` par processus ;
- le travail de la barre latérale : domaine `Performance` du débogueur (`webContents.debugger`) ;
- les pages d'essai : petit serveur local (`127.0.0.1:47811`) — page légère, page « lourde »
  (3 000 cartes en grille), page à 12 cadres avec formulaire de connexion, page à 150 sous-ressources ;
  et 30 vrais sites pour la mémoire.

Pour essayer une variante (ordre d'affichage de la fenêtre, etc.), une **copie jetable** du
dépôt reçoit des interrupteurs par variable d'environnement ; le dépôt lui-même reste intact.
Les scripts sont dans le dossier temporaire de la séance (`perfbench/`), ils ne sont pas dans le dépôt.

**Limites à garder en tête.**

1. *Machine chargée.* D'autres travaux tournaient en même temps (charge moyenne de 6 à 12, avec
   une pointe à 90 vers 16 h 45). Les mesures sont des médianes sur plusieurs passes, et les
   variantes sont comparées en alternance (A, B, A, B…) pour annuler la dérive. Les séries prises
   pendant la pointe (disque, saisie, démarrage avec gros profil) ont été jetées et refaites
   au calme ; seules les valeurs refaites figurent ici.
2. *Démarrage « à froid ».* Un vrai démarrage à froid (après redémarrage du Mac) n'est pas
   reproductible sans droits d'administrateur. Deux situations sont donc données :
   « **à chaud** » (lancements enchaînés) et « **refroidi** » (30 s d'attente entre deux lancements,
   ce qui suffit déjà à doubler tous les temps).
3. *Lancé depuis les sources.* L'application fabriquée (`asar`, fusibles) peut différer de
   quelques dizaines de millisecondes au démarrage : **à mesurer** sur le paquet.
4. *Code en mouvement.* Pendant la séance, le dossier a reçu des réglages d'animation
   (barre latérale : disparition immédiate, retour en 50 ms au lieu de 180 ms). Les mesures
   d'animation sont données pour les **deux** états (commit `9988bbf` et dossier de travail).

## 2. Tableau de bord (état mesuré aujourd'hui)

| Domaine | Mesure | Valeur | Verdict |
| --- | --- | --- | --- |
| Démarrage à chaud | création du processus → fenêtre affichée | **366 ms** (348–439, n = 10) | bon |
| | → barre latérale peinte | 398 ms | bon |
| | → première page peinte (page locale) | 422 ms | bon |
| Démarrage refroidi (30 s) | → fenêtre affichée | **809 ms** (405–1216, n = 6) | à améliorer |
| | → première page peinte | 872 ms | à améliorer |
| Mémoire au repos | fenêtre + 1 onglet léger | **≈ 305 Mo** (286–322), 6 processus | correct |
| | dont processus graphique | 160–183 Mo | normal pour Chromium en Retina |
| | chaque vue d'appoint déjà ouverte | **+18 à 25 Mo** chacune (un processus chacune) | à améliorer |
| Mémoire, vrais sites | 10 sites / 30 sites vivants | **1,87 Go / 3,86 Go** | attendu ; politique de veille à affiner |
| Navigation | surcoût d'Orbe sur une page légère | +0,5 ms sur 6,7 ms | négligeable |
| | page à 12 cadres | **+19 ms sur 31 ms** (+60 %) | à améliorer |
| | page à 150 sous-ressources (bloqueur) | **+14 ms sur 45 ms** (+31 %) | à surveiller |
| Barre latérale | un envoi d'état → image suivante, 50 / 400 / 1 000 onglets | 8,3 / 8,4 / 8,3 ms (une image à 120 Hz) | excellent |
| | défilement, 400 onglets | 333 images présentées, 0 à 1 perdue, cadence 8,33 ms | excellent |
| | reconstruction complète (changer d'Espace), 400 / 1 000 onglets | 24 ms / 40 ms | correct |
| Barre latérale, bascule | commit `9988bbf` : 180 ms | 18–19 positions pour 22 images (≈ 100 pas/s irréguliers) | à améliorer |
| | dossier de travail : 50 ms | 5–6 positions pour 6 images | correct |
| Vue scindée, glisser | 2 pages lourdes | 24–34 images > 25 ms par seconde de glisser | à améliorer |
| Saisie | frappe → suggestions peintes (8 000 visites) | **20–22 ms**, dont 14–15 ms de calcul sur le fil principal | à améliorer |
| | ⌘T → champ peint | 3–6 ms (première fois 19–28 ms) | excellent |
| | changement d'onglet (clic → page visible) | 4,5–5,4 ms + 2–3,5 ms | excellent |
| Disque | `orbe.json` au plafond d'historique | **4,1 à 6,4 Mo** réécrits en entier, deux fois (copie de secours) | à améliorer |
| | blocage du fil principal par sauvegarde | **9–12 ms** (`JSON.stringify`), soit plus d'une image | à améliorer |
| | fréquence en naviguant | 1 écriture toutes les 2 s environ | à améliorer |

Lecture rapide : Orbe est **déjà rapide là où on l'attendait le moins** (rendu de la barre
latérale, changement d'onglet, ⌘T, coût par page). Les vrais gisements sont ailleurs :
l'écriture du fichier d'état, la recherche dans l'historique à chaque frappe, les processus
des vues d'appoint, l'instant où la fenêtre s'affiche, et les animations pilotées par un
minuteur du processus principal.

## 3. Démarrage (DEM)

### Décomposition mesurée

Lancements enchaînés (à chaud), profil d'un onglet, médiane de 10, en millisecondes depuis la
création du processus :

| Étape | À chaud | Refroidi (30 s) |
| --- | --- | --- |
| Entrée dans le code JavaScript (Electron et Chromium ont démarré) | 119 | 299 |
| `app` prête (`ready`) | 165 | 433 |
| Première vue créée (session, fenêtre native, vues) | 252 | 567 |
| Coque : `did-finish-load` | 330 | 770 |
| **Fenêtre affichée** (`win.show()`) | **366** | **809** |
| Barre latérale rendue et peinte | 398 | 845 |
| Première page : `first-contentful-paint` | 422 | 872 |

Ce que fait le processus principal avant la fenêtre (profil CPU par `inspector`, un lancement refroidi) :

| Poste | Temps |
| --- | --- |
| Tous les `require` de `main.js` (20 modules d'Orbe) | **≈ 15 ms** au total ; le plus lourd : `shared/locales.js` 6 ms, `sessions.js` 7,5 ms (avec ses dépendances) |
| `store.load` | 1 ms (profil neuf) ; **17 ms** avec un fichier de 4,9 Mo (400 onglets, 8 500 visites) |
| `sessions.setupDefaultSession` (premier `protocol.handle`, crée la session par défaut) | 7 ms à chaud, **33–42 ms** refroidi |
| `menu.build` | 3–4 ms |
| `new OrbeWindow` | **108 ms** refroidi, dont ≈ 92 ms dans la création native de la fenêtre et 30 ms pour les deux vues d'interface |
| `extensions.loadInto` (asynchrone, ne bloque pas) | 70–140 ms **sans aucune extension installée** |
| `adblock.load` (différé de 1,2 s) | 6 ms pour 24 017 domaines |

Conclusions : (1) le code d'Orbe pèse peu — environ 250 ms à chaud sont pris par Electron et
Chromium eux-mêmes avant et pendant la création de la fenêtre ; (2) entre « première vue créée »
et « fenêtre affichée », 114 ms à chaud et **242 ms refroidi** passent à attendre que la coque
ait fini de charger ; (3) un gros profil (400 onglets, 8 500 visites, 4,9 Mo) retarde la fenêtre de 28 ms (392 contre
364 ms, 6 lancements alternés) et la barre latérale peinte de 37 ms (429 contre 392), dont 17 ms
de `store.load`.

### Variantes essayées (copie jetable, 8 tours en alternance, à chaud)

| Variante | Fenêtre affichée | Barre latérale peinte | Première page peinte |
| --- | --- | --- | --- |
| Référence | 369 | 397 | 427 |
| Afficher la fenêtre tout de suite, sans attendre la coque | **309** (−60) | 389 | **365** (−62) |
| Servir `orbe://` par lecture directe + cache mémoire (sans `net.fetch`) | 368 | 395 | 418 |
| Créer la vue modale après la coque | 373 | 397 | 419 |
| Sans `vibrancy` | 369 | 395 | 416 |
| `v8CacheOptions: 'bypassHeatCheck'` sur les vues d'interface | 371 | 399 | 426 |
| Les trois premières ensemble | **301** (−68) | **373** (−24) | **357** (−70) |

Même comparaison, lancements espacés de 25 s (6 tours, plus bruité) :

| Variante | Fenêtre affichée | Barre latérale peinte | Première page peinte |
| --- | --- | --- | --- |
| Référence | 788 (388–1172) | 819 | 846 |
| Afficher tout de suite, seul | 684 (295–719) | 838 | 806 |
| Les trois ensemble | **604** (356–699) | **700** | **670** |

### Points

- ✅ **DEM-1 — Afficher la fenêtre sans attendre la fin du chargement de la coque.** *(fait le 8 oct.)*
  *Problème* : `OrbeWindow` n'appelle `win.show()` que dans `did-finish-load` de la coque
  (`window.js`, constructeur). La fenêtre est prête 114 ms plus tôt à chaud, 242 ms refroidi.
  Et comme une page cachée ne peint pas, la première page attend aussi.
  *Changement* : appeler `this.layout(); this.win.show();` à la fin du constructeur ; garder
  `sendState()` et `focusContent()` dans `did-finish-load`. La fenêtre a déjà son matériau
  `vibrancy: 'sidebar'` et la page blanche à sa place : on voit la fenêtre vide teintée pendant
  80 ms, puis la barre apparaît (la faire entrer en fondu de 80 ms, voir ANIM-6).
  *Gain mesuré* : fenêtre −60 ms à chaud, −104 ms refroidi ; première page peinte −62 ms à chaud.
  *Risque* : faible ; vérifier qu'aucun test ne compte sur une fenêtre cachée pendant le
  chargement, et que la couleur de fond de l'Espace est posée avant (sinon éclair de couleur).
  *Effort* : S.

- ⬜ **DEM-2 — Servir les fichiers de l'interface sans `net.fetch`, depuis la mémoire.**
  *Problème* : `serveInternal` (`sessions.js`) répond par `net.fetch(file://…)` : une requête
  réseau interne par fichier, 5 fichiers pour la coque, 4 pour chaque vue d'appoint. À chaud
  cela ne coûte rien de mesurable (62 → 57 ms pour charger la coque) ; refroidi, la coque met
  187 ms à charger contre 88 ms pour une page web locale.
  *Changement* : lire le fichier une fois (`fs.readFileSync`), garder le tampon dans une `Map`,
  répondre `new Response(buf, { headers: { 'content-type': … } })`. Vider le cache en développement
  (variable d'environnement) pour garder le rechargement à la volée.
  *Gain mesuré* : nul seul à chaud ; **avec DEM-1 et DEM-3**, refroidi : barre latérale peinte
  −119 ms, première page −176 ms (la part exacte de DEM-2 n'a pas été isolée refroidi : **à mesurer**).
  *Risque* : faible (types MIME à déclarer à la main ; 6 extensions de fichier). *Effort* : S.

- ⬜ **DEM-3 — Ne créer la vue modale qu'après l'affichage de la coque.**
  *Problème* : `overlay.html#modal` est créée dans le constructeur, en même temps que la coque :
  un second processus de rendu démarre en concurrence au pire moment (18 Mo, voir MEM-1).
  *Changement* : la créer dans `did-finish-load` de la coque (`setTimeout(…, 0)`), ou mieux la
  faire naître de la coque (MEM-1), ce qui ne coûte que 15 ms.
  *Gain mesuré* : nul seul à chaud ; fait partie du lot « les trois ensemble ». *Risque* : ⌘T
  tapé dans les 100 premières millisecondes doit attendre la vue (file d'attente d'un message).
  *Effort* : S.

- ⬜ **DEM-4 — Sortir l'historique du fichier lu au démarrage.**
  *Problème* : avec 8 500 visites (plafond de `store.js`), `store.load` passe de 1 ms à
  **17 ms**, en bloquant, avant toute fenêtre. *Changement* : voir PERF-1 (historique dans un
  fichier à part, lu après l'affichage). *Gain* : ≈ −17 ms sur les profils anciens.
  *Risque / effort* : ceux de PERF-1.

- ⬜ **DEM-5 — Ne rien faire pour les extensions quand il n'y en a pas.**
  *Problème* : `extensions.loadInto` prend 70–140 ms (asynchrone) sur un profil sans extension.
  Il ne bloque pas le fil principal, mais il occupe le disque et la session pendant le
  chargement de la première page. *Changement* : sortir tout de suite de `sync(ses)` si le
  dossier `Extensions` n'existe pas ou si l'état ne liste rien ; sinon lancer la synchronisation
  après `did-finish-load` de la coque. *Gain* : **à mesurer** sur la première page (l'effet n'a
  pas été isolé). *Risque* : une extension dont le script de contenu doit agir sur la toute
  première page restaurée la raterait si le chargement est différé : ne différer que le cas
  « aucune extension ». *Effort* : S.

- ➖ **DEM-6 — Cache de code V8 / instantané V8 pour le processus principal.** Écarté :
  les 20 modules d'Orbe se chargent en ≈ 15 ms au total ; `v8CacheOptions` sur les vues
  d'interface ne change rien (371 contre 369 ms). Un instantané (`electron-mksnapshot`)
  gagnerait au mieux une dizaine de millisecondes pour une chaîne de fabrication bien plus fragile.

- ➖ **DEM-7 — Retirer `vibrancy` pour démarrer plus vite.** Écarté : aucune différence
  mesurée (369 contre 369 ms) ; la création de la fenêtre native coûte le même prix sans.

- ⬜ **DEM-8 — Mesurer le paquet distribué.** Les chiffres ci-dessus viennent des sources.
  *À mesurer* : même scénario sur `Orbe.app` fabriquée, avec `--orbe-test` et un profil à part
  (prévu par `testModeAllowed()`), pour vérifier l'effet de l'archive `asar` et des fusibles.
  *Effort* : S.

## 4. Mémoire (MEM)

### Relevé par processus (empreinte réelle, Mo)

Au repos (fenêtre + 1 onglet local léger) :

| Processus | Empreinte |
| --- | --- |
| Principal (navigateur) | 55–58 |
| Graphique (GPU) | 160–183 (deux paliers, sans lien avec les variantes) |
| Réseau | 8–10 |
| Coque (barre latérale) | 24 |
| Vue modale préchargée (cachée) | 16–18 |
| Onglet léger | 17–19 |
| **Total** | **286–322** |

Vues d'appoint, créées à la demande et **jamais détruites ensuite** (un processus chacune) :

| Vue | Empreinte du processus | Délai de première ouverture | Ouvertures suivantes |
| --- | --- | --- | --- |
| Notification (toast) | 18–19 | 94–98 ms | 16–23 ms |
| Recherche dans la page | 18–20 | 82–94 ms | 13–20 ms |
| Adresse du lien survolé | 18–20 | ≈ 95 ms | — |
| Zone de dépôt (vue scindée) | 18–19 | ≈ 78 ms | — |
| Habillage de l'aperçu (Peek) | 17–18 | 89–90 ms | 21–24 ms |
| Barre latérale flottante | 24–25 | ≈ 80 ms | — |
| **Les six, plus la modale** | **≈ 130 Mo** dans 7 processus | | |

Après quelques minutes d'usage normal (un lien survolé suffit à créer la vue « statut »),
le total au repos passe donc de ≈ 305 à **≈ 480–490 Mo** (mesuré : 478 et 492), processus
graphique compris.

Onglets :

| Situation | Total | Processus | Par onglet |
| --- | --- | --- | --- |
| 10 onglets locaux (même site) | 864–866 Mo | 21 | 32–34 Mo ; un processus par onglet, même pour un même site |
| 30 onglets locaux | 1 516–1 533 Mo | 41 | idem |
| 1 vrai site (Wikipédia) | 658 Mo | 13 | |
| **10 vrais sites** | **1 874 Mo** | 25 | 30 à 243 Mo, moyenne ≈ 106 Mo |
| **30 vrais sites** | **3 863 Mo** | 47 | moyenne ≈ 96 Mo |
| 30 sites, puis veille à 8 vivants | 1 699 Mo | 25 | 4 processus de rendu sans vue restent (249 Mo) |

Le processus principal grossit avec le nombre d'onglets : 55 Mo au repos, 131–159 Mo à 30 onglets.

Chrome et Arc n'ont pas été mesurés : les lancer proprement demande un profil vierge et
plusieurs minutes de chargement identique ; **à mesurer** si la comparaison est voulue
(`--user-data-dir=<temporaire>` pour Chrome ; Arc n'a pas d'option de profil à part, donc non).

### Essai : faire naître les vues d'appoint de la coque

Dans un scénario, la coque ouvre elle-même ses vues (`window.open('orbe://app/overlay.html#toast')`)
et `setWindowOpenHandler` renvoie `{ action: 'allow', overrideBrowserWindowOptions: { webPreferences: { preload: UI_PRELOAD, sandbox: true, contextIsolation: true } }, createWindow: (options) => new WebContentsView(options).webContents }`.
Résultat mesuré pour six vues (modale, toast, recherche, statut, dépôt, aperçu) :

| | Aujourd'hui (un processus par vue) | Vues nées de la coque |
| --- | --- | --- |
| Processus supplémentaires | 6 | **0** (même identifiant de processus que la coque) |
| Mémoire supplémentaire | ≈ 110 Mo | **+11 Mo** (coque : 25 → 36 Mo) |
| Délai de première ouverture | 75–178 ms | **7–15 ms** |
| Pont `window.orbe` et messages `overlay` | oui | oui (vérifié : la notification s'affiche) |

### Points

- ⬜ **MEM-1 — Un seul processus de rendu pour toute l'interface d'Orbe.**
  *Problème* : chaque vue d'appoint (`makeUiView`) démarre son propre processus : +18 à 25 Mo
  chacune, ≈ 130 Mo pour les sept, et 80–100 ms d'attente à la première ouverture.
  *Changement* : dans `makeUiView(page)`, pour tout sauf la coque, demander à la coque
  d'ouvrir la page (`ui.webContents.executeJavaScript('void window.open(…)')` ou un message
  `open-view`) et récupérer la vue dans `createWindow` du `setWindowOpenHandler` de la coque
  (aujourd'hui `deny`). Garder `trusted.add`, `wcOwner.set`, `will-navigate` et l'interdiction
  d'ouvrir d'autres fenêtres sur la vue fille. Création devenue asynchrone : renvoyer une
  promesse, ou créer les vues au repos après le démarrage puisqu'elles ne coûtent plus que 2 Mo.
  *Gain mesuré* : **≈ −100 Mo** après quelques minutes d'usage, première ouverture 6 à 20 fois
  plus rapide, démarrage allégé d'un processus (la modale).
  *Risque* : moyen. Toutes les vues partagent alors un seul fil : une barre latérale occupée
  retarderait la barre de commande (mesuré : le rendu de la barre coûte 0,04 à 0,4 ms, donc
  sans effet) ; un plantage de ce processus emporte toute l'interface (prévoir de la recréer
  sur `render-process-gone`) ; `window.opener` devient visible entre vues de confiance (même
  origine `orbe://app`, pas de fuite). La barre latérale flottante peut rester à part ou suivre.
  *Effort* : M.

- ⬜ **MEM-2 — À défaut de MEM-1 : détruire les vues d'appoint inactives.**
  *Problème* : toast, recherche, statut, dépôt, habillage d'aperçu et barre flottante vivent
  jusqu'à la fermeture de la fenêtre. *Changement* : fermer chaque vue 60 s après son dernier
  usage (`webContents.close()`), sauf la modale. *Gain* : jusqu'à ≈ 110 Mo rendus ; *coût* :
  80–100 ms à la réouverture suivante (mesuré), sensible pour l'adresse du lien survolé.
  *Risque* : faible. *Effort* : S. Sans objet si MEM-1 est fait.

- ⬜ **MEM-3 — Mettre en veille selon la mémoire et l'ancienneté, pas seulement le nombre.**
  *Problème* : `trimLive()` ne compte que les onglets (`maxLiveTabs` = 30 par défaut). Trente
  vrais sites = 3,86 Go ; un seul onglet va de 30 à 243 Mo. Sur un Mac de 8 Go, 30 est trop.
  *Changement* : (a) à l'activation et toutes les 60 s, lire `app.getAppMetrics()` et mettre
  en veille les onglets les plus anciens tant que la somme des processus d'onglets dépasse un
  budget (par exemple 25 % de `os.totalmem()`), en plus de la limite en nombre ; (b) mettre en
  veille un onglet non vu depuis N heures même sous la limite ; (c) ne jamais toucher un onglet
  audible, épinglé affiché, ou avec les outils de développement (déjà le cas).
  *Gain mesuré* : passer de 31 à 8 vivants rend **2,16 Go** (3 863 → 1 699 Mo).
  *Risque* : un onglet réveillé recharge sa page (167 ms pour une page locale lourde, plus le
  réseau) et perd un formulaire en cours : ne pas mettre en veille un onglet dont un champ a
  été modifié (drapeau posé par le script de page) — **à concevoir**. *Effort* : M.

- ⬜ **MEM-4 — Vérifier les processus qui survivent à la mise en veille.**
  *Problème* : après `trimLive` (23 vues détruites), **4 processus de rendu sans vue** restent,
  pour 249 Mo ; il y en avait déjà 3 (219 Mo) avec 30 sites ouverts. Probablement des cadres
  d'autres sites ou des service workers encore actifs. *À mesurer* : relever leur adresse
  (`webFrameMain`, `ses.serviceWorkers.getAllRunning()`), attendre 60 s pour voir s'ils partent
  seuls. *Changement possible* : arrêter les service workers d'un site quand son dernier onglet
  est mis en veille. *Effort* : S pour le diagnostic.

- ⬜ **MEM-5 — Capture pour ⌃Tab : ne garder qu'un nombre borné de vignettes.**
  *Mesure* : une vignette pèse 23 Ko en base64 (JPEG 320 px) : négligeable par onglet, et
  `resize` + `toJPEG` bloquent le fil principal 3,1 ms par changement d'onglet. Rien d'urgent ;
  borner à 8 (la bascule n'en montre pas plus) évite tout de même de garder des chaînes pour
  30 onglets. *Effort* : S. *Gain* : faible.

- ⬜ **MEM-6 — Processus par site : à mesurer avant d'y toucher.**
  *Constat* : dix onglets du même site occupent dix processus (10 × 32–34 Mo). Chrome fait de
  même sauf sous pression mémoire. `app.commandLine.appendSwitch('renderer-process-limit', N)`
  force le partage au-delà de N processus. *À mesurer* : mémoire et fluidité avec une limite de
  12 puis 20 sur les 30 sites réels ; risque connu : un onglet lourd ralentit ses voisins.
  Ne pas livrer sans mesure. *Effort* : S pour l'essai.

- ➖ **MEM-7 — `backgroundThrottling: false`.** Écarté : le réglage par défaut (ralentissement
  des vues cachées) est le bon pour un navigateur ; le couper augmenterait la consommation des
  onglets non affichés sans rien rendre plus fluide.

## 5. Coût par navigation (PERF, première partie)

Mesure : une vue neuve par configuration (même session que les onglets), 14 tours en
alternance ; temps de `loadURL` jusqu'à `did-finish-load`, médiane (et 90ᵉ centile), en ms.

| Configuration | Page légère | Page mixte (400 cartes, 4 cadres, 60 images) | 12 cadres avec formulaire | 150 sous-ressources |
| --- | --- | --- | --- | --- |
| A. Tel que livré | 7,26 (7,93) | 36,6 (40,0) | 49,3 (53,4) | 59,2 (69,8) |
| B. Sans `page.js` (mots de passe) | 7,40 | 34,5 | 46,1 | 57,7 |
| C. Sans `ext.js` (extensions) | 6,89 | 35,2 | 47,2 | 56,7 |
| D. Sans aucun script de préchargement | 6,72 | 34,2 | 45,8 | 55,1 |
| E. Sans `nodeIntegrationInSubFrames` | 7,06 | 31,5 | 41,5 | 56,2 |
| F. Bloqueur coupé | 6,50 | 33,3 | 39,2 | **45,0** |
| G. Rien du tout (D + E + F) | 6,24 | 27,5 | **30,7** | 44,3 |

Création d'un processus de rendu et première page : 70–75 ms dans tous les cas (aucun effet des réglages).
`first-contentful-paint` : identique à 4 ms près dans toutes les configurations.
Décision du bloqueur elle-même (`adblock.decide`) : **0,25 µs** par requête (100 000 appels).

Lecture :

- sur une page sans cadre, les deux scripts de préchargement coûtent **0,5 ms** : rien à faire ;
- sur une page à 12 cadres, Orbe ajoute 19 ms (+60 %) : ≈ 8 ms pour exécuter les scripts dans
  les sous-cadres, ≈ 10 ms pour le passage de chaque requête par le bloqueur, ≈ 3,5 ms pour
  les scripts eux-mêmes ;
- le bloqueur coûte ≈ **0,09 ms par requête** (14 ms pour 150), et ce n'est pas la recherche
  dans la liste : c'est l'aller-retour entre le service réseau et le JavaScript du processus
  principal imposé par `webRequest.onBeforeRequest`.

### Points

- ⬜ **PERF-10 — `ext.js` : ne plus l'exécuter dans les pages web.**
  *Problème* : `ext-api.js` enregistre `ext.js` (555 lignes) comme script de préchargement de
  type `frame` sur toute la session ; il se charge donc dans **chaque cadre de chaque page**
  pour constater, à sa dernière ligne, qu'il n'est pas dans une page d'extension. Coût mesuré :
  ≈ 2 ms sur la page à 12 cadres, 0,4 ms sur une page simple.
  *Changement* : faire le test en tête de fichier (`if (!inWorker && location.protocol !== 'chrome-extension:') return;`
  avant toute déclaration, dans une fonction englobante) pour que V8 n'ait rien à préparer ;
  ou, mieux, ne plus l'enregistrer sur la session mais le donner en `preload` aux seules vues
  d'extension (fenêtre surgissante, options, panneau) et garder l'enregistrement
  `service-worker`. *Gain* : 2 à 4 % sur les pages à cadres. *Risque* : faible si les pages
  d'extension ouvertes dans un onglet gardent le script (à tester avec `tests/ext-api.js`).
  *Effort* : S.

- ⬜ **PERF-11 — `page.js` : rester inerte tant qu'aucun champ de mot de passe n'existe.**
  *Problème* : dans chaque cadre, le script pose 12 écouteurs globaux (dont `scroll` en capture,
  `mousedown`, `keydown`, `input`, `click`) ; coût mesuré ≈ 3 ms sur 12 cadres. Chaque défilement
  de chaque page appelle `hide`.
  *Changement* : au chargement, ne poser que `focusin` (capture) et `submit` ; installer le reste
  à la première prise de focus dans un `input`. Ne rien poser du tout dans un cadre de moins de
  quelques pixels ou d'origine opaque (`about:blank`, publicités). *Gain* : ≈ −3 ms sur les
  pages à cadres, et plus aucun écouteur de défilement sur les pages sans formulaire.
  *Risque* : moyen (les mots de passe ont une batterie de tests : `tests/passwords.js`,
  `passwords-sites.js`). *Effort* : M.

- ⬜ **PERF-12 — `nodeIntegrationInSubFrames` : confirmer qu'il reste nécessaire.**
  *Mesure* : le retirer gagne 8 ms sur la page à 12 cadres (49,3 → 41,5), 5 ms sur la page
  mixte. Il sert à remplir les formulaires de connexion placés dans un cadre.
  *Changement possible* : le garder (la fonction prime), mais combiner avec PERF-10 et PERF-11
  pour que ce qui s'exécute dans chaque sous-cadre soit minimal ; re-mesurer ensuite.
  *Effort* : S (mesure).

- ⬜ **PERF-13 — Bloqueur : réduire le nombre de requêtes qui montent jusqu'au JavaScript.**
  *Problème* : chaque requête http(s)/ws de chaque page fait un aller-retour par le fil
  principal : 0,09 ms pièce, et surtout autant de travail sur le fil qui anime les vues
  (une page d'actualité fait 200 à 400 requêtes).
  *Changements possibles, du plus simple au plus lourd* :
  (a) restreindre le filtre `FILTER.urls` n'apporte rien (il faut tout voir) — écarté ;
  (b) répondre plus vite ne change rien non plus (0,25 µs) ;
  (c) **à mesurer** : charger la liste comme règles `declarativeNetRequest` d'une extension
  interne, si Electron 44 les applique (Chromium filtre alors dans le service réseau, sans
  JavaScript). Vérifier d'abord la prise en charge réelle : l'étude `docs/etude-extensions-et-distribution.md`
  est le bon endroit pour la consigner.
  *Gain attendu* : jusqu'à −14 ms par tranche de 150 requêtes et un fil principal plus calme
  pendant les chargements. *Risque* : élevé si (c) (le compteur par onglet et la liste
  d'exceptions reposent sur l'écouteur actuel). *Effort* : L. À ne lancer qu'après les points S et M.

## 6. Écriture sur disque (PERF, deuxième partie)

Mesure dans le processus principal, sur des états fabriqués (titres et adresses réalistes,
une part d'icônes `data:` de moins de 2 Ko, que `lightIcon` autorise) :

| État | Taille du fichier | `JSON.stringify` (bloque le fil principal) | `write()` complet | `flush()` à la fermeture | Lecture + analyse au démarrage |
| --- | --- | --- | --- | --- | --- |
| Profil neuf | 4 Ko | 0,02 ms | 0,8 ms | 0,2 ms | 0,04 ms |
| 1 000 visites | 487 Ko | 0,8 ms | 2,6 ms | 2,0 ms | 1,3 ms |
| 4 000 visites | 1,9 Mo | 3,4 ms | 9,7 ms | 7,0 ms | 4,9 ms |
| 8 500 visites (plafond), 10 % d'icônes `data:` | **4,1 Mo** | **9,3 ms** (90ᵉ centile 10,5) | 24,5 ms | 19,9 ms | 12,6 ms |
| 8 500 visites, 30 % d'icônes `data:` | **6,4 Mo** | **12,1 ms** (90ᵉ centile 12,9) | 29,9 ms | 24,3 ms | 16,9 ms |

| Découpage | Taille | `JSON.stringify` |
| --- | --- | --- |
| Tout sauf l'historique | 381 Ko | 0,2–0,8 ms |
| Onglets, Espaces, réglages seuls (sans historique, archive ni téléchargements) | 4 Ko (profil d'essai) | 0,01 ms |
| Une ligne ajoutée à un journal (`appendFile`, ≈ 220 octets) | — | 0,03 ms synchrone, 0,1 ms asynchrone |

Fréquence : 12 navigations en 11,5 s déclenchent 48 appels à `store.save()` et **6 écritures
complètes**, soit une toutes les 2 s. Sur un profil ancien, naviguer coûte donc environ
**9 à 12 ms de blocage du fil principal toutes les 2 secondes** (une à deux images perdues à
120 Hz pour tout ce que ce fil anime : bascule de la barre, glisser de la séparation ; trois
fois plus sur une machine chargée, mesuré : 31 ms) et 130 à 200 Mo écrits par minute de
navigation active — le double en comptant la copie `.bak` refaite à chaque écriture.

### Points

- ✅ **PERF-1 — Historique dans son propre fichier, en journal d'ajouts.** *(fait le 8 oct. : history.json à part, écrit au plus toutes les 20 s)*
  *Problème* : voir ci-dessus ; l'historique fait 90 % du fichier et change à chaque page.
  *Changement* (`store.js`) :
  1. `orbe.json` ne contient plus `history` (ni, dans un second temps, `archive`).
  2. `history.log` : une ligne JSON par événement (`{"u":url,"t":titre,"f":icône,"a":date}`),
     ajoutée par `fs.appendFile` ; `visit()` et `touchHistory()` écrivent une ligne au lieu
     d'appeler `save()`.
  3. Au démarrage, **après** l'affichage de la fenêtre : lire le journal, reconstruire la table
     en mémoire (dernier gagne, compteur de visites cumulé), puis, s'il dépasse 2 fois la taille
     utile, le réécrire compacté (`history.log.tmp` puis `rename`).
  4. Migration : au premier lancement, si `orbe.json` contient `history`, l'écrire en journal
     et le retirer ; garder `orbe.json.bak` tel quel.
  5. `lib:clear` et « effacer les données » tronquent le journal.
  *Gain mesuré* : blocage par sauvegarde **9–12 ms → 0,2–0,8 ms**, écriture 4,1–6,4 Mo → 0,4 Mo,
  démarrage −17 ms (DEM-4), une visite = 0,03 à 0,1 ms.
  *Risque* : moyen — format de données, donc migration et retour arrière à tester ; une ligne
  tronquée par une coupure de courant doit être ignorée à la lecture (`try { JSON.parse }` par
  ligne). Pas de base SQLite, pas de dépendance. *Effort* : M.

- ✅ **PERF-2 — Ne pas sauvegarder l'état pour un simple changement de titre ou d'icône.** *(fait le 8 oct.)*
  *Problème* : `wire()` appelle `touch()` (donc `store.save()`) sur `page-title-updated`,
  `page-favicon-updated` et chaque `did-navigate-in-page` : 4 appels par page en moyenne (48
  pour 12 pages). Le regroupement à 1,5 s les réduit à une écriture toutes les 2 s, mais c'est
  encore un fichier entier. *Changement* : allonger le délai à 5 s pour ces causes « cosmétiques »
  (`save({ lazy: true })`), garder 1,5 s pour les changements de structure (onglet créé, fermé,
  déplacé), et `flush()` à la fermeture comme aujourd'hui. *Gain* : écritures divisées par 2 à 3
  en navigation. *Risque* : après un plantage, un titre d'onglet peut dater de 5 s. *Effort* : S.
  Complète PERF-1, ne le remplace pas.

- ✅ **PERF-3 — `write()` : ne pas recopier le fichier à chaque fois.** *(fait le 8 oct.)*
  *Problème* : chaque écriture fait `writeFile(tmp)` + `copyFile(orbe.json → .bak)` + `rename` :
  le fichier est écrit **deux fois** (24,5 ms au total pour 4,1 Mo, dont 9,3 de `stringify`).
  *Changement* : remplacer la copie par `rename(orbe.json → .bak)` puis `rename(tmp → orbe.json)`,
  ou ne rafraîchir `.bak` qu'une fois par session. *Gain* : moitié des octets écrits.
  *Risque* : faible (entre les deux `rename`, seul `.bak` existe : `load()` le lit déjà en secours).
  *Effort* : S.

## 7. Saisie et réactivité (PERF, troisième partie)

| Geste | Mesure | Valeur |
| --- | --- | --- |
| ⌘T | `openCommand()` → champ visible et peint | 3,1–6,4 ms (90ᵉ centile 8,6–12 ; première fois 19–28 ms) |
| Frappe dans la barre de commande | événement clavier → `input` dans la vue | 1,3 ms |
| | → liste de suggestions peinte | **19,6–21,8 ms** (90ᵉ centile 26–27 ; max 31) |
| | dont `suggestLocal` sur le fil principal (8 000 visites, 2 000 archives) | **14,1–15,4 ms** (90ᵉ centile 19–20 ; max 21–24) |
| | suggestions du moteur de recherche (Google, réseau) | 174 ms (90ᵉ centile 264) |
| `suggest.local` selon l'historique | 500 / 2 000 / 8 000 visites | 0,6 / 2,9 / 10,2 ms |
| Changement d'onglet | `activate()` (synchrone) | 4,5–5,4 ms (max 11) |
| | → première image de la page affichée | +2,2 à 3,5 ms (90ᵉ centile 5–11) |
| | capture pour la vignette : `capturePage` | 4,9–6,2 ms (asynchrone) |
| | réduction + JPEG sur le fil principal | 2,9–3,1 ms |
| Changement d'Espace | `switchSpace()` puis image de la page | 3–4 ms + 2 ms |
| Réveil d'un onglet en veille | clic → première peinture (page locale lourde) | 167–183 ms |

Deux séries (les fourchettes donnent les deux médianes) ; elles concordent.

### Points

- ✅ **PERF-4 — Barre de commande : index de recherche normalisé, calculé une fois.** *(fait le 8 oct.)*
  *Problème* : à chaque frappe, `suggest.local` parcourt tout l'historique et recalcule pour
  chaque entrée `norm(strip(url))` et `norm(title)` (minuscules + décomposition Unicode +
  expression régulière) : 14–15 ms de blocage du fil principal par caractère tapé avec 8 000
  visites, soit presque deux images à 120 Hz.
  *Changement* : garder à côté de chaque entrée ses deux chaînes normalisées, calculées à la
  première recherche et invalidées quand le titre change (une `WeakMap` suffit) ; même chose
  pour l'archive et les onglets.
  *Gain mesuré* (micro-essai Node sur la seule boucle d'historique, 8 003 entrées, mêmes
  résultats vérifiés) : **7,0–7,5 ms → 1,2–1,4 ms** par frappe, soit 5 à 6 fois moins ; dans
  l'application, où s'ajoutent l'archive et les onglets, attendre 15 → environ 3 ms.
  *Risque* : faible. *Effort* : S.

- ⬜ **PERF-5 — Barre de commande : recherche incrémentale.**
  *Problème* : taper « navig » relance cinq recherches complètes. *Changement* : si la nouvelle
  saisie prolonge la précédente, ne filtrer que les résultats de la précédente (garder la liste
  des entrées retenues, pas seulement les 8 premières). *Gain attendu* : chaque frappe après la
  première passe sous 1 ms ; **à mesurer** après PERF-4. *Risque* : faible. *Effort* : S.

- ⬜ **PERF-6 — Ne pas attendre le processus principal pour afficher la frappe complétée.**
  *Constat* : l'aller-retour `invoke('suggest')` coûte 5 ms hors calcul. Une fois PERF-4 et
  PERF-5 faits, la frappe → peinture devrait tomber vers 8 ms (une image). Si ce n'est pas le
  cas, envoyer à la vue modale, à l'ouverture, les 300 entrées les plus fréquentes pour une
  première réponse locale immédiate. **À décider après mesure.** *Effort* : M.

- ➖ **PERF-7 — Accélérer le changement d'onglet.** Écarté : 5,4 ms + 3,5 ms, c'est une image.
  Rien à gagner tant que l'onglet est vivant ; le sujet est la veille (MEM-3).

- ⬜ **PERF-8 — Pré-réveiller l'onglet survolé.**
  *Problème* : un onglet en veille met 167 ms (local) à plusieurs secondes (réseau) à revenir.
  *Changement* : quand le pointeur reste 150 ms sur une ligne d'onglet en veille, créer sa vue
  en arrière-plan (`ensureView`) sans l'afficher. *Gain attendu* : le clic qui suit trouve la
  page déjà en cours de chargement (−150 à −300 ms ressentis) ; **à mesurer**. *Risque* : charge
  réseau inutile si l'utilisateur ne clique pas ; borner à un pré-réveil à la fois et annuler
  après 10 s. *Effort* : S.

## 8. Rendu de la barre latérale (PERF, quatrième partie)

| Mesure | 50 onglets | 400 onglets | 1 000 onglets |
| --- | --- | --- | --- |
| Nœuds DOM de la coque | 2 057 | 14 307 | 35 307 |
| `sendState()` côté principal | 0,15 ms | 0,49 ms | 1,04 ms |
| Taille de l'état envoyé | 18 Ko | 144 Ko | 359 Ko |
| `render()` sans changement (JavaScript seul) | 0,04 ms | 0,16 ms | 0,38 ms |
| Un titre change : script / style / mise en page | 0,06 / 0,15 / 0,27 ms | 0,03 / 0,08 / 0,24 ms | 0,03 / 0,11 / 0,51 ms |
| Un titre change : tâche complète (désérialisation comprise) | 1,9 ms | 2,3 ms | 5,1 ms |
| Envoi → image suivante | 8,3 ms | 8,4 ms | 8,3 ms |
| Changer d'Espace (toutes les lignes recréées) → image | 12 ms | 24 ms | 40 ms |
| Défilement 1,6 s : images présentées / perdues | 69 / 0 | 333 / 1 | 330 / 0 |
| Défilement : cadence médiane (90ᵉ centile) | 8,33 (16,7) ms | 8,33 (8,33) ms | 8,33 (8,33) ms |
| Défilement : test d'atteinte (`HitTest`) par appel | 0,03 ms | 0,17 ms | 0,38 ms |
| Défilement : observateur d'intersection (images paresseuses) | 5,8 ms | 51,6 ms | 124,6 ms |

Effet des habillages pendant le défilement (400 onglets) : translucide coupé, grain à 0,3,
dégradé + grain — **aucune différence mesurable** (333 à 339 images présentées, 0 ou 1 perdue,
même cadence). `color-mix`, le grain SVG et le fond translucide ne coûtent rien de visible.

Conclusion : la barre latérale tient 120 images par seconde jusqu'à 1 000 onglets. La
réconciliation par clé de `shell.js` et `content-visibility: auto` font leur travail. Il n'y a
**pas lieu de virtualiser la liste**.

### Points

- ➖ **PERF-20 — Virtualiser la liste d'onglets.** Écarté : 0 à 1 image perdue sur 330 à
  1 000 onglets, rendu à 0,38 ms.

- ➖ **PERF-21 — Retirer `color-mix`, le grain ou la translucidité pour la vitesse.** Écarté :
  aucun effet mesuré.

- ⬜ **PERF-22 — État envoyé : ne transmettre que ce qui a changé au-delà de 300 onglets.**
  *Problème* : 144 Ko (400 onglets) à 359 Ko (1 000) sérialisés, envoyés et désérialisés à
  chaque changement, même pour un compteur de publicités bloquées ; la tâche complète monte à
  5 ms à 1 000 onglets. *Changement* : ne pas envoyer deux fois de suite un état identique
  (comparer la chaîne JSON ou un condensé) ; séparer l'état « navigation » (adresse, chargement,
  compteur du bouclier), qui change souvent, de l'état « listes ». *Gain* : 2 à 5 ms par envoi
  sur les très gros profils ; nul en dessous de 100 onglets. *Risque* : faible. *Effort* : M.
  Priorité basse.

- ➖ **PERF-23 — Limiter les envois d'état pendant le chargement d'une page.** Écarté après
  mesure sur cinq vrais sites (compteur posé sur `sendState`, du début du chargement à 3 s après
  la fin) : Le Monde 5 envois, YouTube 6, Wikipédia 4, GitHub 7, BBC News 17 ; au plus **6 par
  seconde**, 1 à 3 en moyenne. Le regroupement par `setImmediate` et les 250 ms du compteur du
  bloqueur suffisent.

- ⬜ **PERF-24 — Icônes : ne pas demander `/favicon.ico` aux sites jamais chargés.**
  *Constat* : `guessIcon` fait demander par la coque `origine/favicon.ico` pour chaque onglet
  sans icône connue ; avec 400 onglets restaurés, c'est autant de requêtes réseau (et d'erreurs)
  au fil du défilement, et c'est l'observateur d'intersection de ces images qui pèse le plus
  pendant le défilement (52 ms sur 1,6 s à 400 onglets). *Changement* : mémoriser l'icône par
  hôte dans l'état (table `hôte → adresse d'icône`, alimentée par `page-favicon-updated`) et
  n'essayer `/favicon.ico` qu'une fois par hôte et par session. *Gain* : moins de requêtes, un
  défilement encore plus léger ; **à mesurer** en nombre de requêtes. *Effort* : S.

- ✅ **PERF-25 — Glisser un onglet : relever la géométrie une fois, écarter par transformation.**
  *Constat* : à chaque mouvement du glisser, `dropTarget` relisait le rectangle de chaque ligne
  jusqu'à la cible, cherchait `.drop-into` dans tout le document, puis déplaçait le trait de dépôt
  par `left`/`top` : une mise en page relancée à chaque changement de cible. *Changement* (avec
  ANI-22 : les lignes s'écartent sous l'onglet déplacé) : les positions des lignes sont relevées
  une seule fois par glisser (`measure`), le pointeur est ensuite comparé à ce relevé ; les lignes
  et la place libre ne bougent que par `transform`, et seules celles dont le décalage change sont
  touchées. Une transformation neutre est posée dès le départ (`body.parting`), car passer de
  « aucune » à un décalage relançait la mise en page à chaque ligne. *Mesure* (Playwright, vrai
  glisser de trois allers-retours sur la hauteur de la barre, 404 lignes dans Aujourd'hui ;
  coût = temps entre un écouteur en capture et un écouteur en fin de propagation sur `window` ;
  mises en page et styles par le domaine `Performance` du débogueur ; cadence par
  `requestAnimationFrame` ; `tests/ui/17-ecarter.js` refait la mesure à chaque passage) :

  | 404 lignes | Avant (trait) | Après (lignes écartées) |
  | --- | --- | --- |
  | Coût moyen d'un mouvement (`dragover`) | 0,14 ms | 0,012 à 0,021 ms |
  | 95ᵉ centile / maximum | 0,6 / 0,8 à 1,5 ms | 0,1 / 0,1 à 0,2 ms (limite de l'horloge) |
  | Mises en page pendant le geste | 55 (3,7 ms) | 0 |
  | Recalculs de style | 162 (9 ms) | 336 à 346 (32 à 41 ms, soit 0,1 ms l'un) |
  | Script pendant le geste | 54 à 57 ms | 8 à 12 ms |
  | Cadence médiane / 95ᵉ centile | 8,3 / 9,2 ms | 8,3 / 9,2 ms |
  | Images de plus de 25 ms | 0 | 0 |

  Le relevé initial (404 rectangles lus d'un coup, au premier survol) n'est pas dans ces
  chiffres : il a lieu une fois par glisser. *Reste* : avec des favoris vides, leur zone de
  dépôt s'ouvre au départ du glisser et décale toute la colonne de 52 points sous le pointeur
  (comportement antérieur, non modifié) ; les épinglés vides, eux, ne s'agrandissent plus.

## 9. Animations des vues natives (ANIM)

### Bascule de la barre latérale

`animateTo` (`window.js`) déplace la page par `setBounds` sur un `setInterval(…, 8)`.

| Mesure | Commit `9988bbf` (180 ms) | Dossier de travail (ouverture 50 ms, fermeture immédiate) |
| --- | --- | --- |
| Intervalle réel du minuteur de 8 ms | **10,1 ms** médian (8,2–11,1 ; 250 tics) | idem |
| Appels à `layout()` par animation | 18–19 | 6 (ouverture), 1 (fermeture) |
| Positions distinctes de la page | 16–17 pour **22 images** d'écran | 5–6 pour 6 images |
| Écart maximal entre deux positions | 12 à 21 ms (soit 1,5 à 2,5 images) | 12 à 17 ms |
| Coût de `layout()` côté principal | 0,09 ms médian, 1,6–2,0 ms au total | 0,3 ms, 0,7 ms au total |
| Remises en page de la page | 1 (la largeur ne change qu'une fois : bien vu) | 1 |
| Durée de cette remise en page | 3 ms (page légère), **20–24 ms** (page lourde) | idem |
| Images de la page > 25 ms pendant l'animation | 0 (légère), **1** (lourde, 32–38 ms) | 1 (lourde, 37–40 ms) |
| Images de la coque (transition CSS) | 22 présentées, 0 perdue, 8,33 ms | 6–7, 0 perdue |

Deux défauts mesurés : (1) le minuteur du processus principal bat à ≈ 100 Hz avec de la gigue,
alors que l'écran et la transition CSS de la barre sont à 120 Hz réguliers : la page et la
barre n'avancent pas au même pas, et une image sur cinq répète la position précédente ;
(2) sur une page lourde, l'unique remise en page (20–24 ms) tombe **au début** du mouvement et
fait sauter deux ou trois images au moment le plus visible.

### Essai : animation native de `View.setBounds`

`electron.d.ts` (44.7.0) déclare `setBounds(bounds: Rectangle, options?: BoundsOptions)` avec
`animate?: boolean | { duration?: number (250 par défaut), easing?: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' }`.
Essai sur la vue d'un onglet (page lourde), 6 passes :

| Mesure | Déplacement seul (x), 180 ms `ease-out` | Déplacement + largeur |
| --- | --- | --- |
| Tics du processus principal | **0** (un seul appel) | 0 |
| Événements `resize` reçus par la page | **0** | 13–18 |
| Remises en page de la page | **0** (0 ms) | 1 (21–28 ms) |
| Images de la page > 12 ms | 0–1 | 1–2 (jusqu'à 42 ms) |
| `getBounds()` pendant l'animation | renvoie l'ancienne position jusqu'à la fin | idem |
| Événements `bounds-changed` | 1 | 1–2 |

Vérifié à l'œil par une capture de la fenêtre prise au milieu d'une animation de 900 ms : la
page est bien à une position intermédiaire. L'animation est faite par le système (Core
Animation), au rythme de l'écran, sans passer par le JavaScript ni redessiner la page.

### Autres gestes

| Geste | Mesure | Valeur |
| --- | --- | --- |
| Glisser la séparation de deux pages lourdes, un `resizeSplit` par image | appels en 1,2 s | 106 (`layout` 0,29 ms + `sendState` 0,15 ms chacun) |
| | remises en page réellement faites par chaque page | 32 (le moteur regroupe), 25–31 ms chacune, 790–800 ms au total |
| | images présentées / perdues par page | 64 / 105 |
| | images > 25 ms | 24–29 par page |
| Même geste limité à 30 appels par seconde | remises en page / images présentées | 34 / 68 (identique à l'œil, 3 fois moins d'appels) |
| Même geste limité à 15 par seconde | remises en page / images présentées | 18 / 36 (moitié moins de travail, mouvement saccadé) |
| Changement d'Espace | synchrone, puis image de la page | 3–4 ms, +2 ms |
| Première ouverture d'une vue d'appoint | toast / recherche / aperçu | 94–98 / 82–94 / 89–90 ms |

### Points

- ⬜ **ANIM-1 — Bascule de la barre latérale par l'animation native de `setBounds`.**
  *Problème* : minuteur à 100 Hz irrégulier dans le processus principal, désynchronisé de la
  transition CSS de la barre ; à la merci de tout blocage de ce fil (9 à 12 ms à chaque
  sauvegarde, 14 ms à chaque frappe).
  *Changement* (`animateTo`) : calculer le rectangle final et faire **un** appel
  `rt.view.setBounds(final, { animate: { duration: DUR, easing: 'ease-out' } })` pour chaque
  vue affichée ; garder la même durée et la même courbe côté CSS (`#sidebar { transition: transform <DUR>ms ease-out }`)
  pour que la barre et la page partent et arrivent ensemble. Ordre pour ne déclencher qu'une
  remise en page, et **hors du mouvement** : à l'ouverture, animer x seul (largeur inchangée,
  la page déborde à droite sous le bord de la fenêtre), puis fixer la largeur à la fin (`setTimeout(DUR)`) ;
  à la fermeture, élargir d'abord, puis animer x. Ne plus relire `getBounds()` pendant
  l'animation (valeur périmée, mesuré) : garder la cible dans `this`.
  *Gain mesuré* : 0 tic du fil principal au lieu de 6 à 19, 0 remise en page pendant le
  mouvement au lieu d'une de 20–24 ms, cadence de l'écran garantie.
  *Risque* : moyen — courbes limitées à quatre (pas de ressort : voir ANIM-4) ; les vues
  d'appoint ancrées à la page (recherche, statut) doivent suivre ; vérifier la vue scindée
  (plusieurs vues animées ensemble) et Windows (l'option est-elle animée hors macOS ? **à mesurer**).
  *Effort* : M.

- ⬜ **ANIM-2 — À défaut d'ANIM-1 : caler le minuteur sur l'écran.**
  *Changement* : remplacer `setInterval(…, 8)` par un pas calculé sur
  `1000 / screen.getDisplayMatching(win.getBounds()).displayFrequency`, en boucle `setTimeout`
  corrigée de la dérive (viser l'instant de l'image suivante, pas « dans 8 ms »). *Gain* :
  positions alignées sur les images (22 au lieu de 18 sur 180 ms). *Limite* : reste sensible
  aux blocages du fil principal. *Effort* : S.

- ✅ **ANIM-3 — Glisser la séparation : un `resizeSplit` par image d'écran au plus, sans `sendState`.** *(fait le 8 oct.)*
  *Problème* : 106 appels pour 32 remises en page effectives ; chaque appel refait `layout()`
  de toute la fenêtre et renvoie l'état complet à la coque. *Changement* : dans `resizeSplit`,
  ne déplacer que les deux vues concernées (`setBounds` direct), sans `sendState` (la poignée
  est déjà déplacée localement par `shell.js`), et ne garder qu'un appel par tranche de 16 ms ;
  `layout()` + `sendState()` complets au relâchement. *Gain mesuré* : 3 fois moins d'appels
  pour le même rendu (68 images contre 64). *Risque* : faible. *Effort* : S.

- ⬜ **ANIM-4 — Courbes de ressort pour tout ce qui est en CSS.**
  *Constat* : toute l'interface utilise une seule courbe, `--ease: cubic-bezier(0.33, 1, 0.68, 1)`
  (décélération simple, sans rebond). Chromium accepte `linear()` depuis la version 113 (Orbe
  est en 152), ce qui permet d'écrire un vrai ressort en CSS.
  *Changement* : ajouter dans `base.css` deux variables, calculées une fois par un petit script
  (oscillateur amorti échantillonné en 30 à 40 points) :
  `--spring-snappy` (amortissement critique, aucun dépassement, ≈ 250 ms perçus) pour les
  panneaux et les lignes ; `--spring-bouncy` (léger dépassement, 5 à 8 %) pour les seuls
  éléments ludiques : tuile de favori pressée, icône d'Espace, apparition de la bascule ⌃Tab.
  Points de départ usuels sur macOS : `response` 0,3 à 0,4 s et `dampingFraction` 0,8 à 1 pour
  l'interface ; la valeur par défaut la plus citée pour `.spring()` de SwiftUI est
  `response: 0,55, dampingFraction: 0,825` (sources en fin de document ; l'amortissement n'est
  pas confirmé par la documentation d'Apple). Conversion : raideur = (2π / response)²,
  amortissement = 4π × dampingFraction / response, masse 1.
  *Gain* : agrément (non mesurable en millisecondes) ; coût nul (les transitions `transform` et
  `opacity` sont composées hors du fil principal). *Risque* : affaire de goût — à régler à l'œil,
  en respectant `prefers-reduced-motion` (ANIM-7). *Effort* : S.

- ⬜ **ANIM-5 — Aperçu (Peek) : faire entrer la page au lieu de la poser.**
  *Constat* : `openPeek` ajoute la vue à sa taille finale d'un coup ; seul le voile s'anime
  (160 ms). *Changement* : poser la vue 24 points plus bas et légèrement réduite, puis
  `setBounds(final, { animate: { duration: 200, easing: 'ease-out' } })` ; à la fermeture,
  l'inverse sur 120 ms avant `close()`. Animer la position plutôt que la taille pour éviter les
  remises en page (mesuré : 13 à 18 `resize` quand la largeur est animée). *Gain* : agrément ;
  **à mesurer** : images perdues pendant l'entrée sur une page réelle. *Effort* : S.

- ⬜ **ANIM-6 — Apparition de la barre latérale au démarrage.**
  Si DEM-1 est fait, la fenêtre paraît 80 ms avant la barre : faire entrer `#sidebar` en fondu
  (`opacity` 0 → 1, 80–100 ms) au premier rendu plutôt que de la laisser surgir. *Effort* : S.

- ✅ **ANIM-7 — Respecter « Réduire les animations ».** *(fait le 8 oct.)*
  *Constat* : aucun `@media (prefers-reduced-motion: reduce)` dans `shell.css` ni `overlay.css` ;
  `animateTo` ne consulte pas le réglage du système. *Changement* : en CSS, ramener durées et
  animations à 0 sous cette requête ; côté principal, lire
  `systemPreferences.getAnimationSettings().prefersReducedMotion` (présent dans `electron.d.ts`)
  et passer `DUR` à 0. *Risque* : nul. *Effort* : S.

- ⬜ **ANIM-8 — Changement d'Espace : faire suivre le doigt jusqu'au bout.**
  *Constat* : le balayage à deux doigts déplace la liste (`#scroll`) puis, passé 70 px, change
  d'Espace d'un coup : la page, elle, est remplacée sans transition (3–4 ms). *Changement* :
  pendant le balayage, déplacer aussi la vue de la page de la même fraction (`setBounds` sur x,
  un appel par image au plus) ; au seuil, terminer par `setBounds(…, { animate })` et faire
  entrer la page du nouvel Espace par le côté opposé. *Coût mesuré* d'un `setBounds` sur x seul :
  aucune remise en page de la page. *Risque* : moyen (deux vues à l'écran pendant 150 ms ;
  l'onglet du nouvel Espace peut être en veille : montrer alors sa vignette ou un fond).
  *Effort* : M à L. À faire après ANIM-1.

## 10. Design et sensations (DESIGN)

Ce chapitre est de la recherche : ce qu'Electron 44 expose réellement (relevé dans
`electron.d.ts`), ce qui a été mesuré, et ce qui reste affaire de goût.

### Ce que la machine sait faire

| Sujet | Relevé |
| --- | --- |
| Cadence | écran à 120 Hz ; la coque et les pages rendent déjà à 8,33 ms (mesuré par traçage) : **aucun drapeau à ajouter** pour le 120 Hz |
| Drapeaux graphiques | les processus de rendu sont déjà lancés avec `--enable-zero-copy`, `--num-raster-threads=4`, `--enable-gpu-memory-buffer-compositor-resources` (lu sur la ligne de commande des processus) : rien d'évident à activer en plus ; tout autre drapeau est **à mesurer** avant emploi |
| Matériaux `vibrancy` (macOS) | `titlebar`, `selection`, `menu`, `popover`, `sidebar` (utilisé), `header`, `sheet`, `window`, `hud`, `fullscreen-ui`, `tooltip`, `content`, `under-window`, `under-page`. Aucun matériau « verre liquide » de macOS 26 n'est exposé |
| `visualEffectState` | `followWindow` (utilisé), `active`, `inactive` |
| Flou par vue | `View.setBackgroundBlur(rayon)` existe (demande une couleur de fond avec transparence) : un flou natif derrière une vue, sans `backdrop-filter` |
| Animation de vue | `View.setBounds(rect, { animate })` (voir ANIM-1) ; `View.setBorderRadius` |
| Gestes | fenêtre : `swipe` (balayage à trois doigts, ancien style : n'est émis que si le réglage système « Balayer entre les pages » inclut trois doigts) et `rotate-gesture` ; pages : événement `input-event` de `webContents` avec les types `gestureScrollBegin/Update/End`, `gesturePinchBegin/Update/End`, `gestureFlingStart`, `mouseWheel`. Les anciens `scroll-touch-begin/end` **n'existent plus** dans cette version |
| Retour haptique | **aucune** interface dans Electron 44 (`NSHapticFeedbackManager` n'est pas exposé) ; il faut un module natif ou un petit exécutable d'appoint |
| Réglages d'accessibilité | `systemPreferences.getAnimationSettings()` (`prefersReducedMotion`, etc.), `accessibilityDisplayShouldReduceTransparency` |

### Points

- ⬜ **DESIGN-1 — Retour au glisser : balayage de page qui suit le doigt.**
  *Constat* : précédent / suivant se font au clavier ou au bouton ; rien ne suit le doigt sur la
  page. *Changement* : écouter `input-event` sur la vue de l'onglet actif ; sur
  `gestureScrollBegin` puis des `gestureScrollUpdate` majoritairement horizontaux alors que la
  page est en butée (elle n'a pas consommé le défilement : à détecter par un court script de
  page ou par `overscroll`), afficher une pastille « ← » qui grandit avec le déplacement ;
  au-delà du seuil, `navigationHistory.goBack()`. *À mesurer d'abord* : que ces événements sont
  bien émis sur macOS pour un balayage à deux doigts (présents dans le fichier de types, non
  essayés pendant cette séance). *Effort* : M.

- ⬜ **DESIGN-2 — Rebond élastique de la barre latérale.**
  *À vérifier à l'œil* : `#scroll` est un bloc défilant interne ; selon la version de Chromium
  l'élastique de macOS ne s'applique qu'au défilement principal du document. Si la liste bute
  sèchement, faire de `#scroll` le défilement principal de la coque n'est pas possible (la
  coque couvre la fenêtre) ; l'alternative est un rebond imité en CSS (`overscroll-behavior: contain`
  plus une translation amortie pilotée par `wheel`), comme le fait déjà le balayage d'Espace.
  *Effort* : S pour vérifier, M pour imiter.

- ⬜ **DESIGN-3 — Retour haptique, sans module natif : écarté pour l'instant.**
  Electron n'expose rien. Deux voies existent : un module natif (contraire au choix « aucune
  dépendance » du projet) ou un exécutable Swift d'une dizaine de lignes appelant
  `NSHapticFeedbackManager.defaultPerformer.perform(.alignment, performanceTime: .now)`, lancé
  par `child_process` — mais le lancement d'un processus prend des dizaines de millisecondes,
  trop tard pour accompagner un geste, et le retour n'est produit que si un doigt est posé sur
  le pavé. À reprendre seulement si un module natif est accepté. État : ➖ écarté (avec la raison).

- ⬜ **DESIGN-4 — Sons d'interface discrets, originaux.**
  *Droit* : un son que l'on synthétise soi-même est une création originale dont on détient les
  droits ; il ne faut ni reprendre ni imiter de près les sons d'Arc ou de macOS, ni partir
  d'une banque sans licence claire (préférer CC0 ou création propre). Les fichiers doivent être
  publiés sous la licence du projet (MIT) avec leur source (le script de synthèse).
  *Déjà commencé pendant la séance* (commit `014fab0`) : un son de capture original, fabriqué
  par `scripts/make-sounds.js` (`src/renderer/sons/capture.wav`, 37 Ko) et un réglage « Sons » ;
  ce point couvre la suite (autres gestes) et la mesure du coût.
  *Technique la moins chère* : les synthétiser à la volée dans la coque avec l'API Web Audio
  (un oscillateur + une enveloppe de 40 à 120 ms, aucun fichier), contexte audio créé au premier
  son puis suspendu après 5 s de silence. *À mesurer* : mémoire du service audio de Chromium une
  fois lancé (processus utilitaire supplémentaire) et délai du premier son. Désactivés par
  défaut, réglage dans les préférences, coupés par le mode silencieux du système si possible.
  *Effort* : S pour un prototype.

- ⬜ **DESIGN-5 — Panneaux flottants : flou natif plutôt que `backdrop-filter`.**
  *Constat* : `.panel` (barre de commande, recherche, thème) utilise
  `backdrop-filter: blur(30px) saturate(1.6)` dans une vue transparente de la taille de la
  fenêtre. Un `backdrop-filter` ne floute que ce que la **même** vue dessine derrière lui ; ici
  il n'y a rien derrière dans la vue (la page est une autre vue native) : l'effet visible vient
  surtout du fond `--panel` à 94–95 % d'opacité. *À mesurer* : coût en images de ce filtre à
  l'ouverture de la barre de commande, et rendu avec `View.setBackgroundBlur()` sur une vue
  réduite au rectangle du panneau (ce qui flouterait vraiment la page dessous).
  *Gain attendu* : un vrai effet de verre, et une vue modale plus petite à composer. *Risque* :
  la vue modale couvre aujourd'hui toute la fenêtre pour capter le clic « en dehors » : il
  faudrait le capter autrement. *Effort* : M.

- ⬜ **DESIGN-6 — Typographie.**
  *Constat* : `font: 13px/1.35 -apple-system`, lignes d'onglet en 14 px / 500, `letter-spacing: -0.005em`,
  `-webkit-font-smoothing: antialiased`. C'est cohérent avec macOS. Pistes à juger à l'œil,
  sans coût : `font-optical-sizing: auto` et `font-feature-settings: 'ss01', 'cv11'` selon les
  glyphes voulus pour SF ; `font-variant-numeric: tabular-nums` déjà posé sur les compteurs
  (à étendre au pourcentage de zoom du toast) ; `text-rendering: optimizeLegibility` à éviter
  sur les longues listes (coût de mise en page). *Effort* : S.

- ⬜ **DESIGN-7 — États pressés et survols plus vivants.**
  *Constat* : seules les tuiles de favoris et les boutons d'aperçu ont un état pressé
  (`transform: scale(0.96)`) ; les lignes d'onglet n'en ont pas, et leur survol change en 100 ms
  linéaires. *Changement* : `.row:active { transform: scale(0.985); }` avec `--spring-snappy`
  (ANIM-4) ; sur le survol, entrée immédiate (0 ms) et sortie en 150 ms, comme les listes de
  macOS. *Coût mesuré du survol aujourd'hui* : 0,13 ms de style par déplacement, 0 image perdue
  sur 252 : de la marge. *Effort* : S.

- ⬜ **DESIGN-8 — Fermeture d'un onglet : glissement des lignes suivantes.**
  *Constat* : `row-out` anime la hauteur de la ligne supprimée (`height` → 0, 150 ms), ce qui
  relance une mise en page par image pour toute la liste. Mesuré : la mise en page de la liste
  coûte 0,24 à 0,51 ms, donc cela tient à 120 Hz même à 1 000 onglets ; rien à corriger pour la
  vitesse. Pour l'agrément, passer la courbe à `--spring-snappy`. *Effort* : S.

- ⬜ **DESIGN-9 — `will-change: transform` permanent sur `#sidebar`.**
  *Constat* : la barre garde sa propre couche graphique en permanence pour une animation qui
  dure 50 à 180 ms. *À mesurer* : mémoire graphique avec et sans (le processus graphique oscille
  déjà entre 160 et 183 Mo sans cause identifiée) ; poser la propriété au début de la bascule et
  la retirer à la fin si le gain est réel. *Effort* : S.

## 11. Ce qui va déjà bien (à ne pas « optimiser »)

Mesuré, et à laisser tel quel :

- le rendu de la barre latérale (0,04 à 0,38 ms, 120 images par seconde jusqu'à 1 000 onglets) ;
- le changement d'onglet (une image) et d'Espace (une image) ;
- ⌘T (3 ms) ;
- l'idée de ne changer la largeur des pages qu'une fois pendant la bascule de la barre ;
- les onglets restaurés chargés seulement quand on les ouvre (un seul processus d'onglet au démarrage, quel que soit le nombre d'onglets) ;
- la liste du bloqueur chargée 1,2 s après le démarrage (6 ms) et la décision à 0,25 µs ;
- les scripts de préchargement sur les pages sans cadre (0,5 ms) ;
- les `require` du processus principal (15 ms pour tout Orbe).

## 12. Les 20 premiers à faire

Classés par gain rapporté à l'effort ; les gains sont ceux mesurés plus haut.

| Rang | Point | Gain mesuré | Effort | Risque |
| --- | --- | --- | --- | --- |
| 1 | **PERF-4** index de recherche normalisé | frappe : 14–15 ms de blocage → ≈ 3 ms (boucle seule : 7,2 → 1,3 ms) | S | faible |
| 2 | **DEM-1** afficher la fenêtre tout de suite | fenêtre −60 ms à chaud, −104 ms refroidi ; première page −62 ms | S | faible |
| 3 | **MEM-1** une seule interface, un seul processus | ≈ −100 Mo ; première ouverture d'une vue 80–100 → 7–15 ms | M | moyen |
| 4 | **PERF-1** historique en journal à part | blocage par sauvegarde 9–12 → 0,2–0,8 ms ; 4,1–6,4 Mo → 0,4 Mo par écriture ; démarrage −17 ms sur vieux profil | M | moyen |
| 5 | **ANIM-1** bascule par animation native | 0 tic du fil principal, 0 remise en page pendant le mouvement, cadence de l'écran | M | moyen |
| 6 | **PERF-3** plus de copie du fichier à chaque écriture | moitié des octets écrits | S | faible |
| 7 | **PERF-2** sauvegarde paresseuse pour titres et icônes | écritures ÷ 2 à 3 en navigation | S | faible |
| 8 | **ANIM-3** glisser de séparation allégé | 3 fois moins d'appels pour le même rendu | S | faible |
| 9 | **PERF-10** `ext.js` hors des pages web | ≈ −2 ms par page à cadres | S | faible |
| 10 | **DEM-2 + DEM-3** fichiers d'interface en mémoire, modale après la coque | avec DEM-1, refroidi : barre −119 ms, page −176 ms | S | faible |
| 11 | **ANIM-7** « Réduire les animations » | accessibilité | S | nul |
| 12 | **ANIM-4** courbes de ressort en CSS (`linear()`) | agrément, coût nul | S | goût |
| 13 | **PERF-5** recherche incrémentale | frappes suivantes < 1 ms (à mesurer) | S | faible |
| 14 | **MEM-3** veille selon la mémoire | jusqu'à −2,2 Go à 30 sites | M | moyen |
| 15 | **PERF-11** `page.js` inerte sans champ de mot de passe | ≈ −3 ms par page à cadres ; plus d'écouteur de défilement | M | moyen |
| 16 | **DEM-5** rien pour les extensions s'il n'y en a pas | 70–140 ms d'activité évitée (à mesurer sur la page) | S | faible |
| 17 | **PERF-24** icônes mémorisées par hôte | moins de requêtes, défilement allégé | S | faible |
| 18 | **PERF-8** pré-réveil de l'onglet survolé | −150 à −300 ms ressentis (à mesurer) | S | faible |
| 19 | **DESIGN-7 + ANIM-6** états pressés, entrée de la barre | agrément | S | goût |
| 20 | **MEM-4** processus survivants à la veille | jusqu'à 249 Mo (diagnostic d'abord) | S | faible |

Ensuite, par ordre d'intérêt : ANIM-5 (entrée de l'aperçu), ANIM-8 (Espace qui suit le doigt),
DESIGN-1 (balayage de page), DESIGN-5 (flou natif), PERF-13 (bloqueur sans JavaScript),
PERF-22 (état partiel), DESIGN-4 (sons), MEM-6 (limite de processus), DEM-8 (mesure du paquet).

## 13. Sources

Relevés locaux : `~/.orbe-dev/node_modules/electron/electron.d.ts` (44.7.0) pour toutes les
interfaces citées (`View.setBounds` et `BoundsOptions`, `setBackgroundBlur`, `vibrancy`,
`visualEffectState`, `input-event`, `swipe`, `rotate-gesture`, `getAnimationSettings`,
`v8CacheOptions`, `registerPreloadScript`).

En ligne (consultées le 8 octobre 2026) :

- `linear()` en CSS, pris en charge depuis Chromium 113, et générateur de courbes de ressort :
  <https://developer.chrome.com/docs/css-ui/css-linear-easing-function>
- Ressorts de SwiftUI (signification de `response` et `dampingFraction`, valeurs usuelles) :
  <https://www.createwithswift.com/understanding-spring-animations-in-swiftui/> et
  <https://developer.apple.com/documentation/swiftui/spring>
- Retour haptique sur macOS : <https://developer.apple.com/documentation/appkit/nshapticfeedbackmanager>
  (limite « un doigt doit toucher le pavé » : <https://developer.apple.com/forums/thread/70605>)
