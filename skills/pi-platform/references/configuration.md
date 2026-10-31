# Configuration contract

These examples describe the target API. Inspect the exported module before configuring a real
installation; the current programs.pi-skills and other legacy modules are not this API.

## One namespace, ordinary Nix modules

```nix
{
  imports = [
    inputs.pi.homeModules.default
    inputs.pi-private.homeModules.default
    ./pi/global.nix
    ./pi/work.nix
    ./pi/exceptions.nix
  ];

  programs.pi.enable = true;
}
```

Global values define the usual behavior:

```nix
programs.pi.global = {
  profiles = [ "development" ];
  mcp.context7.enable = true;
};
```

Profiles contain reusable settings, not repository selectors:

```nix
programs.pi.profiles = {
  development = {
    skills.git.enable = true;
    rules.conventional-commits.enable = true;
    git.enable = true;
  };
  azure-development = {
    extends = [ "development" ];
    skills.azure.enable = true;
    mcp.azure = { enable = true; mode = "read"; };
    files.bicep = {
      match = [ "**/*.bicep" ];
      skills.bicep.enable = true;
      rules.bicep.enable = true;
    };
  };
};
```

Groups select many repositories; entries are alternatives (folder OR remote):

```nix
programs.pi.groups = {
  work = {
    match.folders = [ "~/work" ];
    profiles = [ "work-baseline" ];
  };
  infrastructure = {
    match.remotes = [ "github.com/example/infra-*" "github.com/example/platform" ];
    profiles = [ "azure-development" ];
  };
};
```

Exceptions state only the difference:

```nix
programs.pi.repos."github.com/example/legacy".mcp.azure.enable = false;
programs.pi.repos."github.com/example/platform".orchestrator.enable = true;
programs.pi.folders."~/work/experiments".skills.experimental.enable = true;
```

The example resources must actually be registered. Unknown names are errors, not ignored typos.

## Deterministic resolution

| Layer | Ordering |
|---|---|
| Defaults | Schema-defined defaults, with origin |
| Global | Expanded profiles, then explicit global settings |
| Groups | All matches; numeric priority, then conflict check |
| Folders | Broad to nested; explain actual/main-checkout path matching |
| Repository | Exact normalized host/owner/repo; reject ambiguous shortcuts |
| Files | Explicit pattern scopes and priorities, no guessed glob specificity |

Missing means inherit. false is an explicit disable. Named resources merge by ID. Ordinary lists
replace unless the field explicitly defines append semantics. Conflicting values at equal priority
fail unless an explicit higher-layer value resolves the conflict.

Profile extension is a directed acyclic graph. Two profiles setting conflicting equal-priority
values require an explicit scope value or priority. Import order and alphabetical sorting must not
silently decide behavior. Keep expansion bounded and reject cycles.

Normalize Git SSH/HTTPS URLs and worktrees centrally. A hostless shortcut is usable only when it is
unambiguous in the selected context; show the resolved host in explanations. Do not send remotes
with embedded credentials to logs.

## File scope

File patterns in a repository are relative to its worktree root. Outside Git require a folder base.
Resolve actual target paths, including symlinks and alternate tool arguments, for permission checks.
A multi-file action needs authorization for every target.

Instructions and skills are context, not authorization. A previous read cannot unlock an unrelated
write or a remote operation. Reject unsupported file-scoped lifecycle/server settings rather than
pretending a remote API is confined to a file.

## Hard policy and temporary choices

A scope may override preferences. It cannot lower a hard deny floor unless a separate, explicitly
approved exception mechanism allows it. Child roles intersect with project permissions.

UI mode changes and session exceptions are temporary, separate from generated JSON and visible in
status. Never rewrite Nix-managed configuration from the runtime. A permanent change is a source PR.

## Explainability

For each value retain resource ID, schema version, source module/scope/profile, priority, matched
selector, inherited value and final override. Do not pretend to have a source line if Nix evaluation
did not retain it; a module/option path is still useful provenance.

The future /pi status and /pi explain interfaces must distinguish configured, installed, loaded and
temporarily overridden. A config fingerprint records which effective configuration a run used.

Test the public/private catalog, nested folders, same-priority conflict, missing resource, worktree,
multi-file permissions, session override limits and fifty synthetic repository selections.
