# Checks and CI

## Before pushing

- Run the repository's checks yourself: `check` in devenv repositories, otherwise what
  `CONTRIBUTING.md` or the README says (`npm test`, `nix flake check`, ...).
- The hooks are part of the checks: pre-commit on the staged files, pre-push the full set. When the
  pre-push hook fails, nothing was pushed; fix, commit, push again.

## Watch

With pi-git, do not: the watcher follows the PR after `git_pr` (`pi-git.md`). By hand:

```sh
gh pr checks <n> --watch            # until all checks are done
gh pr checks <n>                    # the current state
gh pr view <n> --json mergeable,mergeStateStatus
```

`gh pr checks` shows checks that are not GitHub Actions too (for example a Nix build bot); for
those, only the state and a link are available.

## A check fails

1. Read the failure: `gh run view <run id> --log-failed` for GitHub Actions; the link of the check
   otherwise.
2. Reproduce it locally in the worktree when possible (same command as CI; `devenv test` runs what
   CI runs in devenv repositories).
3. Fix the cause on the branch, commit (`commits.md`), push. Never change CI, hooks, linters or
   thresholds to make it pass, unless that is the task.
4. A failure unrelated to the change (network, runner, an outage): `gh run rerun <run id> --failed`
   once. When it fails again, report it instead of retrying.
5. "Approval required" or "action required" on a bot PR is for the owner; do not work around it.

## Merge state

| `mergeable` / `mergeStateStatus` | Meaning | Do |
|---|---|---|
| `CONFLICTING` / `DIRTY` | Conflicts with the base | Rebase (`rebasing.md`) |
| `MERGEABLE` / `BEHIND` | The base moved; required to be up to date | Rebase, or leave it to the owner |
| `MERGEABLE` / `BLOCKED` | Waiting for checks or a review | Wait; fix failing checks |
| `MERGEABLE` / `CLEAN` | Ready | Report it; the owner merges |
| `UNKNOWN` | GitHub is still computing | Ask again a little later |
