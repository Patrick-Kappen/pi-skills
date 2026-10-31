# 4. Change one topic

1. Read the topic's source, upstream docs and existing contract tests. Reuse an extension hook,
   package API or shared helper before inventing another loader or service.
2. Write characterization tests before a behavior-preserving refactor. Add failing acceptance
   tests for new behavior. Public fixtures contain no private data.
3. Move one responsibility to its owner. Remove the old duplicate only after consumers use the
   replacement. Explicit dependencies are allowed; cycles, undeclared imports and sibling internal
   paths are not. Keep core independent of domain modules.
4. Use small deterministic transformation scripts for repeatable migrations. Require a dry-run,
   input/version checks, preservation of unknown user data, backups and tested recovery. Do not
   claim that copying source files preserves Git history; plan history imports separately.
5. Extend the canonical schema, typed validation, origin reporting and Home Manager options together.
   A new option needs positive, invalid-value and precedence tests. An unsupported file-scoped
   setting must fail, not be silently ignored.
6. Preserve existing scopes, permissions, event ordering, cancellation and state semantics. A
   deliberate difference belongs in the plan, release notes and migration tests.
7. Add/check every required runtime dependency and its licensed provenance. Code from zerodawn is
   an input to research, not an approved bulk import. Port only a chosen behavior into its correct
   topic, remove old coupling, and prove the contract with new fixtures.
8. Run affected checks through git_check. Do not launch concurrent writers to the same test output,
   generated manifest or worktree. Fix failures; do not disable the check.

Result: one reviewable topic with no unexplained behavior drift, tested integration boundaries and
a documented rollback path.
