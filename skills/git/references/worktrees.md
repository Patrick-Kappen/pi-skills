# Worktrees

Every change happens in a linked worktree, never in the main checkout.

## Location and names

| What | Pattern | Example |
|---|---|---|
| Worktree | `~/.worktrees/<repo>/<topic>` | `~/.worktrees/project/login-timeout` |
| Branch | `<type>/<topic>` | `fix/login-timeout` |

- `<repo>` is the repository name without owner (the last part of the remote).
- `<topic>` is short, lower case, with `-`: what the change is about, not who made it.
- `<type>` follows the commit types: `feat`, `fix`, `docs`, `refactor`, `test`, `build`, `ci`,
  `chore`, `perf`. In a repository with its own style (`area/topic`), follow that.

## Start

```sh
cd <main checkout>
git fetch origin --prune
git worktree add -b <type>/<topic> ~/.worktrees/<repo>/<topic> origin/<default branch>
cd ~/.worktrees/<repo>/<topic>
```

- Always start from `origin/<default>` after a fetch, not from the local default branch: it may be
  behind or have local commits.
- To work on an existing remote branch: `git worktree add ~/.worktrees/<repo>/<topic> <branch>` (git
  sets up tracking when `origin/<branch>` exists). For a PR: `gh pr checkout <n>` inside a new
  worktree made with `--detach`, or add the worktree on `origin/<branch>` and `git switch -c`.
- A stacked change (needs an unmerged branch): start from that branch instead of the default, and
  open the PR against it (see `pull-requests.md`).

## Prepare

A new worktree has no dependencies and no dev shell yet:

- devenv repositories: run `devenv shell -- true` once; it builds the tools and the git hooks. Hooks
  that say "run 'devenv shell' once in this checkout" need exactly this.
- `node_modules`, `.venv` and other installed dependencies are per worktree; install them with the
  repository's command (`npm ci`, `uv sync`, ...).
- Untracked local files of the main checkout (`.env`, local config) are not there. Do not copy
  secrets; ask the user when the work needs them.

## Look around

```sh
git worktree list            # all worktrees with their branch
git -C <path> status -sb     # state of one worktree
```

A branch can be checked out in one worktree only. "already checked out" means another worktree has
it: work there, or pick another branch name.

## Remove

See `cleanup.md`. Never delete a worktree directory with `rm -rf`; use `git worktree remove`, then
`git worktree prune` for leftovers.
