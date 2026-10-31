import { describe, expect, test, vi } from "vitest";
import { NO_TRIGGERS, SEMANTIC_DEFAULTS, type SemanticConfig } from "./config.ts";
import { cosine, type Fetch, SemanticRanker } from "./semantic.ts";
import type { LoadedSkill, SkillPart } from "./skills.ts";

function skill(name: string, description: string, parts: SkillPart[] = []): LoadedSkill {
  return {
    name,
    description,
    disableModelInvocation: false,
    filePath: `/s/${name}/SKILL.md`,
    baseDir: `/s/${name}`,
    body: "",
    parts,
    triggers: NO_TRIGGERS,
  };
}

/** A fake server: texts embed to a vector per keyword, and rerank scores by the keyword in the query. */
function server(score: (query: string, document: string) => number) {
  const keywords = ["git", "test", "nix", "rebase", "ci"];
  const calls: { path: string; body: { input?: string[]; documents?: string[]; query?: string } }[] = [];
  const fetchFn = vi.fn<Fetch>(async (url, init) => {
    const path = new URL(url).pathname;
    const body = JSON.parse(String(init.body));
    calls.push({ path, body });
    if (path === "/v1/embeddings") {
      const data = (body.input as string[]).map((text, index) => ({
        index,
        embedding: keywords.map((keyword) => (text.toLowerCase().includes(keyword) ? 1 : 0.01)),
      }));
      return Response.json({ data });
    }
    const results = (body.documents as string[]).map((document, index) => ({
      index,
      relevance_score: score(body.query, document),
    }));
    return Response.json({ results: results.reverse() });
  });
  return { fetchFn, calls };
}

const config: SemanticConfig = { ...SEMANTIC_DEFAULTS, url: "http://h", candidates: 2 };
const byKeyword = (query: string, document: string) =>
  ["rebase", "git", "test", "nix"].some((keyword) => query.includes(keyword) && document.includes(keyword))
    ? 0.95
    : 0.01;

describe("cosine", () => {
  test("values", () => {
    expect(cosine([1, 0], [1, 0])).toBe(1);
    expect(cosine([1, 0], [0, 1])).toBe(0);
    expect(cosine([0, 0], [1, 1])).toBe(0);
    expect(cosine([1, 1], [1, 0])).toBeCloseTo(Math.SQRT1_2);
  });
});

describe("SemanticRanker", () => {
  const git = skill("git", "git work. Use when committing.", [
    { path: "references/rebasing.md", text: "rebase after a squash merge" },
    { path: "references/ci.md", text: "fix ci" },
    { path: "references/other.md", text: "other" },
  ]);
  const skills = [git, skill("tests", "make test suites fast"), skill("nix", "nix things"), skill("empty", "")];

  test("narrows by embedding, decides by reranker, picks the parts", async () => {
    const { fetchFn, calls } = server(byKeyword);
    const ranker = new SemanticRanker(config, fetchFn);
    const ranking = await ranker.rank("rebase my git branch", skills);
    expect(ranking?.skill.name).toBe("git");
    expect(ranking?.score).toBe(0.95);
    expect(ranking?.parts.map((part) => part.path)).toEqual(["references/rebasing.md"]);
    expect(ranking?.scores.map((score) => score.name)).toEqual(["git", expect.any(String)]);
    const reranks = calls.filter((call) => call.path === "/v1/rerank");
    expect(reranks[0]?.body.documents).toHaveLength(2);
    expect(calls[0]?.body.input?.[0]).toContain("Query: rebase my git branch");
  });

  test("embeddings are cached", async () => {
    const { fetchFn, calls } = server(byKeyword);
    const ranker = new SemanticRanker(config, fetchFn);
    await ranker.warm(skills);
    const embedded = calls.filter((call) => call.path === "/v1/embeddings").length;
    await ranker.rank("nix flake", skills);
    const inputs = calls.filter((call) => call.path === "/v1/embeddings").slice(embedded);
    expect(inputs.flatMap((call) => call.body.input)).toEqual([expect.stringContaining("Query: nix flake")]);
  });

  test("no parts below the hint score, and none with maxParts 0", async () => {
    const { fetchFn } = server(() => 0.3);
    expect((await new SemanticRanker(config, fetchFn).rank("git", skills))?.parts).toEqual([]);
    const { fetchFn: high } = server(() => 0.99);
    const ranker = new SemanticRanker({ ...config, maxParts: 0 }, high);
    expect((await ranker.rank("git", skills))?.parts).toEqual([]);
  });

  test("without a failing embedding all skills are reranked", async () => {
    const { calls } = server(byKeyword);
    const fetchFn = vi.fn<Fetch>(async (url, init) => {
      if (url.endsWith("/v1/embeddings")) return new Response("down", { status: 503 });
      return server(byKeyword).fetchFn(url, init);
    });
    const ranking = await new SemanticRanker(config, fetchFn).rank("test speed", skills);
    expect(ranking?.skill.name).toBe("tests");
    expect(ranking?.scores).toHaveLength(3);
    expect(calls).toHaveLength(0);
  });

  test("candidates 0 skips the embedding", async () => {
    const { fetchFn, calls } = server(byKeyword);
    await new SemanticRanker({ ...config, candidates: 0 }, fetchFn).rank("nix", skills);
    expect(calls.every((call) => call.path === "/v1/rerank")).toBe(true);
  });

  test("nothing to rank", async () => {
    const { fetchFn } = server(byKeyword);
    const ranker = new SemanticRanker(config, fetchFn);
    expect(await ranker.rank("x", [skill("empty", "")])).toBeUndefined();
    expect(await ranker.rank("  ", skills)).toBeUndefined();
    expect(await ranker.rerank("x", [])).toEqual([]);
  });

  test("errors", async () => {
    const bad = (body: unknown) => vi.fn<Fetch>(async () => Response.json(body));
    await expect(new SemanticRanker(config, bad({})).embed(["a"])).rejects.toThrow("unexpected response");
    await expect(new SemanticRanker(config, bad({})).rerank("a", ["b"])).rejects.toThrow("unexpected response");
    const down = vi.fn<Fetch>(async () => new Response("", { status: 500 }));
    await expect(new SemanticRanker(config, down).rank("git", skills.slice(0, 2))).rejects.toThrow("HTTP 500");
    await expect(new SemanticRanker(config, down).warm(skills)).resolves.toBeUndefined();
  });

  test("an aborted embedding is not retried", async () => {
    const controller = new AbortController();
    const fetchFn = vi.fn<Fetch>(async () => {
      controller.abort();
      throw new Error("aborted");
    });
    await expect(new SemanticRanker(config, fetchFn).rank("git", skills, controller.signal)).rejects.toThrow();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
