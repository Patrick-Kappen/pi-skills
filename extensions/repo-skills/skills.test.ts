import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { NO_TRIGGERS } from "./config.ts";
import {
  type LoadedSkill,
  partExcerpt,
  readSkillSet,
  saysWhen,
  skillBlock,
  skillMarker,
  splitFrontmatter,
} from "./skills.ts";

const root = mkdtempSync(join(tmpdir(), "repo-skills-skills-"));

afterAll(() => rmSync(root, { recursive: true, force: true }));

function write(path: string, text: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
}

describe("splitFrontmatter", () => {
  test("plain, quoted, folded and literal values", () => {
    const { fields, body } = splitFrontmatter(
      [
        "\uFEFF---",
        "name: demo",
        'description: "Quoted: \\"x\\". Use when asked."',
        "single: 'it''s'",
        'broken: "a\\q"',
        "folded: >-",
        "  one",
        "  two",
        "",
        "literal: |",
        "  a",
        "  b",
        "plain: first",
        "  second",
        "metadata:",
        '  version: "1.0.0"',
        "- not a field",
        "---",
        "body",
      ].join("\r\n"),
    );
    expect(fields).toEqual({
      name: "demo",
      description: 'Quoted: "x". Use when asked.',
      single: "it's",
      broken: "a\\q",
      folded: "one two",
      literal: "a\nb",
      plain: "first second",
      metadata: 'version: "1.0.0"',
    });
    expect(body).toBe("body");
  });

  test("no front matter", () => {
    expect(splitFrontmatter("# Title")).toEqual({ fields: {}, body: "# Title" });
    expect(splitFrontmatter("---\nname: x\n---")).toEqual({ fields: { name: "x" }, body: "" });
  });
});

const readSkill = (entry: Parameters<typeof readSkillSet>[0]) => readSkillSet(entry)[0];

describe("readSkill", () => {
  test("front matter, body and parts", () => {
    const dir = join(root, "demo");
    write(
      join(dir, "SKILL.md"),
      "---\nname: demo\ndescription: Do things. Use when asked.\ndisable-model-invocation: true\n---\n\n# Demo\n",
    );
    write(join(dir, "references", "b.md"), "B");
    write(join(dir, "guides", "01-a.md"), "A");
    for (const skip of ["prompts", "templates", "assets", "scripts", ".hidden"]) write(join(dir, skip, "x.md"), "no");
    write(join(dir, "references", "notes.txt"), "no");
    const skill = readSkill({ name: "demo", path: dir, repos: ["*"], triggers: NO_TRIGGERS, subskills: {} });
    expect(skill).toMatchObject({
      name: "demo",
      description: "Do things. Use when asked.",
      disableModelInvocation: true,
      filePath: join(dir, "SKILL.md"),
      baseDir: dir,
      body: "# Demo",
      parts: [
        { path: "guides/01-a.md", text: "A" },
        { path: "references/b.md", text: "B" },
      ],
    });
  });

  test("defaults without front matter", () => {
    const dir = join(root, "bare");
    write(join(dir, "SKILL.md"), "body");
    expect(readSkill({ name: "bare", path: dir, repos: ["*"], triggers: NO_TRIGGERS, subskills: {} })).toMatchObject({
      name: "bare",
      description: "",
      disableModelInvocation: false,
    });
  });

  test("missing SKILL.md", () => {
    expect(
      readSkill({ name: "x", path: join(root, "none"), repos: ["*"], triggers: NO_TRIGGERS, subskills: {} }),
    ).toBeUndefined();
  });
});

const skill: LoadedSkill = {
  name: "demo",
  description: "Do things. Use when asked.",
  disableModelInvocation: false,
  filePath: "/s/demo/SKILL.md",
  baseDir: "/s/demo",
  body: "# Demo",
  parts: [],
  triggers: NO_TRIGGERS,
};

