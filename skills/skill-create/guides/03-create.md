# 3. Create

1. Make a worktree of the pi-skills repository; never work in its main checkout. If the git skill
   is available, follow it. Otherwise:

   ```sh
   cd ~/private/pi-skills && git fetch origin
   git worktree add -b feat/skill-<name> ~/.worktrees/pi-skills/skill-<name> origin/main
   cd ~/.worktrees/pi-skills/skill-<name> && devenv shell -- true
   ```

2. Run the script with the approved flags, without `--dry-run`, and `--repo` pointing at the
   worktree:

   ```sh
   scripts/new-skill.sh --repo ~/.worktrees/pi-skills/skill-<name> --name <name> --kind <kind> \
     --description "<description>" [--prompt] [--manual]
   ```

   It creates `skills/<name>/` from `templates/<kind>/` (and `prompts/<name>.md` with
   `--prompt`), fills in the name and description, and adds a row to the skill table in
   `README.md`. It refuses an existing skill.
3. The skeleton fails `check-skills.ts` on purpose until the `TODO` markers are replaced in step 4.
