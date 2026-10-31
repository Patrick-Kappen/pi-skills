# 2. Plan

Pick a technique per cause from step 1, estimate the gain, and get the user's yes.

| Cause | Technique | Where |
|---|---|---|
| Files run one after another | One process per file, slowest first | `guides/03-runner.md` |
| Agents run the whole suite for a small change | `test-changed` from the diff | `guides/03-runner.md` |
| A tool starts once per input or per case | One start for many inputs (`--pattern`, one run, results read per test) | `guides/04-batch.md` |
| A wrapper starts first (`az bicep`, `npx` in a loop) | Call the tool directly | `guides/04-batch.md` |
| Expensive setup per test | Setup once per file (`BeforeAll`, `beforeAll`, module fixture) | `guides/04-batch.md` |
| Unchanged packages tested again in CI | Per-package nix checks, cached | `references/runners.md` |
| Entering the environment is slow | Enter once per run, not per file; check what `enterShell` does | `references/pitfalls.md` |

On just or make: neither makes tests faster by itself; devenv scripts already run commands. The
recipes give every repository the same names and short commands for people, agents and CI
(`references/recipes.md`). Say this when the user asks for just or make as the speed fix.

Estimate each gain from the numbers: parallel gives about the slowest file as wall time; batching
gives starts × start cost. Show the user, at once:

1. the table from step 1 (slowest files, time, cause);
2. the techniques, in order, with the estimated gain each;
3. the files you will change, and whether CI changes;
4. what stays the same: the tests, cases and thresholds.

**Result:** an explicit yes for the plan. Then step 3.
