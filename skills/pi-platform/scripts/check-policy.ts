#!/usr/bin/env node
// Usage: node check-policy.ts --repo PATH --base REF [--policy FILE]
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  COMPLEXITY_CEILING,
  COVERAGE_FLOOR,
  DUPLICATE_CEILING,
  gitFile,
  gitText,
  isRecord,
  parseArgs,
  readJson,
  required,
  safeRelative,
  safeRepo,
} from "./lib-policy.ts";

export interface PolicyIssue {
  code: string;
  message: string;
}
export interface PolicyReport {
  schemaVersion: 1;
  ok: boolean;
  base: string;
  issues: PolicyIssue[];
  limitations: string[];
}
export function validatePolicy(value: unknown): PolicyIssue[] {
  const issues: PolicyIssue[] = [];
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    !isRecord(value.coverage) ||
    !isRecord(value.allowedDependencies)
  ) {
    return [
      { code: "policy-shape", message: "policy must be schemaVersion 1 with coverage and allowedDependencies objects" },
    ];
  }
  const coverage = value.coverage;
  for (const [key, floor] of Object.entries(COVERAGE_FLOOR)) {
    if (
      typeof coverage[key] !== "number" ||
      !Number.isFinite(coverage[key]) ||
      coverage[key] < floor ||
      coverage[key] > 100
    )
      issues.push({ code: "coverage-floor", message: `${key} must be between ${floor} and 100` });
  }
  if (
    typeof value.maxDuplicatePercent !== "number" ||
    !Number.isFinite(value.maxDuplicatePercent) ||
    value.maxDuplicatePercent < 0 ||
    value.maxDuplicatePercent > DUPLICATE_CEILING
  )
    issues.push({ code: "duplicate-ceiling", message: `maxDuplicatePercent cannot exceed ${DUPLICATE_CEILING}` });
  if (
    typeof value.maxComplexity !== "number" ||
    !Number.isFinite(value.maxComplexity) ||
    value.maxComplexity < 1 ||
    value.maxComplexity > COMPLEXITY_CEILING
  )
    issues.push({ code: "complexity-ceiling", message: `maxComplexity cannot exceed ${COMPLEXITY_CEILING}` });
  for (const [id, deps] of Object.entries(value.allowedDependencies))
    if (!Array.isArray(deps) || deps.some((dep) => typeof dep !== "string"))
      issues.push({ code: "allowlist", message: `allowedDependencies.${id} must be a string array` });
  return issues;
}

type ManifestComponent = Record<string, unknown> & { path: string; version: string; dependencies: unknown[] };

function isManifestComponent(value: unknown): value is ManifestComponent {
  return (
    isRecord(value) &&
    typeof value.path === "string" &&
    typeof value.version === "string" &&
    /^[0-9]+\.[0-9]+\.[0-9]+$/.test(value.version) &&
    Array.isArray(value.dependencies)
  );
}

function validateComponentPackage(repo: string, id: string, component: ManifestComponent): PolicyIssue[] {
  const packagePath = join(repo, component.path, "package.json");
  if (!existsSync(packagePath)) return [{ code: "package-missing", message: `component ${id} has no package.json` }];
  try {
    const pkg: unknown = JSON.parse(readFileSync(packagePath, "utf8"));
    if (
      !isRecord(pkg) ||
      pkg.name !== `@pi-platform/${id}` ||
      pkg.version !== component.version ||
      pkg.private !== true ||
      pkg.type !== "module"
    )
      return [
        { code: "package-contract", message: `${id}/package.json must match platform name/version and be private ESM` },
      ];
  } catch {
    return [{ code: "package-json", message: `component ${id} package.json is invalid JSON` }];
  }
  return [];
}

function validateManifestComponent(
  repo: string,
  components: Record<string, unknown>,
  id: string,
  raw: unknown,
): PolicyIssue[] {
  if (!/^[a-z][a-z0-9-]*$/.test(id) || !isManifestComponent(raw))
    return [{ code: "component-shape", message: `component ${id} needs path, version, and dependencies` }];
  if (!safeRelative(repo, raw.path)) return [{ code: "component-path", message: `component ${id} has an unsafe path` }];
  const issues: PolicyIssue[] = [];
  if (!raw.dependencies.every((dep) => typeof dep === "string" && Object.hasOwn(components, dep)))
    issues.push({ code: "component-dependency", message: `component ${id} references an unknown dependency` });
  if (!existsSync(join(repo, raw.path, "src")))
    issues.push({ code: "source-missing", message: `${id} must contain source under src/` });
  if (new Set(raw.dependencies).size !== raw.dependencies.length)
    issues.push({ code: "dependency-duplicate", message: `${id} has duplicate dependencies` });
  issues.push(...validateComponentPackage(repo, id, raw));
  return issues;
}

