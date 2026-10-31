// Runs analyse.sh with a fake `pi` on PATH, so no model is called.
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const script = resolve(import.meta.dirname, "../../../skills/skill-review/scripts/analyse.sh");
const root = mkdtempSync(join(tmpdir(), "analyse-"));
const bin = join(root, "bin");
const calls = join(root, "calls.log");
const skill = join(root, "skills", "demo");

beforeAll(() => {
  mkdirSync(bin, { recursive: true });
  // The fake pi logs its arguments and answers with the number of digests it got.
  writeFileSync(
    join(bin, "pi"),
    `#!/usr/bin/env bash\necho "$*" >>"${calls}"\nn=$(printf '%s\\n' "$@" | grep -c '^@.*/[0-9]' || true)\necho "report for $n inputs"\n`,
  );
  chmodSync(join(bin, "pi"), 0o755);
  mkdirSync(join(skill, "scripts"), { recursive: true });
  writeFileSync(join(skill, "SKILL.md"), "---\nname: demo\n---\n# demo\n");
  writeFileSync(join(skill, "scripts", "run.sh"), "#!/bin/sh\n");
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

function digests(name: string, sizes: number[]): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  sizes.forEach((size, i) => {
    writeFileSync(join(dir, `0${i + 1}-2026-10-30-x.md`), "x".repeat(size));
  });
  return dir;
}

function run(args: string[], env: NodeJS.ProcessEnv = {}): string {
  return execFileSync(script, args, {
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

describe("analyse.sh", () => {
  test("one part: the report is the model's answer", () => {
    writeFileSync(calls, "");
    const dir = digests("one", [10, 10]);
    expect(run([dir, skill]).trim()).toBe(join(dir, "report.md"));
    expect(readFileSync(join(dir, "report.md"), "utf8")).toBe("report for 2 inputs\n");
    const skillMd = readFileSync(join(dir, "skill.md"), "utf8");
    expect(skillMd).toContain("## File SKILL.md");
    expect(skillMd).toContain("- scripts/run.sh");
    const args = readFileSync(calls, "utf8");
    expect(args).toContain("--no-tools --no-skills --no-extensions --no-prompt-templates --no-context-files");
    expect(args).toContain("--model openai-codex/gpt-6-luna --thinking high");
    expect(args).toContain("assets/analyst.md");
  });

  test("several parts are merged; model and thinking can be set", () => {
    writeFileSync(calls, "");
    const dir = digests("many", [60, 60, 60]);
    run([dir, skill, "--chunk-chars", "100", "--thinking", "low"], { PI_SKILL_REVIEW_MODEL: "local/x" });
    expect(existsSync(join(dir, "report-part-3.md"))).toBe(true);
    const lines = readFileSync(calls, "utf8").trim().split("\n");
    expect(lines).toHaveLength(4);
    expect(lines[3]).toContain("assets/merge.md");
    expect(lines[0]).toContain("--model local/x --thinking low");
  });

  test("errors", () => {
    const empty = digests("empty", []);
    expect(() => run([empty, skill])).toThrow(/no digests/);
    expect(() => run([digests("noskill", [1]), root])).toThrow(/no SKILL.md/);
    expect(() => run([empty])).toThrow(/usage/);
    expect(() => run([empty, skill, "--bogus"])).toThrow(/usage/);
  });
});
