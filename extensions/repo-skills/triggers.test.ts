import { describe, expect, test } from "vitest";
import type { Triggers } from "./config.ts";
import type { LoadedSkill } from "./skills.ts";
import { type ContextEntry, matchesFile, matchingError, skillsInContext, toolPath } from "./triggers.ts";

const home = "/home/u";

function skill(name: string, triggers: Partial<Triggers> = {}): LoadedSkill {
  return {
    name,
    description: "d",
    disableModelInvocation: false,
    filePath: `/s/${name}/SKILL.md`,
    baseDir: `/s/${name}`,
    body: "",
    parts: [],
    triggers: { paths: [], extensions: [], errors: [], ...triggers },
  };
}

describe("toolPath", () => {
  test.each([
    ["a/b.ts", "/repo/a/b.ts"],
    ["@a/b.ts", "/repo/a/b.ts"],
    ["/x/y", "/x/y"],
    ["~/z", "/home/u/z"],
    ["~", "/home/u"],
  ])("%s", (path, expected) => {
    expect(toolPath(path, "/repo", home)).toBe(expected);
  });
});

describe("matchesFile", () => {
  const nix = skill("nix", { paths: ["*.nix", "nix/**", "~/notes/**"], extensions: [".TF"] });

  test.each([
    ["/repo/flake.nix", true],
    ["/repo/deep/default.nix", true],
    ["/repo/nix/package.sh", true],
    ["/other/nix/package.sh", false],
    ["/repo/main.tf", true],
    ["/home/u/notes/a.md", true],
    ["/repo/src/index.ts", false],
    ["/repo", false],
  ])("%s", (file, expected) => {
    expect(matchesFile(nix, file, "/repo", home)).toBe(expected);
  });
});

describe("matchingError", () => {
  test("case-insensitive regular expressions", () => {
    const env = skill("env", { errors: ["command not found", "No module named \\w+"] });
    expect(matchingError(env, "bash: jq: Command Not Found")).toBe("command not found");
    expect(matchingError(env, "ModuleNotFoundError: No module named yaml")).toBe("No module named \\w+");
    expect(matchingError(env, "ok")).toBeUndefined();
  });
});

describe("skillsInContext", () => {
  const skills = [skill("git"), skill("nix"), skill("other")];

  const call = (id: string, path: unknown, name = "read") => ({ type: "toolCall", id, name, arguments: { path } });
  const result = (toolCallId: string, isError = false): ContextEntry => ({
    type: "message",
    message: { role: "toolResult", toolCallId, isError, content: [{ type: "text", text: "..." }] },
  });

  test("skill blocks, and reads of SKILL.md that returned", () => {
    const loaded = skillsInContext(
      [
        { type: "message", message: { role: "user", content: '<skill name="git" location="x">\n</skill>' } },
        {
          type: "message",
          message: {
            role: "assistant",
            content: [
              { type: "thinking" },
              call("1", "/s/nix/SKILL.md"),
              call("2", "@/s/other/SKILL.md"),
              { type: "toolCall" },
            ],
          },
        },
        result("1"),
        result("2", true),
        { type: "message", message: { role: "user", content: [{ type: "text" }] } },
        { type: "message", message: { role: "user", content: 5 } },
        { type: "message" },
        { type: "compaction" },
      ],
      skills,
    );
    expect([...loaded].sort()).toEqual(["git", "nix"]);
  });

  test("a read that is still running is not in context", () => {
    // At tool_call time the assistant message with the call is already in the session.
    const entries: ContextEntry[] = [
      { type: "message", message: { role: "assistant", content: [call("1", "/s/nix/SKILL.md")] } },
    ];
    expect(skillsInContext(entries, skills).size).toBe(0);
  });

  test("other tools, other files and markers in assistant text do not count", () => {
    const entries: ContextEntry[] = [
      {
        type: "message",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: '<skill name="git"' },
            call("1", "/s/nix/SKILL.md", "bash"),
            call("2", "/s/nix/other.md"),
            call("3", 5),
          ],
        },
      },
      result("1"),
      result("2"),
      result("3"),
      { type: "message", message: { role: "assistant", content: "text" } },
    ];
    expect(skillsInContext(entries, skills).size).toBe(0);
  });

  test("a path in a user message is no read", () => {
    const entries = [
      { type: "message", message: { role: "user", content: [{ type: "text", text: "/s/other/SKILL.md" }] } },
    ];
    expect(skillsInContext(entries, skills).size).toBe(0);
  });
});
