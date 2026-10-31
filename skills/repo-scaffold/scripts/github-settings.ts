#!/usr/bin/env node
// Usage:
//   github-settings.ts <owner/repo>... [--checks "<name>,<name>"]       check, change nothing
//   github-settings.ts --all <owner>                                     check every repository of the owner
//   github-settings.ts <owner/repo>... --apply --yes [--checks ...]      make the settings match
// Compares the GitHub settings of repositories with the settings of the repo-scaffold skill: merge
// settings, workflow permissions, security features and a ruleset that protects the default branch.
// Check prints every difference and exits 1 if there is any. --apply changes them; --yes confirms that
// the user agreed, because the changes are visible to others. Archived repositories and forks are
// skipped. Needs gh, logged in with admin rights on the repositories.
import { execFileSync } from "node:child_process";

export const RULESET_NAME = "main";

/** Repository role id of "admin" in GitHub rulesets. */
const ADMIN_ROLE = 5;

/** The job names of the scaffold's CI that must pass before a PR can merge. */
export const SCAFFOLD_CHECKS = [
  "PR title is a Conventional Commit",
  "devenv test (hooks, lint, types, tests, security, nix flake check)",
];

export interface Difference {
  area: string;
  setting: string;
  want: string;
  got: string;
}

export interface Current {
  repo: Record<string, unknown>;
  workflow: Record<string, unknown>;
  vulnerabilityAlerts: boolean;
  automatedSecurityFixes: boolean;
  privateVulnerabilityReporting: boolean;
  ruleset?: Ruleset | undefined;
}

interface Rule {
  type: string;
  parameters?: Record<string, unknown>;
}

export interface Ruleset {
  id?: number;
  name: string;
  target: string;
  enforcement: string;
  conditions: { ref_name: { include: string[]; exclude: string[] } };
  bypass_actors: { actor_id: number; actor_type: string; bypass_mode: string }[];
  rules: Rule[];
}

/** Runs gh; returns stdout, or undefined when gh fails (for example a 404). */
export type Gh = (args: string[], input?: string) => string | undefined;

export const MERGE_SETTINGS: Record<string, unknown> = {
  allow_squash_merge: true,
  allow_merge_commit: false,
  allow_rebase_merge: false,
  delete_branch_on_merge: true,
  allow_auto_merge: true,
  squash_merge_commit_title: "PR_TITLE",
  squash_merge_commit_message: "PR_BODY",
};

export const WORKFLOW_SETTINGS: Record<string, unknown> = {
  default_workflow_permissions: "read",
  can_approve_pull_request_reviews: true,
};

/** Secret scanning on private repositories needs GitHub Advanced Security, so public only. */
const PUBLIC_SECURITY = ["secret_scanning", "secret_scanning_push_protection"];

/** The ruleset for the default branch: PRs only, required checks, linear history, admins may bypass. */
export function desiredRuleset(checks: string[]): Ruleset {
  const rules: Rule[] = [
    { type: "deletion" },
    { type: "non_fast_forward" },
    { type: "required_linear_history" },
    {
      type: "pull_request",
      parameters: {
        required_approving_review_count: 0,
        dismiss_stale_reviews_on_push: false,
        require_code_owner_review: false,
        require_last_push_approval: false,
        required_review_thread_resolution: false,
        allowed_merge_methods: ["squash"],
      },
    },
  ];
  if (checks.length > 0) {
    rules.push({
      type: "required_status_checks",
      parameters: {
        strict_required_status_checks_policy: false,
        do_not_enforce_on_create: false,
        required_status_checks: checks.map((context) => ({ context })),
      },
    });
  }
  return {
    name: RULESET_NAME,
    target: "branch",
    enforcement: "active",
    conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
    bypass_actors: [{ actor_id: ADMIN_ROLE, actor_type: "RepositoryRole", bypass_mode: "always" }],
    rules,
  };
}

function show(value: unknown): string {
  return value === undefined ? "(not set)" : JSON.stringify(value);
}

/** A ruleset reduced to what this script manages, in a stable order. */
function shape(ruleset: Ruleset): Record<string, string> {
  const rules = Object.fromEntries(
    [...ruleset.rules]
      .sort((a, b) => a.type.localeCompare(b.type))
      .map((rule) => {
        const parameters = { ...(rule.parameters ?? {}) };
        const checks = parameters.required_status_checks as { context: string }[] | undefined;
        if (checks) parameters.required_status_checks = checks.map((check) => check.context).sort();
        for (const key of Object.keys(parameters)) {
          if (Array.isArray(parameters[key])) parameters[key] = [...(parameters[key] as unknown[])].sort();
        }
        return [`rule ${rule.type}`, show(Object.keys(parameters).length ? sortKeys(parameters) : {})];
      }),
  );
  return {
    target: ruleset.target,
    enforcement: ruleset.enforcement,
    branches: show(ruleset.conditions.ref_name.include),
    bypass: show(ruleset.bypass_actors.map((a) => `${a.actor_type}:${a.actor_id}:${a.bypass_mode}`).sort()),
    ...rules,
  };
}

