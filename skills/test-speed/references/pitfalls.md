# Pitfalls

| Problem | Cause | Fix |
|---|---|---|
| `bicep build-params --pattern $glob` fails with "Unrecognized command or argument" and a list of files | PowerShell on Linux expands wildcards in arguments to native commands, also from variables and splatted arrays | Pass one argument: `"--pattern=$glob"`. An argument that matches no file is left alone, so the bug only shows when files exist |
| Per-file lines of a parallel PowerShell runner do not show | `Write-Information` inside `ForEach-Object -Parallel` does not reach the console (`Write-Host` does, but PSScriptAnalyzer flags it, and replacing it silently drops the lines) | Return objects from the parallel block and print them in the parent pipeline (as the template does) |
| PSRule fails in the test process with a YamlDotNet error | PSRule and powershell-yaml ship different YamlDotNet versions; the first one loaded wins | Run PSRule in a child `pwsh` (one per batch, not per file) |
| Each Bicep call costs about a second more than it should | `az bicep` starts the Azure CLI (Python) before Bicep (.NET, about 0.85 s per start) | Call `bicep` directly; fall back to `~/.azure/bin/bicep`, where `az bicep install` puts it, for CI |
| Tests pass locally, fail in CI after the change | The batched code calls a tool that is on the dev `PATH` only | Resolve the tool as above, or install it in the CI step; run CI on the branch |
| Per-file times look worse after parallelising | Parallel files compete for CPU and disk | Compare wall time for the suite; time single files with `--jobs 1` |
| The suite is barely faster in parallel | One file takes most of the time | Batch inside that file (`guides/04-batch.md`), or split it into files that can run side by side |
| A test fails only in parallel | Shared temp paths, ports, global state, or order dependence | Own temp paths (`$TestDrive`, `mkdtemp`, `tmp_path`), random ports, setup per file; reproduce with `test-serial` |
| `test-changed` misses a test | The test is not named after the code and not in a mirror folder | Rename or move it, or extend the mapping in `changed-tests.sh` |
| `test-changed` runs everything for a small change | The change touched a file in the run-everything list (lock file, `devenv.nix`, `justfile`, test config) | Expected; the list is `ALL_PATTERN` in `changed-tests.sh` |
| `vitest related` fails for a docs change | No test matched | `--passWithNoTests` |
| `bun test some/file.test.ts` runs other files too | A positional argument without `./` is a path filter | `bun test ./some/file.test.ts` |
| Entering the environment takes seconds | devenv re-evaluates (changed `devenv.nix`, no cache) or `enterShell` does work (installs modules) | Enter once per run; make `enterShell` idempotent and quick (install only when missing) |
| A devenv script `test` does not run in the shell | The bash builtin `test` wins | Name the scripts `tests`, `tests-changed`, `tests-serial` |
| A test that creates a git repository writes into the real one | Inside a git hook, `GIT_DIR`, `GIT_INDEX_FILE` and more are set | Unset `GIT_*` in the hook, or in the test setup |
