import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  main,
  parseArgs,
  renderOverlay,
  scaffold,
  validateTarget,
} from "../../../skills/pi-platform/scripts/scaffold.ts";

const temporary: string[] = [];
async function temp(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pi-platform-scaffold-"));
  temporary.push(directory);
  return directory;
}
function git(directory: string, ...args: string[]): void {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" };
  delete env.GIT_DIR;
  delete env.GIT_INDEX_FILE;
  delete env.GIT_WORK_TREE;
  execFileSync("git", args, { cwd: directory, stdio: "ignore", env });
}
async function fixtureRepo(
  directory: string,
  branch = "feat/platform-scaffold",
  defaultBranch = "main",
): Promise<string> {
  const seed = path.join(directory, "seed");
  const worktree = path.join(directory, "worktree");
  await mkdir(seed, { recursive: true });
  git(seed, "init", "-b", "fixture-base");
  git(seed, "config", "user.name", "Fixture");
  git(seed, "config", "user.email", "fixture@example.invalid");
  await writeFile(path.join(seed, ".gitkeep"), "fixture\n");
  git(seed, "add", ".gitkeep");
  git(seed, "commit", "-m", "fixture");
  git(seed, "remote", "add", "origin", "file:///unused-fixture-remote");
  git(seed, "symbolic-ref", "refs/remotes/origin/HEAD", `refs/remotes/origin/${defaultBranch}`);
  git(seed, "branch", defaultBranch);
  if (branch === defaultBranch) git(seed, "worktree", "add", worktree, branch);
  else git(seed, "worktree", "add", "-b", branch, worktree);
  return worktree;
}
const repoScaffold = path.resolve("skills/repo-scaffold");
const platformSkill = path.resolve("skills/pi-platform");
function pinTestActions(githubDirectory: string): void {
  for (const workflow of ["workflows/ci.yml", "workflows/release.yml"]) {
    const file = path.join(githubDirectory, workflow);
    const source = readFileSync(file, "utf8");
    writeFileSync(file, source.replace(/@PIN:[^@]+@/g, `@${"a".repeat(40)} # pinned`));
  }
}

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

type RenderedFiles = Map<string, string>;

function assertCheckCatalog(files: RenderedFiles): void {
  const checks = JSON.parse(files.get("platform-checks.json") ?? "{}");
  expect(checks.schemaVersion).toBe(1);
  expect(checks.checks.length).toBeGreaterThan(5);
  const ids = new Set(checks.checks.map((check: { id: string }) => check.id));
  expect(ids.size).toBe(checks.checks.length);
  for (const check of checks.checks as Array<{ argv: string[]; needs?: string[] }>) {
    expect(check.argv.length).toBeGreaterThan(0);
    for (const dependency of check.needs ?? []) expect(ids.has(dependency)).toBe(true);
  }
}

function assertGeneratedContracts(files: RenderedFiles): void {
  expect(JSON.parse(files.get("platform.json") ?? "{}")).toMatchObject({
    schemaVersion: 1,
    components: { core: { path: "packages/core" }, widget: { dependencies: ["core"] } },
  });
  expect(JSON.parse(files.get("platform-policy.json") ?? "{}")).toMatchObject({
    schemaVersion: 1,
    coverage: { lines: 95, functions: 95, statements: 95, branches: 90 },
    maxDuplicatePercent: 0,
    maxComplexity: 15,
  });
  expect(JSON.parse(files.get("platform-policy.json") ?? "{}").allowedDependencies.widget).toEqual(["core"]);
  expect(JSON.parse(files.get("biome.json") ?? "{}").linter.rules.suspicious.noConsole).toBe("error");
  expect(JSON.parse(files.get("knip.json") ?? "{}").entry).toContain("scripts/platform/*.ts");
  expect(JSON.parse(files.get("platform-release-please-manifest.json") ?? "{}")["packages/core"]).toBe("0.1.0");
  expect(JSON.parse(files.get("packages/widget/package.json") ?? "{}")).toMatchObject({
    name: "@pi-platform/widget",
    private: true,
    type: "module",
  });
  expect(JSON.parse(files.get("package.json") ?? "{}")).toMatchObject({ name: "@pi-platform/monorepo", private: true });
  expect(JSON.parse(files.get("platform-release-please-config.json") ?? "{}")["include-component-in-tag"]).toBe(true);
}

