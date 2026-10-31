# 5. Verify

1. Read the quality and enforcement references. Execute the generated check entrypoint through
   git_check; use affected checks during editing and the full required DAG before delivery.
2. Prove the gates fail: broken type, dead export, duplicated production block, forbidden import,
   dependency cycle, missing test, reduced coverage, malformed scope, secret fixture and failing
   child command. Use harmless synthetic fixtures, never an actual credential.
3. Prove scheduler behavior: independent tasks overlap, dependency order is respected, output is
   isolated, failed prerequisites block dependants and a blocked/skipped/cancelled required check
   makes the aggregate red. Test timeout and cancellation of descendants.
4. Prove background lifecycle: early parent exit, completion notification, notifier failure,
   cancellation, stale record, interrupted supervisor and unrelated PID. A created task ID alone
   does not prove the notification path works.
5. Instantiate and test the scaffold in a disposable worktree. Parse manifests/workflows and run
   their real tools. Evaluate public and private Home Manager composition with fake resources;
   check its generated config and option assertions. No activation on the user's host.
6. Compare the old and new effective configuration for representative cases: outside Git, main
   checkout, worktree, folder overlap, repo exception, file exception and read-only reviewer.
   Include fifty synthetic repositories to prove grouping does not require fifty copies.
7. Measure changed-check selection against the full suite. Shared/tooling/schema changes must
   include consumers; an unknown selection falls back to full checks, not an empty success.
8. Inspect CI trust separately: required aggregate is configured, runs on every relevant PR/queue
   event, and cannot be made green by changing only the candidate policy or dropping a job.
9. Record commands, tool versions, reports and limitations. Missing tools/network/auth are failures
   or explicit incomplete verification, never "passed". Do not run paid model tests in normal CI.

Result: evidence of both correct behavior and actual rejection of violations. Review is still
required for semantics, privacy and architectural choices that tools cannot prove.
