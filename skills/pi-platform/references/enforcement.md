# Enforcement and trust

## Three layers

1. Runtime permissions/hooks stop a prohibited action before its effect where the tool exposes it.
2. Repository scripts validate committed content and generated artifacts.
3. Protected GitHub checks prevent a failing change from merging.

A Markdown instruction is not a hard gate. A local Git hook alone is bypassable. A workflow file
alone does not establish branch protection. Audit all three and state any missing layer.

## Current pi-rules integration

The existing pi-rules module supports permissions and hooks. Inspect its installed/exported schema
before applying these examples; they are separate from the future programs.pi API:

```nix
programs.pi-rules.repos."github.com/example/pi-platform" = {
  permissions = {
    deny = [ "edit(@main)" ];
    ask = [
      "bash(gh repo create *)"
      "bash(gh pr merge *)"
      "bash(gh release create *)"
    ];
  };
};
```

These patterns are defense in depth, not a complete shell sandbox: scripts, aliases and nested tool
calls also need policy enforcement. Keep pi-git's repository locks and approved tool workflow.

A verified installed check-policy executable can be used by a scoped hook:

```nix
programs.pi-rules.repos."github.com/example/pi-platform".hooks.agent_before_settle = [
  {
    run = ''
      exec /absolute/path/to/trusted/platform-gate --repo "$PI_ROOT"
    '';
    timeout = 120;
  }
];
```

The path is illustrative, not an install command. Generate a real Nix wrapper whose implementation
is pinned and whose base revision comes from trusted configuration. The adapter maps a policy
violation to pi-rules' blocking exit code 2; unexpected tool/config failures also block and explain.
Ordinary CLI gates may use exit 1, so invoking them directly is not enough to guarantee a hook block.

A pre-settle hook only prevents declaring completion; it does not undo an earlier forbidden write.
Use tool_call permissions/hooks for actions that must be stopped first, and agent_before_settle for
cheap cached final policy checks. Do not run the whole test suite after every tool result.
Test interactive, codemode/nested calls and worker sessions separately.

## Trusted policy checking

A candidate can modify its own checker, thresholds and CI. Therefore self-validation is insufficient.

- Run the structural policy verifier from an immutable approved base, against the candidate tree.
- Pin the base SHA; do not let a candidate-supplied env var select a more permissive baseline.
- Compare protected policy, scanner config, coverage scope, required scripts and workflows.
- A missing policy/base is an explicit bootstrap condition needing owner review, never a fallback
  to trusting the candidate. Do not add an automatic bootstrap escape hatch.
- Policy implementation changes need independent review and negative tests against the old contract.
- For stronger guarantees use an organization-required workflow or trusted external check provider
  that the candidate cannot replace. Configure branch rules to require that result.

A trusted-base checkout inside a candidate-editable workflow is useful but not tamper-proof by
itself. Audit GitHub protection/CODEOWNERS or the external policy authority, and report the gap
rather than promise that a PR can never disable its own CI.

## CI

Use read-only permissions for untrusted PR checks, SHA-pinned actions and ephemeral credentials
only in separately authorized release jobs. Do not run candidate code with write tokens or private
release secrets. Avoid pull_request_target and workflow_run execution of untrusted content.

An always-run aggregate check verifies that every expected job succeeded. Failed, skipped,
cancelled, absent or timed-out required jobs are not green. Include pull_request and merge_group
where a merge queue is used. Path filters must not leave the required aggregate missing.

Use repo-scaffold's settings auditor to compare the actual required check names with the workflows.
Changing the ruleset is a user-approved remote action. Verify private-repository plan support and
release App access; do not silently use an admin bypass if a feature is unavailable.

## Proving enforcement

Introduce harmless violations in disposable fixtures and assert nonzero results for the script,
rendered workflow and hook adapter. Include changed policy/checker attempts. Keep source fixtures
under tests, outside production duplication/coverage inputs for legitimate reasons only.

No tool can infer every architectural intent. State which checks are structural and which require
behavior tests or review. "All checks passed" must never mean "all possible bad code is impossible".
