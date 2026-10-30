# shellcheck shell=bash disable=SC2034
# Shared helpers for the repo-scaffold scripts.

skill_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
templates="${skill_dir}/templates"

die() {
  echo "repo-scaffold: $*" >&2
  exit 1
}

info() {
  echo "repo-scaffold: $*"
}

require() {
  local tool
  for tool in "$@"; do
    command -v "${tool}" >/dev/null 2>&1 || die "'${tool}' is not on PATH"
  done
}

# The repository directory given as the first argument, which must hold a scaffolded repository.
repo_dir() {
  local dir="${1:-}"
  [[ -n ${dir} ]] || die "usage: $(basename "$0") <repository directory>"
  [[ -f "${dir}/devenv.nix" ]] || die "${dir} is not a scaffolded repository (no devenv.nix)"
  cd "${dir}" && pwd
}

# The scaffold settings that scaffold.sh writes to .git/repo-scaffold.env (not tracked).
load_settings() {
  local dir="$1"
  [[ -f "${dir}/.git/repo-scaffold.env" ]] || die "${dir}/.git/repo-scaffold.env is missing; run scaffold.sh first"
  # shellcheck disable=SC1091
  source "${dir}/.git/repo-scaffold.env"
}
