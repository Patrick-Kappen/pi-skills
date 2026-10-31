---
name: nixos
description: Run, build and install software on NixOS, where nothing is installed globally - find the package that provides a missing command, library or header, run it once with , or nix shell, add it to the repository's devenv, or set up a devenv when there is none. Use when a command is not found, a shared library or header is missing, a downloaded binary will not start, pip refuses to install, or a script needs /bin/bash or /usr/bin/python.
metadata:
  version: "1.0.0"
---

# nixos

This machine runs NixOS. Programs come from the Nix store, per repository through devenv or for one
command through `nix shell`; there is no global install, no `apt`, no `/usr/lib`, and `/bin` and
`/usr/bin` hold only `sh` and `env`. When something is missing, find its package and bring it in
the Nix way, never by installing it into the system or the home directory.

Paths are relative to this file.

## Rules

1. **Look in the repository first.** With a `devenv.nix` in the repository, run commands as
   `devenv shell -- <command>`: the agent's shell does not load direnv, so the tools of the devenv
   are missing outside it. Many "command not found" errors end here.
2. **Find the package, do not guess it.** Run `scripts/find-package.sh <command | libfoo.so.N |
   header.h>`. It searches the nix-index database with `nix-locate` and prints the attributes, best
   first, with the command to use the first.
3. **One command: run it without installing.** `nix shell nixpkgs#<attr> -c <command> ...`.
   Nothing stays behind. `, <command>` (comma) does the same without the attribute, but only when
   one package provides the command; with several it asks in a terminal and fails in the agent's
   shell. Never `, -i`: it installs.
4. **Needed by the repository: add it to the devenv**, in the worktree of the change, and say so in
   the PR. A repository without a devenv gets one only after the user agrees. See
   `references/devenv.md`.
5. **Never install globally**: no `sudo`, no `nix profile install`, no `nix-env -i`, no
   `pip install --user`, no `npm install -g`, no `curl | sh` installers, no edits in `/etc`. A tool
   the user wants everywhere belongs in their NixOS configuration (a flake; ask where it lives),
   changed there in a worktree with a PR.
6. **Do not download prebuilt Linux binaries.** They fail with "Could not start dynamically linked
   executable": this system has no generic dynamic loader (no nix-ld). Use the nixpkgs package; if
   there is none, build from source inside the devenv.
7. **Shebangs use env**: `#!/usr/bin/env bash`, `#!/usr/bin/env python3`, never `#!/bin/bash` or
   `#!/usr/bin/python`.

## Workflow

| Error | Do | Reference |
|---|---|---|
| `command not found`, `/usr/bin/env: 'x': No such file or directory` | Rule 1, then `scripts/find-package.sh x`, then rule 3 or 4 | `references/errors.md` |
| `error while loading shared libraries: libfoo.so.N`, `cannot find -lfoo` | `scripts/find-package.sh libfoo.so.N`, add the package to the devenv | `references/errors.md` |
| `fatal error: foo.h: No such file`, `pkg-config` cannot find a package | `scripts/find-package.sh foo.h`, add it and `pkg-config` to the devenv | `references/errors.md` |
| `No module named x`, `externally-managed-environment`, `No module named pip` | Python packages through `uv` or the devenv, never pip into the system | `references/errors.md` |
| `Could not start dynamically linked executable`, `bad interpreter` | Rule 6 or rule 7 | `references/errors.md` |
| The repository needs a tool, a language or a service | Change `devenv.nix` | `references/devenv.md` |

## Tools

- `scripts/find-package.sh [--all] <query>`: which nixpkgs attribute provides a command
  (`jq`), a library (`libssl.so.3`), a header (`zlib.h`, `openssl/ssl.h`) or a path. Exit 1 when
  nothing provides it; then try `nix search nixpkgs <name>`.
- `nix shell nixpkgs#<attr> -c <command>`: run a package once; `nix search nixpkgs <name>` finds
  packages by name.
- `,` (comma) and `nix-locate`: installed on this machine with the nix-index database; see rule 3
  for the limit of `,`.
- `devenv`: `devenv init`, `devenv shell -- <command>`, `devenv search <name>`.

## References

| File | Read when |
|---|---|
| `references/errors.md` | An error from the table above, with its cause and fix |
| `references/devenv.md` | Adding a package, language or service to a devenv, or creating one |
