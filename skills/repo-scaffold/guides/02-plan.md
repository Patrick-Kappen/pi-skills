# 2. Plan

1. Run the dry run with all parameters:

   ```sh
   <skill>/scripts/scaffold.sh --dry-run --name <name> --location <location> --visibility <visibility> \
     --language <language> --description "<description>" [--owner <owner>] [--flake no] [--release no] [--license <license>]
   ```

2. Show the user the plan it prints, plus what happens after it:
   - toolchain and lock files;
   - full verification (`devenv test`);
   - the first commits;
   - if `github=yes`: creating the GitHub repository (with its visibility) and pushing.
3. Wait for an explicit yes. Change parameters and run the dry run again if the user asks.
