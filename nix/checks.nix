{
  self,
  pkgs,
  home-manager,
}:
let
  packages = self.packages.${pkgs.stdenv.hostPlatform.system};
  hmConfig =
    skills:
    home-manager.lib.homeManagerConfiguration {
      inherit pkgs;
      modules = [
        self.homeModules.default
        {
          home = {
            username = "check";
            homeDirectory = "/home/check";
            stateVersion = "25.11";
          };
          programs.pi-skills = {
            enable = true;
            inherit skills;
          };
        }
      ];
    };
  hm = hmConfig {
    repo-scaffold.repos = [ "Patrick-Kappen/*" ];
    # A skill from elsewhere, by path.
    extra = {
      path = ../test/nix/extra-skill;
      repos = [ "*" ];
    };
  };
in
{
  inherit (packages) repo-skills skills;

  # Builds a Home Manager configuration with the module and loads the generated files with node.
  home-manager =
    pkgs.runCommand "home-manager-check"
      {
        nativeBuildInputs = [
          pkgs.nodejs_24
          pkgs.git
          pkgs.jq
        ];
        homeFiles = hm.config.home-files;
        smoke = ../test/nix/home-manager-smoke.ts;
      }
      ''
        export HOME=$TMPDIR
        agent=.pi/agent
        test -f "$homeFiles/$agent/extensions/repo-skills/index.ts"
        test ! -e "$homeFiles/$agent/extensions/repo-skills/index.test.ts"
        jq -e --arg path "${packages.skills}/repo-scaffold" \
          '.skills."repo-scaffold" == { path: $path, repos: ["Patrick-Kappen/*"] }' \
          "$homeFiles/$agent/repo-skills.json"
        test -f "$(jq -r '.skills."repo-scaffold".path' "$homeFiles/$agent/repo-skills.json")/SKILL.md"
        test -f "$(jq -r .skills.extra.path "$homeFiles/$agent/repo-skills.json")/SKILL.md"
        cp "$smoke" smoke.ts
        node smoke.ts "$homeFiles" "$agent"
        touch $out
      '';

  # A skill that is not in this flake and has no path fails the evaluation.
  home-manager-assertion =
    assert
      !(builtins.tryEval (hmConfig { unknown.repos = [ "*" ]; }).activationPackage.drvPath).success;
    pkgs.emptyFile;
}
