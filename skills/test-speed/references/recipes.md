# Recipes

Every repository gets the same three test recipes, so people, agents, hooks and CI run tests the
same way, whatever the runner.

## Contract

| Recipe | Does | Exit |
|---|---|---|
| `just test [paths]` | All test files, or those under the paths, in parallel, slowest first | non-zero when a test fails |
| `just test-changed [files]` | The tests that cover the files; without files, every change against the base branch (committed, staged, unstaged, untracked) | non-zero when a test fails; 3 when a changed code file has no test (pester, pytest) |
| `just test-serial [paths]` | One after another, in one process: to debug a test that fails only in parallel | as `test` |

- Output: one line per file, then the failures, then one summary line
  (`Passed 605 Failed 0 Skipped 3 in 47.0s (35 files)`). Agents read the last line and the failures.
- `test-changed` must pass for a change that needs no test (docs, images, LICENSE): it runs
  nothing and exits 0. A change to a dependency, tool or test configuration runs everything.
- The run_tests tool of the pi `tests` extension calls `just test-changed <files>` with every
  changed path, also deleted files and files that are not code (`make test-changed FILES="..."`
  for a Makefile).
- Other recipes a repository usually has: `lint`, `types`, `check` (all of them, what CI runs). Name
  them the same everywhere.

## just on top of devenv

- devenv holds the tools and the commands: scripts `tests`, `tests-changed`, `tests-serial`. Not
  `test`: in an interactive shell or a bash script, the builtin `test` wins over a script with that
  name.
- The justfile calls them: `devenv shell -- tests "$@"`. Entering devenv costs about 0.4 s when its
  evaluation is cached; measure it (`time-tests.sh` prints it).
- `set positional-arguments` with `"$@"` passes each path as one argument, also with spaces. `@`
  in front of a recipe line keeps just from echoing the command.
- Without devenv, the recipes hold the commands themselves.
- An existing `Makefile` stays; add the recipes to a justfile next to it, or make targets with the
  same names when the repository has only make.

## Where the recipes are used

| Place | Runs |
|---|---|
| pre-commit hook | `just test-changed $(git diff --cached --name-only)`, or the hook framework's file list |
| pre-push hook, CI | `just test` (or `devenv shell -- tests` where just is not installed) |
| Agents | `just test-changed` while working, `just test` before reporting done |
| Agent briefings, sub-agents | the same two commands, written in the briefing |

In hooks, unset `GIT_*` before tests that create temporary repositories: git sets
`GIT_INDEX_FILE` and more for hooks, and those tests would write into the repository.
