# The repo-skills extension: only the files pi loads, no tests.
{
  lib,
  stdenvNoCC,
  version,
}:
let
  src = ../extensions/repo-skills;
in
stdenvNoCC.mkDerivation {
  pname = "pi-repo-skills";
  inherit version;

  src = lib.fileset.toSource {
    root = src;
    fileset = lib.fileset.unions [
      (lib.fileset.fileFilter (file: file.hasExt "ts" && !lib.hasSuffix ".test.ts" file.name) src)
      (src + "/README.md")
    ];
  };

  dontConfigure = true;
  dontBuild = true;

  installPhase = ''
    runHook preInstall
    mkdir -p $out
    cp -r . $out/
    runHook postInstall
  '';

  meta = {
    description = "Pi extension that loads skills only in the repositories you list";
    homepage = "https://github.com/Patrick-Kappen/pi-skills";
    license = lib.licenses.mit;
    platforms = lib.platforms.all;
  };
}
