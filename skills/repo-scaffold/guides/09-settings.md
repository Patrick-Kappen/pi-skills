# 9. Check or fix the GitHub settings of existing repositories

Use this guide on its own, through `/repo-settings`, for repositories that already exist. It does not
need a scaffold run: it works on any GitHub repository the user administers. The settings and their
reasons are in `references/github-settings.md`.

1. **Check**, which changes nothing:
   - one or more repositories: `<skill>/scripts/github-settings.ts <owner>/<repo> ...`;
   - all of an owner: `<skill>/scripts/github-settings.ts --all <owner>` (archived repositories and
     forks are skipped).
   Exit code 0 means everything matches, 1 means differences, 2 means an error.
2. **Report** to the user, per repository: ok, or the differences in plain words, grouped (merges,
   Actions, security, ruleset). Point out:
   - repositories marked "no CI checks found to require": their ruleset would not require checks,
     because they have no `.github/workflows/ci.yml` with job names. Propose `--checks "<job name>"`
     if they have CI under another file, or leave it;
   - a ruleset called `main` that already exists but differs: applying replaces its rules;
   - differences in the area `release` (the release App's variable or secret): `--apply` does not
     set those. The variable is the App's Client ID; the secret is the App's private key, which the
     user sets from the machine that has it (`references/ci-cd.md`). Never ask for the key in chat;
   - repositories where the user may want an exception (a profile repository, a scratch repository).
3. **Ask** which repositories to change. This is visible on GitHub; wait for an explicit yes with the
   list of repositories.
4. **Apply** only to the approved ones:
   `<skill>/scripts/github-settings.ts <owner>/<repo> ... --apply --yes [--checks "..."]`.
   It re-reads the settings afterwards and prints what still differs. Investigate anything left
   (missing admin rights, a feature the plan does not include) instead of retrying blindly.
5. **Hand over**: what changed, what was left as it is and why, and the notes of
   `references/github-settings.md` that matter (without the release App, release PRs have no CI
   and need an admin merge).
