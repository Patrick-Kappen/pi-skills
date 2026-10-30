#!/usr/bin/env bash
# Creates a new repository from the templates. See references/parameters.md for the flags.
set -euo pipefail
# shellcheck source=lib.sh source-path=SCRIPTDIR
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

name="" location="" visibility="" language="none" description="" owner="" flake="yes" release="yes"
license="" dry_run=0 force=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --name) name="$2"; shift 2 ;;
    --location) location="$2"; shift 2 ;;
    --visibility) visibility="$2"; shift 2 ;;
    --language) language="$2"; shift 2 ;;
    --description) description="$2"; shift 2 ;;
    --owner) owner="$2"; shift 2 ;;
    --flake) flake="$2"; shift 2 ;;
    --release) release="$2"; shift 2 ;;
    --license) license="$2"; shift 2 ;;
    --dry-run) dry_run=1; shift ;;
    --force) force=1; shift ;;
    *) die "unknown flag: $1 (see references/parameters.md)" ;;
  esac
done

# Validate.
[[ ${name} =~ ^[a-z0-9][a-z0-9-]{0,62}$ ]] || die "--name must match ^[a-z0-9][a-z0-9-]{0,62}\$"
case "${location}" in work | private) ;; *) die "--location must be work or private" ;; esac
case "${visibility}" in public | private) ;; *) die "--visibility must be public or private" ;; esac
case "${language}" in typescript | python | none) ;; *) die "--language must be typescript, python or none" ;; esac
case "${flake}" in yes | no) ;; *) die "--flake must be yes or no" ;; esac
case "${release}" in yes | no) ;; *) die "--release must be yes or no" ;; esac
[[ -n ${description} && ${description} != *$'\n'* ]] || die "--description is required (one line)"
[[ ${description} != *'"'* && ${description} != *\\* ]] || die "--description must not contain \" or \\ (it goes into JSON and TOML)"
if [[ ${language} == python && ! ${name} =~ ^[a-z] ]]; then die "--name must start with a letter for python (it is also the module name)"; fi
[[ -n ${license} ]] || license="$([[ ${visibility} == public ]] && echo MIT || echo none)"
case "${license}" in MIT | Apache-2.0 | none) ;; *) die "--license must be MIT, Apache-2.0 or none" ;; esac
require git devenv nix gh jq sed
gh auth status >/dev/null 2>&1 || die "gh is not logged in (gh auth login); it is needed to pin the actions"
[[ -n ${owner} ]] || owner="$(gh api user --jq .login)"

# REPO_SCAFFOLD_ROOT replaces $HOME, for testing the skill itself.
target="${REPO_SCAFFOLD_ROOT:-${HOME}}/${location}/${name}"
module="${name//-/_}"
year="$(date +%Y)"
case "${language}" in
  typescript) release_type=node ecosystem=npm ;;
  python) release_type=python ecosystem=uv ;;
  none) release_type=simple ecosystem="" ;;
esac
spdx="${license}"
[[ ${license} == none ]] && spdx="UNLICENSED"

cat <<PLAN
repo-scaffold plan
  directory    ${target}
  github       ${owner}/${name} (${visibility})
  language     ${language} (release type ${release_type})
  description  ${description}
  license      ${license}
  flake        ${flake}
  release      ${release}
  files        devenv.nix, devenv.yaml, nix/devenv/${language}.nix, .githooks/, .github/workflows/ci.yml,
               $([[ ${release} == yes ]] && echo "release.yml, release-please config, CHANGELOG.md, ")dependabot.yml,
               $([[ ${flake} == yes ]] && echo "flake.nix, ")README.md, CONTRIBUTING.md, SECURITY.md$([[ ${license} != none ]] && echo ", LICENSE")
PLAN
[[ ${dry_run} -eq 1 ]] && exit 0

if [[ -e ${target} ]]; then
  [[ ${force} -eq 1 && -z "$(ls -A "${target}")" ]] || die "${target} exists (use --force only for an empty directory)"
fi
mkdir -p "${target}"

