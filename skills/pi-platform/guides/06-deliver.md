# 6. Deliver

1. Read the releases and Home Manager references. Inspect only the intended diff, generated files,
   provenance and check reports. Ensure no scratch logs, credentials or customer examples are staged.
2. Run release-plan for a proposal. Do not automatically tag, publish, merge or update the deployed
   system. Breaking changes and dependency propagation require explicit review.
3. Use git_pr with a Conventional Commit title and intent. Include the researched contracts,
   changed behavior, negative tests, full check result, migration/rollback and remaining limitations.
4. After git_pr, stop watching CI; its watcher owns CI fixes and reports. Do not start another
   helper that races its changes.
5. The owner merges feature and release PRs. A component tag is not proof the consumer is deployed.
   Explain the release and compatibility set the consumer must pin.
6. Run home-manager-plan against the actual configuration repo. Prepare integration in a separate
   git_start worktree/PR when requested. Update the source flake input/module, generated flake via
   its generator and lock through the repository workflow. Never edit an inferred flake path blindly.
7. For installing this skill through existing pi-skills, follow the currently exported
   programs.pi-skills module. Only after its release and consumer lock update does the installed
   skill change; the proposed programs.pi API is not already present on the host.

Result: PR link, what is verified, who merges/releases, the required consumer update and any deferred
activation. Never report a planned migration or unrun deployment as completed.
