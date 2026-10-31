# Cleanup after a merge

When the PR is merged (`gh pr view <n> --json state,mergedAt` says `MERGED`):

```sh
cd <main checkout>
git worktree remove ~/.worktrees/<repo>/<topic>
git branch -D <type>/<topic>
git fetch origin --prune
```

- `git worktree remove` refuses when the worktree has changes: look at them first
  (`git -C <path> status`). They are either part of another change, or junk; never throw away work
  without asking.
- `git branch -d` refuses after a squash merge, because the branch commits are not on the default
  branch. Use `-D` only after checking that the PR is merged.
- The remote branch: most repositories delete it on merge (`deleteBranchOnMerge`). Otherwise
  `git push origin --delete <branch>` for your own branch.
- Update the main checkout only when the user wants it, and only when it is clean and on the default
  branch: `git -C <main checkout> pull --ff-only`.
- Closed without merging: ask before deleting the branch; the work may still be needed.
