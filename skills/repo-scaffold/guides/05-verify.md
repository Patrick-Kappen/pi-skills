# 5. Verify

1. Run `<skill>/scripts/verify.sh <repo>`. It runs `devenv test`, which is what CI runs: every
   pre-commit hook on every file, then `check` (lint, types, tests with coverage, security,
   `nix flake check`). It also checks that the git hooks are wired up.
2. If something fails:
   - fix the generated repository so that it passes;
   - if the cause is in a template, also fix the template in this skill (`templates/`) and say so in
     the handover;
   - never weaken a check.
3. Run it again until it passes.
