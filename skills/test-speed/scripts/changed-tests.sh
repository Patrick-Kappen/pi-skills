#!/usr/bin/env bash
# Usage: changed-tests.sh [--root <dir>] [--base <ref>] [--strict] [--all] [--pattern <regex>]
#                         [--run <command>] [<file>...]
#
# Prints the test files (relative to the repository root, one per line) that cover the given files.
# Without files: everything that changed against --base (committed on the branch), plus staged,
# unstaged and untracked files. Deleted files count too.
#
# A test file covers a changed file when it is the changed file, has the same name stem
# (naming.ts -> naming.test.ts, Foo.psm1 -> Foo.Tests.ps1, x.py -> test_x.py), mentions the changed
# file's name, or lies in a test tree directory that mirrors the changed file's directory or one of
# its parents (Modules/X/a.ps1 -> Tests/Modules/X/*, Tests/Modules/*). A change to a dependency, tool or test configuration
# (package.json, lock files, devenv.nix, conftest.py, ...) selects every test file. Documentation,
# images and LICENSE select nothing.
#
#   --root     repository (default: the current directory)
#   --base     branch to compare with (default: origin/HEAD, else origin/main, main, master)
#   --strict   exit 3 when a changed code file has no test (the contract of run_tests' recipe)
#   --all      print every test file
#   --pattern  extended regex for test file paths (default: see TEST_PATTERN)
#   --run      run <command> with the test files appended (nothing runs when there are none)
#
# This file is copied into repositories by the test-speed skill; it needs only bash and git.
set -euo pipefail

TEST_PATTERN='(^|/)([^/]+\.Tests\.ps1|[^/]+\.(test|spec)\.[cm]?[jt]sx?|test_[^/]+\.py|[^/]+_test\.(py|go)|[^/]+_spec\.rb)$'
# Changes that can affect every test.
ALL_PATTERN='(^|/)(package\.json|package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|bunfig\.toml|tsconfig[^/]*\.json|(vitest|jest|vite)\.config\.[^/]+|pyproject\.toml|uv\.lock|poetry\.lock|requirements[^/]*\.txt|setup\.cfg|pytest\.ini|tox\.ini|conftest\.py|devenv\.(nix|lock|yaml)|flake\.(nix|lock)|PesterConfiguration[^/]*\.psd1|justfile|Makefile)$'
# Changes that need no test.
SKIP_PATTERN='(\.(md|markdown|txt|rst|png|jpe?g|gif|svg|webp|ico|pdf)$|(^|/)(LICENSE[^/]*|\.gitignore|\.gitattributes|CODEOWNERS|\.editorconfig)$)'

die() {
  echo "changed-tests: $*" >&2
  exit 2
}

# Keep output stable across host locales, with paths ordered case-insensitively.
sort_unique() {
  LC_ALL=C sort -f | LC_ALL=C uniq
}

root="."
base=""
strict=0
all=0
run=""
files=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --root) root="${2:?--root needs a directory}"; shift 2 ;;
    --base) base="${2:?--base needs a ref}"; shift 2 ;;
    --strict) strict=1; shift ;;
    --all) all=1; shift ;;
    --pattern) TEST_PATTERN="${2:?--pattern needs a regex}"; shift 2 ;;
    --run) run="${2:?--run needs a command}"; shift 2 ;;
    --) shift; files+=("$@"); break ;;
    -*) die "unknown option: $1" ;;
    *) files+=("$1"); shift ;;
  esac
done

root="$(git -C "${root}" rev-parse --show-toplevel 2>/dev/null)" || die "${root} is not in a git repository"

mapfile -t tests < <(git -C "${root}" ls-files --cached --others --exclude-standard |
  grep -E "${TEST_PATTERN}" | while IFS= read -r t; do [[ -f "${root}/${t}" ]] && printf '%s\n' "${t}"; done | sort_unique)

