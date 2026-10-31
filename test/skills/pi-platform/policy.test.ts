import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  checkPolicy,
  main as checkPolicyMain,
  validateChecks,
  validatePolicy,
} from "../../../skills/pi-platform/scripts/check-policy.ts";
import {
  main as homeManagerMain,
  makeHomeManagerPlan,
  runHomeManagerPlan,
} from "../../../skills/pi-platform/scripts/home-manager-plan.ts";
import {
  collectInventory,
  main as inventoryMain,
  runInventory,
} from "../../../skills/pi-platform/scripts/inventory.ts";
import { planChange, main as planChangeMain, runPlanChange } from "../../../skills/pi-platform/scripts/plan-change.ts";
import {
  buildReleasePlan,
  main as releasePlanMain,
  runReleasePlan,
} from "../../../skills/pi-platform/scripts/release-plan.ts";

const roots: string[] = [];
const gitEnv = { ...process.env, GIT_DIR: undefined, GIT_INDEX_FILE: undefined, GIT_WORK_TREE: undefined };
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "pi-platform-policy-"));
  roots.push(root);
  execFileSync("git", ["init", "-q"], { cwd: root, env: gitEnv });
  execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: root, env: gitEnv });
  execFileSync("git", ["config", "user.name", "Fixture"], { cwd: root, env: gitEnv });
  return root;
}
function put(root: string, path: string, content: string): void {
  const full = join(root, path);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
}
function commit(root: string, message: string): string {
  execFileSync("git", ["add", "-A"], { cwd: root, env: gitEnv });
  execFileSync("git", ["commit", "-qm", message], { cwd: root, env: gitEnv });
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", env: gitEnv }).trim();
}
const policy = {
  schemaVersion: 1,
  coverage: { lines: 95, functions: 95, statements: 95, branches: 90 },
  maxDuplicatePercent: 0,
  maxComplexity: 15,
  allowedDependencies: { core: [], app: ["core"] },
};
function platform(root: string): void {
  put(
    root,
    "platform.json",
    JSON.stringify({
      schemaVersion: 1,
      components: {
        core: { path: "components/core", version: "1.2.3", dependencies: [] },
        app: { path: "components/app", version: "2.0.0", dependencies: ["core"] },
      },
    }),
  );
  put(root, "platform-policy.json", JSON.stringify(policy));
  put(
    root,
    "platform-checks.json",
    JSON.stringify({ schemaVersion: 1, checks: [{ id: "test", argv: ["npm", "test"] }] }),
  );
  put(root, "biome.json", JSON.stringify({ linter: { enabled: true } }));
  for (const id of ["core", "app"])
    put(
      root,
      `components/${id}/package.json`,
      JSON.stringify({
        name: `@pi-platform/${id}`,
        version: id === "core" ? "1.2.3" : "2.0.0",
        private: true,
        type: "module",
      }),
    );
  put(root, "components/core/src/index.ts", "export const core = true;\n");
  put(root, "components/app/src/index.ts", "export const app = true;\n");
}
afterEach(() => {
  while (roots.length) rmSync(roots.pop() as string, { recursive: true, force: true });
});

