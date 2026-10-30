# Home Manager module: installs the repo-skills extension and writes which skill loads where.
{ self }:
{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.programs.pi-skills;
  json = pkgs.formats.json { };
  ownSkills = builtins.attrNames (
    lib.filterAttrs (_: type: type == "directory") (builtins.readDir ../skills)
  );

  skillModule =
    { name, ... }:
    {
      options.path = lib.mkOption {
        type = lib.types.either lib.types.path lib.types.str;
        default = "${cfg.skillsPackage}/${name}";
        defaultText = lib.literalExpression ''"${config.programs.pi-skills.skillsPackage}/<name>"'';
        description = ''
          Directory of the skill, with its SKILL.md. Defaults to the skill of that name in this
          flake; set it for a skill from elsewhere (a store path or an absolute path).
        '';
      };
      options.repos = lib.mkOption {
        type = lib.types.nonEmptyListOf lib.types.str;
        example = [
          "my-org/infra"
          "my-org/*"
          "~/src/project"
          "*"
        ];
        description = ''
          Where the skill loads. An entry is either

          - `*`: everywhere, also outside git repositories;
          - a remote: `owner/repo`, `host/owner/repo` or with `*` (`owner/*`). It matches when any
            remote of the repository ends with it, so it works in every clone and every worktree;
          - a path starting with `/` or `~/`: it matches that directory and everything below it.
            Worktrees elsewhere match through the location of their main checkout.
        '';
      };
    };
in
{
  options.programs.pi-skills = {
    enable = lib.mkEnableOption "the pi repo-skills extension, which loads skills only in listed repositories";

    package = lib.mkOption {
      type = lib.types.package;
      default = self.packages.${pkgs.stdenv.hostPlatform.system}.repo-skills;
      defaultText = lib.literalExpression "pi-skills.packages.\${system}.repo-skills";
      description = "The repo-skills extension package.";
    };

    skillsPackage = lib.mkOption {
      type = lib.types.package;
      default = self.packages.${pkgs.stdenv.hostPlatform.system}.skills;
      defaultText = lib.literalExpression "pi-skills.packages.\${system}.skills";
      description = "The package with the skills of this flake, one directory per skill.";
    };

    agentDir = lib.mkOption {
      type = lib.types.str;
      default = ".pi/agent";
      description = "pi's agent directory relative to the home directory. Change it together with `PI_CODING_AGENT_DIR`.";
    };

    skills = lib.mkOption {
      type = lib.types.attrsOf (lib.types.submodule skillModule);
      default = { };
      example = lib.literalExpression ''
        {
          repo-scaffold.repos = [ "*" ];
          terraform.repos = [ "my-org/infra" "my-org/*" ];
          my-own = {
            path = ./skills/my-own;
            repos = [ "~/src/project" ];
          };
        }
      '';
      description = ''
        Skills by name, and where each loads. A skill that is not listed loads nowhere. Without
        `path`, the name must be a skill of this flake: ${lib.concatStringsSep ", " ownSkills}.
      '';
    };
  };

  config = lib.mkIf cfg.enable {
    assertions = lib.mapAttrsToList (name: skill: {
      assertion = skill.path != "${cfg.skillsPackage}/${name}" || builtins.elem name ownSkills;
      message = "programs.pi-skills.skills.${name}: not a skill of pi-skills (${lib.concatStringsSep ", " ownSkills}); set `path`.";
    }) cfg.skills;

    home.file = {
      "${cfg.agentDir}/extensions/repo-skills".source = cfg.package;
      "${cfg.agentDir}/repo-skills.json".source = json.generate "repo-skills.json" {
        skills = lib.mapAttrs (_: skill: {
          # A Nix path goes to the store; a string stays as it is.
          path = "${skill.path}";
          inherit (skill) repos;
        }) cfg.skills;
      };
    };
  };
}
