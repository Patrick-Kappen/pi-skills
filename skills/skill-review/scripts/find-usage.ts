#!/usr/bin/env node
// Finds the pi sessions that used a skill and writes one compact, redacted digest per session.
// Usage: find-usage.ts --skill <name> [--sessions <dir>] [--since YYYY-MM-DD] [--limit <n>]
//                      [--max-chars <n>] [--out <dir>]
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";

export interface Options {
  skill: string;
  sessions: string;
  since?: string;
  limit: number;
  maxChars: number;
  out: string;
  /** Session files to leave out, such as the session that runs this script. */
  exclude: string[];
}

interface Block {
  type: string;
  text?: string;
  thinking?: string;
  name?: string;
  arguments?: Record<string, unknown>;
}

interface Message {
  role: string;
  content: string | Block[];
  isError?: boolean;
  toolName?: string;
  model?: string;
  provider?: string;
}

interface Entry {
  type: string;
  id?: string;
  timestamp?: string;
  cwd?: string;
  message?: Message;
}

export interface Usage {
  file: string;
  sessionId: string;
  cwd: string;
  date: string;
  model: string;
  /** Where the skill was loaded from. */
  location: string;
  /** How it was started: the model read SKILL.md, or the user ran /skill:<name>. */
  trigger: "read" | "command";
  triggerId: string;
  /** Files of the skill that were read, relative to the skill directory. */
  filesRead: string[];
  userMessages: number;
  toolCalls: number;
  toolErrors: number;
  digest: string;
}

// Secrets that may appear in commands and outputs; replaced before anything leaves this machine.
const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
  /\b(sk-[A-Za-z0-9_-]{20,}|sk-ant-[A-Za-z0-9_-]{20,})\b/g,
  /\b(AKIA|ASIA)[A-Z0-9]{16}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{16,}/g,
  /\b(AccountKey|SharedAccessSignature|sig)=[A-Za-z0-9%+/=]{16,}/g,
  /\b([A-Za-z0-9_]*(?:secret|token|password|passwd|api[_-]?key|private[_-]?key)[A-Za-z0-9_]*)(\s*[:=]\s*)("[^"\n]{6,}"|'[^'\n]{6,}'|[^\s"'\n]{6,})/gi,
  /\bage1[a-z0-9]{50,}\b/g,
  /\bAGE-SECRET-KEY-1[A-Z0-9]{50,}\b/g,
];

export function redact(text: string): string {
  let result = text;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, (match, ...groups) => {
      // key=value: keep the key, so the reader still sees what was set.
      if (typeof groups[1] === "string" && typeof groups[0] === "string" && /[:=]/.test(groups[1])) {
        return `${groups[0]}${groups[1]}[REDACTED]`;
      }
      return match.length > 0 ? "[REDACTED]" : match;
    });
  }
  return result;
}

function clip(text: string, max: number): string {
  const flat = text.trim();
  return flat.length <= max ? flat : `${flat.slice(0, max)} […${flat.length - max} more chars]`;
}

