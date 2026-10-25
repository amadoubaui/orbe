---
phase: quick
plan: 261024-txf
type: execute
wave: 1
depends_on: []
files_modified:
  - src/main/popups.js
  - src/main/window.js
  - src/main/essentials.js
  - src/main/permissions.js
  - src/shared/locales.js
autonomous: true
must_haves:
  truths:
    - "Une fenêtre ouverte par une page (window.open, cible _blank ou fenêtre enfant) est marquée comme popup dans le processus principal."
    - "Un téléchargement déclenché dans une popup sans vraie entrée de l'utilisateur dans cette popup est refusé, même si Chromium rapporte un geste hérité de la page qui l'a ouverte."
    - "Après une vraie entrée de l'utilisateur dans la popup (moins de 5 s), les téléchargements de cette popup sont de nouveau autorisés."
    - "Les onglets ouverts par l'utilisateur (nouvel onglet, lien, barre de commande) ne sont jamais marqués et gardent le comportement de téléchargement existant."
    - "Le blocage affiche une fois par page de popup le toast localisé « Téléchargement automatique bloqué : clique d’abord dans cette fenêtre. »"
    - "Les téléchargements des onglets normaux ne changent pas : geste récent, premier téléchargement automatique, puis autorisation « downloads »."
  artifacts:
    - "src/main/popups.js : WeakSet interne, mark(wc) et isMark(wc) exportés, sans changement des popups existantes"
    - "src/main/window.js : hook popupOpened : () => {} et marquage des trois branches qui créent une vue enfant (background-tab, shifted/newTab, createWindow)"
    - "src/main/essentials.js : hooks.popupOpened posé sur popups.mark, popup passé à permissions.setup"
    - "src/main/permissions.js : env.popup par défaut à false, contrôle popup avant le geste et avant item.hasUserGesture dans downloadGate, indicateur dlPopupBlocked remis à zéro à chaque navigation"
    - "src/shared/locales.js : clé dl.popupBlocked en français et en anglais"
  key_links:
    - "setWindowOpenHandler (window.js) → hooks.popupOpened → popups.mark ; permissions.env.popup → popups.isMark"
    - "downloadGate évalue env.popup(wc) et env.gesture(wc) avant l'early return de gesture (item.hasUserGesture), pour qu'un clic dans la page ouvrante ne crédite pas la popup"
    - "pageState(wc).dlPopupBlocked, remis à zéro par did-navigate, limite le toast à une fois par page de popup"
---

<objective>
Empêcher une popup de lancer un téléchargement automatique tant que l'utilisateur n'a pas réellement interagi dans cette popup.

Purpose: une page ouvre une fenêtre après un geste, puis cette fenêtre déclenche un « force download » sans que l'utilisateur ait rien fait dedans. Orbe laisse passer le premier téléchargement automatique d'une page et Chromium attribue à la popup le geste de la page ouvrante. Il faut distinguer une popup d'un onglet normal et exiger une entrée réelle dans la popup.

Output: `src/main/popups.js`, `src/main/window.js`, `src/main/essentials.js`, `src/main/permissions.js` et `src/shared/locales.js` modifiés. Aucune exécution de l'application ni du serveur : l'utilisateur fait le test manuel.
</objective>

<context>
@.planning/STATE.md
@.claude/CLAUDE.md
@src/main/popups.js
@src/main/window.js
@src/main/essentials.js
@src/main/permissions.js
@src/shared/locales.js
</context>

<tasks>

