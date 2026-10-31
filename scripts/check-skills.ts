#!/usr/bin/env node
// Checks every skill in skills/ against the rules in skills/skill-create/references/skill-rules.md.
// Usage: node scripts/check-skills.ts [repo-root] [skill-name...]
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, normalize, relative, resolve } from "node:path";

export interface Problem {
  skill: string;
  file: string;
  message: string;
}

export interface Frontmatter {
  fields: Map<string, string>;
  /** Keys under `metadata:`. */
  metadata: Map<string, string>;
  body: string;
  bodyLine: number;
}

export const ALLOWED_FIELDS = new Set([
  "name",
  "description",
  "license",
  "compatibility",
  "metadata",
  "allowed-tools",
  "disable-model-invocation",
]);
export const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const MAX_NAME = 64;
export const MAX_DESCRIPTION = 1024;
export const MAX_SKILL_LINES = 300;
export const SEMVER = /^\d+\.\d+\.\d+$/;
const AGENT_FILES =
  /^(\.?AGENTS\.md|CLAUDE(\.local)?\.md|GEMINI\.md|\.cursorrules|\.windsurfrules|\.clinerules|\.claude|\.cursor|\.pi)$/;
const RESOURCE_DIRS = ["guides", "references", "scripts", "templates", "assets", "prompts", "skills"];
// Locations a skill must not depend on: it runs from the read-only Nix store, for any user.
const FORBIDDEN_PATHS: Array<[RegExp, string]> = [
  [
    /~\/\.pi\/agent\/skills\/[a-z0-9]/,
    "points into ~/.pi/agent/skills; skills run from the Nix store, use paths relative to SKILL.md",
  ],
  [/\/home\/[a-z][a-z0-9_-]*\//, "contains a home directory path; use ~ or a path relative to SKILL.md"],
  [/\/nix\/store\/[a-z0-9]{32}-/, "contains a Nix store path; it changes with every build"],
];

function unquote(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** Parse the small YAML subset skills use: `key: value` lines and one level of `metadata:`. */
export function parseFrontmatter(text: string): Frontmatter | string {
  const lines = text.split("\n");
  if (lines[0] !== "---") return "SKILL.md must start with a front matter block (---)";
  const end = lines.indexOf("---", 1);
  if (end === -1) return "front matter is not closed with ---";
  const fields = new Map<string, string>();
  const metadata = new Map<string, string>();
  let inMetadata = false;
  for (const line of lines.slice(1, end)) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const nested = /^\s+([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (nested && inMetadata) {
      metadata.set(nested[1] as string, unquote(nested[2] as string));
      continue;
    }
    const top = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!top) return `front matter line is not "key: value": ${line}`;
    const key = top[1] as string;
    inMetadata = key === "metadata";
    fields.set(key, unquote(top[2] as string));
  }
  return { fields, metadata, body: lines.slice(end + 1).join("\n"), bodyLine: end + 2 };
}

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(path, ...walk(path));
    else files.push(path);
  }
  return files;
}

/** Relative paths a Markdown file points to: links, and `guides/…`-style paths in backticks. */
export function referencedPaths(markdown: string): string[] {
  const paths = new Set<string>();
  // Code blocks show commands and examples, not references.
  const text = markdown.replace(/```[\s\S]*?```/g, "");
  for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = (match[1] as string).split("#")[0] as string;
    if (target !== "" && !/^[a-z]+:/i.test(target) && !target.startsWith("/")) paths.add(target);
  }
  const dirs = RESOURCE_DIRS.join("|");
  for (const match of text.matchAll(new RegExp(`\`((?:\\.\\./)*(?:${dirs})/[^\`\\s]+)\``, "g"))) {
    const path = match[1] as string;
    // Placeholders and patterns are not files.
    if (!/[<>*@{}$]/.test(path)) paths.add(path);
  }
  return [...paths];
}

