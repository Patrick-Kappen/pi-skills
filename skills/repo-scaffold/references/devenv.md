# devenv

`devenv.nix` is a module. The common part sits in the repository root, and the language part is
imported from `nix/devenv/<language>.nix`.

## Scripts

Every repository has the same commands, so the hooks and CI do not depend on the language:

| Script | Defined in | Runs |
|---|---|---|
| `lint` | common + language | typos, markdownlint, nixfmt, statix, deadnix, actionlint, zizmor, shellcheck, plus the language linter (biome / ruff) |
| `typecheck` | language | tsc / pyright; `true` for `none` |
| `unit [files]` | language | All unit tests, or only those related to `files` |
| `security` | common + language | gitleaks over the history, osv-scanner over the lock files, plus `npm audit` / `uv` audit |
| `check` | common | `lint`, `typecheck`, the language's full test run with coverage, `security`, `nix flake check` (unless `SKIP_FLAKE_CHECK=1`) |
| `git-hook <type>` | common | Used by `.githooks/`; runs prek with the generated config |

`enterTest` runs `check`, so `devenv test` runs all pre-commit hooks on all files, and then `check`.

## Hooks (git-hooks.nix via devenv)

- **pre-commit:** hygiene (large files, merge markers, case conflicts, JSON/YAML,
  end-of-file, whitespace, no commits on `main`), detect-private-keys, gitleaks (staged), zizmor,
  typos, markdownlint, actionlint, shellcheck, nixfmt/statix/deadnix, and from the language:
  formatter/linter, typecheck, and **the unit tests related to the staged files**.
- **commit-msg:** convco (Conventional Commits).
- **pre-push:** `check-all`, which is `check`.

## Rules

- Hook entries are scripts with their own `PATH`, because hooks also run outside `devenv shell`. Unset
  `GIT_*` in hooks that run tests: git sets `GIT_INDEX_FILE` and more, and tests that make temp
  repositories would otherwise write into this one.
- Do not reference `config.packages` from a hook entry. It contains the hook runner, which depends on
  the hook config, so that is infinite recursion. Use the explicit tool list.
- Script packages are `config.scripts.<name>.scriptPackage`; `.package` is the interpreter.
- devenv's `devenv:git-hooks:install` task is replaced (see `hooks.md`).
