# Quality gates

## One implementation, multiple entrypoints

Scripts own check behavior. just and devenv expose it; local hooks and CI invoke it. Do not write a
different shell pipeline in every workflow. Enter/install the pinned environment once before
parallel checks, not separately in every worker.

Use these stable recipes in generated repositories:

| Recipe | Meaning |
|---|---|
| inspect | Read-only inventory |
| plan | Impact selection against an explicit base |
| lint | Format and language/config lint, check-only |
| typecheck | Strict TypeScript |
| test-changed | Changed components and reverse dependants; conservative full fallback |
| test | Unit, contract and integration behavior |
| test-serial | Diagnostic equivalent with one test worker |
| coverage | Full instrumented tests and coverage floors |
| duplicates | Production duplication gate |
| dead-code | Unused files, exports and dependencies |
| architecture | Dependency graph, cycles and ownership |
| security | Secrets and known dependency advisories |
| check | Full required check DAG |
| release-plan | Read-only/proposal-only component release calculation |
| hm-check | Evaluate and test Home Manager composition |
| job-start, job-status, job-cancel | Supervised background execution |

Do not run the whole suite twice inside check merely to expose both test and coverage recipes.
A full coverage run can provide the full-test evidence. Shared/tooling/schema changes select all
affected consumers. Unknown dependency information falls back to the full suite, not no tests.

## Tools

Resolve actual packages/versions in the target devenv and lock files before adoption. These are
responsibilities, not a mandate to add overlapping tools for their own sake.

| Area | Baseline tool |
|---|---|
| TypeScript style and complexity | Biome, warnings treated as failures where supported |
| Types | TypeScript strict, including scripts |
| Dead code/dependencies | Knip |
| Tests/coverage | Vitest and V8 coverage |
| Duplication | jscpd, production sources only |
| Import boundaries/cycles | dependency-cruiser with parser-based graph |
| Shell | ShellCheck; formatter if shell scripts are maintained |
| Nix | nixfmt, Statix, Deadnix and actual module/flake checks |
| Workflows | actionlint and zizmor |
| Docs/data | markdownlint, typos and JSON/YAML schema validation |
| Secrets/advisories | gitleaks and the pinned dependency scanners |
| Git/release conventions | Existing Conventional Commit checker |

Biome comes from Nix on NixOS; do not use an unsupported downloaded binary. No global installs.
A missing binary or unsupported flag fails verification with a useful remedy.

## Floors and exceptions

The initial platform floor is 95% lines/functions/statements and 90% branches, or the existing
target's stricter floor. Enforce per-component reports so a large well-tested component cannot hide
an untested new one. Include new runtime source, not only files imported by tests.

Production duplication starts at zero for new components. Existing duplicate debt needs an
explicit, reviewed fingerprinted baseline that cannot grow; never exclude an entire failing package.
Maximum cognitive complexity is 15 unless the existing approved policy is stricter.

Compare policy edits against the trusted base. Threshold reduction, broad source exclusions,
disabled scanners, skipped tests and removed required checks are policy changes, not quick fixes.
Any approved exceptional suppression must be narrow, justified, owned, time-bounded and validated
by a separately protected policy process. The agent does not grant its own exception.

Coverage, duplication and complexity are useful proxies. They cannot prove correct behavior,
privacy, sound abstractions or secure business logic. Review those explicitly.

## Parallelism

Bound concurrency by available resources; default conservatively and allow an explicit worker
budget. Schedule by real prerequisites, not arbitrary sequences such as lint before security.
Use separate logs, test temp directories and coverage outputs per worker/package.

Do not combine CPU-wide Vitest workers inside CPU-wide package workers. Allocate one total budget.
Never run formatters concurrently with checks of the same files. Read-only checks may overlap.

Cache only against relevant source/tool/config/base fingerprints. A failed or incomplete previous
run is not a cache hit. Code or toolchain changes invalidate the applicable evidence.

## Required negative tests

- A broken type, unused exported symbol, production clone and forbidden/cyclic import fail.
- Missing/changed test discovery cannot yield a green empty suite.
- A disabled check, reduced floor or expanded ignore pattern is rejected against trusted policy.
- A failed, timed-out or blocked DAG node makes the final required result fail.
- Template rendering errors, absent tools and invalid Home Manager options fail.
- A generated project is checked with real tools, not merely string snapshots.
- Private fixtures and credentials cannot enter a public artifact.
- Refactors preserve runtime/config/state contracts; new features have explicit acceptance tests.
