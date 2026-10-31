# The skills of skills/<name>/, one directory per skill.
{
  lib,
  stdenvNoCC,
  version,
}:
stdenvNoCC.mkDerivation {
  pname = "pi-skills";
  inherit version;

  src = lib.fileset.toSource {
    root = ../skills;
    fileset = ../skills;
  };

  dontConfigure = true;
  dontBuild = true;
  # Keep the scripts and templates exactly as they are in git.
  dontPatchShebangs = true;
  dontFixup = true;

  installPhase = ''
    runHook preInstall
    mkdir -p $out
    cp -r . $out/
    runHook postInstall
  '';

  meta = {
    description = "pi agent skills, loaded per repository by the repo-skills extension";
    homepage = "https://github.com/Patrick-Kappen/pi-skills";
    license = lib.licenses.mit;
    platforms = lib.platforms.all;
  };
}
