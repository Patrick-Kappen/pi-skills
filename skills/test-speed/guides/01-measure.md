# 1. Measure

Find out where the time goes before you change anything. Work in a worktree of the repository
(git skill); the measurement itself changes nothing.

1. Time every test file, once in parallel (the wall time a user waits) and once alone (clean
   per-file times; parallel runs inflate them through contention):

   ```sh
   <skill>/scripts/time-tests.sh --out ~/.cache/test-speed/<repo>-before.tsv <repo>
   <skill>/scripts/time-tests.sh --jobs 1 <repo> <slowest files or folders>
   ```

   The script picks the runner (`--runner` when a repository has several), enters devenv once and
   reports what entering costs, and ends with the sum, the wall time and the share of the three
   slowest files. Keep the `--out` file: step 5 compares against it.
2. Find what the slow files do:

   ```sh
   <skill>/scripts/find-spawns.sh <repo> <slowest files>
   ```

   It counts process starts per file and command (`az bicep`, `bicep build`, `Invoke-PSRule`,
   `pwsh`, `node`, `docker`, ...) and marks data-driven files, where a start runs once per case.
3. Read the slowest file. Count how often each start runs: lines times cases. A tool on .NET,
   Python or Node costs 0.3 to 1 s per start; 200 starts are minutes.
4. Note the other costs the numbers show:
   - entering the environment (`devenv shell -- true`), when it is more than a second;
   - one file that sets the wall time (parallel cannot beat the slowest file);
   - failing or timed-out files (they distort the numbers: fix or exclude them first, and say so).

**Result:** a table of the slowest files with their time and cause (starts × cases, setup, sleep,
network). Continue with step 2.
