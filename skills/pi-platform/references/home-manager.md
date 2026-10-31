# Home Manager integration

## Discover before editing

Run home-manager-plan with both the actual configuration checkout and the platform checkout.
Inspect its report and read the source modules it finds. It does not activate or edit anything.

Locate:

- The actual flake input declarations, including flake-file/flake-parts generators.
- The Home Manager import tree and enabled host/user profiles.
- The installed Pi package, overrides and agent directory.
- Existing pi-* modules and their generated files.
- Persistence, services, watcher environment and runtime secret references.

In the currently researched consumer, Pi modules are under packages/agents/pi/, with topic
subdirectories; skill selection is under packages/agents/pi/skills/default.nix. Inputs can be
declared in those modules or under inputs/, and flake.nix may be generated. These are discovery
hints, not universal destinations. A clone directory name is not necessarily its remote name.

## Target public/private composition

The public flake exports homeModules.default and separately installable packages. The private
flake extends the same catalog/options and follows the public input:

```nix
inputs.pi.url = "github:example/pi/<approved-ref>";
inputs.pi-private = {
  url = "github:example/pi-private/<approved-ref>";
  inputs.pi.follows = "pi";
};
```

Use real approved repository names and refs; the example is not executable provisioning.

The user imports both modules and normal local Nix fragments. Importing a resource does not enable
it. Home Manager produces canonical JSON and the required package/service definitions. Runtime
modules read that generated config; they do not own another permanent mutable config file.

Keep model names, repository groups, private endpoints and paths in the consumer. Keep reusable
option types, schema and defaults in the platform. Keep secrets outside the Nix store.

## Adding one option

1. Identify its owning component and whether it is global/group/folder/repo/file/role scoped.
2. Extend the canonical schema and supported scope table.
3. Add the Nix option/type/default/documentation and runtime validation.
4. Add generation, invalid-value, precedence and provenance tests.
5. For lifecycle/state options, test reload, shutdown and recovery.
6. Add a consumer exception only if a shared profile/group does not express the intent.

Do not invent a file scope for an operation that has no file target. Do not expose a raw free-form
option as if arbitrary fields were fully validated and enforced.

## Consumer update

Work in a separate git_start worktree and PR. Update the source input, run the repository's flake
generator if present, update its lock and inspect the pin diff. Evaluate the selected Home Manager
user/host and generated JSON. Build relevant checks through git_check.

Test public alone, private alone with its required public import, both together, unknown resource,
scope conflict and disabled feature. Ensure old extension symlinks/package entries are removed only
when the replacement is ready, avoiding duplicate tool names.

Never run nixos-rebuild switch or home-manager switch unless deployment was explicitly authorized.
Do not edit files under the installed agent directory as a permanent fix.

## Installing this skill before the platform exists

Use the currently exported programs.pi-skills module, not the proposed programs.pi namespace.
After its release, select pi-platform where needed through skills.pi-platform.repos in the
consumer's existing skill configuration, update the pi-skills lock and follow its deployment
workflow. The skill remains manual-only even where it is available.

Check the current module defaults: some releases expose all bundled skills by default. Avoid
duplicating an already implied selection; an explicit scope can still narrow availability.
