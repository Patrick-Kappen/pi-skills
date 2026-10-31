#!/usr/bin/env bash
# Usage: time-tests.sh [--runner auto|pester|vitest|bun|pytest] [--cmd '<command; {} is the test file>']
#                      [--jobs <n>] [--timeout <seconds>] [--out <file.tsv>] [--no-devenv] <repo> [<path>...]
#
# Runs every test file on its own, --jobs at a time, and prints the files slowest first with the sum,
# the wall time, and the share of the three slowest files. This shows where a suite spends its time.
# With a devenv.nix (and not already in its shell) it first times `devenv shell -- true` and then runs
# inside one devenv shell. Logs per file go to ${XDG_CACHE_HOME:-~/.cache}/test-speed/.
#
#   --runner   the test runner; auto picks it from the test files and package.json
#   --cmd      a custom command per file instead of the runner's
#   --jobs     files at the same time (default: half the processors; 1 gives clean per-file times)
#   --timeout  seconds per file before it is stopped (default: 900)
#   --out      also write "<seconds>\t<ok|FAIL|TIMEOUT>\t<file>" lines and a "# wall" line, for compare-timings.sh
#   --no-devenv  do not enter devenv
set -euo pipefail

here="$(dirname "$(realpath "${BASH_SOURCE[0]}")")"
self="$(realpath "${BASH_SOURCE[0]}")"
args=("$@")

die() {
  echo "time-tests: $*" >&2
  exit 2
}

runner="auto"
cmd=""
jobs=$(($(nproc) / 2))
[[ ${jobs} -lt 1 ]] && jobs=1
timeout_s=900
out=""
devenv=1
repo=""
paths=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --runner) runner="${2:?--runner needs a value}"; shift 2 ;;
    --cmd) cmd="${2:?--cmd needs a command}"; shift 2 ;;
    --jobs) jobs="${2:?--jobs needs a number}"; shift 2 ;;
    --timeout) timeout_s="${2:?--timeout needs seconds}"; shift 2 ;;
    --out) out="$(realpath -m "${2:?--out needs a file}")"; shift 2 ;;
    --no-devenv) devenv=0; shift ;;
    -*) die "unknown option: $1" ;;
    *) if [[ -z ${repo} ]]; then repo="$1"; else paths+=("$1"); fi; shift ;;
  esac
done
[[ -n ${repo} ]] || die "usage: time-tests.sh [options] <repo> [<path>...]"
[[ ${jobs} =~ ^[1-9][0-9]*$ ]] || die "--jobs must be a positive number"
root="$(git -C "${repo}" rev-parse --show-toplevel 2>/dev/null)" || die "${repo} is not in a git repository"
cd "${root}"

if [[ ${devenv} -eq 1 && -f devenv.nix && -z ${DEVENV_ROOT:-} ]]; then
  command -v devenv >/dev/null || die "devenv.nix found but no devenv; install it or pass --no-devenv"
  start=$(date +%s%N)
  devenv shell -- true >/dev/null 2>&1 || die "devenv shell -- true failed; run it to see why"
  end=$(date +%s%N)
  overhead="$(awk -v ns=$((end - start)) 'BEGIN { printf "%.1f", ns / 1e9 }')"
  echo "devenv shell -- true: ${overhead}s (the cost of entering devenv once)"
  exec devenv shell -- bash "${self}" "${args[@]}" --no-devenv
fi