function pathsOverlap(left: unknown, right: unknown): boolean {
  if (!isRecord(left) || !isRecord(right) || typeof left.path !== "string" || typeof right.path !== "string")
    return false;
  return left.path === right.path || left.path.startsWith(`${right.path}/`) || right.path.startsWith(`${left.path}/`);
}

function validatePathOverlaps(components: Record<string, unknown>): PolicyIssue[] {
  const issues: PolicyIssue[] = [];
  const entries = Object.entries(components);
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const [leftId, left] = entries[i] as [string, unknown];
      const [rightId, right] = entries[j] as [string, unknown];
      if (pathsOverlap(left, right))
        issues.push({ code: "component-path-overlap", message: `component paths overlap: ${leftId}, ${rightId}` });
    }
  }
  return issues;
}

function validateManifest(repo: string): PolicyIssue[] {
  const path = join(repo, "platform.json");
  if (!existsSync(path)) return [{ code: "platform-missing", message: "platform.json is required" }];
  let data: unknown;
  try {
    data = readJson(path);
  } catch {
    return [{ code: "platform-json", message: "platform.json is not valid JSON" }];
  }
  if (!isRecord(data) || data.schemaVersion !== 1 || !isRecord(data.components))
    return [{ code: "platform-shape", message: "platform.json must have schemaVersion 1 and components" }];
  const components = data.components;
  const issues = Object.entries(components).flatMap(([id, raw]) =>
    validateManifestComponent(repo, components, id, raw),
  );
  if (!Object.hasOwn(components, "core"))
    issues.push({ code: "core-missing", message: "platform.json must include core" });
  issues.push(...validatePathOverlaps(components));
  const core = components.core;
  if (isRecord(core) && Array.isArray(core.dependencies) && core.dependencies.length)
    issues.push({ code: "core-dependency", message: "core cannot depend on domain components" });
  return issues;
}

function checkIssue(value: unknown, ids: Set<string>, graph: Map<string, string[]>): PolicyIssue[] {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !/^[a-z][a-z0-9-]*$/.test(value.id) ||
    !Array.isArray(value.argv) ||
    value.argv.length === 0 ||
    value.argv.some((arg) => typeof arg !== "string" || arg.length === 0)
  )
    return [{ code: "check-command", message: "each check needs a valid id and nonempty string argv" }];
  const issues: PolicyIssue[] = [];
  if (ids.has(value.id)) issues.push({ code: "check-duplicate", message: `duplicate check id ${value.id}` });
  ids.add(value.id);
  const needs = value.needs === undefined ? [] : value.needs;
  if (!Array.isArray(needs) || needs.some((id) => typeof id !== "string")) {
    issues.push({ code: "check-needs", message: `${value.id} needs must be a string array` });
    graph.set(value.id, []);
  } else graph.set(value.id, needs as string[]);
  if (
    value.timeoutSeconds !== undefined &&
    (typeof value.timeoutSeconds !== "number" || !Number.isFinite(value.timeoutSeconds) || value.timeoutSeconds < 1)
  )
    issues.push({ code: "check-timeout", message: `${value.id} timeoutSeconds must be positive` });
  return issues;
}

function validateCheckDependencies(graph: Map<string, string[]>, ids: Set<string>): PolicyIssue[] {
  const issues: PolicyIssue[] = [];
  for (const [id, needs] of graph) {
    for (const dependency of needs) {
      if (!ids.has(dependency))
        issues.push({ code: "check-missing-dependency", message: `${id} requires missing check ${dependency}` });
    }
  }
  return issues;
}

function validateCheckCycles(graph: Map<string, string[]>): PolicyIssue[] {
  const issues: PolicyIssue[] = [];
  const active = new Set<string>();
  const done = new Set<string>();
  const visit = (id: string): void => {
    if (active.has(id)) {
      issues.push({ code: "check-cycle", message: `check dependency cycle includes ${id}` });
      return;
    }
    if (done.has(id)) return;
    active.add(id);
    for (const dependency of graph.get(id) ?? []) if (graph.has(dependency)) visit(dependency);
    active.delete(id);
    done.add(id);
  };
  for (const id of graph.keys()) visit(id);
  return issues;
}

export function validateChecks(value: unknown): PolicyIssue[] {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.checks))
    return [{ code: "checks-shape", message: "platform-checks.json must use schemaVersion 1 and a checks array" }];
  const issues: PolicyIssue[] = [];
  const ids = new Set<string>();
  const graph = new Map<string, string[]>();
  if (value.checks.length === 0)
    issues.push({ code: "checks-empty", message: "at least one required check must be configured" });
  for (const check of value.checks) issues.push(...checkIssue(check, ids, graph));
  issues.push(...validateCheckDependencies(graph, ids), ...validateCheckCycles(graph));
  return issues;
}

