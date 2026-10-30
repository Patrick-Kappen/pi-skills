# 6. First commits

1. Run `<skill>/scripts/first-commits.sh <repo>`. It makes up to four Conventional Commits on
   `main`:
   - `build: ...` for the environment and tool configuration;
   - `feat: project skeleton`;
   - `ci: ...` for the workflows and release config;
   - `docs: ...` for README, CONTRIBUTING, SECURITY and LICENSE.

   All hooks run on these commits. Only `no-commit-to-branch` is skipped, because these are the only
   commits that belong on `main` directly.
2. If a hook fails, fix the cause, run `git reset --soft` back to the root if needed, and run the
   script again.
3. `AGENTS.md` and all other agent files (`CLAUDE.md`, `.claude/`, `.cursor/`, `.pi/`, ...) stay
   untracked. They are in the owner's global gitignore and in the repository's `.gitignore`, and the
   script stops if one is tracked. Never force-add them, and never add a `.gitignore` exception.
