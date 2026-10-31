# CI trust boundary

The policy job fetches the protected default branch and executes `check-policy.ts` from that trusted
base archive, not from the candidate tree. The required aggregate job runs with `always()` and fails
when policy or platform checks fail, skip, or cancel. Action references are resolved to commit SHAs by
the repo-scaffold `pin-actions.sh` utility.

This workflow file is still candidate-editable: a pull request can change or remove its jobs. A
repository administrator must configure an external ruleset/branch protection that requires the
stable `required` aggregate check and independently protects the trusted policy workflow/check
source (for example, an organization-owned reusable workflow pinned to an immutable SHA or an
independent required-check app). Do not treat a green candidate-defined workflow as sufficient. Do
not use pull_request_target or grant candidate code write permissions. This skill does not configure
GitHub settings, bypass protections, auto-merge, or publish releases.
