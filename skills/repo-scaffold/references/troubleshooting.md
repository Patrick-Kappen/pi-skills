# Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Could not start dynamically linked executable` (biome, esbuild, ...) | A prebuilt Linux binary from npm on NixOS | Take the tool from nixpkgs in `devenv.nix`, not from npm |
| devenv: `infinite recursion` | A hook entry references `config.packages`, or a script references the hook config | Use explicit tool lists (see `devenv.md`) |
| `.../bin/check: No such file` in a hook | `config.scripts.x.package` is the interpreter | Use `config.scripts.x.scriptPackage` |
| `no-commit-to-branch` fails in CI on `main` | The hook also runs in `devenv test` | `SKIP: no-commit-to-branch` in the CI job (in the template) |
| convco in CI: `could not find repository` | convco needs a git repository, also with `--from-stdin` | `cd "$(mktemp -d)" && git init -q` first (in the template) |
| release-please proposes 1.0.0 | No previous release | `initial-version: 0.1.0` (in the template) |
| Release PR CI: "approval required" | PR opened with `GITHUB_TOKEN` | Approve the run, or set `RELEASE_PLEASE_TOKEN` |
| biome: `No files were processed` in pre-commit | Only ignored files were staged | `--no-errors-on-unmatched` (in the template) |
| Tests in hooks write into the repository's own index | `GIT_INDEX_FILE` and other `GIT_*` from git | `unset "${!GIT_@}"` in the hook script (in the template) |
| `nix flake check` misses new files | Flakes only see files tracked by git | `git add` first |
| Central pre-commit: `formatter ... needs treefmt` | The flake's formatter is not treefmt | `pkgs.nixfmt-tree` |
