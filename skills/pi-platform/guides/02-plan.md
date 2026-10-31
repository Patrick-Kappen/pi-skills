# 2. Plan

1. Read the configuration, layout, quality and enforcement references.
2. Write one topic plan in the target's architecture/migration documentation. Include current and
   desired behavior, observed docs, resources, public/private boundaries, component graph, required
   checks, negative fixtures, state migration and rollback. Use synthetic identifiers in public docs.
3. Run plan-change against an explicit fetched base when changing an existing platform. A missing
   base, unknown component or shared/tooling change is not permission to test nothing.
4. Classify every step: deterministic script, agent judgment, or owner decision. Script repeated
   work. Preserve real dependencies; schedule only independent work concurrently. Assign each
   mutable path and generated artifact one writer.
5. Select profiles/groups before adding repo exceptions. Do not write a separate full configuration
   for fifty repositories. Define merge conflicts and permission floors before implementation.
6. Define approvals for repo creation, visibility/settings changes, state deletion, activation and
   releases. Ordinary approved source work uses a worktree and PR; it is not permission to deploy.
7. Show the plan, script dry-runs, behavior changes and missing enforcement. Get approval before
   generating a new repository or broad migration. Do not accept "CI passes" as proof a gate exists.

Result: an approved plan and measurable acceptance list. If scope is too large, deliver an ordered
series of independent topic PRs with contract gates between them.
