# 5. Change

1. Work in a worktree of the pi-skills repository, never in its main checkout. If the git skill is
   available, follow it. Otherwise:

   ```sh
   cd ~/private/pi-skills && git fetch origin
   git worktree add -b fix/skill-<name>-<topic> ~/.worktrees/pi-skills/skill-<name>-<topic> origin/main
   cd ~/.worktrees/pi-skills/skill-<name>-<topic> && devenv shell -- true
   ```

   Use `feat/` instead of `fix/` for new steps, sections or scripts.
2. Make the approved changes, and only those. Set `metadata.version` in `SKILL.md`.
3. Changed or new scripts get tests under `test/skills/<name>/`; see
   `skills/skill-create/references/scripts.md` in the repository.
4. If the skill's purpose changed, update its row in the skill table of `README.md`.
5. Run the checks:

   ```sh
   node scripts/check-skills.ts . <name>   # the skill rules
   devenv test                              # everything CI runs
   ```

   Fix every failure at its cause. Never weaken a check.
6. Commit in Conventional Commits with the skill as scope, for example
   `fix(<name>): run the dry run before every scaffold`.
