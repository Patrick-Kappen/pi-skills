#!/usr/bin/env node
/** Usage: jobs.ts start --repo PATH --state-dir PATH --notify-json JSON_ARRAY [--dry-run] -- COMMAND ARGS...; jobs.ts status|cancel --state-dir PATH --id ID [--dry-run] */
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { accessSync, constants, readFileSync } from "node:fs";
import { chmod, lstat, mkdir, open, readFile, realpath, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type JobState = {
  schemaVersion: 1;
  id: string;
  nonce: string;
  pid: number;
  startedAt: string;
  repo: string;
  command: string[];
  status: "running" | "passed" | "failed" | "cancelled";
  resultPath: string;
  stdoutPath: string;
  stderrPath: string;
  notificationPath: string;
  taskOutcome?: "passed" | "failed" | "cancelled";
  notificationFailed?: boolean;
  exitCode?: number | null;
  finishedAt?: string;
};
export type Hooks = {
  kill?: (pid: number, signal: NodeJS.Signals) => void;
  isIdentityAlive?: (pid: number, nonce: string) => boolean;
};

type StartOptions = { repo: string; stateDir: string; notify: string[]; command: string[]; dryRun: boolean };
const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

export function validateNotification(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((part) => typeof part !== "string" || !part || part.includes("\0"))
  )
    throw new Error("--notify-json must be a non-empty JSON argv array");
  const cmd = value[0] as string;
  if (cmd.includes("/") || cmd.includes("\\")) {
    accessSyncExecutable(cmd);
  } else if (!process.env.PATH?.split(path.delimiter).some((dir) => canExecuteSync(path.join(dir, cmd))))
    throw new Error(`notification executable not found: ${cmd}`);
  return value as string[];
}
function canExecuteSync(file: string): boolean {
  try {
    requireAccess(file);
    return true;
  } catch {
    return false;
  }
}
function accessSyncExecutable(file: string): void {
  if (!canExecuteSync(file)) throw new Error(`notification executable is not executable: ${file}`);
}
function requireAccess(file: string): void {
  accessSync(file, constants.X_OK);
}

export function processIdentityAlive(pid: number, nonce: string): boolean {
  if (process.platform !== "linux") throw new Error("durable job identity checks are supported only on Linux");
  try {
    const cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf8");
    return cmdline.includes(nonce) && cmdline.includes("--supervise");
  } catch {
    return false;
  }
}

