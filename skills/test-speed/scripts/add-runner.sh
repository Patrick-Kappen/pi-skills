#!/usr/bin/env bash
# Usage: add-runner.sh <repo> --runner pester|vitest|bun|pytest [--dir <dir>] [--base <ref>]
#                      [--dry-run] [--force]
#
# Adds the fast test setup to a repository: the recipes `test`, `test-changed` and `test-serial` in a
# justfile, and for pester and pytest the helper scripts (changed-tests.sh; for pester also
# Invoke-PesterParallel.ps1) in --dir. With a devenv.nix the recipes call devenv scripts
# (tests, tests-changed, tests-serial); the script prints that snippet for devenv.nix, which you add
# by hand. An existing justfile is not changed: the script prints the recipes to add.
# Existing files are kept unless --force.
#
#   --dir      directory for the helper scripts (default: scripts)
#   --base     branch that test-changed compares with (default: origin/HEAD, else origin/main)
#   --dry-run  print the plan and the generated files, change nothing
set -euo pipefail

here="$(dirname "$(realpath "${BASH_SOURCE[0]}")")"
templates="$(realpath "${here}/../templates")"

die() {
  echo "add-runner: $*" >&2
  exit 2
}

repo=""
runner=""
dir="scripts"
base=""
dry_run=0
force=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --runner) runner="${2:?--runner needs a value}"; shift 2 ;;
    --dir) dir="${2:?--dir needs a directory}"; shift 2 ;;
    --base) base="${2:?--base needs a ref}"; shift 2 ;;
    --dry-run) dry_run=1; shift ;;
    --force) force=1; shift ;;
    -*) die "unknown option: $1" ;;
    *) [[ -z ${repo} ]] || die "one repository only"; repo="$1"; shift ;;
  esac
done
[[ -n ${repo} ]] || die "usage: add-runner.sh <repo> --runner pester|vitest|bun|pytest [options]"
root="$(git -C "${repo}" rev-parse --show-toplevel 2>/dev/null)" || die "${repo} is not in a git repository"
dir="${dir%/}"

if [[ -z ${base} ]]; then
  base="$(git -C "${root}" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null || echo origin/main)"
fi
tests_dir="."
for candidate in Tests tests; do [[ -d "${root}/${candidate}" ]] && { tests_dir="${candidate}"; break; }; done

python_cmd="python -m pytest"
[[ -f "${root}/uv.lock" ]] && python_cmd="uv run pytest"
helpers=()
case "${runner}" in
  pester)
    run="pwsh -NoLogo -NoProfile -File ${dir}/Invoke-PesterParallel.ps1"
    test_cmd="${run} \"\$@\""
    changed_cmd="${dir}/changed-tests.sh --strict --base ${base} --run '${run}' \"\$@\""
    serial_cmd="${run} -Serial \"\$@\""
    helpers=("Invoke-PesterParallel.ps1" "changed-tests.sh")
    ;;
  vitest)
    test_cmd="npx vitest run \"\$@\""
    changed_cmd="if [ \$# -gt 0 ]; then npx vitest related --run --passWithNoTests \"\$@\"; else npx vitest run --changed ${base} --passWithNoTests; fi"
    serial_cmd="npx vitest run --no-file-parallelism \"\$@\""
    ;;
  bun)
    test_cmd="bun test --parallel \"\$@\""
    changed_cmd="if [ \$# -gt 0 ]; then bun test --changed; else bun test --changed=${base}; fi"
    serial_cmd="bun test \"\$@\""
    ;;
  pytest)
    if grep -qs 'pytest-xdist' "${root}/pyproject.toml" "${root}"/requirements*.txt; then
      test_cmd="${python_cmd} -q -n auto \"\$@\""
    else
      echo "add-runner: pytest-xdist is not a dependency; test runs serially until you add it (then use -n auto)" >&2
      test_cmd="${python_cmd} -q \"\$@\""
    fi
    changed_cmd="${dir}/changed-tests.sh --strict --base ${base} --run '${python_cmd} -q' \"\$@\""
    serial_cmd="${python_cmd} -q -p no:xdist \"\$@\""
    helpers=("changed-tests.sh")
    ;;
  "") die "--runner is required: pester, vitest, bun or pytest" ;;
  *) die "unknown runner: ${runner} (pester, vitest, bun, pytest)" ;;
