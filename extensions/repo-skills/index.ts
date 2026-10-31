import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
  InputEvent,
  InputEventResult,
  ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import { configPath, type LoadedConfig, loadConfig, type SkillEntry, type Triggers } from "./config.ts";
import { firstMatch, type MatchContext, normalizeRemote } from "./match.ts";
import { findRepo } from "./repo.ts";
import { type Fetch, type Ranking, SemanticRanker } from "./semantic.ts";
import { type LoadedSkill, readSkillSet, type SkillPart, saysWhen, skillBlock } from "./skills.ts";
import { type ContextEntry, matchesFile, matchingError, skillsInContext, toolPath } from "./triggers.ts";

/** The entry that loads a skill everywhere, also outside git repositories. */
export const EVERYWHERE = "*";

/** A skill that matches the session, with the `repos` entry that matched. */
export interface Selected {
  skill: SkillEntry;
  pattern: string;
}

export function matchSkill(skill: SkillEntry, ctx: MatchContext): string | undefined {
  if (skill.repos.includes(EVERYWHERE)) return EVERYWHERE;
  return firstMatch(skill.repos, ctx);
}

export function selectSkills(config: LoadedConfig, ctx: MatchContext): Selected[] {
  const selected: Selected[] = [];
  for (const skill of config.skills) {
    const pattern = matchSkill(skill, ctx);
    if (pattern !== undefined) selected.push({ skill, pattern });
  }
  return selected;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** What pi gets for the selected skills: the skill directories and their `prompts/` directories. */
export function resourcePaths(selected: readonly Selected[]): {
  skillPaths: string[];
  promptPaths: string[];
  errors: string[];
} {
  const skillPaths: string[] = [];
  const promptPaths: string[] = [];
  const errors: string[] = [];
  for (const { skill } of selected) {
    if (!existsSync(join(skill.path, "SKILL.md"))) {
      errors.push(`${skill.name}: no SKILL.md in ${skill.path}`);
      continue;
    }
    skillPaths.push(skill.path);
    const prompts = join(skill.path, "prompts");
    if (isDirectory(prompts)) promptPaths.push(prompts);
  }
  return { skillPaths, promptPaths, errors };
}

export interface Options {
  env?: NodeJS.ProcessEnv;
  home?: string;
  /** For the embedding and rerank server; tests pass a fake. */
  fetch?: Fetch;
}

/** The pi methods this extension uses; a subset of ExtensionAPI, so tests can pass a fake. */
export type RepoSkillsApi = Pick<ExtensionAPI, "on" | "registerCommand" | "appendEntry">;

/** The custom entry that records each scoring, to tune the thresholds later. It is not sent to the model. */
export const SCORE_ENTRY = "repo-skills-score";

/** The custom message that carries a note to the model; hidden from the user. */
export const NOTE_MESSAGE = "repo-skills-note";

/** A follow-up shorter than this is scored together with the previous user message. */
const SHORT_PROMPT = 60;

/** Tools whose output is file content or search hits, not errors: the `errors` triggers skip them. */
const NOT_ERROR_OUTPUT = new Set(["read", "grep", "find", "ls", "edit", "write"]);

/** What to do with a prompt after scoring it. */
export type Decision =
  | { kind: "none" }
  | { kind: "load"; skill: LoadedSkill; parts: SkillPart[]; score: number }
  | { kind: "loaded"; skill: LoadedSkill; parts: SkillPart[]; score: number }
  | { kind: "hint"; skill: LoadedSkill; parts: SkillPart[]; score: number }
  | { kind: "suggest"; skill: LoadedSkill; score: number };

export function decide(
  ranking: Ranking | undefined,
  loaded: ReadonlySet<string>,
  thresholds: { load: number; hint: number },
): Decision {
  if (!ranking || ranking.score < thresholds.hint) return { kind: "none" };
  const { skill, parts, score } = ranking;
  if (skill.disableModelInvocation) return { kind: "suggest", skill, score };
  if (loaded.has(skill.name)) return { kind: "loaded", skill, parts, score };
  return { kind: score >= thresholds.load ? "load" : "hint", skill, parts, score };
}

function partList(parts: readonly SkillPart[]): string {
  return parts.map((part) => part.path).join(", ");
}

/** The note after the user's prompt for every decision but `load` and `none`. */
export function note(decision: Decision): string | undefined {
  switch (decision.kind) {
    case "loaded":
      return (
        `<system>The skill ${decision.skill.name} is still in this conversation above. Follow it; do not read its SKILL.md again.` +
        `${decision.parts.length > 0 ? ` Its parts for this request: ${partList(decision.parts)}.` : ""}</system>`
      );
    case "hint":
      return (
        `<system>The skill ${decision.skill.name} may apply to this request. If the task matches its description, read ${decision.skill.filePath}` +
        `${decision.parts.length > 0 ? `, then ${partList(decision.parts)} next to it` : ""}; otherwise ignore this note.</system>`
      );
    case "suggest":
      return `<system>The skill ${decision.skill.name} may fit this request, but it runs only on request. Suggest /skill:${decision.skill.name} to the user; do not run it yourself.</system>`;
    default:
      return undefined;
  }
}

/** The text of the last user message, without a skill block or notes this extension added. */
export function lastUserText(entries: readonly ContextEntry[]): string {
  for (let i = entries.length - 1; i >= 0; i--) {
    const message = entries[i]?.message;
    if (entries[i]?.type !== "message" || message?.role !== "user") continue;
    const content = message.content;
    const text =
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content
              .filter((block: { type?: string }) => block.type === "text")
              .map((block: { text?: string }) => block.text ?? "")
              .join("\n")
          : "";
    return text
      .replace(/^<skill name="[^"]*"[\s\S]*?\n<\/skill>\n*/, "")
      .replace(/\n*<system>[\s\S]*?<\/system>/g, "")
      .trim();
  }
  return "";
}

/** What the reranker scores: the prompt, and for a short follow-up the user message before it too. */
export function scoringQuery(text: string, entries: readonly ContextEntry[]): string {
  const prompt = text.trim();
  if (prompt.length >= SHORT_PROMPT) return prompt;
  const previous = lastUserText(entries);
  return previous === "" ? prompt : `${previous.slice(-1000)}\n\n${prompt}`;
}

interface ScoredPrompt {
  ranking: Ranking | undefined;
  decision: Decision;
}

async function scoreInput(
  event: InputEvent,
  ctx: ExtensionContext,
  ranker: SemanticRanker,
  skills: readonly LoadedSkill[],
  inContext: (ctx: ExtensionContext) => Set<string>,
): Promise<ScoredPrompt | undefined> {
  const entries = ctx.sessionManager.buildContextEntries() as ContextEntry[];
  const signals = [AbortSignal.timeout(ranker.config.timeoutMs), ...(ctx.signal ? [ctx.signal] : [])];
  try {
    const ranking = await ranker.rank(scoringQuery(event.text, entries), skills, AbortSignal.any(signals));
    return { ranking, decision: decide(ranking, inContext(ctx), ranker.config) };
  } catch {
    return undefined;
  }
}

function recordScore(pi: RepoSkillsApi, scored: ScoredPrompt): void {
  if (!scored.ranking) return;
  pi.appendEntry(SCORE_ENTRY, {
    decision: scored.decision.kind,
    scores: scored.ranking.scores,
    parts: scored.ranking.parts.map((part) => part.path),
  });
}

/**
 * What the input handler returns: a loaded skill goes before the prompt, where the user sees it as a
 * collapsed skill block. A note does not change the prompt; `setNote` keeps it for
 * `before_agent_start`, which adds it as a message the user does not see. A message sent while the
 * agent runs gets no note, because no new run starts for it.
 */
function inputResult(
  event: InputEvent,
  ctx: ExtensionContext,
  decision: Decision,
  notify: (ctx: ExtensionContext, text: string) => void,
  setNote: (note: string) => void,
): InputEventResult {
  if (decision.kind === "none") return { action: "continue" };
  const score = decision.score.toFixed(2);
  if (decision.kind === "load") {
    const parts = decision.parts.length > 0 ? `, ${partList(decision.parts)}` : "";
    notify(ctx, `loaded ${decision.skill.name} (${score}${parts})`);
    return {
      action: "transform",
      text: `${skillBlock(decision.skill, decision.parts)}\n\n${event.text}`,
      ...(event.images ? { images: event.images } : {}),
    };
  }
  if (decision.kind === "suggest") notify(ctx, `/skill:${decision.skill.name} may help (${score})`);
  const text = note(decision);
  if (text && !event.streamingBehavior) setNote(text);
  return { action: "continue" };
}

function resultOutput(event: ToolResultEvent): string {
  return NOT_ERROR_OUTPUT.has(event.toolName)
    ? ""
    : event.content.map((block) => (block.type === "text" ? block.text : "")).join("\n");
}

function resultPath(event: ToolResultEvent): unknown {
  return event.toolName === "read" ? event.input.path : undefined;
}

function resultReason(
  skill: LoadedSkill,
  target: string | undefined,
  path: string | undefined,
  output: string,
  root: string,
  home: string,
): string | undefined {
  const matchedPath = target && matchesFile(skill, target, root, home) ? String(path) : undefined;
  return matchedPath ?? (output ? matchingError(skill, output) : undefined);
}

function resultAdditions(
  event: ToolResultEvent,
  ctx: ExtensionContext,
  skills: readonly LoadedSkill[],
  root: string,
  home: string,
  inContext: (ctx: ExtensionContext) => Set<string>,
  triggered: (ctx: ExtensionContext, skill: LoadedSkill, why: string) => string | undefined,
): string[] {
  const loaded = inContext(ctx);
  const additions: string[] = [];
  const output = resultOutput(event);
  const path = resultPath(event);
  const pathText = typeof path === "string" ? path : undefined;
  const target = pathText !== undefined ? toolPath(pathText, ctx.cwd, home) : undefined;
  for (const skill of skills) {
    if (loaded.has(skill.name)) continue;
    const why = resultReason(skill, target, pathText, output, root, home);
    if (why === undefined) continue;
    const addition = triggered(ctx, skill, why);
    if (addition) additions.push(addition);
  }
  return additions;
}

function skillStatusLines(skill: SkillEntry, pattern: string | undefined): string[] {
  const lines = [
    pattern === undefined ? `- ${skill.name}: not loaded` : `- ${skill.name}: loaded (matches ${pattern})`,
  ];
  const triggers = describeTriggers(skill.triggers);
  if (triggers !== "") lines.push(`  triggers: ${triggers}`);
  for (const [sub, { triggers: subTriggers }] of Object.entries(skill.subskills)) {
    lines.push(`  subskill ${sub}: ${describeTriggers(subTriggers) || "no triggers"}`);
  }
  return lines;
}

function statusLines(config: LoadedConfig, match: MatchContext): string[] {
  const selected = new Map(selectSkills(config, match).map(({ skill, pattern }) => [skill.name, pattern]));
  const lines = [`config: ${config.path}`, `cwd: ${match.cwd}`];
  if (match.repo) {
    lines.push(`main checkout: ${match.repo.mainRoot}`);
    if (match.repo.worktreeRoot !== match.repo.mainRoot) lines.push(`worktree: ${match.repo.worktreeRoot}`);
    for (const url of match.repo.remotes) lines.push(`remote: ${normalizeRemote(url) ?? url}`);
  } else {
    lines.push("not in a git repository");
  }
  lines.push(
    config.semantic
      ? `scoring: ${config.semantic.url} (load ${config.semantic.load}, hint ${config.semantic.hint}, part ${config.semantic.part})`
      : "scoring: off (no semantic.url)",
  );
  if (config.skills.length === 0) lines.push("no skills configured");
  for (const skill of config.skills) lines.push(...skillStatusLines(skill, selected.get(skill.name)));
  lines.push(...config.errors.map((error) => `error: ${error}`));
  lines.push("Changed the config or the directory? Run /reload.");
  return lines;
}

function readSelectedSkills(selected: readonly Selected[]): { skills: LoadedSkill[]; errors: string[] } {
  const skills: LoadedSkill[] = [];
  const errors: string[] = [];
  for (const { skill } of selected) {
    const set = readSkillSet(skill);
    skills.push(...set);
    const found = new Set(set.slice(1).map((sub) => basename(sub.baseDir)));
    for (const sub of Object.keys(skill.subskills)) {
      if (!found.has(sub))
        errors.push(
          `${skill.name}: subskill "${sub}" is configured, but the skill has no folder ${sub}/ with a SKILL.md`,
        );
    }
  }
  return { skills, errors };
}

async function scoreCommand(
  args: string,
  ctx: ExtensionContext,
  config: LoadedConfig,
  skills: readonly LoadedSkill[],
  fetchFn?: Fetch,
): Promise<boolean> {
  if (!args.trim().startsWith("score")) return false;
  const prompt = args.trim().slice("score".length).trim();
  ctx.ui.notify(await scoreReport(prompt, config, skills, fetchFn), "info");
  return true;
}

export function createRepoSkills(pi: RepoSkillsApi, options: Options = {}): void {
  const env = options.env ?? process.env;
  const home = options.home ?? homedir();
  const file = configPath(env, home);
  const matchContext = (cwd: string): MatchContext => ({ cwd, home, repo: findRepo(cwd) });
  let errors: string[] = [];
  /** The loaded skills of this session, and the root that relative `paths` triggers start from. */
  let skills: LoadedSkill[] = [];
  let root = "";
  let ranker: SemanticRanker | undefined;
  /** Skills added to tool results in the current turn, which are not in the session entries yet. */
  const addedThisTurn = new Set<string>();
  /** The note for the next run, from scoring the prompt that starts it. */
  let pendingNote: string | undefined;
  /** Run-only-on-request skills already suggested in this session. */
  const suggested = new Set<string>();

  const inContext = (ctx: ExtensionContext): Set<string> => {
    const loaded = skillsInContext(ctx.sessionManager.buildContextEntries() as ContextEntry[], skills);
    for (const name of addedThisTurn) loaded.add(name);
    return loaded;
  };
  const notify = (ctx: ExtensionContext, text: string) => {
    if (ctx.hasUI) ctx.ui.notify(`repo-skills: ${text}`, "info");
  };
  /** What to add for a fixed trigger: the skill block, or a suggestion for a run-only-on-request skill. */
  const triggered = (ctx: ExtensionContext, skill: LoadedSkill, why: string): string | undefined => {
    if (skill.disableModelInvocation) {
      if (suggested.has(skill.name)) return undefined;
      suggested.add(skill.name);
      notify(ctx, `/skill:${skill.name} may help (${why})`);
      return note({ kind: "suggest", skill, score: 1 });
    }
    addedThisTurn.add(skill.name);
    notify(ctx, `loaded ${skill.name} (${why})`);
    return skillBlock(skill);
  };

  // Runs at startup and on /reload, so changes to the config apply after /reload.
  pi.on("resources_discover", (event) => {
    const config = loadConfig(file, home);
    const match = matchContext(event.cwd);
    const selected = selectSkills(config, match);
    const { skillPaths, promptPaths, errors: pathErrors } = resourcePaths(selected);
    const loaded = readSelectedSkills(selected);
    errors = [...config.errors, ...pathErrors, ...loaded.errors];
    skills = loaded.skills;
    for (const skill of skills) {
      if (!saysWhen(skill)) {
        errors.push(`${skill.name}: the description does not say when to use the skill ("Use when ...")`);
      }
    }
    root = match.repo?.worktreeRoot ?? event.cwd;
    ranker = config.semantic ? new SemanticRanker(config.semantic, options.fetch) : undefined;
    // Loads the models and embeds the skills, so the first prompt does not wait for it.
    void ranker?.warm(skills);
    return { skillPaths, promptPaths };
  });

  pi.on("session_start", (_event, ctx) => {
    if (errors.length > 0 && ctx.hasUI) ctx.ui.notify(`repo-skills:\n${errors.join("\n")}`, "warning");
  });

  pi.on("turn_start", () => {
    addedThisTurn.clear();
  });

  // Scores the prompt against the skills and loads the best one before the model sees the prompt.
  pi.on("input", async (event, ctx) => {
    pendingNote = undefined;
    if (!ranker || skills.length === 0 || event.text.trimStart().startsWith("/")) return { action: "continue" };
    const scored = await scoreInput(event, ctx, ranker, skills, inContext);
    if (!scored) return { action: "continue" };
    recordScore(pi, scored);
    return inputResult(event, ctx, scored.decision, notify, (text) => {
      pendingNote = text;
    });
  });

  // The note of the last prompt, as a message the model reads and the user does not see.
  pi.on("before_agent_start", (event) => {
    const text = pendingNote;
    pendingNote = undefined;
    if (!text || event.messageType !== "user") return undefined;
    return { message: { customType: NOTE_MESSAGE, content: text, display: false } };
  });

  // Edits and writes of files a skill covers wait until the skill is in context; a second read of a
  // SKILL.md that is still in context is refused.
  pi.on("tool_call", (event, ctx) => {
    const path = (event.input as { path?: unknown }).path;
    if (event.parentToolCallId || typeof path !== "string") return undefined;
    const target = toolPath(path, ctx.cwd, home);
    if (event.toolName === "read") {
      const skill = skills.find((candidate) => candidate.filePath === target);
      if (skill && inContext(ctx).has(skill.name)) {
        return {
          block: true,
          reason: `The skill ${skill.name} is already in this conversation above; use it from there. Read its other files when you need them.`,
        };
      }
      return undefined;
    }
    if (event.toolName !== "edit" && event.toolName !== "write") return undefined;
    const loaded = inContext(ctx);
    const skill = skills.find(
      (candidate) =>
        !loaded.has(candidate.name) && !candidate.disableModelInvocation && matchesFile(candidate, target, root, home),
    );
    if (!skill) return undefined;
    const block = triggered(ctx, skill, path);
    return {
      block: true,
      reason: `${block}\n\nThis file falls under the skill ${skill.name}, now loaded above. Follow it, then repeat the ${event.toolName} call.`,
    };
  });

  // Reads of files a skill covers and errors a skill knows get the skill added to the tool result.
  pi.on("tool_result", (event, ctx) => {
    if (event.parentToolCallId) return undefined;
    const additions = resultAdditions(event, ctx, skills, root, home, inContext, triggered);
    if (additions.length === 0) return undefined;
    return { content: [...event.content, { type: "text" as const, text: additions.join("\n\n") }] };
  });

  pi.registerCommand("repo-skills", {
    description:
      "Show which repository pi is in and which repo-skills skills match it; `/repo-skills score <prompt>` scores a prompt",
    handler: async (args, ctx) => {
      const config = loadConfig(file, home);
      if (await scoreCommand(args, ctx, config, skills, options.fetch)) return;
      const match = matchContext(ctx.cwd);
      ctx.ui.notify(statusLines(config, match).join("\n"), "info");
    },
  });
}

function describeTriggers({ paths, extensions, errors }: Triggers): string {
  return [...paths, ...extensions, ...errors.map((pattern) => `/${pattern}/`)].join(", ");
}

/** `/repo-skills score <prompt>`: the scores of the loaded skills and the parts that would be added. */
export async function scoreReport(
  prompt: string,
  config: LoadedConfig,
  skills: readonly LoadedSkill[],
  fetchFn?: Fetch,
): Promise<string> {
  if (!config.semantic) return "scoring is off: set semantic.url";
  if (prompt === "") return "usage: /repo-skills score <prompt>";
  const ranker = new SemanticRanker(config.semantic, fetchFn);
  try {
    const ranking = await ranker.rank(prompt, skills, AbortSignal.timeout(config.semantic.timeoutMs * 10));
    if (!ranking) return "no skills with a description are loaded";
    const decision = decide(ranking, new Set(), config.semantic);
    return [
      `decision: ${decision.kind}`,
      ...ranking.scores.map(({ name, score }) => `- ${name}: ${score.toFixed(3)}`),
      `parts: ${ranking.parts.length > 0 ? partList(ranking.parts) : "none"}`,
    ].join("\n");
  } catch (error) {
    return `scoring failed: ${(error as Error).message}`;
  }
}

export default function repoSkills(pi: ExtensionAPI): void {
  createRepoSkills(pi);
}
