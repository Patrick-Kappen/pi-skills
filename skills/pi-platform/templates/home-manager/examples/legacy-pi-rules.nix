{ ... }:
{
  # Illustrative read-only catalog entry for the legacy scope. It does not change the current host,
  # activate a profile, grant runtime permissions, or resolve user-specific scope policy.
  programs.pi.catalog."pi-rules" = "packages/core";
}
