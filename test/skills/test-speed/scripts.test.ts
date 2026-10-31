// Runs the test-speed scripts in temporary git repositories and checks their output and files.
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

const scripts = resolve(import.meta.dirname, "../../../skills/test-speed/scripts");
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function temp(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

/** The environment without GIT_* (the vitest config sets them empty, which git rejects). */
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], {
    cwd,
    encoding: "utf8",
    env: cleanEnv,
  });
}

/** A git repository with the given files, committed on main. */
function repo(files: Record<string, string>): string {
  const root = temp("test-speed-");
  git(root, "init", "-q", "-b", "main");
  write(root, files);
  git(root, "add", "-A");
  git(root, "commit", "-qm", "init");
  return root;
}

function write(root: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

function run(script: string, args: string[], cwd: string, env: Record<string, string> = {}): Run {
  const result = spawnSync(join(scripts, script), args, {
    cwd,
    encoding: "utf8",
    env: { ...cleanEnv, XDG_CACHE_HOME: join(cwd, ".cache-test"), DEVENV_ROOT: "", ...env },
  });
  return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

function lines(text: string): string[] {
  return text.split("\n").filter(Boolean);
}

const layout = {
  "Modules/Foo/Foo.psm1": "function Get-Foo { 1 }\n",
  "Modules/Foo/Private/helper.ps1": "1\n",
  "Tests/Modules/Foo/Foo.Tests.ps1": "Describe Foo {}\n",
  "Tests/Modules/Contract.Tests.ps1": "Describe Contract {}\n",
  "src/naming.ts": "export const n = 1;\n",
  "src/naming.test.ts": "import './naming';\n",
  "src/util.ts": "export const u = 1;\n",
  "src/b.test.ts": "// covers util.ts\n",
  "src/other.ts": "export const o = 1;\n",
  "app/tool.py": "x = 1\n",
  "tests/test_tool.py": "def test_x(): pass\n",
  "docs/a.md": "# a\n",
};

describe("changed-tests.sh", () => {
  test("maps files by name stem, mirror folder and mention", () => {
    const root = repo(layout);
    const out = run(
      "changed-tests.sh",
      ["src/naming.ts", "Modules/Foo/Private/helper.ps1", "src/util.ts", "app/tool.py"],
      root,
    );
    expect(out.status).toBe(0);
    expect(lines(out.stdout)).toEqual([
      "src/b.test.ts",
      "src/naming.test.ts",
      "Tests/Modules/Contract.Tests.ps1",
      "Tests/Modules/Foo/Foo.Tests.ps1",
      "tests/test_tool.py",
    ]);
  });

  test("a test file covers itself, and ./ prefixes are ignored", () => {
    const root = repo(layout);
    expect(lines(run("changed-tests.sh", ["./src/naming.test.ts"], root).stdout)).toEqual(["src/naming.test.ts"]);
  });

  test("docs select nothing and pass, also with --strict and --run", () => {
    const root = repo(layout);
    const out = run("changed-tests.sh", ["--strict", "--run", "echo RAN", "docs/a.md", "LICENSE"], root);
    expect(out.status).toBe(0);
    expect(out.stdout).toBe("");
    expect(out.stderr).toContain("no test files cover the changes");
  });

  test("a dependency or tool change selects every test", () => {
    const root = repo(layout);
    expect(lines(run("changed-tests.sh", ["package.json"], root).stdout)).toHaveLength(5);
    expect(lines(run("changed-tests.sh", ["devenv.nix"], root).stdout)).toHaveLength(5);
  });

  test("--strict names a code file without a test and exits 3", () => {
    const root = repo(layout);
    const out = run("changed-tests.sh", ["--strict", "src/other.ts", "src/naming.ts"], root);
    expect(out.status).toBe(3);
    expect(out.stderr).toContain("no test covers src/other.ts");
    expect(lines(out.stdout)).toEqual(["src/naming.test.ts"]);
    expect(run("changed-tests.sh", ["src/other.ts"], root).status).toBe(0);
  });

  test("--run appends the test files to the command", () => {
    const root = repo(layout);
    const out = run("changed-tests.sh", ["--run", "echo RAN", "src/naming.ts"], root);
    expect(out.stdout.trim()).toBe("RAN src/naming.test.ts");
  });

  test("--all lists every test file; --pattern changes what a test file is", () => {
    const root = repo(layout);
    expect(lines(run("changed-tests.sh", ["--all"], root).stdout)).toHaveLength(5);
    expect(lines(run("changed-tests.sh", ["--all", "--pattern", "\\.py$"], root).stdout)).toEqual([
      "app/tool.py",
      "tests/test_tool.py",
    ]);
  });

  test("without files: branch commits, unstaged and untracked changes against the base", () => {
    const root = repo(layout);
    git(root, "checkout", "-qb", "feat");
    write(root, { "src/naming.ts": "export const n = 2;\n" });
    git(root, "commit", "-qam", "change");
    write(root, { "app/tool.py": "x = 2\n", "Modules/Foo/new.ps1": "1\n" });
    const out = run("changed-tests.sh", ["--base", "main"], root);
    expect(lines(out.stdout)).toEqual([
      "src/naming.test.ts",
      "Tests/Modules/Contract.Tests.ps1",
      "Tests/Modules/Foo/Foo.Tests.ps1",
      "tests/test_tool.py",
    ]);
    // The default base is main when there is no origin.
    expect(run("changed-tests.sh", [], root).stdout).toBe(out.stdout);
  });

  test("errors: unknown base, unknown option, not a repository", () => {
    const root = repo(layout);
    const base = run("changed-tests.sh", ["--base", "origin/nope"], root);
    expect(base.status).toBe(2);
    expect(base.stderr).toContain("unknown base origin/nope");
    expect(run("changed-tests.sh", ["--bogus"], root).status).toBe(2);
    expect(run("changed-tests.sh", ["--root", temp("plain-")], root).stderr).toContain("not in a git repository");
  });
});

describe("time-tests.sh", () => {
  const files = {
    "a.test.ts": "",
    "b.test.ts": "",
    "sub/c.test.ts": "",
  };

  test("times each file with a custom command, slowest first, and writes the tsv", () => {
    const root = repo(files);
    const out = run(
      "time-tests.sh",
      [
        "--cmd",
        "case {} in b.test.ts) sleep 0.3; exit 1;; *) sleep 0.05;; esac",
        "--jobs",
        "2",
        "--out",
        "t.tsv",
        root,
      ],
      root,
    );
    expect(out.status).toBe(0);
    expect(out.stdout).toContain("runner: custom · 3 files · 2 at a time");
    const table = lines(out.stdout).filter((l) => /^\s+[\d.]+s/.test(l));
    expect(table[0]).toMatch(/FAIL\s+b\.test\.ts$/);
    expect(out.stdout).toMatch(/sum [\d.]+s · wall [\d.]+s · 3 slowest files = 100% of the sum · 1 failed · logs: /);
    const tsv = lines(readFileSync(join(root, "t.tsv"), "utf8"));
    expect(tsv).toHaveLength(4);
    expect(tsv[0]).toMatch(/^[\d.]+\tFAIL\tb\.test\.ts$/);
    expect(tsv[3]).toMatch(/^# wall\t[\d.]+$/);
  });

  test("limits to paths and marks a timeout", () => {
    const root = repo(files);
    const out = run("time-tests.sh", ["--cmd", "sleep 2", "--timeout", "0.2", root, "sub/"], root);
    expect(out.stdout).toContain("1 files");
    expect(out.stdout).toMatch(/TIMEOUT\s+sub\/c\.test\.ts/);
  });

  test("picks the runner, and refuses ambiguous or unknown ones", () => {
    const vitest = repo({ ...files, "package.json": '{"devDependencies":{"vitest":"5"}}' });
    const fake = temp("bin-");
    writeFileSync(join(fake, "npx"), "#!/bin/sh\nexit 0\n");
    chmodSync(join(fake, "npx"), 0o755);
    const out = run("time-tests.sh", [vitest], vitest, { PATH: `${fake}:${cleanEnv.PATH}` });
    expect(out.stdout).toContain("runner: vitest");
    expect(out.stdout).toContain("command: npx vitest run {}");

    const mixed = repo({ ...files, "Tests/x.Tests.ps1": "" });
    expect(run("time-tests.sh", [mixed], mixed).stderr).toContain("several runners (js pester); pass --runner");
    expect(run("time-tests.sh", ["--runner", "pester", "--cmd", "true", mixed], mixed).stdout).toContain("1 files");
    expect(run("time-tests.sh", ["--runner", "bogus", mixed], mixed).stderr).toContain("unknown runner: bogus");
    const js = repo(files);
    expect(run("time-tests.sh", [js], js).stderr).toContain("neither vitest in package.json nor a bun.lock");
    const bun = repo({ ...files, "bun.lock": "" });
    expect(run("time-tests.sh", ["--cmd", "true", "--runner", "bun", bun], bun).stdout).toContain("runner: bun");
  });

  test("enters devenv once and reports what it costs", () => {
    const root = repo({ ...files, "devenv.nix": "{ }\n" });
    const fake = temp("bin-");
    // A fake devenv: `devenv shell -- <command...>` runs the command with DEVENV_ROOT set.
    writeFileSync(join(fake, "devenv"), '#!/bin/sh\nshift 2\nDEVENV_ROOT=x exec "$@"\n');
    chmodSync(join(fake, "devenv"), 0o755);
    const out = run("time-tests.sh", ["--cmd", "true", root], root, { PATH: `${fake}:${cleanEnv.PATH}` });
    expect(out.stdout).toMatch(/^devenv shell -- true: [\d.]+s/);
    expect(out.stdout).toContain("3 files");
  });

  test("errors: no repository, bad jobs, no test files", () => {
    const root = repo({ "a.txt": "" });
    expect(run("time-tests.sh", [], root).stderr).toContain("usage");
    expect(run("time-tests.sh", ["--jobs", "0", root], root).stderr).toContain("--jobs must be a positive number");
    expect(run("time-tests.sh", [root], root).stderr).toContain("no test files found");
    expect(run("time-tests.sh", ["--nope", root], root).status).toBe(2);
  });
});

describe("find-spawns.sh", () => {
  test("counts starts per file and command, marks data-driven files, skips comments", () => {
    const root = repo({
      "Tests/Bicep.Tests.ps1": [
        "Describe 'x' -ForEach $names {",
        "  It 'builds' { & az bicep build --file $f }",
        "  It 'lints' { & az bicep lint --file $f }",
        "  # & az bicep build --file commented",
        "  It 'params' { & bicep build-params $p }",
        "}",
      ].join("\n"),
      "src/run.test.ts": "import { execFileSync } from 'node:child_process';\nexecFileSync('git', ['init']);\n",
      "src/quiet.test.ts": "test('x', () => {});\n",
    });
    const out = run("find-spawns.sh", [root], root);
    expect(out.status).toBe(0);
    const rows = lines(out.stdout);
    expect(rows[1]).toMatch(/^\s+2\s+az bicep\s+data-driven\s+Tests\/Bicep\.Tests\.ps1$/);
    expect(out.stdout).toMatch(/1\s+bicep\s+data-driven\s+Tests\/Bicep\.Tests\.ps1/);
    expect(out.stdout).toMatch(/1\s+child process \(JS\)\s+src\/run\.test\.ts/);
    expect(out.stdout).toContain("call bicep directly");
    expect(out.stdout).toContain("--pattern");
  });

  test("scans given paths, and says when it finds nothing", () => {
    const root = repo({ "tools/build.sh": "echo hi\n", "a.test.ts": "" });
    expect(run("find-spawns.sh", [root, "tools"], root).stdout).toContain("No process starts found in 1 files.");
    expect(run("find-spawns.sh", [], root).stderr).toContain("usage");
    expect(run("find-spawns.sh", [root, "nothing-here"], root).stderr).toContain("no files to scan");
  });
});

describe("add-runner.sh", () => {
  test("dry run prints the plan and writes nothing", () => {
    const root = repo({ "Tests/a.Tests.ps1": "" });
    const out = run("add-runner.sh", [root, "--runner", "pester", "--dry-run", "--base", "main"], root);
    expect(out.status).toBe(0);
    expect(out.stdout).toContain("would write scripts/Invoke-PesterParallel.ps1");
    expect(out.stdout).toContain("would write scripts/changed-tests.sh");
    expect(out.stdout).toContain(
      "--strict --base main --run 'pwsh -NoLogo -NoProfile -File scripts/Invoke-PesterParallel.ps1'",
    );
    expect(existsSync(join(root, "justfile"))).toBe(false);
    expect(existsSync(join(root, "scripts"))).toBe(false);
  });

  test("pester: writes the helpers and the justfile, and keeps them on a second run", () => {
    const root = repo({ "Tests/a.Tests.ps1": "" });
    run("add-runner.sh", [root, "--runner", "pester", "--dir", "Tools", "--base", "origin/dev"], root);
    const justfile = readFileSync(join(root, "justfile"), "utf8");
    expect(justfile).toContain("set positional-arguments");
    expect(justfile).toContain('    @pwsh -NoLogo -NoProfile -File Tools/Invoke-PesterParallel.ps1 "$@"');
    expect(justfile).toContain("Tools/changed-tests.sh --strict --base origin/dev");
    expect(justfile).toContain('Invoke-PesterParallel.ps1 -Serial "$@"');
    expect(justfile).not.toContain("@TEST");
    expect(statSync(join(root, "Tools/changed-tests.sh")).mode & 0o111).not.toBe(0);
    expect(readFileSync(join(root, "Tools/Invoke-PesterParallel.ps1"), "utf8")).toContain("PositionalBinding = $false");
    const again = run("add-runner.sh", [root, "--runner", "pester", "--dir", "Tools"], root);
    expect(again.stdout).toContain("keep Tools/changed-tests.sh (exists; --force replaces it)");
    expect(again.stdout).toContain("keep justfile (exists); add these recipes");
  });

  test("with devenv: the justfile calls devenv scripts and the snippet holds the commands", () => {
    const root = repo({ "a.test.ts": "", "devenv.nix": "{ }\n" });
    const out = run("add-runner.sh", [root, "--runner", "vitest", "--base", "main"], root);
    expect(readFileSync(join(root, "justfile"), "utf8")).toContain('@devenv shell -- tests-changed "$@"');
    expect(out.stdout).toContain("Add to devenv.nix");
    expect(out.stdout).toContain(
      "tests-changed.exec = ''if [ $# -gt 0 ]; then npx vitest related --run --passWithNoTests \"$@\"; else npx vitest run --changed main --passWithNoTests; fi'';",
    );
  });

  test("bun and pytest commands; pytest-xdist decides the parallel run", () => {
    const bun = repo({ "a.test.ts": "" });
    run("add-runner.sh", [bun, "--runner", "bun", "--base", "main"], bun);
    expect(readFileSync(join(bun, "justfile"), "utf8")).toContain('@bun test --parallel "$@"');

    const serial = repo({ "tests/test_a.py": "", "uv.lock": "" });
    const out = run("add-runner.sh", [serial, "--runner", "pytest"], serial);
    expect(out.stderr).toContain("pytest-xdist is not a dependency");
    expect(readFileSync(join(serial, "justfile"), "utf8")).toContain('@uv run pytest -q "$@"');

    const xdist = repo({ "tests/test_a.py": "", "pyproject.toml": 'dev = ["pytest-xdist"]\n' });
    run("add-runner.sh", [xdist, "--runner", "pytest"], xdist);
    expect(readFileSync(join(xdist, "justfile"), "utf8")).toContain('@python -m pytest -q -n auto "$@"');
  });

  test("errors: missing or unknown runner, no repository", () => {
    const root = repo({ "a.test.ts": "" });
    expect(run("add-runner.sh", [root], root).stderr).toContain("--runner is required");
    expect(run("add-runner.sh", [root, "--runner", "mocha"], root).stderr).toContain("unknown runner: mocha");
    expect(run("add-runner.sh", [], root).stderr).toContain("usage");
    expect(run("add-runner.sh", [temp("plain-"), "--runner", "bun"], root).stderr).toContain("not in a git repository");
  });
});

describe("compare-timings.sh", () => {
  test("a Markdown table per file, the sum and the wall time", () => {
    const root = temp("timings-");
    writeFileSync(join(root, "before.tsv"), "2.0\tok\ta\n1.0\tok\tb\n# wall\t2.1\n");
    writeFileSync(join(root, "after.tsv"), "0.5\tok\ta\n1.2\tFAIL\tb\n0.3\tok\tc\n# wall\t1.0\n");
    const out = run("compare-timings.sh", ["before.tsv", "after.tsv"], root);
    expect(lines(out.stdout)).toEqual([
      "| Test file | Before | After | Change |",
      "|---|---|---|---|",
      "| `a` | 2.0 s | 0.5 s | -75% |",
      "| `b` | 1.0 s | 1.2 s (FAIL) | +20% |",
      "| `c` | - | 0.3 s | - |",
      "| **Sum of files** | 3.0 s | 2.0 s | -33% |",
      "| **Wall time** | 2.1 s | 1.0 s | -52% |",
    ]);
  });

  test("errors: wrong arguments, missing file", () => {
    const root = temp("timings-");
    expect(run("compare-timings.sh", ["one"], root).stderr).toContain("usage");
    expect(run("compare-timings.sh", ["a.tsv", "b.tsv"], root).stderr).toContain("no such file: a.tsv");
  });
});
