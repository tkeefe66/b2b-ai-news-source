import { describe, it, expect } from "vitest";
import { renderBriefEmail, renderFallbackEmail, esc } from "./render-email";
import type { BriefPayload } from "@shared/brief-payload";
import type { Article } from "@shared/schema";

const base: BriefPayload = {
  date: "2026-07-02",
  headline: "6sense reprices & CDPs consolidate",
  periodStart: "2026-07-01T12:00:00.000Z",
  periodEnd: "2026-07-02T12:00:00.000Z",
  topStories: [
    {
      title: "6sense <launches> pricing",
      whyItMatters: "Reshapes deal economics.",
      dbAngle: { strength: "strong", text: "Counter on transparency." },
      sourceName: "TechCrunch",
      link: "https://techcrunch.com/x",
      articleId: 1,
    },
    {
      title: "Plain story",
      whyItMatters: "Context only.",
      sourceName: "MarTech",
      link: "https://martech.example/y",
      articleId: 2,
    },
  ],
  competitorWatch: [
    { competitor: "6sense", summary: "Pricing move.", links: [{ title: "coverage", url: "https://a.example" }] },
  ],
  trendPulse: [{ trend: "CDP consolidation", direction: "rising", note: "Third deal this month." }],
  radar: [{ title: "HubSpot ships agents", sourceName: "MarTech Today", link: "https://b.example" }],
  contentIdea: { title: "Pricing hot take", description: "LinkedIn post.", deepLink: "/thought-leadership" },
  quietDay: false,
};

describe("esc", () => {
  it("escapes HTML entities", () => {
    expect(esc(`<script>"a" & 'b'</script>`)).toBe(
      "&lt;script&gt;&quot;a&quot; &amp; &#39;b&#39;&lt;/script&gt;",
    );
  });
});

describe("renderBriefEmail", () => {
  it("builds the subject in the spec format", () => {
    const { subject } = renderBriefEmail(base, "https://app.example.com");
    expect(subject).toBe("GTM Brief · Thu Jul 2 — 6sense reprices & CDPs consolidate");
  });

  it("escapes story titles in html", () => {
    const { html } = renderBriefEmail(base, "https://app.example.com");
    expect(html).toContain("6sense &lt;launches&gt; pricing");
    expect(html).not.toContain("<launches>");
  });

  it("renders the angle callout only for stories that have one", () => {
    const { html } = renderBriefEmail(base, "https://app.example.com");
    expect(html.match(/Demandbase angle/g)?.length).toBe(1);
  });

  it("renders all section headings when populated", () => {
    const { html } = renderBriefEmail(base, "https://app.example.com");
    expect(html).toContain("Competitor watch");
    expect(html).toContain("Trend pulse");
    expect(html).toContain("Radar");
    expect(html).toContain("Content idea");
  });

  it("omits empty sections entirely", () => {
    const empty: BriefPayload = { ...base, competitorWatch: [], trendPulse: [], radar: [], contentIdea: undefined };
    const { html } = renderBriefEmail(empty, "https://app.example.com");
    expect(html).not.toContain("Competitor watch");
    expect(html).not.toContain("Trend pulse");
    expect(html).not.toContain("Radar");
    expect(html).not.toContain("Content idea");
  });

  it("marks quiet days in the greeting", () => {
    const quiet = { ...base, quietDay: true };
    const { html, text } = renderBriefEmail(quiet, "https://app.example.com");
    expect(html).toContain("Quiet day");
    expect(text).toContain("Quiet day");
  });

  it("includes app deep links and dashboard button", () => {
    const { html } = renderBriefEmail(base, "https://app.example.com");
    expect(html).toContain("https://app.example.com/thought-leadership");
    expect(html).toContain("https://app.example.com/morning-brief");
  });

  it("produces a text version with story titles", () => {
    const { text } = renderBriefEmail(base, "https://app.example.com");
    expect(text).toContain("6sense <launches> pricing");
    expect(text).toContain("https://techcrunch.com/x");
  });
});

describe("renderFallbackEmail", () => {
  function art(id: number, title: string): Article {
    return {
      id, title, link: `https://example.com/${id}`, description: null, content: null,
      author: null, publishedAt: new Date("2026-07-02T08:00:00Z"), sourceId: null,
      sourceName: "Src", category: "AI", imageUrl: null, isRead: false,
      dismissed: false, dismissedAt: null, createdAt: new Date(),
    } as Article;
  }

  it("lists at most 10 headlines and says generation failed", () => {
    const arts = Array.from({ length: 14 }, (_, i) => art(i + 1, `Story ${i + 1}`));
    const { subject, html } = renderFallbackEmail(arts, "2026-07-02", "https://app.example.com");
    expect(subject).toContain("GTM Brief");
    expect(html).toContain("Story 10");
    expect(html).not.toContain("Story 11");
    expect(html.toLowerCase()).toContain("couldn&#39;t be generated");
  });
});