function sortKeys(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, value[key]]),
  );
}

function compare(area: string, want: Record<string, unknown>, got: Record<string, unknown>): Difference[] {
  return Object.keys(want)
    .filter((key) => show(want[key]) !== show(got[key]))
    .map((setting) => ({ area, setting, want: show(want[setting]), got: show(got[setting]) }));
}

function securityStatus(repo: Record<string, unknown>, feature: string): boolean {
  const analysis = repo.security_and_analysis as Record<string, { status?: string }> | undefined;
  return analysis?.[feature]?.status === "enabled";
}

/** Every difference between the current settings and the scaffold's settings. */
export function differences(current: Current, checks: string[]): Difference[] {
  const isPublic = current.repo.visibility === "public";
  const security: Record<string, unknown> = {
    vulnerability_alerts: true,
    automated_security_fixes: true,
  };
  const securityNow: Record<string, unknown> = {
    vulnerability_alerts: current.vulnerabilityAlerts,
    automated_security_fixes: current.automatedSecurityFixes,
  };
  if (isPublic) {
    security.private_vulnerability_reporting = true;
    securityNow.private_vulnerability_reporting = current.privateVulnerabilityReporting;
    for (const feature of PUBLIC_SECURITY) {
      security[feature] = true;
      securityNow[feature] = securityStatus(current.repo, feature);
    }
  }
  const result = [
    ...compare("merge", MERGE_SETTINGS, current.repo),
    ...compare("actions", WORKFLOW_SETTINGS, current.workflow),
    ...compare("security", security, securityNow),
  ];
  if (!current.ruleset) {
    result.push({ area: "ruleset", setting: RULESET_NAME, want: "protects the default branch", got: "(missing)" });
  } else {
    result.push(...compare("ruleset", shape(desiredRuleset(checks)), shape(current.ruleset)));
  }
  return result;
}

function json<T>(text: string | undefined, fallback: T): T {
  return text === undefined || text === "" ? fallback : (JSON.parse(text) as T);
}