async function saveState(file: string, state: JobState): Promise<void> {
  const tmp = `${file}.${randomUUID()}.tmp`;
  const handle = await open(tmp, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(state, null, 2)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(tmp, file);
}
export async function readJobState(
  stateDir: string,
  id: string,
  options: { dryRun?: boolean } = {},
): Promise<JobState> {
  if (!idPattern.test(id)) throw new Error("invalid job id");
  const root = await realpath(stateDir);
  const file = path.join(root, `${id}.json`);
  let state: JobState;
  try {
    if (!(await lstat(file)).isFile()) throw new Error("state record is not a regular file");
    state = JSON.parse(await readFile(file, "utf8")) as JobState;
  } catch (error) {
    throw new Error(`cannot read job ${id}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (
    state.schemaVersion !== 1 ||
    state.id !== id ||
    !Number.isInteger(state.pid) ||
    state.pid < 1 ||
    typeof state.nonce !== "string" ||
    !state.nonce ||
    !["running", "passed", "failed", "cancelled"].includes(state.status) ||
    typeof state.repo !== "string" ||
    !Array.isArray(state.command) ||
    state.command.some((arg) => typeof arg !== "string") ||
    typeof state.startedAt !== "string" ||
    typeof state.resultPath !== "string" ||
    typeof state.stdoutPath !== "string" ||
    typeof state.stderrPath !== "string" ||
    typeof state.notificationPath !== "string"
  )
    throw new Error(`invalid job state for ${id}`);
  const base = root;
  for (const filePath of [state.resultPath, state.stdoutPath, state.stderrPath, state.notificationPath])
    if (path.dirname(path.resolve(filePath)) !== base)
      throw new Error(`job state path escapes state directory for ${id}`);
  if (state.status === "running" && !processIdentityAlive(state.pid, state.nonce)) {
    state.status = "failed";
    state.exitCode = null;
    state.finishedAt = new Date().toISOString();
    if (!options.dryRun) await saveState(file, state);
  }
  return state;
}

export async function startJob(options: StartOptions): Promise<JobState> {
  if (!options.command.length || options.command.some((arg) => arg.includes("\0")))
    throw new Error("command must be non-empty argv without NUL bytes");
  if (process.platform !== "linux") throw new Error("detached durable jobs are supported only on Linux");
  const notify = validateNotification(options.notify);
  const repo = await realpath(options.repo);
  if (!(await stat(repo)).isDirectory()) throw new Error("--repo must name a directory");
  const stateDir = path.resolve(options.stateDir);
  if (!options.dryRun) await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const actualStateDir = options.dryRun ? stateDir : await realpath(stateDir);
  if (!options.dryRun) await chmod(actualStateDir, 0o700);
  const scriptPath = fileURLToPath(import.meta.url);
  if (scriptPath.startsWith(`${actualStateDir}${path.sep}`))
    throw new Error("state directory must not be inside installed skill source");
  const id = `${Date.now()}-${randomUUID()}`;
  const nonce = randomUUID();
  const resultPath = path.join(actualStateDir, `${id}.result.json`);
  const initial: JobState = {
    schemaVersion: 1,
    id,
    nonce,
    pid: 0,
    startedAt: new Date().toISOString(),
    repo,
    command: options.command,
    status: "running",
    resultPath,
    stdoutPath: path.join(actualStateDir, `${id}.stdout.log`),
    stderrPath: path.join(actualStateDir, `${id}.stderr.log`),
    notificationPath: path.join(actualStateDir, `${id}.notification.log`),
  };
  if (options.dryRun) return initial;
  const script = fileURLToPath(import.meta.url);
  const supervisor = spawn(
    process.execPath,
    [script, "--supervise", actualStateDir, id, nonce, JSON.stringify(notify), ...options.command],
    { detached: true, stdio: ["ignore", "ignore", "ignore", "ipc"], cwd: repo, env: process.env },
  );
  const supervisorPid = supervisor.pid;
  if (!supervisorPid) throw new Error("failed to launch job supervisor");
  initial.pid = supervisorPid;
  await saveState(path.join(actualStateDir, `${id}.json`), initial);
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("job supervisor did not become ready")), 5000);
      const cleanup = (): void => {
        clearTimeout(timeout);
        supervisor.removeListener("error", onError);
        supervisor.removeListener("message", onMessage);
        supervisor.removeListener("exit", onExit);
      };
      const onError = (error: Error): void => {
        cleanup();
        reject(error);
      };
      const onMessage = (message: unknown): void => {
        cleanup();
        if (message === "ready") resolve();
        else reject(new Error(`job supervisor failed: ${String(message)}`));
      };
      const onExit = (code: number | null): void => {
        cleanup();
        reject(new Error(`job supervisor exited before ready (${code})`));
      };
      supervisor.once("error", onError);
      supervisor.once("message", onMessage);
      supervisor.once("exit", onExit);
    });
  } catch (error) {
    try {
      process.kill(-supervisorPid, "SIGKILL");
    } catch {
      /* already exited */
    }
    await rm(path.join(actualStateDir, `${id}.json`), { force: true });
    throw new Error(`failed to start job supervisor: ${error instanceof Error ? error.message : String(error)}`);
  }
  supervisor.disconnect();
  supervisor.unref();
  return initial;
}

export async function cancelJob(stateDir: string, id: string, hooks: Hooks = {}): Promise<JobState> {
  const state = await readJobState(stateDir, id);
  if (state.status !== "running") return state;
  const alive = (hooks.isIdentityAlive ?? processIdentityAlive)(state.pid, state.nonce);
  if (!alive) return readJobState(stateDir, id);
  const signalGroup = hooks.kill ?? ((pid, signal) => process.kill(-pid, signal));
  signalGroup(state.pid, "SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 1200));
  if ((hooks.isIdentityAlive ?? processIdentityAlive)(state.pid, state.nonce)) signalGroup(state.pid, "SIGKILL");
  return readJobState(stateDir, id);
}

async function loadSupervisorState(file: string, id: string, nonce: string): Promise<JobState> {
  let state: JobState | undefined;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      state = JSON.parse(await readFile(file, "utf8")) as JobState;
      if (state.pid > 0) break;
    } catch {
      /* parent is creating the atomic state file */
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  if (!state || state.id !== id || state.nonce !== nonce)
    throw new Error("job state was not initialized or identity mismatched");
  return state;
}

export async function runSupervisedCommand(
  state: JobState,
  command: string[],
  stdout: Awaited<ReturnType<typeof open>>,
  stderr: Awaited<ReturnType<typeof open>>,
  signal?: AbortSignal,
): Promise<{ exitCode: number | null; cancelled: boolean }> {
  const [executable, ...args] = command;
  if (!executable) throw new Error("job command must not be empty");
  const child = spawn(executable, args, {
    cwd: state.repo,
    shell: false,
    detached: true,
    stdio: ["ignore", stdout.fd, stderr.fd],
  });
  let cancelled = false;
  let forceTimer: NodeJS.Timeout | undefined;
  const signalTask = (signalName: NodeJS.Signals): void => {
    if (!child.pid) return;
    try {
      process.kill(-child.pid, signalName);
    } catch {
      /* task process group exited */
    }
  };
  const onTerminate = (): void => {
    cancelled = true;
    signalTask("SIGTERM");
    forceTimer = setTimeout(() => signalTask("SIGKILL"), 1000);
  };
  process.on("SIGTERM", onTerminate);
  signal?.addEventListener("abort", onTerminate, { once: true });
  if (signal?.aborted) onTerminate();
  const exitCode = await new Promise<number | null>((resolve) => {
    child.once("error", async (error) => {
      await stderr.write(`${error.message}\n`);
      if (process.send) process.send("ready");
      resolve(127);
    });
    child.once("spawn", () => {
      if (process.send) process.send("ready");
    });
    child.once("close", resolve);
  });
  process.removeListener("SIGTERM", onTerminate);
  signal?.removeEventListener("abort", onTerminate);
  if (forceTimer) clearTimeout(forceTimer);
  return { exitCode, cancelled };
}

async function runNotification(notification: string[], state: JobState, id: string): Promise<boolean> {
  const notificationArgv = notification.map((arg) =>
    arg.replaceAll("{id}", id).replaceAll("{outcome}", state.status).replaceAll("{result}", state.resultPath),
  );
  const [executable, ...args] = notificationArgv;
  if (!executable) throw new Error("notification command must not be empty");
  const log = await open(state.notificationPath, "wx", 0o600);
  const result = spawnSync(executable, args, {
    cwd: state.repo,
    shell: false,
    stdio: ["ignore", log.fd, log.fd],
    timeout: 5000,
  });
  await log.close();
  return Boolean(result.error) || result.status !== 0;
}

async function writeFinalResult(state: JobState, result: unknown): Promise<void> {
  const temp = `${state.resultPath}.${randomUUID()}.tmp`;
  const file = await open(temp, "wx", 0o600);
  await file.writeFile(`${JSON.stringify(result, null, 2)}\n`);
  await file.close();
  await rename(temp, state.resultPath);
}

export async function supervise(
  stateDir: string,
  id: string,
  nonce: string,
  notification: string[],
  command: string[],
  signal?: AbortSignal,
): Promise<number> {
  const file = path.join(stateDir, `${id}.json`);
  const state = await loadSupervisorState(file, id, nonce);
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const stdout = await open(state.stdoutPath, "wx", 0o600);
  const stderr = await open(state.stderrPath, "wx", 0o600);
  const task = await runSupervisedCommand(state, command, stdout, stderr, signal);
  await stdout.close();
  await stderr.close();
  state.status = task.cancelled ? "cancelled" : task.exitCode === 0 ? "passed" : "failed";
  state.taskOutcome = state.status;
  state.exitCode = task.exitCode;
  state.finishedAt = new Date().toISOString();
  const result = { id, outcome: state.status, exitCode: task.exitCode, resultPath: state.resultPath, command };
  const resultFile = await open(state.resultPath, "wx", 0o600);
  await resultFile.writeFile(`${JSON.stringify(result, null, 2)}\n`);
  await resultFile.close();
  const notificationFailed = await runNotification(notification, state, id);
  state.notificationFailed = notificationFailed;
  if (notificationFailed) process.stderr.write(`job ${id}: completion notification failed\n`);
  await writeFinalResult(state, {
    ...result,
    outcome: state.taskOutcome,
    exitCode: state.exitCode,
    notificationFailed,
  });
  await saveState(file, state);
  return notificationFailed ? 1 : task.exitCode === 0 ? 0 : (task.exitCode ?? 1);
}

type StartValues = { repo: string; stateDir: string; notifyJson: string; dryRun: boolean };

function consumeStartOption(args: string[], index: number, values: StartValues): number {
  const flag = args[index];
  if (flag === "--dry-run") {
    values.dryRun = true;
    return index + 1;
  }
  if (flag === "--help")
    throw new Error(
      "usage: jobs.ts start --repo PATH --state-dir PATH --notify-json JSON_ARRAY [--dry-run] -- COMMAND ARGS...",
    );
  if (flag !== "--repo" && flag !== "--state-dir" && flag !== "--notify-json")
    throw new Error(`unknown option ${flag}`);
  const value = args[index + 1];
  if (!value) throw new Error(`${flag} requires a value`);
  if (flag === "--repo") values.repo = value;
  if (flag === "--state-dir") values.stateDir = value;
  if (flag === "--notify-json") values.notifyJson = value;
  return index + 2;
}

function parseStart(args: string[]): StartOptions {
  const values: StartValues = { repo: "", stateDir: "", notifyJson: "", dryRun: false };
  let index = 0;
  while (index < args.length && args[index] !== "--") index = consumeStartOption(args, index, values);
  if (args[index] !== "--") throw new Error("start command must follow --");
  const command = args.slice(index + 1);
  if (!values.repo || !values.stateDir || !values.notifyJson)
    throw new Error("--repo, --state-dir, and --notify-json are required");
  return {
    repo: values.repo,
    stateDir: values.stateDir,
    notify: validateNotification(JSON.parse(values.notifyJson)),
    command,
    dryRun: values.dryRun,
  };
}

type StatusOptions = { stateDir: string; id: string; dryRun: boolean };

function consumeStatusOption(args: string[], index: number, options: StatusOptions): number {
  const flag = args[index];
  if (flag === "--dry-run") {
    options.dryRun = true;
    return index + 1;
  }
  if (flag === "--help") throw new Error("usage: jobs.ts status|cancel --state-dir PATH --id ID [--dry-run]");
  if (flag !== "--state-dir" && flag !== "--id") throw new Error(`unknown option ${flag}`);
  const value = args[index + 1];
  if (!value) throw new Error(`${flag} requires a value`);
  if (flag === "--state-dir") options.stateDir = value;
  else options.id = value;
  return index + 2;
}

function parseStatusOptions(args: string[]): StatusOptions {
  const options: StatusOptions = { stateDir: "", id: "", dryRun: false };
  for (let index = 0; index < args.length; ) index = consumeStatusOption(args, index, options);
  if (!options.stateDir || !options.id) throw new Error("--state-dir and --id are required");
  if (!idPattern.test(options.id)) throw new Error("invalid job id");
  return options;
}

async function showStatus(mode: "status" | "cancel", args: string[]): Promise<void> {
  const options = parseStatusOptions(args);
  if (mode === "cancel" && !options.dryRun) await cancelJob(options.stateDir, options.id);
  const state = await readJobState(options.stateDir, options.id, { dryRun: options.dryRun });
  process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
}

async function runSupervisorArgs(args: string[]): Promise<void> {
  const [, dir, id, nonce, notificationJson, ...command] = args;
  if (!dir || !id || !nonce || !notificationJson) throw new Error("invalid supervisor arguments");
  process.exitCode = await supervise(dir, id, nonce, JSON.parse(notificationJson) as string[], command);
}

function showUsage(): void {
  process.stdout.write(
    "usage: jobs.ts start --repo PATH --state-dir PATH --notify-json JSON_ARRAY [--dry-run] -- COMMAND ARGS...; jobs.ts status|cancel --state-dir PATH --id ID [--dry-run]\n",
  );
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  if (args[0] === "--help" || (["status", "cancel", "start"].includes(args[0] ?? "") && args.includes("--help"))) {
    showUsage();
    return;
  }
  try {
    if (args[0] === "--supervise") {
      await runSupervisorArgs(args);
      return;
    }
    const mode = args.shift();
    if (mode === "start") process.stdout.write(`${JSON.stringify(await startJob(parseStart(args)), null, 2)}\n`);
    else if (mode === "status" || mode === "cancel") await showStatus(mode, args);
    else throw new Error("usage: jobs.ts start|status|cancel ...");
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
if (import.meta.url === `file://${process.argv[1] ?? ""}`) void main();
