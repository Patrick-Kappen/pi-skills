import { basename, isAbsolute, matchesGlob, relative, resolve, sep } from "node:path";
import { expandHome, isPathPattern } from "./match.ts";
import { type LoadedSkill, skillMarker } from "./skills.ts";

/** A file path as the model passes it to a tool, absolute. pi's tools accept a leading `@`. */
export function toolPath(path: string, cwd: string, home: string): string {
  const clean = path.startsWith("@") ? path.slice(1) : path;
  if (clean === "~" || clean.startsWith("~/")) return expandHome(clean, home);
  return isAbsolute(clean) ? resolve(clean) : resolve(cwd, clean);
}

/**
 * True when the file matches the skill's `paths` or `extensions`. Relative globs are matched from
 * `root` (the repository, or the working directory outside git); a glob without `/` also matches
 * the file name anywhere, as in `.gitignore`.
 */
export function matchesFile(skill: LoadedSkill, file: string, root: string, home: string): boolean {
  const lower = file.toLowerCase();
  if (skill.triggers.extensions.some((ext) => lower.endsWith(ext.toLowerCase()))) return true;
  const rel = relative(root, file);
  const inside = rel !== "" && !rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel);
  return skill.triggers.paths.some((glob) => {
    if (isPathPattern(glob)) return matchesGlob(file, expandHome(glob, home));
    if (!glob.includes("/") && matchesGlob(basename(file), glob)) return true;
    return inside && matchesGlob(rel.split(sep).join("/"), glob);
  });
}

/** The first `errors` pattern of the skill that matches the text. */
export function matchingError(skill: LoadedSkill, text: string): string | undefined {
  return skill.triggers.errors.find((pattern) => new RegExp(pattern, "i").test(text));
}

/** The text of a message's content: plain text, text blocks, and tool calls as JSON. */
function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block: { type?: string; text?: string; arguments?: unknown; name?: string }) => {
      if (block.type === "text") return block.text ?? "";
      if (block.type === "toolCall") return `${block.name ?? ""} ${JSON.stringify(block.arguments ?? {})}`;
      return "";
    })
    .join("\n");
}

/** A session entry as far as this module reads it. */
export interface ContextEntry {
  type: string;
  message?: { role?: string; content?: unknown };
}

function entryLoadsSkill(entry: ContextEntry, skill: LoadedSkill): boolean {
  if (entry.type !== "message" || !entry.message) return false;
  const text = contentText(entry.message.content);
  if (text === "") return false;
  const read = entry.message.role === "assistant" && text.includes(JSON.stringify(skill.filePath).slice(1, -1));
  return text.includes(skillMarker(skill.name)) || read;
}

/**
 * The skills whose instructions are in the model's context: loaded as a skill block (by
 * `/skill:name` or this extension) or read with the read tool. Pass the compaction-aware entries
 * (`buildContextEntries()`), so a skill that a compaction summarized away counts as not loaded.
 */
export function skillsInContext(entries: readonly ContextEntry[], skills: readonly LoadedSkill[]): Set<string> {
  const loaded = new Set<string>();
  for (const entry of entries) {
    for (const skill of skills) {
      if (loaded.has(skill.name)) continue;
      if (entryLoadsSkill(entry, skill)) loaded.add(skill.name);
    }
  }
  return loaded;
}
