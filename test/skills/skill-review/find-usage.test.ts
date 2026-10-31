import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import {
  analyseSession,
  commandLocation,
  findUsages,
  fitDigest,
  type Options,
  parseArgs,
  redact,
  renderDigest,
  skillDirOfRead,
} from "../../../skills/skill-review/scripts/find-usage.ts";

const script = resolve(import.meta.dirname, "../../../skills/skill-review/scripts/find-usage.ts");
const root = mkdtempSync(join(tmpdir(), "find-usage-"));
const sessions = join(root, "sessions");
afterAll(() => rmSync(root, { recursive: true, force: true }));

let counter = 0;
const entry = (message: object, id = `e${++counter}`) =>
  JSON.stringify({ type: "message", id, parentId: null, timestamp: "2026-10-30T10:00:00.000Z", message });
const user = (content: unknown) => entry({ role: "user", content });
const assistant = (content: object[]) => entry({ role: "assistant", provider: "openai", model: "m1", content });
const call = (name: string, args: object) => ({ type: "toolCall", id: "c", name, arguments: args });
const result = (text: string, isError = false) =>
  entry({ role: "toolResult", toolName: "bash", isError, content: [{ type: "text", text }] });

function session(path: string, lines: string[], header: object = {}): string {
  const file = join(sessions, path);
  mkdirSync(join(file, ".."), { recursive: true });
  const head = JSON.stringify({
    type: "session",
    version: 3,
    id: path.replace(/\W/g, ""),
    timestamp: "2026-10-30T09:00:00.000Z",
    cwd: "/w",
    ...header,
  });
  writeFileSync(file, `${[head, ...lines].join("\n")}\n{broken`);
  return file;
}

const readTrigger = assistant([
  { type: "thinking", thinking: "hmm" },
  { type: "text", text: "Loading the skill." },
  call("read", { path: "/s/demo/SKILL.md", offset: null }),
]);

const used = session("a/one.jsonl", [
  user("unrelated earlier work"),
  // Put together at run time, so the secret scanners of this repository do not flag the test.
  user([{ type: "text", text: `Please scaffold. ${["tok", "en=abcdef123456"].join("")}` }]),
  readTrigger,
  assistant([call("read", { path: "/s/demo/guides/01.md", limit: 10 }), call("bash", { command: "ls" })]),
  result("exit 0\nfine"),
  assistant([call("bash", { command: "make" })]),
  result("exit 2\nboom"),
  result("blocked", true),
  user("no, not like that"),
]);
// A fork copies the history of its parent, including the trigger entry.
session("a/one/forks/x/two.jsonl", readFileSync(used, "utf8").split("\n").slice(1, -1));
const command = session(
  "b/three.jsonl",
  [
    user('<skill name="demo" location="/store/demo/SKILL.md">\nbody\n</skill>\n\ngo'),
    assistant([{ type: "text", text: "ok" }]),
  ],
  { timestamp: "2026-10-31T09:00:00.000Z" },
);
session("c/old.jsonl", [readTrigger.replace(/"e\d+"/, '"old"')], { timestamp: "2025-01-01T00:00:00.000Z" });
session("d/none.jsonl", [user("mentions /demo/SKILL.md only in text")]);

const options = (extra: Partial<Options> = {}): Options => ({
  skill: "demo",
  sessions,
  limit: 30,
  maxChars: 20000,
  out: join(root, "out"),
  exclude: [],
  ...extra,
});

