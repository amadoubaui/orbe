---
phase: quick
plan: 261024-sdx
type: execute
wave: 1
depends_on: []
files_modified:
  - src/main/sessions.js
  - .planning/codebase/INTEGRATIONS.md
autonomous: true
must_haves:
  truths:
    - "Toutes les sessions de navigation (profils persistants et navigation privée) présentent l'agent utilisateur Electron intact"
    - "La session des mises à jour conserve son agent utilisateur « Orbe » dédié, sans cookie"
  artifacts:
    - "src/main/sessions.js sans fonction de nettoyage UA ni appel setUserAgent"
    - ".planning/codebase/INTEGRATIONS.md décrivant l'agent utilisateur intact et la raison Client Hints"
  key_links:
    - "configure() dans src/main/sessions.js n'appelle plus setUserAgent ; src/main/main.js:323 reste l'unique exception voulue"
---

<objective>
Laisser l'agent utilisateur Electron intact dans les sessions de navigation d'Orbe.

Purpose: le nettoyage actuel (retrait des jetons `Electron/x` et `Orbe/x`) produit un UA identique à Chrome alors que les en-têtes `sec-ch-ua*` restent ceux d'Electron. Google refuse la connexion (« Try using a different browser… ») et Cloudflare bloque secure.backblaze.com sur cette incohérence UA / Client Hints. L'UA Electron intact passe (mesures Orca #11518, commit Cloudflare d0fe5c0).

Output: `src/main/sessions.js` sans nettoyage d'UA avec un commentaire mesuré, et `.planning/codebase/INTEGRATIONS.md` à jour. Aucune exécution de l'application : l'utilisateur fait les tests manuels.
</objective>

<context>
@.planning/STATE.md
@.claude/CLAUDE.md
@src/main/sessions.js
@src/main/main.js
@.planning/codebase/INTEGRATIONS.md
</context>

<tasks>

<!-- planner-discipline-allow: cleanUserAgent -->
<!-- planner-discipline-allow: setUserAgent -->

<task type="auto">
  <name>Task 1: Supprimer le nettoyage de l'agent utilisateur et mettre à jour la doc</name>
  <files>src/main/sessions.js, .planning/codebase/INTEGRATIONS.md</files>
  <action>
    Dans `src/main/sessions.js` :
    1. Supprimer la fonction `cleanUserAgent` et son commentaire d'introduction (lignes 69-72), puis supprimer l'appel `ses.setUserAgent(cleanUserAgent(ses));` dans `configure()` (ligne 81). Aucun autre appel ne doit subsister.
    2. À l'emplacement de la fonction supprimée, écrire un commentaire en français expliquant la raison mesurée : retirer `Electron/x` et `Orbe/x` donnait un UA identique à Chrome alors que les en-têtes `sec-ch-ua*` restaient ceux d'Electron ; Google et Cloudflare (secure.backblaze.com) rejettent cette incohérence UA / Client Hints ; l'UA Electron intact passe, l'UA lavé est bloqué. Mentionner la mesure en une ligne (Orca #11518, commit Cloudflare d0fe5c0).
    3. Retirer « agent utilisateur, » de la liste des responsabilités dans l'en-tête du module (ligne 1), puisque le module ne le modifie plus.
    4. Ne pas toucher à `src/main/main.js:323` (`ses.setUserAgent('Orbe', 'en')`) : c'est l'exception voulue pour la session des mises à jour, sans cookie.

    Dans `.planning/codebase/INTEGRATIONS.md`, remplacer à la ligne 93 la phrase décrivant encore le nettoyage UA (retrait du jeton Electron pour paraître comme Chrome) par une phrase anglaise décrivant l'agent utilisateur laissé intact et l'incohérence Client Hints, avec la référence `src/main/sessions.js:69`. Garder le style et la langue de la section.

    Contraintes : commentaires en français dans le code, doc en anglais, indentation 2 espaces, style existant. Ne pas lancer l'application ni le serveur, ne pas ajouter de test. Créer un commit atomique unique en français couvrant les deux fichiers, par exemple `fix(sessions): laisser l'agent utilisateur Electron intact`.
  </action>
  <verify>
    <automated>node --check src/main/sessions.js && ! grep -q "cleanUserAgent" src/main/sessions.js && ! grep -q "setUserAgent" src/main/sessions.js && grep -q "sec-ch-ua" src/main/sessions.js && grep -q "Client Hints" .planning/codebase/INTEGRATIONS.md && ! grep -q "normal Chromium" .planning/codebase/INTEGRATIONS.md && grep -q "setUserAgent('Orbe', 'en')" src/main/main.js</automated>
  </verify>
  <done>`node --check` passe, `cleanUserAgent` et `setUserAgent` ont disparu de `src/main/sessions.js`, le commentaire explique l'incohérence UA / Client Hints, `INTEGRATIONS.md` ne décrit plus de nettoyage et cite l'UA intact, `src/main/main.js:323` est inchangé, et un seul commit contient les deux fichiers.</done>
</task>

</tasks>

<verification>
Baseline à HEAD : `cleanUserAgent` (ligne 70) et `setUserAgent` (ligne 81) sont présents dans `src/main/sessions.js` ; `.planning/codebase/INTEGRATIONS.md` contient encore l'ancienne affirmation. Les gates négatives échouent donc avant l'édition et doivent passer après.

- `node --check src/main/sessions.js` : syntaxe CommonJS valide.
- Aucune occurrence de `cleanUserAgent` ni de `setUserAgent` dans `src/main/sessions.js`.
- Le commentaire de remplacement cite les en-têtes `sec-ch-ua*` et la mesure.
- `.planning/codebase/INTEGRATIONS.md` décrit l'agent utilisateur intact et l'incohérence Client Hints.
- `src/main/main.js:323` conserve `ses.setUserAgent('Orbe', 'en')`.
- Aucune exécution de l'application, du serveur ou de tests en mode watch.
</verification>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| site web → session Chromium | L'agent utilisateur et les Client Hints sont exposés au site ; aucune donnée locale ne traverse cette frontière dans cette tâche |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-SDX-01 | Spoofing | agent utilisateur de session | low | accept | La suppression du nettoyage restaure l'UA Electron d'origine ; il contient déjà le nom et la version de l'application et ne confère aucun privilège. |
| T-SDX-SC | Tampering | installs npm/pip/cargo | high | mitigate | Aucune installation ni dépendance : la tâche supprime du code et édite un fichier Markdown. |
</threat_model>

<success_criteria>
- Les sessions de navigation utilisent l'UA Electron intact ; la session des mises à jour garde son UA « Orbe ».
- La vérification statique complète passe.
- La documentation ne décrit plus de nettoyage UA.
- Un commit atomique, applicatif et documentaire, sans exécution de l'application.
</success_criteria>

<output>
Create `.planning/quick/261024-sdx-corriger-le-blocage-google-backblaze-cau/261024-sdx-SUMMARY.md` when done.
</output>
