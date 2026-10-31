# The same change in several repositories

For example: one workflow fix in every repository of an owner, or a dependency bump across a set.

1. **Find the set.** Decide by evidence, not by name: the file that must change exists, or a
   setting is missing (`gh api`, `gh repo list <owner> --json ...`). List the repositories and,
   per repository, whether the change applies as it is.
2. **Compare first.** Read the file in each repository (`gh api repos/<o>/<r>/contents/<path>`). When
   they are identical, one edit fits all; when they differ, note each difference before editing.
3. **Plan once.** Show the user the set, the change and the exceptions; one yes covers the set.
4. **Per repository**, the normal workflow: a worktree from a fresh default branch, the change, the
   checks, a PR. Same branch name and commit message everywhere, so the PRs are easy to find
   (`gh search prs --owner <owner> head:<branch>`). Mention the related PRs in each body.
   With pi-git: `git_pr` per worktree; the watcher follows them all.
5. **One report:** a table with the repository, the PR link and its state. Report failures per
   repository; one failing repository does not stop the others.
6. **After the merges:** the watcher (or `cleanup.md`) removes the worktrees.

Secrets and variables that the change needs are set by the user, never through the agent: give one
command they run from the machine that holds the secret (`gh secret set NAME -R <o>/<r> < file`, in a
loop over the set).
