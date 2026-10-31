import type { SemanticConfig } from "./config.ts";
import { type LoadedSkill, partExcerpt, type SkillPart } from "./skills.ts";

/** The `fetch` this module calls; tests pass a fake. */
export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** Qwen3-Embedding expects an instruction before the query, not before the documents. */
const QUERY_INSTRUCTION =
  "Instruct: Given a request to a coding agent, retrieve the skill or document that helps with it";

export interface SkillScore {
  name: string;
  score: number;
}

/** The best skill for a prompt, its score, and the parts of it that match. */
export interface Ranking {
  skill: LoadedSkill;
  score: number;
  /** Parts with at least the `part` score, best first; only when `score` reaches the `hint` score. */
  parts: SkillPart[];
  /** All reranked skills, best first. */
  scores: SkillScore[];
}

export function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

function describe(skill: LoadedSkill): string {
  return `${skill.name}: ${skill.description}`;
}

/** Scores prompts against skills with an embedding model (to narrow down) and a reranker (to decide). */
export class SemanticRanker {
  private readonly vectors = new Map<string, number[]>();
  readonly config: SemanticConfig;
  private readonly fetchFn: Fetch;

  constructor(config: SemanticConfig, fetchFn: Fetch = fetch) {
    this.config = config;
    this.fetchFn = fetchFn;
  }

  private async post(path: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
    const response = await this.fetchFn(`${this.config.url}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: signal ?? null,
    });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return response.json();
  }

  /** Embeddings of the texts, cached by text. */
  async embed(texts: readonly string[], signal?: AbortSignal): Promise<number[][]> {
    const missing = [...new Set(texts.filter((text) => !this.vectors.has(text)))];
    if (missing.length > 0) {
      const result = (await this.post("/v1/embeddings", { model: this.config.embedModel, input: missing }, signal)) as {
        data?: { index: number; embedding: number[] }[];
      };
      if (!Array.isArray(result.data) || result.data.length !== missing.length) {
        throw new Error("/v1/embeddings: unexpected response");
      }
      for (const { index, embedding } of result.data) this.vectors.set(missing[index] as string, embedding);
    }
    return texts.map((text) => this.vectors.get(text) as number[]);
  }

  /** Relevance of each document to the query, from 0 to 1, in the order of the documents. */
  async rerank(query: string, documents: readonly string[], signal?: AbortSignal): Promise<number[]> {
    if (documents.length === 0) return [];
    const result = (await this.post("/v1/rerank", { model: this.config.rerankModel, query, documents }, signal)) as {
      results?: { index: number; relevance_score: number }[];
    };
    if (!Array.isArray(result.results)) throw new Error("/v1/rerank: unexpected response");
    const scores = documents.map(() => 0);
    for (const { index, relevance_score } of result.results) scores[index] = relevance_score;
    return scores;
  }

  /**
   * The `limit` items most similar to the query by embedding, in their original order. With no more
   * items than `limit`, or when the embedding fails, all items: the reranker then scores them all.
   */
  private async narrow<T>(query: string, items: T[], text: (item: T) => string[], signal?: AbortSignal): Promise<T[]> {
    const limit = this.config.candidates;
    if (limit === 0 || items.length <= limit) return items;
    try {
      const texts = items.map(text);
      const [queryVector, ...vectors] = await this.embed(
        [`${QUERY_INSTRUCTION}\nQuery: ${query}`, ...texts.flat()],
        signal,
      );
      let offset = 0;
      const similarity = texts.map((group) => {
        const best = Math.max(...group.map((_, i) => cosine(queryVector as number[], vectors[offset + i] as number[])));
        offset += group.length;
        return best;
      });
      const keep = new Set(
        similarity
          .map((score, index) => ({ score, index }))
          .sort((a, b) => b.score - a.score)
          .slice(0, limit)
          .map(({ index }) => index),
      );
      return items.filter((_, index) => keep.has(index));
    } catch (error) {
      if (signal?.aborted) throw error;
      return items;
    }
  }

  /** Embed the skills ahead of the first prompt, which also loads the models. Errors are ignored. */
  async warm(skills: readonly LoadedSkill[], signal?: AbortSignal): Promise<void> {
    try {
      await this.embed([...skills.map(describe), ...skills.flatMap((skill) => skill.parts.map(partExcerpt))], signal);
      await this.rerank("warm up", ["warm up"], signal);
    } catch {
      // The first prompt tries again.
    }
  }

  /** The best skill for the query, or undefined when no skill can be scored. */
  async rank(query: string, skills: readonly LoadedSkill[], signal?: AbortSignal): Promise<Ranking | undefined> {
    const eligible = skills.filter((skill) => skill.description !== "");
    if (eligible.length === 0 || query.trim() === "") return undefined;
    const candidates = await this.narrow(
      query,
      eligible,
      (skill) => [describe(skill), ...skill.parts.map(partExcerpt)],
      signal,
    );
    const scores = await this.rerank(query, candidates.map(describe), signal);
    const ranked = candidates
      .map((skill, index) => ({ skill, score: scores[index] ?? 0 }))
      .sort((a, b) => b.score - a.score);
    const best = ranked[0] as { skill: LoadedSkill; score: number };
    let parts: SkillPart[] = [];
    if (best.score >= this.config.hint && this.config.maxParts > 0 && best.skill.parts.length > 0) {
      const partCandidates = await this.narrow(query, best.skill.parts, (part) => [partExcerpt(part)], signal);
      const partScores = await this.rerank(query, partCandidates.map(partExcerpt), signal);
      parts = partCandidates
        .map((part, index) => ({ part, score: partScores[index] ?? 0 }))
        .filter(({ score }) => score >= this.config.part)
        .sort((a, b) => b.score - a.score)
        .slice(0, this.config.maxParts)
        .map(({ part }) => part);
    }
    return {
      skill: best.skill,
      score: best.score,
      parts,
      scores: ranked.map(({ skill, score }) => ({ name: skill.name, score })),
    };
  }
}
