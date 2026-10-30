# 7. GitHub

Skip this step if `github=no`.

1. Ask: "Create `<owner>/<name>` as a **<visibility>** repository on GitHub and push `main`?" Wait for
   a yes.
2. Run `<skill>/scripts/github.sh <repo> --yes`. It does the following:
   - creates the repository;
   - configures it: squash merges only, with the PR title and body; branches are deleted on merge;
     auto-merge is allowed; workflow permissions are read, and Actions may open PRs (release-please);
     topics;
   - pushes `main`. The pre-push hook runs `check` again.
3. Watch the first CI run with `gh run watch -R <owner>/<name>`. If it fails, fix it on a branch with a
   PR; do not push to `main`.
4. With `release=yes`, release-please opens a release PR (0.1.0) as soon as `main` has a `feat` or
   `fix` commit. **Do not merge it**; the user decides when to release. Its CI shows "approval
   required" until the user approves it or sets `RELEASE_PLEASE_TOKEN` (see `references/ci-cd.md`).
