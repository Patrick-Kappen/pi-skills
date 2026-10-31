import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ResourcesDiscoverEvent } from "@earendil-works/pi-coding-agent";
import { beforeAll, describe, expect, test, vi } from "vitest";
import { NO_TRIGGERS } from "./config.ts";
import { createRepoSkills, type RepoSkillsApi, resourcePaths } from "./index.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "repo-skills-")));
const skills = join(root, "skills");
const repo = join(root, "repo");
const plain = join(root, "plain");
const configFile = join(root, "repo-skills.json");

function skill(name: string, prompts = false): string {
  const dir = join(skills, name);
  mkdirSync(join(dir, prompts ? "prompts" : ""), { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${name}\n---\n`);
  return dir;
}

beforeAll(() => {
  mkdirSync(repo, { recursive: true });
  mkdirSync(plain, { recursive: true });
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  execFileSync("git", ["init", "-q", repo], { env });
  execFileSync("git", ["-C", repo, "remote", "add", "origin", "git@github.com:Owner/Repo.git"], { env });
  writeFileSync(
    configFile,
    JSON.stringify({
      skills: {
        everywhere: { path: skill("everywhere"), repos: ["*"] },
        byRemote: { path: skill("byRemote", true), repos: ["owner/repo"] },
        byPath: { path: skill("byPath"), repos: [plain] },
        missing: { path: join(skills, "missing"), repos: ["owner/*"] },
        other: { path: skill("other"), repos: ["someone/else"] },
        broken: { repos: ["*"] },
      },
    }),
  );
});

type Handler = (event: unknown, ctx: unknown) => unknown;

function load(file = configFile) {
  const handlers = new Map<string, Handler>();
  let command: ((args: string, ctx: unknown) => Promise<void>) | undefined;
  const pi = {
    on: (name: string, handler: Handler) => handlers.set(name, handler),
    registerCommand: (_name: string, options: { handler: typeof command }) => {
      command = options.handler;
    },
  } as unknown as RepoSkillsApi;
  createRepoSkills(pi, { env: { PI_REPO_SKILLS_CONFIG: file }, home: root });
  const notify = vi.fn();
  const ctx = (cwd: string, hasUI = true) => ({ cwd, hasUI, ui: { notify } });
  return {
    discover: (cwd: string) =>
      handlers.get("resources_discover")?.(
        { type: "resources_discover", cwd, reason: "startup" } satisfies ResourcesDiscoverEvent,
        ctx(cwd),
      ) as {
        skillPaths: string[];
        promptPaths: string[];
      },
    start: (cwd: string, hasUI = true) => handlers.get("session_start")?.({ type: "session_start" }, ctx(cwd, hasUI)),
    command: async (cwd: string) => {
      await command?.("", ctx(cwd));
      return notify.mock.lastCall?.[0] as string;
    },
    notify,
  };
}

describe("resources_discover", () => {
  test("in a matching repository", () => {
    const ext = load();
    expect(ext.discover(join(repo))).toEqual({
      skillPaths: [join(skills, "everywhere"), join(skills, "byRemote")],
      promptPaths: [join(skills, "byRemote", "prompts")],
    });
    ext.start(repo);
    const warning = ext.notify.mock.lastCall?.[0] as string;
    expect(warning).toContain("missing: no SKILL.md");
    expect(warning).toContain('skill "broken" needs "path"');
  });

  test("by path, outside git", () => {
    expect(load().discover(plain).skillPaths).toEqual([join(skills, "everywhere"), join(skills, "byPath")]);
  });

  test("no warning without errors or without UI", () => {
    const empty = join(root, "empty.json");
    writeFileSync(empty, "{}");
    const ext = load(empty);
    expect(ext.discover(repo)).toEqual({ skillPaths: [], promptPaths: [] });
    ext.start(repo);
    const withErrors = load();
    withErrors.discover(repo);
    withErrors.start(repo, false);
    expect(ext.notify).not.toHaveBeenCalled();
    expect(withErrors.notify).not.toHaveBeenCalled();
  });
});

describe("/repo-skills", () => {
  test("in a repository", async () => {
    const text = await load().command(repo);
    expect(text).toContain("remote: github.com/owner/repo");
    expect(text).toContain("- everywhere: loaded (matches *)");
    expect(text).toContain("- byRemote: loaded (matches owner/repo)");
    expect(text).toContain("- other: not loaded");
    expect(text).toContain("error: ");
  });

  test("in a worktree", async () => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
    const git = (...args: string[]) =>
      execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { env });
    git("commit", "-q", "--allow-empty", "-m", "init");
    const worktree = join(root, "wt");
    git("worktree", "add", "-q", worktree);
    expect(await load().command(worktree)).toContain(`worktree: ${worktree}`);
  });

  test("outside git, without skills", async () => {
    const text = await load(join(root, "none.json")).command(plain);
    expect(text).toContain("not in a git repository");
    expect(text).toContain("no skills configured");
  });
});

describe("resourcePaths", () => {
  test("skips a skill without SKILL.md", () => {
    expect(
      resourcePaths([
        { pattern: "*", skill: { name: "x", path: join(root, "nope"), repos: ["*"], triggers: NO_TRIGGERS } },
      ]).errors,
    ).toHaveLength(1);
  });
});
