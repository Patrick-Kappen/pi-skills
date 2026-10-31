# pi-git

pi-git takes the mechanical git work off the main agent. Its tools run the hooks, the checks and a
cheap helper agent out of your sight; you get a short result, and only an error when something
needs you.

## Which tool

- **Start:** `git_start` with the repository, a topic and a type (and `base` for a stacked change).
  It fetches, starts from `origin/<base>` (or the local branch of another worktree for work not on
  GitHub yet), and returns the worktree path and what to know first; make the change there. For a
  worktree that exists, it says how far it is behind its base.
- **What is open:** `git_status`. Use it before asking the user what is in progress.
- **A PR made by hand, or by someone else, that should be followed:** `git_watch` with its number.

- **Checks during the work:** `git_check`. Green: "Checks passed" and what the helper fixed. Red: a
  summary of at most 15 lines. Never read hook or CI output yourself when this tool exists. It
  changes files but never stages or commits.
- **An intermediate commit:** `git_commit` with the intent. Stages everything, runs pre-commit,
  writes the message in the repository's style, commits. No push.
- **Only a push:** `git_push`. Runs the pre-push checks (the helper fixes failures, as a new commit
  when committing is allowed) and pushes; uncommitted changes stay. Use it when the PR comes later or
  someone else opens it.
- **The PR:** `git_pr` with the intent (what the change is for and why) and, for a stacked change,
  `base`. It refuses the main checkout and the default branch. A second call on the same branch
  updates the PR.
- **Something only the user can give:** `git_request`, then stop your turn.

Give a `title` and a good intent. The title is the commit subject and PR title in the repository's
style (`commits.md`, `git_start` shows recent subjects); the intent is the body: the goal and the
reason in a few sentences, not a list of files. With a title, pi-git commits and opens the PR
itself and no helper starts; without one, a helper writes them, which costs time and tokens.

## After `git_pr`

The watcher follows the PR every minute:

- red CI: the helper fixes it and pi-git pushes the fix;
- conflicts: it rebases and the helper resolves them;
- green: it reports once;
- merged: it removes the worktree and the branch, and reports;
- stuck: it reports that the PR needs the user, and notifies them.

The summaries reach you as a message. Act only when one asks for something; otherwise there is
nothing to do. Do not watch CI or poll the PR yourself.

## jj workspaces

git is the default backend. In a repository whose backend is jj (the user's choice: `/git backend
jj`, or the config), `git_start` makes a colocated jj workspace and its result says "History: jj".
It is a git worktree too, with the branch as a jj bookmark and a detached HEAD.

- **Edit files and do not commit.** No `jj commit`, `jj describe`, `jj squash`, `jj new` or `git
  commit`: at the end of every turn pi-git makes one `wip:` commit of what you changed.
- **`git_commit` and `git_pr`** gather the `wip:` commits, run the hooks, and let the helper split the
  work into logical commits. A `title` is used as is only for work of one turn; for work of several
  turns it is a hint, because it describes your last turn only.
- **Reading with jj is fine** (`jj log`, `jj diff`, `jj st`). `jj undo` or `jj restore` go back to an
  earlier turn when the user asks for it.
- The watcher rebases jj workspaces and resolves conflicts with the helper, as for git worktrees.

## The lock

Four steps, each locked or unlocked per repository: `worktree`, `commit`, `push`, `pr`. Reading is
always free. The system prompt lists the state before every prompt.

- A blocked command or a tool that stops at a locked step is expected. Do not try another command
  that does the same, a script, or another directory.
- Finish the part you may do, call `git_request` with the step and the reason, and stop.
- Only the user switches the lock (`/git unlock <step>`, or `/git <step>` once).

## When the tools are missing

Without pi-git, follow the workflow of `SKILL.md` and the other references by hand.
