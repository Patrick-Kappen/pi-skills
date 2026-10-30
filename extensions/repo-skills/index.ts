import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { configPath, type LoadedConfig, loadConfig, type SkillEntry } from "./config.ts";
import { firstMatch, type MatchContext, normalizeRemote } from "./match.ts";
import { findRepo } from "./repo.ts";

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
}

/** The pi methods this extension uses; a subset of ExtensionAPI, so tests can pass a fake. */
export type RepoSkillsApi = Pick<ExtensionAPI, "on" | "registerCommand">;

export function createRepoSkills(pi: RepoSkillsApi, options: Options = {}): void {
  const env = options.env ?? process.env;
  const home = options.home ?? homedir();
  const file = configPath(env, home);
  const matchContext = (cwd: string): MatchContext => ({ cwd, home, repo: findRepo(cwd) });
  let errors: string[] = [];

  // Runs at startup and on /reload, so changes to the config apply after /reload.
  pi.on("resources_discover", (event) => {
    const config = loadConfig(file, home);
    const {
      skillPaths,
      promptPaths,
      errors: pathErrors,
    } = resourcePaths(selectSkills(config, matchContext(event.cwd)));
    errors = [...config.errors, ...pathErrors];
    return { skillPaths, promptPaths };
  });

  pi.on("session_start", (_event, ctx) => {
    if (errors.length > 0 && ctx.hasUI) ctx.ui.notify(`repo-skills:\n${errors.join("\n")}`, "warning");
  });

  pi.registerCommand("repo-skills", {
    description: "Show which repository pi is in and which repo-skills skills match it",
    handler: async (_args, ctx) => {
      const config = loadConfig(file, home);
      const match = matchContext(ctx.cwd);
      const selected = new Map(selectSkills(config, match).map(({ skill, pattern }) => [skill.name, pattern]));
      const lines = [`config: ${config.path}`, `cwd: ${ctx.cwd}`];
      if (match.repo) {
        lines.push(`main checkout: ${match.repo.mainRoot}`);
        if (match.repo.worktreeRoot !== match.repo.mainRoot) lines.push(`worktree: ${match.repo.worktreeRoot}`);
        for (const url of match.repo.remotes) lines.push(`remote: ${normalizeRemote(url) ?? url}`);
      } else {
        lines.push("not in a git repository");
      }
      if (config.skills.length === 0) lines.push("no skills configured");
      for (const skill of config.skills) {
        const pattern = selected.get(skill.name);
        lines.push(
          pattern === undefined ? `- ${skill.name}: not loaded` : `- ${skill.name}: loaded (matches ${pattern})`,
        );
      }
      lines.push(...config.errors.map((error) => `error: ${error}`));
      lines.push("Changed the config or the directory? Run /reload.");
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });
}

export default function repoSkills(pi: ExtensionAPI): void {
  createRepoSkills(pi);
}
