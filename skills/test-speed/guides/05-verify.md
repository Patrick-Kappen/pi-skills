# 5. Verify

Prove that the suite is faster, tests the same, and still fails when it should.

1. Measure again with the same settings as step 1, and compare:

   ```sh
   <skill>/scripts/time-tests.sh --out ~/.cache/test-speed/<repo>-after.tsv <repo>
   <skill>/scripts/compare-timings.sh ~/.cache/test-speed/<repo>-before.tsv ~/.cache/test-speed/<repo>-after.tsv
   ```

   Also time the recipe the user runs: `time just test`.
2. **Same tests:** the passed, failed and skipped counts of `just test` equal those of
   `just test-serial` and of the run before your change. A difference means a test is lost or
   runs twice; find it.
3. **Failures are still found.** For each technique from step 4, break an input on purpose, run
   the changed file, see the expected test fail with a useful message, and restore the input:
   - remove a suppression or allow-list entry (the rule it hid must fail);
   - corrupt a snapshot or expected file (the check must fail, or rewrite it identically);
   - make one compiled input invalid (only its test must fail, not the whole file).

   Check with `git status` that every break is restored.
4. **Same in CI:** the CI step calls the recipe or the same script, and the tools resolve there
   (a tool missing from `PATH` in CI needs the fallback from `guides/04-batch.md`). Run the CI
   pipeline on the branch when you can.
5. Run the repository's linters on the changed files (PSScriptAnalyzer, biome, ruff, shellcheck,
   cspell); new helper scripts must pass them like any code.

**Result:** the before/after table, equal counts, and the list of breaks that failed as expected.
Continue with step 6.
