# 1. Intake

1. Read the user's request. Find out what you can yourself first: existing skills in
   `skills/` of the pi-skills repository (overlap?), the tools and repositories involved, the docs,
   and earlier sessions (`grep -rl <topic> ~/.pi/agent/sessions | head`) to see how the work goes
   today and where it goes wrong.
2. If an existing skill already covers most of it, propose extending that one with the
   skill-review skill instead.
3. If the skill exists elsewhere (another repository, `~/.pi/agent/skills`, `.claude/skills`),
   this is an import: follow `references/import.md` alongside these steps.
4. Ask for what is still missing, in **one** question:
   - **Job**: what the skill makes the agent do, and what "done" looks like;
   - **Triggers**: what the user says or does when it should load, and when it must not;
   - **Start**: loaded by the model when relevant, or only on request (`/skill:<name>` or a
     `/<name>` prompt);
   - **Facts**: the rules, conventions, commands, accounts, URLs and pitfalls the agent cannot know;
   - **Sources**: documents, repositories or examples to build on;
   - **Side effects**: what the skill may change, and what needs the user's confirmation;
   - **Where it should load**: every repository, or a list (for the nixos-config step at the end).
