#!/usr/bin/env bash
# Usage: github.sh <repository directory> --yes
# Creates the GitHub repository from the scaffold settings, sets its topics, pushes main, and then
# applies the GitHub settings of github-settings.ts (merges, Actions, security, branch ruleset).
# --yes confirms that the user agreed: this is visible to others.
# The settings come from load_settings (.git/repo-scaffold.env).
# shellcheck disable=SC2154
set -euo pipefail
# shellcheck source=lib.sh source-path=SCRIPTDIR
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
dir="$(repo_dir "${1:-}")"
[[ ${2:-} == --yes ]] || die "pass --yes after the user confirmed creating ${dir##*/} on GitHub"
load_settings "${dir}"
cd "${dir}"
require gh git
repo="${owner}/${name}"
[[ -n "$(git rev-parse --verify -q HEAD || true)" ]] || die "no commits yet; run first-commits.sh"

if gh repo view "${repo}" >/dev/null 2>&1; then
  die "${repo} already exists on GitHub"
fi
gh repo create "${repo}" "--${visibility}" --description "${description}" --source . --remote origin
topics=(-f "names[]=devenv")
[[ ${language} != none ]] && topics+=(-f "names[]=${language}")
[[ -f flake.nix ]] && topics+=(-f "names[]=nix")
gh api -X PUT "repos/${repo}/topics" "${topics[@]}" >/dev/null
info "created https://github.com/${repo}"

info "pushing main (the pre-push hook runs check)"
git push -u origin main
# After the push: the ruleset requires the CI job names from ci.yml on the default branch.
"${skill_dir}/scripts/github-settings.ts" "${repo}" --apply --yes
info "pushed and configured; CI: gh run list -R ${repo}"
