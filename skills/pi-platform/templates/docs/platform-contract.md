# Platform contract

`platform.json` is the source manifest: component IDs map to safe relative paths, semantic versions,
and dependencies expressed as component IDs. Every package manifest is private, including components
in public source repositories; publication is an explicit future workflow, never an incidental npm
side effect.

`platform-policy.json` is a floor contract. The checked-in policy must not weaken component-source
coverage, duplicate, complexity, or dependency boundaries relative to the trusted base. Coverage is
measured over `packages/**/*.ts`; copied `scripts/platform` utilities are tooling, not part of that
component-coverage claim. Their source tests remain with the pi-platform skill. The trusted CI checker
executes from the base ref. Regex-only checks are not architectural proof; the generated architecture
gate uses a TypeScript-aware dependency graph analyzer plus policy validation.

`platform-checks.json` defines a bounded dependency DAG. `just check` runs every required gate. `just
test-changed` prints the changed-component/reverse-dependency plan, then runs both test suites in full
as a conservative superset until per-component test selection is available. Full CI never accepts a
subset run. Releases are proposals managed by release-please; humans review and merge the release PR.

The Home Manager module exposes a read-only catalog and deterministic JSON composition. Runtime
scope resolution, activation, mutable state, and service management are intentionally not implemented.
