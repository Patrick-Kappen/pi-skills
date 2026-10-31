# Platform architecture

## Status and scope

This is the target design, not a claim that the runtime already implements it. The skill delivers
workflow automation, templates and enforceable checks to build it topic by topic. A generated
Home Manager module is a starting contract; prove scope resolution before enabling it in production.

Consolidate the pi-* implementations into one public monorepo and one private companion. Keep
zerodawn-pi and zerodawn-pi-private outside the initial migration. Later audit their useful
behaviors separately, with source/license review and topic-specific acceptance tests.

## Goals

- One configuration model, not one enormous configuration file.
- Separately versioned topic packages with a reproducible tested installation.
- No duplicated repository matching, loaders, policy parsers or agent resource resolution.
- Defaults, profiles and groups cover many repositories; exceptions describe only differences.
- Explain every effective value, matched scope, provider and loaded component.
- Deterministic work lives in tested scripts; agents own research and judgment.
- Independent checks run in parallel; supervision delivers status without agent polling.
- Hard measurable prohibitions block CI and protected merges.

## Ownership

| Package | Owns |
|---|---|
| core | Canonical schema, validation, repository identity, scope resolver, resource catalog, provenance |
| rules | Instructions, permissions, hooks and their runtime adapters |
| skills | Skill selection, triggers and semantic routing |
| mcp | Server registration, lifecycle and explicit access modes |
| git | Worktree/commit/PR workflow, locks, helpers, watcher and existing delivery behavior |
| orchestrator | Tasks, agent roles, gates, reviews and handoff |
| azure | Azure-specific workflows and domain resources |
| tweaks | Small optional behaviors through declared hooks |

Core does not import domain packages. Packages depend on declared public interfaces, not sibling
source paths or another extension's JSON file. Share only cohesive, independently tested helpers.
Necessary dependencies stay explicit and pinned; do not reimplement mature tooling to claim zero
dependencies.

## Public and private composition

The private companion adds catalog entries, packages and profiles through the same public API.
It follows the consumer's public input so the installation has one compatible core. Importing its
Home Manager module makes resources available, not active.

Keep private resource names namespaced. Duplicate identifiers fail unless the owner explicitly
declares a supported replacement. Public CI uses synthetic fixtures and never needs private source
or credentials. Private CI tests the integration separately.

Private is not secret: Nix store contents can be readable by other local users. Secrets are runtime
file/environment references from the existing secret manager, never literal generated JSON.

## Configuration chain

User Nix modules -> validated canonical JSON -> core's runtime scope resolution -> module settings.

Home Manager is the source for Nix installations. JSON is generated output, not a competing editable
source. A non-Nix installation may use the same JSON format directly. Modules cannot silently
persist overrides to that generated file.

Temporary UI changes are separate session overrides, explicitly labeled and limited by hard policy.
A permanent change belongs in the declarative source, through a worktree and PR.

The target Home Manager namespace is programs.pi. Import both public and private modules once.
Split user configuration into normal Nix imports by profile, team or topic. Fifty repositories
sharing behavior should require one group plus a few explicit exceptions, not fifty copies.

## Scopes

Resolution order: module defaults -> global -> groups -> folders -> exact repository -> files.
Within a scope, inherited profiles apply before explicit values. See the configuration reference
for merging, ties, files and permissions; module implementations must not invent their own order.

Repository identity normalizes SSH/HTTPS and handles linked worktrees. Folder matching can use
the actual path or the main checkout; the explanation identifies which matched. Avoid implicit
symlink escapes and confusing different hosts with the same owner/repo slug.

File scopes support instructions, skills, relevant hooks and concrete path permissions. They do
not turn a global remote API call into a file-confined operation. MCP permission checks use the
actual operation and target. Starting an orchestrator because a file was read is not a default.

## Agent execution

All agent launchers share resource resolution, process lifecycle and observation contracts.
Workflows still own their role semantics. Resolve a child from project settings, named agent profile
and role restrictions, not the entire interactive user's ambient extension set.

Roles declare model, thinking, tools, skills, rules, provider requirements, MCP permissions, limits
and logs. A reviewer can narrow rights; it cannot expand the project's hard policy.

For user-requested normal Pi workers, preserve configured extensions unless the user explicitly
chooses isolation. Do not silently convert an interactive tmux request into --no-extensions or
print/RPC mode. Separate this from role-specific production agent profiles.

## State and audit

| Information | Owner and storage |
|---|---|
| Configuration | User's declarative Home Manager sources |
| Architecture decisions | Versioned docs/decisions in the relevant repo |
| Project plans/tasks | Explicit project store, with export/backup policy |
| Durable execution state | XDG state root, separate subdirectory per module |
| Locks/sockets | XDG runtime root; not durable |
| Conversation | Pi's own session store |
| Reports/logs | Per-run private directory with retention policy |

Use common project/task/session/run IDs. Record component versions, configuration fingerprint, role,
model and outcome. Redact before saving; default logs must not contain credential payloads. A task
failure and a delivery failure are distinct states.

Do not force every module to mutate one global state file. Use atomic writes, recovery rules,
idempotency and safe cancellation. A process ID alone is not sufficient identity for cancellation.

## Releases and compatibility

Each package has its version, changelog and tag. The default installation is one tested source
snapshot pinned by flake.lock. Separate versions are not permission to assemble arbitrary versions
of core and consumers without compatibility checks.

The private repo releases independently against declared public compatibility. Keep lock updates,
NixOS consumer PRs and host activation separate from component release calculation.

## Migration sequence

1. Inventory checkout/release/install/config/state and record contracts.
2. Preserve relevant history and private boundaries while establishing monorepo layout.
3. Add shared repo identity and resource/config infrastructure with contract tests.
4. Add one Home Manager entrypoint; temporary adapters may generate old formats.
5. Migrate one topic and its consumers; remove the replaced duplicate.
6. Compare effective old/new configuration before switching the consumer.
7. Migrate durable state with backups, dry-run and rollback.
8. Adopt useful zerodawn behaviors or new features as separately reviewed topic changes.

Do not activate old and new implementations of the same tool simultaneously. No mass rewrite,
history loss, data deletion or deployment hidden inside a scaffold script.

## Acceptance

Test global-only, overlapping groups, nested folders, exact overrides, file overrides, worktrees,
outside-Git directories, private catalogs and restrictive reviewers. Include fifty synthetic repos.
Every effective value must have an origin; ambiguous conflicting matches must fail.

Prove independent checks overlap, dependencies are respected, failures propagate and callbacks
survive the initiating shell ending. Validate generated templates, not only their source text.

A passing inventory is not proof docs were read. A passing structural gate is not proof all behavior
is safe. Review semantics, privacy and external-service permissions separately.