/** The required checks: the job names of `.github/workflows/ci.yml` on the default branch. */
export function ciChecks(gh: Gh, repo: string): string[] {
  const content = gh(["api", `repos/${repo}/contents/.github/workflows/ci.yml`, "--jq", ".content"]);
  if (!content) return [];
  const yaml = Buffer.from(content, "base64").toString("utf8");
  const jobs = yaml.split(/^jobs:\s*$/m)[1] ?? "";
  // A job's display name: "name:" indented by four spaces, directly under the job key.
  return [...jobs.matchAll(/^ {2}[\w-]+:\s*\n {4}name:\s*(.+?)\s*$/gm)].map((match) =>
    (match[1] ?? "").replace(/^["']|["']$/g, ""),
  );
}

export function readCurrent(gh: Gh, repo: string): Current {
  const list: unknown = json(gh(["api", `repos/${repo}/rulesets`]), []);
  const ruleset = (Array.isArray(list) ? (list as { id: number; name: string }[]) : []).find(
    (entry) => entry.name === RULESET_NAME,
  );
  return {
    repo: json(gh(["api", `repos/${repo}`]), {}),
    workflow: json(gh(["api", `repos/${repo}/actions/permissions/workflow`]), {}),
    vulnerabilityAlerts: gh(["api", `repos/${repo}/vulnerability-alerts`]) !== undefined,
    automatedSecurityFixes: json(gh(["api", `repos/${repo}/automated-security-fixes`]), { enabled: false }).enabled,
    privateVulnerabilityReporting: json(gh(["api", `repos/${repo}/private-vulnerability-reporting`]), {
      enabled: false,
    }).enabled,
    ruleset: ruleset
      ? json<Ruleset | undefined>(gh(["api", `repos/${repo}/rulesets/${ruleset.id}`]), undefined)
      : undefined,
  };
}

function must(gh: Gh, args: string[], input?: string): void {
  if (gh(args, input) === undefined) throw new Error(`gh ${args.join(" ")} failed`);
}

/** Makes the settings of `repo` match; only the areas with differences are changed. */
export function apply(gh: Gh, repo: string, current: Current, checks: string[]): void {
  const areas = new Set(differences(current, checks).map((difference) => difference.area));
  if (areas.has("merge")) {
    must(gh, ["api", "-X", "PATCH", `repos/${repo}`, "--input", "-"], JSON.stringify(MERGE_SETTINGS));
  }
  if (areas.has("actions")) {
    must(
      gh,
      ["api", "-X", "PUT", `repos/${repo}/actions/permissions/workflow`, "--input", "-"],
      JSON.stringify(WORKFLOW_SETTINGS),
    );
  }
  if (areas.has("security")) {
    must(gh, ["api", "-X", "PUT", `repos/${repo}/vulnerability-alerts`]);
    must(gh, ["api", "-X", "PUT", `repos/${repo}/automated-security-fixes`]);
    if (current.repo.visibility === "public") {
      must(gh, ["api", "-X", "PUT", `repos/${repo}/private-vulnerability-reporting`]);
      const analysis = Object.fromEntries(PUBLIC_SECURITY.map((feature) => [feature, { status: "enabled" }]));
      must(
        gh,
        ["api", "-X", "PATCH", `repos/${repo}`, "--input", "-"],
        JSON.stringify({ security_and_analysis: analysis }),
      );
    }
  }
  if (areas.has("ruleset")) {
    const body = JSON.stringify(desiredRuleset(checks));
    const id = current.ruleset?.id;
    must(gh, ["api", "-X", id ? "PUT" : "POST", `repos/${repo}/rulesets${id ? `/${id}` : ""}`, "--input", "-"], body);
  }
}

/** The repositories of an owner that this script manages: not archived, not forks. */
export function ownerRepos(gh: Gh, owner: string): string[] {
  const list = json<{ nameWithOwner: string; isArchived: boolean; isFork: boolean }[]>(
    gh(["repo", "list", owner, "--limit", "1000", "--json", "nameWithOwner,isArchived,isFork"]),
    [],
  );
  return list
    .filter((repo) => !repo.isArchived && !repo.isFork)
    .map((repo) => repo.nameWithOwner)
    .sort();
}

export const gh: Gh = (args, input) => {
  try {
    return execFileSync("gh", args, { encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"] });
  } catch {
    return undefined;
  }
};

interface Options {
  repos: string[];
  all?: string | undefined;
  apply: boolean;
  yes: boolean;
  checks?: string[] | undefined;
}

function readOption(options: Options, arg: string, next: () => string | undefined): void {
  if (arg === "--apply") options.apply = true;
  else if (arg === "--yes") options.yes = true;
  else if (arg === "--all") options.all = next();
  else if (arg === "--checks") {
    options.checks = (next() ?? "")
      .split(",")
      .map((check) => check.trim())
      .filter(Boolean);
  } else if (/^[\w.-]+\/[\w.-]+$/.test(arg)) options.repos.push(arg);
  else throw new Error(`unknown argument: ${arg}`);
}

export function parseArgs(argv: string[]): Options {
  const options: Options = { repos: [], apply: false, yes: false };
  const rest = [...argv];
  for (let arg = rest.shift(); arg !== undefined; arg = rest.shift()) readOption(options, arg, () => rest.shift());
  if (options.all === undefined && options.repos.length === 0) {
    throw new Error("name repositories (owner/repo) or --all <owner>");
  }
  if (options.all !== undefined && options.apply) throw new Error("--all only checks; apply per repository");
  if (options.apply && !options.yes) throw new Error("pass --yes after the user agreed to change the settings");
  return options;
}

/** Checks one repository, and applies when asked; returns the differences that are left. */
function runOne(options: Options, runGh: Gh, repo: string, log: (line: string) => void): Difference[] | undefined {
  const current = readCurrent(runGh, repo);
  if (current.repo.archived || current.repo.fork) {
    log(`${repo}: skipped (archived or fork)`);
    return undefined;
  }
  const checks = options.checks ?? ciChecks(runGh, repo);
  let found = differences(current, checks);
  if (options.apply && found.length > 0) {
    apply(runGh, repo, current, checks);
    found = differences(readCurrent(runGh, repo), checks);
    log(`${repo}: applied`);
  }
  const status = found.length === 0 ? "ok" : `${found.length} differences`;
  log(`${repo}: ${status}${checks.length > 0 ? "" : " (no CI checks found to require)"}`);
  for (const d of found) log(`  ${d.area} ${d.setting}: want ${d.want}, got ${d.got}`);
  return found;
}

/** Checks or applies; returns the number of repositories that differ (after --apply: that still differ). */
export function run(options: Options, runGh: Gh, log: (line: string) => void): number {
  const repos = options.all !== undefined ? ownerRepos(runGh, options.all) : options.repos;
  return repos.filter((repo) => (runOne(options, runGh, repo, log)?.length ?? 0) > 0).length;
}

/** The command line; returns the exit code: 0 all match, 1 differences, 2 an error. */
export function main(argv: string[], runGh: Gh = gh): number {
  try {
    return run(parseArgs(argv), runGh, (line) => process.stdout.write(`${line}\n`)) > 0 ? 1 : 0;
  } catch (error) {
    process.stderr.write(`github-settings: ${(error as Error).message}\n`);
    return 2;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = main(process.argv.slice(2));
