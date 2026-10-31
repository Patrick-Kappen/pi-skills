import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { SkillEntry, Triggers } from "./config.ts";

/** Directories of a skill that hold no parts for the agent: prompt templates, files for other repositories. */
const NOT_PARTS = new Set(["prompts", "templates", "assets", "scripts", "node_modules"]);

/** How much of a part the embedding and the reranker see. */
const PART_EXCERPT = 1500;

/** How much of a part goes into the prompt; the agent reads the rest itself. */
const PART_LIMIT = 20_000;

/** A Markdown file of a skill besides SKILL.md: a guide or a reference. */
export interface SkillPart {
  /** Relative to the skill directory, with `/`. */
  path: string;
  text: string;
}

/** A skill as the triggers use it. */
export interface LoadedSkill {
  name: string;
  description: string;
  disableModelInvocation: boolean;
  filePath: string;
  baseDir: string;
  body: string;
  parts: SkillPart[];
  triggers: Triggers;
}

function parseFrontmatterField(
  lines: string[],
  start: number,
): { key: string; value: string; nextIndex: number } | undefined {
  const field = /^([A-Za-z][\w-]*):(?:\s+(.*))?$/.exec(lines[start] as string);
  if (!field) return undefined;
  const value = (field[2] ?? "").trim();
  const more: string[] = [];
  let nextIndex = start;
  while (nextIndex + 1 < lines.length && /^(\s+\S|\s*$)/.test(lines[nextIndex + 1] as string)) {
    more.push((lines[++nextIndex] as string).trim());
  }
  while (more.length > 0 && more.at(-1) === "") more.pop();
  const parsed = /^[>|][-+]?$/.test(value)
    ? value.startsWith("|")
      ? more.join("\n")
      : more.join(" ").replace(/ {2,}/g, " ")
    : unquote([value, ...more].filter((part) => part !== "").join(" "));
  return { key: field[1] as string, value: parsed, nextIndex };
}

function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'"))
    return value.slice(1, -1).replaceAll("''", "'");
  return value;
}

/**
 * The top-level scalar fields of a YAML front matter, and the body after it. Handles what skills use:
 * plain, quoted, folded (`>`) and literal (`|`) values. The extension runs without dependencies, so
 * it cannot use pi's YAML parser.
 */
export function splitFrontmatter(content: string): { fields: Record<string, string>; body: string } {
  const text = content.replace(/^\uFEFF/, "").replaceAll("\r\n", "\n");
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
  if (!match) return { fields: {}, body: text };
  const fields: Record<string, string> = {};
  const lines = (match[1] as string).split("\n");
  for (let i = 0; i < lines.length; i++) {
    const field = parseFrontmatterField(lines, i);
    if (!field) continue;
    fields[field.key] = field.value;
    i = field.nextIndex;
  }
  return { fields, body: text.slice(match[0].length) };
}

function markdownFiles(dir: string, base: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!NOT_PARTS.has(entry.name) && !entry.name.startsWith(".")) files.push(...markdownFiles(path, base));
    } else if (entry.name.endsWith(".md") && path !== join(base, "SKILL.md")) {
      files.push(path);
    }
  }
  return files;
}

/** Read a configured skill. Returns undefined when its SKILL.md cannot be read. */
export function readSkill(entry: SkillEntry): LoadedSkill | undefined {
  const filePath = join(entry.path, "SKILL.md");
  let content: string;
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    return undefined;
  }
  const { fields, body } = splitFrontmatter(content);
  return {
    name: fields.name || entry.name,
    description: (fields.description ?? "").trim(),
    disableModelInvocation: fields["disable-model-invocation"] === "true",
    filePath,
    baseDir: entry.path,
    body: body.trim(),
    parts: markdownFiles(entry.path, entry.path).map((path) => ({
      path: relative(entry.path, path).split("\\").join("/"),
      text: readFileSync(path, "utf8"),
    })),
    triggers: entry.triggers,
  };
}

/** True when the description says when to use the skill, which the model routes on. */
export function saysWhen(skill: LoadedSkill): boolean {
  return /\b(use|run) (when|for|only|to)\b/i.test(skill.description);
}

/** What the embedding and the reranker see of a part: its path and its start. */
export function partExcerpt(part: SkillPart): string {
  return `${part.path}\n${part.text.slice(0, PART_EXCERPT)}`;
}

/** The marker pi and this extension put before a loaded skill; finding it means the skill is in context. */
export function skillMarker(name: string): string {
  return `<skill name="${name}"`;
}

/**
 * The skill in the format pi uses for `/skill:name`, so the model treats it like a skill the user
 * loaded, with the parts that match the request after the body.
 */
export function skillBlock(skill: LoadedSkill, parts: readonly SkillPart[] = []): string {
  const lines = [
    `${skillMarker(skill.name)} location="${skill.filePath}">`,
    `References are relative to ${skill.baseDir}.`,
    "",
    skill.body,
  ];
  if (parts.length > 0) {
    lines.push("", "These parts of the skill match the request; start with them:");
    for (const part of parts) {
      const text =
        part.text.length > PART_LIMIT
          ? `${part.text.slice(0, PART_LIMIT)}\n[cut off; read ${part.path} for the rest]`
          : part.text;
      lines.push("", `<skill-part path="${part.path}">`, text.trim(), "</skill-part>");
    }
  }
  lines.push("</skill>");
  return lines.join("\n");
}
