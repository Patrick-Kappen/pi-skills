# Structure

## `single`: one SKILL.md

For rules, conventions or a short workflow (example: the `git` skill).

```text
<name>/
├── SKILL.md            # rules and workflow, table of references
└── references/         # optional: one topic per file
    └── <topic>.md
```

## `index`: SKILL.md as an index with guides

For a procedure of several steps with scripts and questions to the user (examples: `repo-scaffold`,
`skill-create`, `skill-review`).

```text
<name>/
├── SKILL.md            # purpose, steps table (guide, what it does, script), rules, references
├── guides/
│   ├── 01-<step>.md    # one step each, read fully before acting
│   └── 02-<step>.md
├── references/         # read when a guide points to them
├── scripts/            # mechanical work; dry run for anything that creates or changes
├── templates/          # files the scripts copy into other repositories
├── assets/             # files scripts or helper models use
└── prompts/
    └── <name>.md       # optional: /<name> prompt that starts the skill
```

## Choosing

| Situation | Structure |
|---|---|
| Rules or conventions the agent applies while doing other work | `single` |
| A short workflow without scripts | `single` |
| Several steps, user decisions, scripts, or a fixed order | `index` |
| More than about 150 lines of instructions | `index`, or `single` with references |
