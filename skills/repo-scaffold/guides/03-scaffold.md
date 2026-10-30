# 3. Scaffold

1. Run `<skill>/scripts/scaffold.sh` with the same flags, without `--dry-run`.
2. It does the following:
   - creates `<repo>` (`~/<location>/<name>`) and runs `git init -b main`;
   - copies the templates and fills in the placeholders;
   - pins the GitHub Actions to commit SHAs (`<skill>/scripts/pin-actions.sh`);
   - writes the settings to `.git/repo-scaffold.env` for the next scripts;
   - stages everything.
3. If it fails, read the message. Fix the cause (a parameter, a missing tool, an existing directory)
   and run it again. Remove a half-created directory only if this run created it.

Read `references/layout.md` if you need to explain the files.
