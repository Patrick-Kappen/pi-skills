{
  description = "pi agent skills in a Nix flake, loaded per repository by the repo-skills extension";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    # Only for the checks; consumers set `inputs.home-manager.follows`.
    home-manager = {
      url = "github:nix-community/home-manager";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    {
      self,
      nixpkgs,
      home-manager,
    }:
    let
      inherit (nixpkgs) lib;
      inherit (builtins.fromJSON (builtins.readFile ./package.json)) version;
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forAllSystems = f: lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      packages = forAllSystems (pkgs: rec {
        # The extension that loads the skills.
        repo-skills = pkgs.callPackage ./nix/package.nix { inherit version; };
        # The skills of skills/<name>/.
        skills = pkgs.callPackage ./nix/skills.nix { inherit version; };
        default = repo-skills;
      });

      homeModules = rec {
        pi-skills = import ./nix/home-manager.nix { inherit self; };
        default = pi-skills;
      };

      # treefmt, so `nix fmt -- --fail-on-change FILES` works (the owner's global pre-commit hook uses it).
      formatter = forAllSystems (
        pkgs:
        pkgs.nixfmt-tree.override {
          # Templates of skills, with @PLACEHOLDERS@: not Nix code of this repository.
          settings.global.excludes = [ "skills/*/templates/**" ];
        }
      );

      checks = forAllSystems (
        pkgs:
        import ./nix/checks.nix { inherit self pkgs home-manager; }
        // {
          formatting = pkgs.runCommand "formatting" { nativeBuildInputs = [ pkgs.nixfmt ]; } ''
            cd ${self}
            nixfmt --check $(find . -name '*.nix' -not -path './.devenv/*' -not -path './skills/*/templates/*')
            touch $out
          '';
        }
      );
    };
}
