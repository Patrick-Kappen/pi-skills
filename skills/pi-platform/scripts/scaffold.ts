#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, lstat, mkdir, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RUNTIME_SCRIPTS = [
  "inventory.ts",
  "plan-change.ts",
  "check-policy.ts",
  "release-plan.ts",
  "home-manager-plan.ts",
  "run-checks.ts",
  "jobs.ts",
  "lib-policy.ts",
];
const HELP = "Usage: scaffold.ts --repo PATH --name NAME --kind public|private --scaffold-skill PATH [--dry-run]";

type Options = { repo: string; name: string; kind: "public" | "private"; scaffoldSkill: string; dryRun: boolean };
type OutputFile = { relative: string; content: string; executable?: boolean };

type ParsedOptions = Partial<Options>;

function assignOption(options: ParsedOptions, flag: string, value: string): void {
  if (flag === "--repo") options.repo = value;
  else if (flag === "--name") options.name = value;
  else if (flag === "--kind") {
    if (value !== "public" && value !== "private") throw new Error("--kind must be public or private");
    options.kind = value;
  } else if (flag === "--scaffold-skill") options.scaffoldSkill = value;
}

function consumeOption(args: string[], index: number, options: ParsedOptions): number {
  const flag = args[index] ?? "";
  if (flag === "--help") throw new Error(HELP);
  if (flag === "--dry-run") {
    options.dryRun = true;
    return index + 1;
  }
  if (!["--repo", "--name", "--kind", "--scaffold-skill"].includes(flag))
    throw new Error(`unknown flag: ${flag}\n${HELP}`);
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`missing value for ${flag}\n${HELP}`);
  assignOption(options, flag, value);
  return index + 2;
}

export function parseArgs(args: string[]): Options {
  const options: ParsedOptions = { dryRun: false };
  for (let index = 0; index < args.length; ) index = consumeOption(args, index, options);
  if (!options.repo || !options.name || !options.kind || !options.scaffoldSkill) throw new Error(HELP);
  if (!/^[a-z][a-z0-9-]{0,47}$/.test(options.name))
    throw new Error("--name must be a lowercase component id (a-z, 0-9, hyphens)");
  return options as Options;
}

function git(cwd: string, ...args: string[]): string {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_INDEX_FILE;
  delete env.GIT_WORK_TREE;
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env }).trim();
}

function defaultRemoteBranch(repo: string): string {
  try {
    const remotes = git(repo, "remote").split("\n").filter(Boolean);
    const branches = remotes.flatMap((remote) => {
      try {
        const prefix = `refs/remotes/${remote}/`;
        const target = git(repo, "symbolic-ref", `refs/remotes/${remote}/HEAD`);
        return target.startsWith(prefix) ? [target.slice(prefix.length)] : [];
      } catch {
        return [];
      }
    });
    if (branches.length !== 1 || !branches[0]) throw new Error("default remote HEAD is missing or ambiguous");
    return branches[0];
  } catch {
    throw new Error("cannot identify default branch: configure one unambiguous remote HEAD before scaffolding");
  }
}

