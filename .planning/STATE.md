---
gsd_state_version: "1.0"
milestone: v0.16
current_phase: 1
current_phase_name: Portes, CI et spikes
status: planning
stopped_at: ROADMAP.md et STATE.md écrits ; en attente de l'approbation du roadmap.
last_updated: "2026-10-24T20:28:18.740Z"
last_activity: 2026-10-24
last_activity_desc: "Completed quick task 261024-v41: Remplacer l’icône de l’application par la piste C « Nuit » (•x EFX orange, point azur)."
state_head: 5a87a0e9d27897ede24a21f67e09a0e85d3196d5
progress:
  total_phases: 5
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-10-24)

**Core value:** Rester un navigateur immédiatement fluide et léger : chaque fonctionnalité s'arbitre d'abord sur son coût au démarrage et à l'usage.
**Current focus:** Phase 1 — Portes, CI et spikes (à planifier)

## Current Position

Phase: 1 of 5 (Portes, CI et spikes)
Plan: 0 of 0 in current phase
Status: Ready to plan
Last activity: 2026-10-24 — Completed quick task 261024-v41: Remplacer l’icône de l’application par la piste C « Nuit » (•x EFX orange, point azur).

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**
- Total plans completed: 0
- Average duration: 0 min
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**
- Last 5 plans: -
- Trend: Stable

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap v0.16] Le socle de modules précède le terminal ; manifestes statiques, modules désactivés par défaut, chargement paresseux.
- [Roadmap v0.16] TUI Herdr complète via PTY retenue sous réserve du spike de la Phase 1 ; repli NDJSON documenté.
- [Roadmap v0.16] La validation d'identité des IPC terminal et les tests de refus font partie de la tranche verticale (Phase 3).
- [Roadmap v0.16] Windows, Paint/Notes, l'API de plugins et les extras terminal restent en v2.
- [Roadmap v0.16] `CORE-05` est vérifié en Phase 5, avec le module Terminal en place et désactivé.

### Pending Todos

None yet.

### Blockers/Concerns

- Phase 1 doit trancher D1 (surface Herdr) et D2 (packaging xterm `.mjs`) avant la Phase 3.
- La surface Herdr est en preview ; le transcript et les fixtures du spike conditionnent les tests des Phases 3 et 4.
- `node-pty` (si PTY) doit être validé dans l'app packagée, avec `spawn-helper` signé.
- La consigne Vitest de CLAUDE.md diverge des commandes réelles : `npm test`, `npm run test:ui`, `npm run test:ext`, `node --test`.
- Electron 44 atteint son EOL le 2027-03-02 ; la montée 45/46 (CORE-06) est hors milestone mais à suivre.

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 261024-sdx | Corriger le blocage Google/Backblaze causé par le user-agent d'Orbe. | 2026-10-24 | 9e8841c | [261024-sdx-corriger-le-blocage-google-backblaze-cau](./quick/261024-sdx-corriger-le-blocage-google-backblaze-cau/) |
| 261024-sxk | Deux correctifs navigateur : autoplay YouTube et popups publicitaires. | 2026-10-24 | 89ab947 | [261024-sxk-deux-correctifs-navigateur-autoplay-yout](./quick/261024-sxk-deux-correctifs-navigateur-autoplay-yout/) |
| 261024-txf | Bloquer les téléchargements automatiques lancés depuis une popup. | 2026-10-24 | 200db2f | [261024-txf-bloquer-les-t-l-chargements-automatiques](./quick/261024-txf-bloquer-les-t-l-chargements-automatiques/) |
| 261024-u40 | Demander l'autorisation dès le premier téléchargement automatique. | 2026-10-24 | 076f6e0 | [261024-u40-supprimer-le-premier-t-l-chargement-auto](./quick/261024-u40-supprimer-le-premier-t-l-chargement-auto/) |
| 261024-v41 | Remplacer l’icône de l’application Orbe par la piste C « Nuit » validée dans pen.dev : •x EFX orange agrandi à 72 % de la pastille, point en bleu azur, squircle indigo avec halo orange. | 2026-10-24 | 5a87a0e | [261024-v41-remplacer-l-ic-ne-de-l-application-orbe-](./quick/261024-v41-remplacer-l-ic-ne-de-l-application-orbe-/) |

## Deferred Items

Items acknowledged and deferred at milestone close, most recent first:

| Category | Item | Status | Deferred At | Milestone |
|----------|------|--------|-------------|-----------|
| Modules | PAINT-01, NOTES-01 | Deferred | 2026-10-24 | v2 |
| Modules | PLUGIN-01 | Deferred | 2026-10-24 | v2 |
| Terminal | TERM-11, TERM-12, TERM-13, HERDR-01 | Deferred | 2026-10-24 | v2 |
| Maintenance | CORE-06 (Electron 45/46 avant EOL) | Deferred | 2026-10-24 | Post-M1 |

## Session Continuity

Last session: 2026-10-24 — Création du roadmap
Stopped at: ROADMAP.md et STATE.md écrits ; en attente de l'approbation du roadmap.
Resume file: None
