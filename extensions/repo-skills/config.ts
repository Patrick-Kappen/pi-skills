import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { expandHome } from "./match.ts";

export const CONFIG_FILE = "repo-skills.json";

/** One skill: its directory (with SKILL.md) and where it loads. */
export interface SkillEntry {
  name: string;
  path: string;
  repos: string[];
}

export interface LoadedConfig {
  path: string;
  skills: SkillEntry[];
  /** Problems with the file or with single entries. Valid entries are still loaded. */
  errors: string[];
}

/** pi's agent directory: `$PI_CODING_AGENT_DIR` or `~/.pi/agent`. */
export function agentDir(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  const dir = env.PI_CODING_AGENT_DIR;
  return dir ? expandHome(dir, home) : join(home, ".pi", "agent");
}

/** `$PI_REPO_SKILLS_CONFIG`, else `repo-skills.json` in the agent directory. */
export function configPath(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  const file = env.PI_REPO_SKILLS_CONFIG;
  return file ? expandHome(file, home) : join(agentDir(env, home), CONFIG_FILE);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRepoList(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.length > 0 && value.every((repo) => typeof repo === "string" && repo.trim() !== "")
  );
}

/**
 * Validate the parsed config file. The shape is
 * `{ "skills": { "<name>": { "path": "/dir/with/SKILL.md", "repos": ["owner/repo", "~/path", "*"] } } }`.
 */
export function parseConfig(raw: unknown, path: string, home: string = homedir()): LoadedConfig {
  const result: LoadedConfig = { path, skills: [], errors: [] };
  if (!isRecord(raw)) {
    result.errors.push(`${path}: expected a JSON object`);
    return result;
  }
  const skills = raw.skills ?? {};
  if (!isRecord(skills)) {
    result.errors.push(`${path}: "skills" must be an object`);
    return result;
  }
  for (const [name, value] of Object.entries(skills)) {
    if (!isRecord(value)) {
      result.errors.push(`${path}: skill "${name}" must be an object`);
      continue;
    }
    const { path: dir, repos } = value;
    if (typeof dir !== "string" || !(isAbsolute(dir) || dir === "~" || dir.startsWith("~/"))) {
      result.errors.push(`${path}: skill "${name}" needs "path": an absolute path or ~/path to its directory`);
      continue;
    }
    if (!isRepoList(repos)) {
      result.errors.push(`${path}: skill "${name}" needs "repos": a non-empty list of repositories, paths or "*"`);
      continue;
    }
    result.skills.push({ name, path: expandHome(dir, home), repos: repos.map((repo) => repo.trim()) });
  }
  return result;
}

/** Read and validate the config file. A missing file means no skills and no error. */
export function loadConfig(path: string, home: string = homedir()): LoadedConfig {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { path, skills: [], errors: [] };
    return { path, skills: [], errors: [`${path}: ${(error as Error).message}`] };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { path, skills: [], errors: [`${path}: invalid JSON: ${(error as Error).message}`] };
  }
  return parseConfig(raw, path, home);
}
