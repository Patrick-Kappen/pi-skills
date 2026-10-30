#!/usr/bin/env bash
# Usage: github.sh <repository directory> --yes
# Creates the GitHub repository from the scaffold settings, configures it (squash merges only,
# delete branches on merge, workflow permissions for release-please, topics) and pushes main.
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
gh api -X PATCH "repos/${repo}" \
  -F allow_squash_merge=true -F allow_merge_commit=false -F allow_rebase_merge=false \
  -F delete_branch_on_merge=true -F allow_auto_merge=true \
  -f squash_merge_commit_title=PR_TITLE -f squash_merge_commit_message=PR_BODY >/dev/null
gh api -X PUT "repos/${repo}/actions/permissions/workflow" \
  -f default_workflow_permissions=read -F can_approve_pull_request_reviews=true >/dev/null
topics=(-f "names[]=devenv")
[[ ${language} != none ]] && topics+=(-f "names[]=${language}")
[[ -f flake.nix ]] && topics+=(-f "names[]=nix")
gh api -X PUT "repos/${repo}/topics" "${topics[@]}" >/dev/null
info "created and configured https://github.com/${repo}"

info "pushing main (the pre-push hook runs check)"
git push -u origin main
info "pushed; CI: gh run list -R ${repo}"