function checkDescription(skill: string, fm: Frontmatter, problems: Problem[]): void {
  const add = (message: string) => problems.push({ skill, file: "SKILL.md", message });
  const description = fm.fields.get("description") ?? "";
  if (description === "") {
    add("description is missing; pi does not load a skill without one");
    return;
  }
  if (description.length > MAX_DESCRIPTION)
    add(`description has ${description.length} characters; the maximum is ${MAX_DESCRIPTION}`);
  if (fm.fields.get("disable-model-invocation") === "true") {
    if (!description.includes(`/${skill}`) && !/on request/i.test(description)) {
      add(`description must say how to start it (for example "Run only on request via /${skill}")`);
    }
  } else if (!/\bUse (when|for|to|it|this)\b/i.test(description)) {
    add('description must say when to use the skill ("Use when …" or "Use for …"); the model routes on it');
  }
}

function checkFrontmatter(skill: string, fm: Frontmatter, problems: Problem[]): void {
  const add = (message: string) => problems.push({ skill, file: "SKILL.md", message });
  for (const key of fm.fields.keys()) {
    if (!ALLOWED_FIELDS.has(key)) add(`unknown front matter field "${key}"`);
  }
  const name = fm.fields.get("name") ?? "";
  if (name !== skill) add(`name "${name}" must equal the directory name "${skill}"`);
  if (!NAME.test(skill) || skill.length > MAX_NAME) {
    add(`the name must be lowercase letters, digits and single hyphens, at most ${MAX_NAME} characters`);
  }
  checkDescription(skill, fm, problems);
  const dmi = fm.fields.get("disable-model-invocation");
  if (dmi !== undefined && dmi !== "true" && dmi !== "false") add("disable-model-invocation must be true or false");
  const version = fm.metadata.get("version");
  if (version === undefined || !SEMVER.test(version)) add('metadata.version must be a version like "1.0.0"');
}

function checkScript(path: string, add: (message: string) => void): void {
  if ((statSync(path).mode & 0o111) === 0) add("scripts must be executable (chmod +x)");
  if (!readFileSync(path, "utf8").startsWith("#!")) add("scripts must start with a shebang");
}

function checkLinks(path: string, dir: string, text: string, add: (message: string) => void): void {
  for (const target of referencedPaths(text)) {
    const candidates = [
      resolve(dirname(path), target),
      resolve(dir, target),
      // Skills may point to repository files such as scripts/check-skills.ts.
      resolve(dir, "..", "..", target),
    ].map((candidate) => normalize(candidate));
    if (!candidates.some((candidate) => existsSync(candidate))) add(`points to ${target}, which does not exist`);
  }
}