# The skill may run from the read-only Nix store: copy the templates to a writable place first, so
# the copies in the new repository are writable too.
writable_templates="$(mktemp -d)"
trap 'rm -rf "${writable_templates}"' EXIT
cp -r "${templates}/." "${writable_templates}"
chmod -R u+w "${writable_templates}"
templates="${writable_templates}"

cd "${target}"
git init -q -b main

# Common files.
cp -r "${templates}/common/.githooks" .githooks
cp "${templates}/common/gitignore" .gitignore
cp "${templates}/common/_typos.toml" _typos.toml
cp "${templates}/common/markdownlint-cli2.jsonc" .markdownlint-cli2.jsonc
cp "${templates}/common/README.md" "${templates}/common/CONTRIBUTING.md" "${templates}/common/SECURITY.md" .
[[ ${release} == yes ]] && cat "${templates}/common/README.release.fragment" >>README.md
[[ ${license} != none ]] && cp "${templates}/common/LICENSE-${license}" LICENSE

# devenv.
cp "${templates}/devenv/devenv.yaml" "${templates}/devenv/devenv.nix" .
mkdir -p nix/devenv
cp "${templates}/devenv/lang/${language}.nix" "nix/devenv/${language}.nix"

# Language files.
if [[ ${language} != none ]]; then
  cp -r "${templates}/${language}/." .
  [[ -f gitignore.append ]] && cat gitignore.append >>.gitignore && rm gitignore.append
  if [[ -d src/@MODULE@ ]]; then mv src/@MODULE@ "src/${module}"; fi
  if [[ ${language} == python && ${license} == none ]]; then sed -i '/^license = /d' pyproject.toml; fi
fi

# Nix flake.
[[ ${flake} == yes ]] && cp "${templates}/nix/flake.nix" flake.nix

# GitHub.
mkdir -p .github/workflows
cp "${templates}/github/workflows/ci.yml" .github/workflows/
cp "${templates}/github/dependabot.yml" .github/
if [[ -n ${ecosystem} ]]; then
  sed "s/@ECOSYSTEM@/${ecosystem}/" "${templates}/github/dependabot-language.yml" >>.github/dependabot.yml
fi
if [[ ${release} == yes ]]; then
  cp "${templates}/github/workflows/release.yml" .github/workflows/
  cp "${templates}/github/release-please-config.json" release-please-config.json
  cp "${templates}/github/release-please-manifest.json" .release-please-manifest.json
  cp "${templates}/github/CHANGELOG.md" CHANGELOG.md
  [[ ${release_type} == simple ]] && echo "0.0.0" >version.txt
fi

# Placeholders.
escape() { printf '%s' "$1" | sed -e 's/[\/&|]/\\&/g'; }
while IFS= read -r -d '' file; do
  sed -i \
    -e "s|@NAME@|$(escape "${name}")|g" \
    -e "s|@MODULE@|$(escape "${module}")|g" \
    -e "s|@DESCRIPTION@|$(escape "${description}")|g" \
    -e "s|@OWNER@|$(escape "${owner}")|g" \
    -e "s|@YEAR@|${year}|g" \
    -e "s|@LICENSE@|${spdx}|g" \
    -e "s|@LANGUAGE@|${language}|g" \
    -e "s|@RELEASE_TYPE@|${release_type}|g" \
    "${file}"
done < <(find . -path ./.git -prune -o -type f -print0)
"${skill_dir}/scripts/pin-actions.sh" .github

# Settings for the next steps (not tracked).
cat >.git/repo-scaffold.env <<ENV
name=$(printf '%q' "${name}")
owner=$(printf '%q' "${owner}")
visibility=$(printf '%q' "${visibility}")
language=$(printf '%q' "${language}")
description=$(printf '%q' "${description}")
flake=$(printf '%q' "${flake}")
release=$(printf '%q' "${release}")
license=$(printf '%q' "${license}")
ENV

git add -A
info "scaffolded ${target}; next: scripts/toolchain.sh ${target}"
