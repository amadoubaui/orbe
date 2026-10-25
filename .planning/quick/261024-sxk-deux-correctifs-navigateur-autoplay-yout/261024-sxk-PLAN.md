---
phase: quick
plan: 261024-sxk
type: execute
wave: 1
depends_on: []
files_modified:
  - src/main/window.js
  - src/main/little.js
  - src/main/adblock.js
  - src/main/popups.js
  - tests/adblock.test.js
autonomous: true
must_haves:
  truths:
    - "Les vidéos des pages web (onglet, aperçu, petite fenêtre, fenêtre issue de window.open) ne démarrent pas seules : elles exigent une activation utilisateur de la page, comme dans Chrome."
    - "La coque d'Orbe et ses sons d'interface ne sont pas affectés : aucune politique globale n'est posée sur le processus."
    - "Une popup vers un domaine publicitaire listé et tiers par rapport à la page est refusée, comptée et proposée dans la pastille comme une popup sans geste."
    - "L'autorisation « Toujours autoriser pour ce site » reste prioritaire sur le filtre publicitaire."
    - "Un bloqueur désactivé, un site en liste d'exceptions ou une URL non http(s)/ws(s) ne bloquent aucune popup."
  artifacts:
    - "src/main/window.js : constante de politique d'autoplay, appliquée dans ensureView (branche viewOptions comprise) et openPeek (branche options comprise)"
    - "src/main/little.js : même politique sur la vue de page de la petite fenêtre"
    - "src/main/adblock.js : shouldBlockPopup(url, firstPartyUrl) pure, exportée, avec loadSync() si la liste n'est pas chargée"
    - "src/main/popups.js : enregistrement factorisé et refus des popups listées avant la consommation du geste"
    - "tests/adblock.test.js : cas de shouldBlockPopup (tiers, sous-domaine, même site, exceptions, désactivé, schémas, liste non chargée)"
  key_links:
    - "popups.allowed appelle adblock.shouldBlockPopup après la permission « Toujours autoriser » et avant la vérification du geste."
    - "ensureView et openPeek fusionnent les webPreferences fournies par Electron au lieu de les remplacer."
---

<objective>
Corriger deux comportements de navigation : l'autoplay des pages web (YouTube ouvre un onglet et la vidéo démarre seule) et les popups publicitaires que le filtrage réseau DNR ne peut pas intercepter.

Purpose: Electron utilise par défaut `autoplayPolicy: 'no-user-gesture-required'`, alors que Chrome exige une activation de la page. Et `window.open` ne passe pas par `onBeforeRequest` : le bloqueur existant, pourtant actif (AdGuard, 58 654 règles DNR), ne voit pas ces ouvertures. La politique est posée par vue pour ne pas toucher aux sons d'interface de la coque ; les popups listées sont refusées par une fonction pure, testable sans Electron.

Output: `src/main/window.js`, `src/main/little.js`, `src/main/adblock.js`, `src/main/popups.js` modifiés et `tests/adblock.test.js` étendu. Aucune exécution de l'application ni du serveur : l'utilisateur fait les tests manuels. Aucun chantier DNR/userScripts ici.
</objective>

<context>
@.planning/STATE.md
@.claude/CLAUDE.md
@src/main/window.js
@src/main/little.js
@src/main/adblock.js
@src/main/popups.js
@tests/adblock.test.js
</context>

<tasks>

