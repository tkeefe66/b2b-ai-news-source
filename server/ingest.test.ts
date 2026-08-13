import { describe, it, expect } from "vitest";
import { mapFeedItem, firstBlockedTag } from "./ingest";

describe("mapFeedItem", () => {
  it("extracts guid, tags, and sanitized content", () => {
    const mapped = mapFeedItem({
      guid: "5M2gv6mk7MEHXAvBa4H7z0",
      categories: ["AI", "Business"],
      content: "<p>Full <b>article</b> body</p>",
      contentSnippet: "Full article body",
    });
    expect(mapped.guid).toBe("5M2gv6mk7MEHXAvBa4H7z0");
    expect(mapped.tags).toEqual([
      { name: "ai", displayName: "AI" },
      { name: "business", displayName: "Business" },
    ]);
    expect(mapped.content).toBe("Full article body");
    expect(mapped.description).toBe("Full article body");
  });

  it("prefers content:encoded over content", () => {
    const mapped = mapFeedItem({
      content: "<p>short excerpt</p>",
      "content:encoded": "<p>the full body</p>",
    });
    expect(mapped.content).toBe("the full body");
  });

  it("caps content at 25000 chars and description at 500", () => {
    const mapped = mapFeedItem({
      content: "x".repeat(30000),
      contentSnippet: "y".repeat(600),
    });
    expect(mapped.content).toHaveLength(25000);
    expect(mapped.description).toHaveLength(500);
  });

  it("falls back to sanitized content for description when no snippet", () => {
    const mapped = mapFeedItem({ content: "<p>Body text</p>" });
    expect(mapped.description).toBe("Body text");
  });

  it("returns nulls for missing fields", () => {
    const mapped = mapFeedItem({});
    expect(mapped).toEqual({ guid: null, tags: [], description: null, content: null });
  });

  it("strips hnrss boilerplate down to null for link posts", () => {
    const mapped = mapFeedItem({
      guid: "https://news.ycombinator.com/item?id=49276574",
      content:
        "<p>Article URL: <a href=\"https://zed.dev/blog/introducing-delta\">https://zed.dev/blog/introducing-delta</a></p>\n" +
        "<p>Comments URL: <a href=\"https://news.ycombinator.com/item?id=49276574\">https://news.ycombinator.com/item?id=49276574</a></p>\n" +
        "<p>Points: 401</p>\n<p># Comments: 134</p>",
    });
    expect(mapped.content).toBeNull();
    expect(mapped.description).toBeNull();
    expect(mapped.guid).toBe("https://news.ycombinator.com/item?id=49276574");
  });

  it("keeps self-post prose while stripping the hnrss metadata around it", () => {
    const mapped = mapFeedItem({
      content:
        "<p>We spent a year replacing our CRM. Here is what broke.</p>\n" +
        "<p>Comments URL: <a href=\"https://news.ycombinator.com/item?id=1\">https://news.ycombinator.com/item?id=1</a></p>\n" +
        "<p>Points: 88</p>\n<p># Comments: 42</p>",
    });
    expect(mapped.content).toBe("We spent a year replacing our CRM. Here is what broke.");
    expect(mapped.description).toBe("We spent a year replacing our CRM. Here is what broke.");
  });

  it("leaves non-HN feeds that merely mention points untouched", () => {
    const mapped = mapFeedItem({
      content: "<p>Points: three reasons pipeline reviews fail</p>",
    });
    expect(mapped.description).toBe("Points: three reasons pipeline reviews fail");
  });

  it("nulls out oversized or non-string guids", () => {
    expect(mapFeedItem({ guid: "g".repeat(501) }).guid).toBeNull();
    expect(mapFeedItem({ guid: 123 as unknown as string }).guid).toBeNull();
  });
});

describe("firstBlockedTag", () => {
  it("returns the name of the blocked tag", () => {
    expect(firstBlockedTag({ ai: "approved", sponsored: "blocked" })).toBe("sponsored");
  });

  it("returns null when nothing is blocked", () => {
    expect(firstBlockedTag({ ai: "approved", saas: "pending" })).toBeNull();
  });

  it("returns null for an empty status map", () => {
    expect(firstBlockedTag({})).toBeNull();
  });
});
