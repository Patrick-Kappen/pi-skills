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

/** The text of a message's content: plain text and text blocks. */
function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block: { type?: string; text?: string }) => (block.type === "text" ? (block.text ?? "") : ""))
    .join("\n");
}

/** A session entry as far as this module reads it. */
export interface ContextEntry {
  type: string;
  message?: { role?: string; content?: unknown; toolCallId?: string; isError?: boolean };
}

interface ToolCallBlock {
  type?: string;
  id?: string;
  name?: string;
  arguments?: { path?: unknown };
}

/** The ids of the read calls in an assistant message that read the given file. */
function readCallsOf(entry: ContextEntry, filePath: string): string[] {
  if (entry.message?.role !== "assistant" || !Array.isArray(entry.message.content)) return [];
  return (entry.message.content as ToolCallBlock[])
    .filter((block) => block.type === "toolCall" && block.name === "read" && block.id)
    .filter((block) => {
      const path = block.arguments?.path;
      return typeof path === "string" && (path === filePath || path === `@${filePath}`);
    })
    .map((block) => block.id as string);
}

/**
 * The skills whose instructions are in the model's context: loaded as a skill block (by
 * `/skill:name` or this extension), or read with the read tool, which counts only once the read
 * returned without an error. A read that is still running is not in context yet. Pass the
 * compaction-aware entries (`buildContextEntries()`), so a skill that a compaction summarized away
 * counts as not loaded.
 */
function rememberReadCalls(entry: ContextEntry, skills: readonly LoadedSkill[], reads: Map<string, string>): void {
  for (const skill of skills) {
    for (const id of readCallsOf(entry, skill.filePath)) reads.set(id, skill.name);
  }
}

function loadReturnedSkill(entry: ContextEntry, reads: ReadonlyMap<string, string>, loaded: Set<string>): void {
  const { role, toolCallId, isError } = entry.message ?? {};
  if (role !== "toolResult" || !toolCallId || isError) return;
  const name = reads.get(toolCallId);
  if (name) loaded.add(name);
}

function loadSkillBlocks(entry: ContextEntry, skills: readonly LoadedSkill[], loaded: Set<string>): void {
  const message = entry.message;
  if (!message || message.role === "assistant") return;
  const text = contentText(message.content);
  for (const skill of skills) {
    if (text.includes(skillMarker(skill.name))) loaded.add(skill.name);
  }
}

export function skillsInContext(entries: readonly ContextEntry[], skills: readonly LoadedSkill[]): Set<string> {
  const loaded = new Set<string>();
  const reads = new Map<string, string>();
  for (const entry of entries) {
    if (entry.type !== "message" || !entry.message) continue;
    rememberReadCalls(entry, skills, reads);
    loadReturnedSkill(entry, reads, loaded);
    loadSkillBlocks(entry, skills, loaded);
  }
  return loaded;
}
