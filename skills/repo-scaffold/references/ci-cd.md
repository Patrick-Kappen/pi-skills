# CI/CD (GitHub)

## Workflows

| Workflow | Trigger | Jobs |
|---|---|---|
| `ci.yml` | PRs, pushes to `main`, merge queue | `pr-title`: convco on the PR title (squash merges use it). `check`: `devenv test` with `SKIP=no-commit-to-branch`, and on PRs convco over `base..head` |
| `release.yml` | pushes to `main`, manual | `release-please`: keeps one release PR that collects all merged PRs; merging it bumps the version, writes `CHANGELOG.md`, tags `vX.Y.Z` and publishes the release. `verify-release`: `nix flake check` on the tag. `latest-branch`: moves `latest` to the tag, so `github:<owner>/<repo>/latest` always means the newest release |
| `dependabot.yml` | weekly | GitHub Actions and the language's packages, grouped, with a 3-day cooldown |

## Release notes

- release-please reads Conventional Commits on `main`: `feat` gives a minor version, `fix` a patch,
  and `!` or `BREAKING CHANGE` a major (a minor before 1.0, because of `bump-minor-pre-major`).
- `initial-version: 0.1.0`: without it, the first release would be 1.0.0.
- A squash merge uses the PR title as the commit. Extra `type(scope): subject` lines in the PR body
  each become their own entry in the release notes.
- Sections: Features, Bug Fixes, Performance, Reverts, Documentation. refactor, test, build, ci and
  chore are hidden.

## Repository settings

`scripts/github.sh` sets the topics (the language and `devenv`); everything else comes from
`scripts/github-settings.ts`, described in `references/github-settings.md`.

## Tokens

- A PR opened with `GITHUB_TOKEN` (release-please, Dependabot updates) does not start CI on its own;
  GitHub shows "approval required".
- The repository secret `RELEASE_PLEASE_TOKEN` fixes that: a fine-grained PAT with Contents and Pull
  requests write on this repository. The workflow uses it when it is set.

## Never

- Merging the release PR or other PRs on the user's behalf.
- `workflow_run` or `pull_request_target` triggers (zizmor flags them as dangerous).
