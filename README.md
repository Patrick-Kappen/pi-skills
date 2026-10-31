# pi-skills

pi agent skills in a Nix flake, loaded per repository by the repo-skills extension.

pi loads every skill in `~/.pi/agent/skills` in every repository. This flake keeps the skills out of
that directory. The [`repo-skills`](extensions/repo-skills/README.md) extension loads a skill only
in the repositories you list. It works like `repo-mcp` in
[pi-mcp-servers](https://github.com/Patrick-Kappen/pi-mcp-servers).

| Skill | What it does |
|---|---|
| [`repo-scaffold`](skills/repo-scaffold/SKILL.md) | Scaffolds a new repository: devenv, hooks, checks, flake, GitHub CI/CD and releases. Also checks and fixes the GitHub settings of existing repositories: the `main` ruleset, merges, Actions and security. Prompts: `/repo-scaffold`, `/repo-settings`. |
| [`git`](skills/git/SKILL.md) | How to work with git and GitHub: worktrees in `~/.worktrees/<repo>/<topic>`, commits, PRs, CI, conflicts, stacked PRs, the same change in several repositories, cleanup, and the pi-git tools. Used by the agent, and by the helper of [pi-git](https://github.com/Patrick-Kappen/pi-git). |
| [`skill-create`](skills/skill-create/SKILL.md) | Creates a new skill (or imports one) in this repository: intake, design, a scaffold script, the repository rules and best practices, checks, and a PR. Prompt: `/skill-create`. |
| [`skill-review`](skills/skill-review/SKILL.md) | Improves a skill from evidence: finds the sessions that used it, lets a cheap model (`gpt-6-luna`) analyse them, and turns the report into approved changes and a PR. Lessons that hold beyond the skill go into a learnings log, then into the skill rules of `skill-create` (from a second skill on), or into [pi-rules](https://github.com/Patrick-Kappen/pi-rules). Prompt: `/skill-review`. |

## Use with Home Manager

```nix
{
  inputs.pi-skills = {
    url = "github:Patrick-Kappen/pi-skills/v1.0.0"; # a release tag, or the `latest` branch
    inputs.nixpkgs.follows = "nixpkgs";
    inputs.home-manager.follows = "home-manager";
  };
}
```

```nix
{ inputs, ... }:
{
  imports = [ inputs.pi-skills.homeModules.default ];

  programs.pi-skills = {
    enable = true;
    skills = {
      repo-scaffold.repos = [ "*" ];                        # everywhere
      git.repos = [ "*" ];
      # terraform.repos = [ "my-org/infra" "my-org/*" ];   # in these repositories
      # notes.repos = [ "~/private/notes" ];               # in this directory
      # my-own = { path = ./skills/my-own; repos = [ "*" ]; };   # a skill from elsewhere
    };
  };
}
```

The module installs the extension in `~/.pi/agent/extensions/repo-skills` and writes
`~/.pi/agent/repo-skills.json`. A skill that is not listed loads nowhere.

| Option | Default | Meaning |
|---|---|---|
| `skills.<name>.repos` | (required) | Where the skill loads: `*`, `owner/repo`, `host/owner/repo`, `owner/*`, or a path such as `~/src/project`. See the [extension README](extensions/repo-skills/README.md#repos-entries). |
| `skills.<name>.path` | the skill `<name>` of this flake | Directory with the skill's `SKILL.md`, for a skill from elsewhere. |
| `package` | `packages.<system>.repo-skills` | The extension. |
| `skillsPackage` | `packages.<system>.skills` | The skills of this flake. |
| `agentDir` | `.pi/agent` | pi's agent directory relative to home. |

In pi, `/repo-skills` shows which skills match the current repository. After changing the
configuration, run `/reload` in pi.

When you move a skill here, remove the copy from `~/.pi/agent/skills` (and its prompt from
`~/.pi/agent/prompts`). Otherwise pi loads both.

## Adding or changing a skill

Use the skills for it: `/skill-create` for a new skill (or to import one from elsewhere), and
`/skill-review <skill>` to improve one from how it was used in past sessions. Both work in a
worktree of this repository and end with a PR.

The rules are in [`skills/skill-create/references/skill-rules.md`](skills/skill-create/references/skill-rules.md).
`node scripts/check-skills.ts .` checks most of them; `lint`, the pre-commit hook and CI run it. In
short:

1. `skills/<name>/SKILL.md` with `name`, a `description` that says when to use the skill, and
   `metadata.version`; a row in the skill table above.
2. Prompt templates that belong to the skill go into `skills/<name>/prompts/`. They load together
   with the skill.
3. Refer to the skill's own files by paths relative to its `SKILL.md`. The skill runs from the
   read-only Nix store, not from `~/.pi/agent/skills`.
4. Scripts in `skills/<name>/scripts/`, executable; their tests in `test/skills/<name>/`.
5. Files in `skills/*/templates/` are templates for other repositories. The linters of this
   repository skip them.

## Layout

| Path | Contains |
|---|---|
| `skills/<name>/` | The skills |
| `scripts/check-skills.ts` | Checks every skill against the repository rules |
| `test/skills/<name>/` | Tests of the scripts of a skill |
| `extensions/repo-skills/` | The extension, with unit tests |
| `test/integration/` | Loads the extension and a skill with pi's own loader, in a repository and a worktree |
| `nix/package.nix`, `nix/skills.nix` | The packages `repo-skills` and `skills` |
| `nix/home-manager.nix` | The Home Manager module |
| `nix/checks.nix`, `test/nix/` | Flake checks: packages, module, and the generated files with node |

## Development

The dev environment uses [devenv](https://devenv.sh):

```sh
devenv shell   # tools, dependencies and git hooks
check          # everything CI runs
```

| Command | What it runs |
|---|---|
| `lint` | Linters and formatters (check only) |
| `typecheck` | The type checker |
| `unit [files]` | Unit tests; with files, only the tests related to them |
| `security` | gitleaks over the history, and known vulnerabilities in the lock files |
| `check` | All of the above with coverage, plus `nix flake check` if there is a `flake.nix` |

### Git hooks

| Hook | Checks |
|---|---|
| `pre-commit` | The staged files: linters, types, and the unit tests related to them; secrets; no commits on `main` |
| `commit-msg` | [Conventional Commits](https://www.conventionalcommits.org/) |
| `pre-push` | `check` |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## CI and releases

- `ci.yml` runs `devenv test` on every PR and on `main`, and checks the PR title and commit messages.
- `release.yml` runs [release-please](https://github.com/googleapis/release-please) on `main`:
  1. It keeps one release PR that collects the merged PRs, with the version bump and the notes in
     [`CHANGELOG.md`](CHANGELOG.md).
  2. Merging that PR tags `vX.Y.Z`, publishes the release, and moves the `latest` branch to it.
- Squash-merge PRs: the PR title becomes the commit on `main`.
