#!/usr/bin/env bash
# Lets a cheap model analyse the session digests of find-usage.ts against the skill, and writes
# report.md next to the digests.
# Usage: analyse.sh <digest-dir> <skill-dir> [--model <provider/id>] [--thinking <level>] [--chunk-chars <n>]
set -euo pipefail

usage() {
  echo "usage: analyse.sh <digest-dir> <skill-dir> [--model <provider/id>] [--thinking <level>] [--chunk-chars <n>]" >&2
  exit 2
}

[[ $# -ge 2 ]] || usage
digests="$(realpath "$1")"
skill_dir="$(realpath "$2")"
shift 2
model="${PI_SKILL_REVIEW_MODEL:-openai-codex/gpt-6-luna}"
thinking="${PI_SKILL_REVIEW_THINKING:-high}"
chunk_chars=350000
while [[ $# -gt 0 ]]; do
  case "$1" in
    --model) model="$2"; shift 2 ;;
    --thinking) thinking="$2"; shift 2 ;;
    --chunk-chars) chunk_chars="$2"; shift 2 ;;
    *) usage ;;
  esac
done

here="$(dirname "$(realpath "${BASH_SOURCE[0]}")")"
assets="${here}/../assets"
[[ -f "${skill_dir}/SKILL.md" ]] || { echo "analyse.sh: no SKILL.md in ${skill_dir}" >&2; exit 1; }
mapfile -t files < <(find "${digests}" -maxdepth 1 -name '[0-9]*.md' | sort)
[[ ${#files[@]} -gt 0 ]] || { echo "analyse.sh: no digests in ${digests}; run find-usage.ts first" >&2; exit 1; }

# The skill as the analyst sees it: every Markdown file, and the names of the scripts.
skill_md="${digests}/skill.md"
{
  echo "# The skill $(basename "${skill_dir}")"
  while IFS= read -r file; do
    printf '\n## File %s\n\n' "${file#"${skill_dir}"/}"
    cat "${file}"
  done < <(find "${skill_dir}" -name '*.md' -not -path '*/templates/*' | sort)
  printf '\n## Scripts\n\n'
  find "${skill_dir}" -path '*/scripts/*' -type f -printf '%P\n' | sort | sed 's/^/- /'
} >"${skill_md}"

# A run without tools, skills, extensions or context files: the analyst only reads what it gets.
run_pi() {
  local system="$1" out="$2"
  shift 2
  (cd "$(mktemp -d)" && pi --print --no-session --no-tools --no-skills --no-extensions \
    --no-prompt-templates --no-context-files --model "${model}" --thinking "${thinking}" \
    --system-prompt "${system}" "$@") >"${out}"
}

# Group the digests so that each run stays well inside the model's context window.
parts=()
chunk=()
size=0
flush() {
  [[ ${#chunk[@]} -gt 0 ]] || return 0
  local n=$((${#parts[@]} + 1))
  local out="${digests}/report-part-${n}.md"
  echo "analyse.sh: part ${n}: ${#chunk[@]} sessions with ${model} (${thinking})" >&2
  local args=()
  for file in "${chunk[@]}"; do args+=("@${file}"); done
  run_pi "${assets}/analyst.md" "${out}" "@${skill_md}" "${args[@]}" \
    "Analyse how the skill above was used in these ${#chunk[@]} sessions. Follow your instructions exactly."
  parts+=("${out}")
  chunk=()
  size=0
}
for file in "${files[@]}"; do
  bytes=$(wc -c <"${file}")
  if [[ $((size + bytes)) -gt ${chunk_chars} ]]; then flush; fi
  chunk+=("${file}")
  size=$((size + bytes))
done
flush

report="${digests}/report.md"
if [[ ${#parts[@]} -eq 1 ]]; then
  cp "${parts[0]}" "${report}"
else
  echo "analyse.sh: merging ${#parts[@]} parts" >&2
  args=()
  for part in "${parts[@]}"; do args+=("@${part}"); done
  run_pi "${assets}/merge.md" "${report}" "@${skill_md}" "${args[@]}" \
    "Merge these ${#parts[@]} partial reports into one report. Follow your instructions exactly."
fi
echo "${report}"
