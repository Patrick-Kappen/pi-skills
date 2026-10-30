# Recovery

Nothing committed is lost for weeks: `git reflog` lists where every branch and HEAD pointed.

| Problem | Fix |
|---|---|
| Undo the last commit, keep the changes | `git reset --soft HEAD~1` |
| Committed on the wrong branch (not pushed) | `git branch <right branch>` at HEAD, then `git reset --hard HEAD~<n>` on the wrong one, only if it has no other work |
| Committed on the default branch (not pushed) | Move the commits to a new branch as above, so the default branch equals `origin` again |
| A rebase or reset went wrong | `git reflog`, find the sha from before, `git reset --hard <sha>` in that worktree |
| Detached HEAD with commits | `git switch -c <branch>` keeps them |
| Lost stash | `git fsck --unreachable \| grep commit`, then `git show <sha>` |
| A push was rejected (non-fast-forward) | Someone pushed: `git fetch`, rebase on `origin/<branch>`; never force without a lease |

## A secret was committed

1. Stop. Do not push; if it was pushed, do not try to hide it with a force-push.
2. Tell the user which secret and where. The secret must be rotated; removing it from history does
   not make it safe again.
3. Remove it from the commit when it is not pushed (`git reset --soft`, unstage, commit again), and
   make sure it is ignored from now on.

## Before any destructive command

`reset --hard`, `clean -fd`, `checkout -- <path>`, `branch -D`, `worktree remove --force` and
force-pushes destroy work. Run `git status` and `git stash list` first, and ask when the work is
not yours or not from this task.
