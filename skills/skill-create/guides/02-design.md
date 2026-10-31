# 2. Design

Read `references/rules.md`, `references/description.md` and `references/structure.md` first.

1. **Name**: lowercase letters, digits and single hyphens, at most 64 characters; a short noun or
   verb-noun for the job (`ado-pipelines`, `skill-review`). It must not exist in `skills/`.
2. **Description**: what it does and when to use it, following `references/description.md`.
3. **Structure**: `single` (one SKILL.md, maybe references) or `index` (SKILL.md as an index with
   numbered guides), following `references/structure.md`. List the planned files, scripts and their
   purpose, and whether a prompt template (`prompts/<name>.md`) is useful.
4. **Start**: model-invoked, or `disable-model-invocation: true` for skills with side effects that
   should run only on request.
5. Run the dry run (full path of this skill's script):

   ```sh
   scripts/new-skill.sh --dry-run --repo ~/private/pi-skills --name <name> --kind <single|index> \
     --description "<description>" [--prompt] [--manual]
   ```

6. Show the user the name, the description, the structure with all planned files, what each script
   does, and the dry run. Wait for an explicit yes.
