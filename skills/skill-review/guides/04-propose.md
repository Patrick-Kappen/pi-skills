# 4. Propose

The report is input, not truth. The analysis model saw digests, not the full sessions.

1. Check each finding and each lesson:
   - open the digest it cites and confirm the evidence;
   - check the "cause in the skill" against the current text;
   - drop items without real evidence, and items about another skill.
2. Route every confirmed item with `references/lessons.md`: the reviewed skill, the learnings log
   and skill rules (skill writing), or pi-rules (agent behaviour: a rule, a permission or a hook).
3. **Skill changes**: turn the findings, and the user's own requests from step 1, into a short list.
   Per change: the file, what changes, and the evidence (session ids, no content). Fit each change
   into the skill's structure and `skills/skill-create/references/skill-rules.md` (pi-skills
   repository): rules and workflow in `SKILL.md`, details in `references/`, repeated mechanical work
   in `scripts/`. Prefer a short, precise instruction with its reason over more text. Pick the
   version bump: patch for fixes and clarifications, minor for new steps, sections or scripts,
   major when the way to use the skill changes.
4. **Lessons for writing skills**: per lesson, new candidate, promotion (with the target file), or
   more evidence, following `references/lessons.md`.
5. **Lessons for the agent**: per lesson, the proposed pi-rules rule, permission or hook, and where
   it should apply.
6. Show the user the summary of the report and the three lists, what you dropped and why, and the
   PRs that will follow (one per destination). Wait for an explicit yes, per list; adjust if asked.
