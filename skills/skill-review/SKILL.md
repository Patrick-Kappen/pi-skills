---
name: skill-review
description: Review how a pi skill performed in past pi sessions and improve it - a cheap model analyses the sessions that used the skill, then the skill is fixed or extended in the pi-skills repository with a PR, and lessons that hold beyond the skill go into the skill-writing rules or the agent rules (pi-rules). Use when the user asks to review, improve, update, fix or extend an existing skill, or asks how well a skill works.
metadata:
  version: "1.0.0"
---

# skill-review

Improve a skill with evidence from real sessions. Scripts collect the sessions and let a cheap model
analyse them; you turn the report into changes, which the user approves. Lessons that hold beyond
this skill feed back into the rules that new skills are written with (skill-create), or into the
agent rules of pi-rules, so the next skill and the next task start better.

Paths are relative to this file. Read each guide fully before you act on it.

## Where skills live

Skills live in the **pi-skills repository** (`~/private/pi-skills`,
`github.com/Patrick-Kappen/pi-skills`) and nowhere else. A change to a skill is always a branch and a
PR there. Never edit a skill in the Nix store, in `~/.pi/agent/skills` or in a project's
`.pi/skills`. A skill found elsewhere moves into the repository first, via the skill-create skill.

## Steps

| # | Guide | Does | Script |
|---|---|---|---|
| 1 | `guides/01-scope.md` | Agree on the skill and the question | — |
| 2 | `guides/02-collect.md` | Find the sessions and write redacted digests | `scripts/find-usage.ts` |
| 3 | `guides/03-analyse.md` | Let a cheap model write the report | `scripts/analyse.sh` |
| 4 | `guides/04-propose.md` | Check the report, route each item, propose changes, get a yes | — |
| 5 | `guides/05-change.md` | Change the skill, the learnings and the rules, each in its own worktree | `scripts/check-skills.ts` in the repo |
| 6 | `guides/06-pr.md` | Open the PRs and hand over | — |

Ask in steps 1 and 4 only. Stop at the first failing step, fix the cause, and run it again.

## Rules

1. Every change rests on evidence from sessions or on an explicit request from the user. Do not
   rewrite a skill for taste.
2. The user approves the list of changes before you edit (step 4).
3. Session digests stay on this machine except for the analysis model; see `references/privacy.md`.
   Never paste digest content into the skill, a commit or a PR: no secrets, customer names, paths
   of other projects, or personal data.
4. The skill must still pass the repository rules after the change:
   `skills/skill-create/references/skill-rules.md` in the pi-skills repository.
5. A lesson becomes a skill-writing rule only when a **second** skill shows it, or the user asks.
   Lessons about the agent's behaviour go to pi-rules, not into skills. One PR per destination.
6. Never merge a PR or a release PR; the user merges and releases.
7. Agent files (`AGENTS.md`, `CLAUDE.md`, `.pi/`, ...) stay out of git.

## References

| File | Read when |
|---|---|
| `references/lessons.md` | Step 4: where each finding and lesson goes, and when a lesson is promoted |
| `references/privacy.md` | Before step 2, or when the user asks what leaves the machine |
| `references/scripts.md` | A script fails, or you need its options |
| `assets/analyst.md` | You want to know what the analysis model was told |