function textOf(content: string | Block[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("\n");
}

/** The skill directory a read of `<dir>/<skill>/SKILL.md` points to, or undefined. */
export function skillDirOfRead(path: string, skill: string): string | undefined {
  const suffix = `/${skill}/SKILL.md`;
  return path.endsWith(suffix) ? path.slice(0, -"/SKILL.md".length) : undefined;
}

/** The location of `<skill name="X" location="...">` in a /skill:X expansion, or undefined. */
export function commandLocation(text: string, skill: string): string | undefined {
  const match = new RegExp(`<skill name="${skill.replace(/[-]/g, "\\-")}" location="([^"]*)"`).exec(text);
  return match ? (match[1] as string).replace(/\/SKILL\.md$/, "") : undefined;
}

function isFailure(message: Message): boolean {
  if (message.isError) return true;
  const exit = /^exit (\d+)/.exec(textOf(message.content));
  return exit !== null && exit[1] !== "0";
}

function describeCall(block: Block): string {
  const args = block.arguments ?? {};
  const main = args.command ?? args.path ?? args.pattern ?? args.code ?? "";
  const rest = Object.keys(args).filter(
    (key) =>
      !["command", "path", "pattern", "code", "content", "edits"].includes(key) &&
      args[key] !== null &&
      args[key] !== undefined,
  );
  const extra =
    rest.length > 0 ? ` ${clip(JSON.stringify(Object.fromEntries(rest.map((key) => [key, args[key]]))), 200)}` : "";
  return `${block.name}: ${clip(String(main), 400)}${extra}`;
}

/** Keep the head and the tail of a digest that is too long; the middle matters least. */
export function fitDigest(lines: string[], maxChars: number): string {
  const text = lines.join("\n");
  if (text.length <= maxChars) return text;
  const head: string[] = [];
  const tail: string[] = [];
  let used = 0;
  for (const line of lines) {
    if (used + line.length + 1 > maxChars * 0.6) break;
    head.push(line);
    used += line.length + 1;
  }
  for (let i = lines.length - 1; i >= head.length; i--) {
    const line = lines[i] as string;
    if (used + line.length + 1 > maxChars) break;
    tail.unshift(line);
    used += line.length + 1;
  }
  const omitted = lines.length - head.length - tail.length;
  return [...head, `[… ${omitted} lines omitted …]`, ...tail].join("\n");
}

function parseLines(text: string): Entry[] {
  const entries: Entry[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      entries.push(JSON.parse(line) as Entry);
    } catch {
      // A line cut off by a crash; the rest of the session is still useful.
    }
  }
  return entries;
}

interface Trigger {
  index: number;
  location: string;
  kind: "read" | "command";
}

function readTrigger(message: Message, skill: string): string | undefined {
  if (message.role !== "assistant" || !Array.isArray(message.content)) return undefined;
  for (const block of message.content) {
    const path = block.type === "toolCall" && block.name === "read" ? block.arguments?.path : undefined;
    const location = typeof path === "string" ? skillDirOfRead(path, skill) : undefined;
    if (location !== undefined) return location;
  }
  return undefined;
}

function findTrigger(entries: Entry[], skill: string): Trigger | undefined {
  for (const [index, entry] of entries.entries()) {
    const message = entry.message;
    if (entry.type !== "message" || !message) continue;
    const command = message.role === "user" ? commandLocation(textOf(message.content), skill) : undefined;
    if (command !== undefined) return { index, location: command, kind: "command" };
    const read = readTrigger(message, skill);
    if (read !== undefined) return { index, location: read, kind: "read" };
  }
  return undefined;
}

/** What a digest collects while it walks the session. */
class Digest {
  lines: string[] = [];
  filesRead = new Set<string>();
  userMessages = 0;
  toolCalls = 0;
  toolErrors = 0;
  model = "";

  private readonly location: string;

  constructor(location: string) {
    this.location = location;
  }

  add(message: Message): void {
    if (message.role === "user") this.user(message);
    else if (message.role === "assistant") this.assistant(message);
    else if (message.role === "toolResult" && isFailure(message)) {
      this.toolErrors++;
      this.lines.push(`FAILED ${message.toolName ?? "tool"}: ${clip(redact(textOf(message.content)), 1200)}`);
    }
  }

  private user(message: Message): void {
    this.userMessages++;
    this.lines.push(`USER: ${clip(redact(textOf(message.content)), 2500)}`);
  }

  private assistant(message: Message): void {
    if (message.model) this.model = `${message.provider ?? ""}/${message.model}`;
    for (const block of Array.isArray(message.content) ? message.content : []) {
      if (block.type === "text" && block.text?.trim()) this.lines.push(`AGENT: ${clip(redact(block.text), 800)}`);
      if (block.type === "toolCall") this.call(block);
    }
  }

  private call(block: Block): void {
    this.toolCalls++;
    const path = block.arguments?.path;
    if (typeof path === "string" && path.startsWith(`${this.location}/`)) {
      this.filesRead.add(path.slice(this.location.length + 1));
    }
    this.lines.push(`CALL ${redact(describeCall(block))}`);
  }
}

