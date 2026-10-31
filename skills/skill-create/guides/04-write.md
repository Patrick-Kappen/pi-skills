# 4. Write

Read `references/best-practices.md` first, and `references/scripts.md` if the skill has scripts.

1. Replace every `TODO` in the skeleton. Delete template files you do not need, and add the planned
   ones.
2. **SKILL.md** holds what the agent needs every time: the purpose in one or two sentences, where
   the work happens, the steps or rules, a table of references with when to read each, and the
   tools: every script, and the pi tools or MCP servers that do an action of the skill, with what to
   do when they are not there. Keep it short; details go to `references/`.
3. **Guides** (index skills): one step each, numbered, read fully before acting. Each ends with a
   clear result or the condition to continue.
4. **References**: one topic each, read only when a step points to them. Facts, tables, commands,
   pitfalls with their fixes.
5. **Scripts** for work that is mechanical, repeated, or easy to get wrong. Test them under
   `test/skills/<name>/`.
6. **Prompt template** (`prompts/<name>.md`), if planned: starts the skill with arguments.
7. Update the README row if the purpose changed while writing.
8. Check every command, path and flag you wrote by running or looking it up.
