---
name: repo-scaffold
description: Scaffold a new git repository with a devenv dev environment, git hooks, linters, tests, security scans, an optional Nix flake, and GitHub CI/CD with release-please; also check and fix the GitHub settings (branch ruleset, merges, security) of existing repositories. Run only on request via /repo-scaffold or /repo-settings.
disable-model-invocation: true
metadata:
  version: "1.1.0"
---

# repo-scaffold

Start it with `/repo-scaffold <name> <work|private> <public|private> [language] [description]` (a
prompt template in `prompts/` of this skill) or with `/skill:repo-scaffold ...`. It is not offered to
the model on its own.

To check or fix the GitHub settings of existing repositories, start it with
`/repo-settings <owner/repo>... | --all <owner>` and follow only `guides/09-settings.md`.

This file is an index. Follow the guides in order and read each guide fully before acting. Read a
reference only when a guide points to it. Do not improvise steps that a script does.

`<skill>` below means the directory of this file (with pi-skills, a directory in the Nix store). Run
scripts by their full path, `<skill>/scripts/<script>`, from any directory; they find their templates
themselves. `<repo>` means the new repository, `~/<location>/<name>`.

## Input

The user's request follows this file. Expected (ask for what is missing, in one question):

| Parameter | Values | Default |
|---|---|---|
| name | lowercase letters, digits, `-`; starts with a letter or digit (a letter for python) | required |
| location | `work` (`~/work/<name>`) or `private` (`~/private/<name>`) | required |
| visibility | `public` or `private` | required |
| language | `typescript`, `python`, `none` | `none` |
| description | one sentence, without `"` or `\` | required |
| github | create and push the GitHub repo: `yes`/`no` | `yes` |
| owner | GitHub user or org | the active `gh` account |
| flake | add a Nix flake (checks, formatter): `yes`/`no` | `yes` |
| release | release-please releases: `yes`/`no` | `yes` |
| license | `MIT`, `Apache-2.0`, `none` | `MIT` if public, else `none` |

All values, validation and their effects: `references/parameters.md`.

## Steps

| # | Guide | Does | Script |
|---|---|---|---|
| 1 | `guides/01-parameters.md` | Collect and confirm the parameters | — |
| 2 | `guides/02-plan.md` | Show the plan (dry run) and get a yes | `<skill>/scripts/scaffold.sh --dry-run ...` |
| 3 | `guides/03-scaffold.md` | Create the directory, files and git repo | `<skill>/scripts/scaffold.sh ...` |
| 4 | `guides/04-toolchain.md` | Install the language toolchain and lock it | `<skill>/scripts/toolchain.sh <repo>` |
| 5 | `guides/05-verify.md` | Run every check like CI does | `<skill>/scripts/verify.sh <repo>` |
| 6 | `guides/06-first-commit.md` | Make the first commits | `<skill>/scripts/first-commits.sh <repo>` |
| 7 | `guides/07-github.md` | Create, configure and push the GitHub repo | `<skill>/scripts/github.sh <repo> --yes` |
| 8 | `guides/08-handover.md` | Report to the user | — |
| 9 | `guides/09-settings.md` | Only for `/repo-settings`: check, then fix on approval | `<skill>/scripts/github-settings.ts` |

Steps 1 and 2 need the user; ask everything there, at once. Steps 3 to 6 run without questions.
Step 7 asks one confirmation (only if `github=yes`). Stop at the first failing step, fix the cause,
and run that step again. Never skip a step silently.

## References

| File | Read when |
|---|---|
| `references/parameters.md` | Step 1, or when a parameter is unclear |
| `references/layout.md` | You need to know what a file in the new repo is for |
| `references/devenv.md` | Changing `devenv.nix`, scripts or git hooks |
| `references/hooks.md` | Hooks do not run, or run twice; the owner's global hooks |
| `references/languages.md` | Language specifics, or adding a language to this skill |
| `references/ci-cd.md` | Workflows, release-please, the `latest` branch, Dependabot |
| `references/github-settings.md` | The GitHub settings: merges, Actions, security, the `main` ruleset |
| `references/security.md` | Secret scanning, dependency audit, Actions hardening |
| `references/conventions.md` | Commit messages, branches, PRs, who merges and releases |
| `references/troubleshooting.md` | Something fails |

## Templates

`templates/` holds the files that `scaffold.sh` copies and fills in:

- `scaffold.sh` fills in `@NAME@`, `@MODULE@`, `@DESCRIPTION@`, `@OWNER@`, `@YEAR@`, `@LICENSE@`,
  `@LANGUAGE@`, `@RELEASE_TYPE@` and `@ECOSYSTEM@`;
- `pin-actions.sh` fills in `@PIN:<owner>/<repo>@`;
- `toolchain.sh` fills in `@BIOME_SCHEMA@`.

Change templates there, not in the generated repos.

## Rules

- The user decides about merging and releasing. Never merge a PR, and never merge the release-please
  PR.
- Ask before anything that is visible to others: creating the GitHub repo, pushing, changing
  visibility or settings.
- Never use the admin bypass of the `main` ruleset; it is for the owner only.
- Do not commit secrets. Do not weaken a check to make it pass; fix the cause.
- Agent files (`AGENTS.md`, `CLAUDE.md`, `.claude/`, `.cursor/`, `.pi/`, ...) stay out of git, and the
  scaffold never creates them; see `references/conventions.md`.