describe("sub-skills", () => {
  const dir = join(root, "sltn");
  write(join(dir, "SKILL.md"), "---\nname: sltn\ndescription: Bicep rules. Use when writing Bicep.\n---\n\n# Rules\n");
  write(join(dir, "references", "gotchas.md"), "gotchas");
  write(
    join(dir, "skills", "storage", "SKILL.md"),
    "---\nname: storage\ndescription: Storage accounts. Use when adding storage.\ndisable-model-invocation: true\n---\n\n# Storage\n",
  );
  write(join(dir, "skills", "storage", "references", "private-endpoints.md"), "pe");
  write(
    join(dir, "skills", "storage", "skills", "queues", "SKILL.md"),
    "---\ndescription: Queues. Use when adding queues.\n---\nq",
  );
  write(join(dir, "skills", "network", "SKILL.md"), "---\ndescription: VNets. Use when adding networks.\n---\nn");
  const triggers = { paths: ["*.bicep"], extensions: [], errors: [] };
  const set = readSkillSet({
    name: "sltn",
    path: dir,
    repos: ["*"],
    triggers: NO_TRIGGERS,
    subskills: { storage: { triggers } },
  });

  test("the main skill first, its parts without the sub-skills", () => {
    expect(set.map((skill) => skill.name)).toEqual(["sltn", "sltn/network", "sltn/storage", "sltn/queues"]);
    expect(set[0]?.parts.map((part) => part.path)).toEqual(["references/gotchas.md"]);
    expect(set[0]?.parent).toBeUndefined();
  });

  test("sub-skills link back to the main skill, load by trigger, and are not run-only-on-request", () => {
    const storage = set.find((skill) => skill.name === "sltn/storage");
    expect(storage).toMatchObject({
      parent: { name: "sltn", filePath: join(dir, "SKILL.md") },
      disableModelInvocation: false,
      triggers,
      parts: [{ path: "references/private-endpoints.md", text: "pe" }],
    });
    expect(set.find((skill) => skill.name === "sltn/queues")?.parent?.name).toBe("sltn");
    expect(set.find((skill) => skill.name === "sltn/network")?.triggers).toEqual(NO_TRIGGERS);
  });

  test("the block of a sub-skill names its main skill", () => {
    const block = skillBlock(set.find((skill) => skill.name === "sltn/storage") as LoadedSkill);
    expect(block).toMatch(
      /^<skill name="sltn\/storage" location="[^"]+">\nReferences are relative to [^\n]+\nPart of the skill sltn \(/,
    );
    expect(skillBlock(set[0] as LoadedSkill)).not.toContain("Part of the skill");
  });
});

describe("saysWhen", () => {
  test.each([
    ["Do things. Use when asked.", true],
    ["Do things. Use for X.", true],
    ["Do things. Run only on request via /x.", true],
    ["Helps with things.", false],
  ])("%s", (description, expected) => {
    expect(saysWhen({ ...skill, description })).toBe(expected);
  });
});

describe("skillBlock", () => {
  test("the format of /skill:name, which pi recognizes", () => {
    const block = skillBlock(skill);
    expect(block).toBe(
      `<skill name="demo" location="/s/demo/SKILL.md">\nReferences are relative to /s/demo.\n\n# Demo\n</skill>`,
    );
    expect(`${block}\n\nhi`).toMatch(
      /^<skill name="([^"]+)" location="([^"]+)">\n([\s\S]*?)\n<\/skill>(?:\n\n([\s\S]+))?$/,
    );
    expect(block.startsWith(skillMarker("demo"))).toBe(true);
  });

  test("with parts, long ones cut off", () => {
    const block = skillBlock(skill, [
      { path: "references/a.md", text: "A\n" },
      { path: "references/long.md", text: "x".repeat(20_001) },
    ]);
    expect(block).toContain('<skill-part path="references/a.md">\nA\n</skill-part>');
    expect(block).toContain("[cut off; read references/long.md for the rest]");
    expect(block.endsWith("</skill-part>\n</skill>")).toBe(true);
  });

  test("partExcerpt is the path and the start", () => {
    expect(partExcerpt({ path: "a.md", text: "y".repeat(2000) })).toBe(`a.md\n${"y".repeat(1500)}`);
  });
});
