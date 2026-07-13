import { describe, it, expect } from "vitest";
import { mapFeedItem } from "./ingest";

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

  it("nulls out oversized or non-string guids", () => {
    expect(mapFeedItem({ guid: "g".repeat(501) }).guid).toBeNull();
    expect(mapFeedItem({ guid: 123 as unknown as string }).guid).toBeNull();
  });
});