function noCycles(raw: unknown): PolicyIssue[] {
  if (!isRecord(raw) || !isRecord(raw.components)) return [];
  const graph = raw.components;
  const active = new Set<string>();
  const done = new Set<string>();
  const issues: PolicyIssue[] = [];
  const visit = (id: string): void => {
    if (active.has(id)) {
      issues.push({ code: "dependency-cycle", message: `component dependency cycle includes ${id}` });
      return;
    }
    if (done.has(id)) return;
    const node = graph[id];
    if (!isRecord(node) || !Array.isArray(node.dependencies)) return;
    active.add(id);
    for (const dep of node.dependencies) if (typeof dep === "string" && Object.hasOwn(graph, dep)) visit(dep);
    active.delete(id);
    done.add(id);
  };
  for (const id of Object.keys(graph)) visit(id);
  return issues;
}

function validateComponentAllowlist(id: string, raw: unknown, allow: unknown): PolicyIssue[] {
  if (!Array.isArray(allow) || allow.some((item) => typeof item !== "string"))
    return [{ code: "allowlist-component", message: `allowedDependencies.${id} must be declared as a string array` }];
  if (!isRecord(raw) || !Array.isArray(raw.dependencies)) return [];
  return raw.dependencies.flatMap((dependency) =>
    typeof dependency === "string" && !allow.includes(dependency)
      ? [
          {
            code: "dependency-not-allowed",
            message: `${id} dependency ${dependency} is absent from allowedDependencies`,
          },
        ]
      : [],
  );
}

function validateManifestAllowlist(manifest: unknown, candidate: unknown): PolicyIssue[] {
  if (
    !isRecord(manifest) ||
    !isRecord(manifest.components) ||
    !isRecord(candidate) ||
    !isRecord(candidate.allowedDependencies)
  )
    return [];
  const allowedDependencies = candidate.allowedDependencies;
  const issues = Object.entries(manifest.components).flatMap(([id, raw]) =>
    validateComponentAllowlist(id, raw, allowedDependencies[id]),
  );
  for (const id of Object.keys(allowedDependencies)) {
    if (!Object.hasOwn(manifest.components, id))
      issues.push({ code: "allowlist-unknown-component", message: `allowedDependencies.${id} has no component` });
  }
  return issues;
}

function validateManifestDependencies(repo: string, candidate: unknown): PolicyIssue[] {
  const platformPath = join(repo, "platform.json");
  if (!existsSync(platformPath)) return [];
  let manifest: unknown;
  try {
    manifest = readJson(platformPath);
  } catch {
    manifest = undefined;
  }
  return [...noCycles(manifest), ...validateManifestAllowlist(manifest, candidate)];
}

function validateAllowlistNarrowing(candidate: unknown, trusted: unknown): PolicyIssue[] {
  if (
    !isRecord(candidate) ||
    !isRecord(trusted) ||
    !isRecord(candidate.allowedDependencies) ||
    !isRecord(trusted.allowedDependencies)
  )
    return [];
  const issues: PolicyIssue[] = [];
  for (const [id, allow] of Object.entries(candidate.allowedDependencies)) {
    const prior = trusted.allowedDependencies[id];
    if (!Array.isArray(allow) || !Array.isArray(prior) || allow.some((dep) => !prior.includes(dep)))
      issues.push({
        code: "policy-weakened",
        message: `allowedDependencies.${id} may only narrow the trusted allowlist`,
      });
  }
  return issues;
}

function validatePolicyThresholds(candidate: unknown, trusted: unknown): PolicyIssue[] {
  if (!isRecord(candidate) || !isRecord(trusted)) return [];
  const issues: PolicyIssue[] = [];
  const candidateCoverage = candidate.coverage;
  const baseCoverage = trusted.coverage;
  if (isRecord(candidateCoverage) && isRecord(baseCoverage)) {
    for (const key of Object.keys(COVERAGE_FLOOR)) {
      if (
        typeof candidateCoverage[key] === "number" &&
        typeof baseCoverage[key] === "number" &&
        candidateCoverage[key] < baseCoverage[key]
      )
        issues.push({ code: "policy-weakened", message: `${key} coverage cannot be reduced below trusted base` });
    }
  }
  if (
    typeof candidate.maxDuplicatePercent === "number" &&
    typeof trusted.maxDuplicatePercent === "number" &&
    candidate.maxDuplicatePercent > trusted.maxDuplicatePercent
  )
    issues.push({ code: "policy-weakened", message: "maxDuplicatePercent cannot be raised above trusted base" });
  if (
    typeof candidate.maxComplexity === "number" &&
    typeof trusted.maxComplexity === "number" &&
    candidate.maxComplexity > trusted.maxComplexity
  )
    issues.push({ code: "policy-weakened", message: "maxComplexity cannot be raised above trusted base" });
  return issues;
}

