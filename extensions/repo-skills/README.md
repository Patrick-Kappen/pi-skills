# repo-skills

A pi extension that loads skills only in the repositories you list. Nothing goes into the
repositories themselves, and the skills do not live in `~/.pi/agent/skills`, which pi would load
everywhere.

It also makes sure the agent uses a skill when it applies, instead of relying on the agent to read
it: it scores each prompt against the loaded skills, and loads a skill when the agent touches a file
or hits an error the skill covers. See [Triggers](#triggers).

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
  "semantic": { "url": "http://localhost:8097" },
  "skills": {
    "repo-scaffold": { "path": "/nix/store/...-pi-skills-1.0.0/repo-scaffold", "repos": ["*"] },
    "terraform": {
      "path": "~/skills/terraform",
      "repos": ["my-org/infra", "my-org/*"],
      "triggers": { "paths": ["infra/**"], "extensions": [".tf"], "errors": ["Error: Invalid provider"] }
    }
  }
}
```

`path` is the directory with the skill's `SKILL.md`: an absolute path or `~/...`.

### `triggers`

| Key | Meaning |
|---|---|
| `paths` | Globs. Relative globs start at the repository root (the worktree), or the working directory outside git. A glob without `/` matches the file name anywhere (`*.nix`). Globs starting with `/` or `~/` are absolute. |
| `extensions` | File extensions; `tf` and `.tf` are the same. |
| `errors` | Regular expressions, case-insensitive, matched against tool output. |

### `semantic`

| Key | Default | Meaning |
|---|---|---|
| `url` | (required) | Base URL of the embedding and rerank server. Without `semantic`, prompts are not scored. |
| `embedModel` | `qwen3-embedding-0.6b` | Embedding model. |
| `rerankModel` | `qwen3-reranker-4b` | Rerank model. |
| `load` | `0.9` | Score from which the skill goes before the prompt. |
| `hint` | `0.5` | Score from which the agent gets a note. |
| `part` | `0.8` | Score from which a part of the skill is added. |
| `maxParts` | `2` | Most parts added. |
| `candidates` | `8` | Skills or parts the embedding passes to the reranker; `0` reranks all. |
| `timeoutMs` | `3000` | Time limit per prompt. |

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

## Triggers

pi lists each skill's name and description in the system prompt and leaves it to the model to read
`SKILL.md`. Models often skip that. The extension loads skills by itself in three cases. In each it
uses the format of `/skill:name`, which pi and the model treat like a skill the user loaded:

```text
<skill name="git" location="/nix/store/...-skills/git/SKILL.md">
References are relative to /nix/store/...-skills/git.

...the body of SKILL.md...

These parts of the skill match the request; start with them:

<skill-part path="references/rebasing.md">
...
</skill-part>
</skill>

<the user's prompt>
```

### Scoring the prompt

With `semantic` set, each prompt (not `/commands`) is scored against the descriptions of the loaded
skills before the model sees it. A short follow-up such as "ok, do it" is scored together with the
user message before it.

1. **Embedding** narrows the skills and their parts (the Markdown files besides `SKILL.md`, except in
   `prompts/`, `templates/`, `assets/`, `scripts/`) down to `candidates`. The vectors of the skills
   are computed once per session, when the session starts.
2. **Reranking** scores the remaining skills from 0 to 1. For the best skill, it then scores its
   parts.
3. The best score decides:

| Score | Skill state | What happens |
|---|---|---|
| ≥ `load` (0.9) | not in context | The skill goes before the prompt, with up to `maxParts` parts that score ≥ `part` (0.8). |
| ≥ `hint` (0.5) | not in context | A note after the prompt: `<system>The skill X probably applies … Read …/SKILL.md …</system>`, naming the parts. |
| ≥ `hint` | still in context | A note only: `<system>The skill X is still in this conversation above. Follow it; do not read its SKILL.md again.</system>` |
| ≥ `hint` | `disable-model-invocation` | A note that tells the agent to suggest `/skill:X` to the user, and a notification. The skill does not run by itself. |
| below `hint` | | Nothing. |

When the server does not answer within `timeoutMs`, the prompt goes on unchanged. Each scoring is
stored in the session as a `repo-skills-score` entry (not sent to the model), so the thresholds can
be tuned on real prompts. `/repo-skills score <prompt>` shows the scores of a prompt.

The extension expects an OpenAI-compatible server with `/v1/embeddings` and `/v1/rerank`, such as
llama-swap with llama.cpp. The defaults are Qwen3-Embedding-0.6B and Qwen3-Reranker-4B.

### Files and errors

The `triggers` of a skill load it without scoring:

| Trigger | When | What happens |
|---|---|---|
| `paths`, `extensions` | The agent calls `edit` or `write` on a matching file | The call is stopped once; its result is the skill, with the request to follow it and repeat the call. |
| `paths`, `extensions` | The agent reads a matching file | The skill is added to the read result. |
| `errors` | The output of a tool other than `read`, `grep`, `find`, `ls`, `edit`, `write` matches | The skill is added to the tool result. |

A skill with `disable-model-invocation` is suggested instead, once per session. Calls made inside a
codemode script are not checked.

### In context

A skill counts as in context when a skill block of it (from `/skill:name` or this extension) or a
read of its `SKILL.md` is in the part of the session the model sees. After a compaction summarized it
away, it loads again. While it is in context, the extension does not load it again, and refuses a
second read of its `SKILL.md`.

### Descriptions

Scoring and the model both route on the description. A skill whose description does not say when to
use it (`Use when …`, `Use for …`, `Run only on request …`) is reported when the session starts.

## Commands

`/repo-skills` shows the following:

- the config file
- the working directory
- the main checkout and worktree
- the normalized remotes
- the scoring server and thresholds
- for each skill, whether it matches, which entry matched, and its triggers

`/repo-skills score <prompt>` scores a prompt against the loaded skills and shows the decision, the
scores and the parts.

The skills are chosen when the session starts. After a change to the config, run `/reload`.

## Notes

- A skill with the same name in `~/.pi/agent/skills` or in a project also loads; pi reports the
  conflict. Remove the copy from `~/.pi/agent/skills` when you move a skill here.
- `repo-mcp` in [pi-mcp-servers](https://github.com/Patrick-Kappen/pi-mcp-servers) does the same
  for MCP servers. `match.ts` and `repo.ts` are the same in both.