<task type="auto">
  <name>Task 1: Marquer les fenêtres ouvertes par une page et câbler le prédicat popup</name>
  <files>src/main/popups.js, src/main/window.js, src/main/essentials.js, src/shared/locales.js</files>
  <action>
    Dans `src/main/popups.js` :
    1. Après les constantes `WINDOW`, `KEEP` et `MODIFIERS`, ajouter un WeakSet interne `marked` (constante de module) avec un commentaire en français : il retient les webContents ouverts par une page, car une popup ne doit pas télécharger sans une vraie entrée de l'utilisateur en son sein.
    2. Ajouter une fonction `mark(wc)` : ignorer silencieusement `null`, un webContents déjà détruit (`wc.isDestroyed()` protégé par try/catch, style défensif existant), sinon ajouter au WeakSet. Ajouter `const isMark = (wc) => !!wc && marked.has(wc);`.
    3. Ajouter `mark` et `isMark` à `module.exports`, sans toucher au comportement de `gesture`, `allowed`, `reset`, `count` ou `menu`.

    Dans `src/main/window.js` :
    4. Dans l'objet `hooks` (vers la ligne 98, à côté de `popup: () => true`), ajouter `popupOpened: () => {},`. Mettre à jour le commentaire des raccords posés par essentials.js en mentionnant le marquage des fenêtres ouvertes par une page.
    5. Dans `setWindowOpenHandler` (vers la ligne 1267), branche `background-tab` : conserver le retour anticipé de la petite fenêtre (alt-clic). Remplacer `owner.newTab(details.url, { background: true, after: rt.id });` par `const tab = owner.newTab(...);` puis `const childRt = tab ? owner.ensureView(tab.id) : null;` et `if (childRt) hooks.popupOpened(childRt.wc);` avant le `return { action: 'deny' };`.
    6. Branche `shifted` : quand `how` vaut finalement `'tab'`, remplacer l'appel nu `owner.newTab(details.url, { after: rt.id });` par la même séquence : capturer le retour de `newTab`, appeler `owner.ensureView(tab.id)` (idempotent, la vue existe déjà), puis `hooks.popupOpened(childRt.wc)`. Ne rien changer aux branches `peek` et `route`.
    7. Branche finale `createWindow` : après `const childRt = owner.ensureView(child.id, options);` et avant `owner.activate(child.id)`, appeler `hooks.popupOpened(childRt.wc)` (marker avant l'activation, pour être posé avant tout chargement). Conserver le retour `childRt.wc`. Ne pas marquer la branche `createWindow` de `openPeek`.
    8. Ajouter un commentaire en français au-dessus du premier marquage : une ouverture demandée par la page est une popup ; elle ne téléchargera pas sans entrée de l'utilisateur (voir `permissions.downloadGate`). Ne jamais marquer les onglets créés par l'utilisateur (`newTab` depuis la barre, un menu ou un lien cliqué par l'utilisateur) : seules les trois branches ci-dessus sont concernées.

    Dans `src/main/essentials.js` :
    9. Dans `setup`, juste après `hooks.popup = (rt, details) => popups.allowed(rt, details);` (vers la ligne 211), ajouter `hooks.popupOpened = (wc) => popups.mark(wc);`.
    10. Dans l'appel `permissions.setup({ test, toast, ownerWindow, gesture });` (vers la ligne 187), ajouter `popup: (wc) => popups.isMark(wc)` au même objet. Ne changer ni `toast`, ni `ownerWindow`, ni `gesture`.

    Dans `src/shared/locales.js` :
    11. En français, juste après `dl.multiText` (vers la ligne 1043), ajouter `'dl.popupBlocked': 'Téléchargement automatique bloqué : clique d’abord dans cette fenêtre.',`. En anglais, juste après `dl.multiText` (vers la ligne 2311), ajouter `'dl.popupBlocked': 'Automatic download blocked: click inside this window first.',`. Utiliser l'apostrophe typographique française comme dans le reste du fichier.

    Contraintes : commentaires en français, identifiants en anglais, indentation 2 espaces, style existant. Ne pas modifier `permissions.js` dans cette tâche (le défaut `popup` y reste faux : aucun changement de comportement visible tant que la tâche 2 n'est pas faite). Ne pas lancer l'application ni le serveur. Commit atomique en français, par exemple `feat(popups): marquer les fenêtres ouvertes par une page`.
  </action>
  <verify>
    <automated>node --check src/main/popups.js && node --check src/main/window.js && node --check src/main/essentials.js && node --check src/shared/locales.js && grep -q "const marked = new WeakSet()" src/main/popups.js && grep -q "function mark(wc)" src/main/popups.js && grep -q "const isMark = (wc)" src/main/popups.js && grep -q "menu, mark, isMark, WINDOW" src/main/popups.js && grep -q "popupOpened: () => {}" src/main/window.js && test "$(grep -c 'hooks.popupOpened' src/main/window.js)" -eq 3 && grep -q "owner.ensureView(tab.id)" src/main/window.js && grep -q "hooks.popupOpened = (wc) => popups.mark(wc)" src/main/essentials.js && grep -q "popup: (wc) => popups.isMark(wc)" src/main/essentials.js && test "$(grep -c \"'dl.popupBlocked'\" src/shared/locales.js)" -eq 2 && grep -q "Téléchargement automatique bloqué" src/shared/locales.js && grep -q "Automatic download blocked" src/shared/locales.js</automated>
  </verify>
  <done>`node --check` passe sur les quatre fichiers ; le WeakSet, `mark` et `isMark` sont internes et exportés ; le hook `popupOpened` a un défaut inerte et trois sites d'appel (background-tab, shifted/newTab, createWindow) ; essentials câble le hook et le prédicat sans toucher aux autres options ; les deux locales portent `dl.popupBlocked` ; aucun onglet ouvert par l'utilisateur n'est marqué ; application et serveur non lancés.</done>
</task>

<task type="auto">
  <name>Task 2: Refuser le téléchargement d'une popup sans interaction réelle</name>
  <files>src/main/permissions.js</files>
  <action>
    Dans `src/main/permissions.js` :
    1. Dans l'objet `env` (vers les lignes 27-36), sous `gesture`, ajouter `popup: () => false,` avec un commentaire en français : vrai si ce webContents a été ouvert par une page (popup), faux par défaut et pour tout onglet normal.
    2. Dans `downloadGate` (vers la ligne 253), commencer par `if (!wc || wc.isDestroyed()) return true;` puis calculer `const since = env.gesture(wc);` (le calcul doit désormais précéder l'early return de `gesture`). Ajouter ensuite, avant `if (gesture) return true;`, le contrôle popup : si `since !== null && env.popup(wc) && !(since < GESTURE)`, prendre `const st = pageState(wc);`, et si `!st.dlPopupBlocked`, poser `st.dlPopupBlocked = true` et appeler `env.toast(wc, t('dl.popupBlocked'))`, puis renvoyer `false` dans tous les cas de ce bloc. Ce refus passe avant `item.hasUserGesture()` (`gesture`) : Chromium attribue à la popup le geste de la page ouvrante, qui ne doit pas la créditer.
    3. Conserver ensuite exactement la logique existante : `if (gesture) return true;`, `if (since === null) return true;` (hors onglet), le reste de `downloadGate` inchangé (consommation du geste, premier téléchargement automatique, autorisation `downloads`).
    4. Dans `pageState` (vers la ligne 193), ajouter `st.dlPopupBlocked = false;` au gestionnaire `did-navigate` existant, pour que le toast puisse réapparaître une fois sur la page suivante (une fois par page).
    5. Ajouter un commentaire en français au-dessus du contrôle popup expliquant le scénario : une page ouvre une fenêtre après un geste, puis cette fenêtre lance un téléchargement ; le geste hérité ne vaut pas entrée dans la popup.

    Contraintes : ne pas modifier `env.gesture`, ne pas changer la règle des téléchargements multiples des onglets normaux, commentaires en français, style existant. Ne pas lancer l'application ni le serveur, aucun test en mode watch. Commit atomique en français, par exemple `feat(permissions): refuser les téléchargements automatiques des popups`.
  </action>
  <verify>
    <automated>node --check src/main/permissions.js && grep -q "popup: () => false" src/main/permissions.js && grep -q "env.popup(wc)" src/main/permissions.js && grep -q "!(since < GESTURE)" src/main/permissions.js && grep -q "if (!st.dlPopupBlocked)" src/main/permissions.js && grep -q "st.dlPopupBlocked = false" src/main/permissions.js && grep -q "t('dl.popupBlocked')" src/main/permissions.js && node -e "const s=require('fs').readFileSync('src/main/permissions.js','utf8');const p=s.indexOf('env.popup(wc)');const g=s.indexOf('if (gesture) return true');const n=s.indexOf('if (since === null) return true');if(!(p>-1&&g>-1&&n>-1&&p<g&&g<n))process.exit(1)" && grep -q "st.dlGesture" src/main/permissions.js</automated>
  </verify>
  <done>`node --check` passe ; `env.popup` vaut faux par défaut ; le contrôle popup s'exécute après `env.gesture(wc)` et avant `if (gesture) return true;` ; une popup sans entrée récente (geste absent, Infinity, ou plus de 5 s) est refusée et affiche `dl.popupBlocked` une seule fois par page ; le geste récent dans la popup laisse passer ; la logique des onglets normaux (`dlGesture`, premier téléchargement, autorisation `downloads`) est intacte ; application et serveur non lancés.</done>
</task>

</tasks>

<verification>
Baseline à HEAD (mesurée) : `mark`/`isMark` et `popupOpened` sont absents, `env.popup` et `dlPopupBlocked` aussi, `'dl.popupBlocked'` n'existe dans aucune locale, et `downloadGate` commence par `if (gesture || !wc || wc.isDestroyed()) return true;`. Toutes les gates ci-dessus échouent donc avant l'édition et doivent passer après.

- `node --check` sur `src/main/popups.js`, `src/main/window.js`, `src/main/essentials.js`, `src/main/permissions.js`, `src/shared/locales.js`.
- Marquage : trois sites `hooks.popupOpened` dans `window.js` (background-tab, shifted/newTab, createWindow), zéro pour la branche `peek`/`route`, zéro pour les `newTab` déclenchés par l'utilisateur.
- Ordre statique dans `downloadGate` : `env.gesture(wc)` → contrôle popup (`env.popup(wc)` et `!(since < GESTURE)`) → `if (gesture) return true;` → `if (since === null) return true;` → logique existante.
- Anti-répétition : `dlPopupBlocked` consulté avant le toast et remis à faux par `did-navigate`.
- Aucune exécution de l'application, du serveur ou d'un test en mode watch. Vérification manuelle laissée à l'utilisateur : une page avec geste qui ouvre une popup lançant un téléchargement doit voir le téléchargement refusé et le toast ; un clic réel dans la popup suivi d'un téléchargement doit passer ; les téléchargements d'un onglet normal restent inchangés.
</verification>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| page web → `setWindowOpenHandler` | Une page demande l'ouverture d'une fenêtre ; la nouvelle vue est marquée comme popup avant tout chargement. |
| popup → `will-download` / `downloadGate` | La popup demande un téléchargement ; Chromium rapporte un geste qui peut être hérité de la page ouvrante. |
| page web → toast | Un texte localisé est affiché dans la fenêtre Orbe ; aucune donnée de page n'est injectée. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-TXF-01 | Tampering | `permissions.downloadGate` | high | mitigate | Une popup marquée sans entrée réelle (`since` absent, `Infinity` ou ≥ 5 s) voit son téléchargement refusé avant tout enregistrement de fichier. |
| T-TXF-02 | Spoofing | geste hérité rapporté par Chromium (`item.hasUserGesture`) | high | mitigate | Le contrôle popup est évalué avant l'early return de `gesture` : le clic qui a ouvert la popup ne la crédite pas. |
| T-TXF-03 | Denial of Service | répétition du toast / blocage en boucle | low | mitigate | `dlPopupBlocked` limite le toast à une fois par page ; la popup reste utilisable dès une vraie entrée. |
| T-TXF-04 | Information Disclosure | WeakSet et prédicat interne | low | accept | Le marquage reste dans le processus principal, sans IPC ni donnée exposée à la page. |
| T-TXF-SC | Tampering | installs npm/pip/cargo | high | mitigate | Aucune installation ni dépendance : uniquement des modules Node/Electron déjà présents et des fichiers locaux. |
</threat_model>

<success_criteria>
- Une fenêtre ouverte par une page est marquée comme popup ; un onglet ouvert par l'utilisateur ne l'est jamais.
- Une popup sans interaction réelle ne télécharge rien, même avec `item.hasUserGesture()` vrai, et affiche le toast une fois par page.
- Un clic réel dans la popup rétablit les téléchargements pour 5 secondes, comme le comportement de geste existant.
- Les téléchargements des onglets normaux sont inchangés.
- `node --check` vert sur les cinq fichiers ; app, serveur et mode watch non lancés.
- Deux commits atomiques en français.
</success_criteria>

<output>
Create `.planning/quick/261024-txf-bloquer-les-t-l-chargements-automatiques/261024-txf-SUMMARY.md` when done.
</output>
