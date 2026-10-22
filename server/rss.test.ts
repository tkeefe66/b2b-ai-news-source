import { describe, it, expect, vi, afterEach } from "vitest";

const query = vi.fn();
vi.mock("./db", () => ({ pool: { query: (...args: unknown[]) => query(...args) }, db: {} }));
vi.mock("./storage", () => ({ storage: {} }));

const { recordBlockedItem, checkAndRemoveFailingSources } = await import("./rss");

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

describe("checkAndRemoveFailingSources", () => {
  afterEach(() => query.mockReset());

  it("deactivates instead of deleting, before clearing the failure history", async () => {
    // Regression: DELETE FROM sources hit articles_source_id_sources_id_fk in prod.
    query.mockResolvedValueOnce({ rows: [{ source_id: 4, name: "Dead Feed", failure_days: 3 }] })
      .mockResolvedValue({ rows: [] });
    await expect(checkAndRemoveFailingSources()).resolves.toEqual(["Dead Feed"]);

    const sqls = query.mock.calls.map(([sql]) => String(sql));
    expect(sqls.some(sql => /DELETE FROM sources\b/.test(sql))).toBe(false);
    const deactivate = sqls.findIndex(sql => sql.includes("UPDATE sources SET is_active = false"));
    const clear = sqls.findIndex(sql => sql.includes("DELETE FROM source_fetch_failures"));
    expect(deactivate).toBeGreaterThan(0);
    expect(clear).toBeGreaterThan(deactivate);
    expect(query.mock.calls[deactivate][1]).toEqual([4]);
  });

  it("keeps the failure history when deactivation fails", async () => {
    query.mockResolvedValueOnce({ rows: [{ source_id: 4, name: "Dead Feed", failure_days: 3 }] })
      .mockRejectedValueOnce(new Error("connection reset"));
    await expect(checkAndRemoveFailingSources()).resolves.toEqual([]);
    expect(query.mock.calls.some(([sql]) => String(sql).includes("DELETE FROM source_fetch_failures"))).toBe(false);
  });
});
