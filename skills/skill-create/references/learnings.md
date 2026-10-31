# Learnings

Lessons about writing skills, found by the skill-review skill in real sessions. This log is
evidence, not a rule set: a lesson becomes binding only when it is promoted into
`best-practices.md`, `skill-rules.md` or `scripts/check-skills.ts`.

## How a lesson moves

1. **candidate**: seen in the sessions of one skill. Added here by skill-review, with evidence.
2. **adopted**: seen again in the sessions of a **second, different** skill. skill-review proposes
   to promote it; after the user's yes it goes into `best-practices.md` (advice), `skill-rules.md`
   (a rule every skill follows) or also `scripts/check-skills.ts` (a rule a script can check). The
   entry here keeps the evidence and names where it went.
3. **rejected**: the user decided against it, or later sessions contradict it. Keep the entry with
   the reason, so the same lesson is not proposed again without new evidence.

Lessons about the agent's behaviour in general, outside skills, do not belong here: they go to
pi-rules as a rule, a permission or a hook (see the skill-review skill).

## Entry format

```markdown
### <short lesson, as an instruction>
- Status: candidate | adopted (<file it went to>) | rejected (<reason>)
- Seen in: <skill> (<date>, sessions <id8>, <id8>); <skill> (<date>, sessions <id8>)
- Why it matters: <what went wrong without it, or right with it>
```

Newest lessons at the top of their section. Session ids are the first 8 characters; never copy
session content here.

## Candidates

None yet.

## Adopted

None yet.

## Rejected

None yet.
