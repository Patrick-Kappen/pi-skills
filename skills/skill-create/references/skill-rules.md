# Repository rules

The rules every skill in pi-skills follows. `scripts/check-skills.ts` in the repository checks the
ones marked **(checked)**; CI runs it.

## Location and files

- A skill is `skills/<name>/` with a `SKILL.md`. Nothing else in the repository belongs to it,
  except its tests in `test/skills/<name>/`.
- No agent files in a skill: `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.claude/`, `.cursor/`,
  `.pi/`, ... **(checked)**
- `templates/` holds files for other repositories, with placeholders; the linters and checks skip
  it.
- `prompts/` holds prompt templates; the repo-skills extension loads them with the skill. Each
  needs front matter with a `description` **(checked)**. Do not put other Markdown there.
- `assets/` holds files scripts or models use (prompts for helper models, JSON templates).
- Every skill is in the skill table of `README.md` **(checked)**.

## Front matter

- Only these fields: `name`, `description`, `license`, `compatibility`, `metadata`,
  `allowed-tools`, `disable-model-invocation` **(checked)**.
- `name` equals the directory name: lowercase letters, digits, single hyphens, at most 64
  characters **(checked)**.
- `description` is at most 1024 characters **(checked)**. A model-invoked skill says when to use it
  (`Use when …`/`Use for …`) **(checked)**; a skill with `disable-model-invocation: true` says how
  to start it (`Run only on request via /<name>`) **(checked)**. See `description.md`.
- `metadata.version` is a version like `"1.0.0"` **(checked)**, raised with every change: patch for
  fixes, minor for additions, major when the way to use it changes.

## Content

- English, plain and direct. Imperative instructions to the agent.
- `SKILL.md` stays under 300 lines **(checked)**; details go to `references/`.
- Files are referenced relative to `SKILL.md`, and every referenced file exists **(checked)**.
- No paths to `~/.pi/agent/skills`, home directories (`/home/<user>/`) or Nix store paths: skills
  run from the read-only Nix store for any user **(checked)**. Use `~` for the user's home.
- Every skill that changes code or repositories says that the work happens in a worktree with a
  PR, that the user merges, and which actions need confirmation.
- No secrets, tokens, customer names or personal data.

## Scripts

- In `scripts/`, executable, with a shebang **(checked)**. Libraries that are only sourced are named
  `lib*.sh`.
- They run from the read-only Nix store: never write into the skill directory.
- Bash passes shellcheck; TypeScript passes biome and tsc (CI runs both).
- Tests in `test/skills/<name>/`; see `scripts.md`.

## Changes

- These rules and `best-practices.md` grow from reviews: skill-review logs lessons in
  `learnings.md` and promotes a lesson when a second skill shows it. Do not add rules here without
  that evidence or the user's request.
- Every change is a branch and PR in the pi-skills repository, with Conventional Commits scoped to
  the skill (`feat(<name>): …`, `fix(<name>): …`).
- Never merge the PR or the release PR.
