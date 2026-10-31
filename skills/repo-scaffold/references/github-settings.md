# GitHub settings

`scripts/github-settings.ts` checks and applies these settings. New repositories get them in step 7;
existing ones through guide 9 (`/repo-settings`). Change the settings in the script, not by hand in
GitHub, so check and apply stay the same.

## Merges

- Only squash merges; the squash commit is the PR title plus the PR body. With Conventional Commit
  PR titles, `main` gets one Conventional Commit per PR, which release-please reads.
- Branches are deleted on merge; auto-merge is allowed.

## Actions

- Default workflow permissions `read`; workflows ask for more per job.
- Actions may create and approve PRs, so release-please can open its release PR.

## Security

- All repositories: Dependabot alerts and Dependabot security updates.
- Public repositories also: secret scanning, push protection, and private vulnerability reporting.
  Secret scanning on private repositories needs GitHub Advanced Security, which GitHub Pro does not
  include; gitleaks in the hooks and CI covers them.

## Release App

Repositories with `release-please-config.json` need the variable `RELEASE_APP_CLIENT_ID` and the
secret `RELEASE_APP_PRIVATE_KEY`, so release PRs are opened by the release App and get CI (see
`references/ci-cd.md`). The script checks both, but never sets them.

## The `main` ruleset

One ruleset named `main`, active on the default branch:

- no deletion and no force-push (`non_fast_forward`);
- linear history;
- changes only through a pull request; no approvals required (one-person repositories), squash only;
- required checks: the job names of `.github/workflows/ci.yml` (for the scaffold: the PR title check
  and `devenv test`), not strict, so a PR need not be up to date with `main`. Override with
  `--checks "<name>,<name>"`; a repository without that file gets no required checks;
- bypass: the repository admin role, always. The owner can still push or merge in an emergency; the
  agent must not use that (see `references/conventions.md`).

Rulesets on private repositories need GitHub Pro (or a paid organisation plan).

## Notes

- Release PRs are opened by the release App when the repository has the variable
  `RELEASE_APP_CLIENT_ID` and the secret `RELEASE_APP_PRIVATE_KEY`; then their CI runs. Repositories
  with `release-please-config.json` are checked for both (area `release`). Without them, release PRs
  have no CI and only the admin bypass can merge them.
- The `release.yml` workflow moves the `latest` branch; the ruleset covers only the default branch,
  so that keeps working.
- A ruleset named `main` that already exists is replaced as a whole on apply.
