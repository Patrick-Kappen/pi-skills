#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const result = spawnSync(
  process.execPath,
  ["scripts/platform/run-checks.ts", "--repo", ".", "--manifest", "platform-checks.json", "--jobs", "2"],
  {
    cwd: process.cwd(),
    stdio: "inherit",
    env: process.env,
  },
);
if (result.error) {
  process.stderr.write(`platform policy hook infrastructure failure: ${result.error.message}\n`);
  process.exitCode = 2;
} else if (result.status !== 0) {
  process.stderr.write(
    `platform policy hook blocked (runner status ${String(result.status)}${result.signal ? `, signal ${result.signal}` : ""})\n`,
  );
  process.exitCode = 2;
}
