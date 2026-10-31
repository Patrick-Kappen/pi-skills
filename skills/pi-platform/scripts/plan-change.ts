#!/usr/bin/env node
// Usage: node plan-change.ts --repo PATH --base REF [--out FILE] [--dry-run]
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { gitFile, gitText, isRecord, parseArgs, readJson, required, safeRepo, writeNewFile } from "./lib-policy.ts";

export interface ChangePlan {
  schemaVersion: 1;
  base: string;
  changedFiles: string[];
  selection: "components" | "docs-only" | "all-tooling";
  components: string[];
  reason: string;
}
type Components = Record<string, { path: string; dependencies: string[] }>;
function parseComponent(id: string, item: unknown, label: string): Components[string] {
  if (
    !/^[a-z][a-z0-9-]*$/.test(id) ||
    !isRecord(item) ||
    typeof item.path !== "string" ||
    !Array.isArray(item.dependencies) ||
    !item.dependencies.every((dep) => typeof dep === "string")
  )
    throw new Error(`${label} has malformed component ${id}`);
  const path = item.path.replaceAll("\\\\", "/");
  if (path.startsWith("/") || path.split("/").some((part) => part === "" || part === "." || part === ".."))
    throw new Error(`${label} has unsafe component path: ${id}`);
  return { path, dependencies: item.dependencies as string[] };
}

function pathsOverlap(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function validateComponentGraph(components: Components, label: string): void {
  const entries = Object.entries(components);
  for (let index = 0; index < entries.length; index += 1) {
    const [id, component] = entries[index] as [string, Components[string]];
    if (component.dependencies.some((dep) => !Object.hasOwn(components, dep)))
      throw new Error(`${label} component ${id} depends on an unknown component`);
    for (let otherIndex = index + 1; otherIndex < entries.length; otherIndex += 1) {
      const [other, target] = entries[otherIndex] as [string, Components[string]];
      if (pathsOverlap(component.path, target.path))
        throw new Error(`${label} component paths overlap: ${id}, ${other}`);
    }
  }
}

function parseManifest(raw: unknown, label: string): Components {
  if (!isRecord(raw) || raw.schemaVersion !== 1 || !isRecord(raw.components))
    throw new Error(`${label} platform.json is missing or malformed`);
  const components: Components = {};
  for (const [id, item] of Object.entries(raw.components)) components[id] = parseComponent(id, item, label);
  validateComponentGraph(components, label);
  return components;
}
export function changedPaths(repo: string, base: string): string[] {
  gitText(repo, ["rev-parse", "--verify", "--end-of-options", `${base}^{commit}`]);
  const records = gitText(repo, ["diff", "--name-status", "-z", "--diff-filter=ACDMRTUXB", base, "--"])
    .split("\0")
    .filter(Boolean);
  const changed: string[] = [];
  for (let i = 0; i < records.length; ) {
    const status = records[i++] as string;
    const count = /^[RC]/.test(status) ? 2 : 1;
    for (let n = 0; n < count; n += 1) {
      const path = records[i++];
      if (path) changed.push(path);
    }
  }
  changed.push(...gitText(repo, ["ls-files", "-z", "--others", "--exclude-standard"]).split("\0").filter(Boolean));
  return [...new Set(changed)].sort();
}
function componentSet(raw: unknown, label: string): Components {
  return parseManifest(raw, label);
}
type CombinedComponent = { paths: string[]; dependencies: string[] };

function combineComponents(baseline: Components, current: Components): Record<string, CombinedComponent> {
  const combined: Record<string, CombinedComponent> = {};
  for (const [id, component] of [...Object.entries(baseline), ...Object.entries(current)]) {
    const prior = combined[id] ?? { paths: [], dependencies: [] };
    combined[id] = {
      paths: [...new Set([...prior.paths, component.path])],
      dependencies: [...new Set([...prior.dependencies, ...component.dependencies])],
    };
  }
  return combined;
}

function selectChangedComponents(
  files: string[],
  components: Record<string, CombinedComponent>,
): { touched: Set<string>; nonDocs: string[] } {
  const touched = new Set<string>();
  const nonDocs: string[] = [];
  for (const file of files) {
    const owners = Object.entries(components).filter(([, component]) =>
      component.paths.some((path) => file === path || file.startsWith(`${path}/`)),
    );
    for (const [id] of owners) touched.add(id);
    if (!owners.length && !/\.(?:md|mdx|rst|adoc)$/i.test(file)) nonDocs.push(file);
  }
  return { touched, nonDocs };
}

function includeReverseDependants(components: Record<string, CombinedComponent>, touched: Set<string>): void {
  const queue = [...touched];
  while (queue.length) {
    const dependency = queue.shift();
    if (dependency === undefined) continue;
    for (const [id, component] of Object.entries(components)) {
      if (component.dependencies.includes(dependency) && !touched.has(id)) {
        touched.add(id);
        queue.push(id);
      }
    }
  }
}

export function planChange(repoInput: string, base: string): ChangePlan {
  const repo = safeRepo(repoInput);
  gitText(repo, ["rev-parse", "--verify", "--end-of-options", `${base}^{commit}`]);
  const candidatePath = join(repo, "platform.json");
  if (!existsSync(candidatePath)) throw new Error("platform.json is required; refusing an empty test selection");
  const current = componentSet(readJson(candidatePath), "candidate");
  const baseText = gitFile(repo, base, "platform.json");
  if (baseText === undefined) throw new Error(`base ${base} has no platform.json; refusing an empty test selection`);
  const baseline = componentSet(JSON.parse(baseText) as unknown, "base");
  const files = changedPaths(repo, base);
  const components = combineComponents(baseline, current);
  const { touched, nonDocs } = selectChangedComponents(files, components);
  let selection: ChangePlan["selection"] = "components";
  let reason = "component changes and reverse dependants; docs and policy checks remain required";
  if (nonDocs.length) {
    selection = "all-tooling";
    reason = "shared, tooling, or unowned changes require full checks";
    for (const id of Object.keys(components)) touched.add(id);
  } else if (!touched.size && files.length) {
    selection = "docs-only";
    reason = "documentation changes still require policy and documentation checks";
  }
  includeReverseDependants(components, touched);
  return { schemaVersion: 1, base, changedFiles: files, selection, components: [...touched].sort(), reason };
}
export function runPlanChange(argv: string[]): ChangePlan | { dryRun: true; output: string } {
  const args = parseArgs(argv, ["repo", "base", "out"], ["dry-run"]);
  const plan = planChange(required(args, "repo"), required(args, "base"));
  const out = args.get("out");
  if (typeof out === "string") {
    writeNewFile(out, `${JSON.stringify(plan, null, 2)}\n`, args.has("dry-run"));
    if (args.has("dry-run")) return { dryRun: true, output: relative(process.cwd(), out) };
  }
  return plan;
}
export function main(argv = process.argv.slice(2)): void {
  if (argv.includes("--help"))
    return void process.stdout.write("Usage: plan-change.ts --repo PATH --base REF [--out FILE] [--dry-run]\n");
  try {
    process.stdout.write(`${JSON.stringify(runPlanChange(argv), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`plan-change: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
if (import.meta.url === `file://${process.argv[1]}`) main();
