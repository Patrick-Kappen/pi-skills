# Scripts

All scripts are in `scripts/` of this skill. They need bash, git and coreutils; they read the
repository and write only where named below.

## time-tests.sh

```sh
time-tests.sh [--runner auto|pester|vitest|bun|pytest] [--cmd '<command; {} = file>'] [--jobs <n>]
              [--timeout <s>] [--out <file.tsv>] [--no-devenv] <repo> [<path>...]
```

- Runs each test file in its own command, `--jobs` at a time (default: half the processors), and
  prints `seconds  ok|FAIL|TIMEOUT  file`, slowest first, then
  `sum · wall · 3 slowest files = n% of the sum · failed · logs`.
- With `devenv.nix` and outside its shell: prints the time of `devenv shell -- true`, then runs
  everything in one devenv shell.
- Logs per file: `${XDG_CACHE_HOME:-~/.cache}/test-speed/<repo>-<time>/`.
- `--out` writes the results and a `# wall` line for `compare-timings.sh`.
- A repository with several runners: run it once per `--runner`.

## find-spawns.sh

```sh
find-spawns.sh <repo> [<path>...]
```

Counts process starts per file and command in the test files (or the given paths), most first,
marks data-driven files, and prints a hint per command. Comment lines are skipped. It is a
heuristic: read the file to count how often each line runs.

## changed-tests.sh

```sh
changed-tests.sh [--root <dir>] [--base <ref>] [--strict] [--all] [--pattern <regex>] [--run '<command>'] [<file>...]
```

- Prints the test files that cover the files, or every change against `--base` (default
  `origin/HEAD`, else `origin/main`, `main`, `master`).
- Covering: the test file itself, the same name stem (`naming.test.ts`, `Foo.Tests.ps1`,
  `test_x.py`, `x_test.py`), a test that mentions the file name, or a test in a folder that mirrors
  the file's folder or a parent (`Modules/X/a.ps1` → `Tests/Modules/X/`, `Tests/Modules/`).
- Run-everything files (`ALL_PATTERN`) select all tests; docs and images (`SKIP_PATTERN`) select
  none.
- `--strict`: exit 3 and name the changed code files without a test.
- `--run`: run the command with the test files appended; nothing runs (exit 0) when there are none.
- Copied into repositories by `add-runner.sh`; adapt the patterns there, in the copy.

## add-runner.sh

```sh
add-runner.sh <repo> --runner pester|vitest|bun|pytest [--dir <dir>] [--base <ref>] [--dry-run] [--force]
```

Writes the justfile (from `templates/justfile`) and, for pester and pytest, the helpers into
`--dir` (default `scripts`). Keeps existing files unless `--force`; for an existing justfile it
prints the recipes to add. With `devenv.nix` it prints the scripts for `devenv.nix` (from
`templates/devenv-test.nix`) instead of putting commands in the justfile. pytest without
`pytest-xdist` gets a serial `test` and a warning.

## compare-timings.sh

```sh
compare-timings.sh <before.tsv> <after.tsv>
```

A Markdown table per file (before, after, change; slowest before first), then the sum of the files
and the wall time. Files in one run only show `-`.
