import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, test, vi } from "vitest";
import { NO_TRIGGERS, SEMANTIC_DEFAULTS } from "./config.ts";
import {
  createRepoSkills,
  type Decision,
  decide,
  lastUserText,
  note,
  type RepoSkillsApi,
  SCORE_ENTRY,
  scoreReport,
  scoringQuery,
} from "./index.ts";
import type { Fetch, Ranking } from "./semantic.ts";
import type { LoadedSkill } from "./skills.ts";
import type { ContextEntry } from "./triggers.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "repo-skills-flow-")));
const work = join(root, "work");

function skillDir(name: string, description: string, extra = ""): string {
  const dir = join(root, "skills", name);
  mkdirSync(join(dir, "references"), { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n${extra}---\n\n# ${name}\n`);
  writeFileSync(join(dir, "references", "rebasing.md"), "rebase after a squash merge");
  return dir;
}

let gitDir = "";
let nixDir = "";

function writeConfig(file: string, semantic: boolean): void {
  writeFileSync(
    file,
    JSON.stringify({
      ...(semantic ? { semantic: { url: "http://embed", candidates: 0 } } : {}),
      skills: {
        git: { path: gitDir, repos: ["*"] },
        nix: {
          path: nixDir,
          repos: ["*"],
          triggers: { paths: ["*.nix"], errors: ["command not found"] },
        },
        scaffold: {
          path: skillDir(
            "scaffold",
            "Scaffold a repository. Run only on request via /scaffold.",
            "disable-model-invocation: true\n",
          ),
          repos: ["*"],
          triggers: { extensions: [".scaffold"] },
        },
        vague: { path: skillDir("vague", "Helps."), repos: ["*"] },
      },
    }),
  );
}

beforeAll(() => {
  mkdirSync(work, { recursive: true });
  gitDir = skillDir("git", "Work with git. Use when rebasing.");
  nixDir = skillDir("nix", "NixOS environment. Use when a command is missing.");
  writeConfig(join(root, "on.json"), true);
  writeConfig(join(root, "off.json"), false);
});

type Handler = (event: unknown, ctx: unknown) => unknown;

/** Rerank scores by keyword: `git`/`rebase` prompts hit git, `scaffold` prompts the scaffold skill. */
const fakeServer = vi.fn<Fetch>(async (url, init) => {
  const body = JSON.parse(String(init.body)) as { query: string; documents: string[] };
  if (url.endsWith("/v1/embeddings")) return Response.json({ data: [] });
  const score = (document: string) => {
    if (body.query.includes("down")) return 0;
    if (body.query.includes("maybe") && document.startsWith("git:")) return 0.6;
    if (/rebase|git/.test(body.query) && (document.startsWith("git:") || document.includes("rebase"))) return 0.95;
    if (body.query.includes("scaffold") && document.startsWith("scaffold:")) return 0.95;
    return 0.01;
  };
  if (body.query.includes("broken")) return new Response("", { status: 500 });
  return Response.json({
    results: body.documents.map((document, index) => ({ index, relevance_score: score(document) })),
  });
});

function setup(config = join(root, "on.json")) {
  const handlers = new Map<string, Handler>();
  let command: ((args: string, ctx: unknown) => Promise<void>) | undefined;
  const appendEntry = vi.fn();
  const pi = {
    on: (name: string, handler: Handler) => handlers.set(name, handler),
    registerCommand: (_name: string, options: { handler: typeof command }) => {
      command = options.handler;
    },
    appendEntry,
  } as unknown as RepoSkillsApi;
  createRepoSkills(pi, { env: { PI_REPO_SKILLS_CONFIG: config }, home: root, fetch: fakeServer });
  const notify = vi.fn();
  let entries: ContextEntry[] = [];
  const ctx = { cwd: work, hasUI: true, ui: { notify }, sessionManager: { buildContextEntries: () => entries } };
  const fire = (name: string, event: object) => handlers.get(name)?.({ type: name, ...event }, ctx);
  fire("resources_discover", { cwd: work, reason: "startup" });
  return {
    fire,
    notify,
    appendEntry,
    setEntries: (next: ContextEntry[]) => {
      entries = next;
    },
    input: (text: string) =>
      fire("input", { text, source: "interactive" }) as Promise<{ action: string; text?: string }>,
    command: async (args: string) => {
      await command?.(args, ctx);
      return notify.mock.lastCall?.[0] as string;
    },
  };
}

const user = (text: string): ContextEntry => ({ type: "message", message: { role: "user", content: text } });

describe("input", () => {
  test("a high score loads the skill with its parts before the prompt", async () => {
    const ext = setup();
    const result = await ext.input("rebase my branch after the squash merge, please, it has conflicts");
    expect(result.action).toBe("transform");
    expect(result.text).toMatch(/^<skill name="git" location="[^"]+SKILL\.md">\nReferences are relative to /);
    expect(result.text).toContain('<skill-part path="references/rebasing.md">');
    expect(
      result.text?.endsWith("\n</skill>\n\nrebase my branch after the squash merge, please, it has conflicts"),
    ).toBe(true);
    expect(ext.notify).toHaveBeenCalledWith(
      expect.stringContaining("loaded git (0.95, references/rebasing.md)"),
      "info",
    );
    expect(ext.appendEntry).toHaveBeenCalledWith(SCORE_ENTRY, expect.objectContaining({ decision: "load" }));
  });

  test("a skill still in context gets a note instead, and keeps the images", async () => {
    const ext = setup();
    ext.setEntries([user('<skill name="git" location="x">\n</skill>')]);
    const images = [{ type: "image", data: "", mimeType: "image/png" }];
    const result = (await ext.fire("input", { text: "git rebase again", source: "interactive", images })) as {
      text: string;
      images: unknown;
    };
    expect(result.text).toContain("git rebase again\n\n<system>The skill git is still in this conversation above.");
    expect(result.text).not.toContain("<skill name=");
    expect(result.images).toBe(images);
  });

  test("a medium score gives a hint", async () => {
    const result = await setup().input("maybe something");
    expect(result.text).toContain("<system>The skill git probably applies");
  });

  test("a run-only-on-request skill is suggested", async () => {
    const ext = setup();
    const result = await ext.input("scaffold a repo");
    expect(result.text).toContain("Suggest /skill:scaffold to the user");
    expect(ext.notify).toHaveBeenCalledWith("repo-skills: /skill:scaffold may help (0.95)", "info");
  });

  test.each(["down", "broken", "/skill:git", "/reload"])("%s goes on unchanged", async (text) => {
    expect(await setup().input(text)).toEqual({ action: "continue" });
  });

  test("without scoring, unchanged", async () => {
    expect(await setup(join(root, "off.json")).input("rebase")).toEqual({ action: "continue" });
  });

  test("warns about a description without when", () => {
    const ext = setup();
    ext.fire("session_start", {});
    expect(ext.notify).toHaveBeenCalledWith(
      expect.stringContaining("vague: the description does not say when"),
      "warning",
    );
  });
});

describe("tool_call", () => {
  test("an edit of a covered file waits for the skill", () => {
    const ext = setup();
    const result = ext.fire("tool_call", { toolName: "edit", input: { path: "flake.nix" } }) as {
      block: boolean;
      reason: string;
    };
    expect(result.block).toBe(true);
    expect(result.reason).toMatch(/^<skill name="nix"/);
    expect(result.reason).toContain("then repeat the edit call");
    // The same turn does not block twice; a new turn without the skill in the entries does.
    expect(ext.fire("tool_call", { toolName: "write", input: { path: "a.nix" } })).toBeUndefined();
    ext.fire("turn_start", {});
    expect(ext.fire("tool_call", { toolName: "write", input: { path: "a.nix" } })).toMatchObject({ block: true });
  });

  test("a run-only-on-request skill does not block", () => {
    expect(setup().fire("tool_call", { toolName: "write", input: { path: "x.scaffold" } })).toBeUndefined();
  });

  test("a second read of a SKILL.md in context is refused", () => {
    const ext = setup();
    const read = { toolName: "read", input: { path: join(gitDir, "SKILL.md") } };
    expect(ext.fire("tool_call", read)).toBeUndefined();
    ext.setEntries([user('<skill name="git" location="x">\n</skill>')]);
    expect(ext.fire("tool_call", read)).toMatchObject({ block: true });
    expect(ext.fire("tool_call", { toolName: "read", input: { path: "other.md" } })).toBeUndefined();
  });

  test("ignored calls", () => {
    const ext = setup();
    expect(ext.fire("tool_call", { toolName: "bash", input: { command: "ls" } })).toBeUndefined();
    expect(ext.fire("tool_call", { toolName: "grep", input: { path: "a.nix" } })).toBeUndefined();
    expect(ext.fire("tool_call", { toolName: "edit", input: { path: "a.ts" } })).toBeUndefined();
    expect(
      ext.fire("tool_call", { toolName: "edit", input: { path: "a.nix" }, parentToolCallId: "p" }),
    ).toBeUndefined();
  });
});

describe("tool_result", () => {
  const text = (value: string) => [{ type: "text", text: value }];

  test("an error a skill knows adds the skill to the result", () => {
    const ext = setup();
    const result = ext.fire("tool_result", { toolName: "bash", input: {}, content: text("jq: command not found") }) as {
      content: { text: string }[];
    };
    expect(result.content).toHaveLength(2);
    expect(result.content[1]?.text).toMatch(/^<skill name="nix"/);
    expect(
      ext.fire("tool_result", { toolName: "bash", input: {}, content: text("command not found") }),
    ).toBeUndefined();
  });

  test("a read of a covered file adds the skill; a suggestion only once", () => {
    const ext = setup();
    expect(
      ext.fire("tool_result", { toolName: "read", input: { path: "flake.nix" }, content: text("{}") }),
    ).toMatchObject({
      content: [expect.anything(), { text: expect.stringMatching(/^<skill name="nix"/) }],
    });
    const scaffold = { toolName: "read", input: { path: "a.scaffold" }, content: text("") };
    expect(ext.fire("tool_result", scaffold)).toMatchObject({
      content: [expect.anything(), { text: expect.stringContaining("Suggest /skill:scaffold") }],
    });
    expect(ext.fire("tool_result", scaffold)).toBeUndefined();
  });

  test("file output and nested calls are not checked for errors", () => {
    const ext = setup();
    expect(
      ext.fire("tool_result", { toolName: "read", input: {}, content: text("command not found") }),
    ).toBeUndefined();
    expect(
      ext.fire("tool_result", { toolName: "bash", input: {}, content: [{ type: "image" }], parentToolCallId: "p" }),
    ).toBeUndefined();
    expect(ext.fire("tool_result", { toolName: "bash", input: {}, content: [{ type: "image" }] })).toBeUndefined();
  });
});

describe("/repo-skills", () => {
  test("shows scoring and triggers", async () => {
    const text = await setup().command("");
    expect(text).toContain("scoring: http://embed (load 0.9, hint 0.5, part 0.8)");
    expect(text).toContain("triggers: *.nix, /command not found/");
    expect(await setup(join(root, "off.json")).command("")).toContain("scoring: off");
  });

  test("score", async () => {
    const text = await setup().command("score rebase it");
    expect(text).toContain("decision: load");
    expect(text).toContain("- git: 0.950");
    expect(text).toContain("parts: references/rebasing.md");
    expect(await setup().command("score")).toContain("usage:");
    expect(await setup().command("score broken")).toContain("scoring failed");
    expect(await setup(join(root, "off.json")).command("score x")).toContain("scoring is off");
    expect(await setup().command("score down")).toContain("parts: none");
  });

  test("score without skills", async () => {
    const config = { path: "", skills: [], errors: [], semantic: { ...SEMANTIC_DEFAULTS, url: "http://embed" } };
    expect(await scoreReport("x", config, [], fakeServer)).toBe("no skills with a description are loaded");
  });
});

const skill: LoadedSkill = {
  name: "git",
  description: "d",
  disableModelInvocation: false,
  filePath: "/s/git/SKILL.md",
  baseDir: "/s/git",
  body: "",
  parts: [],
  triggers: NO_TRIGGERS,
};
const ranking = (score: number, extra: Partial<Ranking> = {}): Ranking => ({
  skill,
  score,
  parts: [],
  scores: [],
  ...extra,
});

describe("decide and note", () => {
  const thresholds = { load: 0.9, hint: 0.5 };

  test.each([
    [undefined, "none"],
    [ranking(0.4), "none"],
    [ranking(0.6), "hint"],
    [ranking(0.95), "load"],
  ])("%#", (value, kind) => {
    expect(decide(value, new Set(), thresholds).kind).toBe(kind);
  });

  test("loaded and suggest", () => {
    expect(decide(ranking(0.6), new Set(["git"]), thresholds).kind).toBe("loaded");
    expect(
      decide(ranking(0.95, { skill: { ...skill, disableModelInvocation: true } }), new Set(), thresholds).kind,
    ).toBe("suggest");
  });

  test("notes name the parts", () => {
    const parts = [{ path: "references/a.md", text: "" }];
    expect(note({ kind: "hint", skill, parts, score: 0.6 })).toContain("then references/a.md next to it.");
    expect(note({ kind: "hint", skill, parts: [], score: 0.6 })).toContain("change anything.</system>");
    expect(note({ kind: "loaded", skill, parts, score: 0.6 })).toContain(
      "Its parts for this request: references/a.md.",
    );
    expect(note({ kind: "loaded", skill, parts: [], score: 0.6 })).not.toContain("parts");
    expect(note({ kind: "none" } as Decision)).toBeUndefined();
  });
});

describe("scoringQuery", () => {
  const long = "x".repeat(60);

  test("a long prompt alone", () => {
    expect(scoringQuery(long, [user("before")])).toBe(long);
  });

  test("a short follow-up with the user message before, without what this extension added", () => {
    const entries: ContextEntry[] = [
      user("first"),
      {
        type: "message",
        message: {
          role: "user",
          content: [
            { type: "text", text: '<skill name="git" location="x">\nbody\n</skill>\n\nrebase it' },
            { type: "image" },
            { type: "text", text: "\n\n<system>note</system>" },
          ],
        },
      },
      { type: "message", message: { role: "assistant", content: "ok" } },
    ];
    expect(scoringQuery("do it", entries)).toBe("rebase it\n\ndo it");
    expect(scoringQuery("do it", [])).toBe("do it");
  });

  test("lastUserText of odd content", () => {
    expect(lastUserText([{ type: "message", message: { role: "user", content: 1 } }])).toBe("");
    expect(lastUserText([{ type: "message", message: { role: "user", content: [{ type: "text" }] } }])).toBe("");
  });
});
