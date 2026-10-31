{
  self,
  pkgs,
  home-manager,
}:
let
  packages = self.packages.${pkgs.stdenv.hostPlatform.system};
  hmConfig =
    {
      skills,
      semantic ? null,
    }:
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
            inherit skills semantic;
          };
        }
      ];
    };
  hm = hmConfig {
    skills = {
      repo-scaffold.repos = [ "Patrick-Kappen/*" ];
      # The other skills of this flake load everywhere by default; this one is turned off.
      skill-review.enable = false;
      # A skill from elsewhere, by path, with triggers.
      extra = {
        path = ../test/nix/extra-skill;
        repos = [ "*" ];
        triggers.errors = [ "command not found" ];
      };
    };
    semantic.url = "http://localhost:8097";
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
          '.skills."repo-scaffold" == { path: $path, repos: ["Patrick-Kappen/*"], triggers: { paths: [], extensions: [], errors: [] } }' \
          "$homeFiles/$agent/repo-skills.json"
        jq -e '.skills.git.repos == ["*"] and (.skills | has("test-speed")) and (.skills | has("skill-review") | not)' \
          "$homeFiles/$agent/repo-skills.json"
        jq -e '.skills.extra.triggers.errors == ["command not found"] and .semantic.url == "http://localhost:8097" and .semantic.load == 0.9' \
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
      !(builtins.tryEval (hmConfig { skills.unknown.repos = [ "*" ]; }).activationPackage.drvPath)
      .success;
    pkgs.emptyFile;
}
