# Pull requests

## Open

```sh
git push -u origin HEAD
gh pr create --base <default or base branch> --head <branch> --title "<title>" --body-file <file>
```

- **Title:** the commit style of the repository (`commits.md`); with squash merges it becomes the
  commit on the default branch.
- **Body:** use `.github/pull_request_template.md` when there is one. Otherwise:

  ```markdown
  ## What
  The change, in a few lines or a short list.

  ## Why
  The problem or the goal.

  ## Testing
  What ran (checks, tests, a manual check) and the result.

  ## Notes
  Follow-ups, risks, what the reviewer should look at. Leave out when empty.
  ```

- Write for a reviewer who did not see the conversation. No secrets, no internal host names that
  should not be public, no agent chatter.
- `--draft` when the PR is not ready: it depends on something unmerged or unreleased, or CI cannot
  pass yet. Say in the body what it waits for.
- Link issues with `Closes #<n>` only when the PR really resolves them.
- Open the PR in the repository the branch belongs to. For someone else's repository, ask first.

## Update

- Push more commits to the branch; do not open a second PR for the same change.
- Change the title or body with `gh pr edit <n> --title ... --body-file ...` when the scope changed.
- After a review, add commits rather than rewriting history, unless a rebase is needed.

## Stacked PRs

A change that needs another unmerged branch:

1. Start the worktree from that branch, after a fetch: `git worktree add -b <type>/<topic> ~/.worktrees/<repo>/<topic> origin/<base branch>`,
   or from the local branch when the base is only in another worktree; push the base first then.
2. Open the PR with `--base <base branch>`, and say at the top of the body: "Stacked on #<n>;
   merge that first."
3. When the base PR is merged, GitHub retargets this PR to the default branch. With squash merges, the
   PR now also shows the old commits of the base: rebase it (`rebasing.md`, "After a squash merge").

## Merge

The owner merges. Do not merge, do not enable auto-merge, do not approve your own PR. When the PR is
ready, say so and stop. A release-please PR is also the owner's. pi-git's `/ship` (merge, release,
roll out) is the owner's command too.
