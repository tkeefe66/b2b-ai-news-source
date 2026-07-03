import { describe, it, expect } from "vitest";
import { briefPayloadSchema } from "./brief-payload";

const validPayload = {
  date: "2026-07-02",
  headline: "6sense reprices, CDP consolidation accelerates",
  periodStart: "2026-07-01T12:00:00.000Z",
  periodEnd: "2026-07-02T12:00:00.000Z",
  topStories: [
    {
      title: "6sense announces new pricing model",
      whyItMatters: "Directly reshapes ABM platform deal economics.",
      dbAngle: { strength: "strong", text: "Demandbase can counter on transparent pricing." },
      sourceName: "TechCrunch",
      link: "https://techcrunch.com/example",
      articleId: 123,
    },
  ],
  competitorWatch: [
    {
      competitor: "6sense",
      summary: "Announced usage-based pricing.",
      links: [{ title: "6sense pricing news", url: "https://example.com/a" }],
    },
  ],
  trendPulse: [
    { trend: "CDP consolidation", direction: "rising", note: "Third acquisition this month." },
  ],
  radar: [
    { title: "HubSpot ships AI agents", sourceName: "MarTech Today", link: "https://example.com/b" },
  ],
  contentIdea: {
    title: "LinkedIn post: pricing transparency",
    description: "Hot take on usage-based pricing risk.",
    deepLink: "/thought-leadership",
  },
  quietDay: false,
};

describe("briefPayloadSchema", () => {
  it("accepts a fully-populated valid payload", () => {
    const result = briefPayloadSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  it("accepts a quiet day with one story, empty sections, no contentIdea", () => {
    const quiet = {
      ...validPayload,
      topStories: [validPayload.topStories[0]],
      competitorWatch: [],
      trendPulse: [],
      radar: [],
      contentIdea: undefined,
      quietDay: true,
    };
    const result = briefPayloadSchema.safeParse(quiet);
    expect(result.success).toBe(true);
  });

  it("rejects zero top stories", () => {
    const result = briefPayloadSchema.safeParse({ ...validPayload, topStories: [] });
    expect(result.success).toBe(false);
  });

  it("rejects more than 5 top stories", () => {
    const stories = Array.from({ length: 6 }, () => validPayload.topStories[0]);
    const result = briefPayloadSchema.safeParse({ ...validPayload, topStories: stories });
    expect(result.success).toBe(false);
  });

  it("rejects more than 8 radar items", () => {
    const radar = Array.from({ length: 9 }, () => validPayload.radar[0]);
    const result = briefPayloadSchema.safeParse({ ...validPayload, radar });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid dbAngle strength", () => {
    const bad = {
      ...validPayload,
      topStories: [{ ...validPayload.topStories[0], dbAngle: { strength: "weak", text: "x" } }],
    };
    const result = briefPayloadSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("rejects a non-URL top story link", () => {
    const bad = {
      ...validPayload,
      topStories: [{ ...validPayload.topStories[0], link: "not-a-url" }],
    };
    const result = briefPayloadSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });
});
