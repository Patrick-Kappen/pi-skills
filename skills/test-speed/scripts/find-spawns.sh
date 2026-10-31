#!/usr/bin/env bash
# Usage: find-spawns.sh <repo> [<path>...]
#
# Lists the places in test code that start a process or a heavy tool, counted per file and command,
# most first, with a hint per command. Each start costs a process (Bicep, PSRule, pwsh, node and az
# start .NET, Python or Node: about 0.3-1 s each); in a data-driven test (-ForEach, test.each,
# parametrize) it costs that once per case. These are the candidates to batch or to move to a
# one-time setup. Scans the test files, or the given files and directories.
set -euo pipefail

here="$(dirname "$(realpath "${BASH_SOURCE[0]}")")"

die() {
  echo "find-spawns: $*" >&2
  exit 2
}

[[ $# -ge 1 ]] || die "usage: find-spawns.sh <repo> [<path>...]"
root="$(git -C "$1" rev-parse --show-toplevel 2>/dev/null)" || die "$1 is not in a git repository"
shift
cd "${root}"

if [[ $# -gt 0 ]]; then
  mapfile -t files < <(git ls-files --cached --others --exclude-standard -- "$@" |
    grep -E '\.(ps1|psm1|ts|tsx|js|mjs|cjs|py|sh|bash)$' || true)
else
  mapfile -t files < <("${here}/changed-tests.sh" --root "${root}" --all)
fi
[[ ${#files[@]} -gt 0 ]] || die "no files to scan"

# label<TAB>extended regex. Order matters: the first match on a line counts (az bicep before az and bicep).
patterns=$'az bicep\t(^|[^[:alnum:]_-])az[[:space:]]+bicep[[:space:]]
bicep\t(^|[&[:space:]"\'(])bicep[[:space:]]+(build|build-params|lint|snapshot|format|decompile|generate-params)
Invoke-PSRule\t(Invoke-PSRule|Assert-PSRule)
az\t(^|[&[:space:]"\'(])az[[:space:]]+[a-z]
terraform/tofu\t(^|[&[:space:]"\'(])(terraform|tofu)[[:space:]]+(init|plan|validate|apply|test)
docker/podman\t(^|[&[:space:]"\'(])(docker|podman)[[:space:]]+(run|build|compose|exec)
pwsh\t(^|[&[:space:]"\'(])(pwsh|powershell)([[:space:]]|\.exe)
Start-Process\tStart-Process
node/npx/bun\t(^|[&[:space:]"\'(])(node|npx|bunx|bun)[[:space:]]+[^=]
python\t(^|[&[:space:]"\'(])python3?[[:space:]]+[^=]
git\t(^|[&[:space:]"\'(])git[[:space:]]+(init|clone|commit|worktree)
nix\t(^|[&[:space:]"\'(])nix[[:space:]]+(build|eval|run|flake)
child process (JS)\t((execFileSync|execSync|spawnSync|execFile|spawn|exec)\(|Bun\.spawn|\$`)
subprocess (Python)\t(subprocess\.(run|call|check_output|check_call|Popen)|os\.system\()'

hint() {
  case "$1" in
    "az bicep") echo "call bicep directly: az adds about 1 s per call" ;;
    bicep) echo "batch: build, build-params and lint take --pattern '<glob>' (one process for many files)" ;;
    Invoke-PSRule) echo "run PSRule once for all inputs before the tests, then let each test read its result" ;;
    az) echo "az starts Python (about 1 s); mock it, or call it once in BeforeAll" ;;
    terraform/tofu) echo "init once per directory and reuse .terraform; validate many in one job" ;;
    docker/podman) echo "start one container for the file (BeforeAll), not one per test" ;;
    pwsh | Start-Process) echo "a new PowerShell costs about 0.5-1 s; run in-process, or once per file" ;;
    node/npx/bun | python) echo "a new interpreter per call; call the code in-process, or once in a setup" ;;
    git) echo "make one fixture repository in a setup and copy it per test" ;;
    nix) echo "evaluate once and reuse the result; per-package checks let nix cache the rest" ;;
    *) echo "a process per call; move it to a setup or batch the calls" ;;
  esac
}

results="$(
  for f in "${files[@]}"; do
    [[ -f ${f} ]] || continue
    data=0
    grep -qE -- '-ForEach|-TestCases|\.each[[:space:](`]|parametrize|test\.concurrent\.each' "${f}" && data=1
    PATS="${patterns}" awk -F'\t' -v file="${f}" -v data="${data}" '
      BEGIN { n = split(ENVIRON["PATS"], lines, "\n"); for (i = 1; i <= n; i++) { split(lines[i], p, "\t"); label[i] = p[1]; re[i] = p[2] } }
      /^[[:space:]]*(#|\/\/)/ { next }
      { for (i = 1; i <= n; i++) if ($0 ~ re[i]) { count[label[i]]++; break } }
      END { for (l in count) printf "%d\t%s\t%s\t%s\n", count[l], l, file, data ? "data-driven" : "" }' "${f}"
  done | sort -t$'\t' -k1,1 -rn
)"

if [[ -z ${results} ]]; then
  echo "No process starts found in ${#files[@]} files."
  exit 0
fi

printf '%6s  %-20s %-12s %s\n' "starts" "command" "" "file"
while IFS=$'\t' read -r count label file data; do
  printf '%6s  %-20s %-12s %s\n' "${count}" "${label}" "${data}" "${file}"
done <<<"${results}"
echo
echo "Hints:"
cut -f2 <<<"${results}" | sort -u | while IFS= read -r label; do
  printf '  %-20s %s\n' "${label}" "$(hint "${label}")"
done
echo "A start in a data-driven file runs once per case; count the cases, not the lines."
