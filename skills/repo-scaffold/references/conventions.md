# Conventions

## Commits

- Conventional Commits: `type(scope): subject`, imperative, lower case, no period, at most 72
  characters. Types: feat, fix, perf, refactor, docs, test, build, ci, chore, revert, `!` for
  breaking.
- The body says why, not what; wrap it at 72 columns.
- The first commits of a new repository are split by concern (see `guides/06-first-commit.md`).
- These commits go on `main` with `SKIP=no-commit-to-branch`, and only those. After them, every
  change goes on a branch with a PR.

## Branches and PRs

- Branch names: `<type>/<short-topic>`, for example `feat/login`.
- One concern per PR. The title is a Conventional Commit, because it becomes the squash commit.
- CI must pass. The owner reviews and merges; agents never merge.

## Releases

- Only through the release-please PR, merged by the owner, when the owner wants a release.
- Never edit `CHANGELOG.md`, the version, or `.release-please-manifest.json` by hand.

## Agent files

`AGENTS.md`, `.AGENTS.md`, `CLAUDE.md`, `CLAUDE.local.md`, `GEMINI.md`, `.claude/`, `.cursor/`,
`.cursorrules`, `.windsurfrules`, `.clinerules`, `.github/copilot-instructions.md` and `.pi/` are the
owner's local files:

- They are never tracked, never force-added, and never get a `.gitignore` exception.
- They are not mentioned in the README as files of the project.
- The scaffold creates none of them; the `.gitignore` ignores them all.

## Documentation

- README: what it is, why, how to install, how to develop, CI and releases.
- No personal repository names, paths or hosts in examples; use `my-org/project` and
  `~/src/project`.
