import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { checkRepo } from "../../../scripts/check-skills.ts";

const repoRoot = resolve(import.meta.dirname, "../../..");
const script = join(repoRoot, "skills/skill-create/scripts/new-skill.sh");
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A copy of the parts of this repository that new-skill.sh needs. */
function repo(): string {
  const root = mkdtempSync(join(tmpdir(), "new-skill-"));
  roots.push(root);
  cpSync(join(repoRoot, "skills"), join(root, "skills"), { recursive: true });
  mkdirSync(join(root, "scripts"));
  writeFileSync(join(root, "scripts/check-skills.ts"), "");
  cpSync(join(repoRoot, "README.md"), join(root, "README.md"));
  return root;
}

function run(root: string, ...args: string[]): string {
  return execFileSync(script, ["--repo", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

const describeOk = "Do the demo. Use when testing the demo.";

describe("new-skill.sh", () => {
  test("dry run writes nothing", () => {
    const root = repo();
    const out = run(root, "--name", "demo", "--kind", "single", "--description", describeOk, "--dry-run");
    expect(out).toContain("skills/demo (single)");
    expect(out).toContain("files        SKILL.md references/topic.md");
    expect(existsSync(join(root, "skills/demo"))).toBe(false);
  });

  test("index skill with a prompt: files, placeholders, README row, and TODOs left for the author", () => {
    const root = repo();
    run(root, "--name", "demo", "--kind", "index", "--description", describeOk, "--prompt");
    const skill = readFileSync(join(root, "skills/demo/SKILL.md"), "utf8");
    expect(skill).toContain(`name: demo\ndescription: ${describeOk}\nmetadata:`);
    expect(skill).not.toContain("@");
    expect(readFileSync(join(root, "skills/demo/prompts/demo.md"), "utf8")).toContain("Use the demo skill");
    expect(existsSync(join(root, "skills/demo/guides/01-step.md"))).toBe(true);
    const readme = readFileSync(join(root, "README.md"), "utf8").split("\n");
    const row = readme.findIndex((line) => line.includes("(skills/demo/SKILL.md)"));
    expect(readme[row - 1]).toMatch(/^\| \[`[a-z-]+`\]\(skills\//);
    const problems = checkRepo(root, ["demo"]).map((problem) => problem.message);
    expect(problems).toContain("still has TODO markers from the skeleton");
    expect(problems).toContain("its row in the skill table still says TODO");
  });

  test("manual skill", () => {
    const root = repo();
    run(
      root,
      "--name",
      "demo",
      "--kind",
      "single",
      "--manual",
      "--description",
      "Does it. Run only on request via /demo.",
    );
    expect(readFileSync(join(root, "skills/demo/SKILL.md"), "utf8")).toContain(
      "disable-model-invocation: true\nmetadata:",
    );
  });

  test.each([
    [["--name", "demo", "--kind", "single", "--description", describeOk], "already exists"],
    [["--name", "Bad", "--kind", "single", "--description", describeOk], "--name must be"],
    [["--name", "x", "--kind", "big", "--description", describeOk], "--kind must be"],
    [["--name", "x", "--kind", "single"], "--description is required"],
    [["--name", "x", "--kind", "single", "--description", "Helps."], "must say when"],
    [["--name", "x", "--kind", "single", "--description", 'Use when "quoted".'], "must not contain"],
    [["--name", "x", "--kind", "single", "--description", `Use when ${"y".repeat(1100)}`], "maximum is 1024"],
    [["--name", "x", "--kind", "single", "--manual", "--description", "Does it."], "how to start it"],
    [["--bogus"], "unknown argument"],
  ])("refuses %j", (args, message) => {
    const root = repo();
    if (message === "already exists") run(root, ...args);
    expect(() => run(root, ...args)).toThrow(message);
  });

  test("needs the pi-skills repository", () => {
    const empty = mkdtempSync(join(tmpdir(), "new-skill-empty-"));
    roots.push(empty);
    expect(() => run(empty, "--name", "x", "--kind", "single", "--description", describeOk)).toThrow(
      "not the pi-skills repository",
    );
    expect(() => execFileSync(script, ["--name", "x"], { stdio: "pipe" })).toThrow("--repo");
  });
});
