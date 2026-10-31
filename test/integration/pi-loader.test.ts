// Loads the extension through pi's own resource loader and session, in a real git repository and its worktree.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";

const source = resolve(import.meta.dirname, "../../extensions/repo-skills");
const skillsSource = resolve(import.meta.dirname, "../../skills");
const root = realpathSync(mkdtempSync(join(tmpdir(), "repo-skills-it-")));
const agentDir = join(root, "agent");
const main = join(root, "main");
const worktree = join(root, "worktrees", "feature");
const other = join(root, "other");
const startCwd = process.cwd();
const savedEnv = { ...process.env };

function git(cwd: string, ...args: string[]): void {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "init.defaultBranch=main", ...args], {
    cwd,
    env,
    stdio: "ignore",
  });
}

beforeAll(() => {
  mkdirSync(join(agentDir, "extensions"), { recursive: true });
  cpSync(source, join(agentDir, "extensions", "repo-skills"), {
    recursive: true,
    filter: (path) => !path.endsWith(".test.ts"),
  });
  const local = join(root, "skills", "local-skill");
  mkdirSync(local, { recursive: true });
  writeFileSync(
    join(local, "SKILL.md"),
    "---\nname: local-skill\ndescription: A skill for one directory.\n---\n\nBody.\n",
  );
  // A sub-skill: pi must not list it; only repo-skills loads it.
  mkdirSync(join(local, "skills", "hidden"), { recursive: true });
  writeFileSync(
    join(local, "skills", "hidden", "SKILL.md"),
    "---\nname: hidden\ndescription: A sub-skill. Use when testing.\n---\n\nHidden.\n",
  );
  writeFileSync(
    join(agentDir, "repo-skills.json"),
    JSON.stringify({
      skills: {
        "repo-scaffold": { path: join(skillsSource, "repo-scaffold"), repos: ["example-owner/example-repo"] },
        "local-skill": { path: local, repos: [main] },
      },
    }),
  );

  mkdirSync(main, { recursive: true });
  git(main, "init");
  git(main, "remote", "add", "origin", "git@github.com:Example-Owner/example-repo.git");
  git(main, "commit", "--allow-empty", "-m", "init");
  git(main, "worktree", "add", "-b", "feature", worktree);

  mkdirSync(other, { recursive: true });
  git(other, "init");

  process.env.PI_CODING_AGENT_DIR = agentDir;
  delete process.env.PI_REPO_SKILLS_CONFIG;
});

afterEach(() => process.chdir(startCwd));

afterAll(() => {
  process.env = savedEnv;
  rmSync(root, { recursive: true, force: true });
});

async function loadedIn(cwd: string): Promise<{ skills: string[]; prompts: string[] }> {
  process.chdir(cwd);
  const resourceLoader = new DefaultResourceLoader({ cwd, agentDir });
  await resourceLoader.reload();
  const { session } = await createAgentSession({
    cwd,
    agentDir,
    resourceLoader,
    settingsManager: SettingsManager.inMemory(),
    sessionManager: SessionManager.inMemory(cwd),
  });
  try {
    await session.bindExtensions({});
    return {
      skills: resourceLoader.getSkills().skills.map((skill) => skill.name),
      prompts: session.promptTemplates.map((prompt) => prompt.name),
    };
  } finally {
    session.dispose();
  }
}

describe("pi loads skills through repo-skills", () => {
  test("main checkout", async () => {
    expect(await loadedIn(main)).toEqual({
      skills: ["repo-scaffold", "local-skill"],
      prompts: ["repo-scaffold", "repo-settings"],
    });
  });

  test("subdirectory of a linked worktree", async () => {
    const sub = join(worktree, "src");
    mkdirSync(sub, { recursive: true });
    expect((await loadedIn(sub)).skills).toEqual(["repo-scaffold", "local-skill"]);
  });

  test("unrelated repository", async () => {
    expect(await loadedIn(other)).toEqual({ skills: [], prompts: [] });
  });
});
