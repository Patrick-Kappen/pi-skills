# 5. Check

1. Run the skill rules and everything CI runs, in the worktree:

   ```sh
   node scripts/check-skills.ts . <name>
   devenv test
   ```

   Fix every failure at its cause. Never weaken a check or add an exception to pass.
2. Read `SKILL.md` once as the agent will: only the description first. Would you load it for the
   triggers from step 1, and not for the cases where it must not load?
3. Try it: in the worktree, start pi with only this skill and a realistic request:

   ```sh
   pi --no-skills --skill skills/<name> "<a request the skill is for>"
   ```

   Watch whether the skill is loaded, which files are read, and whether the steps are followed.
   Fix what goes wrong, and run the checks again.
4. Commit in Conventional Commits with the skill as scope: `feat(<name>): <what it does>`.