<task type="auto">
  <name>Task 1: Exiger une activation utilisateur pour l'autoplay des vues de pages web</name>
  <files>src/main/window.js, src/main/little.js</files>
  <action>
    Dans `src/main/window.js` :
    1. Après le bloc `UI_PREFS` (vers la ligne 42), ajouter une constante gelée `AUTOPLAY_PREFS` valant `Object.freeze({ autoplayPolicy: 'document-user-activation-required' })`, précédée d'un commentaire en français : Electron laisse par défaut les médias démarrer seuls (`no-user-gesture-required`) alors que Chrome exige une activation de la page ; la préférence est posée par vue, jamais par un switch global de politique d'autoplay (aucun `appendSwitch`), pour que les sons d'interface de la coque continuent de jouer.
    2. Dans `ensureView` (vers la ligne 1066), remplacer l'expression `existing || new WebContentsView(viewOptions || { ... })` par la forme suivante : si `viewOptions` est fourni, construire `{ ...viewOptions, webPreferences: { ...(viewOptions.webPreferences || {}), ...AUTOPLAY_PREFS } }` (fusionner les webPreferences, ne jamais les remplacer) ; sinon, construire `{ webPreferences: { ...AUTOPLAY_PREFS, session: this.sessionFor(id), sandbox: true, contextIsolation: true, nodeIntegrationInSubFrames: true, preload: internal ? UI_PRELOAD : undefined } }`, en conservant exactement les préférences existantes. La branche `existing` reste inchangée : une vue déjà créée est passée par cette même fonction et porte déjà la politique.
    3. Dans `openPeek` (vers la ligne 3309), appliquer la même forme : si `options` est fourni, `{ ...options, webPreferences: { ...(options.webPreferences || {}), ...AUTOPLAY_PREFS } }` ; sinon, la branche par défaut existante avec `...AUTOPLAY_PREFS` ajouté à son objet `webPreferences` (session de `fromId`, sandbox, contextIsolation, nodeIntegrationInSubFrames conservés).

    Dans `src/main/little.js` (ligne 213) : ajouter `autoplayPolicy: 'document-user-activation-required'` à l'objet `webPreferences` du `new WebContentsView`, avec une brève ligne de commentaire en français au-dessus rappelant que Chrome exige une activation et que le défaut Electron est `no-user-gesture-required`.

    Contraintes : commentaires en français, identifiants en anglais, indentation 2 espaces, style existant. Aucun switch global, aucun changement de `src/main/main.js` ou de la vue coque. Ne pas lancer l'application ni le serveur. Commit atomique en français, par exemple `fix(autoplay): exiger une activation utilisateur pour les vues de pages`.
  </action>
  <verify>
    <automated>node --check src/main/window.js && node --check src/main/little.js && grep -q "AUTOPLAY_PREFS = Object.freeze({ autoplayPolicy: 'document-user-activation-required' })" src/main/window.js && test "$(grep -c '\.\.\.AUTOPLAY_PREFS' src/main/window.js)" -eq 4 && grep -q '\.\.\.(viewOptions.webPreferences || {})' src/main/window.js && grep -q '\.\.\.(options.webPreferences || {})' src/main/window.js && grep -q 'webPreferences: { ...AUTOPLAY_PREFS, session: this.sessionFor(id)' src/main/window.js && grep -q 'webPreferences: { ...AUTOPLAY_PREFS, session: this.sessionFor(fromId)' src/main/window.js && grep -q "autoplayPolicy: 'document-user-activation-required'" src/main/little.js && ! grep -q "autoplay-policy" src/main/window.js src/main/little.js src/main/main.js</automated>
  </verify>
  <done>`node --check` passe sur les deux fichiers ; `ensureView` et `openPeek` portent la politique dans leurs deux branches (options Electron fusionnées, jamais remplacées) ; la petite fenêtre l'applique aussi ; aucun switch global de politique d'autoplay dans les trois fichiers ; aucun lancement de l'application.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Ajouter shouldBlockPopup et ses tests (liste chargée à la demande)</name>
  <files>src/main/adblock.js, tests/adblock.test.js</files>
  <behavior>
    - Test 1 : `shouldBlockPopup('https://pub.test/pop.html', PAGE)` et `shouldBlockPopup('https://x.traceur.co.uk/p.gif', PAGE)` renvoient true (domaine listé, tiers).
    - Test 2 : `shouldBlockPopup('https://cdn.eu.pub.test/pop.html', 'https://journal.fr/')` renvoie true (sous-domaine listé).
    - Test 3 : `shouldBlockPopup('https://stats.journal.fr/pop.html', 'https://abonnes.journal.fr/')` et `shouldBlockPopup('https://ads.pub.test/a', 'https://pub.test/')` renvoient false (même site).
    - Test 4 : après `adblock.allowSite('journal.fr', true)`, une popup listée depuis `www.journal.fr` renvoie false, depuis `autre.fr` renvoie true (liste d'exceptions respectée).
    - Test 5 : après `adblock.setEnabled(false)`, une popup listée depuis un tiers renvoie false (bloqueur désactivé).
    - Test 6 : `orbe://`, `file://`, `chrome-extension://`, `data:`, `blob:https://pub.test/42` et `''` renvoient false (schémas non http(s)/ws(s)).
    - Test 7 : liste non chargée (`info().loaded === false` après reconfiguration) → `shouldBlockPopup` charge via `loadSync()` et renvoie true pour `securepubads.g.doubleclick.net` depuis `PAGE`, puis `info().loaded === true`.
  </behavior>
  <action>
    Écrire d'abord les tests (RED), puis l'implémentation (GREEN), dans cet ordre.

    Dans `tests/adblock.test.js` :
    1. Ajouter `shouldBlockPopup` à la déstructuration de la ligne 7.
    2. Après le test « liste d'exceptions » (vers la ligne 105), ajouter deux tests node:test en français :
       - « shouldBlockPopup : refuse une ouverture vers un domaine publicitaire listé » couvrant les cas 1 à 6 ci-dessus. Utiliser `PAGE` (`https://www.journal.fr/article/1`) comme page d'origine, les domaines déjà posés par `beforeEach` (`pub.test`, `traceur.co.uk`, `stats.journal.fr`), et restaurer `adblock.setEnabled(true)` et `adblock.allowSite('journal.fr', false)` à la fin du cas désactivé/exception pour ne pas polluer les tests suivants.
       - « shouldBlockPopup : charge la liste au premier appel » couvrant le cas 7 : forcer un rechargement avec `adblock.configure({ listPath: adblock.info().listPath + '.absent' })`, rebasculer aussitôt sur `adblock.configure({ listPath: require('path').join(__dirname, '../assets/blocklist.txt') })`, constater `adblock.info().loaded === false`, appeler `shouldBlockPopup('https://securepubads.g.doubleclick.net/tag/js/gpt.js', PAGE)`, attendre true et `adblock.info().loaded === true`.
    3. Lancer `node --test tests/adblock.test.js` : les nouveaux tests doivent échouer (export absent). Ne jamais lancer en mode watch.

    Dans `src/main/adblock.js` :
    4. Après `shouldBlock` (vers la ligne 205), ajouter la fonction pure `shouldBlockPopup(url, firstPartyUrl)` : renvoyer false si `!enabled` ; appeler `loadSync()` si `!domains` ; calculer `hostOf(url)` et renvoyer `!!host && isListed(host) && isThirdParty(host, hostOf(firstPartyUrl))`. Le commentaire en français explique que `window.open` ne déclenche pas `onBeforeRequest` (le filtre réseau ne voit pas les popups), que contrairement à `shouldBlock` l'état `enabled` compte ici puisque l'écouteur n'est pas retiré, et que `isThirdParty` applique déjà « même site » et la liste d'exceptions.
    5. Ajouter `shouldBlockPopup` à la liste exportée de `module.exports`, à côté de `shouldBlock`.
    6. Relancer `node --test tests/adblock.test.js` : suite entièrement verte (16 tests).

    Contraintes : aucune lecture d'Electron dans `adblock.js`, commentaires en français, style existant. Ne pas lancer l'application ni le serveur. Commit atomique en français incluant code et tests, par exemple `feat(adblock): refuser les popups des domaines publicitaires listés`.
  </action>
  <verify>
    <automated>node --check src/main/adblock.js && node --test tests/adblock.test.js && grep -q "shouldBlockPopup" src/main/adblock.js && grep -q "shouldBlockPopup(url, firstPartyUrl)" src/main/adblock.js && test "$(grep -c 'shouldBlockPopup' tests/adblock.test.js)" -ge 10</automated>
  </verify>
  <done>La fonction pure est exportée, consulte `enabled`, charge la liste via `loadSync()` au besoin, et les 7 comportements sont couverts ; `node --test tests/adblock.test.js` passe (16 tests, 0 échec) sans mode watch.</done>
</task>

<task type="auto">
  <name>Task 3: Refuser dans popups.js les ouvertures vers un domaine listé</name>
  <files>src/main/popups.js</files>
  <action>
    Dans `src/main/popups.js` :
    1. Ajouter `const adblock = require('./adblock');` près de `const permissions = require('./permissions');` (aucun cycle : `adblock.js` ne requiert que `fs` et `path`).
    2. Extraire l'enregistrement actuel de `allowed` (lignes 54-58) dans une fonction `record(rt, url)` placée au-dessus de `allowed` : liste `rt.blockedPopups` créée à la demande, URL tronquée à 2 000 caractères seulement si `/^https?:/i`, déduplication par URL, plafond `KEEP`, puis `rt.blockedCount = (rt.blockedCount || 0) + 1`. Commentaire en français : l'enregistrement sert la mention discrète et « Ouvrir quand même ».
    3. Dans `allowed(rt, details)`, conserver d'abord la permission « Toujours autoriser pour ce site » (`permissions.get(wc.session, origin, 'popups') === true` → true). Ajouter ensuite, avant la vérification du geste (`const fresh = ...`), le refus publicitaire : si `adblock.shouldBlockPopup(details.url, wc.getURL())` est vrai, appeler `record(rt, details.url)` et renvoyer false. Remplacer enfin l'enregistrement en ligne de la branche sans geste par `record(rt, details.url)`.
    4. Mettre à jour le commentaire d'en-tête du module (lignes 1-24) avec une phrase en français : une ouverture vers un domaine publicitaire listé et tiers est refusée même avec un geste, que le filtre réseau ne peut pas voir.
    5. Ne pas modifier `window.js` : `hooks.popup` route déjà vers `popups.allowed`.

    Contraintes : respecter l'ordre permission → filtre publicitaire → geste ; commentaires en français ; indentation 2 espaces. Ne pas lancer l'application ni le serveur. Commit atomique en français, par exemple `fix(popups): bloquer les ouvertures vers un domaine publicitaire listé`.
  </action>
  <verify>
    <automated>node --check src/main/popups.js && node --test tests/adblock.test.js && grep -q "const adblock = require('./adblock')" src/main/popups.js && grep -q "function record(rt, url)" src/main/popups.js && grep -q "shouldBlockPopup(details.url, wc.getURL())" src/main/popups.js && node -e "const s=require('fs').readFileSync('src/main/popups.js','utf8');const p=s.indexOf('=== true) return true');const a=s.indexOf('shouldBlockPopup');const g=s.indexOf('const fresh');if(!(p>-1&&a>-1&&g>-1&&p<a&&a<g))process.exit(1)"</automated>
  </verify>
  <done>L'autorisation permanente reste évaluée en premier, le filtre publicitaire s'applique avant le geste, l'enregistrement est factorisé dans `record` et sert les deux refus, `node --check` et la suite adblock passent, aucune application lancée.</done>
</task>

</tasks>

<verification>
Baseline à HEAD (mesurée) : `autoplayPolicy` et `shouldBlockPopup` sont absents de `src/main/`, `AUTOPLAY_PREFS` et `function record` aussi ; `node --test tests/adblock.test.js` passe 14 tests. Les gates ci-dessus échouent donc avant l'édition et doivent passer après.

- `node --check` sur `src/main/window.js`, `src/main/little.js`, `src/main/adblock.js`, `src/main/popups.js`.
- `node --test tests/adblock.test.js` : 16 tests, 0 échec, jamais en mode watch.
- Les quatre occurrences `...AUTOPLAY_PREFS` couvrent les deux branches de `ensureView` et les deux branches de `openPeek`.
- La politique `document-user-activation-required` est posée par vue ; aucun switch global de politique d'autoplay dans `window.js`, `little.js` ni `main.js`.
- L'ordre dans `popups.allowed` est vérifié statiquement : permission permanente, puis filtre publicitaire, puis geste.
- Aucun lancement de l'application, du serveur ou d'un test en mode watch. La vérification manuelle (YouTube dans un onglet, popup publicitaire) revient à l'utilisateur.
</verification>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| page web → `setWindowOpenHandler` (`popups.allowed`) | Une page demande l'ouverture d'une fenêtre ; son URL et la page d'origine traversent cette frontière. |
| Chromium → options des vues (`ensureView`, `openPeek`) | Les options fournies par Electron pour une fenêtre enfant sont fusionnées dans les webPreferences. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-SXK-01 | Spoofing | `adblock.shouldBlockPopup` appelée par `popups.allowed` | low | mitigate | Prédicat pur local : hôte listé + tiers + liste d'exceptions ; les schémas non http(s)/ws(s) renvoient false ; aucune donnée réseau ou IPC ajoutée. |
| T-SXK-02 | Tampering | fusion de `webPreferences` dans `ensureView` / `openPeek` | low | mitigate | Les options Electron sont copiées puis complétées (`viewOptions.webPreferences` et `options.webPreferences` conservées) ; la politique est posée par vue, sans switch processus. |
| T-SXK-03 | Elevation of Privilege | ordre des décisions dans `popups.allowed` | low | mitigate | « Toujours autoriser pour ce site » reste évalué en premier ; un gate statique vérifie l'ordre permission → filtre → geste. |
| T-SXK-SC | Tampering | installs npm/pip/cargo | high | mitigate | Aucune installation ni dépendance : uniquement des modules Node déjà présents (`fs`, `path`) et le bloqueur local. |
</threat_model>

<success_criteria>
- Les vidéos des vues de pages web ne démarrent pas sans activation utilisateur ; la coque et ses sons restent inchangés.
- Une popup vers un domaine publicitaire listé et tiers est refusée et comptée comme une popup sans geste, sans toucher à l'autorisation permanente ni au blocage sans geste existant.
- `shouldBlockPopup` est pure, testée sans Electron, et charge la liste à la demande.
- Vérifications statiques et `node --test tests/adblock.test.js` vertes ; app et serveur non lancés.
- Trois commits atomiques en français (autoplay, adblock+tests, popups).
</success_criteria>

<output>
Create `.planning/quick/261024-sxk-deux-correctifs-navigateur-autoplay-yout/261024-sxk-SUMMARY.md` when done.
</output>