function checkMarkdown(path: string, dir: string, rel: string, add: (message: string) => void): void {
  const text = readFileSync(path, "utf8");
  // \`TODO\` in backticks is about the markers, not a marker.
  if (/\bTODO\b/.test(text.replace(/`[^`\n]*`/g, ""))) add("still has TODO markers from the skeleton");
  for (const [pattern, message] of FORBIDDEN_PATHS) {
    if (pattern.test(text)) add(message);
  }
  checkLinks(path, dir, text, add);
  if (rel.startsWith("prompts/") && !/^---\n[\s\S]*?\bdescription:/.test(text)) {
    add("a prompt template needs front matter with a description");
  }
}

/** A sub-skill (a SKILL.md below the skill): found only by its description, so that must be right. */
function checkSubskill(path: string, add: (message: string) => void): void {
  const fm = parseFrontmatter(readFileSync(path, "utf8"));
  if (typeof fm === "string") {
    add(fm);
    return;
  }
  const folder = basename(dirname(path));
  if (fm.fields.get("name") !== folder) add(`a sub-skill's name must equal its folder name "${folder}"`);
  const description = fm.fields.get("description") ?? "";
  if (description.length > MAX_DESCRIPTION) {
    add(`description has ${description.length} characters; the maximum is ${MAX_DESCRIPTION}`);
  }
  if (!/\bUse (when|for|to|it|this)\b/i.test(description)) {
    add('a sub-skill is found only by its description: say when to use it ("Use when …")');
  }
}

function checkFiles(skill: string, dir: string, problems: Problem[]): void {
  for (const path of walk(dir)) {
    const rel = relative(dir, path);
    const name = basename(path);
    const add = (message: string) => problems.push({ skill, file: rel, message });
    if (rel.startsWith("templates/")) continue;
    if (AGENT_FILES.test(name)) add("agent files stay out of the repository");
    if (statSync(path).isDirectory()) continue;
    // Libraries (lib.sh, lib-*.sh) are sourced by scripts, not run.
    if (rel.startsWith("scripts/") && !name.endsWith(".md") && !name.startsWith("lib")) checkScript(path, add);
    if (name === "SKILL.md" && rel !== "SKILL.md") checkSubskill(path, add);
    if (name.endsWith(".md")) checkMarkdown(path, dir, rel, add);
  }
}

/**
 * Every script (not a `lib*` library) must be named in SKILL.md: the agent often sees only SKILL.md,
 * and the repo-skills extension puts only SKILL.md and the matching parts into the prompt.
 */
function checkScriptsNamed(skill: string, dir: string, body: string, problems: Problem[]): void {
  const scripts = join(dir, "scripts");
  if (!existsSync(scripts)) return;
  for (const entry of readdirSync(scripts, { withFileTypes: true })) {
    if (!entry.isFile() || entry.name.startsWith("lib") || entry.name.endsWith(".md")) continue;
    if (!body.includes(entry.name)) {
      problems.push({
        skill,
        file: "SKILL.md",
        message: `does not name scripts/${entry.name}; say in SKILL.md what each script does and when to run it`,
      });
    }
  }
}

/** All problems of one skill directory. */
export function checkSkill(dir: string): Problem[] {
  const skill = basename(dir);
  const problems: Problem[] = [];
  const skillFile = join(dir, "SKILL.md");
  if (!existsSync(skillFile)) return [{ skill, file: "SKILL.md", message: "SKILL.md is missing" }];
  const text = readFileSync(skillFile, "utf8");
  const fm = parseFrontmatter(text);
  if (typeof fm === "string") return [{ skill, file: "SKILL.md", message: fm }];
  checkFrontmatter(skill, fm, problems);
  const lines = text.split("\n").length;
  if (lines > MAX_SKILL_LINES) {
    problems.push({
      skill,
      file: "SKILL.md",
      message: `has ${lines} lines; keep it under ${MAX_SKILL_LINES} and move details to references/`,
    });
  }
  checkScriptsNamed(skill, dir, fm.body, problems);
  checkFiles(skill, dir, problems);
  return problems;
}

/** Problems of the repository: every skill, and the README table. */
export function checkRepo(root: string, only: string[] = []): Problem[] {
  const skillsDir = join(root, "skills");
  const names = readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => only.length === 0 || only.includes(name))
    .sort();
  const readme = readFileSync(join(root, "README.md"), "utf8");
  const problems: Problem[] = [];
  for (const name of names) {
    problems.push(...checkSkill(join(skillsDir, name)));
    const row = readme.split("\n").find((line) => line.includes(`(skills/${name}/SKILL.md)`));
    if (row === undefined) {
      problems.push({ skill: name, file: "../../README.md", message: "is not in the skill table of README.md" });
    } else if (/\bTODO\b/.test(row)) {
      problems.push({ skill: name, file: "../../README.md", message: "its row in the skill table still says TODO" });
    }
  }
  for (const name of only) {
    if (!names.includes(name)) problems.push({ skill: name, file: "", message: "no such skill in skills/" });
  }
  return problems;
}

function main(): void {
  const [rootArg, ...only] = process.argv.slice(2);
  const root = resolve(rootArg ?? ".");
  const problems = checkRepo(root, only);
  for (const { skill, file, message } of problems) {
    process.stderr.write(`skills/${skill}/${file}: ${message}\n`);
  }
  if (problems.length > 0) process.exit(1);
  process.stdout.write("check-skills: all skills follow the rules\n");
}

if (import.meta.url === `file://${process.argv[1]}`) main();
