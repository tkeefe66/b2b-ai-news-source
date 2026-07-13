import { describe, it, expect } from "vitest";
import { mergeQueueTags } from "./tag-queue";
import type { FeedTag } from "@shared/schema";

const tag = (over: Partial<FeedTag>): FeedTag => ({
  id: 1,
  name: "m&a",
  displayName: "M&A",
  status: "pending",
  articleCount: 5,
  createdAt: new Date(),
  reviewedAt: null,
  aiSummary: null,
  aiSuggestion: null,
  aiAnnotatedAt: null,
  ...over,
});

describe("mergeQueueTags", () => {
  it("merges enrichment and fresh annotations onto tags", () => {
    const [merged] = mergeQueueTags(
      [tag({})],
      [{ name: "m&a", sources: ["VB"], count30d: 4, countPrev30d: 1, firstSeenAt: "2026-07-01T00:00:00.000Z", lastSeenAt: "2026-07-13T00:00:00.000Z" }],
      [{ name: "m&a", summary: "Media deals", suggestion: "approve" }]
    );
    expect(merged).toMatchObject({
      name: "m&a",
      sources: ["VB"],
      count30d: 4,
      aiSummary: "Media deals",
      aiSuggestion: "approve",
    });
  });
  it("fresh annotation wins over stale cached fields", () => {
    const [merged] = mergeQueueTags(
      [tag({ aiSummary: "old", aiSuggestion: "reject" })],
      [],
      [{ name: "m&a", summary: "new", suggestion: "approve" }]
    );
    expect(merged.aiSummary).toBe("new");
    expect(merged.aiSuggestion).toBe("approve");
  });
  it("falls back to cached annotation and zeroed enrichment when absent", () => {
    const [merged] = mergeQueueTags([tag({ aiSummary: "cached", aiSuggestion: "approve" })], [], []);
    expect(merged).toMatchObject({
      sources: [],
      count30d: 0,
      countPrev30d: 0,
      firstSeenAt: null,
      lastSeenAt: null,
      aiSummary: "cached",
      aiSuggestion: "approve",
    });
  });
});
