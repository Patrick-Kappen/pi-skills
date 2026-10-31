# 3. Bootstrap

1. Read the repo-scaffold skill and this skill's layout, scripts and releases references. Locate
   repo-scaffold from its loaded skill location; never hardcode a Nix store path.
2. For a new repository, follow repo-scaffold's intake and dry-run. Creating a remote requires
   explicit approval. Use pi-git for history/push/PR operations when available. Do not initialize
   or modify an existing default checkout merely to make a bootstrap command pass.
3. Use git_start for this change. In an existing repository, preserve its branch, user's edits and
   unrelated settings. A worktree must be ready before the platform overlay is applied.
4. Run scaffold with --dry-run and inspect every destination. It must not overwrite existing files,
   follow output symlinks outside the destination, leak private data or leave placeholders.
5. Apply only the approved plan. A collision requires a reviewed integration change, not --force.
   Generic repo creation and GitHub settings remain repo-scaffold's responsibility.
6. Enter the generated devenv once and resolve/commit the intended locks through the approved git
   workflow. Nix supplies tools such as Biome; no global npm/pip installs or downloaded ELF tools.
7. Validate rendered manifests, just recipes, workflows and the Home Manager module in a temporary
   consumer. Template exclusion from the skill repository's linters is not validation.
8. Audit required checks and release App prerequisites through repo-scaffold. If branch protection,
   CI credentials or private-repo plan support is missing, report that enforcement is incomplete.

Result: a reproducible development environment and a tested tooling baseline, not a claim that the
entire platform runtime has been implemented.
