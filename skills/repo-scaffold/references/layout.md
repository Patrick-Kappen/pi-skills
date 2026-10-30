# Layout of a scaffolded repository

| Path | Purpose | Source |
|---|---|---|
| `devenv.nix`, `devenv.yaml`, `devenv.lock` | Dev environment: tools, scripts, git hooks | `templates/devenv/` |
| `nix/devenv/<language>.nix` | Language part of the dev environment, imported by `devenv.nix` | `templates/devenv/lang/` |
| `.githooks/{pre-commit,commit-msg,pre-push}` | Run the hooks of `devenv.nix` with prek (see `hooks.md`) | `templates/common/.githooks/` |
| `flake.nix`, `flake.lock` | Formatter (`nix fmt`) and `nix flake check` (if `--flake yes`) | `templates/nix/` |
| `.github/workflows/ci.yml` | `devenv test` on every PR and on `main`; PR title and commit messages | `templates/github/` |
| `.github/workflows/release.yml` | release-please, tag check, `latest` branch (if `--release yes`) | `templates/github/` |
| `.github/dependabot.yml` | Weekly updates of GitHub Actions and the language's packages | `templates/github/` |
| `release-please-config.json`, `.release-please-manifest.json`, `CHANGELOG.md` | Release notes and versions | `templates/github/` |
| `README.md`, `CONTRIBUTING.md`, `SECURITY.md` | Documentation | `templates/common/` |
| `AGENTS.md` | Agent rules, always with the rule that agent files stay out of git; it stays local itself (global and repository `.gitignore`) | `templates/common/` |
| `LICENSE` | Chosen license | `templates/common/` |
| `.gitignore` | Ignores, including every agent file (`AGENTS.md`, `CLAUDE.md`, `.claude/`, `.cursor/`, `.pi/`, ...) | `templates/common/` |
| `_typos.toml`, `.markdownlint-cli2.jsonc` | Linter configuration | `templates/common/` |
| language files | `package.json`, `tsconfig.json`, `biome.json`, `knip.json`, `vitest.config.ts`, `src/` / `pyproject.toml`, `uv.lock`, `src/<module>/`, `tests/` | `templates/<language>/` |