export async function validateTarget(
  repoPath: string,
  repoScaffoldPath: string,
): Promise<{ repo: string; scaffold: string; defaultBranch: string }> {
  if (repoPath.split(/[\\/]/).includes("..")) throw new Error("--repo path must not contain parent traversal");
  const absoluteRepo = path.resolve(repoPath);
  let cursor = path.parse(absoluteRepo).root;
  for (const segment of absoluteRepo.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    try {
      if ((await lstat(cursor)).isSymbolicLink()) throw new Error(`--repo path contains a symlink ancestor: ${cursor}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const repo = await realpath(repoPath);
  if (absoluteRepo !== repo) throw new Error("--repo path contains a symlink; use a real worktree path");
  const scaffold = await realpath(repoScaffoldPath);
  if (git(repo, "rev-parse", "--show-toplevel") !== repo)
    throw new Error("--repo must be an existing git worktree root");
  const commonGitDir = await realpath(path.resolve(repo, git(repo, "rev-parse", "--git-common-dir")));
  const worktreeGitDir = await realpath(path.resolve(repo, git(repo, "rev-parse", "--git-dir")));
  if (commonGitDir === worktreeGitDir) throw new Error("--repo must be a linked git worktree created for this change");
  const branch = git(repo, "branch", "--show-current");
  const defaultBranch = defaultRemoteBranch(repo);
  if (!branch || branch === defaultBranch)
    throw new Error(`refusing to overlay default branch '${defaultBranch}'; create a git_start worktree first`);
  await access(path.join(scaffold, "scripts", "scaffold.sh"));
  await access(path.join(scaffold, "scripts", "pin-actions.sh"));
  await access(path.join(scaffold, "templates", "devenv", "devenv.nix"));
  return { repo, scaffold, defaultBranch };
}

async function readTemplate(root: string, name: string): Promise<string> {
  return readFile(path.join(root, "templates", name), "utf8");
}

const TEMPLATE_FILES = [
  "platform-checks.json",
  "justfile",
  "tsconfig.json",
  "vitest.config.ts",
  "package.json",
  "biome.json",
  "knip.json",
  ".dependency-cruiser.cjs",
  "devenv.nix",
  "docs/platform-contract.md",
  "docs/ci-trust.md",
  "test/integration/platform-manifest.test.ts",
  ".github/workflows/ci.yml",
  ".github/workflows/release.yml",
  "home-manager/module.nix",
  "home-manager/examples/legacy-pi-rules.nix",
  "flake.nix",
  "devenv.yaml",
  "nix/devenv/typescript.nix",
];

async function loadTemplateFile(file: string, scaffold: string, templateRoot: string): Promise<string> {
  if (file === "devenv.nix") return readTemplate(scaffold, "devenv/devenv.nix");
  if (file === "devenv.yaml") return readTemplate(scaffold, "devenv/devenv.yaml");
  if (file === "nix/devenv/typescript.nix") return readTemplate(scaffold, "devenv/lang/typescript.nix");
  return readFile(path.join(templateRoot, file), "utf8");
}

function addComponentBoundaries(content: string, name: string): string {
  if (!content.includes("/* COMPONENT_BOUNDARY_RULES */")) return content;
  const componentIds = name === "core" ? ["core"] : ["core", name];
  const rules = componentIds
    .map((id) => {
      const allowed = [...new Set([id, ...(id === "core" ? [] : ["core"])])];
      const allowedPaths = allowed.map((dependency) => `${dependency}/`).join("|");
      return `componentBoundaries.push({\n  name: "${id}-import-boundary",\n  severity: "error",\n  from: { path: "^packages/${id}/src" },\n  to: { path: "^packages/(?!${allowedPaths})[^/]+/src" },\n});`;
    })
    .join("\n");
  return content.replace("/* COMPONENT_BOUNDARY_RULES */", rules);
}

function replaceTemplateValues(content: string, file: string, name: string, defaultBranch: string): string {
  const replacements: Record<string, string> = {
    "@NAME@": name,
    "@name@": name,
    "@LANGUAGE@": "typescript",
    "@DESCRIPTION@": "Reusable component monorepo",
    "@OWNER@": "local",
    "@YEAR@": String(new Date().getFullYear()),
    "@LICENSE@": "UNLICENSED",
    "@RELEASE_TYPE@": "node",
    "@DEFAULT_BRANCH@": defaultBranch,
    "@BASE_REF@": `origin/${defaultBranch}`,
  };
  for (const [placeholder, value] of Object.entries(replacements)) content = content.replaceAll(placeholder, value);
  if (file === "devenv.nix") {
    content = content.replace("  commonTools = [\n", "  commonTools = [\n    pkgs.just\n");
    content = content.replace(/check\.exec = ''[\s\S]*?'';/, 'check.exec = "just check";');
    content = content.replace("enterTest = ''\n      check\n    '';", 'enterTest = "just check";');
  }
  if (/@(?:[A-Z][A-Z0-9_]*|PLACEHOLDER)@/.test(content)) throw new Error(`unresolved template placeholder in ${file}`);
  return content;
}

async function renderTemplateFiles(
  scaffold: string,
  templateRoot: string,
  name: string,
  kind: "public" | "private",
  defaultBranch: string,
): Promise<OutputFile[]> {
  const files: OutputFile[] = [];
  for (const file of TEMPLATE_FILES) {
    const source = await loadTemplateFile(file, scaffold, templateRoot);
    const specialized = addComponentBoundaries(source, name);
    let content = replaceTemplateValues(specialized, file, name, defaultBranch);
    if (file === "package.json") {
      const manifest = JSON.parse(content) as Record<string, unknown>;
      manifest.license = kind === "public" ? "MIT" : "UNLICENSED";
      content = `${JSON.stringify(manifest, null, 2)}\n`;
    }
    files.push({ relative: file, content });
  }
  const description = "Modular Pi platform components and tooling";
  for (const file of ["README.md", "CONTRIBUTING.md", "SECURITY.md"]) {
    const content = (await readTemplate(scaffold, `common/${file}`))
      .replaceAll("@NAME@", name)
      .replaceAll("@DESCRIPTION@", description);
    files.push({ relative: file, content });
  }
  if (kind === "public") {
    const license = (await readTemplate(scaffold, "common/LICENSE-MIT"))
      .replaceAll("@YEAR@", String(new Date().getFullYear()))
      .replaceAll("@OWNER@", "Pi platform contributors");
    files.push({ relative: "LICENSE", content: license });
  }
  return files;
}

type Components = Record<string, { path: string; version: string; dependencies: string[] }>;

function componentCatalog(name: string, coreVersion: string): Components {
  if (name === "core") return { core: { path: "packages/core", version: coreVersion, dependencies: [] } };
  return {
    core: { path: "packages/core", version: coreVersion, dependencies: [] },
    [name]: { path: `packages/${name}`, version: "0.1.0", dependencies: ["core"] },
  };
}

function componentPackageFiles(
  id: string,
  component: Components[string],
  coreVersion: string,
  kind: "public" | "private",
): OutputFile[] {
  const manifest = {
    name: `@pi-platform/${id}`,
    version: "0.1.0",
    private: true,
    type: "module",
    license: kind === "public" ? "MIT" : "UNLICENSED",
    ...(id === "core" ? {} : { dependencies: { "@pi-platform/core": coreVersion } }),
  };
  return [
    { relative: `${component.path}/package.json`, content: `${JSON.stringify(manifest, null, 2)}\n` },
    {
      relative: `${component.path}/src/index.ts`,
      content: `/** ${id} component entrypoint. */\nexport const component = ${JSON.stringify(id)};\n`,
    },
    {
      relative: `${component.path}/src/index.test.ts`,
      content: `import { describe, expect, it } from "vitest";\nimport { component } from "./index.ts";\n\ndescribe(${JSON.stringify(id)}, () => {\n  it("exports its component id", () => {\n    expect(component).toBe(${JSON.stringify(id)});\n  });\n});\n`,
    },
  ];
}

async function renderCatalogFiles(
  templateRoot: string,
  name: string,
  kind: "public" | "private",
  coreVersion: string,
): Promise<{ files: OutputFile[]; components: Components }> {
  const components = componentCatalog(name, coreVersion);
  const ids = Object.keys(components);
  const releaseIds = kind === "private" ? [name] : ids;
  const releasePackages = Object.fromEntries(
    releaseIds.map((id) => [
      `packages/${id}`,
      {
        "package-name": `@pi-platform/${id}`,
        "changelog-path": `packages/${id}/CHANGELOG.md`,
        "initial-version": id === "core" ? coreVersion : "0.1.0",
      },
    ]),
  );
  const policy = JSON.parse(await readFile(path.join(templateRoot, "platform-policy.json"), "utf8")) as Record<
    string,
    unknown
  >;
  policy.allowedDependencies = Object.fromEntries(ids.map((id) => [id, id === "core" ? [] : ["core"]]));
  const files: OutputFile[] = [
    { relative: "platform.json", content: `${JSON.stringify({ schemaVersion: 1, components }, null, 2)}\n` },
    {
      relative: "platform-release-please-config.json",
      content: `${JSON.stringify({ "release-type": "node", "include-component-in-tag": true, packages: releasePackages }, null, 2)}\n`,
    },
    {
      relative: "platform-release-please-manifest.json",
      content: `${JSON.stringify(Object.fromEntries(releaseIds.map((id) => [`packages/${id}`, id === "core" ? coreVersion : "0.1.0"])), null, 2)}\n`,
    },
    { relative: "platform-policy.json", content: `${JSON.stringify(policy, null, 2)}\n` },
  ];
  for (const id of ids) {
    if (id === "core" && kind === "private") continue;
    const component = components[id];
    if (!component) throw new Error(`missing component catalog entry for ${id}`);
    files.push(...componentPackageFiles(id, component, coreVersion, kind));
  }
  return { files, components };
}

async function runtimeFiles(
  skill: string,
  templateRoot: string,
): Promise<{ files: OutputFile[]; hashes: Record<string, string> }> {
  const files: OutputFile[] = [];
  const hashes: Record<string, string> = {};
  const policyHook = await readFile(path.join(templateRoot, "policy-hook.mjs"));
  hashes["policy-hook.mjs"] = createHash("sha256").update(policyHook).digest("hex");
  files.push({ relative: "scripts/platform/policy-hook.mjs", content: policyHook.toString("utf8"), executable: true });
  const sourceScripts = path.join(skill, "scripts");
  for (const script of RUNTIME_SCRIPTS) {
    const source = path.join(sourceScripts, script);
    try {
      await access(source);
    } catch {
      throw new Error(`required runtime script not yet available: ${source}`);
    }
    const content = await readFile(source);
    hashes[script] = createHash("sha256").update(content).digest("hex");
    files.push({ relative: `scripts/platform/${script}`, content: content.toString("utf8"), executable: true });
  }
  const helpers = await readdir(sourceScripts).catch(() => []);
  for (const script of helpers.filter((entry) => entry.startsWith("lib-scaffold") && entry.endsWith(".ts"))) {
    const content = await readFile(path.join(sourceScripts, script));
    hashes[script] = createHash("sha256").update(content).digest("hex");
    files.push({ relative: `scripts/platform/${script}`, content: content.toString("utf8"), executable: true });
  }
  return { files, hashes };
}

export async function renderOverlay(
  skillPath: string,
  repoScaffoldPath: string,
  name: string,
  kind: "public" | "private" = "public",
  coreVersion = "0.1.0",
  defaultBranch = "main",
): Promise<OutputFile[]> {
  const resolvedSkill = await realpath(skillPath);
  const skill = path.basename(resolvedSkill) === "scripts" ? path.dirname(resolvedSkill) : resolvedSkill;
  const scaffold = await realpath(repoScaffoldPath);
  const templateRoot = path.join(skill, "templates");
  const files = await renderTemplateFiles(scaffold, templateRoot, name, kind, defaultBranch);
  const catalog = await renderCatalogFiles(templateRoot, name, kind, coreVersion);
  files.push(...catalog.files);
  const runtime = await runtimeFiles(skill, templateRoot);
  files.push(...runtime.files);
  files.push({
    relative: "scripts/platform/PROVENANCE.json",
    content: `${JSON.stringify({ source: "pi-platform skill runtime; copied once at scaffold time", sha256: runtime.hashes }, null, 2)}\n`,
  });
  return files;
}

async function privateCoreVersion(repo: string, options: Options): Promise<string> {
  if (options.kind !== "private") return "0.1.0";
  if (options.name === "core") throw new Error("private overlays cannot redefine the core component");
  const coreManifestPath = path.join(repo, "packages/core/package.json");
  let coreManifest: unknown;
  try {
    coreManifest = JSON.parse(await readFile(coreManifestPath, "utf8"));
  } catch {
    throw new Error(
      "private overlays must consume an existing packages/core/package.json; scaffold the public core first",
    );
  }
  if (!coreManifest || typeof coreManifest !== "object")
    throw new Error("private overlay requires a valid existing public core package manifest");
  const corePackage = coreManifest as Record<string, unknown>;
  await access(path.join(repo, "packages/core/src"));
  if (
    corePackage.name !== "@pi-platform/core" ||
    typeof corePackage.version !== "string" ||
    corePackage.version.split(".").length !== 3 ||
    corePackage.version.split(".").some((part) => !/^[0-9]+$/.test(part)) ||
    corePackage.private !== true ||
    corePackage.type !== "module"
  )
    throw new Error(
      "private overlay requires the existing public @pi-platform/core package with a semantic version, private:true, and type:module",
    );
  return corePackage.version;
}

async function validateDestinations(repo: string, files: OutputFile[]): Promise<void> {
  const destinations = files.map((file) => path.join(repo, file.relative));
  if (new Set(destinations).size !== destinations.length)
    throw new Error("scaffold templates contain duplicate output paths");
  for (const destination of destinations) await validateDestination(repo, destination);
}

async function validateDestination(repo: string, destination: string): Promise<void> {
  let parent = path.dirname(destination);
  while (parent.startsWith(`${repo}${path.sep}`)) {
    try {
      const parentInfo = await lstat(parent);
      if (parentInfo.isSymbolicLink())
        throw new Error(`refusing symlink output ancestor: ${path.relative(repo, parent)}`);
      if (!parentInfo.isDirectory())
        throw new Error(`output ancestor is not a directory: ${path.relative(repo, parent)}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const next = path.dirname(parent);
    if (next === parent) break;
    parent = next;
  }
  try {
    await lstat(destination);
    throw new Error(`refusing to overwrite existing path: ${path.relative(repo, destination)}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function writeOverlayFiles(
  repo: string,
  repoScaffold: string,
  files: OutputFile[],
  pinActions: (directory: string, scaffoldPath: string) => void,
): Promise<string[]> {
  const created: string[] = [];
  try {
    for (const file of files) {
      const destination = path.join(repo, file.relative);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, file.content, { flag: "wx", mode: file.executable ? 0o755 : 0o644 });
      created.push(destination);
    }
    pinActions(path.join(repo, ".github"), repoScaffold);
    for (const workflow of ["ci.yml", "release.yml"]) {
      const content = await readFile(path.join(repo, ".github", "workflows", workflow), "utf8");
      if (content.includes("@PIN:")) throw new Error(`unresolved action pin marker in .github/workflows/${workflow}`);
    }
    return files.map((file) => file.relative);
  } catch (error) {
    for (const file of created.reverse()) await rm(file, { force: true });
    throw error;
  }
}

export async function scaffold(
  options: Options,
  pinActions?: (directory: string, scaffoldPath: string) => void,
): Promise<string[]> {
  const { repo, scaffold: repoScaffold, defaultBranch } = await validateTarget(options.repo, options.scaffoldSkill);
  const coreVersion = await privateCoreVersion(repo, options);
  const files = await renderOverlay(
    path.dirname(path.dirname(fileURLToPath(import.meta.url))),
    repoScaffold,
    options.name,
    options.kind,
    coreVersion,
    defaultBranch,
  );
  files.push({
    relative: ".platform/scaffold.json",
    content: `${JSON.stringify({ schemaVersion: 1, kind: options.kind }, null, 2)}\n`,
  });
  await validateDestinations(repo, files);
  if (options.dryRun) return files.map((file) => file.relative);
  if (!pinActions)
    throw new Error("action pinning is required for a real scaffold; supply the repo-scaffold pin-actions utility");
  return writeOverlayFiles(repo, repoScaffold, files, pinActions);
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  try {
    if (args.length === 1 && args[0] === "--help") {
      process.stdout.write(`${HELP}\\n`);
      return;
    }
    const options = parseArgs(args);
    const result = await scaffold(options, (directory, skill) => {
      execFileSync(path.join(skill, "scripts", "pin-actions.sh"), [directory], { stdio: "inherit" });
    });
    process.stdout.write(`${options.dryRun ? "Would create" : "Created"} ${result.length} files\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) void main();
