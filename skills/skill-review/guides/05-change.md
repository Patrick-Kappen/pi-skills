# 5. Change

One worktree and branch per destination, so each PR has one concern. Never work in a main
checkout. If the git skill is available, follow it; otherwise use the commands below.

## The skill

1. Worktree of the pi-skills repository:

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
5. Commit in Conventional Commits with the skill as scope, for example
   `fix(<name>): run the dry run before every scaffold`.

## Lessons for writing skills

1. A second worktree of pi-skills, on `docs/skill-learnings-<topic>`, or `feat/` when
   `check-skills.ts` gets a new check.
2. Update `skills/skill-create/references/learnings.md`, and for a promotion the target file.
   Raise `metadata.version` of skill-create (minor for a new rule or check, patch otherwise).
3. A new check in `scripts/check-skills.ts` gets a test, and every existing skill must pass it: fix
   them in the same PR.
4. Commit, for example `docs(skill-create): learn to end every step with a checkable result`.

## Lessons for the agent (pi-rules)

1. A rule: worktree of `~/private/pi-rules` on `feat/rule-<name>`; add or change `rules/<name>.md`
   and its row in the README table; run the repository's checks (`devenv test`).
2. Permissions and hooks, and which rules apply where: these live in nixos-config. Write the
   proposed lines in the handover; change nixos-config only when the user asks, in its own
   worktree and PR.

## Checks

In every pi-skills worktree:

```sh
node scripts/check-skills.ts .
devenv test
```

Fix every failure at its cause. Never weaken a check.
