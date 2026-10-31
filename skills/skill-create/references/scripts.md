# Scripts in a skill

## When

Write a script for work that is mechanical, repeated, or easy to get wrong: scaffolding, parsing,
validation, collecting data, calling an API with many parameters. Keep judgment in the instructions.

## Language

- **Bash** for gluing commands. `set -euo pipefail`, quote variables, pass shellcheck.
- **TypeScript** for parsing and logic. Node 22 and newer run `.ts` files directly: use only
  erasable syntax (no `enum`, no parameter properties), import local files with `.ts`, start with
  `#!/usr/bin/env node`, and export the functions so tests can import them. Run `main()` only when
  the file is executed: `if (import.meta.url === \`file://\${process.argv[1]}\`) main();`.

## Rules

- Executable (`chmod +x`) with a shebang; sourced libraries are named `lib*.sh`.
- The skill runs from the read-only Nix store: find own files relative to the script
  (`"$(dirname "$(realpath "${BASH_SOURCE[0]}")")"`), never write next to them, and copy templates
  before changing them (store files are read-only).
- Write output to a directory the caller names, or under `${XDG_CACHE_HOME:-~/.cache}`.
- `--dry-run` for anything that creates or changes files, repositories or remote state.
- Clear errors: what failed, and what to do. Exit non-zero on failure.
- Usage line in the header comment; document options in a reference.

## Tests

- In `test/skills/<name>/<script>.test.ts` (Vitest). Tests are not part of the skill package.
- TypeScript: import the exported functions and test them on fixtures in a temp directory.
- Bash: run the script with `execFileSync` in a temp directory and check its output and files.
- Coverage of skill scripts counts toward the repository thresholds.
