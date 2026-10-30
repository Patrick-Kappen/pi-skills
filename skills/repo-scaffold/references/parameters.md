# Parameters

`scripts/scaffold.sh` takes them as flags. Each flag below matches a parameter in `SKILL.md`.

| Flag | Values | Default | Effect |
|---|---|---|---|
| `--name` | `^[a-z0-9][a-z0-9-]{0,62}$`; for python `^[a-z]...` | required | Directory name, GitHub repo name, package name |
| `--location` | `work`, `private` | required | Parent directory: `~/work` or `~/private` |
| `--visibility` | `public`, `private` | required | GitHub visibility; also the license default |
| `--language` | `typescript`, `python`, `none` | `none` | Toolchain, linters, tests, release type (see `languages.md`) |
| `--description` | one line, without `"` and `\` | required | README, GitHub description, package metadata |
| `--owner` | GitHub user or org | `gh api user --jq .login` | GitHub owner; also in `LICENSE` and URLs |
| `--flake` | `yes`, `no` | `yes` | `flake.nix` with formatter and checks; needed by the owner's global pre-commit hook (treefmt) |
| `--release` | `yes`, `no` | `yes` | release-please config, `release.yml`, `CHANGELOG.md` |
| `--license` | `MIT`, `Apache-2.0`, `none` | `MIT` if public, else `none` | `LICENSE` file and package metadata |
| `--dry-run` | flag | off | Print the plan, write nothing |
| `--force` | flag | off | Allow an existing, empty target directory |
| `REPO_SCAFFOLD_ROOT` | environment variable | `$HOME` | Replaces `~`, to test the skill in a temp directory |

## Validation

The script refuses to run, with a clear message, when:

- the target directory exists and is not empty;
- the name is invalid;
- a required parameter is missing;
- `devenv`, `git` or `nix` is missing;
- `gh` is not logged in. It is needed even with `github=no`, to pin the actions.

Picking the GitHub account (for example a separate work account) is up to the agent, in step 1. The
script uses `--owner` or the active `gh` account.

## Deriving

| Value | From |
|---|---|
| Directory | `~/<location>/<name>` |
| Release type | `node` (typescript), `python` (python), `simple` (none); `simple` keeps the version in `version.txt` |
| Package name | `<name>`; for python the module is `<name>` with `-` → `_` |
| Year | the current year, in `LICENSE` |
