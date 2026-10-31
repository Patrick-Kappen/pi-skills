# Importing an existing skill

For a skill that lives elsewhere: `~/.pi/agent/skills`, a project's `.pi/skills` or
`.agents/skills`, `.claude/skills`, or another repository.

1. Find every copy (`find ~ -path '*/<name>/SKILL.md' -not -path '*/node_modules/*' 2>/dev/null`)
   and ask which one is current.
2. Run `new-skill.sh` with `--kind` matching the old layout, then replace the skeleton with the old
   files.
3. Make it pass the repository rules (`rules.md`): front matter fields, `metadata.version`
   (`1.0.0` for the first version here), no paths to `~/.pi/agent/skills` or home directories, no
   agent files, executable scripts, references that exist. Scripts must work from the read-only
   Nix store.
4. Keep the content. Improvements based on how the skill was used belong to the skill-review skill,
   in a separate PR.
5. In the handover, name the old copy to delete after the release and switch, so pi does not load
   it twice. Do not delete it before the user has the new version.
