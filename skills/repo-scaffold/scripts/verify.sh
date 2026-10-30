#!/usr/bin/env bash
# Usage: verify.sh <repository directory>
# Runs what CI runs (devenv test: every pre-commit hook on every file, then `check`), and checks that
# the git hooks are wired up.
set -euo pipefail
# shellcheck source=lib.sh source-path=SCRIPTDIR
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
dir="$(repo_dir "${1:-}")"
cd "${dir}"

git add -A
info "devenv test (the first run builds everything)"
SKIP=no-commit-to-branch devenv test

[[ -x .devenv/profile/bin/git-hook ]] || die "the git hook runner is missing (.devenv/profile/bin/git-hook)"
hooks="$(git config --get core.hooksPath || true)"
case "${hooks}" in
  .githooks) info "hooks: core.hooksPath=.githooks" ;;
  "") die "no core.hooksPath; run 'devenv shell' once" ;;
  *) info "hooks: global hooks at ${hooks}; they call .githooks/" ;;
esac
info "verified ${dir}"
