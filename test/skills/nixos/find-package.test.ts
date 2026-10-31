// Runs find-package.sh against a fake nix-locate that answers from a fixed index.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, test } from "vitest";

const script = resolve(import.meta.dirname, "../../../skills/nixos/scripts/find-package.sh");
const bin = mkdtempSync(join(tmpdir(), "find-package-"));
const log = join(bin, "calls.log");

afterAll(() => rmSync(bin, { recursive: true, force: true }));

// Each line: "<attr.output> <path in the package>". The fake prints the attrs whose path matches.
const INDEX = [
  "jq.bin /bin/jq",
  "(gojq.out) /bin/jq",
  "python313Packages.jq.out /bin/jq",
  "rustls-libssl.out /lib/libssl.so.3",
  "openssl_3_6.out /lib/libssl.so.3",
  "openssl_3_6.out /lib/libssl.so.3",
  "zig.out /lib/include/zlib.h",
  "zlib.dev /include/zlib.h",
  "foo.out /share/foo/data.txt",
].join("\n");

writeFileSync(
  join(bin, "nix-locate"),
  `#!/usr/bin/env bash
echo "$*" >> "${log}"
pattern="\${!#}"
while read -r attr path; do
  if [[ "$path" =~ $pattern ]]; then echo "$attr"; fi
done <<'EOF'
${INDEX}
EOF
`,
);
chmodSync(join(bin, "nix-locate"), 0o755);

const bash = spawnSync("bash", ["-c", "command -v bash"], { encoding: "utf8" }).stdout.trim();

function run(args: string[], withLocate = true) {
  const PATH = withLocate ? `${bin}:${process.env.PATH}` : join(bin, "empty");
  const result = spawnSync(bash, [script, ...args], { encoding: "utf8", env: { ...process.env, PATH } });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

describe("find-package.sh", () => {
  test("a command: the package of that name first, dependencies left out", () => {
    const { code, out } = run(["jq"]);
    expect(code).toBe(0);
    expect(out.split("\n\n")[0]?.split("\n")).toEqual(["jq", "python313Packages.jq"]);
    expect(out).toContain("nix shell nixpkgs#jq -c jq ...");
    expect(out).toContain("packages = [ pkgs.jq ];");
  });

  test("a library: top-level attributes with its name first, shorter first, no duplicates", () => {
    const { code, out } = run(["libssl.so.3"]);
    expect(code).toBe(0);
    expect(out.split("\n\n")[0]?.split("\n")).toEqual(["openssl_3_6", "rustls-libssl"]);
    expect(out).toContain("Build with it:   nix shell nixpkgs#openssl_3_6");
  });

  test("a header, also in a subdirectory of include", () => {
    const { out } = run(["zlib.h"]);
    expect(out.split("\n\n")[0]?.split("\n")).toEqual(["zlib", "zig"]);
  });

  test("a path, and --all", () => {
    expect(run(["--all", "share/foo/data.txt"]).out.split("\n")[0]).toBe("foo");
  });

  test("the limit of 10", () => {
    const many = Array.from({ length: 12 }, (_, i) => `tool${i}.out /bin/tool`).join("\n");
    writeFileSync(join(bin, "index-many"), many);
    const fake = join(bin, "nix-locate");
    const original = `${bin}/nix-locate.orig`;
    spawnSync("cp", [fake, original]);
    writeFileSync(fake, `#!/usr/bin/env bash\ncut -d' ' -f1 "${join(bin, "index-many")}"\n`);
    try {
      expect(run(["tool"]).out.split("\n\n")[0]?.split("\n")).toHaveLength(10);
      expect(run(["--all", "tool"]).out.split("\n\n")[0]?.split("\n")).toHaveLength(12);
    } finally {
      spawnSync("cp", [original, fake]);
    }
  });

  test("nothing found", () => {
    const { code, err } = run(["nonexistent"]);
    expect(code).toBe(1);
    expect(err).toContain("no package provides command nonexistent");
  });

  test.each([
    [[], "usage:"],
    [["a", "b"], "give one"],
    [["--nope"], "unknown option"],
  ])("usage error %j", (args, message) => {
    const { code, err } = run(args);
    expect(code).toBe(2);
    expect(err).toContain(message);
  });

  test("help", () => {
    const { code, out } = run(["--help"]);
    expect(code).toBe(0);
    expect(out).toMatch(/^Usage: find-package\.sh/);
  });

  test("without nix-locate", () => {
    const { code, err } = run(["jq"], false);
    expect(code).toBe(2);
    expect(err).toContain("nix-locate is missing");
  });
});
