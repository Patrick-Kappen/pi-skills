import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { agentDir, configPath, loadConfig, NO_TRIGGERS, parseConfig, SEMANTIC_DEFAULTS } from "./config.ts";

const home = "/home/u";

describe("paths", () => {
  test("defaults", () => {
    expect(agentDir({}, home)).toBe("/home/u/.pi/agent");
    expect(configPath({}, home)).toBe("/home/u/.pi/agent/repo-skills.json");
  });

  test("environment overrides", () => {
    expect(configPath({ PI_CODING_AGENT_DIR: "~/agent" }, home)).toBe("/home/u/agent/repo-skills.json");
    expect(configPath({ PI_REPO_SKILLS_CONFIG: "~/x.json" }, home)).toBe("/home/u/x.json");
  });
});

describe("parseConfig", () => {
  test("valid entries, trimmed and with ~ expanded", () => {
    const config = parseConfig(
      { skills: { a: { path: "~/skills/a", repos: [" o/r ", "*"] }, b: { path: "/s/b", repos: ["~/src"] } } },
      "f",
      home,
    );
    expect(config.errors).toEqual([]);
    expect(config.skills).toEqual([
      { name: "a", path: "/home/u/skills/a", repos: ["o/r", "*"], triggers: NO_TRIGGERS },
      { name: "b", path: "/s/b", repos: ["~/src"], triggers: NO_TRIGGERS },
    ]);
  });

  test("no skills", () => {
    expect(parseConfig({}, "f", home)).toEqual({ path: "f", skills: [], errors: [] });
  });

  test.each([
    [[], "expected a JSON object"],
    [{ skills: [] }, '"skills" must be an object'],
  ])("invalid file %j", (raw, message) => {
    expect(parseConfig(raw, "f", home).errors[0]).toContain(message);
  });

  test("invalid entries are reported, valid ones kept", () => {
    const config = parseConfig(
      {
        skills: {
          notObject: 1,
          noPath: { repos: ["o/r"] },
          relative: { path: "skills/x", repos: ["o/r"] },
          noRepos: { path: "/s" },
          emptyRepos: { path: "/s", repos: [] },
          blankRepo: { path: "/s", repos: [" "] },
          ok: { path: "/s/ok", repos: ["o/r"] },
        },
      },
      "f",
      home,
    );
    expect(config.skills.map((skill) => skill.name)).toEqual(["ok"]);
    expect(config.errors).toHaveLength(6);
  });
});

describe("triggers", () => {
  const parse = (triggers: unknown) =>
    parseConfig({ skills: { a: { path: "/s/a", repos: ["*"], triggers } } }, "f", home);

  test("valid, with extensions normalized", () => {
    const config = parse({ paths: ["**/*.nix"], extensions: ["tf", ".hcl"], errors: ["command not found"] });
    expect(config.errors).toEqual([]);
    expect(config.skills[0]?.triggers).toEqual({
      paths: ["**/*.nix"],
      extensions: [".tf", ".hcl"],
      errors: ["command not found"],
    });
  });

  test("missing lists are empty", () => {
    expect(parse({ paths: ["x"] }).skills[0]?.triggers).toEqual({ paths: ["x"], extensions: [], errors: [] });
  });

  test.each([
    [[], '"triggers" must be an object'],
    [{ paths: "x" }, '"triggers.paths" must be a list of strings'],
    [{ errors: ["("] }, "invalid regular expression"],
  ])("invalid %j is reported, the skill kept", (triggers, message) => {
    const config = parse(triggers);
    expect(config.skills).toHaveLength(1);
    expect(config.errors[0]).toContain(message);
  });
});

describe("semantic", () => {
  test("defaults, trailing slash removed", () => {
    expect(parseConfig({ semantic: { url: "http://h:1/" } }, "f", home).semantic).toEqual({
      ...SEMANTIC_DEFAULTS,
      url: "http://h:1",
    });
  });

  test("overrides", () => {
    const semantic = { url: "https://h", embedModel: "e", rerankModel: "r", load: 0.8, hint: 0.4, part: 0.7 };
    const config = parseConfig({ semantic: { ...semantic, maxParts: 1, candidates: 0, timeoutMs: 500 } }, "f", home);
    expect(config.errors).toEqual([]);
    expect(config.semantic).toEqual({ ...semantic, maxParts: 1, candidates: 0, timeoutMs: 500 });
  });

  test("absent or null is off", () => {
    expect(parseConfig({}, "f", home).semantic).toBeUndefined();
    expect(parseConfig({ semantic: null }, "f", home).semantic).toBeUndefined();
  });

  test("invalid values are reported", () => {
    expect(parseConfig({ semantic: { url: "localhost" } }, "f", home).errors[0]).toContain('needs "url"');
    const config = parseConfig({ semantic: { url: "http://h", embedModel: "", load: 2, maxParts: 1.5 } }, "f", home);
    expect(config.errors).toHaveLength(3);
    expect(config.semantic).toEqual({ ...SEMANTIC_DEFAULTS, url: "http://h" });
  });
});

describe("loadConfig", () => {
  const dir = mkdtempSync(join(tmpdir(), "repo-skills-config-"));

  test("missing file", () => {
    expect(loadConfig(join(dir, "missing.json"), home)).toEqual({
      path: join(dir, "missing.json"),
      skills: [],
      errors: [],
    });
  });

  test("invalid JSON", () => {
    const file = join(dir, "bad.json");
    writeFileSync(file, "{");
    expect(loadConfig(file, home).errors[0]).toContain("invalid JSON");
  });

  test("unreadable file", () => {
    expect(loadConfig(dir, home).errors).toHaveLength(1);
  });

  test("valid file", () => {
    const file = join(dir, "ok.json");
    writeFileSync(file, JSON.stringify({ skills: { a: { path: "/s/a", repos: ["*"] } } }));
    chmodSync(file, 0o444);
    expect(loadConfig(file, home).skills).toEqual([{ name: "a", path: "/s/a", repos: ["*"], triggers: NO_TRIGGERS }]);
  });
});
