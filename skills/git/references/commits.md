# Commits

## Find the style

Follow the repository, not a habit:

| The repository has | Style |
|---|---|
| `convco`, `commitlint` or a `commit-msg` hook that checks the format, or `release-please` | [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): subject` |
| None of these | The style of `git log --oneline -30` on the default branch, for example `area: subject` |

With squash merges, the PR title becomes the commit on the default branch; it follows the same style.

## Write the message

- Subject: imperative, lower case after the prefix, no period, at most 72 characters. It says what
  changes for a user of the code, not which files changed.
- Body (when the subject is not enough): why the change is needed and what it means; wrap at 72.
  Leave out what the diff shows.
- Conventional Commits: `feat` (new behavior), `fix` (wrong behavior), `docs`, `refactor` (no
  behavior change), `perf`, `test`, `build` (build, dependencies, dev environment), `ci`, `chore`,
  `revert`. `!` after the type, or a `BREAKING CHANGE:` footer, for breaking changes. Releases
  are computed from these: a wrong type is a wrong version.
- Only lock files changed: the repository's style for that (for example `flake: lock <input>` or
  `build(deps): ...`).

## Stage on purpose

```sh
git status --short
git diff                  # what is not staged
git add <paths>           # or git add -A when every change belongs to this commit
git diff --cached --stat  # check before committing
```

- One logical change per commit. Unrelated changes go to another branch.
- Never stage build output, coverage, `result` links, editor files, secrets or agent files. If they
  show up in `git status`, the `.gitignore` misses them: say so instead of committing them.
- Generated files that are tracked (lock files, `flake.nix` written by a generator) are regenerated
  with their tool, never edited by hand.

## Commit

```sh
git commit -F - <<'EOF'
type(scope): subject

Why this is needed.
EOF
```

The hooks run on commit. When one fails: read its output, fix the cause, stage again, commit again.
The commit did not happen; there is nothing to amend.

## Change a commit

- Not pushed yet: `git commit --amend`, or `git reset --soft HEAD~1` and commit again.
- Already pushed: add a new commit. Rewrite pushed history only for a rebase (`rebasing.md`), with a
  lease.
