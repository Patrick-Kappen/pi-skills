# 2. Design

Read `references/skill-rules.md`, `references/description.md` and `references/structure.md` first,
and skim the candidates in `references/learnings.md`: lessons from other skills that may apply here.

1. **Name**: lowercase letters, digits and single hyphens, at most 64 characters; a short noun or
   verb-noun for the job (`ado-pipelines`, `skill-review`). It must not exist in `skills/`.
2. **Description**: what it does and when to use it, following `references/description.md`.
3. **Structure**: `single` (one SKILL.md, maybe references) or `index` (SKILL.md as an index with
   numbered guides), following `references/structure.md`. List the planned files, scripts and their
   purpose, and whether a prompt template (`prompts/<name>.md`) is useful.
4. **Start**: model-invoked, or `disable-model-invocation: true` for skills with side effects that
   should run only on request.
5. **Enforcement**: list the hard prohibitions and confirmations from the intake ("never push to
   main", "ask before deleting"). Those that a tool call shows are better enforced by pi-rules (a
   `deny` or `ask` permission, or a hook) than by text alone; propose the pi-rules lines alongside
   the skill. The skill keeps the reason.
6. Run the dry run (full path of this skill's script):

   ```sh
   scripts/new-skill.sh --dry-run --repo ~/private/pi-skills --name <name> --kind <single|index> \
     --description "<description>" [--prompt] [--manual]
   ```

7. Show the user the name, the description, the structure with all planned files, what each script
   does, the proposed pi-rules lines, and the dry run. Wait for an explicit yes.
