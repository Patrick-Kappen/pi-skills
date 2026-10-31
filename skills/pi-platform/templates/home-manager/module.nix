{ config, lib, ... }:
let
  cfg = config.programs.pi;
in
{
  options.programs.pi = {
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
  config.programs.pi.stateJson = builtins.toJSON cfg.catalog;
}
