# 1. Parameters

1. Read the user's request after `/repo-scaffold`. Map what it says to the parameters in
   `SKILL.md`:
   - "work" or "private" sets `location`, and "public" or "private" sets `visibility`;
   - "TypeScript", "TS" or "node" means `typescript`; "Python" means `python`; anything else, or
     nothing, means `none`.
2. When the user writes "private", decide from context whether it means the location
   (`~/private`), the visibility, or both. If that is not clear, ask.
3. Ask for everything that is required and missing, in **one** question. Name the defaults you will
   use for the rest.
4. Check the owner. Run `gh auth status` and note the active account. For `location=work`, ask
   whether that account is right; the user may have a separate work account
   (`gh auth switch --user <account>`).
5. Validate the name and description against `references/parameters.md`, and check that
   `~/<location>/<name>` does not exist.
6. Check the tools: `git`, `nix`, `devenv`, `jq`, and `gh`. `gh` must be logged in
   (`gh auth status`), even with `github=no`, because pinning the actions uses the GitHub API.

Continue when every required parameter has a value.
