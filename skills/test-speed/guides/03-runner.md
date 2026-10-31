# 3. Runner and recipes

Give the repository a parallel runner, a `test-changed` run, and the three recipes. Read
`references/recipes.md` first.

1. Preview, then add:

   ```sh
   <skill>/scripts/add-runner.sh <repo> --runner <pester|vitest|bun|pytest> --dry-run
   <skill>/scripts/add-runner.sh <repo> --runner <pester|vitest|bun|pytest>
   ```

   It writes, without overwriting:
   - `justfile` with `test`, `test-changed` and `test-serial` (an existing justfile is kept; the
     script prints the recipes to add);
   - for pester and pytest, `<repo>/scripts/changed-tests.sh` (and for pester
     `<repo>/scripts/Invoke-PesterParallel.ps1`); `--dir` picks another directory, such as `Tools`.

   With a `devenv.nix`, the recipes call devenv scripts. The script prints that snippet; merge it
   into `devenv.nix` by hand, next to the existing scripts.
2. Make the existing commands use the runner: the old `test` script in devenv, pre-commit and
   pre-push hooks, the CI test step (`references/recipes.md`). Keep the old serial run reachable as
   `test-serial`.
3. Pester: git-ignore the timings file (`.devenv/` usually is; else `.cache/test-timings.json`).
4. Check the mapping of `test-changed` on a real change: touch one code file and run
   `<repo>/scripts/changed-tests.sh <file>` (or `just test-changed <file>`). Expected: the tests of that
   code and nothing unrelated. When the repository has its own layout (tests per folder, shared
   contract tests), extend the mapping in the copied `changed-tests.sh`, not around it.
5. Run each recipe once: `just test`, `just test-changed`, `just test-serial <one file>`. The pass
   and fail counts of `test` and `test-serial` must match.

**Result:** the recipes work and `just test` is faster. Continue with step 4 when step 1 found
repeated process starts; else step 5.
