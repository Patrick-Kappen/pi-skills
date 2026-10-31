# 4. Propose

The report is input, not truth. The analysis model saw digests, not the full sessions.

1. Check each finding:
   - open the digest it cites and confirm the evidence;
   - check the "cause in the skill" against the current text;
   - drop findings without real evidence, and findings about another skill.
2. Turn the confirmed findings, and the user's own requests from step 1, into a short list of
   changes. Per change: the file, what changes, and the evidence (session ids, no content).
3. Fit each change into the skill's structure and the rules in
   `skills/skill-create/references/rules.md` (pi-skills repository): rules and workflow in
   `SKILL.md`, details in `references/`, repeated mechanical work in `scripts/`. Prefer a short,
   precise instruction with its reason over more text.
4. Pick the version bump: patch for fixes and clarifications, minor for new steps, sections or
   scripts, major when the way to use the skill changes.
5. Show the user the summary of the report, the list of changes, what you dropped and why, and the
   new version. Wait for an explicit yes, and adjust the list if asked.
