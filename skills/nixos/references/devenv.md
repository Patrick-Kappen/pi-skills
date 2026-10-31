# devenv

devenv gives a repository its own tools from nixpkgs: `devenv.nix` says what, `devenv.yaml` pins the
inputs, `devenv.lock` locks them. Changes to these files are changes to the repository: make them in
the worktree of the change, and mention them in the PR.

## Run in it

```sh
devenv shell -- <command>      # one command in the environment
devenv shell -- check          # a script defined in devenv.nix
devenv test                    # enterTest, when the repository defines it
```

The agent's shell does not load direnv, so always prefix with `devenv shell --`. The first run
builds the environment and can take minutes; later runs are fast.

## Add a package

Find the attribute (`../scripts/find-package.sh <command>` or `devenv search <name>`), then add it:

```nix
{ pkgs, ... }:
{
  packages = [
    pkgs.jq
    pkgs.openssl
    pkgs.pkg-config
  ];
}
```

Run `devenv shell -- <command>` again to check.

## Languages and services

Prefer the language module over loose packages: it sets the compiler, paths and tooling together.

| Need | `devenv.nix` |
|---|---|
| Python with a venv and uv | `languages.python = { enable = true; venv.enable = true; uv.enable = true; };` |
| Python wheels with native libraries | `languages.python.libraries = [ pkgs.zlib pkgs.stdenv.cc.cc.lib ];` |
| Node.js | `languages.javascript = { enable = true; npm.enable = true; };` |
| C / C++ compiler | `languages.c.enable = true;` / `languages.cplusplus.enable = true;` |
| Rust | `languages.rust.enable = true;` |
| Go | `languages.go.enable = true;` |
| PostgreSQL for tests | `services.postgres.enable = true;` (start with `devenv up`) |

Look up options you are not sure of with `devenv search <name>`; it lists options as well as
packages.

## A repository without a devenv

Ask the user first: a devenv adds files that every contributor gets. When they agree:

```sh
devenv init        # creates devenv.nix, devenv.yaml and .gitignore entries
```

Replace the example content of `devenv.nix` with what the repository needs (packages, languages,
scripts), run `devenv shell -- true`, and commit `devenv.nix`, `devenv.yaml` and `devenv.lock`.
For a full setup with hooks, linters and CI, the user can run `/repo-scaffold`; do not start it
yourself.

## Without consent for a devenv

Use `nix shell nixpkgs#<attr> -c <command>` for each command, and tell the user which packages the
repository needs, so they can decide.