mapfile -t all < <("${here}/changed-tests.sh" --root "${root}" --all)
files=()
for f in "${all[@]}"; do
  if [[ ${#paths[@]} -gt 0 ]]; then
    keep=0
    for p in "${paths[@]}"; do
      p="${p#./}"
      p="${p%/}"
      [[ ${f} == "${p}" || ${f} == "${p}"/* ]] && keep=1
    done
    [[ ${keep} -eq 1 ]] || continue
  fi
  files+=("${f}")
done

kind_of() {
  case "$1" in
    *.Tests.ps1) echo pester ;;
    *.py) echo pytest ;;
    *.go | *.rb) echo other ;;
    *) echo js ;;
  esac
}

if [[ -n ${cmd} && ${runner} == auto ]]; then
  runner=custom
fi
if [[ -z ${cmd} ]]; then
  if [[ ${runner} == auto ]]; then
    mapfile -t kinds < <(for f in "${files[@]}"; do kind_of "${f}"; done | sort -u)
    [[ ${#kinds[@]} -gt 0 ]] || die "no test files found"
    [[ ${#kinds[@]} -eq 1 ]] || die "test files of several runners (${kinds[*]}); pass --runner"
    runner="${kinds[0]}"
    if [[ ${runner} == js ]]; then
      if [[ -f package.json ]] && grep -q '"vitest"' package.json; then
        runner=vitest
      elif compgen -G 'bun.lock*' >/dev/null || [[ -f bunfig.toml ]]; then
        runner=bun
      else
        die "JavaScript tests, but neither vitest in package.json nor a bun.lock; pass --runner or --cmd"
      fi
    fi
    [[ ${runner} != other ]] || die "no built-in runner for these test files; pass --cmd"
  fi
  case "${runner}" in
    pester) cmd="pwsh -NoLogo -NoProfile -NonInteractive -Command \"\\\$c = New-PesterConfiguration; \\\$c.Run.Path = '{}'; \\\$c.Run.Exit = \\\$true; \\\$c.Output.Verbosity = 'None'; Invoke-Pester -Configuration \\\$c\"" ;;
    vitest) if [[ -x node_modules/.bin/vitest ]]; then cmd="node_modules/.bin/vitest run {}"; else cmd="npx vitest run {}"; fi ;;
    bun) cmd="bun test ./{}" ;;
    pytest) if [[ -f uv.lock ]]; then cmd="uv run pytest -q -p no:cacheprovider {}"; else cmd="python -m pytest -q -p no:cacheprovider {}"; fi ;;
    *) die "unknown runner: ${runner} (pester, vitest, bun, pytest)" ;;
  esac
fi

# Keep only the files of this runner, so a repository with several runners can be timed per runner.
case "${runner}" in
  pester) want=pester ;;
  vitest | bun) want=js ;;
  pytest) want=pytest ;;
  *) want="" ;;
esac
if [[ -n ${want} ]]; then
  kept=()
  for f in "${files[@]}"; do [[ $(kind_of "${f}") == "${want}" ]] && kept+=("${f}"); done
  files=("${kept[@]}")
fi
[[ ${#files[@]} -gt 0 ]] || die "no test files found${paths:+ under ${paths[*]}}"

logs="${XDG_CACHE_HOME:-${HOME}/.cache}/test-speed/$(basename "${root}")-$(date +%Y%m%d-%H%M%S)"
mkdir -p "${logs}"
results="${logs}/results.tsv"
: >"${results}"

run_one() {
  local file="$1" start end rc status log
  log="${TS_LOGS}/$(printf '%s' "${file}" | tr '/' '_').log"
  start=$(date +%s%N)
  rc=0
  timeout "${TS_TIMEOUT}" bash -c "${TS_CMD//\{\}/${file}}" >"${log}" 2>&1 || rc=$?
  end=$(date +%s%N)
  status=ok
  [[ ${rc} -ne 0 ]] && status=FAIL
  [[ ${rc} -eq 124 ]] && status=TIMEOUT
  awk -v ns=$((end - start)) -v s="${status}" -v f="${file}" 'BEGIN { printf "%.1f\t%s\t%s\n", ns / 1e9, s, f }' >>"${TS_RESULTS}"
}
export -f run_one
export TS_CMD="${cmd}" TS_LOGS="${logs}" TS_TIMEOUT="${timeout_s}" TS_RESULTS="${results}"

echo "runner: ${runner} · ${#files[@]} files · ${jobs} at a time · command: ${cmd}"
wall_start=$(date +%s%N)
# shellcheck disable=SC2016 # $1 belongs to the inner shell
printf '%s\0' "${files[@]}" | xargs -0 -P "${jobs}" -I{} bash -c 'run_one "$1"' _ {}
wall_end=$(date +%s%N)
wall="$(awk -v ns=$((wall_end - wall_start)) 'BEGIN { printf "%.1f", ns / 1e9 }')"

sort -t$'\t' -k1,1 -rn "${results}" -o "${results}"
awk -F'\t' '{ printf "%8.1fs  %-7s %s\n", $1, $2, $3 }' "${results}"
awk -F'\t' -v wall="${wall}" -v logs="${logs}" '
  { sum += $1; if (NR <= 3) top += $1; if ($2 != "ok") bad++ }
  END {
    share = sum > 0 ? 100 * top / sum : 0
    printf "sum %.1fs · wall %.1fs · 3 slowest files = %.0f%% of the sum · %d failed · logs: %s\n", sum, wall, share, bad, logs
  }' "${results}"

if [[ -n ${out} ]]; then
  mkdir -p "$(dirname "${out}")"
  { cat "${results}"; printf '# wall\t%s\n' "${wall}"; } >"${out}"
fi
