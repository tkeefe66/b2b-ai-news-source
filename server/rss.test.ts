import { describe, it, expect, vi, afterEach } from "vitest";

const query = vi.fn();
vi.mock("./db", () => ({ pool: { query: (...args: unknown[]) => query(...args) }, db: {} }));
vi.mock("./storage", () => ({ storage: {} }));

const { recordBlockedItem } = await import("./rss");

describe("recordBlockedItem", () => {
  // NOTE: reset runs in afterEach, not beforeEach — see task-2-report.md for why
  // (a beforeEach reset immediately preceding a rejected-mock test triggers a false
  // "unhandled error" failure in this Vitest version; afterEach avoids the same race
  // while providing identical test-to-test isolation).
  afterEach(() => query.mockReset());

  it("inserts the source, link, and tag", async () => {
    query.mockResolvedValue({ rows: [] });
    await recordBlockedItem(7, "https://example.com/post", "sponsored");

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("INSERT INTO source_blocked_items");
    expect(sql).toContain("ON CONFLICT");
    expect(params).toEqual([7, "https://example.com/post", "sponsored"]);
  });

  it("swallows database errors so instrumentation never breaks ingest", async () => {
    query.mockRejectedValue(new Error("connection reset"));
    await expect(recordBlockedItem(7, "https://example.com/post", "sponsored")).resolves.toBeUndefined();
  });
});
