import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

type Component = { path: string; version: string; dependencies: string[] };

describe("generated platform manifest", () => {
  it("agrees with every private component package manifest", async () => {
    const platform = JSON.parse(await readFile(path.resolve("platform.json"), "utf8")) as {
      schemaVersion: number;
      components: Record<string, Component>;
    };
    expect(platform.schemaVersion).toBe(1);
    for (const [id, component] of Object.entries(platform.components)) {
      expect(component.path).toMatch(/^packages\/[a-z][a-z0-9-]*$/);
      expect(component.dependencies.every((dependency) => dependency in platform.components)).toBe(true);
      const manifest = JSON.parse(await readFile(path.join(component.path, "package.json"), "utf8")) as Record<string, unknown>;
      expect(manifest).toMatchObject({ name: `@pi-platform/${id}`, version: component.version, private: true, type: "module" });
    }
  });
});
