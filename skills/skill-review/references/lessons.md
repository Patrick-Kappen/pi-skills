# Where a finding goes

A review produces two kinds of output: changes to the reviewed skill, and lessons that hold beyond
it. Route each to where it has effect, and keep each destination in its own PR.

## Destinations

| The finding is about | Destination | Repository and file |
|---|---|---|
| This skill only: a wrong command, a missing step, an unclear section | The skill | pi-skills: `skills/<name>/` |
| How skills should be written: structure, wording, scripts, descriptions | Learnings log, later the skill rules | pi-skills: `skills/skill-create/references/learnings.md`, then `best-practices.md`, `skill-rules.md` or `scripts/check-skills.ts` |
| How the agent behaves in general, in any task: an instruction it needs everywhere or in some repositories | A rule | pi-rules: `rules/<name>.md` |
| Something the agent must never do, or must always ask for, and that a tool call shows | A permission | nixos-config: `programs.pi-rules` (`deny` or `ask`), in `packages/agents/pi/rules/default.nix` |
| Something that must happen automatically around a tool call or before the agent finishes | A hook | nixos-config: `programs.pi-rules.*.hooks`, same file |

Prefer enforcement over text: an instruction the agent ignored twice ("never push to main") is a
candidate for a permission or a hook, not for louder wording. Keep the instruction in the skill
when it explains the why; the permission or hook makes sure.

## Lessons for writing skills

1. Read `learnings.md` in the skill-create skill (pi-skills repository).
2. **New lesson**: add it under Candidates, with the reviewed skill, the date and the session ids.
3. **Lesson already a candidate from another skill**: propose to promote it. Pick the target:
   - advice that helps most skills: `best-practices.md`;
   - something every skill must do: `skill-rules.md`;
   - something a script can check: also `scripts/check-skills.ts`, with a test in
     `test/scripts/check-skills.test.ts`, and fix the existing skills that break it in the same PR.
   Set the entry to adopted with the target file.
4. **Same skill again**: add the sessions as evidence, but do not promote. One skill can have its
   own quirks; the second skill is what shows the lesson is general.
5. **Contradicted or declined**: set it to rejected with the reason.

## Lessons for the agent's behaviour (pi-rules)

- pi-rules lives in `~/private/pi-rules` (`github.com/Patrick-Kappen/pi-rules`). Its README
  describes rules, permissions and hooks, and `/repo-rules` shows what applies where.
- A new or changed rule is a branch and PR in pi-rules (`rules/<name>.md`, plus its row in the
  README table).
- Which rules, permissions and hooks apply where is set in nixos-config; propose the lines, and make
  that change as a separate worktree and PR in nixos-config only when the user asks.
- The same promotion bar applies: one session is an anecdote. Propose an agent rule only with
  evidence from several sessions, or on the user's request.
