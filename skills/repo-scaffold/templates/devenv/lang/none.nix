# No language toolchain: only the common checks of devenv.nix.
{
  scripts = {
    lint-language.exec = "true";
    typecheck.exec = "true";
    unit.exec = "true";
    test-all.exec = "true";
    security-language.exec = "true";
  };
}
