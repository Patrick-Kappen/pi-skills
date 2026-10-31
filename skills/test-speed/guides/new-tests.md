# New repository or new tests

Set tests up fast from the start; it is cheaper than step 1 to 5 later.

## A new repository

1. Scaffold it first when it does not exist yet (the repo-scaffold skill: devenv, hooks, CI).
2. Add the recipes as in `guides/03-runner.md`, step 1 (`add-runner.sh --dry-run`, then without).
   repo-scaffold already defines devenv scripts `unit [files]` and `check`: point the recipes at
   them where they fit, instead of adding a second way to run the same tests.
3. Let the pre-commit hook run `just test-changed` on the staged files, and CI run `just test`.

## Writing a test file

1. **One test file per unit, named after it:** `Foo.Tests.ps1` for `Foo.psm1`, `naming.test.ts`
   for `naming.ts`, `test_naming.py` for `naming.py`, or a mirror folder
   (`Tests/Modules/Foo/` for `Modules/Foo/`). The parallel runner works per file, and
   `changed-tests.sh` finds tests by these names and folders.
2. **Expensive work once per file:** compile, start tools, build fixtures in `BeforeAll` /
   `beforeAll` / a module fixture; tests assert on the results (`guides/04-batch.md`).
3. **No process per case.** A data-driven test with a tool call per case costs cases × start
   time; batch the call.
4. **Independent tests:** own temp paths (`$TestDrive`, `mkdtemp`, `tmp_path`), no shared state, no
   order. Then the file runs safely next to the others.
5. **No real network or cloud calls** in unit tests: mock `az`, `gh`, HTTP. Integration tests
   that need them go in their own files or folder with their own recipe (`test-integration`).
6. **Time it:** `<skill>/scripts/time-tests.sh --jobs 1 <repo> <new file>`. A unit test file over
   about 10 s has a batching candidate; check it with `find-spawns.sh`.
7. Run it with `just test-changed <file>`, and once with `just test-serial <file>`: a file that
   only passes in one of them shares state.
