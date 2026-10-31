// Tests github-settings.ts against a fake GitHub held in memory, so no API is called.
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, test, vi } from "vitest";
import {
  apply,
  type Current,
  ciChecks,
  desiredRuleset,
  differences,
  type Gh,
  MERGE_SETTINGS,
  main,
  ownerRepos,
  parseArgs,
  readCurrent,
  gh as realGh,
  run,
  SCAFFOLD_CHECKS,
  WORKFLOW_SETTINGS,
} from "../../../skills/repo-scaffold/scripts/github-settings.ts";

const script = resolve(import.meta.dirname, "../../../skills/repo-scaffold/scripts/github-settings.ts");

const CI = `name: CI
on: [push]
jobs:
  pr-title:
    name: PR title is a Conventional Commit
    runs-on: ubuntu-latest
  check:
    name: "devenv test (hooks, lint, types, tests, security, nix flake check)"
    runs-on: ubuntu-latest
`;

const REPO_LIST = [
  { nameWithOwner: "o/b", isArchived: false, isFork: false },
  { nameWithOwner: "o/a", isArchived: false, isFork: false },
  { nameWithOwner: "o/old", isArchived: true, isFork: false },
  { nameWithOwner: "o/fork", isArchived: false, isFork: true },
];

/** A fake GitHub for one or more repositories; records every write. */
function fakeGitHub(visibility: "public" | "private", options: { ci?: boolean } = {}) {
  const state = {
    repo: { visibility, archived: false, fork: false, allow_merge_commit: true } as Record<string, unknown>,
    workflow: { default_workflow_permissions: "write", can_approve_pull_request_reviews: false } as Record<
      string,
      unknown
    >,
    alerts: false,
    fixes: false,
    reporting: false,
    rulesets: [] as Record<string, unknown>[],
  };
  const writes: string[] = [];
  type Body = Record<string, unknown>;
  const routes: Record<string, (body: Body) => string | undefined> = {
    "GET ": () => JSON.stringify(state.repo),
    "PATCH ": (body) => {
      state.repo = { ...state.repo, ...body };
      return "{}";
    },
    "GET /actions/permissions/workflow": () => JSON.stringify(state.workflow),
    "PUT /actions/permissions/workflow": (body) => {
      state.workflow = body;
      return "";
    },
    "GET /vulnerability-alerts": () => (state.alerts ? "" : undefined),
    "PUT /vulnerability-alerts": () => {
      state.alerts = true;
      return "";
    },
    "GET /automated-security-fixes": () => JSON.stringify({ enabled: state.fixes }),
    "PUT /automated-security-fixes": () => {
      state.fixes = true;
      return "";
    },
    "GET /private-vulnerability-reporting": () => JSON.stringify({ enabled: state.reporting }),
    "PUT /private-vulnerability-reporting": () => {
      state.reporting = true;
      return "";
    },
    "GET /rulesets": () => JSON.stringify(state.rulesets.map(({ id, name }) => ({ id, name }))),
    "POST /rulesets": (body) => {
      state.rulesets.push({ ...body, id: 7 });
      return "{}";
    },
    "GET /contents/.github/workflows/ci.yml": () => (options.ci ? Buffer.from(CI).toString("base64") : undefined),
  };
  const ruleset = (method: string, tail: string, body: Body): string | undefined => {
    const id = Number(tail.match(/^\/rulesets\/(\d+)$/)?.[1]);
    const index = state.rulesets.findIndex((entry) => entry.id === id);
    if (index < 0) throw new Error(`unexpected ${method} ${tail}`);
    if (method === "GET") return JSON.stringify(state.rulesets[index]);
    state.rulesets[index] = { ...body, id };
    return "{}";
  };
  const gh: Gh = (args, input) => {
    if (args[0] === "repo") return JSON.stringify(REPO_LIST);
    const rest = args.slice(1);
    const method = rest[0] === "-X" ? (rest[1] ?? "GET") : "GET";
    const path = (method === "GET" ? rest[0] : rest[2]) ?? "";
    if (method !== "GET") writes.push(`${method} ${path}`);
    const tail = path.replace(/^repos\/[^/]+\/[^/]+/, "");
    const body = input ? (JSON.parse(input) as Body) : {};
    const route = routes[`${method} ${tail}`];
    return route ? route(body) : ruleset(method, tail, body);
  };
  return { state, writes, gh };
}

