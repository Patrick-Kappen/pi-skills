#!/usr/bin/env bash
# Usage: toolchain.sh <repository directory>
# Installs the newest versions of the language's dev dependencies, writes the lock files (devenv.lock,
# flake.lock, package-lock.json or uv.lock), and fills in tool versions the templates leave open.
# The settings come from load_settings (.git/repo-scaffold.env).
# shellcheck disable=SC2154
set -euo pipefail
# shellcheck source=lib.sh source-path=SCRIPTDIR
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
dir="$(repo_dir "${1:-}")"
load_settings "${dir}"
cd "${dir}"

info "devenv: building the environment (first run takes a while)"
devenv shell -- true >/dev/null 2>&1 || die "devenv shell failed; run it in ${dir} to see why"

case "${language}" in
  typescript)
    info "npm: installing the newest TypeScript, Vitest, knip and @types/node 24"
    devenv shell -- npm install --save-dev --ignore-scripts --no-audit --no-fund \
      typescript vitest @vitest/coverage-v8 knip @types/node@24 >/dev/null
    biome="$(devenv shell -- biome --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n 1)"
    sed -i "s|@BIOME_SCHEMA@|https://biomejs.dev/schemas/${biome}/schema.json|" biome.json
    devenv shell -- biome check --write . >/dev/null
    ;;
  python)
    info "uv: adding pytest and pytest-cov, locking"
    devenv shell -- uv add --quiet --dev pytest pytest-cov
    devenv shell -- ruff format . >/dev/null
    ;;
  none) ;;
esac

if [[ ${flake} == yes ]]; then
  info "nix: locking the flake"
  git add -A
  nix flake lock 2>/dev/null
fi

git add -A
info "toolchain ready; next: scripts/verify.sh ${dir}"