/** The usage of `skill` in one session file, or undefined when the session did not use it. */
export function analyseSession(file: string, text: string, skill: string, maxChars: number): Usage | undefined {
  const entries = parseLines(text);
  const trigger = findTrigger(entries, skill);
  if (!trigger) return undefined;
  const header = entries.find((entry) => entry.type === "session");
  const digest = new Digest(trigger.location);
  // The user's request just before the skill loaded, for context.
  const start = Math.max(
    0,
    entries.slice(0, trigger.index).findLastIndex((entry) => entry.message?.role === "user"),
  );
  for (const entry of entries.slice(start)) {
    if (entry.type === "message" && entry.message) digest.add(entry.message);
  }
  const first = entries[trigger.index];
  return {
    file,
    sessionId: (header as { id?: string } | undefined)?.id ?? "",
    cwd: header?.cwd ?? "",
    date: (header?.timestamp ?? first?.timestamp ?? "").slice(0, 10),
    model: digest.model,
    location: trigger.location,
    trigger: trigger.kind,
    triggerId: `${first?.id ?? ""}@${first?.timestamp ?? ""}`,
    filesRead: [...digest.filesRead].sort(),
    userMessages: digest.userMessages,
    toolCalls: digest.toolCalls,
    toolErrors: digest.toolErrors,
    digest: fitDigest(digest.lines, maxChars),
  };
}

function sessionFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(join(entry.parentPath, entry.name));
  }
  return files.sort();
}

/** Every usage of the skill, newest first, without the copies that forks carry. */
export function findUsages(options: Options): Usage[] {
  const needles = [`/${options.skill}/SKILL.md`, `skill name=\\"${options.skill}\\"`];
  const seen = new Set<string>();
  const usages: Usage[] = [];
  for (const file of sessionFiles(options.sessions)) {
    if (options.exclude.includes(file)) continue;
    const text = readFileSync(file, "utf8");
    if (!needles.some((needle) => text.includes(needle))) continue;
    const usage = analyseSession(file, text, options.skill, options.maxChars);
    if (!usage || seen.has(usage.triggerId)) continue;
    if (options.since && usage.date < options.since) continue;
    seen.add(usage.triggerId);
    usages.push(usage);
  }
  return usages.sort((a, b) => b.date.localeCompare(a.date)).slice(0, options.limit);
}

export function renderDigest(usage: Usage, sessions: string): string {
  return [
    `# Session ${usage.sessionId}`,
    "",
    `- file: ${relative(sessions, usage.file)}`,
    `- date: ${usage.date}`,
    `- cwd: ${usage.cwd}`,
    `- model: ${usage.model}`,
    `- skill loaded from: ${usage.location} (${usage.trigger === "command" ? "/skill command" : "model read SKILL.md"})`,
    `- skill files read: ${usage.filesRead.join(", ") || "only SKILL.md"}`,
    `- user messages: ${usage.userMessages}, tool calls: ${usage.toolCalls}, failed tool calls: ${usage.toolErrors}`,
    "",
    "```text",
    usage.digest.replaceAll("```", "'''"),
    "```",
    "",
  ].join("\n");
}

export function parseArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): Options {
  const value = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index === -1 ? undefined : argv[index + 1];
  };
  const skill = value("--skill");
  if (!skill || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(skill)) throw new Error("--skill <name> is required");
  const home = homedir();
  const agentDir = env.PI_CODING_AGENT_DIR ?? join(home, ".pi", "agent");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const cache = env.XDG_CACHE_HOME ?? join(home, ".cache");
  const since = value("--since");
  return {
    skill,
    sessions: value("--sessions") ?? join(agentDir, "sessions"),
    ...(since ? { since } : {}),
    limit: Number(value("--limit") ?? 30),
    maxChars: Number(value("--max-chars") ?? 20000),
    out: value("--out") ?? join(cache, "pi-skill-review", `${skill}-${stamp}`),
    exclude: env.PI_SESSION_FILE ? [env.PI_SESSION_FILE] : [],
  };
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const usages = findUsages(options);
  mkdirSync(options.out, { recursive: true });
  const index = usages.map((usage, i) => {
    const name = `${String(i + 1).padStart(2, "0")}-${usage.date}-${usage.sessionId.slice(0, 8)}.md`;
    writeFileSync(join(options.out, name), renderDigest(usage, options.sessions));
    const { digest: _digest, ...meta } = usage;
    return { digest: name, ...meta };
  });
  writeFileSync(
    join(options.out, "index.json"),
    `${JSON.stringify({ skill: options.skill, sessions: index }, null, 2)}\n`,
  );
  process.stdout.write(`${JSON.stringify({ skill: options.skill, out: options.out, sessions: usages.length })}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
