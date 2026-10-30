# Python: Python 3 with uv (dependencies in uv.lock, virtualenv in .devenv/state/venv), Ruff and
# Pyright from nixpkgs, pytest.
{
  pkgs,
  config,
  repoHookScript,
  ...
}:
let
  python = pkgs.python313;
  pyTools = [
    pkgs.uv
    python
    pkgs.git
    pkgs.coreutils
  ];
  # devenv keeps the virtualenv in .devenv/state/venv (UV_PROJECT_ENVIRONMENT in the shell).
  venv = ''
    export UV_PROJECT_ENVIRONMENT="$PWD/.devenv/state/venv"
    [ -x "$UV_PROJECT_ENVIRONMENT/bin/pytest" ] || uv sync --quiet
    export PATH="$UV_PROJECT_ENVIRONMENT/bin:$PATH"
  '';
in
{
  languages.python = {
    enable = true;
    package = python;
    uv = {
      enable = true;
      sync.enable = true;
    };
    venv.enable = true;
  };

  repo.tools = [
    pkgs.ruff
    pkgs.pyright
    pkgs.uv
  ];

  scripts = {
    lint-language.exec = ''
      set -euo pipefail
      ruff check .
      ruff format --check .
    '';
    typecheck.exec = "pyright";
    unit.exec = ''
      set -euo pipefail
      # With files: the tests of the staged modules (src/<pkg>/<module>.py -> tests/test_<module>.py).
      if [ "$#" -gt 0 ]; then
        tests=()
        for file in "$@"; do
          case "$file" in
            tests/test_*.py) tests+=("$file") ;;
            src/*.py) candidate="tests/test_$(basename "$file")"; [ -f "$candidate" ] && tests+=("$candidate") ;;
          esac
        done
        [ "''${#tests[@]}" -eq 0 ] && exit 0
        exec pytest -q --no-cov "''${tests[@]}"
      fi
      exec pytest -q --no-cov
    '';
    test-all.exec = "pytest -q";
    security-language.exec = "true";
  };

  git-hooks.hooks = {
    ruff.enable = true;
    ruff-format.enable = true;
    typecheck = {
      enable = true;
      name = "pyright";
      entry = "${repoHookScript "typecheck" (pyTools ++ [ pkgs.pyright ]) ''
        ${venv}
        exec pyright
      ''}";
      files = "\\.py$|^pyproject\\.toml$";
      pass_filenames = false;
    };
    tests-changed = {
      enable = true;
      name = "pytest: tests of the staged files";
      entry = "${repoHookScript "tests-changed" pyTools ''
        ${venv}
        exec ${config.scripts.unit.scriptPackage}/bin/unit "$@"
      ''}";
      files = "\\.py$";
      pass_filenames = true;
      require_serial = true;
    };
  };
}
