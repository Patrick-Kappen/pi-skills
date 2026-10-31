#!/usr/bin/env node
// Usage: node release-plan.ts --repo PATH --base REF [--out FILE] [--dry-run]
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import {
  gitText,
  isRecord,
  parseArgs,
  readJson,
  required,
  safeRelative,
  safeRepo,
  writeNewFile,
} from "./lib-policy.ts";
import { planChange } from "./plan-change.ts";

export interface ReleaseProposal {
  component: string;
  currentVersion: string;
  proposedVersion: string;
  bump: "patch" | "minor" | "major" | "review";
  evidence: string[];
  humanReview: boolean;
}
export interface ReleasePlan {
  schemaVersion: 1;
  base: string;
  proposals: ReleaseProposal[];
  sideEffects: string[];
}

type CommitEvidence = { message: string; paths: string[] };
type ReleaseComponent = { version: string; path: string };

function versionParts(value: string): [number, number, number] | undefined {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value);
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function bumped(version: string, bump: "patch" | "minor" | "major"): string {
  const parts = versionParts(version);
  if (!parts) throw new Error(`invalid component version: ${version}`);
  if (bump === "major") return `${parts[0] + 1}.0.0`;
  if (bump === "minor") return `${parts[0]}.${parts[1] + 1}.0`;
  return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
}

function commitEvidence(repo: string, base: string): CommitEvidence[] {
  return gitText(repo, ["rev-list", `${base}..HEAD`])
    .split("\n")
    .filter(Boolean)
    .map((hash) => ({
      message: gitText(repo, ["show", "-s", "--format=%B", hash]).trim(),
      paths: gitText(repo, ["diff-tree", "--root", "--no-commit-id", "--name-only", "-r", "-z", hash])
        .split("\0")
        .filter(Boolean),
    }));
}

function uncommittedPaths(repo: string): Set<string> {
  const tracked = gitText(repo, ["diff", "--name-only", "-z", "HEAD", "--"]).split("\0");
  const untracked = gitText(repo, ["ls-files", "-z", "--others", "--exclude-standard"]).split("\0");
  return new Set([...tracked, ...untracked].filter(Boolean));
}

function inferredBump(ambiguity: boolean, breaking: boolean, feature: boolean, fix: boolean): ReleaseProposal["bump"] {
  if (ambiguity) return "review";
  if (breaking) return "major";
  if (feature) return "minor";
  if (fix) return "patch";
  return "review";
}

function proposalFor(
  repo: string,
  id: string,
  value: unknown,
  previous: unknown,
  change: ReturnType<typeof planChange>,
  commits: CommitEvidence[],
  uncommitted: Set<string>,
): ReleaseProposal {
  const removed = value === undefined;
  const source = removed ? previous : value;
  if (!isRecord(source) || typeof source.version !== "string" || typeof source.path !== "string")
    throw new Error(`invalid component metadata for ${id}`);
  if (!versionParts(source.version)) throw new Error(`invalid component version for ${id}: ${source.version}`);
  const component: ReleaseComponent = { version: source.version, path: source.path };
  const paths = [component.path, ...(isRecord(previous) && typeof previous.path === "string" ? [previous.path] : [])]
    .map((candidate) => safeRelative(repo, candidate))
    .filter((candidate): candidate is string => candidate !== undefined);
  if (!paths.length) throw new Error(`unsafe component path for ${id}`);
  const owns = (file: string): boolean => paths.some((path) => file === path || file.startsWith(`${path}/`));
  const files = change.changedFiles.filter(owns);
  const relevant = commits.filter((commit) => commit.paths.some(owns));
  const messages = relevant.map((commit) => commit.message);
  const breaking = messages.some((message) => /BREAKING CHANGE:|^[^\n]*!:/im.test(message));
  const feature = messages.some((message) => /^feat(?:\([^)]*\))?!?:/im.test(message));
  const fix = messages.some((message) => /^fix(?:\([^)]*\))?!?:/im.test(message));
  const ambiguous =
    removed ||
    files.length === 0 ||
    files.some((file) => uncommitted.has(file) || !relevant.some((commit) => commit.paths.includes(file)));
  const bump = inferredBump(ambiguous, breaking, feature, fix);
  return {
    component: id,
    currentVersion: component.version,
    proposedVersion: bump === "review" ? component.version : bumped(component.version, bump),
    bump,
    evidence: [...files, ...messages],
    humanReview: ambiguous || breaking || bump === "review",
  };
}

export function buildReleasePlan(repoInput: string, base: string): ReleasePlan {
  const repo = safeRepo(repoInput);
  const change = planChange(repo, base);
  const platformPath = join(repo, "platform.json");
  if (!existsSync(platformPath)) throw new Error("platform.json is required to propose releases");
  const platform: unknown = readJson(platformPath);
  if (!isRecord(platform) || !isRecord(platform.components)) throw new Error("platform.json has invalid components");
  gitText(repo, ["rev-parse", "--verify", "--end-of-options", `${base}^{commit}`]);
  const baselineText = gitText(repo, ["show", "--end-of-options", `${base}:platform.json`]);
  const baseline: unknown = JSON.parse(baselineText);
  if (!isRecord(baseline) || !isRecord(baseline.components))
    throw new Error(`base ${base} has an invalid platform manifest`);
  const baselineComponents = baseline.components;
  const components = platform.components;
  const commits = commitEvidence(repo, base);
  const uncommitted = uncommittedPaths(repo);
  const proposals = change.components.map((id) =>
    proposalFor(repo, id, components[id], baselineComponents[id], change, commits, uncommitted),
  );
  return {
    schemaVersion: 1,
    base,
    proposals,
    sideEffects: [
      "No tags, pushes, merges, or publishes are performed.",
      "Update dependent component versions and release metadata only after human review.",
    ],
  };
}

export function runReleasePlan(argv: string[]): ReleasePlan | { dryRun: true; output: string } {
  const args = parseArgs(argv, ["repo", "base", "out"], ["dry-run"]);
  const plan = buildReleasePlan(required(args, "repo"), required(args, "base"));
  const out = args.get("out");
  if (typeof out === "string") {
    writeNewFile(out, `${JSON.stringify(plan, null, 2)}\n`, args.has("dry-run"));
    if (args.has("dry-run")) return { dryRun: true, output: relative(process.cwd(), out) };
  }
  return plan;
}

export function main(argv = process.argv.slice(2)): void {
  if (argv.includes("--help"))
    return void process.stdout.write("Usage: release-plan.ts --repo PATH --base REF [--out FILE] [--dry-run]\n");
  try {
    process.stdout.write(`${JSON.stringify(runReleasePlan(argv), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`release-plan: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
if (import.meta.url === `file://${process.argv[1]}`) main();
