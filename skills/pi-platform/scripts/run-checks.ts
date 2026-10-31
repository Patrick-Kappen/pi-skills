#!/usr/bin/env node
/** Usage: run-checks.ts --repo PATH [--manifest FILE] [--jobs N] [--only ID,ID] [--out-dir PATH] [--dry-run] */
import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, realpath } from "node:fs/promises";
import path from "node:path";

export type Check = { id: string; argv: string[]; needs?: string[]; timeoutSeconds?: number };
export type Manifest = { schemaVersion: 1; checks: Check[] };
export type CheckResult = {
  id: string;
  status: "passed" | "failed" | "timed-out" | "skipped";
  exitCode: number | null;
  log: string;
};

type Options = { repo: string; manifest?: string; jobs: number; only?: string[]; outDir?: string; dryRun: boolean };
function parseCheck(entry: unknown, ids: Set<string>): Check {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("each check must be an object");
  const check = entry as Record<string, unknown>;
  if (Object.keys(check).some((key) => !["id", "argv", "needs", "timeoutSeconds"].includes(key)))
    throw new Error("check has unknown fields");
  if (typeof check.id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(check.id) || ids.has(check.id))
    throw new Error(`invalid or duplicate check id: ${String(check.id)}`);
  ids.add(check.id);
  if (
    !Array.isArray(check.argv) ||
    check.argv.length === 0 ||
    check.argv.some((arg) => typeof arg !== "string" || !arg || arg.includes("\0"))
  )
    throw new Error(`${check.id}: argv must be a non-empty string array`);
  if (check.needs !== undefined && (!Array.isArray(check.needs) || check.needs.some((id) => typeof id !== "string")))
    throw new Error(`${check.id}: needs must be string[]`);
  if (
    check.timeoutSeconds !== undefined &&
    (typeof check.timeoutSeconds !== "number" || !Number.isFinite(check.timeoutSeconds) || check.timeoutSeconds <= 0)
  )
    throw new Error(`${check.id}: timeoutSeconds must be positive`);
  return {
    id: check.id,
    argv: check.argv as string[],
    ...(check.needs ? { needs: check.needs as string[] } : {}),
    ...(check.timeoutSeconds !== undefined ? { timeoutSeconds: check.timeoutSeconds } : {}),
  };
}

function validateDependencies(checks: Check[], ids: Set<string>): void {
  for (const check of checks) {
    for (const need of check.needs ?? []) {
      if (!ids.has(need)) throw new Error(`${check.id}: missing dependency ${need}`);
    }
  }
}

