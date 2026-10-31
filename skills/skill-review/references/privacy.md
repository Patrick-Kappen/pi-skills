# Privacy

Session files contain everything that happened in a session: code, commands, outputs, paths, and
sometimes secrets or customer data.

## What goes where

| Data | Where it goes |
|---|---|
| Session files (`~/.pi/agent/sessions`) | Read locally by `find-usage.ts`; never changed |
| Digests and `index.json` | `~/.cache/pi-skill-review/<skill>-<time>/` (or `--out`); local |
| Digests and the skill text | Sent to the analysis model by `analyse.sh` (default `openai-codex/gpt-6-luna`) |
| `report.md` | Local; the model is told not to copy secrets or personal data into it |

The analysis run has no tools, no session file, no skills, no extensions and no context files.

## Redaction

`find-usage.ts` replaces these with `[REDACTED]` before writing a digest: private keys, GitHub
tokens, OpenAI and Anthropic keys, AWS access keys, Slack tokens, JWTs, Bearer/Basic credentials,
Azure storage keys and SAS signatures, age keys, and `<name containing secret/token/password/api key>
= <value>` pairs.

Redaction catches common formats, not everything. When sessions may contain data that must not
leave the machine (customer data, personal data), tell the user before step 3 and offer a local
model, for example `--model local/qwen3.6-35b-a3b`.

## In the skill, commits and PRs

Never copy digest content into the skill, a commit message or a PR. Refer to sessions by the first
8 characters of their id.