esac
if [[ ${runner} == pester && ${tests_dir} == . ]]; then
  echo "add-runner: no Tests/ or tests/ directory; the runner searches the whole repository by default" >&2
fi

fill() {
  local text
  text="$(<"$1")"
  text="${text//@TEST@/$2}"
  text="${text//@TEST_CHANGED@/$3}"
  text="${text//@TEST_SERIAL@/$4}"
  printf '%s\n' "${text}"
}

devenv=0
[[ -f "${root}/devenv.nix" ]] && devenv=1
if [[ ${devenv} -eq 1 ]]; then
  # Nix '' strings: the commands must not contain ${ or ''.
  for c in "${test_cmd}" "${changed_cmd}" "${serial_cmd}"; do
    # shellcheck disable=SC2016 # a literal ${
    [[ ${c} != *'${'* && ${c} != *"''"* ]] || die "a command contains \${ or '' and cannot go into a nix string: ${c}"
  done
  justfile="$(fill "${templates}/justfile" 'devenv shell -- tests "$@"' 'devenv shell -- tests-changed "$@"' 'devenv shell -- tests-serial "$@"')"
  snippet="$(fill "${templates}/devenv-test.nix" "${test_cmd}" "${changed_cmd}" "${serial_cmd}")"
else
  justfile="$(fill "${templates}/justfile" "${test_cmd}" "${changed_cmd}" "${serial_cmd}")"
fi

act() { if [[ ${dry_run} -eq 1 ]]; then echo "would $*"; else echo "$*"; fi; }

place() { # <source> <target relative to root>
  local target="${root}/$2"
  if [[ -e ${target} && ${force} -eq 0 ]]; then
    echo "keep ${2} (exists; --force replaces it)"
    return
  fi
  act "write ${2}"
  [[ ${dry_run} -eq 1 ]] && return
  mkdir -p "$(dirname "${target}")"
  install -m "$([[ $2 == *.sh ]] && echo 755 || echo 644)" "$1" "${target}"
}

echo "runner ${runner} · base ${base} · ${dir}/ for helpers · devenv: $([[ ${devenv} -eq 1 ]] && echo yes || echo no)"
for helper in "${helpers[@]}"; do
  case "${helper}" in
    changed-tests.sh) place "${here}/changed-tests.sh" "${dir}/changed-tests.sh" ;;
    Invoke-PesterParallel.ps1) place "${templates}/pester/Invoke-PesterParallel.ps1" "${dir}/Invoke-PesterParallel.ps1" ;;
  esac
done

existing=""
for name in justfile Justfile .justfile; do [[ -f "${root}/${name}" ]] && existing="${name}"; done
if [[ -n ${existing} && ${force} -eq 0 ]]; then
  echo "keep ${existing} (exists); add these recipes to it, with 'set positional-arguments' at the top:"
  echo
  printf '%s\n' "${justfile}" | sed '1,2d'
  echo
elif [[ ${dry_run} -eq 1 ]]; then
  act "write justfile:"
  echo
  printf '%s\n' "${justfile}"
  echo
else
  act "write justfile"
  printf '%s\n' "${justfile}" >"${root}/justfile"
fi

if [[ ${devenv} -eq 1 ]]; then
  echo "Add to devenv.nix (merge into an existing scripts block):"
  echo
  printf '%s\n' "${snippet}"
fi
if [[ ${runner} == pester ]]; then
  echo
  echo "Git-ignore the timings file: .devenv/ (with devenv) or .cache/test-timings.json."
fi
