import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { NO_TRIGGERS } from "./config.ts";
import {
  type LoadedSkill,
  partExcerpt,
  readSkill,
  saysWhen,
  skillBlock,
  skillMarker,
  splitFrontmatter,
} from "./skills.ts";

const root = mkdtempSync(join(tmpdir(), "repo-skills-skills-"));

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
    const skill = readSkill({ name: "demo", path: dir, repos: ["*"], triggers: NO_TRIGGERS });
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
    expect(readSkill({ name: "bare", path: dir, repos: ["*"], triggers: NO_TRIGGERS })).toMatchObject({
      name: "bare",
      description: "",
      disableModelInvocation: false,
    });
  });

  test("missing SKILL.md", () => {
    expect(readSkill({ name: "x", path: join(root, "none"), repos: ["*"], triggers: NO_TRIGGERS })).toBeUndefined();
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
