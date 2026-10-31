---
name: skill-create
description: Create a new pi skill, or import an existing one, in the pi-skills repository - gather the facts, choose the structure, scaffold it with a script, write it to the repository rules and best practices, check it, and open a PR. Use when the user asks to make, write or add a skill, to turn a workflow, prompt or document into a skill, or to move a skill from elsewhere into the repository.
metadata:
  version: "1.1.0"
---

# skill-create

Make a skill that loads at the right moment, says only what the agent cannot know, and puts
repeated mechanical work in scripts.

Paths are relative to this file. Read each guide fully before you act on it.

## Where skills live

Skills live in the **pi-skills repository** (`~/private/pi-skills`,
`github.com/Patrick-Kappen/pi-skills`) and nowhere else: `skills/<name>/`, on a branch, with a PR.
Never create a skill in `~/.pi/agent/skills`, in a project's `.pi/skills` or `.agents/skills`, or
in the Nix store. The repo-skills extension decides per repository where a skill loads; the user
sets that in nixos-config after the release.

## Steps

| # | Guide | Does | Script |
|---|---|---|---|
| 1 | `guides/01-intake.md` | Collect purpose, triggers, facts and sources | — |
| 2 | `guides/02-design.md` | Choose name, description and structure; get a yes | `scripts/new-skill.sh --dry-run` |
| 3 | `guides/03-create.md` | Worktree, branch and skeleton | `scripts/new-skill.sh` |
| 4 | `guides/04-write.md` | Write SKILL.md, guides, references and scripts | — |
| 5 | `guides/05-check.md` | Check the rules, test the scripts, try the skill | `scripts/check-skills.ts` in the repo |
| 6 | `guides/06-pr.md` | Open the PR and hand over | — |

Ask in steps 1 and 2 only. Stop at the first failing step, fix the cause, and run it again.

## Rules

1. One skill, one job. Two unrelated jobs are two skills.
2. Every fact in the skill is checked: commands run, paths exist, flags are current. Do not write
   from memory what you can look up or try.
3. The repository rules in `references/skill-rules.md` are not optional; `check-skills.ts` enforces most of
   them in CI. They grow from reviews: the skill-review skill logs lessons in
   `references/learnings.md` and promotes them into the rules and best practices.
4. What the agent must never do or always do, in any task, belongs in pi-rules (a rule, a
   permission or a hook), not in a skill. A skill explains the why; pi-rules enforces it.
5. Never merge the PR or the release PR; the user merges and releases.
6. No secrets, customer names or personal data in a skill. Agent files (`AGENTS.md`,
   `CLAUDE.md`, `.pi/`, ...) stay out of git.

## References

| File | Read when |
|---|---|
| `references/skill-rules.md` | Always, before step 2 |
| `references/best-practices.md` | Step 4 |
| `references/description.md` | Writing the `description` (step 2) |
| `references/structure.md` | Choosing the structure (step 2) |
| `references/scripts.md` | The skill gets scripts |
| `references/import.md` | Moving an existing skill into the repository |
| `references/learnings.md` | Step 2: lessons from reviews; candidates may apply to this skill too |
