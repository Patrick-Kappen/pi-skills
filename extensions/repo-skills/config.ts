import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { expandHome } from "./match.ts";

export const CONFIG_FILE = "repo-skills.json";

/** Fixed triggers: the skill loads when a tool touches a matching file or prints a matching error. */
export interface Triggers {
  /** Globs, relative to the repository root (or the working directory outside git), or absolute. */
  paths: string[];
  /** File extensions such as `.tf`. */
  extensions: string[];
  /** Regular expressions, case-insensitive, matched against tool output. */
  errors: string[];
}

/** One skill: its directory (with SKILL.md), where it loads, and what loads it by itself. */
export interface SkillEntry {
  name: string;
  path: string;
  repos: string[];
  triggers: Triggers;
  /** Sub-skills (folders with their own SKILL.md inside the skill), by folder name. */
  subskills: Record<string, { triggers: Triggers }>;
}

/** The embedding and rerank server that scores prompts against the skills. */
export interface SemanticConfig {
  /** Base URL of an OpenAI-compatible server with `/v1/embeddings` and `/v1/rerank`. */
  url: string;
  embedModel: string;
  rerankModel: string;
  /** Rerank score from which the skill is put into the prompt. */
  load: number;
  /** Rerank score from which the agent gets a hint that the skill may apply. */
  hint: number;
  /** Rerank score from which a part of a loaded skill is added. */
  part: number;
  /** At most this many parts are added. */
  maxParts: number;
  /** How many skills and parts the embedding step passes to the reranker. */
  candidates: number;
  /** Time limit for one prompt; on timeout the prompt goes on without skills. */
  timeoutMs: number;
}

export const SEMANTIC_DEFAULTS: Omit<SemanticConfig, "url"> = {
  embedModel: "qwen3-embedding-0.6b",
  rerankModel: "qwen3-reranker-4b",
  load: 0.9,
  hint: 0.5,
  part: 0.8,
  maxParts: 2,
  candidates: 8,
  timeoutMs: 3000,
};

export const NO_TRIGGERS: Triggers = { paths: [], extensions: [], errors: [] };

export interface LoadedConfig {
  path: string;
  skills: SkillEntry[];
  /** Absent: no scoring, only the fixed triggers. */
  semantic?: SemanticConfig;
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

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim() !== "");
}

function parseTriggers(raw: unknown, where: string, errors: string[]): Triggers {
  if (raw === undefined) return NO_TRIGGERS;
  if (!isRecord(raw)) {
    errors.push(`${where}: "triggers" must be an object`);
    return NO_TRIGGERS;
  }
  const list = (key: keyof Triggers): string[] => {
    const value = raw[key] ?? [];
    if (isStringList(value)) return value.map((item) => item.trim());
    errors.push(`${where}: "triggers.${key}" must be a list of strings`);
    return [];
  };
  const triggers = { paths: list("paths"), extensions: list("extensions"), errors: list("errors") };
  triggers.extensions = triggers.extensions.map((ext) => (ext.startsWith(".") ? ext : `.${ext}`));
  triggers.errors = triggers.errors.filter((pattern) => {
    try {
      new RegExp(pattern, "i");
      return true;
    } catch {
      errors.push(`${where}: "triggers.errors" has an invalid regular expression: ${pattern}`);
      return false;
    }
  });
  return triggers;
}

function parseSemanticNames(
  raw: Record<string, unknown>,
  semantic: SemanticConfig,
  path: string,
  errors: string[],
): void {
  for (const key of ["embedModel", "rerankModel"] as const) {
    const value = raw[key];
    if (value === undefined) continue;
    if (typeof value === "string" && value !== "") semantic[key] = value;
    else errors.push(`${path}: "semantic.${key}" must be a model name`);
  }
}

function parseSemanticScores(
  raw: Record<string, unknown>,
  semantic: SemanticConfig,
  path: string,
  errors: string[],
): void {
  for (const key of ["load", "hint", "part"] as const) {
    const value = raw[key];
    if (value === undefined) continue;
    if (typeof value === "number" && value >= 0 && value <= 1) semantic[key] = value;
    else errors.push(`${path}: "semantic.${key}" must be a score from 0 to 1`);
  }
}

function parseSemanticLimits(
  raw: Record<string, unknown>,
  semantic: SemanticConfig,
  path: string,
  errors: string[],
): void {
  for (const key of ["maxParts", "candidates", "timeoutMs"] as const) {
    const value = raw[key];
    if (value === undefined) continue;
    if (typeof value === "number" && Number.isInteger(value) && value >= 0) semantic[key] = value;
    else errors.push(`${path}: "semantic.${key}" must be a whole number`);
  }
}

function parseSemantic(raw: unknown, path: string, errors: string[]): SemanticConfig | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!isRecord(raw) || typeof raw.url !== "string" || !/^https?:\/\//.test(raw.url)) {
    errors.push(`${path}: "semantic" needs "url": an http(s) URL`);
    return undefined;
  }
  const semantic: SemanticConfig = { ...SEMANTIC_DEFAULTS, url: raw.url.replace(/\/+$/, "") };
  parseSemanticNames(raw, semantic, path, errors);
  parseSemanticScores(raw, semantic, path, errors);
  parseSemanticLimits(raw, semantic, path, errors);
  return semantic;
}

/**
 * Validate the parsed config file. The shape is
 * `{ "semantic": { "url": "http://localhost:8097" }, "skills": { "<name>": { "path": "/dir/with/SKILL.md",
 * "repos": ["owner/repo", "~/path", "*"], "triggers": { "paths": [], "extensions": [], "errors": [] } } } }`.
 */
function parseSkill(
  name: string,
  value: unknown,
  path: string,
  home: string,
  errors: string[],
): SkillEntry | undefined {
  if (!isRecord(value)) {
    errors.push(`${path}: skill "${name}" must be an object`);
    return undefined;
  }
  const { path: dir, repos } = value;
  if (typeof dir !== "string" || !(isAbsolute(dir) || dir === "~" || dir.startsWith("~/"))) {
    errors.push(`${path}: skill "${name}" needs "path": an absolute path or ~/path to its directory`);
    return undefined;
  }
  // Without "repos", a skill loads everywhere.
  if (repos !== undefined && !isRepoList(repos)) {
    errors.push(`${path}: skill "${name}": "repos" must be a non-empty list of repositories, paths or "*"`);
    return undefined;
  }
  return {
    name,
    path: expandHome(dir, home),
    repos: repos === undefined ? ["*"] : repos.map((repo) => repo.trim()),
    triggers: parseTriggers(value.triggers, `${path}: skill "${name}"`, errors),
    subskills: parseSubskills(value.subskills, `${path}: skill "${name}"`, errors),
  };
}

function parseSubskills(raw: unknown, where: string, errors: string[]): SkillEntry["subskills"] {
  if (raw === undefined) return {};
  if (!isRecord(raw)) {
    errors.push(`${where}: "subskills" must be an object`);
    return {};
  }
  const subskills: SkillEntry["subskills"] = {};
  for (const [name, value] of Object.entries(raw)) {
    if (!isRecord(value)) {
      errors.push(`${where}: subskill "${name}" must be an object`);
      continue;
    }
    subskills[name] = { triggers: parseTriggers(value.triggers, `${where}: subskill "${name}"`, errors) };
  }
  return subskills;
}

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
    const skill = parseSkill(name, value, path, home, result.errors);
    if (skill) result.skills.push(skill);
  }
  const semantic = parseSemantic(raw.semantic, path, result.errors);
  if (semantic) result.semantic = semantic;
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
