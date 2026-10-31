# 4. Batch the expensive calls

Start each tool once for many inputs, and let the tests assert on the results. Work on the slowest
file first, one technique at a time, and time the file after each change
(`<skill>/scripts/time-tests.sh --jobs 1 <repo> <file>`).

## Techniques

1. **One process for many files.** Compile everything once in the file's setup, into a temporary
   folder, and let each test check its own output:

   ```powershell
   BeforeAll {
       $script:compiled = Join-Path $TestDrive 'compiled'
       # One argument "--pattern=<glob>": PowerShell on Linux expands wildcards in native arguments.
       $script:output = & $bicep build-params "--pattern=$(Join-Path $folder '*.bicepparam')" --outdir $compiled 2>&1
       $script:exitCode = $LASTEXITCODE
   }
   It 'compiles <_>' -ForEach $names { Join-Path $compiled "$_.json" | Should -Exist }
   ```

   `bicep build`, `build-params` and `lint` take `--pattern`; `bicep snapshot` does not (run
   those in parallel instead, see technique 5).
2. **A heavy tool once per suite.** Run it once before the tests for all inputs and write the
   results to JSON; each test reads its own. Split the inputs over a few child processes when one
   run is long. Example: PSRule once for all parameter files in four processes instead of one
   process per file (112 s → 19 s).
3. **Group by what the tool needs per call.** When a call takes a setting per input (a
   subscription, a config), group the inputs by that setting: one call per group.
4. **Call the tool, not a wrapper.** `az bicep build` starts the Azure CLI first (about 1 s);
   call `bicep` directly. Find it on `PATH`, else where the wrapper installs it, so CI keeps
   working:

   ```powershell
   $bicep = (Get-Command bicep -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1).Source
   if (-not $bicep) { $bicep = Join-Path $HOME '.azure/bin/bicep' }   # where 'az bicep install' puts it
   ```

5. **Independent slow steps in parallel** inside one file or tool script, such as snapshots:
   `ForEach-Object -Parallel` (PowerShell), `Promise.all` (JS), a process pool (Python).
6. **Setup once per file, not per test**: fixtures, temp repositories, containers, module imports
   (`BeforeAll`, `beforeAll`, `@pytest.fixture(scope="module")`). Copy a prepared fixture per test
   when tests change it.
7. **Expensive discovery once.** Data-driven tests (`-ForEach`, `test.each`, `parametrize`) that
   compute their cases by running a tool do that during discovery; compute once and reuse.

## Keep the failure the same

A batched run must still fail the same test for the same input. Keep per-input assertions (one
`It` per input reading its result), keep the tool's message in the assertion (`-Because`), and fail
loudly when the batch itself did not run (missing output file, non-zero exit). Gotchas:
`references/pitfalls.md`.

**Result:** each slow file is down to its real work. Continue with step 5.
