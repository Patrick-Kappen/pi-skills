# 2. Collect

1. Run, from any directory:

   ```sh
   scripts/find-usage.ts --skill <name> [--since YYYY-MM-DD] [--limit 30]
   ```

   (relative to this skill's directory; use the full path). It prints
   `{"skill":…,"out":"<dir>","sessions":N}`.
2. It scans `~/.pi/agent/sessions` for sessions where the model read `<name>/SKILL.md` or the user
   ran `/skill:<name>`, leaves out copies made by forks and the current session, and writes to
   `<dir>`:
   - `index.json`: per session the date, working directory, model, where the skill was loaded from,
     which skill files were read, and counts of user messages, tool calls and failed tool calls;
   - one digest per session: the user's request, then every user message, agent message, tool call
     and failed tool result, with secrets replaced by `[REDACTED]`.
3. Look at `index.json`:
   - **0 sessions**: the skill was never loaded. That is a routing finding in itself; check the
     `description` and continue with step 4 on the user's request alone.
   - **Same name, other skill**: `location` shows where each skill came from. Remove digests of an
     unrelated skill with the same name before step 3.
   - **Old versions**: sessions before the last big change judge an old text; use `--since`.
4. Open one or two digests yourself to check that the content makes sense.