describe("ciChecks", () => {
  test("reads the job names of ci.yml", () => {
    expect(ciChecks(fakeGitHub("public", { ci: true }).gh, "o/a")).toEqual(SCAFFOLD_CHECKS);
  });
  test("is empty without ci.yml", () => {
    expect(ciChecks(fakeGitHub("public").gh, "o/a")).toEqual([]);
  });
});

describe("differences", () => {
  test("lists every setting of an unconfigured public repository", () => {
    const found = differences(readCurrent(fakeGitHub("public").gh, "o/a"), SCAFFOLD_CHECKS);
    const names = found.map((d) => `${d.area} ${d.setting}`);
    expect(names).toEqual(
      expect.arrayContaining([
        "merge allow_merge_commit",
        "actions default_workflow_permissions",
        "security vulnerability_alerts",
        "security secret_scanning_push_protection",
        "security private_vulnerability_reporting",
        "ruleset main",
      ]),
    );
    expect(found.find((d) => d.setting === "allow_merge_commit")).toMatchObject({ want: "false", got: "true" });
  });

  test("private repositories are not asked for secret scanning or vulnerability reporting", () => {
    const names = differences(readCurrent(fakeGitHub("private").gh, "o/a"), []).map((d) => d.setting);
    expect(names).not.toContain("secret_scanning");
    expect(names).not.toContain("private_vulnerability_reporting");
    expect(names).toContain("automated_security_fixes");
  });

  const configured = (checks: string[]): Current => ({
    repo: { visibility: "private", ...MERGE_SETTINGS },
    workflow: { ...WORKFLOW_SETTINGS },
    vulnerabilityAlerts: true,
    automatedSecurityFixes: true,
    privateVulnerabilityReporting: false,
    ruleset: { ...desiredRuleset(checks), id: 1 },
  });

  test("a configured repository has no differences, whatever the order of rules and checks", () => {
    const current = configured([...SCAFFOLD_CHECKS].reverse());
    current.ruleset?.rules.reverse();
    expect(differences(current, SCAFFOLD_CHECKS)).toEqual([]);
  });

  test("a ruleset without the admin bypass or with other checks differs", () => {
    const current = configured(["other"]);
    if (current.ruleset) current.ruleset.bypass_actors = [];
    const names = differences(current, SCAFFOLD_CHECKS).map((d) => d.setting);
    expect(names).toEqual(["bypass", "rule required_status_checks"]);
  });

  test("no checks means no required_status_checks rule", () => {
    expect(desiredRuleset([]).rules.map((rule) => rule.type)).not.toContain("required_status_checks");
  });
});

describe("apply", () => {
  test("configures a public repository completely, then nothing differs", () => {
    const github = fakeGitHub("public", { ci: true });
    apply(github.gh, "o/a", readCurrent(github.gh, "o/a"), SCAFFOLD_CHECKS);
    expect(github.writes).toContain("POST repos/o/a/rulesets");
    expect(github.state.repo.security_and_analysis).toEqual({
      secret_scanning: { status: "enabled" },
      secret_scanning_push_protection: { status: "enabled" },
    });
    // The fake does not echo security_and_analysis statuses back in the shape GitHub does; set it.
    github.state.repo.security_and_analysis = {
      secret_scanning: { status: "enabled" },
      secret_scanning_push_protection: { status: "enabled" },
    };
    expect(differences(readCurrent(github.gh, "o/a"), SCAFFOLD_CHECKS)).toEqual([]);
  });

  test("replaces an existing ruleset called main instead of adding one", () => {
    const github = fakeGitHub("private");
    github.state.rulesets.push({ ...desiredRuleset([]), id: 3, enforcement: "disabled" });
    apply(github.gh, "o/a", readCurrent(github.gh, "o/a"), []);
    expect(github.writes).toContain("PUT repos/o/a/rulesets/3");
    expect(github.state.rulesets).toHaveLength(1);
  });

  test("changes only the areas that differ", () => {
    const github = fakeGitHub("private");
    github.state.repo = { ...github.state.repo, ...MERGE_SETTINGS };
    apply(github.gh, "o/a", readCurrent(github.gh, "o/a"), []);
    expect(github.writes).not.toContain("PATCH repos/o/a");
  });

  test("a failing write throws", () => {
    const github = fakeGitHub("private");
    const failing: Gh = (args, input) => (args.includes("PUT") ? undefined : github.gh(args, input));
    expect(() => apply(failing, "o/a", readCurrent(github.gh, "o/a"), [])).toThrow(/failed/);
  });
});

