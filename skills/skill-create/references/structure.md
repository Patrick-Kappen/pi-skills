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

## `set`: a main skill with sub-skills

For a large domain (a cloud platform, a company's infrastructure code) where an agent needs the
shared rules every time, but only one narrow area per task.

```text
<name>/
├── SKILL.md            # the main skill: rules, high-level practice, basics, gotchas, table of sub-skills
├── references/         # shared topics the main skill points to
└── skills/
    ├── <area>/
    │   ├── SKILL.md    # one narrow area; links back to ../../SKILL.md for the rules
    │   └── references/
    └── <area>/SKILL.md
```

- **The main skill** is a normal skill the model can pick. It holds what applies to every area:
  rules, high-level practice, the basic knowledge, and the gotchas. It lists the sub-skills with one
  line each, so the agent can read the right one itself.
- **Sub-skills** are hidden from the model: pi treats a folder with a `SKILL.md` as one skill and
  does not look inside it. The repo-skills extension loads a sub-skill when a prompt scores high
  against its description, or when a trigger in Home Manager matches
  (`skills.<name>.subskills.<area>.triggers`). When it loads, it gets one line that names the main
  skill and its path, not the main skill's content.
- **Split finely.** One sub-skill per area the agent works on in one task (a resource type, a
  pipeline kind), so it never reads instructions it does not need. A sub-skill that covers two
  unrelated areas is two sub-skills. Keep its `SKILL.md` short; details go to its `references/`.
- **Descriptions decide.** A sub-skill is found only by its description and its triggers. Write it
  like any description (`<what>. Use when <triggers>.`), with the words of the tasks it covers, and
  say what it is not for when a neighbour is close.
- **Do not repeat the main skill.** A sub-skill links back (`Read ../../SKILL.md first`) instead of
  copying rules; repeated rules drift apart.
- The sub-skill's `name` is its folder name; repo-skills shows it as `<name>/<area>`.

## Choosing

| Situation | Structure |
|---|---|
| Rules or conventions the agent applies while doing other work | `single` |
| A short workflow without scripts | `single` |
| Several steps, user decisions, scripts, or a fixed order | `index` |
| More than about 150 lines of instructions | `index`, or `single` with references |
| One domain with many separate areas, each needed on its own | `set` |
