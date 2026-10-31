#!/usr/bin/env bash
# Creates the skeleton of a new skill in the pi-skills repository and adds it to the README table.
# Usage: new-skill.sh --repo <dir> --name <name> --kind <single|index> --description "<text>"
#                     [--prompt] [--manual] [--dry-run]
set -euo pipefail

die() {
  echo "new-skill: $*" >&2
  exit 1
}

repo="" name="" kind="" description="" prompt=0 manual=0 dry_run=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) repo="$2"; shift 2 ;;
    --name) name="$2"; shift 2 ;;
    --kind) kind="$2"; shift 2 ;;
    --description) description="$2"; shift 2 ;;
    --prompt) prompt=1; shift ;;
    --manual) manual=1; shift ;;
    --dry-run) dry_run=1; shift ;;
    *) die "unknown argument: $1" ;;
  esac
done

[[ -n ${repo} ]] || die "--repo <dir> is required (a worktree of the pi-skills repository)"
[[ -f "${repo}/scripts/check-skills.ts" && -d "${repo}/skills" ]] || die "${repo} is not the pi-skills repository"
[[ ${name} =~ ^[a-z0-9]+(-[a-z0-9]+)*$ && ${#name} -le 64 ]] ||
  die "--name must be lowercase letters, digits and single hyphens, at most 64 characters"
[[ ${kind} == single || ${kind} == index ]] || die "--kind must be single or index"
[[ -n ${description} ]] || die "--description is required"
[[ ${#description} -le 1024 ]] || die "--description has ${#description} characters; the maximum is 1024"
[[ ${description} != *[\"\\\|]* ]] ||
  die '--description must not contain ", \ or |'
if [[ ${manual} -eq 1 ]]; then
  [[ ${description} == *"/${name}"* || ${description} == *"on request"* ]] ||
    die "--manual: the description must say how to start it, for example: Run only on request via /${name}."
else
  [[ ${description} =~ Use\ (when|for|to|it|this) ]] ||
    die '--description must say when to use the skill ("Use when ..." or "Use for ...")'
fi

here="$(dirname "$(realpath "${BASH_SOURCE[0]}")")"
templates="${here}/../templates"
target="${repo}/skills/${name}"
[[ ! -e ${target} ]] || die "skills/${name} already exists; use the skill-review skill to change it"

mapfile -t files < <(cd "${templates}/${kind}" && find . -type f | sed 's|^\./||' | sort)
[[ ${prompt} -eq 1 ]] && files+=("prompts/${name}.md" "prompts/.markdownlint-cli2.jsonc")
if [[ ${manual} -eq 1 ]]; then start="only on request (disable-model-invocation: true)"; else start="loaded by the model when relevant"; fi

cat <<PLAN
new-skill plan
  skill        skills/${name} (${kind})
  start        ${start}
  description  ${description}
  files        ${files[*]}
  readme       adds a row to the skill table in README.md
PLAN
[[ ${dry_run} -eq 1 ]] && exit 0

mkdir -p "${target}"
# Templates may come from the read-only Nix store: copy, then make the copies writable.
cp -r "${templates}/${kind}/." "${target}/"
if [[ ${prompt} -eq 1 ]]; then
  mkdir -p "${target}/prompts"
  cp "${templates}/prompts/prompt.md" "${target}/prompts/${name}.md"
  # The prompt starts with front matter, not a heading; the config extends the repository's.
  sed 's|\.\./\.\./\.\./\.\./|../../../|' "${templates}/prompts/.markdownlint-cli2.jsonc" >"${target}/prompts/.markdownlint-cli2.jsonc"
fi
chmod -R u+w "${target}"

escape() { printf '%s' "$1" | sed -e 's/[\/&|]/\\&/g'; }
while IFS= read -r -d '' file; do
  sed -i -e "s|@NAME@|$(escape "${name}")|g" -e "s|@DESCRIPTION@|$(escape "${description}")|g" "${file}"
  if [[ ${manual} -eq 1 ]]; then
    sed -i -e 's|^@INVOCATION@$|disable-model-invocation: true|' "${file}"
  else
    sed -i -e '/^@INVOCATION@$/d' "${file}"
  fi
done < <(find "${target}" -type f -print0)

# The README row goes after the last row of the skill table.
readme="${repo}/README.md"
row="| [\`${name}\`](skills/${name}/SKILL.md) | TODO: what it does, in one line. |"
last="$(grep -n -E '^\| \[.[a-z0-9-]+.\]\(skills/' "${readme}" | tail -1 | cut -d: -f1)"
[[ -n ${last} ]] || die "no skill table found in README.md"
awk -v line="${last}" -v row="${row}" '{ print } NR == line { print row }' "${readme}" >"${readme}.new"
mv "${readme}.new" "${readme}"

echo "new-skill: created skills/${name}; replace every TODO (grep -rn TODO skills/${name} README.md)"
