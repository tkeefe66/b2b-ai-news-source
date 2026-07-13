import { describe, it, expect } from "vitest";
import { buildBackfillPrompt, parseBackfillResponse } from "./tag-backfill";
import type { BackfillArticle } from "./tag-backfill";

const VOCAB = ["martech", "funding", "m&a", "layoffs", "product-launch", "regulation", "partnerships"];

const ARTICLES: BackfillArticle[] = [
  {
    id: 1,
    title: "Acme raises $50M Series B",
    description: "The martech startup closed a funding round led by Sequoia.",
    sourceName: "TechCrunch",
    category: "Funding",
  },
  {
    id: 2,
    title: "Widgets Inc announces layoffs",
    description: "The company cut 10% of staff amid a restructuring.",
    sourceName: "VentureBeat AI",
    category: "News",
  },
];

describe("buildBackfillPrompt", () => {
  it("includes every vocabulary term", () => {
    const prompt = buildBackfillPrompt(VOCAB, ARTICLES);
    for (const term of VOCAB) {
      expect(prompt).toContain(term);
    }
  });

  it("includes article ids and titles", () => {
    const prompt = buildBackfillPrompt(VOCAB, ARTICLES);
    expect(prompt).toContain("1");
    expect(prompt).toContain("Acme raises $50M Series B");
    expect(prompt).toContain("2");
    expect(prompt).toContain("Widgets Inc announces layoffs");
  });

  it("includes source and category for each article", () => {
    const prompt = buildBackfillPrompt(VOCAB, ARTICLES);
    expect(prompt).toContain("TechCrunch");
    expect(prompt).toContain("VentureBeat AI");
    expect(prompt).toContain("Funding");
  });

  it("truncates description to 300 chars", () => {
    const longArticle: BackfillArticle[] = [
      {
        id: 3,
        title: "Long article",
        description: "x".repeat(500),
        sourceName: "Source",
        category: "News",
      },
    ];
    const prompt = buildBackfillPrompt(VOCAB, longArticle);
    expect(prompt).not.toContain("x".repeat(301));
    expect(prompt).toContain("x".repeat(300));
  });

  it("instructs the model on 0-6 tags chosen verbatim from vocabulary", () => {
    const prompt = buildBackfillPrompt(VOCAB, ARTICLES);
    expect(prompt).toMatch(/0[\s\S]{0,10}6/);
    expect(prompt.toLowerCase()).toContain("verbatim");
    expect(prompt.toLowerCase()).toContain("b2b ai");
  });

  it("demands a bare JSON array response format", () => {
    const prompt = buildBackfillPrompt(VOCAB, ARTICLES);
    expect(prompt).toContain('"id"');
    expect(prompt).toContain('"tags"');
  });
});

describe("parseBackfillResponse", () => {
  const expectedIds = [1, 2];
  const vocab = new Set(VOCAB);

  it("parses a valid response", () => {
    const raw = JSON.stringify([
      { id: 1, tags: ["funding", "m&a"] },
      { id: 2, tags: ["layoffs"] },
    ]);
    expect(parseBackfillResponse(raw, expectedIds, vocab)).toEqual([
      { id: 1, tags: ["funding", "m&a"] },
      { id: 2, tags: ["layoffs"] },
    ]);
  });

  it("strips markdown code fences", () => {
    const raw = '```json\n[{"id":1,"tags":["funding"]}]\n```';
    expect(parseBackfillResponse(raw, expectedIds, vocab)).toEqual([{ id: 1, tags: ["funding"] }]);
  });

  it("returns [] on non-JSON garbage", () => {
    expect(parseBackfillResponse("the model rambled", expectedIds, vocab)).toEqual([]);
  });

  it("drops entries with ids not in expectedIds", () => {
    const raw = JSON.stringify([
      { id: 1, tags: ["funding"] },
      { id: 999, tags: ["m&a"] },
    ]);
    expect(parseBackfillResponse(raw, expectedIds, vocab)).toEqual([{ id: 1, tags: ["funding"] }]);
  });

  it("filters out tags not present in the vocabulary", () => {
    const raw = JSON.stringify([{ id: 1, tags: ["funding", "invented-tag", "m&a"] }]);
    expect(parseBackfillResponse(raw, expectedIds, vocab)).toEqual([{ id: 1, tags: ["funding", "m&a"] }]);
  });

  it("dedupes tags", () => {
    const raw = JSON.stringify([{ id: 1, tags: ["funding", "funding", "m&a"] }]);
    expect(parseBackfillResponse(raw, expectedIds, vocab)).toEqual([{ id: 1, tags: ["funding", "m&a"] }]);
  });

  it("caps tags at 6", () => {
    const raw = JSON.stringify([
      {
        id: 1,
        tags: ["martech", "funding", "m&a", "layoffs", "product-launch", "regulation", "partnerships"],
      },
    ]);
    const result = parseBackfillResponse(raw, expectedIds, vocab);
    expect(result[0].tags).toHaveLength(6);
  });

  it("tolerates missing entries (absent ids simply not returned)", () => {
    const raw = JSON.stringify([{ id: 1, tags: ["funding"] }]);
    const result = parseBackfillResponse(raw, expectedIds, vocab);
    expect(result).toEqual([{ id: 1, tags: ["funding"] }]);
    expect(result.find((r) => r.id === 2)).toBeUndefined();
  });

  it("allows an empty tags array as a valid result", () => {
    const raw = JSON.stringify([{ id: 1, tags: [] }]);
    expect(parseBackfillResponse(raw, expectedIds, vocab)).toEqual([{ id: 1, tags: [] }]);
  });

  it("drops entries with malformed fields", () => {
    const raw = JSON.stringify([
      { id: "not-a-number", tags: ["funding"] },
      { id: 2, tags: "not-an-array" },
    ]);
    expect(parseBackfillResponse(raw, expectedIds, vocab)).toEqual([]);
  });
});
