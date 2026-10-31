{
  description = "Pi platform monorepo";
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    home-manager = {
      url = "github:nix-community/home-manager/master";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };
  outputs =
    {
      nixpkgs,
      home-manager,
    }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
      hm = home-manager.lib.homeManagerConfiguration {
        inherit pkgs;
        modules = [
          ./home-manager/module.nix
          ./home-manager/examples/legacy-pi-rules.nix
          {
            home.username = "platform-check";
            home.homeDirectory = "/tmp/platform-check";
            home.stateVersion = "24.11";
            programs.piPlatform.catalog = {
              core = "packages/core";
            };
          }
        ];
      };
    in
    {
      homeManagerModules.pi-platform = import ./home-manager/module.nix;
      checks.${system}.home-manager-module = hm.activationPackage;
      formatter.${system} = pkgs.nixfmt-rfc-style;
    };
}
