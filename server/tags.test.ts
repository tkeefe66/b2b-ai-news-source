import { describe, it, expect } from "vitest";
import { normalizeTag, extractTags } from "./tags";

describe("normalizeTag", () => {
  it("lowercases and trims", () => {
    expect(normalizeTag("  AI  ")).toBe("ai");
  });
  it("collapses inner whitespace", () => {
    expect(normalizeTag("Machine   Learning")).toBe("machine learning");
  });
  it("rejects empty and whitespace-only", () => {
    expect(normalizeTag("")).toBeNull();
    expect(normalizeTag("   ")).toBeNull();
  });
  it("rejects tags longer than 40 chars", () => {
    expect(normalizeTag("a".repeat(41))).toBeNull();
    expect(normalizeTag("a".repeat(40))).toBe("a".repeat(40));
  });
  it("rejects pure numbers", () => {
    expect(normalizeTag("2026")).toBeNull();
  });
  it("rejects denylisted junk tags", () => {
    expect(normalizeTag("Uncategorized")).toBeNull();
    expect(normalizeTag("News")).toBeNull();
    expect(normalizeTag("General")).toBeNull();
  });
});

describe("extractTags", () => {
  it("normalizes, dedupes, and preserves first-seen display name", () => {
    const result = extractTags(["AI", "ai ", "Machine Learning"]);
    expect(result).toEqual([
      { name: "ai", displayName: "AI" },
      { name: "machine learning", displayName: "Machine Learning" },
    ]);
  });
  it("caps at 6 tags", () => {
    const result = extractTags(["a1", "b2", "c3", "d4", "e5", "f6", "g7"]);
    expect(result).toHaveLength(6);
  });
  it("drops invalid entries and handles non-arrays", () => {
    expect(extractTags(["", "Uncategorized", "OK"])).toEqual([{ name: "ok", displayName: "OK" }]);
    expect(extractTags(undefined)).toEqual([]);
    expect(extractTags("not-an-array")).toEqual([]);
    expect(extractTags([{ _: "weird rss object" }, "Real"])).toEqual([{ name: "real", displayName: "Real" }]);
  });
});
