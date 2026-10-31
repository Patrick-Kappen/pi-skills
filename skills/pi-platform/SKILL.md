---
name: pi-platform
description: Build, migrate and extend the modular Pi platform: public and private monorepos, shared infrastructure, scoped Home Manager configuration, parallel scripted checks, component releases and observable background workflows. Research the existing contracts first and enforce the platform rules in CI. Run only on request via /pi-platform.
disable-model-invocation: true
metadata:
  version: "1.1.0"
---

# pi-platform

Build and maintain the Pi platform described in `references/architecture.md`. Start with
`/pi-platform <request>` or `/skill:pi-platform <request>`. This is not a general repository
scaffolder. Reuse repo-scaffold, git and test-speed for their existing responsibilities.

Paths are relative to this file. Resolve `<skill>` to this directory, never to the current project.
Read each guide fully before acting. The skill may live in a read-only store.

## Non-negotiable rules

1. **If deterministic work can be scripted, script it.** Keep judgment in the agent; put discovery,
   validation, generation, repeatable transformations and release calculations in tested scripts.
   Do not create a script for one opaque shell command merely to hide a forbidden operation.
2. Research the existing implementation and read the relevant upstream docs before designing.
   An inventory lists sources; it does not prove the agent read them. Record revisions and findings.
3. One concern per worktree and PR. The owner merges and releases. Never work on the default branch
   or use an admin bypass. Creating remote repositories, changing visibility/protection, deploying,
   destructive migration and permanent permission changes require explicit approval.
4. Prefer an existing integration point. No hidden dependencies, duplicated shared code, cyclic
   imports or internal file-path coupling between components. Necessary dependencies are explicit,
   pinned and checked; "no dependencies" does not mean reimplementing a parser or cryptography.
5. Public and private content stay in separate repositories with one Home Manager namespace.
   Credentials never enter source, logs, generated examples or the Nix store.
6. Fail closed on missing tools, invalid configuration, unknown resources, failed or skipped required
   checks. Never lower thresholds, suppress errors or remove tests to get green.
7. Enforce measurable prohibitions in scripts and CI, not just prose. Use trusted-base policy
   validation and required checks; a PR must not be its own only policy authority.
8. Independent checks run concurrently with bounded workers and separate outputs. Dependencies,
   shared mutable resources, commits and releases retain their necessary ordering.
9. Launch long deterministic work through a supervised job with durable result and tested
   notification. Report its ID and log location, **end the turn**, and wait for the callback.
   Do not repeatedly poll, sleep in a tool, or claim unobserved success.
10. Keep contracts during a refactor. New behavior needs an explicit plan and tests. Assess the
    zerodawn repositories only in a later discovery route; do not bulk-import them.
11. Do not confuse the target architecture with an implemented platform. The scaffold supplies
    tooling and a starting module; mark unimplemented runtime scope resolution and features honestly.

## Steps

| # | Guide | Result |
|---|---|---|
| 1 | `guides/01-discover.md` | Sources, current contracts and differences between checkout/release/install |
| 2 | `guides/02-plan.md` | Approved scope, file ownership, gates, permissions and rollback |
| 3 | `guides/03-bootstrap.md` | Protected worktree, generated tooling, reproducible environment |
| 4 | `guides/04-change.md` | One migrated/refactored/extended topic with contract tests |
| 5 | `guides/05-verify.md` | Positive and negative evidence; generated artifacts tested |
| 6 | `guides/06-deliver.md` | PR, release proposal and separate Home Manager integration plan |
| 7 | `guides/07-handoff.md` | Durable job handoff or concise completed report |

Ask for missing decisions together in steps 1 and 2. Later stop only for a new approval boundary,
a failing gate or a genuine blocker. Never silently omit a step.

## Scripts

Invoke `node <skill>/scripts/<name>.ts --help` for exact options. Output is caller-owned; dry-run
must not write. Scripts that write a report refuse accidental overwrite.

| Script | When and what |
|---|---|
| `scripts/inventory.ts` | Step 1: inspect explicit repository roots, manifests, docs and duplicate source |
| `scripts/plan-change.ts` | Steps 2/5: changed components, reverse dependants and conservative check scope |
| `scripts/scaffold.ts` | Step 3: dry-run then generate the platform overlay in an approved worktree |
| `scripts/check-policy.ts` | Steps 4/5: structural contracts and policy protection against a trusted base |
| `scripts/run-checks.ts` | Step 5: run the check DAG in parallel; failures and blocked dependants are not green |
| `scripts/jobs.ts` | Step 7: start/status/cancel supervised background scripts with durable notification |
| `scripts/release-plan.ts` | Step 6: calculate a reviewable component release proposal; never publish |
| `scripts/home-manager-plan.ts` | Step 6: discover Nix integration points without changing or activating them |

`references/scripts.md` documents the interfaces, provenance and failure handling.
`templates/` contains the generated project files. Scripts are copied into generated projects with
their provenance, not imported at runtime from an unstable skill-store path.

## With the existing tools and skills

- Use `git_start` to create the worktree, `git_status` for open work, `git_check` for checks,
  and `git_pr` for commit/push/PR. Use `git_request` for a blocked permission or user decision,
  then stop. After `git_pr`, let its watcher report; do not watch CI yourself.
- For independently running worker agents, assign non-overlapping files or distinct worktrees.
  They do not stage or commit another worker's changes.
- Without pi-git, follow the git skill's manual workflow; the same locks and approvals still apply.
  Without a reliable completion callback, do not pretend an unattended run is monitored.
- Use repo-scaffold's discovery, templates, action pinning and repository-settings audit. Do not
  run its manual commit/push helpers when pi-git owns those operations.
- Use test-speed's measurement and changed-test principles. Run checks through `git_check` when
  available, rather than running the full suite in bash after every edit.
- MCP servers depend on the active repository configuration. Use MCP only after checking the
  available namespace and read/write mode; a skill cannot enable or authorize a server itself.

## References

| File | Read when |
|---|---|
| `references/architecture.md` | Always: the agreed platform design and migration boundary |
| `references/layout.md` | Creating a component, moving code or choosing a file owner |
| `references/configuration.md` | Scopes, profiles, merging, security and resource identities |
| `references/quality.md` | Adding checks, tests, tooling or a quality budget |
| `references/enforcement.md` | Adding a hard rule, permissions, hooks or required CI checks |
| `references/releases.md` | Component versions, compatibility and release workflow |
| `references/home-manager.md` | Exporting/importing a module or changing the NixOS consumer |
| `references/jobs.md` | Parallel work, detached Pi sessions, notifications and recovery |
| `references/scripts.md` | Script inputs, outputs, recipes and failure diagnosis |
| `references/evidence.md` | What is implemented/tested, advisory or manual, and still missing |
