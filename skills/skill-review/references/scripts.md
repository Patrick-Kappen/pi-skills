# Scripts

Both scripts run from the skill directory in the read-only Nix store; they write only to the output
directory.

## `scripts/find-usage.ts`

Node 22 or newer runs it directly (TypeScript without a build step).

| Option | Default | Meaning |
|---|---|---|
| `--skill <name>` | required | The skill to look for |
| `--sessions <dir>` | `$PI_CODING_AGENT_DIR/sessions` or `~/.pi/agent/sessions` | Where the session files are |
| `--since YYYY-MM-DD` | all | Leave out older sessions |
| `--limit <n>` | 30 | At most this many sessions, newest first |
| `--max-chars <n>` | 20000 | Size of one digest; the middle of a longer session is cut |
| `--out <dir>` | `$XDG_CACHE_HOME/pi-skill-review/<skill>-<time>` | Output directory |

A session counts when the model read a file ending in `/<name>/SKILL.md`, or a user message holds a
`/skill:<name>` expansion. The digest starts at the user message before that. Forks copy the history
of their parent, so sessions with the same first use are counted once. `PI_SESSION_FILE` (the
running session) is left out.

## `scripts/analyse.sh`

`analyse.sh <digest-dir> <skill-dir> [--model <provider/id>] [--thinking <level>] [--chunk-chars <n>]`

| Problem | Fix |
|---|---|
| `pi: command not found` | Run it where pi is installed |
| Authentication or model errors | Check `pi --list-models luna`; pass another `--model` if the user agrees |
| Report empty or cut off | Lower `--chunk-chars` (default 350000), or `--limit` in step 2 |
| `no digests` | Run `find-usage.ts` first, and pass its `out` directory |
