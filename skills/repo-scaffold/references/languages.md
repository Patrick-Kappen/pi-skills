# Languages

## typescript

| Concern | Tool | Notes |
|---|---|---|
| Runtime | Node 24 (`languages.javascript`, npm) | `npm ci` on shell entry |
| Types | TypeScript, newest (`tsc`, strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `erasableSyntaxOnly`) | from npm, pinned in `package-lock.json` |
| Lint + format | Biome (from nixpkgs) | npm's biome binary does not run on NixOS |
| Tests | Vitest with v8 coverage and thresholds | `vitest related --run <files>` in pre-commit |
| Dead code | knip | in `check` |
| Audit | `npm audit`, osv-scanner | in `security` |
| Release type | `node` | release-please bumps `package.json` and the lock |

`scripts/toolchain.sh` installs the newest versions of the dev dependencies and writes the lock.

## python

| Concern | Tool | Notes |
|---|---|---|
| Runtime | Python 3.13 + uv (`languages.python`, `uv.enable`) | `uv sync` on shell entry; the virtualenv is `.devenv/state/venv` (`UV_PROJECT_ENVIRONMENT`), not `.venv/` |
| Lint + format | Ruff (from nixpkgs) | `ruff check`, `ruff format --check` |
| Types | Pyright (from nixpkgs), strict | `[tool.pyright]` in `pyproject.toml` points at `.devenv/state/venv`; `ty` (Astral, beta) is an alternative |
| Tests | pytest + pytest-cov with `--cov-fail-under` | pre-commit runs `tests/test_<module>.py` for each staged `src/<pkg>/<module>.py` |
| Audit | osv-scanner over `uv.lock` | in `security` |
| Release type | `python` | release-please bumps `pyproject.toml` |

## none

Only the common tools: lint, typos, markdown, Nix, Actions, security. `typecheck` and `unit` do
nothing. Release type `simple`, with `version.txt`.

## Adding a language

1. Add `templates/<language>/` with its files and `templates/devenv/<language>.nix`. That file defines
   the `typecheck`, `unit`, `test-all` and `lint-language` scripts and the language hooks.
2. Add its dependabot ecosystem and release type to `scripts/scaffold.sh` (`case "$language"`).
3. Add its install step to `scripts/toolchain.sh`.
4. Scaffold a test repository with `--github no` and run `scripts/verify.sh` on it.
