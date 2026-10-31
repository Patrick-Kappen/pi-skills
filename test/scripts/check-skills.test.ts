import { chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { checkRepo, checkSkill, parseFrontmatter, referencedPaths } from "../../scripts/check-skills.ts";

const repoRoot = resolve(import.meta.dirname, "../..");
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const GOOD = `---
name: demo
description: Do the demo. Use when testing.
metadata:
  version: "1.2.3"
---

# demo

Read \`references/topic.md\` and [the guide](guides/01-step.md). Run \`scripts/run.sh\`.
`;

/** A repository with one skill `demo`; `files` overrides or adds files inside the skill. */
function repo(files: Record<string, string> = {}, readmeRow = true): string {
  const root = mkdtempSync(join(tmpdir(), "check-skills-"));
  roots.push(root);
  const skill = join(root, "skills", "demo");
  const all: Record<string, string> = {
    "SKILL.md": GOOD,
    "references/topic.md": "# topic\n",
    "guides/01-step.md": "# step\n",
    "scripts/run.sh": "#!/usr/bin/env bash\necho ok\n",
    ...files,
  };
  for (const [path, content] of Object.entries(all)) {
    mkdirSync(join(skill, path, ".."), { recursive: true });
    writeFileSync(join(skill, path), content);
  }
  chmodSync(join(skill, "scripts/run.sh"), 0o755);
  writeFileSync(join(root, "README.md"), readmeRow ? "| [`demo`](skills/demo/SKILL.md) | Demo. |\n" : "# none\n");
  return root;
}

const messages = (root: string) => checkRepo(root).map((problem) => `${problem.file}: ${problem.message}`);

describe("the skills of this repository", () => {
  test("follow the rules", () => {
    expect(checkRepo(repoRoot)).toEqual([]);
  });
});

describe("parseFrontmatter", () => {
  test("fields and metadata", () => {
    const fm = parseFrontmatter(GOOD);
    expect(typeof fm).toBe("object");
    if (typeof fm === "string") return;
    expect(fm.fields.get("name")).toBe("demo");
    expect(fm.metadata.get("version")).toBe("1.2.3");
  });

  test.each([
    ["no front matter", "# demo\n", "must start"],
    ["not closed", "---\nname: x\n", "not closed"],
    ["bad line", "---\nname x\n---\n", "key: value"],
  ])("%s", (_name, text, message) => {
    expect(parseFrontmatter(text)).toContain(message);
  });

  test("comments, blank lines and single quotes", () => {
    const fm = parseFrontmatter("---\n# c\n\nname: 'x'\n---\n");
    expect(typeof fm === "object" && fm.fields.get("name")).toBe("x");
  });
});

describe("referencedPaths", () => {
  test("links and resource paths, not code blocks, URLs or placeholders", () => {
    const text =
      "[a](references/a.md#x) [b](https://x.y) [c](/abs) `guides/01.md` `scripts/<name>.sh` `templates/*` `x/y.md`\n```sh\n`references/no.md`\n```\n";
    expect(referencedPaths(text).sort()).toEqual(["guides/01.md", "references/a.md"]);
  });
});

describe("checkRepo", () => {
  test("a good skill", () => {
    expect(messages(repo())).toEqual([]);
  });

  test("front matter problems", () => {
    const root = repo({
      "SKILL.md":
        "---\nname: other\ndescription: Helps.\ncolor: red\ndisable-model-invocation: maybe\nmetadata:\n  version: one\n---\n\nRun scripts/run.sh.\n",
    });
    expect(messages(root)).toEqual([
      'SKILL.md: unknown front matter field "color"',
      'SKILL.md: name "other" must equal the directory name "demo"',
      'SKILL.md: description must say when to use the skill ("Use when …" or "Use for …"); the model routes on it',
      "SKILL.md: disable-model-invocation must be true or false",
      'SKILL.md: metadata.version must be a version like "1.0.0"',
    ]);
  });

  test("description missing, too long, or manual without a way to start", () => {
    expect(messages(repo({ "SKILL.md": '---\nname: demo\nmetadata:\n  version: "1.0.0"\n---\n' }))[0]).toContain(
      "description is missing",
    );
    const long = `---\nname: demo\ndescription: Use when ${"x".repeat(1100)}\nmetadata:\n  version: "1.0.0"\n---\n`;
    expect(messages(repo({ "SKILL.md": long }))[0]).toContain("maximum is 1024");
    const manual =
      '---\nname: demo\ndescription: Does it.\ndisable-model-invocation: true\nmetadata:\n  version: "1.0.0"\n---\n\nRun scripts/run.sh.\n';
    expect(messages(repo({ "SKILL.md": manual }))[0]).toContain("how to start it");
    const ok = manual.replace("Does it.", "Does it. Run only on request via /demo.");
    expect(messages(repo({ "SKILL.md": ok }))).toEqual([]);
  });

  test("bad name, long SKILL.md, missing or broken SKILL.md", () => {
    const root = repo();
    cpSync(join(root, "skills/demo"), join(root, "skills/Bad_Name"), { recursive: true });
    const bad = checkSkill(join(root, "skills/Bad_Name")).map((problem) => problem.message);
    expect(bad.some((message) => message.includes("lowercase letters"))).toBe(true);
    expect(messages(repo({ "SKILL.md": `${GOOD}${"line\n".repeat(300)}` }))[0]).toContain("keep it under 300");
    expect(checkSkill(join(root, "nothing"))[0]?.message).toBe("SKILL.md is missing");
    expect(messages(repo({ "SKILL.md": "# demo\n" }))[0]).toContain("must start");
  });

  test("files: agent files, scripts, forbidden paths, TODO, links, prompts", () => {
    const root = repo({
      "AGENTS.md": "x\n",
      "scripts/plain.sh": "echo no shebang\n",
      "scripts/lib.sh": "x=1\n",
      "references/paths.md":
        "~/.pi/agent/skills/demo/x and /home/someone/x and /nix/store/abcdefghijklmnopqrstuvwxyz012345-x\n",
      "references/todo.md": "TODO: write this. `TODO` is fine.\n",
      "references/links.md": "[x](missing.md) `references/topic.md` `scripts/check-skills.ts`\n",
      "prompts/demo.md": "no front matter\n",
      "templates/AGENTS.md": "TODO templates are skipped\n",
    });
    mkdirSync(join(root, "scripts"));
    writeFileSync(join(root, "scripts/check-skills.ts"), "");
    expect(messages(root)).toEqual([
      "SKILL.md: does not name scripts/plain.sh; say in SKILL.md what each script does and when to run it",
      "AGENTS.md: agent files stay out of the repository",
      "prompts/demo.md: a prompt template needs front matter with a description",
      "references/links.md: points to missing.md, which does not exist",
      "references/paths.md: points into ~/.pi/agent/skills; skills run from the Nix store, use paths relative to SKILL.md",
      "references/paths.md: contains a home directory path; use ~ or a path relative to SKILL.md",
      "references/paths.md: contains a Nix store path; it changes with every build",
      "references/todo.md: still has TODO markers from the skeleton",
      "scripts/plain.sh: scripts must be executable (chmod +x)",
      "scripts/plain.sh: scripts must start with a shebang",
    ]);
  });

  test("every script is named in SKILL.md; libraries, notes and directories need not be", () => {
    const root = repo({
      "scripts/hidden.ts": "#!/usr/bin/env node\n",
      "scripts/lib-x.sh": "x=1\n",
      "scripts/README.md": "# scripts\n",
      "scripts/sub/x.sh": "#!/usr/bin/env bash\n",
    });
    chmodSync(join(root, "skills/demo/scripts/hidden.ts"), 0o755);
    chmodSync(join(root, "skills/demo/scripts/sub/x.sh"), 0o755);
    expect(messages(root)).toEqual([
      "SKILL.md: does not name scripts/hidden.ts; say in SKILL.md what each script does and when to run it",
    ]);
  });

  test("sub-skills: name equals the folder, description says when", () => {
    const root = repo({
      "skills/storage/SKILL.md":
        "---\nname: storage\ndescription: Storage accounts. Use when adding one.\n---\n\nRead `../../SKILL.md` first.\n",
      "skills/network/SKILL.md": `---\nname: net\ndescription: Networks ${"x".repeat(1100)}.\n---\n`,
      "skills/broken/SKILL.md": "no front matter\n",
    });
    expect(messages(root)).toEqual([
      "skills/broken/SKILL.md: SKILL.md must start with a front matter block (---)",
      'skills/network/SKILL.md: a sub-skill\'s name must equal its folder name "network"',
      "skills/network/SKILL.md: description has 1110 characters; the maximum is 1024",
      'skills/network/SKILL.md: a sub-skill is found only by its description: say when to use it ("Use when …")',
    ]);
  });

  test("agent directories inside a skill", () => {
    const root = repo();
    mkdirSync(join(root, "skills/demo/.claude"));
    expect(messages(root)).toEqual([".claude: agent files stay out of the repository"]);
  });

  test("README table", () => {
    expect(messages(repo({}, false))).toEqual(["../../README.md: is not in the skill table of README.md"]);
    const root = repo();
    writeFileSync(join(root, "README.md"), "| [`demo`](skills/demo/SKILL.md) | TODO: what it does. |\n");
    expect(messages(root)).toEqual(["../../README.md: its row in the skill table still says TODO"]);
  });

  test("only the named skills, and unknown names", () => {
    const root = repo({ "SKILL.md": "# broken\n" });
    expect(checkRepo(root, ["nope"]).map((problem) => problem.message)).toEqual(["no such skill in skills/"]);
  });
});