function validateCheckCycles(checks: Check[]): void {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(checks.map((check) => [check.id, check]));
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error(`dependency cycle involving ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id)?.needs ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const check of checks) visit(check.id);
}

export function validateManifest(input: unknown): Manifest {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("manifest must be an object");
  const value = input as Record<string, unknown>;
  if (value.schemaVersion !== 1 || !Array.isArray(value.checks) || value.checks.length === 0)
    throw new Error("manifest must have schemaVersion 1 and non-empty checks[]");
  if (Object.keys(value).some((key) => key !== "schemaVersion" && key !== "checks"))
    throw new Error("manifest has unknown fields");
  const ids = new Set<string>();
  const checks = value.checks.map((entry) => parseCheck(entry, ids));
  validateDependencies(checks, ids);
  validateCheckCycles(checks);
  return { schemaVersion: 1, checks };
}

export function selectChecks(manifest: Manifest, only?: string[]): Check[] {
  if (!only?.length) return manifest.checks;
  const byId = new Map(manifest.checks.map((check) => [check.id, check]));
  const selected = new Set<string>();
  const add = (id: string): void => {
    const check = byId.get(id);
    if (!check) throw new Error(`unknown check ${id}`);
    if (selected.has(id)) return;
    selected.add(id);
    for (const dependency of check.needs ?? []) add(dependency);
  };
  for (const id of only) add(id);
  return manifest.checks.filter((check) => selected.has(check.id));
}

function signalProcessGroup(child: ChildProcess, signalName: NodeJS.Signals): void {
  if (process.platform === "linux" && child.pid) {
    try {
      process.kill(-child.pid, signalName);
    } catch {
      // Process group already exited.
    }
  } else child.kill(signalName);
}

type MonitorState = { finished: boolean; timedOut: boolean; cancelled: boolean };

function checkStatus(timedOut: boolean, cancelled: boolean, code: number | null): CheckResult["status"] {
  if (timedOut) return "timed-out";
  if (cancelled) return "failed";
  return code === 0 ? "passed" : "failed";
}

function completeCheck(
  state: MonitorState,
  code: number | null,
  timer: NodeJS.Timeout,
  forceTimer: NodeJS.Timeout | undefined,
  signal: AbortSignal | undefined,
  abort: () => void,
  handle: Awaited<ReturnType<typeof open>>,
  check: Check,
  logPath: string,
  resolve: (result: CheckResult) => void,
): void {
  if (state.finished) return;
  state.finished = true;
  clearTimeout(timer);
  if (forceTimer) clearTimeout(forceTimer);
  signal?.removeEventListener("abort", abort);
  void handle.close();
  resolve({ id: check.id, status: checkStatus(state.timedOut, state.cancelled, code), exitCode: code, log: logPath });
}

function monitorCheck(
  check: Check,
  child: ChildProcess,
  handle: Awaited<ReturnType<typeof open>>,
  logPath: string,
  defaultTimeout: number,
  signal?: AbortSignal,
): Promise<CheckResult> {
  return new Promise((resolve) => {
    const state: MonitorState = { finished: false, timedOut: false, cancelled: false };
    let forceTimer: NodeJS.Timeout | undefined;
    const terminate = (timeout: boolean): void => {
      state.timedOut = timeout;
      state.cancelled = !timeout;
      signalProcessGroup(child, "SIGTERM");
      forceTimer = setTimeout(() => signalProcessGroup(child, "SIGKILL"), 1000);
      forceTimer.unref();
    };
    const abort = (): void => terminate(false);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    const timer = setTimeout(() => terminate(true), (check.timeoutSeconds ?? defaultTimeout) * 1000);
    const finish = (code: number | null): void =>
      completeCheck(state, code, timer, forceTimer, signal, abort, handle, check, logPath, resolve);
    child.once("error", (error) => {
      void handle.write(`${error.message}\n`).finally(() => finish(127));
    });
    child.once("close", finish);
  });
}

export async function executeCheck(
  check: Check,
  repo: string,
  logPath: string,
  defaultTimeout = 1800,
  signal?: AbortSignal,
): Promise<CheckResult> {
  const [executable, ...args] = check.argv;
  if (!executable) throw new Error(`${check.id}: command argv must not be empty`);
  const handle = await open(logPath, "wx", 0o600);
  const child = spawn(executable, args, {
    cwd: repo,
    shell: false,
    detached: process.platform !== "win32",
    stdio: ["ignore", handle.fd, handle.fd],
  });
  return monitorCheck(check, child, handle, logPath, defaultTimeout, signal);
}

async function scheduleChecks(
  checks: Check[],
  options: Options,
  repo: string,
  runDir: string,
): Promise<Map<string, CheckResult>> {
  const pending = new Map(checks.map((check) => [check.id, check]));
  const results = new Map<string, CheckResult>();
  const active = new Set<Promise<void>>();
  const abortController = new AbortController();
  const stop = (): void => abortController.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    while (pending.size || active.size) {
      const progress = launchReadyChecks(pending, results, active, options.jobs, repo, runDir, abortController.signal);
      if (active.size) await Promise.race(active);
      else if (pending.size && !progress) throw new Error("check graph cannot make progress");
    }
  } finally {
    abortController.abort();
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    await Promise.allSettled(active);
  }
  return results;
}

function resultsInOrder(checks: Check[], results: Map<string, CheckResult>): CheckResult[] {
  return checks.map((check) => {
    const result = results.get(check.id);
    if (!result) throw new Error(`check ${check.id} has no result`);
    return result;
  });
}

async function writeResults(runDir: string, results: CheckResult[]): Promise<void> {
  const resultFile = await open(path.join(runDir, "result.json"), "wx", 0o600);
  await resultFile.writeFile(
    `${JSON.stringify({ success: results.every((result) => result.status === "passed"), results }, null, 2)}\n`,
  );
  await resultFile.close();
}

function dryRunResults(checks: Check[], runDir: string): CheckResult[] {
  return checks.map((check) => ({
    id: check.id,
    status: "skipped",
    exitCode: null,
    log: path.join(runDir, `${check.id}.log`),
  }));
}

export async function runChecks(
  options: Options,
  input?: unknown,
): Promise<{ results: CheckResult[]; runDir: string }> {
  if (!Number.isInteger(options.jobs) || options.jobs < 1 || options.jobs > 64)
    throw new Error("jobs must be an integer from 1 to 64");
  const repo = await realpath(options.repo);
  const manifestFile = options.manifest ?? path.join(repo, "platform-checks.json");
  const manifest = validateManifest(input ?? JSON.parse(await readFile(manifestFile, "utf8")));
  const checks = selectChecks(manifest, options.only);
  const runDir =
    options.outDir ??
    path.join(
      process.env.XDG_CACHE_HOME ?? path.join(process.env.HOME ?? ".", ".cache"),
      "pi-platform",
      `checks-${Date.now()}-${randomUUID()}`,
    );
  if (options.dryRun) return { results: dryRunResults(checks, runDir), runDir };
  await mkdir(path.dirname(runDir), { recursive: true, mode: 0o700 });
  await mkdir(runDir, { recursive: false, mode: 0o700 });
  const results = resultsInOrder(checks, await scheduleChecks(checks, options, repo, runDir));
  await writeResults(runDir, results);
  return { results, runDir };
}

function launchReadyChecks(
  pending: Map<string, Check>,
  results: Map<string, CheckResult>,
  active: Set<Promise<void>>,
  concurrency: number,
  repo: string,
  runDir: string,
  signal: AbortSignal,
): boolean {
  let progress = false;
  for (const [id, check] of pending) {
    if (active.size >= concurrency) break;
    const dependencies = check.needs ?? [];
    const failedDependency = dependencies.some((dependency) => results.get(dependency)?.status !== "passed");
    if (failedDependency) {
      if (dependencies.every((dependency) => results.has(dependency))) {
        pending.delete(id);
        results.set(id, { id, status: "skipped", exitCode: null, log: path.join(runDir, `${id}.log`) });
        progress = true;
      }
      continue;
    }
    if (!dependencies.every((dependency) => results.get(dependency)?.status === "passed")) continue;
    pending.delete(id);
    progress = true;
    const work = executeCheck(check, repo, path.join(runDir, `${id}.log`), 1800, signal)
      .then((result) => {
        results.set(id, result);
      })
      .finally(() => active.delete(work));
    active.add(work);
  }
  return progress;
}

function optionValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value) throw new Error(`${flag} requires a value`);
  return value;
}

function parseOption(args: string[], index: number, out: Partial<Options>): number {
  const flag = args[index];
  if (!flag) throw new Error("empty argument");
  if (flag === "--dry-run") {
    out.dryRun = true;
    return index + 1;
  }
  const setters: Record<string, (value: string) => void> = {
    "--repo": (value) => {
      out.repo = value;
    },
    "--manifest": (value) => {
      out.manifest = value;
    },
    "--only": (value) => {
      out.only = value.split(",");
    },
    "--out-dir": (value) => {
      out.outDir = value;
    },
    "--jobs": (value) => {
      if (!/^\d+$/.test(value) || Number(value) < 1) throw new Error("--jobs must be positive");
      out.jobs = Number(value);
    },
  };
  const setter = setters[flag];
  if (setter) {
    setter(optionValue(args, index, flag));
    return index + 2;
  }
  if (flag === "--help")
    throw new Error(
      "usage: run-checks.ts --repo PATH [--manifest FILE] [--jobs N] [--only ID,ID] [--out-dir PATH] [--dry-run]",
    );
  throw new Error(`unknown option ${flag}`);
}

function parseArgs(args: string[]): Options {
  const out: Partial<Options> = { jobs: 1, dryRun: false };
  for (let index = 0; index < args.length; ) index = parseOption(args, index, out);
  if (!out.repo) throw new Error("--repo is required");
  return out as Options;
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  if (args.includes("--help")) {
    process.stdout.write(
      "usage: run-checks.ts --repo PATH [--manifest FILE] [--jobs N] [--only ID,ID] [--out-dir PATH] [--dry-run]\n",
    );
    return;
  }
  try {
    const result = await runChecks(parseArgs(args));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.results.some((entry) => entry.status !== "passed" && entry.status !== "skipped")) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
if (import.meta.url === `file://${process.argv[1] ?? ""}`) void main();