describe("helpers", () => {
  test("skillDirOfRead and commandLocation", () => {
    expect(skillDirOfRead("/x/demo/SKILL.md", "demo")).toBe("/x/demo");
    expect(skillDirOfRead("/x/demo-two/SKILL.md", "demo")).toBeUndefined();
    expect(commandLocation('<skill name="demo" location="/l/demo/SKILL.md">', "demo")).toBe("/l/demo");
    expect(commandLocation('<skill name="other" location="/l">', "demo")).toBeUndefined();
  });

  // Fake secrets are put together at run time, so the secret scanners of this repository do not
  // flag the test itself.
  const fake = (...parts: string[]) => parts.join("");
  test.each([
    [fake("gh", "p_", "abcdefghijklmnopqrstuvwxyz0123"), "[REDACTED]"],
    [fake("sk-", "ant-", "abcdefghijklmnopqrstuvwxyz"), "[REDACTED]"],
    [fake("AK", "IA", "ABCDEFGHIJKLMNOP"), "[REDACTED]"],
    ["Authorization: Bearer abcdefghijklmnopqrstuvwxyz", "Authorization: [REDACTED]"],
    ["API_KEY=supersecretvalue", "API_KEY=[REDACTED]"],
    ['password: "hunter2hunter2"', "password: [REDACTED]"],
    [fake("-----BEGIN OPENSSH ", "PRIVATE KEY-----\nabc\n-----END OPENSSH ", "PRIVATE KEY-----"), "[REDACTED]"],
    ["nothing secret here", "nothing secret here"],
  ])("redact %s", (input, expected) => {
    expect(redact(input)).toBe(expected);
  });

  test("fitDigest keeps head and tail", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i} ${"x".repeat(20)}`);
    const text = fitDigest(lines, 1000);
    expect(text.length).toBeLessThanOrEqual(1100);
    expect(text).toContain("line 0 ");
    expect(text).toContain("line 99 ");
    expect(text).toMatch(/\[… \d+ lines omitted …\]/);
    expect(fitDigest(["a", "b"], 100)).toBe("a\nb");
  });
});

describe("analyseSession", () => {
  test("a session where the model read SKILL.md", () => {
    const usage = analyseSession(used, readFileSync(used, "utf8"), "demo", 20000);
    expect(usage).toMatchObject({
      cwd: "/w",
      date: "2026-10-30",
      model: "openai/m1",
      location: "/s/demo",
      trigger: "read",
      filesRead: ["SKILL.md", "guides/01.md"],
      userMessages: 2,
      toolCalls: 4,
      toolErrors: 2,
    });
    expect(usage?.digest).not.toContain("unrelated earlier work");
    expect(usage?.digest).toContain("USER: Please scaffold. token=[REDACTED]");
    expect(usage?.digest).toContain('CALL read: /s/demo/guides/01.md {"limit":10}');
    expect(usage?.digest).toContain("FAILED bash: exit 2\nboom");
    expect(usage?.digest).toContain("FAILED bash: blocked");
    expect(usage?.digest).not.toContain("fine");
    expect(usage?.digest).toContain("USER: no, not like that");
  });

  test("a /skill command, and a session without the skill", () => {
    expect(analyseSession(command, readFileSync(command, "utf8"), "demo", 20000)).toMatchObject({
      trigger: "command",
      location: "/store/demo",
    });
    expect(analyseSession("x", '{"type":"session"}\n', "demo", 100)).toBeUndefined();
  });
});

describe("findUsages", () => {
  test("newest first, without fork copies", () => {
    const usages = findUsages(options());
    expect(usages.map((usage) => usage.file.slice(sessions.length + 1))).toEqual([
      "b/three.jsonl",
      "a/one.jsonl",
      "c/old.jsonl",
    ]);
  });

  test("since, limit and exclude", () => {
    expect(findUsages(options({ since: "2026-01-01" }))).toHaveLength(2);
    expect(findUsages(options({ limit: 1 }))).toHaveLength(1);
    expect(findUsages(options({ exclude: [command] })).map((usage) => usage.trigger)).toEqual(["read", "read"]);
  });

  test("renderDigest", () => {
    const [usage] = findUsages(options({ exclude: [command] }));
    if (!usage) throw new Error("no usage");
    const text = renderDigest({ ...usage, digest: "a ``` b" }, sessions);
    expect(text).toContain("- file: a/one.jsonl");
    expect(text).toContain("- skill files read: SKILL.md, guides/01.md");
    expect(text).toContain("a ''' b");
  });
});

describe("parseArgs", () => {
  test("defaults and options", () => {
    const parsed = parseArgs(["--skill", "demo"], {
      PI_CODING_AGENT_DIR: "/agent",
      XDG_CACHE_HOME: "/cache",
      PI_SESSION_FILE: "/s.jsonl",
    });
    expect(parsed).toMatchObject({
      skill: "demo",
      sessions: "/agent/sessions",
      limit: 30,
      maxChars: 20000,
      exclude: ["/s.jsonl"],
    });
    expect(parsed.out).toMatch(/^\/cache\/pi-skill-review\/demo-/);
    expect(parsed.since).toBeUndefined();
    const all = parseArgs(
      ["--skill", "x", "--sessions", "/s", "--since", "2026-01-01", "--limit", "5", "--max-chars", "99", "--out", "/o"],
      {},
    );
    expect(all).toMatchObject({ sessions: "/s", since: "2026-01-01", limit: 5, maxChars: 99, out: "/o", exclude: [] });
  });

  test("a skill name is required", () => {
    expect(() => parseArgs([], {})).toThrow("--skill");
    expect(() => parseArgs(["--skill", "Bad Name"], {})).toThrow("--skill");
  });
});

describe("the script", () => {
  test("writes digests and index.json", () => {
    const out = join(root, "cli");
    const stdout = execFileSync(script, ["--skill", "demo", "--sessions", sessions, "--out", out], {
      encoding: "utf8",
      env: { ...process.env, PI_SESSION_FILE: command },
    });
    expect(JSON.parse(stdout)).toEqual({ skill: "demo", out, sessions: 2 });
    expect(readdirSync(out).sort()).toEqual(["01-2026-10-30-aonejson.md", "02-2025-01-01-coldjson.md", "index.json"]);
    const index = JSON.parse(readFileSync(join(out, "index.json"), "utf8"));
    expect(index.sessions[0]).toMatchObject({ digest: "01-2026-10-30-aonejson.md", toolErrors: 2 });
    expect(index.sessions[0].digest).not.toContain("USER");
  });
});