describe("platform policy scripts", () => {
  test("validates floors, check DAGs, limits, shape, and allowlists", () => {
    expect(
      validateChecks({
        schemaVersion: 1,
        checks: [
          { id: "a", argv: ["node", "a"] },
          { id: "b", argv: ["node", "b"], needs: ["a"] },
        ],
      }),
    ).toEqual([]);
    expect(
      validateChecks({ schemaVersion: 1, checks: [{ id: "a", argv: ["x"], needs: ["b"] }] }).map((issue) => issue.code),
    ).toContain("check-missing-dependency");
    expect(
      validateChecks({
        schemaVersion: 1,
        checks: [
          { id: "a", argv: ["x"], needs: ["b"] },
          { id: "b", argv: ["x"], needs: ["a"] },
        ],
      }).map((issue) => issue.code),
    ).toContain("check-cycle");
    expect(validatePolicy(policy)).toEqual([]);
    expect(
      validatePolicy({
        ...policy,
        coverage: { ...policy.coverage, lines: 94 },
        maxComplexity: 16,
        maxDuplicatePercent: 1,
      }),
    ).toHaveLength(3);
    expect(validatePolicy({})).toHaveLength(1);
    expect(validatePolicy({ ...policy, allowedDependencies: { core: [3] } })).toHaveLength(1);
    expect(
      validatePolicy({
        ...policy,
        coverage: { lines: Number.NaN, functions: 101, statements: 94, branches: -1 },
        maxDuplicatePercent: -1,
        maxComplexity: 0,
      }),
    ).toHaveLength(6);
    expect(validateChecks({ schemaVersion: 1, checks: [] }).map((issue) => issue.code)).toContain("checks-empty");
    expect(validateChecks({ schemaVersion: 2, checks: [] }).map((issue) => issue.code)).toContain("checks-shape");
    expect(
      validateChecks({ schemaVersion: 1, checks: [null, { id: "Bad", argv: ["x"] }] }).map((issue) => issue.code),
    ).toEqual(["check-command", "check-command"]);
    expect(
      validateChecks({
        schemaVersion: 1,
        checks: [
          { id: "bad", argv: ["x"], needs: [3], timeoutSeconds: 0 },
          { id: "bad", argv: ["x"] },
        ],
      }).map((issue) => issue.code),
    ).toEqual(["check-needs", "check-timeout", "check-duplicate"]);
  });
  test("detects reverse dependants; shared changes fall back to all", () => {
    const root = fixture();
    platform(root);
    const base = commit(root, "feat: baseline");
    put(root, "components/core/src/new.ts", "export {};\n");
    expect(planChange(root, base).components).toEqual(["app", "core"]);
    expect(planChange(root, base).selection).toBe("components");
    put(root, "scripts/tool.ts", "export {};\n");
    expect(planChange(root, base).selection).toBe("all-tooling");
    expect(runPlanChange(["--repo", root, "--base", base])).toHaveProperty("components");
  });
  test("selects docs-only explicitly and safely writes new output only", () => {
    const root = fixture();
    platform(root);
    const base = commit(root, "feat: baseline");
    put(root, "README.md", "docs\n");
    expect(planChange(root, base).selection).toBe("docs-only");
    const output = join(root, "reports", "inventory.json");
    expect(runInventory(["--repo", root, "--out", output, "--dry-run"])).toHaveProperty("dryRun", true);
    expect(() => readFileSync(output)).toThrow();
    runInventory(["--repo", root, "--out", output]);
    expect(JSON.parse(readFileSync(output, "utf8")).schemaVersion).toBe(1);
    expect(() => runInventory(["--repo", root, "--out", output])).toThrow(/overwrite/);
    expect(() => runInventory(["--repo", root, "--bogus"])).toThrow(/unknown/);
  });
  test("collects source/doc/contract paths and duplicate hashes without returning file contents", () => {
    const root = fixture();
    platform(root);
    put(root, "README.md", "private remote credential must not be read");
    put(root, "copy.ts", "export const core = true;\n");
    const result = collectInventory(root);
    expect(result.sourceFiles).toContain("copy.ts");
    expect(result.contracts).toContain("platform.json");
    expect(result.documentation).toContain("README.md");
    expect(result.duplicateSourceHashes[0]?.files).toContain("copy.ts");
    expect(JSON.stringify(result)).not.toContain("private remote credential");
  });
  test("handles malformed inventory metadata and unsafe or missing source paths", () => {
    const root = fixture();
    platform(root);
    put(root, "packages/odd/package.json", JSON.stringify({ name: 3, version: "1.0", private: "yes", type: null }));
    put(root, "packages/broken/package.json", "{");
    put(root, "platform.json", JSON.stringify({ schemaVersion: 1, components: { bare: null, typed: { path: 3 } } }));
    put(root, "platform-checks.json", JSON.stringify({ schemaVersion: 1, checks: [null, { id: "check", needs: [] }] }));
    put(root, "gone.ts", "export {};");
    execFileSync("git", ["add", "gone.ts"], { cwd: root, env: gitEnv });
    unlinkSync(join(root, "gone.ts"));
    const outside = mkdtempSync(join(tmpdir(), "pi-platform-outside-"));
    roots.push(outside);
    writeFileSync(join(outside, "secret.ts"), "export {};");
    symlinkSync(join(outside, "secret.ts"), join(root, "escape.ts"));

    const result = collectInventory(root);
    expect(result.sourceFiles).toContain("gone.ts");
    expect(result.sourceFiles).not.toContain("escape.ts");
    expect(result.manifestMetadata).toContainEqual({
      path: "packages/odd/package.json",
      version: "1.0",
    });
    expect(result.manifestMetadata).not.toContainEqual(
      expect.objectContaining({ path: "packages/broken/package.json" }),
    );
    expect(result.contractMetadata["platform.json"]).toEqual({
      schemaVersion: 1,
      components: [{ id: "bare" }, { id: "typed" }],
    });
    expect(result.contractMetadata["platform-checks.json"]).toEqual({
      schemaVersion: 1,
      checks: [null, { id: "check", needs: [] }],
    });
  });
  test("requires trusted baseline, candidate policy, and protected manifests; rejects allowlist widening", () => {
    const root = fixture();
    platform(root);
    put(
      root,
      "platform-checks.json",
      JSON.stringify({ schemaVersion: 1, checks: [{ id: "test", argv: ["npm", "test"] }] }),
    );
    const base = commit(root, "feat: baseline");
    unlinkSync(join(root, "platform-policy.json"));
    expect(() => checkPolicy(root, base)).toThrow(/candidate policy/);
    put(
      root,
      "platform-policy.json",
      JSON.stringify({ ...policy, allowedDependencies: { ...policy.allowedDependencies, app: ["core", "extra"] } }),
    );
    expect(checkPolicy(root, base).issues.map((issue) => issue.code)).toContain("policy-weakened");
    unlinkSync(join(root, "platform-checks.json"));
    expect(checkPolicy(root, base).issues.map((issue) => issue.code)).toContain("checks-missing");
  });
  test("requires trusted baseline and rejects weakened config or invalid component structure", () => {
    const root = fixture();
    platform(root);
    const base = commit(root, "feat: baseline");
    expect(checkPolicy(root, base)).toMatchObject({ ok: true, issues: [] });
    put(root, "biome.json", JSON.stringify({ linter: { enabled: false } }));
    expect(checkPolicy(root, base).issues.map((issue) => issue.code)).toContain("protected-enforcement-change");
    put(root, "platform-policy.json", JSON.stringify({ ...policy, coverage: { ...policy.coverage, branches: 89 } }));
    expect(checkPolicy(root, base).issues.map((issue) => issue.code)).toContain("coverage-floor");
    put(
      root,
      "platform.json",
      JSON.stringify({
        schemaVersion: 1,
        components: { core: { path: "../escape", version: "1.0.0", dependencies: ["oops"] } },
      }),
    );
    expect(checkPolicy(root, base).ok).toBe(false);
    expect(() => checkPolicy(root, "missing-base")).toThrow();
  });
  test("plan-change validates candidate and base component graphs and recognizes no-op plans", () => {
    const root = fixture();
    platform(root);
    const base = commit(root, "feat: baseline");
    expect(planChange(root, base)).toMatchObject({ selection: "components", changedFiles: [], components: [] });

    const invalidManifests = [
      { schemaVersion: 1, components: { Bad: { path: "packages/bad", dependencies: [] } } },
      { schemaVersion: 1, components: { core: { path: "../escape", dependencies: [] } } },
      { schemaVersion: 1, components: { core: { path: "packages/core", dependencies: [3] } } },
      {
        schemaVersion: 1,
        components: {
          core: { path: "packages/core", dependencies: ["unknown"] },
        },
      },
      {
        schemaVersion: 1,
        components: {
          core: { path: "packages/core", dependencies: [] },
          app: { path: "packages/core/nested", dependencies: [] },
        },
      },
    ];
    for (const manifest of invalidManifests) {
      put(root, "platform.json", JSON.stringify(manifest));
      expect(() => planChange(root, base)).toThrow();
    }

    platform(root);
    put(root, "platform.json", JSON.stringify({ schemaVersion: 1, components: [] }));
    expect(() => planChange(root, base)).toThrow("candidate platform.json is missing or malformed");
  });
  test("release plan classifies patches, breaking changes, and ambiguous evidence", () => {
    const root = fixture();
    platform(root);
    const base = commit(root, "feat: baseline");
    put(root, "components/core/src/fix.ts", "export {};");
    execFileSync("git", ["add", "-A"], { cwd: root, env: gitEnv });
    execFileSync("git", ["commit", "-qm", "fix(core): correct behavior"], { cwd: root, env: gitEnv });
    expect(buildReleasePlan(root, base).proposals.find((item) => item.component === "core")).toMatchObject({
      bump: "patch",
      proposedVersion: "1.2.4",
    });

    put(root, "components/app/src/break.ts", "export {};");
    execFileSync("git", ["add", "-A"], { cwd: root, env: gitEnv });
    execFileSync("git", ["commit", "-qm", "feat(app)!: replace public API"], { cwd: root, env: gitEnv });
    expect(buildReleasePlan(root, base).proposals.find((item) => item.component === "app")).toMatchObject({
      bump: "major",
      proposedVersion: "3.0.0",
      humanReview: true,
    });

    put(root, "components/app/src/uncommitted.ts", "export {};");
    expect(buildReleasePlan(root, base).proposals.find((item) => item.component === "app")?.bump).toBe("review");
    put(
      root,
      "platform.json",
      JSON.stringify({
        schemaVersion: 1,
        components: { core: { path: "components/core", version: "01.2.3", dependencies: [] } },
      }),
    );
    expect(() => buildReleasePlan(root, base)).toThrow("invalid component version");
  });
  test("release plan proposes without side effects and flags ambiguous changes", () => {
    const root = fixture();
    platform(root);
    const base = commit(root, "feat: baseline");
    put(root, "components/app/src/feature.ts", "export {};\n");
    execFileSync("git", ["add", "-A"], { cwd: root, env: gitEnv });
    execFileSync("git", ["commit", "-qm", "feat(app): add feature"], { cwd: root, env: gitEnv });
    const plan = buildReleasePlan(root, base);
    expect(plan.proposals.find((item) => item.component === "app")?.bump).toBe("minor");
    expect(plan.sideEffects[0]).toContain("No tags");
    expect(runReleasePlan(["--repo", root, "--base", base])).toHaveProperty("proposals");
    put(root, "components/core/src/unknown.ts", "export {};\n");
    expect(buildReleasePlan(root, base).proposals.find((item) => item.component === "core")?.humanReview).toBe(true);
  });
  test("component path renames retain both base and candidate ownership", () => {
    const root = fixture();
    platform(root);
    const base = commit(root, "feat: baseline");
    rmSync(join(root, "components/app"), { recursive: true, force: true });
    put(
      root,
      "packages/product/package.json",
      JSON.stringify({ name: "@pi-platform/app", version: "2.0.0", private: true, type: "module" }),
    );
    put(root, "packages/product/src/index.ts", "export const app = true;\\n");
    put(
      root,
      "platform.json",
      JSON.stringify({
        schemaVersion: 1,
        components: {
          core: { path: "components/core", version: "1.2.3", dependencies: [] },
          app: { path: "packages/product", version: "2.0.0", dependencies: ["core"] },
        },
      }),
    );
    expect(planChange(root, base).components).toEqual(["app", "core"]);
  });
  test("deleted component paths remain selected using the base ownership graph", () => {
    const root = fixture();
    platform(root);
    const base = commit(root, "feat: baseline");
    rmSync(join(root, "components/app"), { recursive: true, force: true });
    put(
      root,
      "platform.json",
      JSON.stringify({
        schemaVersion: 1,
        components: { core: { path: "components/core", version: "1.2.3", dependencies: [] } },
      }),
    );
    expect(planChange(root, base).components).toContain("app");
    const removedRelease = buildReleasePlan(root, base).proposals.find((item) => item.component === "app");
    expect(removedRelease).toMatchObject({ bump: "review", humanReview: true, currentVersion: "2.0.0" });
  });
  test("reports malformed component manifests, package contracts, and dependency violations", () => {
    const root = fixture();
    platform(root);
    put(root, ".github/workflows/ci.yml", "name: baseline\\n");
    const base = commit(root, "feat: baseline");
    const codes = (): string[] => checkPolicy(root, base).issues.map((issue) => issue.code);

    put(root, "platform.json", "{");
    expect(codes()).toContain("platform-json");
    put(root, "platform.json", JSON.stringify({ schemaVersion: 1, components: [] }));
    expect(codes()).toContain("platform-shape");
    put(root, "platform.json", JSON.stringify({ schemaVersion: 1, components: { broken: {} } }));
    expect(codes()).toContain("component-shape");
    expect(codes()).toContain("core-missing");
    put(
      root,
      "platform.json",
      JSON.stringify({
        schemaVersion: 1,
        components: {
          core: { path: "../outside", version: "1.2.3", dependencies: [] },
        },
      }),
    );
    expect(codes()).toContain("component-path");

    platform(root);
    rmSync(join(root, "components/app/src"), { recursive: true, force: true });
    expect(codes()).toContain("source-missing");
    put(root, "components/app/src/index.ts", "export {};");
    rmSync(join(root, "components/app/package.json"));
    expect(codes()).toContain("package-missing");
    put(root, "components/app/package.json", "{");
    expect(codes()).toContain("package-json");
    put(
      root,
      "components/app/package.json",
      JSON.stringify({ name: "wrong", version: "1", private: false, type: "commonjs" }),
    );
    expect(codes()).toContain("package-contract");

    put(
      root,
      "components/app/package.json",
      JSON.stringify({ name: "@pi-platform/app", version: "2.0.0", private: true, type: "module" }),
    );
    put(
      root,
      "platform.json",
      JSON.stringify({
        schemaVersion: 1,
        components: {
          core: { path: "components/core", version: "1.2.3", dependencies: ["missing", "app", "app"] },
          app: { path: "components/core", version: "2.0.0", dependencies: ["core"] },
        },
      }),
    );
    expect(codes()).toContain("component-dependency");
    expect(codes()).toContain("dependency-duplicate");
    expect(codes()).toContain("component-path-overlap");
    expect(codes()).toContain("core-dependency");
    expect(codes()).toContain("dependency-cycle");

    platform(root);
    put(
      root,
      "platform.json",
      JSON.stringify({
        schemaVersion: 1,
        components: {
          core: { path: "components/core", version: "1.2.3", dependencies: [] },
          app: { path: "components/app", version: "2.0.0", dependencies: ["core"] },
        },
      }),
    );
    put(root, "platform-policy.json", JSON.stringify({ ...policy, allowedDependencies: { core: [], app: [] } }));
    expect(codes()).toContain("dependency-not-allowed");
    put(
      root,
      "platform-policy.json",
      JSON.stringify({ ...policy, allowedDependencies: { core: [], app: ["core"], ghost: [] } }),
    );
    expect(codes()).toContain("allowlist-unknown-component");
    put(root, "platform-checks.json", "{");
    expect(codes()).toContain("checks-json");
    put(root, "platform-checks.json", JSON.stringify({ schemaVersion: 1, checks: [{ id: "different", argv: ["x"] }] }));
    expect(codes()).toContain("checks-changed");
    put(root, ".github/workflows/ci.yml", "name: changed\\n");
    expect(codes()).toContain("protected-enforcement-change");
  });

  test("runs command entrypoints and safely writes planner output", () => {
    const root = fixture();
    platform(root);
    put(root, "modules/home.nix", "{ programs.home-manager.enable = true; }\\n");
    const base = commit(root, "feat: baseline");
    const other = fixture();
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const exitCode = process.exitCode;
    try {
      checkPolicyMain(["--help"]);
      checkPolicyMain(["--repo", root, "--base", base]);
      homeManagerMain(["--help"]);
      homeManagerMain(["--repo", root, "--platform", other]);
      inventoryMain(["--help"]);
      inventoryMain(["--repo", root]);
      planChangeMain(["--help"]);
      planChangeMain(["--repo", root, "--base", base]);
      const changeOutput = join(root, "reports", "change.json");
      expect(runPlanChange(["--repo", root, "--base", base, "--out", changeOutput, "--dry-run"])).toHaveProperty(
        "dryRun",
        true,
      );
      runPlanChange(["--repo", root, "--base", base, "--out", changeOutput]);
      expect(() => runPlanChange(["--repo", root, "--base", base, "--out", changeOutput])).toThrow(/overwrite/);
      releasePlanMain(["--help"]);
      releasePlanMain(["--repo", root, "--base", base]);
      const releaseOutput = join(root, "reports", "release.json");
      expect(runReleasePlan(["--repo", root, "--base", base, "--out", releaseOutput, "--dry-run"])).toHaveProperty(
        "dryRun",
        true,
      );
      runReleasePlan(["--repo", root, "--base", base, "--out", releaseOutput]);
      expect(() => runReleasePlan(["--repo", root, "--base", base, "--out", releaseOutput])).toThrow(/overwrite/);
      const output = join(root, "reports", "home.json");
      expect(runHomeManagerPlan(["--repo", root, "--platform", other, "--out", output, "--dry-run"])).toHaveProperty(
        "dryRun",
        true,
      );
      runHomeManagerPlan(["--repo", root, "--platform", other, "--out", output]);
      expect(() => runHomeManagerPlan(["--repo", root, "--platform", other, "--out", output])).toThrow(/overwrite/);
      checkPolicyMain(["--bad"]);
      homeManagerMain(["--bad"]);
      inventoryMain(["--bad"]);
      planChangeMain(["--bad"]);
      releasePlanMain(["--bad"]);
    } finally {
      process.exitCode = exitCode;
      stdout.mockRestore();
      stderr.mockRestore();
    }
  });

  test("home manager planner reports missing, unique, and ambiguous module layouts", () => {
    const config = fixture();
    const platformRepo = fixture();
    put(
      config,
      "flake.nix",
      '{ flake-file.inputs.pi.url = "github:example/pi"; flake.modules.homeManager.default = {}; }\n',
    );
    put(config, "packages/agents/pi/home.nix", "{ imports = [ ./skills/default.nix ]; }\n");
    expect(makeHomeManagerPlan(config, platformRepo).status).toBe("ready-to-review");
    put(config, "modules/home.nix", "{ home-manager.users.alice = {}; }\n");
    expect(makeHomeManagerPlan(config, platformRepo).status).toBe("ambiguous-module-location");
    rmSync(join(config, "packages/agents/pi/home.nix"));
    const ready = makeHomeManagerPlan(config, platformRepo);
    expect(ready.status).toBe("ready-to-review");
    expect(ready.flakeHomeManagerDeclarations.join(" ")).toContain("flake-file.inputs.pi");
    put(config, "home/module.nix", "{ programs.home-manager.enable = true; }\n");
    const ambiguous = makeHomeManagerPlan(config, platformRepo);
    expect(ambiguous.status).toBe("ambiguous-module-location");
    expect(ambiguous.flakeFiles).toContain("flake.nix");
    expect(ambiguous.edits.some((edit) => edit.action === "review-read-only-composition")).toBe(true);
  });
});