describe("run", () => {
  test("--all checks the owner's repositories, without archived ones and forks", () => {
    const lines: string[] = [];
    const differing = run(parseArgs(["--all", "o"]), fakeGitHub("private").gh, (line) => lines.push(line));
    expect(differing).toBe(2);
    expect(lines.filter((line) => !line.startsWith(" "))).toEqual([
      "o/a: 12 differences (no CI checks found to require)",
      "o/b: 12 differences (no CI checks found to require)",
    ]);
  });

  test("--apply leaves nothing to report on a private repository", () => {
    const lines: string[] = [];
    const differing = run(parseArgs(["o/a", "--apply", "--yes"]), fakeGitHub("private", { ci: true }).gh, (l) =>
      lines.push(l),
    );
    expect(differing).toBe(0);
    expect(lines).toEqual(["o/a: applied", "o/a: ok"]);
  });

  test("skips an archived repository", () => {
    const github = fakeGitHub("private");
    github.state.repo.archived = true;
    const lines: string[] = [];
    expect(run(parseArgs(["o/a"]), github.gh, (line) => lines.push(line))).toBe(0);
    expect(lines).toEqual(["o/a: skipped (archived or fork)"]);
  });

  test("ownerRepos is sorted", () => {
    expect(ownerRepos(fakeGitHub("private").gh, "o")).toEqual(["o/a", "o/b"]);
  });
});

describe("parseArgs", () => {
  test.each([
    [[], /name repositories/],
    [["o/a", "--apply"], /--yes/],
    [["--all", "o", "--apply", "--yes"], /only checks/],
    [["nonsense"], /unknown argument/],
  ])("%j is refused", (argv, message) => {
    expect(() => parseArgs(argv)).toThrow(message);
  });

  test("--checks splits on commas", () => {
    expect(parseArgs(["o/a", "--checks", "a, b,"]).checks).toEqual(["a", "b"]);
  });
});

test("the CLI exits 2 on a usage error", () => {
  let status = 0;
  try {
    execFileSync(script, ["o/a", "--apply"], { stdio: "pipe" });
  } catch (error) {
    status = (error as { status: number }).status;
  }
  expect(status).toBe(2);
});

describe("the CLI with a fake gh on PATH", () => {
  const cli = (gh: string) => {
    const bin = mkdtempSync(join(tmpdir(), "gh-"));
    writeFileSync(join(bin, "gh"), `#!/usr/bin/env bash\n${gh}\n`);
    chmodSync(join(bin, "gh"), 0o755);
    try {
      const out = execFileSync(script, ["o/a"], {
        encoding: "utf8",
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      });
      return { status: 0, out };
    } catch (error) {
      const failure = error as { status: number; stdout: string };
      return { status: failure.status, out: failure.stdout };
    } finally {
      rmSync(bin, { recursive: true, force: true });
    }
  };

  test("a repository without any settings differs and exits 1", () => {
    const result = cli("exit 1");
    expect(result.status).toBe(1);
    expect(result.out).toContain("o/a: ");
    expect(result.out).toContain("ruleset main: want protects the default branch, got (missing)");
  });

  test("gh output is read", () => {
    const result = cli(`echo '{"visibility":"private","archived":true}'`);
    expect(result).toEqual({ status: 0, out: "o/a: skipped (archived or fork)\n" });
  });
});

describe("main and the gh runner, in process", () => {
  test("main returns 0, 1 or 2", () => {
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const error = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const configured = fakeGitHub("private");
    configured.state.repo.archived = true;
    expect(main(["o/a"], configured.gh)).toBe(0);
    expect(main(["o/a"], fakeGitHub("private").gh)).toBe(1);
    expect(main(["--apply"], fakeGitHub("private").gh)).toBe(2);
    write.mockRestore();
    error.mockRestore();
  });

  test("the gh runner returns stdout, or undefined when gh fails", () => {
    const bin = mkdtempSync(join(tmpdir(), "gh-"));
    writeFileSync(join(bin, "gh"), `#!/usr/bin/env bash\n[[ $1 == ok ]] && cat && exit 0\nexit 1\n`);
    chmodSync(join(bin, "gh"), 0o755);
    const path = process.env.PATH;
    process.env.PATH = `${bin}:${path}`;
    try {
      expect(realGh(["ok"], "hello")).toBe("hello");
      expect(realGh(["fail"])).toBeUndefined();
    } finally {
      process.env.PATH = path;
      rmSync(bin, { recursive: true, force: true });
    }
  });
});
