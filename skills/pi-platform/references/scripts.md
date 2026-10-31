# Script interfaces

## Environment and safety

Use Node 24 from the repository's devenv. Invoke scripts with absolute paths resolved from the
loaded skill directory. They use Node built-ins; generated target checks obtain their tools from
locked Nix/npm inputs. Never write beside an installed skill.

All entrypoints support --help. Unknown flags, missing required values and failed operations return
nonzero. Report-producing scripts write JSON to stdout by default. --out selects a new caller-owned
file, refuses overwrite and supports --dry-run. Keep private inventories outside public source.

Read the actual --help after updating the skill. Do not make an unknown flag work by guessing
another command or weakening validation.

## Discovery and planning

```sh
node <skill>/scripts/inventory.ts --repo <source>
node <skill>/scripts/plan-change.ts --repo <worktree> --base <trusted-ref>
node <skill>/scripts/home-manager-plan.ts --repo <config-repo> --platform <platform-repo>
node <skill>/scripts/release-plan.ts --repo <worktree> --base <trusted-ref>
```

These accept --out <file> and --dry-run. Dry-run prevents report writes, not read-only inspection.

Inventory reports source/document/manifest locations and exact duplicate hashes. Hash equality is
not semantic duplication analysis; jscpd handles production clones in the check suite. Read the
relevant documents yourself and record their revision.

Change planning includes changed components and reverse dependants. Shared/tooling/unowned changes
require full checking. Documentation-only scope still needs docs and policy checks. Missing or
ambiguous graph information must not be interpreted as a safe empty test selection.

Home Manager planning is advisory discovery. Missing or multiple integration points require source
inspection or a decision. It does not rewrite generated flake.nix or activate the host.

Release planning proposes component bumps and identifies review needs. It does not update tags,
push, merge, publish or deploy. Review breaking changes, uncommitted work and dependency propagation.

## Scaffold

```sh
node <skill>/scripts/scaffold.ts \
  --repo <approved-worktree> --name <name> --kind public \
  --scaffold-skill <loaded-repo-scaffold-directory> --dry-run
```

Run without --dry-run only after inspecting the plan. Use --kind private for the private companion.
The target must already be a valid non-default worktree. No remote creation or implicit commits.

The script reuses repo-scaffold resources instead of copying its general bootstrap implementation.
Existing files or output collisions require an integration plan, not forced overwrite. A rendered
file must not retain unresolved template placeholders or escape through a symlink.

The output includes copied runtime scripts and provenance hashes. It has no runtime dependency on
the installed skill's path. Render and test the output; templates are not automatically linted by
the enclosing skills repository.

## Policy

```sh
node <trusted-scripts>/check-policy.ts --repo <candidate> --base <approved-base-sha>
```

An optional --policy path selects a repository-relative policy file for a reviewed integration.
It is not a bypass for the required canonical policy.

Use a trusted implementation and base, not the candidate's sole self-report. A missing base/policy
fails; establish the initial policy under explicit owner review. Dependency graph checks do not
replace the parser-based import-boundary check in generated projects.

## Parallel checks

```sh
node <skill>/scripts/run-checks.ts \
  --repo <worktree> --jobs 2 --out-dir <new-private-run-directory>
```

Options:

| Option | Meaning |
|---|---|
| --manifest <file> | Explicit check manifest; default is platform-checks.json in the target |
| --jobs <n> | Bounded number of concurrently running checks |
| --only <id,id> | Selected checks plus prerequisites; development use, not full required CI |
| --out-dir <directory> | New run directory, refused if already present |
| --dry-run | Validate/select checks without starting commands or writing logs |

A manifest has schemaVersion 1 and a checks array. Each check has id and argv, optional needs
(check IDs) and timeoutSeconds. An invalid/empty/cyclic graph fails. Commands are argv arrays,
not concatenated user shell strings. Logs and result JSON belong to a unique run.

## Background jobs

```sh
node <skill>/scripts/jobs.ts start --repo <worktree> --state-dir <state> \
  --notify-json '<notification-argv-json>' -- <command> <args>
node <skill>/scripts/jobs.ts status --state-dir <state> --id <id>
node <skill>/scripts/jobs.ts cancel --state-dir <state> --id <id> --dry-run
```

Start and cancel support dry-run. Read the jobs reference for identity, descendant cleanup,
notification placeholders, delivery limitations and the rule to stop after launch.

## Tests and failure handling

Skill tests live in the repository's test/skills/pi-platform directory, not in the installed skill.
Test pure helpers, real temporary files/processes/Git, rendered templates and the script CLI.
Use git_check for repository checks where available.

On a failure preserve its diagnostic result, fix the cause, and rerun the affected gate. Missing
tools, network, notification services or baseline refs are not evidence that the code passed.
No swallowed exits, unconditional echo-success, lowered budgets or blanket ignore patterns.
