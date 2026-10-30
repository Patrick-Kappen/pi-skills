#!/usr/bin/env bash
# Usage: first-commits.sh <repository directory>
# Makes the first commits on main, one per concern, with all hooks running (only no-commit-to-branch
# is skipped, because these are the only commits that belong on main directly).
# The settings come from load_settings (.git/repo-scaffold.env).
# shellcheck disable=SC2154
set -euo pipefail
# shellcheck source=lib.sh source-path=SCRIPTDIR
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
dir="$(repo_dir "${1:-}")"
load_settings "${dir}"
cd "${dir}"
[[ -z "$(git rev-parse --verify -q HEAD || true)" ]] || die "${dir} already has commits"
git reset -q

commit() {
  local message="$1"
  shift
  local paths=()
  local path
  for path in "$@"; do
    [[ -e ${path} ]] && paths+=("${path}")
  done
  [[ ${#paths[@]} -gt 0 ]] || return 0
  git add -- "${paths[@]}"
  git diff --cached --quiet && return 0
  SKIP=no-commit-to-branch git commit -q -F - <<<"${message}"
  info "committed: ${message%%$'\n'*}"
}

commit "build: devenv environment with linters, tests and git hooks

devenv provides the tools and scripts (lint, typecheck, unit, security,
check). git-hooks.nix hooks run through the tracked .githooks/:
pre-commit checks the staged files and runs the tests related to them,
commit-msg checks Conventional Commits, pre-push runs check." \
  devenv.nix devenv.yaml devenv.lock nix .githooks .gitignore _typos.toml .markdownlint-cli2.jsonc \
  flake.nix flake.lock package.json package-lock.json tsconfig.json biome.json knip.json vitest.config.ts \
  pyproject.toml uv.lock .python-version version.txt

commit "feat: project skeleton" src tests

commit "ci: CI on pull requests$([[ ${release} == yes ]] && echo " and releases with release-please")

ci.yml runs devenv test on every PR and on main and checks the PR title
and commit messages. Actions are pinned to commit SHAs; Dependabot
updates them weekly.$([[ ${release} == yes ]] && printf '\n\nrelease.yml keeps one release PR that collects the merged PRs; merging\nit tags vX.Y.Z, publishes the release and moves the latest branch.')" \
  .github release-please-config.json .release-please-manifest.json CHANGELOG.md

commit "docs: README, contributing and security notes" README.md CONTRIBUTING.md SECURITY.md LICENSE

agent_files="$(git ls-files | grep -E '(^|/)(\.?AGENTS\.md|CLAUDE(\.local)?\.md|GEMINI\.md|\.cursorrules|\.windsurfrules|\.clinerules|copilot-instructions\.md)$|(^|/)\.(claude|cursor|pi)/' || true)"
[[ -z ${agent_files} ]] || die "agent files are tracked, which they must never be: ${agent_files//$'\n'/, }"
left="$(git status --porcelain)"
[[ -z ${left} ]] || die "files left uncommitted: ${left//$'\n'/, }"
git log --oneline