function assertTemplateFiles(files: RenderedFiles): void {
  expect(files.get("biome.json")).toContain("noUnusedVariables");
  expect(files.get("knip.json")).toContain("entry");
  expect(files.get(".dependency-cruiser.cjs")).toContain("widget-import-boundary");
  expect(files.get(".dependency-cruiser.cjs")).toContain("(?!widget/|core/)");
  expect(files.get("docs/platform-contract.md")).toContain("release-please");
  expect(files.get("docs/ci-trust.md")).toContain("candidate-editable");
  expect(files.get("home-manager/examples/legacy-pi-rules.nix")).toContain('catalog."pi-rules"');
  expect(files.get("flake.nix")).toContain("legacy-pi-rules.nix");
  expect(files.get("scripts/platform/policy-hook.mjs")).toContain("process.exitCode = 2");
  expect(files.get("devenv.nix")).toContain('check.exec = "just check";');
  expect(files.get("scripts/platform/inventory.ts")).toContain("--repo");
  expect(files.get("devenv.nix")).toContain('name = "widget";');
  expect(files.get("README.md")).toContain("# widget");
  expect(files.get("LICENSE")).toContain("MIT License");
  expect(JSON.parse(files.get("package.json") ?? "{}").license).toBe("MIT");
  expect([...files.values()].join("\n")).not.toMatch(/@(?:PLACEHOLDER|NAME|MODULE|OWNER|LANGUAGE|RELEASE_TYPE)@/);
  expect(JSON.parse(files.get("scripts/platform/PROVENANCE.json") ?? "{}").sha256["run-checks.ts"]).toMatch(
    /^[a-f0-9]{64}$/,
  );
  expect(JSON.parse(files.get("scripts/platform/PROVENANCE.json") ?? "{}").sha256["lib-policy.ts"]).toMatch(
    /^[a-f0-9]{64}$/,
  );
}

async function assertOverlayVariants(): Promise<void> {
  const core = await renderOverlay(platformSkill, repoScaffold, "core");
  expect(
    JSON.parse(core.find((file) => file.relative === "platform.json")?.content ?? "{}").components.widget,
  ).toBeUndefined();
  const customBranch = await renderOverlay(platformSkill, repoScaffold, "widget", "public", "0.1.0", "trunk");
  expect(customBranch.find((file) => file.relative === ".github/workflows/ci.yml")?.content).toContain(
    'DEFAULT_BRANCH: "trunk"',
  );
  expect(customBranch.find((file) => file.relative === "justfile")?.content).toContain('"origin/trunk"');
}

