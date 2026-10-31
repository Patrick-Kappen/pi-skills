---
name: git
description: How to work with git and GitHub - worktrees, branches, commits, pushes, pull requests, CI, conflicts, stacked PRs, rebasing after squash merges, and cleanup after a merge. Use for every git or GitHub task - starting a change, committing, pushing, opening or updating a PR, fixing CI or a conflict, and cleaning up.
metadata:
  version: "1.4.0"
---

# git

This file holds the rules and the workflow. Read a reference when a step points to it; paths are
relative to this file.

## Rules

These hold for every task, also when the user does not repeat them.

1. **Never work on the default branch.** Every change gets its own worktree at
   `~/.worktrees/<repo>/<topic>` on a branch `<type>/<topic>`. See `references/worktrees.md`.
2. **Leave the main checkout alone.** Do not switch its branch, stash, reset, or commit in it; the
   user may be working there. Read from it, work in a worktree.
3. **Never merge, never release.** Do not merge a PR (also not the release PR), do not push to the
   default branch, do not create tags or releases. The owner merges, by hand or with pi-git's
   `/ship`, which is the owner's command; never start it yourself.
4. **Never bypass a check.** No `--no-verify`, no `SKIP=...`, no `-c core.hooksPath=...`, no
   disabled tests or lowered thresholds, no edits to CI to make it pass. Fix the cause.
5. **Force-push only your own branch, only with a lease:**
   `git push --force-with-lease=<branch>:<expected sha> origin <branch>`. Never force-push a
   default branch or a branch someone else works on.
6. **Ask before anything visible to others that the user did not ask for:** creating a repository,
   opening a PR in someone else's repository, closing a PR, deleting a remote branch, changing
   repository settings. For the GitHub settings of the owner's repositories (rulesets, merges,
   security), use `/repo-settings` of the repo-scaffold skill: it checks first and asks.
7. **Never commit secrets or agent files.** `AGENTS.md`, `CLAUDE.md`, `.pi/`, `.claude/`, `.cursor/`
   and the like stay out of git: no `git add -f`, no `.gitignore` exceptions. A committed secret:
   stop, and tell the user (see `references/recovery.md`).
8. **One concern per branch and PR.** Unrelated fixes get their own worktree.
9. **Clean up after a merge:** remove the worktree, delete the local branch, prune. See
   `references/cleanup.md`.

## With the pi-git tools

When the pi-git tools are available, they do the mechanical git work out of your sight; you make the
change and get a short result back. Details: `references/pi-git.md`.

| Tool | Use it to | Instead of |
|---|---|---|
| `git_start` | Start a change: worktree, branch, setup, and the repository's facts | `git worktree add`, `devenv shell`, looking around |
| `git_status` | See all open work: watched PRs, what needs the user, worktrees | Listing worktrees and PRs by hand |
| `git_watch` | Hand a PR made without `git_pr` to the watcher | Watching its CI yourself |
| `git_check` | Run the repository's checks; a helper fixes failures | Running `check` and reading its output |
| `git_commit` | Commit without pushing (an intermediate step) | `git add`, `git commit` |
| `git_push` | Push the commits without a PR; checks run, a helper fixes failures | `git push` |
| `git_pr` | Commit, push, and open or update the PR | `git commit`, `git push`, `gh pr create` |
| `git_request` | Ask the user for a locked step or a decision, then stop | Working around a lock |

- **After `git_pr`, do not watch CI.** The watcher follows the PR, fixes red CI and conflicts, cleans
  up after the merge, and sends you a summary. No `gh pr checks --watch`, no polling; continue with
  other work, or end your turn.
- **A locked step is not an error to work around.** Finish what you may, then call `git_request`
  with what you need and why, and stop. The user unlocks with `/git unlock <step>`, or runs the step
  once with `/git <step>`.
- **A jj workspace** (`git_start` says "History: jj"): edit files, do not commit yourself; every turn
  becomes a `wip:` commit, and `git_commit` or `git_pr` turns them into logical commits. See
  `references/pi-git.md`.
- Without `git_start`, starting the worktree is still your job (`references/worktrees.md`).

## Workflow

| Step | Do | Reference |
|---|---|---|
| Start | Fetch, then add a worktree from the fresh default branch | `references/worktrees.md` |
| Prepare | Run `devenv shell` (or the repository's setup) once in the new worktree | `references/worktrees.md` |
| Change | Edit, run the checks (`check`, or what CONTRIBUTING says) | `references/ci.md` |
| Commit | Stage on purpose, in the repository's commit style | `references/commits.md` |
| Push | `git push -u origin HEAD`; the pre-push hook runs the checks | `references/ci.md` |
| PR | Title in the commit style, body with what, why and how it was tested | `references/pull-requests.md` |
| CI | Watch it; fix failures on the branch | `references/ci.md` |
| Base moved, conflict, stacked PR merged | Rebase on the new base, force-push with a lease | `references/rebasing.md` |
| Merged | Remove the worktree and the branch | `references/cleanup.md` |
| Something went wrong | Undo without losing work | `references/recovery.md` |
| Same change in several repositories | One plan, then a worktree and PR per repository | `references/multi-repo.md` |

## Find out first

Before the first change in a repository, look at:

- `git remote -v`, `gh repo view --json defaultBranchRef,squashMergeAllowed,mergeCommitAllowed,deleteBranchOnMerge`;
- `git log --oneline -20` on the default branch, for the commit style;
- `CONTRIBUTING.md`, `.github/pull_request_template.md`, the hooks (`.githooks/`, `.pre-commit-config.yaml`,
  `git config core.hooksPath`), and `git worktree list` for work in progress.