function validateProtectedChanges(repo: string, base: string): PolicyIssue[] {
  const changed = gitText(repo, ["diff", "--name-only", "-z", "--diff-filter=ACDMRTUXB", base, "--"])
    .split("\0")
    .filter(
      (file) =>
        file === "platform-policy.json" ||
        file === "platform-checks.json" ||
        file.startsWith(".github/") ||
        file.startsWith("scripts/platform/") ||
        [
          "justfile",
          "devenv.nix",
          "devenv.yaml",
          "package.json",
          "package-lock.json",
          "biome.json",
          "tsconfig.json",
          "vitest.config.ts",
          "knip.json",
          ".dependency-cruiser.cjs",
        ].includes(file) ||
        file.startsWith("nix/devenv/") ||
        file.startsWith(".devenv/"),
    );
  if (!changed.length) return [];
  return [
    {
      code: "protected-enforcement-change",
      message: `policy, tooling, scanner, check, or workflow changes require trusted review: ${changed.join(", ")}`,
    },
  ];
}

function validateChecksFile(repo: string, base: string): PolicyIssue[] {
  const issues: PolicyIssue[] = [];
  const checksPath = join(repo, "platform-checks.json");
  if (!existsSync(checksPath)) issues.push({ code: "checks-missing", message: "platform-checks.json is required" });
  else {
    try {
      issues.push(...validateChecks(readJson(checksPath)));
    } catch {
      issues.push({ code: "checks-json", message: "platform-checks.json is invalid JSON" });
    }
  }
  const baselineChecks = gitFile(repo, base, "platform-checks.json");
  if (baselineChecks !== undefined && !existsSync(checksPath))
    issues.push({ code: "checks-missing", message: "platform-checks.json was removed from the candidate" });
  if (existsSync(checksPath) && baselineChecks !== undefined && readFileSync(checksPath, "utf8") !== baselineChecks)
    issues.push({
      code: "checks-changed",
      message: "platform-checks.json differs from trusted base and requires reviewed baseline update",
    });
  return issues;
}

function validateTrustedPolicy(trusted: unknown): PolicyIssue[] {
  const trustedIssues = validatePolicy(trusted);
  if (!trustedIssues.length) return [];
  return [
    {
      code: "untrusted-baseline",
      message: `trusted-base policy is invalid: ${trustedIssues.map((issue) => issue.code).join(", ")}`,
    },
  ];
}

export function checkPolicy(repoInput: string, base: string, policyArg?: string): PolicyReport {
  const repo = safeRepo(repoInput);
  gitText(repo, ["rev-parse", "--verify", `${base}^{commit}`]);
  const policyPath = policyArg ? safeRelative(repo, policyArg) : "platform-policy.json";
  if (!policyPath) throw new Error("--policy must be a safe repository-relative path");
  const candidateFile = join(repo, policyPath);
  if (!existsSync(candidateFile))
    throw new Error(`candidate policy ${policyPath} is missing; refusing fallback to the trusted baseline`);
  const candidate = JSON.parse(readFileSync(candidateFile, "utf8")) as unknown;
  const trustedText = gitFile(repo, base, policyPath);
  if (trustedText === undefined)
    throw new Error(`trusted base ${base} does not contain ${policyPath}; refusing bootstrap`);
  const trusted = JSON.parse(trustedText) as unknown;
  const issues = [
    ...validatePolicy(candidate),
    ...validateManifest(repo),
    ...validateManifestDependencies(repo, candidate),
    ...validateAllowlistNarrowing(candidate, trusted),
    ...validateProtectedChanges(repo, base),
    ...validateChecksFile(repo, base),
    ...validateTrustedPolicy(trusted),
    ...validatePolicyThresholds(candidate, trusted),
  ];
  return {
    schemaVersion: 1,
    ok: issues.length === 0,
    base,
    issues,
    limitations: [
      "Import topology requires a parser-aware dependency-cruiser CI gate; this script validates declared component relationships only.",
    ],
  };
}
export function main(args = process.argv.slice(2)): void {
  if (args.includes("--help"))
    return void process.stdout.write("Usage: check-policy.ts --repo PATH --base REF [--policy FILE]\n");
  try {
    const parsed = parseArgs(args, ["repo", "base", "policy"], []);
    const report = checkPolicy(
      required(parsed, "repo"),
      required(parsed, "base"),
      parsed.get("policy") as string | undefined,
    );
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.ok) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`check-policy: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
if (import.meta.url === `file://${process.argv[1]}`) main();
