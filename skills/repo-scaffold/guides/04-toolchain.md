# 4. Toolchain

1. Run `<skill>/scripts/toolchain.sh <repo>`. It does the following:
   - builds the devenv environment and writes `devenv.lock`;
   - typescript: installs the newest TypeScript, Vitest, knip and `@types/node` 24 into
     `package-lock.json`, sets the Biome schema version, and formats;
   - python: adds pytest and pytest-cov to the dev group and writes `uv.lock`;
   - writes `flake.lock` (if there is a flake).
2. The first run downloads a lot; that is normal. When a package will not build, see
   `references/troubleshooting.md`.
