# Main setup

- Please use the project-local GSD install from `.claude/gsd-core`.
- **Please do not run the server** I do on my side

# Test

- utiliser vitest run
- ne jamais lancer Vitest en mode watch
- ne plus répéter cette contrainte dans chaque prompt GSD

## Git index lock recovery

If a Git command fails because `.git/index.lock` exists:

1. Check whether a process is holding it with `lsof .git/index.lock`.
2. If no process holds the lock and no Git operation is running, treat it as stale.
3. Remove only `.git/index.lock`, never other `.git/*` files.
4. Retry the blocked Git command.
5. If any process is holding the lock, or the situation is unclear, stop and ask the user.
