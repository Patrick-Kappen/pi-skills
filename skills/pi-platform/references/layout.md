# Layout and component boundaries

The public target uses the following tree:

```text
packages/
  core/ rules/ skills/ mcp/ git/ orchestrator/ azure/ tweaks/
resources/
  skills/ rules/ profiles/
nix/
  home-manager/ packages/ mcp/
schemas/
scripts/
  platform/
tests/
  contracts/ integration/ fixtures/
docs/
  architecture/ decisions/ migration/
platform.json
platform-policy.json
platform-checks.json
justfile
devenv.nix
flake.nix
```

A component directory contains package.json, src/, its tests and a README. Name its public exports;
never import a sibling's src/ path. Keep a single canonical config schema and derive/validate the
Nix adapter and runtime parser against it. Do not maintain hand-copied schemas that drift.

The private target uses packages/, resources/ and nix/home-manager/ with the same interfaces.
It adds its catalog through the public module; it does not copy core, loaders or CI policy logic.

## Manifests

- platform.json declares component IDs, paths, versions and internal dependencies.
- platform-policy.json declares measurable quality floors and allowed component dependencies.
- platform-checks.json declares executable argv, prerequisites and time limits.
- Package manifests declare external/peer dependencies and public entrypoints.
- Lock files pin tools/dependencies. No implicit global binaries.

Component paths must be relative, inside the repository and non-overlapping. Validate duplicate IDs,
dependency cycles, unknown dependencies and manifest/version mismatches. Core cannot depend on a
domain module.

## File owners

| Change | Owner |
|---|---|
| Repository normalization/worktree resolution | core |
| New permission evaluation | rules, with core configuration contract |
| A new MCP server binary | nix/mcp and mcp catalog |
| Skill text/resources | resources/skills |
| New reusable user configuration | resources/profiles |
| Agent lifecycle primitive | shared core API; workflow remains in its topic |
| Host-specific model/endpoint/scope | consumer Home Manager sources |
| Private provider/resource | private companion |
| CI mechanics | scripts/platform; workflow and just are thin callers |

A template is source for another repository, not proof the result runs. Instantiate it in a disposable
worktree and run its parsers, linters, checks and module evaluation. Record the generating skill
version and hashes of copied scripts. An upgrade is a deliberate reviewed regeneration, not an
automatic overwrite or a runtime reference to a skill path.

Keep AGENTS.md, CLAUDE.md and .pi directories out of committed source under the owner's policy.
Do not introduce them as a shortcut for missing runtime rules.
