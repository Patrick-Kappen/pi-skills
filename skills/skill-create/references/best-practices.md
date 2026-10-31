# Best practices

## Say only what the agent cannot know

The agent is capable. A skill earns its place with what is specific: conventions, accounts, URLs,
the order of steps, decisions already made, pitfalls seen before. Leave out general knowledge
("git is a version control system", "write clean code").

## Give the reason

"Run the dry run first, so the user sees every file before anything is created" is followed more
reliably than "Run the dry run first". A reason also lets the agent handle cases the skill did not
foresee.

## Be concrete

- Exact commands in code blocks, with placeholders in `<angle brackets>`.
- Exact paths, names and flags. Tables for options and for "problem → fix".
- One way to do a thing. Alternatives only with the condition that picks them.

## Keep the context small

- SKILL.md is read every time the skill loads: purpose, rules, steps, and a table of references
  with **when** to read each.
- References are read only when needed: one topic per file, so the agent reads one, not all.
- Move repeated mechanical work into scripts; a script's output costs fewer tokens than the
  instructions to do the same by hand.

## Make the steps checkable

- Each step ends with a result the agent can verify, or a condition to continue.
- Put questions to the user in as few places as possible, all at once.
- Say what to do when a step fails: stop, fix the cause, run the step again.

## Protect the user

- Name the actions that need confirmation (anything visible to others, anything destructive).
- Never let a skill bypass a check (`--no-verify`, lowered thresholds) to make something pass.
- Dry runs for scripts that create or change things.

## Write for the model that loads it

- Rules as a numbered list, short sentences, one instruction per sentence.
- Bold only for the few words that must not be missed.
- No filler: no "it is important to note that", no summaries of what was just said.
