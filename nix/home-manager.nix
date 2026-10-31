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

  triggerOptions = {
    paths = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [ ];
      example = [
        "*.nix"
        "infra/**"
      ];
      description = ''
        Globs of files that load the skill: before the agent edits or writes a matching file, and
        when it reads one. Relative globs start at the repository root (or the working directory
        outside git); a glob without `/` matches the file name anywhere; `/` and `~/` globs are
        absolute.
      '';
    };
    extensions = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [ ];
      example = [ ".tf" ];
      description = "File extensions that load the skill, like `paths`.";
    };
    errors = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [ ];
      example = [
        "command not found"
        "error while loading shared libraries"
      ];
      description = ''
        Regular expressions (case-insensitive). When the output of a tool such as bash matches one,
        the skill is added to that tool result.
      '';
    };
  };

  skillModule =
    { name, ... }:
    {
      options = {
        enable = lib.mkOption {
          type = lib.types.bool;
          default = true;
          description = "Whether the skill loads at all. Set it to false to turn off a skill of this flake.";
        };
        path = lib.mkOption {
          type = lib.types.either lib.types.path lib.types.str;
          default = "${cfg.skillsPackage}/${name}";
          defaultText = lib.literalExpression ''"${config.programs.pi-skills.skillsPackage}/<name>"'';
          description = ''
            Directory of the skill, with its SKILL.md. Defaults to the skill of that name in this
            flake; set it for a skill from elsewhere (a store path or an absolute path).
          '';
        };
        repos = lib.mkOption {
          type = lib.types.nonEmptyListOf lib.types.str;
          default = [ "*" ];
          example = [
            "my-org/infra"
            "my-org/*"
            "~/src/project"
            "*"
          ];
          description = ''
            Where the skill loads; everywhere by default. An entry is either

            - `*`: everywhere, also outside git repositories;
            - a remote: `owner/repo`, `host/owner/repo` or with `*` (`owner/*`). It matches when any
              remote of the repository ends with it, so it works in every clone and every worktree;
            - a path starting with `/` or `~/`: it matches that directory and everything below it.
              Worktrees elsewhere match through the location of their main checkout.
          '';
        };
        triggers = triggerOptions;
        subskills = lib.mkOption {
          type = lib.types.attrsOf (lib.types.submodule { options.triggers = triggerOptions; });
          default = { };
          example = lib.literalExpression ''{ storage.triggers.paths = [ "infra/storage/**" ]; }'';
          description = ''
            Triggers of the sub-skills, by folder name. A sub-skill is a folder inside the skill with
            its own SKILL.md (for example `skills/storage/SKILL.md`). pi does not list sub-skills to
            the model; repo-skills loads them when a prompt scores high or a trigger matches.
          '';
        };
      };
    };

  semanticModule = {
    options = {
      url = lib.mkOption {
        type = lib.types.str;
        example = "http://localhost:8097";
        description = "OpenAI-compatible server with `/v1/embeddings` and `/v1/rerank`, such as llama-swap with llama.cpp.";
      };
      embedModel = lib.mkOption {
        type = lib.types.str;
        default = "qwen3-embedding-0.6b";
        description = "Embedding model; narrows the skills and parts down to `candidates`.";
      };
      rerankModel = lib.mkOption {
        type = lib.types.str;
        default = "qwen3-reranker-4b";
        description = "Rerank model; its score decides.";
      };
      load = lib.mkOption {
        type = lib.types.numbers.between 0 1;
        default = 0.9;
        description = "Score from which the skill is put into the prompt, in the format of `/skill:name`.";
      };
      hint = lib.mkOption {
        type = lib.types.numbers.between 0 1;
        default = 0.5;
        description = "Score from which the agent gets a note that the skill probably applies.";
      };
      part = lib.mkOption {
        type = lib.types.numbers.between 0 1;
        default = 0.8;
        description = "Score from which a guide or reference of the skill is added with it.";
      };
      maxParts = lib.mkOption {
        type = lib.types.ints.unsigned;
        default = 2;
        description = "At most this many parts are added.";
      };
      candidates = lib.mkOption {
        type = lib.types.ints.unsigned;
        default = 8;
        description = "How many skills or parts the embedding step passes to the reranker; 0 reranks all.";
      };
      timeoutMs = lib.mkOption {
        type = lib.types.ints.unsigned;
        default = 3000;
        description = "Time limit per prompt; after it the prompt goes on without skills.";
      };
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

    semantic = lib.mkOption {
      type = lib.types.nullOr (lib.types.submodule semanticModule);
      default = null;
      example = lib.literalExpression ''{ url = "http://localhost:8097"; }'';
      description = ''
        Score every prompt against the loaded skills and load the best one before the model answers.
        Without it, only the `triggers` of the skills load them.
      '';
    };

    skills = lib.mkOption {
      type = lib.types.attrsOf (lib.types.submodule skillModule);
      default = { };
      example = lib.literalExpression ''
        {
          repo-scaffold.enable = false;
          terraform.repos = [ "my-org/infra" "my-org/*" ];
          my-own = {
            path = ./skills/my-own;
            repos = [ "~/src/project" ];
          };
        }
      '';
      description = ''
        Skills by name, and where each loads. Every skill of this flake
        (${lib.concatStringsSep ", " ownSkills}) is here by default and loads everywhere; set
        `repos` to limit it, or `enable = false` to turn it off. A skill from elsewhere needs `path`.
      '';
    };
  };

  config = lib.mkIf cfg.enable {
    # Every skill of this flake, with the defaults above: everywhere, unless configured otherwise.
    programs.pi-skills.skills = lib.genAttrs ownSkills (_: { });

    assertions = lib.mapAttrsToList (name: skill: {
      assertion = skill.path != "${cfg.skillsPackage}/${name}" || builtins.elem name ownSkills;
      message = "programs.pi-skills.skills.${name}: not a skill of pi-skills (${lib.concatStringsSep ", " ownSkills}); set `path`.";
    }) cfg.skills;

    home.file = {
      "${cfg.agentDir}/extensions/repo-skills".source = cfg.package;
      "${cfg.agentDir}/repo-skills.json".source = json.generate "repo-skills.json" (
        {
          skills = lib.mapAttrs (_: skill: {
            # A Nix path goes to the store; a string stays as it is.
            path = "${skill.path}";
            inherit (skill) repos triggers subskills;
          }) (lib.filterAttrs (_: skill: skill.enable) cfg.skills);
        }
        // lib.optionalAttrs (cfg.semantic != null) { inherit (cfg) semantic; }
      );
    };
  };
}
