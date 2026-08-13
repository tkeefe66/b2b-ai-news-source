import { describe, it, expect } from "vitest";
import { classifySource, dismissalRate, blockedDisplay } from "./source-report";
import type { SourceReportRow } from "./schema";

const row = (over: Partial<SourceReportRow> = {}): SourceReportRow => ({
  id: 1,
  name: "TechCrunch",
  category: "Technology",
  isActive: true,
  lastFetchedAt: "2026-08-12T10:00:00.000Z",
  count30d: 38,
  countAll: 740,
  lastArticleAt: "2026-08-12T05:00:00.000Z",
  dismissedAll: 95,
  blockedAll: 0,
  failureDays: 0,
  ...over,
});

describe("classifySource", () => {
  it("marks a source with fetch failures as failing, even if it has recent articles", () => {
    expect(classifySource(row({ failureDays: 2 }))).toBe("failing");
  });

  it("marks a source with no articles in 30d as silent", () => {
    expect(classifySource(row({ count30d: 0 }))).toBe("silent");
  });

  it("marks a source with recent articles as producing", () => {
    expect(classifySource(row())).toBe("producing");
  });
});

describe("dismissalRate", () => {
  it("formats the rate as a whole percentage", () => {
    expect(dismissalRate(row({ countAll: 740, dismissedAll: 95 }))).toBe("13%");
  });

  it("returns an em dash when the source has never produced an article", () => {
    expect(dismissalRate(row({ countAll: 0, dismissedAll: 0 }))).toBe("—");
  });

  it("rounds rather than truncates", () => {
    expect(dismissalRate(row({ countAll: 3, dismissedAll: 2 }))).toBe("67%");
  });
});

describe("blockedDisplay", () => {
  it("shows an em dash for a source never fetched since instrumentation shipped", () => {
    expect(blockedDisplay(row({ blockedAll: 0, lastFetchedAt: null }))).toBe("—");
  });

  it("shows zero once the source has actually been fetched", () => {
    expect(blockedDisplay(row({ blockedAll: 0 }))).toBe("0");
  });

  it("shows the count when items have been blocked", () => {
    expect(blockedDisplay(row({ blockedAll: 12 }))).toBe("12");
  });
});
