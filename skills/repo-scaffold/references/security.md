# Security

| Layer | Tool | Where |
|---|---|---|
| Secrets in commits | gitleaks (`--staged`) and detect-private-keys | pre-commit |
| Secrets in history | gitleaks over the whole history | `security`, CI, and the owner's central pre-push |
| Dependencies | osv-scanner over the lock files, plus `npm audit` (typescript) | `security`, CI |
| GitHub Actions | actionlint and zizmor (`--min-severity=low`), with every action pinned to a commit SHA and a `# vX.Y.Z` comment | pre-commit, `lint` |
| Workflow permissions | `permissions: {}` at the top, the least needed per job, `persist-credentials: false` | templates |
| Updates | Dependabot, weekly, with a cooldown | `dependabot.yml` |

## Rules

- Pin actions with `scripts/pin-actions.sh`, which resolves the newest release tag to its SHA. Never
  pin by tag.
- Put untrusted input (PR titles, branch names) in `env:` and use it from `run:` as `"$VAR"`, never as
  `${{ ... }}` inside `run:`.
- A vulnerable transitive dependency: first update the direct dependency. Otherwise use an `overrides`
  (npm) or a constraint (uv) within the supported range, and record why in the commit message.
- `SECURITY.md` asks for private reporting through GitHub.
