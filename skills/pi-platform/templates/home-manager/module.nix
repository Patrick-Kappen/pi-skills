{ config, lib, ... }:
let
  cfg = config.programs.piPlatform;
in
{
  options.programs.piPlatform = {
    catalog = lib.mkOption {
      type = lib.types.attrsOf lib.types.str;
      default = { };
      description = "Read-only component catalog; values are package paths/identifiers, not activated state.";
    };
    stateJson = lib.mkOption {
      type = lib.types.str;
      readOnly = true;
      description = "Deterministic JSON composition consumed by user-managed configuration.";
    };
  };
  config.programs.piPlatform.stateJson = builtins.toJSON cfg.catalog;
}
