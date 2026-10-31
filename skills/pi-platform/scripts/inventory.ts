#!/usr/bin/env node
// Usage: node inventory.ts --repo PATH [--out FILE] [--dry-run]
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { gitText, isRecord, parseArgs, required, safeRelative, safeRepo, writeNewFile } from "./lib-policy.ts";

export interface Inventory {
  schemaVersion: 1;
  repo: string;
  sourceFiles: string[];
  manifests: string[];
  manifestMetadata: Array<{ path: string; name?: string; version?: string; private?: boolean; moduleType?: string }>;
  contracts: string[];
  contractMetadata: Record<string, unknown>;
  documentation: string[];
  scriptsAndWorkflows: string[];
  duplicateSourceHashes: Array<{ sha256: string; files: string[] }>;
}
const SOURCE = /\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts|py|go|rs|java|kt|swift|c|cc|cpp|h|hpp|cs|rb|sh)$/i;
const DOCUMENT = /(?:^|\/)(?:README|CONTRIBUTING|CHANGELOG|SECURITY|AGENTS)(?:\.[^/]*)?$|\.(?:md|mdx|rst|adoc)$/i;
function jsonFile(repo: string, path: string): unknown | undefined {
  try {
    return JSON.parse(readFileSync(join(repo, path), "utf8")) as unknown;
  } catch {
    return undefined;
  }
}
function repositoryPaths(repo: string): string[] {
  const tracked = gitText(repo, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"])
    .split("\0")
    .filter(Boolean);
  return [...new Set(tracked)]
    .map((path) => safeRelative(repo, path))
    .filter((path): path is string => path !== undefined)
    .sort();
}

function duplicateHashes(repo: string, sourceFiles: string[]): Inventory["duplicateSourceHashes"] {
  const hashes = new Map<string, string[]>();
  for (const path of sourceFiles) {
    const full = join(repo, path);
    if (!existsSync(full)) continue;
    const digest = createHash("sha256").update(readFileSync(full)).digest("hex");
    hashes.set(digest, [...(hashes.get(digest) ?? []), path]);
  }
  return [...hashes].filter(([, files]) => files.length > 1).map(([sha256, files]) => ({ sha256, files }));
}

function manifestMetadata(repo: string, manifests: string[]): Inventory["manifestMetadata"] {
  return manifests.flatMap((path) => {
    if (!path.endsWith("package.json")) return [];
    const value = jsonFile(repo, path);
    if (!isRecord(value)) return [];
    return [
      {
        path,
        ...(typeof value.name === "string" ? { name: value.name } : {}),
        ...(typeof value.version === "string" ? { version: value.version } : {}),
        ...(typeof value.private === "boolean" ? { private: value.private } : {}),
        ...(typeof value.type === "string" ? { moduleType: value.type } : {}),
      },
    ];
  });
}

function componentMetadata(value: unknown): unknown[] {
  if (!isRecord(value)) return [];
  return Object.entries(value).map(([id, raw]) => ({
    id,
    ...(isRecord(raw) && typeof raw.path === "string" ? { path: raw.path } : {}),
    ...(isRecord(raw) && typeof raw.version === "string" ? { version: raw.version } : {}),
  }));
}

function contractData(path: string, value: Record<string, unknown>): unknown {
  if (path.endsWith("platform.json"))
    return { schemaVersion: value.schemaVersion, components: componentMetadata(value.components) };
  if (path.endsWith("platform-policy.json"))
    return {
      schemaVersion: value.schemaVersion,
      coverage: value.coverage,
      maxDuplicatePercent: value.maxDuplicatePercent,
      maxComplexity: value.maxComplexity,
    };
  const checks = Array.isArray(value.checks)
    ? value.checks.map((check) => (isRecord(check) ? { id: check.id, needs: check.needs } : null))
    : [];
  return { schemaVersion: value.schemaVersion, checks };
}

function contractMetadata(repo: string, contracts: string[]): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  for (const path of contracts) {
    const value = jsonFile(repo, path);
    metadata[path] = isRecord(value) ? contractData(path, value) : { validJson: false };
  }
  return metadata;
}

export function collectInventory(input: string): Inventory {
  const repo = safeRepo(input);
  const paths = repositoryPaths(repo);
  const sourceFiles = paths.filter((path) => SOURCE.test(path) && !path.startsWith("node_modules/"));
  const manifests = paths.filter((path) =>
    /(^|\/)(?:package\.json|Cargo\.toml|go\.mod|pyproject\.toml|pom\.xml|build\.gradle(?:\.kts)?)$/.test(path),
  );
  const contracts = paths.filter((path) => /(^|\/)(?:platform|platform-policy|platform-checks)\.json$/.test(path));
  return {
    schemaVersion: 1,
    repo: ".",
    sourceFiles,
    manifests,
    manifestMetadata: manifestMetadata(repo, manifests),
    contracts,
    contractMetadata: contractMetadata(repo, contracts),
    documentation: paths.filter((path) => DOCUMENT.test(path)),
    scriptsAndWorkflows: paths.filter((path) => /(^|\/)(?:scripts|\.github\/workflows)\//.test(path)),
    duplicateSourceHashes: duplicateHashes(repo, sourceFiles),
  };
}
export function runInventory(argv: string[]): Inventory | { dryRun: true; output: string } {
  const args = parseArgs(argv, ["repo", "out"], ["dry-run"]);
  const inventory = collectInventory(required(args, "repo"));
  const output = args.get("out");
  if (typeof output === "string") {
    writeNewFile(output, `${JSON.stringify(inventory, null, 2)}\n`, args.has("dry-run"));
    if (args.has("dry-run")) return { dryRun: true, output: relative(process.cwd(), output) };
  }
  return inventory;
}
export function main(argv = process.argv.slice(2)): void {
  if (argv.includes("--help"))
    return void process.stdout.write("Usage: inventory.ts --repo PATH [--out FILE] [--dry-run]\n");
  try {
    process.stdout.write(`${JSON.stringify(runInventory(argv), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`inventory: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
if (import.meta.url === `file://${process.argv[1]}`) main();
