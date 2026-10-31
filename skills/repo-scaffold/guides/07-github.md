# 7. GitHub

Skip this step if `github=no`.

1. Ask: "Create `<owner>/<name>` as a **<visibility>** repository on GitHub and push `main`?" Wait for
   a yes.
2. Run `<skill>/scripts/github.sh <repo> --yes`. It does the following:
   - creates the repository and sets its topics;
   - pushes `main`. The pre-push hook runs `check` again;
   - applies the GitHub settings with `<skill>/scripts/github-settings.ts`: merges, Actions
     permissions, security features, and the `main` ruleset that protects the default branch (see
     `references/github-settings.md`). The confirmation of step 1 covers this.
3. Watch the first CI run with `gh run watch -R <owner>/<name>`. If it fails, fix it on a branch with a
   PR; do not push to `main`.
4. With `release=yes`, release-please opens a release PR (0.1.0) as soon as `main` has a `feat` or
   `fix` commit. **Do not merge it**; the user decides when to release. Without the release App
   its CI does not run, and only the admin bypass can merge it (see `references/ci-cd.md`).
