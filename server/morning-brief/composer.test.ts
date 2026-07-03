import { describe, it, expect, vi } from "vitest";

// ai-models instantiates SDK clients at module load; mock so tests never need API keys
vi.mock("../ai-models", () => ({ chatCompletion: vi.fn() }));

import { matchCompetitors, buildBriefPrompt, extractJson, composeBrief, type ComposerInputs } from "./composer";
import type { Article, Competitor } from "@shared/schema";

function art(id: number, title: string, description = ""): Article {
  return {
    id, title, description,
    link: `https://example.com/${id}`,
    content: null, author: null,
    publishedAt: new Date("2026-07-02T08:00:00Z"),
    sourceId: null, sourceName: "Example Source", category: "GTM Tech",
    imageUrl: null, isRead: false, dismissed: false, dismissedAt: null,
    createdAt: new Date("2026-07-02T08:00:00Z"),
  } as Article;
}

function comp(name: string): Competitor {
  return { id: 1, name } as Competitor;
}

const validPayload = {
  date: "2026-07-02",
  headline: "Test headline",
  periodStart: "2026-07-01T12:00:00.000Z",
  periodEnd: "2026-07-02T12:00:00.000Z",
  topStories: [{
    title: "Story", whyItMatters: "Matters.", sourceName: "Example Source",
    link: "https://example.com/1", articleId: 1,
  }],
  competitorWatch: [], trendPulse: [], radar: [], quietDay: true,
};

function inputs(overrides: Partial<ComposerInputs> = {}): ComposerInputs {
  return {
    dateStr: "2026-07-02",
    window: { periodStart: new Date("2026-07-01T12:00:00Z"), periodEnd: new Date("2026-07-02T12:00:00Z") },
    articles: [art(1, "6sense launches usage-based pricing", "Big ABM pricing shift")],
    competitorCandidates: [{ name: "6sense", articleIds: [1] }],
    latestSnapshot: null, previousSnapshot: null,
    dbContext: "Demandbase is a GTM platform.",
    ...overrides,
  };
}

describe("matchCompetitors", () => {
  it("matches competitor names in title or description, case-insensitive", () => {
    const articles = [art(1, "6SENSE raises prices"), art(2, "Nothing here"), art(3, "About clearbit data", "clearbit expands")];
    const comps = [comp("6sense"), comp("Clearbit (HubSpot)"), comp("Bombora")];
    const out = matchCompetitors(articles, comps);
    expect(out).toEqual([
      { name: "6sense", articleIds: [1] },
      { name: "Clearbit (HubSpot)", articleIds: [3] },
    ]);
  });

  it("strips parenthetical suffixes when matching", () => {
    const out = matchCompetitors([art(9, "Terminus ships new ABM feature")], [comp("Terminus (DemandScience)")]);
    expect(out).toEqual([{ name: "Terminus (DemandScience)", articleIds: [9] }]);
  });
});

describe("buildBriefPrompt", () => {
  it("includes articles, competitor candidates, context, date, and the JSON contract", () => {
    const { system, user } = buildBriefPrompt(inputs());
    expect(system).toContain("strict JSON");
    expect(system).toContain("dbAngle");
    expect(user).toContain("6sense launches usage-based pricing");
    expect(user).toContain("[1]"); // article id marker
    expect(user).toContain("2026-07-02");
    expect(user).toContain("Demandbase is a GTM platform.");
  });
});

describe("extractJson", () => {
  it("strips markdown fences", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });
  it("extracts the outermost object from surrounding prose", () => {
    expect(extractJson('Here you go: {"a":1} hope that helps')).toBe('{"a":1}');
  });
});

describe("composeBrief", () => {
  it("returns the payload when the first response is valid", async () => {
    const chat = vi.fn().mockResolvedValue(JSON.stringify(validPayload));
    const result = await composeBrief(inputs(), chat as any);
    expect(result.headline).toBe("Test headline");
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it("runs one repair pass when the first response is invalid", async () => {
    const chat = vi.fn()
      .mockResolvedValueOnce('{"broken": true}')
      .mockResolvedValueOnce(JSON.stringify(validPayload));
    const result = await composeBrief(inputs(), chat as any);
    expect(result.headline).toBe("Test headline");
    expect(chat).toHaveBeenCalledTimes(2);
    const repairMessages = chat.mock.calls[1][0].messages;
    expect(JSON.stringify(repairMessages)).toContain("invalid");
  });

  it("throws after the repair pass also fails", async () => {
    const chat = vi.fn().mockResolvedValue('{"broken": true}');
    await expect(composeBrief(inputs(), chat as any)).rejects.toThrow(/Brief composition failed/);
    expect(chat).toHaveBeenCalledTimes(2);
  });
});
