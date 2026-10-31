# Runners

Per runner: how to run in parallel, how to run only what changed, how to time. Checked against
Vitest 5.0, bun 1.4, pytest 9.1 with pytest-xdist 3.8, Pester 5 and PowerShell 7.6.

## Pester (PowerShell)

| Need | How |
|---|---|
| Parallel | Pester has no file parallelism. `<repo>/scripts/Invoke-PesterParallel.ps1` (from `add-runner.sh`): one `pwsh` per file, slowest first from `test-timings.json`, one summary |
| Changed | `<repo>/scripts/changed-tests.sh --strict --run '<runner>' <files>` |
| One file | `$c = New-PesterConfiguration; $c.Run.Path = '<file>'; $c.Run.Exit = $true; Invoke-Pester -Configuration $c` |
| Timing | `time-tests.sh --runner pester`; inside Pester the result object has `Duration` per container |

A process per file also isolates modules that cannot load together (PSRule and powershell-yaml).

## Vitest

| Need | How |
|---|---|
| Parallel | Default: files in parallel (`--pool forks`); `--maxWorkers <n or %>` limits it |
| Serial | `vitest run --no-file-parallelism` |
| Changed | `vitest related --run --passWithNoTests <files>` (follows imports); `vitest run --changed <ref>` (git) |
| CI split | `--shard <i>/<n>` |
| Timing | `time-tests.sh --runner vitest`, or `--reporter=json` (per-file duration) |

Without `--passWithNoTests` Vitest exits 1 when no test matches; `test-changed` for a docs change
would fail.

## bun

| Need | How |
|---|---|
| Parallel | `bun test --parallel[=<n>]`: worker processes, default the core count; `--timings=<file.json>` starts the slowest files first and balances `--shard` |
| Changed | `bun test --changed` (uncommitted changes, follows imports), `--changed=<ref>`; exits 0 when nothing is affected |
| One file | `bun test ./<file>`: a positional argument without `./` is a filter on paths |
| No tests | `--pass-with-no-tests` |

The run_tests tool of the pi `tests` extension runs bun projects without a recipe; the recipe
still gives people and CI the same commands.

## pytest

| Need | How |
|---|---|
| Parallel | `pytest -n auto` with the `pytest-xdist` plugin (a dev dependency); `-p no:xdist` turns it off |
| Changed | `<repo>/scripts/changed-tests.sh --strict --run 'pytest -q' <files>`; `pytest --lf` reruns the last failures |
| Timing | `pytest --durations=0` (every setup and test), `--durations-min=<s>` |
| One file | `pytest -q <file>`; with uv: `uv run pytest` |

## Nix flake checks

`nix flake check` builds every check, but a check whose inputs did not change is a cache hit,
locally and in CI with a nix cache. Give each package its own check with only its sources, so a
change rebuilds one check:

```nix
checks = lib.genAttrs' packages (name: lib.nameValuePair "tests-${name}" (
  pkgs.runCommand "tests-${name}" { src = testSources name; nativeBuildInputs = [ pkgs.bun ]; } ''
    cp -r "$src" src && chmod -R u+w src && cd src
    HOME="$TMPDIR" bun test ./packages/${name}
    touch "$out"
  ''));
```

`testSources name` is a `lib.fileset` of the package plus what it shares. Repo-wide checks that
take a second (tsc, biome) can stay one check.

## Other runners

`time-tests.sh --cmd '<command with {} for the file>'` times any runner per file. For Go
(`go test ./...` is parallel per package, `-run`), Rust (`cargo nextest` runs tests in parallel
processes) and .NET (`dotnet test` parallelises assemblies), use the runner's own parallelism and
write the three recipes by hand (`references/recipes.md`).
