# repo-skills

A pi extension that loads skills only in the repositories you list. Nothing goes into the
repositories themselves, and the skills do not live in `~/.pi/agent/skills`, which pi would load
everywhere.

## How it works

1. pi emits `resources_discover` after the session starts, and again on `/reload`.
2. The extension reads `~/.pi/agent/repo-skills.json` and finds the git repository of the working
   directory by reading the `.git` entries. It does not run git.
3. It returns the directory of each skill whose `repos` list matches. pi loads those skills as it
   loads the skills in `~/.pi/agent/skills`. If a skill directory has a `prompts/` directory, pi also
   loads the prompt templates in it.
4. The other skills stay unknown to pi: they are not in the system prompt and have no `/skill:` command.

## Configuration

`~/.pi/agent/repo-skills.json` (Home Manager writes this file; see the [main README](../../README.md)):

```json
{
  "skills": {
    "repo-scaffold": { "path": "/nix/store/...-pi-skills-1.0.0/repo-scaffold", "repos": ["*"] },
    "terraform": { "path": "~/skills/terraform", "repos": ["my-org/infra", "my-org/*"] }
  }
}
```

`path` is the directory with the skill's `SKILL.md`: an absolute path or `~/...`.

### `repos` entries

| Entry | Matches |
|---|---|
| `*` | Everywhere, also outside git repositories. |
| `owner/repo` | Every repository with a remote that ends in `owner/repo`, so every clone and every worktree. Case-insensitive; SSH and HTTPS URLs are the same. |
| `github.com/owner/repo` | The same, limited to that host. |
| `owner/*`, `*/repo-*` | `*` matches within one path segment. |
| `/abs/path`, `~/path` | That directory and everything below it. A worktree elsewhere matches through the location of its main checkout. Also works outside git. |

A skill without `path` or `repos`, or without a `SKILL.md`, is reported as a warning when the
session starts. The other skills still load.

### Locations

| What | Default | Override |
|---|---|---|
| Config file | `~/.pi/agent/repo-skills.json` | `PI_REPO_SKILLS_CONFIG` |
| Agent directory | `~/.pi/agent` | `PI_CODING_AGENT_DIR` |

## Commands

`/repo-skills` shows the following:

- the config file
- the working directory
- the main checkout and worktree
- the normalized remotes
- for each skill, whether it matches and which entry matched

The skills are chosen when the session starts. After a change to the config, run `/reload`.

## Notes

- A skill with the same name in `~/.pi/agent/skills` or in a project also loads; pi reports the
  conflict. Remove the copy from `~/.pi/agent/skills` when you move a skill here.
- `repo-mcp` in [pi-mcp-servers](https://github.com/Patrick-Kappen/pi-mcp-servers) does the same
  for MCP servers. `match.ts` and `repo.ts` are the same in both.
