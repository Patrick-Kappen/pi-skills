# 1. Discover

1. Read the architecture reference. Choose one route: bootstrap, migrate one topic, refactor one
   contract, add a feature, or audit a zerodawn feature for later adoption. Do not combine unrelated
   routes in one PR.
2. Locate the explicit source roots and the NixOS consumer by their origins, not only directory
   names. Use git_status for work already in progress. Compare local HEAD, known remote branch,
   release pins and installed store links; label stale or unverified observations.
3. Run the inventory script for each approved root. Inspect names and manifests, not credentials,
   customer content or all historical session transcripts. Keep private inventories outside public
   changes. Read the source files and documentation the report points to.
4. Read the installed Pi documentation for packages, extensions, skills and configuration; follow
   the relevant SDK, lifecycle, MCP, CLI or TUI references before using those APIs. Read small
   maintained examples. Record source revision and the contract actually used.
5. Trace each behavior from configuration to loader to operation to state/notification. Record who
   owns repository matching, resource resolution, permissions, job lifecycle and release state.
   Distinguish explicit imports, filesystem coupling, events, environment variables and services.
6. Inspect the existing repo-scaffold and test-speed scripts before reusing them. Query help/current
   package docs instead of guessing flags or Nix package names.
7. Collect missing decisions in one question: scope, public/private ownership, new repo names,
   runtime target, approvals and acceptance behavior. Do not ask questions answered by source.

Result: an evidence table with source/revision, observed contract, proposed owner, integration point,
tests, migration risk and unresolved questions. No implementation until this exists.
