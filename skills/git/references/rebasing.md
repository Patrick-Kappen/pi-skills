# Rebasing and conflicts

## Update a branch on its base

```sh
git fetch origin --prune
git rebase origin/<base>
# resolve conflicts, then:
git push --force-with-lease=<branch>:<sha before the rebase> origin <branch>
```

Note the sha first (`git rev-parse HEAD`): the lease protects commits that someone else pushed in
the meantime. Prefer rebase over merging the base into the branch, unless the repository merges.

## Resolve a conflict

1. `git status` lists the files. Open each; understand both sides before choosing. Keep the intent
   of both changes, not just one side.
2. Generated files are not merged by hand: take one side, then regenerate.

   | File | Regenerate with |
   |---|---|
   | `package-lock.json` | `npm install` |
   | `flake.lock` | `nix flake lock` (only the inputs that changed: `nix flake update <input>`) |
   | `uv.lock`, `Cargo.lock`, `go.sum` | `uv lock`, `cargo update -w`, `go mod tidy` |
   | Files from a generator (`flake.nix` from `write-flake`, ...) | The generator |

3. `git add <file>`, then `git rebase --continue`. Run the checks before pushing.
4. Lost: `git rebase --abort` returns to the state before the rebase.

## After a squash merge (stacked PRs)

A squash merge creates a new commit on the base. A branch stacked on the merged branch still has the
old commits, so its PR shows them again. Move only the branch's own commits:

```sh
git fetch origin --prune
old=<last commit of the merged base branch, as the stacked branch has it>
git diff "$old" origin/<default>        # empty when the squash merge has the same content
git rebase --onto origin/<default> "$old" <branch>
git diff <sha before> <branch>          # empty: the content did not change, only the history
git push --force-with-lease=<branch>:<sha before> origin <branch>
```

Do this for each PR in the stack, from the bottom up. When the first diff is not empty, the base
changed during the merge: rebase normally and resolve.