describe("platform overlay scaffold", () => {
  it("parses the required arguments and rejects invalid names, kinds, and flags", () => {
    expect(
      parseArgs(["--repo", ".", "--name", "widget", "--kind", "private", "--scaffold-skill", repoScaffold]),
    ).toMatchObject({ name: "widget", kind: "private", dryRun: false });
    expect(
      parseArgs(["--repo", ".", "--name", "core", "--kind", "public", "--scaffold-skill", repoScaffold, "--dry-run"])
        .dryRun,
    ).toBe(true);
    expect(() =>
      parseArgs(["--repo", ".", "--name", "Bad", "--kind", "public", "--scaffold-skill", repoScaffold]),
    ).toThrow(/lowercase/);
    expect(() =>
      parseArgs(["--repo", ".", "--name", "ok", "--kind", "internal", "--scaffold-skill", repoScaffold]),
    ).toThrow(/kind/);
    expect(() =>
      parseArgs(["--repo", ".", "--name", "ok", "--kind", "private", "--scaffold-skill", repoScaffold, "--oops"]),
    ).toThrow(/unknown flag/);
    expect(() => parseArgs(["--repo"])).toThrow(/Usage/);
    expect(() => parseArgs(["--name", "ok", "--kind", "private", "--scaffold-skill", repoScaffold])).toThrow(/Usage/);
    expect(() => parseArgs(["--repo", ".", "--name", "ok", "--kind", "private", "--scaffold-skill"])).toThrow(
      /missing value/,
    );
    expect(() => parseArgs(["--help"])).toThrow(/Usage/);
  });

  it("renders complete manifests and real runtime script copies with provenance", async () => {
    const rendered = await renderOverlay(platformSkill, repoScaffold, "widget");
    const files = new Map(rendered.map((file) => [file.relative, file.content]));
    assertCheckCatalog(files);
    assertGeneratedContracts(files);
    assertTemplateFiles(files);
    await assertOverlayVariants();
  });

  it("requires an existing non-default git worktree and valid repo-scaffold utilities", async () => {
    const temporaryRoot = await temp();
    const target = await fixtureRepo(path.join(temporaryRoot, "worktree"));
    await expect(validateTarget(target, repoScaffold)).resolves.toMatchObject({ repo: target });
    const main = await fixtureRepo(path.join(temporaryRoot, "main"), "main");
    await expect(validateTarget(main, repoScaffold)).rejects.toThrow(/default branch 'main'/);
    const customDefault = await fixtureRepo(path.join(temporaryRoot, "custom-default"), "feat/custom", "trunk");
    await expect(validateTarget(customDefault, repoScaffold)).resolves.toMatchObject({ defaultBranch: "trunk" });
    const noDefault = await fixtureRepo(path.join(temporaryRoot, "no-default"));
    git(noDefault, "symbolic-ref", "--delete", "refs/remotes/origin/HEAD");
    await expect(validateTarget(noDefault, repoScaffold)).rejects.toThrow(/cannot identify default branch/);
    const notRepo = path.join(temporaryRoot, "plain");
    await mkdir(notRepo);
    await expect(validateTarget(notRepo, repoScaffold)).rejects.toThrow();
    await expect(validateTarget(target, notRepo)).rejects.toThrow();
    await expect(validateTarget(`${target}/../worktree`, repoScaffold)).rejects.toThrow(/parent traversal/);
    const linkedPath = path.join(temporaryRoot, "repo-alias");
    await symlink(target, linkedPath);
    await expect(validateTarget(linkedPath, repoScaffold)).rejects.toThrow(/symlink/);
  });

  it("dry-runs without writes, refuses overwrite, then creates a complete artifact set", async () => {
    const temporaryRoot = await temp();
    const target = await fixtureRepo(path.join(temporaryRoot, "repo"));
    const coreDirectory = path.join(target, "packages/core");
    await mkdir(coreDirectory, { recursive: true });
    await mkdir(path.join(coreDirectory, "src"), { recursive: true });
    await writeFile(
      path.join(coreDirectory, "package.json"),
      JSON.stringify({ name: "@pi-platform/core", version: "2.3.4", private: true, type: "module" }),
    );
    const opts = { repo: target, name: "widget", kind: "private" as const, scaffoldSkill: repoScaffold, dryRun: true };
    const preview = await scaffold(opts);
    expect(preview).toContain("platform.json");
    await expect(readFile(path.join(target, "platform.json"))).rejects.toThrow();
    const paths = await scaffold({ ...opts, dryRun: false }, (githubDirectory) => {
      expect(githubDirectory).toBe(path.join(target, ".github"));
      pinTestActions(githubDirectory);
      execFileSync(
        "actionlint",
        [path.join(githubDirectory, "workflows/ci.yml"), path.join(githubDirectory, "workflows/release.yml")],
        { cwd: target },
      );
    });
    expect(paths).toContain("scripts/platform/jobs.ts");
    expect(paths).not.toContain("packages/core/package.json");
    expect(paths).not.toContain("LICENSE");
    expect(JSON.parse(await readFile(path.join(target, "package.json"), "utf8")).license).toBe("UNLICENSED");
    expect(JSON.parse(await readFile(path.join(target, "packages/widget/package.json"), "utf8")).license).toBe(
      "UNLICENSED",
    );
    expect(JSON.parse(await readFile(path.join(target, "packages/core/package.json"), "utf8")).version).toBe("2.3.4");
    expect(
      JSON.parse(await readFile(path.join(target, "packages/widget/package.json"), "utf8")).dependencies[
        "@pi-platform/core"
      ],
    ).toBe("2.3.4");
    const privatePlatform = JSON.parse(await readFile(path.join(target, "platform.json"), "utf8"));
    expect(privatePlatform.components.core.version).toBe("2.3.4");
    expect(privatePlatform.components.widget.path).toBe("packages/widget");
    expect(
      JSON.parse(await readFile(path.join(target, "platform-release-please-config.json"), "utf8")).packages[
        "packages/core"
      ],
    ).toBeUndefined();
    expect(
      JSON.parse(await readFile(path.join(target, "platform-release-please-manifest.json"), "utf8"))["packages/core"],
    ).toBeUndefined();
    expect(await readFile(path.join(target, "scripts/platform/inventory.ts"), "utf8")).toContain("export");
    const inventory = execFileSync("node", ["scripts/platform/inventory.ts", "--repo", "."], {
      cwd: target,
      encoding: "utf8",
    });
    expect(JSON.parse(inventory).contracts).toContain("platform.json");
    execFileSync("nix-instantiate", ["--parse", "flake.nix"], { cwd: target, stdio: "ignore" });
    execFileSync("nix-instantiate", ["--parse", "home-manager/module.nix"], { cwd: target, stdio: "ignore" });
    execFileSync("nix-instantiate", ["--parse", "home-manager/examples/legacy-pi-rules.nix"], {
      cwd: target,
      stdio: "ignore",
    });
    execFileSync(
      "nixfmt",
      [
        "--check",
        "flake.nix",
        "devenv.nix",
        "nix/devenv/typescript.nix",
        "home-manager/module.nix",
        "home-manager/examples/legacy-pi-rules.nix",
      ],
      { cwd: target },
    );
    execFileSync("just", ["--fmt", "--check", "--justfile", "justfile"], { cwd: target });
    await symlink(path.resolve("node_modules"), path.join(target, "node_modules"), "dir");
    const generatedEnv = {
      ...process.env,
      PATH: `${path.join(target, "node_modules", ".bin")}${path.delimiter}${process.env.PATH ?? ""}`,
    };
    execFileSync("just", ["typecheck"], { cwd: target, stdio: "ignore", env: generatedEnv });
    execFileSync("just", ["test"], { cwd: target, stdio: "ignore", env: generatedEnv });
    execFileSync("just", ["coverage"], { cwd: target, stdio: "ignore", env: generatedEnv });
    const hmEvaluation = String(
      execFileSync(
        "nix",
        [
          "eval",
          "--impure",
          "--json",
          "--expr",
          'let module = import ./home-manager/module.nix; lib = { mkOption = value: value; types = { attrsOf = _: {}; str = {}; }; }; config.programs.piPlatform.catalog = { core = "packages/core"; }; evaluated = module { inherit config lib; }; in evaluated.config.programs.piPlatform.stateJson',
        ],
        { cwd: target, encoding: "utf8" },
      ),
    );
    expect(JSON.parse(hmEvaluation)).toBe(JSON.stringify({ core: "packages/core" }));
    execFileSync(
      "biome",
      [
        "check",
        "package.json",
        "biome.json",
        "knip.json",
        "tsconfig.json",
        "vitest.config.ts",
        ".dependency-cruiser.cjs",
        "scripts/platform/policy-hook.mjs",
        "packages/widget/src/index.ts",
        "packages/widget/src/index.test.ts",
      ],
      { cwd: target },
    );
    await expect(scaffold({ ...opts, dryRun: false })).rejects.toThrow(/refusing to overwrite/);
    const noCoreRepo = await fixtureRepo(path.join(temporaryRoot, "without-core"));
    await expect(scaffold({ ...opts, repo: noCoreRepo, dryRun: false })).rejects.toThrow(/existing packages\/core/);
    const invalidCoreRepo = await fixtureRepo(path.join(temporaryRoot, "invalid-core"));
    await mkdir(path.join(invalidCoreRepo, "packages/core/src"), { recursive: true });
    const coreManifest = path.join(invalidCoreRepo, "packages/core/package.json");
    await writeFile(coreManifest, "null");
    await expect(scaffold({ ...opts, repo: invalidCoreRepo })).rejects.toThrow(/valid existing public core/);
    for (const invalid of [
      { name: "wrong", version: "2.3.4", private: true, type: "module" },
      { name: "@pi-platform/core", version: "2.3", private: true, type: "module" },
      { name: "@pi-platform/core", version: "2.3.4", private: false, type: "module" },
      { name: "@pi-platform/core", version: "2.3.4", private: true, type: "commonjs" },
    ]) {
      await writeFile(coreManifest, JSON.stringify(invalid));
      await expect(scaffold({ ...opts, repo: invalidCoreRepo })).rejects.toThrow(/semantic version/);
    }
    const rollbackRepo = await fixtureRepo(path.join(temporaryRoot, "rollback"));
    await mkdir(path.join(rollbackRepo, "packages/core/src"), { recursive: true });
    await writeFile(
      path.join(rollbackRepo, "packages/core/package.json"),
      JSON.stringify({ name: "@pi-platform/core", version: "2.3.4", private: true, type: "module" }),
    );
    await expect(
      scaffold({ ...opts, repo: rollbackRepo, dryRun: false }, () => {
        throw new Error("pin failure");
      }),
    ).rejects.toThrow(/pin failure/);
    await expect(readFile(path.join(rollbackRepo, "platform.json"))).rejects.toThrow();
    await expect(scaffold({ ...opts, repo: rollbackRepo, dryRun: false }, () => undefined)).rejects.toThrow(
      /unresolved action pin marker/,
    );
    await expect(readFile(path.join(rollbackRepo, "platform.json"))).rejects.toThrow();

    const symlinkRepo = await fixtureRepo(path.join(temporaryRoot, "symlink-output"));
    const redirected = path.join(temporaryRoot, "redirected-scripts");
    await mkdir(redirected);
    await symlink(redirected, path.join(symlinkRepo, "scripts"));
    await expect(scaffold({ ...opts, repo: symlinkRepo, kind: "public" })).rejects.toThrow(/symlink output ancestor/);
  });

  it("generates one core package for public scaffolds and refuses unpinned writes", async () => {
    const directory = await temp();
    const repo = await fixtureRepo(path.join(directory, "public"));
    const options = { repo, name: "widget", kind: "public" as const, scaffoldSkill: repoScaffold, dryRun: false };
    await expect(scaffold(options)).rejects.toThrow(/action pinning is required/);
    await expect(readFile(path.join(repo, "platform.json"))).rejects.toThrow();
    const paths = await scaffold(options, pinTestActions);
    expect(paths).toContain("packages/core/package.json");
    expect(paths).toContain("packages/core/src/index.ts");
    const manifest = JSON.parse(await readFile(path.join(repo, "platform.json"), "utf8"));
    expect(Object.keys(manifest.components).filter((id) => id === "core")).toHaveLength(1);
  });

  it("maps generated policy-check failures to the blocking exit code 2", async () => {
    const directory = await temp();
    const hook = path.join(directory, "policy-hook.mjs");
    await writeFile(hook, await readFile(path.join(platformSkill, "templates/policy-hook.mjs"), "utf8"));
    let exitStatus: number | undefined;
    try {
      execFileSync("node", [hook], { cwd: directory, stdio: "ignore" });
    } catch (error) {
      exitStatus = (error as NodeJS.ErrnoException & { status?: number }).status;
    }
    expect(exitStatus).toBe(2);
  });

  it("prints help, runs a dry-run CLI request, and reports CLI errors", async () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const exitCode = process.exitCode;
    const directory = await temp();
    const target = await fixtureRepo(path.join(directory, "cli"));
    try {
      await main(["--help"]);
      expect(write).toHaveBeenCalled();
      await main([
        "--repo",
        target,
        "--name",
        "widget",
        "--kind",
        "public",
        "--scaffold-skill",
        repoScaffold,
        "--dry-run",
      ]);
      await main(["--unknown"]);
      expect(process.exitCode).toBe(2);
    } finally {
      process.exitCode = exitCode;
      write.mockRestore();
    }
  });
});
