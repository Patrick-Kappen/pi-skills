# Errors and their fixes

Each error with its cause on NixOS and the fix. Find packages with `../scripts/find-package.sh`.

## A command is missing

```text
bash: jq: command not found
/usr/bin/env: 'python': No such file or directory
```

- **Cause:** nothing is on `PATH` unless a profile, a devenv or a `nix shell` puts it there. In a
  repository with a devenv, the agent's shell lacks the devenv tools: direnv does not run in it.
- **Fix:** with a `devenv.nix`, retry as `devenv shell -- <command>`. Otherwise run
  `find-package.sh <command>` and use `nix shell nixpkgs#<attr> -c <command>` or `, <command>`.
  `python` (without 3) does not exist; call `python3`.

## A shared library is missing

```text
error while loading shared libraries: libssl.so.3: cannot open shared object file
/usr/bin/ld: cannot find -lssl
```

- **Cause:** there is no `/usr/lib`; libraries come from the store, through the build environment.
- **Fix:** `find-package.sh libssl.so.3`, then add the package to `packages` in `devenv.nix` and run
  the build in `devenv shell`. For Python wheels, see "Python" below.

## A header or pkg-config package is missing

```text
fatal error: zlib.h: No such file or directory
Package openssl was not found in the pkg-config search path
```

- **Fix:** `find-package.sh zlib.h` (or `openssl/ssl.h`), then add the package and `pkgs.pkg-config`
  to `packages` in `devenv.nix`. devenv sets `PKG_CONFIG_PATH` and the compiler flags for them.
  Enable the language (`languages.c.enable = true;`, `languages.rust.enable = true;`) for the
  compiler.

## Python

```text
ModuleNotFoundError: No module named 'yaml'
error: externally-managed-environment
/nix/store/...-python3/bin/python3: No module named pip
```

- **Cause:** the Python from the store is read-only and has no pip; packages go into a virtual
  environment.
- **One script:** `uv run --no-project --with pyyaml python3 script.py`. uv uses the Python from the
  store; it should not download its own (those builds fail like the binaries below). If it tries,
  add `--python python3`.
- **The repository:** `uv add <package>` in a uv project, or in `devenv.nix`
  `languages.python = { enable = true; venv.enable = true; uv.enable = true; };`. A wheel that
  needs a native library (`libstdc++.so.6`, `libz.so.1`) needs that library in
  `languages.python.libraries` or `packages`.

## A downloaded binary does not start

```text
Could not start dynamically linked executable: ./tool
NixOS cannot run dynamically linked executables intended for generic
linux environments out of the box. For more information, see:
https://nix.dev/permalink/stub-ld
```

- **Cause:** `/lib64/ld-linux-x86-64.so.2` is a stub; this machine has no nix-ld. Binaries built
  for other distributions do not run.
- **Fix:** use the nixpkgs package (`find-package.sh <name>`, `nix search nixpkgs <name>`), or build
  from source in the devenv. Do not patch the binary or enable nix-ld without the user.
- npm, pip and cargo packages that download such binaries in a post-install step fail the same
  way; look for a nixpkgs package of the tool and point the package at it (many packages read the
  path of the binary from an environment variable; see their documentation).

## A shebang does not resolve

```text
bash: ./script.sh: /bin/bash: bad interpreter: No such file or directory
```

- **Cause:** `/bin` holds only `sh`, and `/usr/bin` only `env`.
- **Fix:** change the shebang to `#!/usr/bin/env bash` (or `python3`, `node`, ...), or run
  `bash script.sh`. In a repository, the shebang change is part of the change.

## Global installs fail

```text
npm ERR! EACCES: permission denied, mkdir '/nix/store/...'
error: profile '/nix/var/nix/profiles/...' is not writable
```

- **Cause:** the store and the system profiles are read-only by design.
- **Fix:** `npx <tool>`, `uv tool run <tool>` / `uvx <tool>`, `nix shell nixpkgs#<attr>`, or the
  devenv. A tool wanted on every shell goes into the user's NixOS configuration, with their
  consent.