default_base() {
  local ref
  ref="$(git -C "${root}" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null || true)"
  for candidate in ${ref} origin/main main master; do
    if git -C "${root}" rev-parse --verify --quiet "${candidate}^{commit}" >/dev/null; then
      printf '%s\n' "${candidate}"
      return
    fi
  done
}

changed_files() {
  local against="$1"
  {
    if [[ -n ${against} ]]; then
      git -C "${root}" diff --name-only "${against}...HEAD"
    fi
    git -C "${root}" diff --name-only HEAD 2>/dev/null || git -C "${root}" diff --name-only --cached
    git -C "${root}" ls-files --others --exclude-standard
  } | sed '/^$/d' | sort_unique
}

# The test files that cover one changed file, one per line.
covering() {
  local file="$1" name stem dir t tname tstem tdir
  name="${file##*/}"
  stem="${name%%.*}"
  dir="$(dirname "${file}")"
  for t in "${tests[@]}"; do
    if [[ ${t} == "${file}" ]]; then
      printf '%s\n' "${t}"
      continue
    fi
    tname="${t##*/}"
    tstem="${tname%%.*}"
    if [[ -n ${stem} && (${tstem} == "${stem}" || ${tstem} == "test_${stem}" || ${tstem} == "${stem}_test") ]]; then
      printf '%s\n' "${t}"
      continue
    fi
    tdir="$(dirname "${t}")"
    local d="${dir}"
    while [[ ${d} != "." && ${d} != "/" ]]; do
      # A mirror in a test tree (Tests/Modules/X for Modules/X); tests next to the code match by name.
      if [[ ${tdir} == */"${d}" ]]; then
        printf '%s\n' "${t}"
        continue 2
      fi
      d="$(dirname "${d}")"
    done
  done
  # Test files that mention the changed file by name.
  if [[ ${#tests[@]} -gt 0 ]]; then
    (cd "${root}" && grep -lF -- "${name}" "${tests[@]}" 2>/dev/null) || true
  fi
}

finish() {
  local -a selected=()
  mapfile -t selected < <(printf '%s\n' "$@" | sed '/^$/d' | sort_unique)
  if [[ -n ${run} ]]; then
    if [[ ${#selected[@]} -eq 0 ]]; then
      echo "changed-tests: no test files cover the changes" >&2
      exit 0
    fi
    cd "${root}"
    # shellcheck disable=SC2016 # $@ belongs to the inner shell
    exec bash -c "${run}"' "$@"' changed-tests "${selected[@]}"
  fi
  [[ ${#selected[@]} -gt 0 ]] && printf '%s\n' "${selected[@]}"
  return 0
}

if [[ ${all} -eq 1 ]]; then
  finish "${tests[@]}"
  exit 0
fi

if [[ ${#files[@]} -eq 0 ]]; then
  against="${base:-$(default_base)}"
  if [[ -n ${against} ]] && ! git -C "${root}" rev-parse --verify --quiet "${against}^{commit}" >/dev/null; then
    die "unknown base ${against}; fetch it or pass --base"
  fi
  mapfile -t files < <(changed_files "${against}")
fi

selected=()
uncovered=()
for file in "${files[@]}"; do
  file="${file#./}"
  [[ -z ${file} ]] && continue
  if [[ ${file} =~ ${ALL_PATTERN} ]]; then
    finish "${tests[@]}"
    exit 0
  fi
  [[ ${file} =~ ${SKIP_PATTERN} ]] && continue
  mapfile -t found < <(covering "${file}")
  if [[ ${#found[@]} -eq 0 ]]; then
    uncovered+=("${file}")
  else
    selected+=("${found[@]}")
  fi
done

if [[ ${strict} -eq 1 && ${#uncovered[@]} -gt 0 ]]; then
  printf 'changed-tests: no test covers %s\n' "${uncovered[@]}" >&2
  [[ ${#selected[@]} -gt 0 ]] && printf '%s\n' "${selected[@]}" | sort_unique
  exit 3
fi
if [[ ${#selected[@]} -eq 0 && -z ${run} ]]; then
  echo "changed-tests: no test files cover the changes" >&2
fi
finish "${selected[@]}"
