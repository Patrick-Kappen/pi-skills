# Component releases

## Units

Each component has a version, changelog, public API and declared dependencies. Tags identify the
component, for example core-v1.2.0 and git-v0.10.0. The root source snapshot remains the tested
installation unit; the consumer's flake.lock pins its commit.

Use one maintained release-please manifest/workflow for the monorepo rather than a copied workflow
per package. Configure package paths and component names explicitly, and verify tag naming against
the pinned release tool. Private packages release in the private repo against declared public
compatibility.

## Flow

1. Merge approved topic PRs through the owner's normal process.
2. CI/release-please prepares a release PR with component version/changelog changes.
3. Run unit/contracts/integration, policy and package/module checks on that release PR.
4. The owner merges the release PR; the authorized workflow creates tags/releases.
5. Verify release artifacts and the compatible component set.
6. Open a separate consumer pin/update PR; evaluate the actual Home Manager configuration.
7. Activate only through the owner's explicitly approved deployment workflow.

Agents and release-plan never merge, tag or publish. Do not run gh release create as a shortcut.
A skill's bootstrap is not approval to create every future repository or release.

## Release planning

release-plan proposes changes from the explicit base and component impact. Conventional Commits
supply evidence; ambiguous or breaking effects require review. A public API break can require
consumer bumps even when consumers' files are unchanged.

Do not guess a safe version from file counts. Treat the script as a proposal, not an independent
release authority. Confirm dependency range updates, runtime compatibility and migration steps.

The private repo must not force public CI to fetch private sources. Test public compatibility with
synthetic resources; verify real private composition in private CI.

## Delivery prerequisites

- Use the existing release App/token workflow so release PRs actually get CI.
- The user provisions secrets; never print or copy private keys through the model.
- Workflow permissions are minimal and actions pinned.
- Required checks protect feature and release PRs alike.
- No unrelated source commits or uncommitted state are swept into a release.
- Release failures preserve diagnostics and notify; they are not retried indefinitely.

## This skill's own release

This skill is initially delivered by pi-skills, with a Conventional Commit scoped to pi-platform.
The owner merges its PR and release PR. The skill is installed only after the consumer updates the
pi-skills pin and activates its configuration. Do not change pi-skills' whole release scheme just
to introduce the skill.
