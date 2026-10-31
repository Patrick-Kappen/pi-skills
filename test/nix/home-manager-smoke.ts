// Run by the `home-manager` flake check with node: the files Home Manager generates must work together.
// Usage: node home-manager-smoke.ts <home-files> <agent-dir>
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { createRepoSkills as CreateRepoSkills, RepoSkillsApi } from "../../extensions/repo-skills/index.ts";

const [homeFiles, agentDir] = process.argv.slice(2);
if (!homeFiles || !agentDir) throw new Error("usage: home-manager-smoke.ts <home-files> <agent-dir>");

const extension = join(homeFiles, agentDir, "extensions", "repo-skills", "index.ts");
const config = join(homeFiles, agentDir, "repo-skills.json");
const { createRepoSkills }: { createRepoSkills: typeof CreateRepoSkills } = await import(extension);

function repo(remote: string): string {
  const dir = mkdtempSync(join(tmpdir(), "hm-smoke-"));
  mkdirSync(join(dir, "src"));
  execFileSync("git", ["init", "-q", dir]);
  execFileSync("git", ["-C", dir, "remote", "add", "origin", remote]);
  return join(dir, "src");
}

type Discover = (event: { type: "resources_discover"; cwd: string; reason: "startup" }) => {
  skillPaths: string[];
  promptPaths: string[];
};

function skillsIn(cwd: string): string[] {
  let discover: Discover | undefined;
  const pi = {
    on: (name: string, handler: Discover) => {
      if (name === "resources_discover") discover = handler;
    },
    registerCommand: () => {},
  } as unknown as RepoSkillsApi;
  createRepoSkills(pi, { env: { PI_REPO_SKILLS_CONFIG: config }, home: tmpdir() });
  const result = discover?.({ type: "resources_discover", cwd, reason: "startup" });
  if (!result) throw new Error("no resources_discover handler");
  // Without the hash of a store path: /nix/store/<hash>-extra-skill is extra-skill.
  return result.skillPaths.map((path) => basename(path).replace(/^[0-9a-z]{32}-/, "")).sort();
}

// Every skill of the flake loads everywhere by default; repo-scaffold only in Patrick-Kappen/*, and
// skill-review is turned off.
const cases: Array<[string, { has: string[]; not: string[] }]> = [
  [
    "git@github.com:Patrick-Kappen/nixos-config.git",
    { has: ["extra-skill", "git", "repo-scaffold"], not: ["skill-review"] },
  ],
  ["https://github.com/someone/else", { has: ["extra-skill", "git"], not: ["repo-scaffold", "skill-review"] }],
];
for (const [remote, { has, not }] of cases) {
  const actual = skillsIn(repo(remote));
  const wrong = [...has.filter((name) => !actual.includes(name)), ...not.filter((name) => actual.includes(name))];
  if (wrong.length > 0) throw new Error(`${remote}: got ${JSON.stringify(actual)}; wrong: ${wrong.join(", ")}`);
  process.stdout.write(`ok ${remote}: ${JSON.stringify(actual)}\n`);
}
