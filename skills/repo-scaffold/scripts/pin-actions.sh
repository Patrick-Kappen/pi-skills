#!/usr/bin/env bash
# Usage: pin-actions.sh <directory>
# Replaces every `@PIN:<owner>/<repo>@` in the files under <directory> with the commit SHA of that
# action's latest release and a `# <tag>` comment, so workflows never use a tag that can move.
set -euo pipefail
# shellcheck source=lib.sh source-path=SCRIPTDIR
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require gh grep sed
dir="${1:?usage: pin-actions.sh <directory>}"

mapfile -t actions < <(grep -rhoE '@PIN:[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+@' "${dir}" | sort -u | sed -E 's/^@PIN:(.*)@$/\1/')
for action in "${actions[@]}"; do
  tag="$(gh api "repos/${action}/releases/latest" --jq .tag_name)"
  sha="$(gh api "repos/${action}/commits/${tag}" --jq .sha)"
  [[ ${sha} =~ ^[0-9a-f]{40}$ ]] || die "could not resolve ${action}@${tag}"
  grep -rlF "@PIN:${action}@" "${dir}" | while read -r file; do
    sed -i "s|@PIN:${action}@|@${sha} # ${tag}|g" "${file}"
  done
  info "pinned ${action} ${tag} (${sha:0:12})"
done
