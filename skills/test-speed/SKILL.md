---
name: test-speed
description: Make the tests and checks of a repository fast, and keep new ones fast - measure per test file where the time goes, run test files in parallel (slowest first), batch repeated CLI calls (bicep --pattern, PSRule, az), run only the tests the git diff touches, and expose it as just recipes on top of devenv scripts. Use when tests or checks are slow, when an agent keeps running the full suite, when asked to speed up a test suite or CI, and when setting up tests in a new repository or writing new test files. Not for fixing failing tests.
metadata:
  version: "1.0.0"
---

# test-speed

Make a test suite fast without testing less: measure, then run files in parallel, start each tool
once instead of once per case, and run only the tests a change touches. The result is three recipes
every repository has: `just test`, `just test-changed` and `just test-serial`.

Paths are relative to this file. Read each guide fully before you act on it. Run scripts by their
full path (`<skill>/scripts/<script>`, `<skill>` = the directory of this file).

## Two routes

- **A slow suite** (existing tests): steps 1 to 6.
- **A new repository, or new test files**: `guides/new-tests.md`. It points back to steps 3 and 5.

## Steps

| # | Guide | Does | Script |
|---|---|---|---|
| 1 | `guides/01-measure.md` | Time every test file, find the process starts | `time-tests.sh`, `find-spawns.sh` |
| 2 | `guides/02-plan.md` | Pick a technique per cause, show the numbers, get a yes | — |
| 3 | `guides/03-runner.md` | Parallel runner, `test-changed`, the recipes | `add-runner.sh`, `changed-tests.sh` |
| 4 | `guides/04-batch.md` | One process for many inputs, tools called directly | `find-spawns.sh` |
| 5 | `guides/05-verify.md` | Measure again, prove failures are still found, same in CI | `time-tests.sh`, `compare-timings.sh` |
| 6 | `guides/06-pr.md` | PR with the before/after table, tell agents the new commands | — |

Ask in step 2 only. Stop at the first failing step, fix the cause, and run it again.

## Rules

1. **Measure first.** The time is rarely where it seems: in the session that led to this skill,
   devenv cost 0.4 s and four files with hundreds of Bicep starts cost 6 minutes.
2. **Never get faster by testing less.** No skipped or removed cases, no lower thresholds, no
   weaker assertions. Step 5 proves that a broken input still fails.
3. Change one cause at a time and time it, so each change shows its gain and a regression has one
   suspect.
4. The work happens in a worktree with a PR (git skill). The user merges. Ask before changing CI
   pipelines or shared templates that other repositories use.
5. Local and CI run the same commands: CI calls the recipes or the scripts behind them, so a test
   that passes locally passes in CI.
6. While working, run `just test-changed`. Run the full `just test` once before you report done.
   Read the last line and the failures, not the whole log.

## References

| File | Read when |
|---|---|
| `references/runners.md` | Commands, parallel and changed-test flags per runner (Pester, Vitest, bun, pytest, nix) |
| `references/recipes.md` | Writing or changing the recipes, devenv scripts, or a CI step |
| `references/pitfalls.md` | Something behaves oddly: globs in PowerShell, missing output, a tool slower than expected |
| `references/scripts.md` | Options and output of the scripts |
