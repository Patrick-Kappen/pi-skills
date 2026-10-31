import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, open, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cancelJob,
  main as jobsMain,
  processIdentityAlive,
  readJobState,
  runSupervisedCommand,
  startJob,
  supervise,
  validateNotification,
} from "../../../skills/pi-platform/scripts/jobs.ts";
import {
  executeCheck,
  runChecks,
  main as runChecksMain,
  selectChecks,
  validateManifest,
} from "../../../skills/pi-platform/scripts/run-checks.ts";

const checksScript = path.resolve("skills/pi-platform/scripts/run-checks.ts");
const jobsScript = path.resolve("skills/pi-platform/scripts/jobs.ts");

const dirs: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "platform-jobs-"));
  dirs.push(dir);
  return dir;
}

async function supervisorState(stateDir: string, id: string): Promise<void> {
  const state = {
    schemaVersion: 1,
    id,
    nonce: `nonce-${id}`,
    pid: process.pid,
    startedAt: new Date().toISOString(),
    repo: stateDir,
    command: [process.execPath, "-e", "process.exit(0)"],
    status: "running",
    resultPath: path.join(stateDir, `${id}.result.json`),
    stdoutPath: path.join(stateDir, `${id}.stdout.log`),
    stderrPath: path.join(stateDir, `${id}.stderr.log`),
    notificationPath: path.join(stateDir, `${id}.notification.log`),
  };
  await writeFile(path.join(stateDir, `${id}.json`), JSON.stringify(state));
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("CLI validation", () => {
  it("supports help and rejects unknown flags with nonzero status", () => {
    expect(spawnSync(process.execPath, [checksScript, "--help"], { encoding: "utf8" }).status).toBe(0);
    expect(spawnSync(process.execPath, [checksScript, "--unknown"], { encoding: "utf8" }).status).toBe(1);
    expect(spawnSync(process.execPath, [jobsScript, "start", "--help"], { encoding: "utf8" }).status).toBe(0);
    expect(
      spawnSync(process.execPath, [jobsScript, "status", "--id", "../x", "--state-dir", "/tmp", "--dry-run"], {
        encoding: "utf8",
      }).status,
    ).toBe(1);
  });
});

describe("check DAG executor", () => {
  it("validates duplicate IDs, missing dependencies and cycles", () => {
    expect(() =>
      validateManifest({
        schemaVersion: 1,
        checks: [
          { id: "x", argv: ["true"] },
          { id: "x", argv: ["true"] },
        ],
      }),
    ).toThrow("duplicate");
    expect(() =>
      validateManifest({ schemaVersion: 1, checks: [{ id: "x", argv: ["true"], needs: ["missing"] }] }),
    ).toThrow("missing dependency");
    expect(() =>
      validateManifest({
        schemaVersion: 1,
        checks: [
          { id: "x", argv: ["true"], needs: ["y"] },
          { id: "y", argv: ["true"], needs: ["x"] },
        ],
      }),
    ).toThrow("cycle");
    expect(() => validateManifest({ schemaVersion: 1, checks: [{ id: "x", argv: [] }] })).toThrow("argv");
    expect(() => validateManifest({ schemaVersion: 1, checks: [] })).toThrow("non-empty");
  });
  it("cascades skipped dependencies even when DAG order is reversed", async () => {
    const dir = await tempDir();
    const manifest = validateManifest({
      schemaVersion: 1,
      checks: [
        { id: "last", argv: [process.execPath, "-e", "process.exit(0)"], needs: ["middle"] },
        { id: "middle", argv: [process.execPath, "-e", "process.exit(0)"], needs: ["first"] },
        { id: "first", argv: [process.execPath, "-e", "process.exit(1)"] },
      ],
    });
    const result = await runChecks({ repo: dir, jobs: 1, outDir: path.join(dir, "reverse"), dryRun: false }, manifest);
    expect(result.results.map((entry) => entry.status)).toEqual(["skipped", "skipped", "failed"]);
  });
  it("rejects malformed check entries and accepts optional constraints", () => {
    const invalid = [
      null,
      { id: "bad id", argv: ["true"] },
      { id: "x", argv: ["true"], extra: true },
      { id: "x", argv: ["true", ""] },
      { id: "x", argv: ["true\0bad"] },
      { id: "x", argv: ["true"], needs: [1] },
      { id: "x", argv: ["true"], timeoutSeconds: 0 },
      { id: "x", argv: ["true"], timeoutSeconds: Number.NaN },
    ];
    for (const check of invalid) expect(() => validateManifest({ schemaVersion: 1, checks: [check] })).toThrow();
    expect(
      validateManifest({
        schemaVersion: 1,
        checks: [{ id: "bounded", argv: ["true"], needs: [], timeoutSeconds: 0.5 }],
      }).checks[0],
    ).toMatchObject({ needs: [], timeoutSeconds: 0.5 });
    expect(() => validateManifest(null)).toThrow("manifest must be an object");
    expect(() => validateManifest({ schemaVersion: 1, checks: [{ id: "x", argv: ["true"] }], other: true })).toThrow(
      "unknown fields",
    );
  });
  it("rejects invalid worker counts", async () => {
    const dir = await tempDir();
    await expect(
      runChecks({ repo: dir, jobs: 0, dryRun: true }, { schemaVersion: 1, checks: [{ id: "x", argv: ["true"] }] }),
    ).rejects.toThrow("jobs must");
    await expect(
      runChecks({ repo: dir, jobs: 65, dryRun: true }, { schemaVersion: 1, checks: [{ id: "x", argv: ["true"] }] }),
    ).rejects.toThrow("jobs must");
  });
  it("includes prerequisites for selected checks", () => {
    const manifest = validateManifest({
      schemaVersion: 1,
      checks: [
        { id: "base", argv: ["true"] },
        { id: "leaf", argv: ["true"], needs: ["base"] },
        { id: "other", argv: ["true"] },
      ],
    });
    expect(selectChecks(manifest, ["leaf"]).map((check) => check.id)).toEqual(["base", "leaf"]);
    expect(() => selectChecks(manifest, ["missing"])).toThrow("unknown check");
  });
  it("runs independent checks concurrently and fails dependants after command failure", async () => {
    const dir = await tempDir();
    const manifest = validateManifest({
      schemaVersion: 1,
      checks: [
        { id: "slow1", argv: [process.execPath, "-e", "setTimeout(()=>{},180)"] },
        { id: "slow2", argv: [process.execPath, "-e", "setTimeout(()=>{},180)"] },
        { id: "bad", argv: [process.execPath, "-e", "process.exit(3)"] },
        { id: "dependent", argv: [process.execPath, "-e", "process.exit(0)"], needs: ["bad"] },
      ],
    });
    const started = Date.now();
    const run = await runChecks({ repo: dir, jobs: 2, outDir: path.join(dir, "run"), dryRun: false }, manifest);
    expect(Date.now() - started).toBeLessThan(650);
    expect(run.results.map((result) => result.status)).toEqual(["passed", "passed", "failed", "skipped"]);
    expect(await readFile(path.join(run.runDir, "result.json"), "utf8")).toContain('"success": false');
  });
  it("times out and treats missing commands as failures", async () => {
    const dir = await tempDir();
    const timeout = await executeCheck(
      { id: "timeout", argv: [process.execPath, "-e", "setTimeout(()=>{},1000)"], timeoutSeconds: 0.03 },
      dir,
      path.join(dir, "timeout.log"),
    );
    const missing = await executeCheck(
      { id: "missing", argv: ["/definitely/not/a/program"] },
      dir,
      path.join(dir, "missing.log"),
    );
    expect(timeout.status).toBe("timed-out");
    expect(missing.status).toBe("failed");
  });
  it("cancels a running check when its abort signal fires", async () => {
    const dir = await tempDir();
    const controller = new AbortController();
    const execution = executeCheck(
      { id: "cancelled", argv: [process.execPath, "-e", "setTimeout(()=>{},10000)"] },
      dir,
      path.join(dir, "cancelled.log"),
      10,
      controller.signal,
    );
    setTimeout(() => controller.abort(), 30);
    await expect(execution).resolves.toMatchObject({ status: "failed" });
  });

  it("kills timed-out process-group descendants", async () => {
    const dir = await tempDir();
    const marker = path.join(dir, "late-child");
    const childProgram = `setTimeout(()=>require("node:fs").writeFileSync(${JSON.stringify(marker)},"late"),400)`;
    const code = `const {spawn}=require("node:child_process");spawn(process.execPath,["-e",${JSON.stringify(childProgram)}],{stdio:"ignore"});setTimeout(()=>{},5000)`;
    const result = await executeCheck(
      { id: "tree", argv: [process.execPath, "-e", code], timeoutSeconds: 0.05 },
      dir,
      path.join(dir, "tree.log"),
    );
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(result.status, await readFile(path.join(dir, "tree.log"), "utf8")).toBe("timed-out");
    await expect(readFile(marker)).rejects.toThrow();
  });
  it("dry run creates no output and refuses reused run directories", async () => {
    const dir = await tempDir();
    const manifest = { schemaVersion: 1 as const, checks: [{ id: "ok", argv: ["true"] }] };
    const outDir = path.join(dir, "dry");
    await runChecks({ repo: dir, jobs: 1, outDir, dryRun: true }, manifest);
    expect(await readdir(dir)).toEqual([]);
    const output = path.join(dir, "existing");
    await runChecks({ repo: dir, jobs: 1, outDir: output, dryRun: false }, manifest);
    await expect(runChecks({ repo: dir, jobs: 1, outDir: output, dryRun: false }, manifest)).rejects.toThrow();
  });
});

describe("durable jobs", () => {
  it("validates notification argv before launch", () => {
    expect(validateNotification([process.execPath, "--version"])[0]).toBe(process.execPath);
    expect(validateNotification([path.basename(process.execPath)])[0]).toBe(path.basename(process.execPath));
    expect(() => validateNotification(["/no/such/notification"])).toThrow("not executable");
    expect(() => validateNotification(["missing-notification-command"])).toThrow("not found");
    expect(() => validateNotification([process.execPath, "bad\0argument"])).toThrow("argv array");
    expect(() => validateNotification("node")).toThrow("argv array");
  });

  it("validates persisted records and makes stale-state dry runs read-only", async () => {
    const dir = await tempDir();
    const stateDir = path.join(dir, "jobs");
    await mkdir(stateDir);
    const id = "job-state";
    const state = {
      schemaVersion: 1,
      id,
      nonce: "stale-nonce",
      pid: 987654321,
      startedAt: new Date().toISOString(),
      repo: dir,
      command: ["true"],
      status: "running",
      resultPath: path.join(stateDir, "result.json"),
      stdoutPath: path.join(stateDir, "stdout.log"),
      stderrPath: path.join(stateDir, "stderr.log"),
      notificationPath: path.join(stateDir, "notification.log"),
    };
    const stateFile = path.join(stateDir, `${id}.json`);

    await writeFile(stateFile, "not json");
    await expect(readJobState(stateDir, id)).rejects.toThrow("cannot read job");
    await rm(stateFile);
    await mkdir(stateFile);
    await expect(readJobState(stateDir, id)).rejects.toThrow("not a regular file");
    await rm(stateFile, { recursive: true });

    const invalidRecords = [
      { ...state, schemaVersion: 2 },
      { ...state, id: "different" },
      { ...state, pid: 0 },
      { ...state, nonce: "" },
      { ...state, status: "unknown" },
      { ...state, repo: 42 },
      { ...state, command: "true" },
      { ...state, command: [42] },
      { ...state, startedAt: 42 },
      { ...state, resultPath: 42 },
      { ...state, stdoutPath: 42 },
      { ...state, stderrPath: 42 },
      { ...state, notificationPath: 42 },
      { ...state, resultPath: path.join(dir, "outside.json") },
    ];
    for (const invalid of invalidRecords) {
      await writeFile(stateFile, JSON.stringify(invalid));
      await expect(readJobState(stateDir, id)).rejects.toThrow(/invalid job state|escapes state directory/);
    }

    await writeFile(stateFile, JSON.stringify(state));
    await expect(readJobState(stateDir, id, { dryRun: true })).resolves.toMatchObject({ status: "failed" });
    await expect(readFile(stateFile, "utf8")).resolves.toContain('"status":"running"');
    await expect(readJobState(stateDir, "../bad")).rejects.toThrow("invalid job id");
  });

  it("checks live supervisor identities and validates start inputs", async () => {
    const dir = await tempDir();
    const nonce = `identity-${Date.now()}`;
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", "--supervise", nonce], {
      stdio: "ignore",
    });
    try {
      await new Promise<void>((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
      expect(child.pid).toBeDefined();
      expect(processIdentityAlive(child.pid as number, nonce)).toBe(true);
      expect(processIdentityAlive(child.pid as number, "other-nonce")).toBe(false);
    } finally {
      child.kill("SIGKILL");
    }

    const options = {
      repo: dir,
      stateDir: path.join(dir, "jobs"),
      notify: [process.execPath],
      command: [process.execPath],
      dryRun: true,
    };
    await expect(startJob({ ...options, command: [] })).rejects.toThrow("non-empty argv");
    await expect(startJob({ ...options, command: ["true\0bad"] })).rejects.toThrow("non-empty argv");
    await expect(startJob({ ...options, stateDir: path.resolve("skills/pi-platform/scripts") })).rejects.toThrow(
      "inside installed skill source",
    );
    const file = path.join(dir, "not-a-directory");
    await writeFile(file, "file");
    await expect(startJob({ ...options, repo: file })).rejects.toThrow("directory");
  });
  it("dry run writes nothing and start produces a detached state record", async () => {
    const dir = await tempDir();
    const dry = await startJob({
      repo: dir,
      stateDir: path.join(dir, "dry"),
      notify: [process.execPath],
      command: [process.execPath, "-e", ""],
      dryRun: true,
    });
    expect(await readdir(dir)).toEqual([]);
    const stateDir = path.join(dir, "jobs");
    const started = await startJob({
      repo: dir,
      stateDir,
      notify: [process.execPath, "-e", "process.exit(0)"],
      command: [process.execPath, "-e", "process.exit(0)"],
      dryRun: false,
    });
    expect(started.id).not.toBe(dry.id);
    expect(await readJobState(stateDir, started.id)).toMatchObject({ id: started.id, nonce: started.nonce });
    const end = Date.now() + 4000;
    let final = await readJobState(stateDir, started.id);
    while (final.status === "running" && Date.now() < end) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      final = await readJobState(stateDir, started.id);
    }
    expect(final.status).toBe("passed");
    expect(JSON.parse(await readFile(final.resultPath, "utf8")).outcome).toBe("passed");
    const notificationFailure = await startJob({
      repo: dir,
      stateDir,
      notify: [process.execPath, "-e", "process.exit(2)"],
      command: [process.execPath, "-e", "process.exit(0)"],
      dryRun: false,
    });
    const notificationEnd = Date.now() + 4000;
    let failed = await readJobState(stateDir, notificationFailure.id);
    while (failed.status === "running" && Date.now() < notificationEnd) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      failed = await readJobState(stateDir, notificationFailure.id);
    }
    expect(failed.status).toBe("passed");
    expect(failed.taskOutcome).toBe("passed");
    expect(failed.notificationFailed).toBe(true);
    expect(JSON.parse(await readFile(failed.resultPath, "utf8")).notificationFailed).toBe(true);
    expect(failed.notificationPath).toBeTruthy();
    if (!failed.notificationPath) throw new Error("completion notification log path is missing");
    await expect(readFile(failed.notificationPath)).resolves.toBeDefined();
    const cancellable = await startJob({
      repo: dir,
      stateDir,
      notify: [process.execPath, "-e", "process.exit(0)"],
      command: [process.execPath, "-e", "setTimeout(()=>{},10000)"],
      dryRun: false,
    });
    await cancelJob(stateDir, cancellable.id);
    const cancelEnd = Date.now() + 3000;
    let cancelled = await readJobState(stateDir, cancellable.id);
    while (cancelled.status === "running" && Date.now() < cancelEnd) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      cancelled = await readJobState(stateDir, cancellable.id);
    }
    expect(cancelled.status).toBe("cancelled");
  });
  it("writes task status and expands notification placeholders", async () => {
    const dir = await tempDir();
    const stateDir = path.join(dir, "supervisor");
    await mkdir(stateDir);
    await supervisorState(stateDir, "failed-task");
    const notify = [
      process.execPath,
      "-e",
      "console.log(process.argv.slice(1).join('|'))",
      "{id}",
      "{outcome}",
      "{result}",
    ];
    await expect(
      supervise(stateDir, "failed-task", "nonce-failed-task", notify, [process.execPath, "-e", "process.exit(4)"]),
    ).resolves.toBe(4);
    const state = JSON.parse(await readFile(path.join(stateDir, "failed-task.json"), "utf8"));
    expect(state).toMatchObject({ status: "failed", taskOutcome: "failed", exitCode: 4, notificationFailed: false });
    const log = await readFile(state.notificationPath, "utf8");
    expect(log).toContain(`failed-task|failed|${state.resultPath}`);
  });

  it("cancels a directly supervised process through its abort signal", async () => {
    const dir = await tempDir();
    const stdout = await open(path.join(dir, "stdout"), "wx", 0o600);
    const stderr = await open(path.join(dir, "stderr"), "wx", 0o600);
    const controller = new AbortController();
    const run = runSupervisedCommand(
      { repo: dir } as Parameters<typeof runSupervisedCommand>[0],
      [process.execPath, "-e", "setTimeout(()=>{},10000)"],
      stdout,
      stderr,
      controller.signal,
    );
    setTimeout(() => controller.abort(), 30);
    await expect(run).resolves.toMatchObject({ cancelled: true });
    await stdout.close();
    await stderr.close();
  });

  it("runs supervisor records for task and notification outcomes", async () => {
    const dir = await tempDir();
    const stateDir = path.join(dir, "supervisor");
    await mkdir(stateDir);

    await supervisorState(stateDir, "passed");
    await expect(
      supervise(
        stateDir,
        "passed",
        "nonce-passed",
        [process.execPath, "-e", "process.exit(0)"],
        [process.execPath, "-e", "process.exit(0)"],
      ),
    ).resolves.toBe(0);
    expect(JSON.parse(await readFile(path.join(stateDir, "passed.json"), "utf8")).status).toBe("passed");

    await supervisorState(stateDir, "missing-task");
    await expect(
      supervise(
        stateDir,
        "missing-task",
        "nonce-missing-task",
        [process.execPath, "-e", "process.exit(0)"],
        [path.join(dir, "no-such-task")],
      ),
    ).resolves.not.toBe(0);
    expect(JSON.parse(await readFile(path.join(stateDir, "missing-task.json"), "utf8")).exitCode).not.toBe(0);

    await supervisorState(stateDir, "bad-notification");
    await expect(
      supervise(
        stateDir,
        "bad-notification",
        "nonce-bad-notification",
        [process.execPath, "-e", "process.exit(2)"],
        [process.execPath, "-e", "process.exit(0)"],
      ),
    ).resolves.toBe(1);
    expect(JSON.parse(await readFile(path.join(stateDir, "bad-notification.json"), "utf8")).notificationFailed).toBe(
      true,
    );

    await supervisorState(stateDir, "late-state");
    const originalState = await readFile(path.join(stateDir, "late-state.json"), "utf8");
    await rm(path.join(stateDir, "late-state.json"));
    const delayed = supervise(
      stateDir,
      "late-state",
      "nonce-late-state",
      [process.execPath, "-e", "process.exit(0)"],
      [process.execPath, "-e", "process.exit(0)"],
    );
    setTimeout(() => void writeFile(path.join(stateDir, "late-state.json"), originalState), 1);
    await expect(delayed).resolves.toBe(0);
  });

  it("handles direct CLI dry runs and malformed requests", async () => {
    const dir = await tempDir();
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const exitCode = process.exitCode;
    try {
      await jobsMain(["--help"]);
      await jobsMain(["--supervise"]);
      expect(process.exitCode).toBe(1);
      process.exitCode = undefined;
      await jobsMain([
        "start",
        "--repo",
        dir,
        "--state-dir",
        path.join(dir, "dry"),
        "--notify-json",
        JSON.stringify([process.execPath]),
        "--dry-run",
        "--",
        process.execPath,
      ]);
      await jobsMain(["status", "--state-dir", dir, "--id", "../bad"]);
      await jobsMain(["start", "--unknown"]);
      await jobsMain(["start", "--repo"]);
      await jobsMain(["start", "--repo", dir, "--state-dir", dir, "--notify-json", "[]"]);
      await jobsMain(["start", "--repo", dir, "--state-dir", dir, "--notify-json", "not-json", "--", "true"]);
      await jobsMain(["status", "--unknown"]);
      await jobsMain(["status", "--state-dir"]);
      await jobsMain(["status", "--state-dir", dir]);
      await jobsMain(["status", "--state-dir", dir, "--id", "missing", "--dry-run"]);
      await jobsMain(["cancel", "--state-dir", dir, "--id", "bad", "--dry-run"]);
      await jobsMain(["unknown"]);
      await jobsMain(["--supervise", dir, "id"]);

      await runChecksMain(["--help"]);
      await runChecksMain(["--unknown"]);
      await runChecksMain(["--repo"]);
      await runChecksMain(["--repo", dir, "--jobs", "not-a-number"]);
      await runChecksMain(["--repo", dir, "--jobs", "0"]);
      const manifest = path.join(dir, "manifest.json");
      await writeFile(manifest, JSON.stringify({ schemaVersion: 1, checks: [{ id: "check", argv: ["true"] }] }));
      await runChecksMain([
        "--repo",
        dir,
        "--manifest",
        manifest,
        "--jobs",
        "2",
        "--only",
        "check",
        "--out-dir",
        path.join(dir, "dry"),
        "--dry-run",
      ]);
      await runChecksMain(["--repo", dir, "--manifest", manifest, "--jobs", "65"]);
      await expect(executeCheck({ id: "empty", argv: [] }, dir, path.join(dir, "empty.log"))).rejects.toThrow(
        "must not be empty",
      );
    } finally {
      process.exitCode = exitCode;
      stdout.mockRestore();
      stderr.mockRestore();
    }
  });

  it("does not signal a reused or mismatched PID", async () => {
    const dir = await tempDir();
    const stateDir = path.join(dir, "jobs");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(stateDir));
    const state = {
      schemaVersion: 1,
      id: "job-1",
      nonce: "old-nonce",
      pid: 1234,
      startedAt: new Date().toISOString(),
      repo: dir,
      command: ["true"],
      status: "running",
      resultPath: path.join(stateDir, "r.json"),
      stdoutPath: path.join(stateDir, "out"),
      stderrPath: path.join(stateDir, "err"),
      notificationPath: path.join(stateDir, "notify"),
    };
    await writeFile(path.join(stateDir, "job-1.json"), JSON.stringify(state));
    const calls: number[] = [];
    const result = await cancelJob(stateDir, "job-1", { isIdentityAlive: () => false, kill: (pid) => calls.push(pid) });
    expect(calls).toEqual([]);
    expect(result.status).toBe("failed");
    await expect(readJobState(stateDir, "../job-1")).rejects.toThrow("invalid job id");
    expect(processIdentityAlive(1234, "old-nonce")).toBe(false);
  });
});
