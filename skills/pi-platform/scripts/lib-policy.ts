import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export const COVERAGE_FLOOR = { lines: 95, functions: 95, statements: 95, branches: 90 } as const;
export const DUPLICATE_CEILING = 0;
export const COMPLEXITY_CEILING = 15;

export function parseArgs(args: string[], valueFlags: string[], booleanFlags: string[]): Map<string, string | true> {
  const result = new Map<string, string | true>();
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] as string;
    if (!arg.startsWith("--")) throw new Error(`unexpected argument: ${arg}`);
    const key = arg.slice(2);
    if (![...valueFlags, ...booleanFlags].includes(key)) throw new Error(`unknown option: ${arg}`);
    if (result.has(key)) throw new Error(`duplicate option: ${arg}`);
    if (booleanFlags.includes(key)) result.set(key, true);
    else {
      const value = args[i + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(`${arg} requires a value`);
      result.set(key, value);
      i += 1;
    }
  }
  return result;
}

export function required(args: Map<string, string | true>, key: string): string {
  const value = args.get(key);
  if (typeof value !== "string" || value.trim() === "") throw new Error(`--${key} is required`);
  return value;
}

export function safeRepo(path: string): string {
  const requested = realpathSync(resolve(path));
  if (!statSync(requested).isDirectory()) throw new Error(`repository is not a directory: ${path}`);
  const env = { ...process.env, GIT_DIR: undefined, GIT_INDEX_FILE: undefined, GIT_WORK_TREE: undefined };
  const root = realpathSync(
    execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: requested, encoding: "utf8", env }).trim(),
  );
  if (requested !== root) throw new Error(`repository path must be its git root, not a subdirectory: ${path}`);
  return root;
}

export function safeRelative(root: string, path: string): string | undefined {
  const normalized = path.replaceAll("\\", "/");
  if (normalized === "" || normalized.startsWith("/") || normalized.split("/").includes("..")) return undefined;
  const full = resolve(root, normalized);
  const rel = relative(resolve(root), full);
  if (rel === "" || rel.startsWith(`..${sep}`) || rel === "..") return undefined;
  let current = resolve(root);
  for (const segment of normalized.split("/")) {
    current = resolve(current, segment);
    if (existsSync(current)) {
      const real = realpathSync(current);
      if (!isWithin(root, real)) return undefined;
      current = real;
    }
  }
  return normalized;
}

export function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function gitText(repo: string, args: string[]): string {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("GIT_")) delete env[key];
  return execFileSync("git", args, { cwd: repo, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, env });
}

export function gitFile(repo: string, ref: string, path: string): string | undefined {
  try {
    return gitText(repo, ["show", "--end-of-options", `${ref}:${path}`]);
  } catch {
    return undefined;
  }
}

export function writeNewFile(path: string, content: string, dryRun: boolean): void {
  const target = resolve(path);
  if (existsSync(target)) throw new Error(`refusing to overwrite existing output: ${target}`);
  if (!dryRun) {
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    const parent = realpathSync(dirname(target));
    if (parent !== dirname(target)) throw new Error(`output parent resolves through a symlink: ${dirname(target)}`);
    writeFileSync(target, content, { flag: "wx", mode: 0o600 });
  }
}

export function isWithin(root: string, path: string): boolean {
  const rel = relative(resolve(root), resolve(path));
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}
