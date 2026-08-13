# Source Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Report tab to the Sources page listing every feed source ranked by article volume, with dismissed/blocked counts and inline pause/delete, so dead sources are visible and actionable.

**Architecture:** One aggregate SQL query joins `sources` against grouped subqueries over `articles`, a new `source_blocked_items` table, and the existing `source_fetch_failures`. No denormalized counters. Pure derivations (classification, rate formatting) live in `shared/source-report.ts` so they are unit-testable; the React component is presentation only.

**Tech Stack:** Express + Drizzle/`pg` (raw SQL via `pool.query` for the aggregate), React + TanStack Query + shadcn/ui, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-12-source-report-design.md`

## Global Constraints

- `npm run check` (tsc) must pass with **0 errors** — that is the baseline, not "no new errors".
- `npm run test` must stay green. `npm run build` must succeed before merging client changes.
- **No local runtime.** `.env` is unreadable and the dev server cannot boot. Never claim runtime verification locally; the gates are typecheck + tests + post-deploy smoke.
- Vitest only collects `server/**/*.test.ts` and `shared/**/*.test.ts`. Client code is not unit-tested here.
- Any DB object created at runtime MUST be mirrored in `shared/schema.ts` or `db:push` proposes dropping it.
- Test files importing anything that transitively imports `server/ai-models.ts` must `vi.mock` it before the import.
- Report covers feed sources only: `WHERE s.feed_url NOT LIKE 'upload://%'`. NewsAPI articles have `source_id IS NULL` and are structurally out of scope.
- Aggregate by `source_id` (the FK), never by the denormalized `source_name`.

---

## File Structure

| File | Responsibility |
|---|---|
| `shared/schema.ts` | Add `sourceBlockedItems` table model + `SourceReportRow` type |
| `shared/source-report.ts` | **New.** Pure derivations: `classifySource`, `dismissalRate`, `blockedDisplay` |
| `shared/source-report.test.ts` | **New.** Unit tests for the above |
| `server/ingest.ts` | Add `firstBlockedTag` pure helper |
| `server/ingest.test.ts` | Tests for `firstBlockedTag` |
| `server/rss.ts` | Add `recordBlockedItem`; call it in the blocked branch at line ~67 |
| `server/rss.test.ts` | **New.** `recordBlockedItem` writes correct params and swallows errors |
| `server/storage.ts` | Add `getSourceReport()` + `IStorage` entry |
| `server/routes.ts` | Add `GET /api/sources/report` |
| `client/src/components/source-report-tab.tsx` | **New.** The table, filters, sorting, actions |
| `client/src/pages/sources.tsx` | Register the fourth tab (3 small edits) |

---

### Task 1: Blocked-tag helper (`firstBlockedTag`)

Pure function that names which tag caused a skip. `server/rss.ts` currently only asks *whether* any tag is blocked; the report needs *which*.

**Files:**
- Modify: `server/ingest.ts`
- Test: `server/ingest.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `export function firstBlockedTag(statuses: Record<string, FeedTagStatus>): string | null` — returns the name of the first tag whose status is `"blocked"`, else `null`.

- [ ] **Step 1: Write the failing tests**

Append to `server/ingest.test.ts`:

```ts
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
```

Extend the existing import at the top of the file:

```ts
import { mapFeedItem, firstBlockedTag } from "./ingest";
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- server/ingest.test.ts`
Expected: FAIL — `firstBlockedTag is not a function`.

- [ ] **Step 3: Write the implementation**

Add to `server/ingest.ts` (import the type at the top: `import type { FeedTagStatus } from "@shared/schema";`):

```ts
// server/rss.ts only needs to know THAT a tag is blocked; the source report needs to know
// which one, so the skip can be attributed to a tag in source_blocked_items.
export function firstBlockedTag(statuses: Record<string, FeedTagStatus>): string | null {
  for (const [name, status] of Object.entries(statuses)) {
    if (status === "blocked") return name;
  }
  return null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- server/ingest.test.ts`
Expected: PASS, all cases green.

- [ ] **Step 5: Typecheck**

Run: `npm run check`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add server/ingest.ts server/ingest.test.ts
git commit -m "feat(ingest): add firstBlockedTag helper"
```

---

### Task 2: `source_blocked_items` schema + ingest instrumentation

**Files:**
- Modify: `shared/schema.ts` (after the `sourceFetchFailures` block, ~line 68)
- Modify: `server/rss.ts` (helper near `recordFetchFailure`; call site at the blocked branch ~line 67)
- Create: `server/rss.test.ts`

**Interfaces:**
- Consumes: `firstBlockedTag` from Task 1.
- Produces: `sourceBlockedItems` table model; `export async function recordBlockedItem(sourceId: number, link: string, blockedTag: string): Promise<void>` in `server/rss.ts`.

- [ ] **Step 1: Write the failing test**

Create `server/rss.test.ts`. `server/rss.ts` imports `./storage` and `./db`, both of which open real connections at import time, so mock both before importing:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const query = vi.fn();
vi.mock("./db", () => ({ pool: { query: (...args: unknown[]) => query(...args) }, db: {} }));
vi.mock("./storage", () => ({ storage: {} }));

const { recordBlockedItem } = await import("./rss");

describe("recordBlockedItem", () => {
  beforeEach(() => query.mockReset());

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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- server/rss.test.ts`
Expected: FAIL — `recordBlockedItem` is not exported.

- [ ] **Step 3: Model the table in `shared/schema.ts`**

Insert directly after the `sourceFetchFailures` definition:

```ts
// Runtime table used via raw SQL in server/rss.ts (per-source count of articles skipped
// for carrying an admin-blocked tag). Modeled here so drizzle-kit push does not drop it.
// Deduped on (source_id, link) so the same skipped item does not re-count every fetch cycle.
export const sourceBlockedItems = pgTable("source_blocked_items", {
  id: serial("id").primaryKey(),
  sourceId: integer("source_id").notNull().references(() => sources.id, { onDelete: "cascade" }),
  link: text("link").notNull(),
  blockedTag: text("blocked_tag").notNull(),
  blockedAt: timestamp("blocked_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (t) => ({
  sourceLinkUnique: unique("source_blocked_items_source_id_link_key").on(t.sourceId, t.link),
}));
```

All imports used here (`pgTable`, `serial`, `integer`, `text`, `timestamp`, `unique`, `sql`) are already imported at the top of `shared/schema.ts`.

- [ ] **Step 4: Write `recordBlockedItem` in `server/rss.ts`**

Add directly below `recordFetchFailure`:

```ts
async function _recordBlockedItem(sourceId: number, link: string, blockedTag: string): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO source_blocked_items (source_id, link, blocked_tag)
       VALUES ($1, $2, $3)
       ON CONFLICT (source_id, link) DO NOTHING`,
      [sourceId, link, blockedTag]
    );
  } catch (err) {
    console.error(`Failed to record blocked item for source ${sourceId}:`, err);
  }
}
export const recordBlockedItem = _recordBlockedItem;
```

(Exported so the test can drive it directly; `recordFetchFailure` stays private because nothing tests it.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test -- server/rss.test.ts`
Expected: PASS, both cases green.

- [ ] **Step 6: Wire it into the blocked branch**

In `fetchFeedArticles`, replace:

```ts
      const tagStatuses = await storage.upsertFeedTags(mapped.tags);
      if (Object.values(tagStatuses).includes("blocked")) {
        continue; // article carries an admin-blocked tag (e.g. "sponsored")
      }
```

with:

```ts
      const tagStatuses = await storage.upsertFeedTags(mapped.tags);
      const blockedTag = firstBlockedTag(tagStatuses);
      if (blockedTag) {
        // article carries an admin-blocked tag (e.g. "sponsored") — record it so the
        // source report can show how much noise this feed pushes, then skip
        await recordBlockedItem(sourceId, item.link, blockedTag);
        continue;
      }
```

Extend the existing ingest import at the top of `server/rss.ts`:

```ts
import { mapFeedItem, firstBlockedTag, type FeedItemInput } from "./ingest";
```

- [ ] **Step 7: Run the full suite and typecheck**

Run: `npm run test && npm run check`
Expected: all tests pass; tsc reports 0 errors.

- [ ] **Step 8: Commit**

```bash
git add shared/schema.ts server/rss.ts server/rss.test.ts
git commit -m "feat(sources): record admin-blocked ingest skips per source"
```

---

### Task 3: Pure report derivations

Everything the table needs to *decide* (status class, rate string) lives here so it can be tested without a browser.

**Files:**
- Create: `shared/source-report.ts`
- Create: `shared/source-report.test.ts`
- Modify: `shared/schema.ts` (append the `SourceReportRow` type)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `SourceReportRow` (in `shared/schema.ts`)
  - `classifySource(row: SourceReportRow): "failing" | "silent" | "producing"`
  - `dismissalRate(row: SourceReportRow): string` — `"38%"`, or `"—"` when `countAll === 0`
  - `blockedDisplay(row: SourceReportRow): string` — `"—"` when the source has never been fetched since instrumentation shipped, else the count

- [ ] **Step 1: Add the row type to `shared/schema.ts`**

Append at the end of the file:

```ts
// One row of GET /api/sources/report. Counts are per source_id; countAll includes
// dismissed articles, so the dismissal rate is dismissedAll / countAll.
export type SourceReportRow = {
  id: number;
  name: string;
  category: string;
  isActive: boolean;
  lastFetchedAt: string | null;
  count30d: number;
  countAll: number;
  lastArticleAt: string | null;
  dismissedAll: number;
  blockedAll: number;
  failureDays: number;
};
```

- [ ] **Step 2: Write the failing tests**

Create `shared/source-report.test.ts`:

```ts
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm run test -- shared/source-report.test.ts`
Expected: FAIL — cannot resolve `./source-report`.

- [ ] **Step 4: Write the implementation**

Create `shared/source-report.ts`:

```ts
import type { SourceReportRow } from "./schema";

export type SourceClass = "failing" | "silent" | "producing";

// Failing wins over silent: a feed that errors is a different problem from one that
// fetches cleanly and simply has nothing to say, and it needs a different fix.
export function classifySource(row: SourceReportRow): SourceClass {
  if (row.failureDays > 0) return "failing";
  if (row.count30d === 0) return "silent";
  return "producing";
}

export function dismissalRate(row: SourceReportRow): string {
  if (row.countAll === 0) return "—";
  return `${Math.round((row.dismissedAll / row.countAll) * 100)}%`;
}

// A zero blocked count is only meaningful once a fetch has actually run since the
// instrumentation shipped — before that, zero means "unobserved", not "clean".
export function blockedDisplay(row: SourceReportRow): string {
  if (row.blockedAll === 0 && row.lastFetchedAt === null) return "—";
  return String(row.blockedAll);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test -- shared/source-report.test.ts`
Expected: PASS, all nine cases green.

- [ ] **Step 6: Typecheck and commit**

Run: `npm run check` (expected: 0 errors), then:

```bash
git add shared/source-report.ts shared/source-report.test.ts shared/schema.ts
git commit -m "feat(sources): add pure source-report derivations"
```

---

### Task 4: Report query and endpoint

**Files:**
- Modify: `server/storage.ts` (add to `IStorage` near `getSourcesByCategory`, ~line 88; implement near the other raw-SQL aggregates)
- Modify: `server/routes.ts` (register **above** `app.get("/api/sources/:id"...)` if one exists, and above the `PATCH`/`DELETE` handlers, so `/report` is not captured as an `:id`)

**Interfaces:**
- Consumes: `SourceReportRow` from Task 3.
- Produces: `storage.getSourceReport(): Promise<SourceReportRow[]>`; `GET /api/sources/report` returning `SourceReportRow[]`.

- [ ] **Step 1: Add the interface entry**

In `server/storage.ts`, add to `IStorage` immediately after `getSourcesByCategory(): Promise<Record<string, string[]>>;`:

```ts
  getSourceReport(): Promise<SourceReportRow[]>;
```

Extend the existing `@shared/schema` type import in that file to include `SourceReportRow`.

- [ ] **Step 2: Implement the query**

Add the method to the storage class, alongside the other `pool.query` aggregates:

```ts
  async getSourceReport(): Promise<SourceReportRow[]> {
    const { rows } = await pool.query(`
      SELECT s.id, s.name, s.category, s.is_active, s.last_fetched_at,
             COALESCE(a.count_30d, 0)     AS count_30d,
             COALESCE(a.count_all, 0)     AS count_all,
             a.last_article_at,
             COALESCE(a.dismissed_all, 0) AS dismissed_all,
             COALESCE(b.blocked_all, 0)   AS blocked_all,
             COALESCE(f.failure_days, 0)  AS failure_days
      FROM sources s
      LEFT JOIN (
        SELECT source_id,
               COUNT(*) FILTER (WHERE published_at >= NOW() - INTERVAL '30 days')::int AS count_30d,
               COUNT(*)::int AS count_all,
               MAX(published_at) AS last_article_at,
               COUNT(*) FILTER (WHERE dismissed)::int AS dismissed_all
        FROM articles
        WHERE source_id IS NOT NULL
        GROUP BY source_id
      ) a ON a.source_id = s.id
      LEFT JOIN (
        SELECT source_id, COUNT(*)::int AS blocked_all
        FROM source_blocked_items GROUP BY source_id
      ) b ON b.source_id = s.id
      LEFT JOIN (
        SELECT source_id, COUNT(DISTINCT failed_date)::int AS failure_days
        FROM source_fetch_failures GROUP BY source_id
      ) f ON f.source_id = s.id
      WHERE s.feed_url NOT LIKE 'upload://%'
      ORDER BY count_30d DESC, count_all DESC, s.name ASC
    `);
    return rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      category: r.category,
      isActive: r.is_active,
      lastFetchedAt: r.last_fetched_at ? new Date(r.last_fetched_at).toISOString() : null,
      count30d: r.count_30d,
      countAll: r.count_all,
      lastArticleAt: r.last_article_at ? new Date(r.last_article_at).toISOString() : null,
      dismissedAll: r.dismissed_all,
      blockedAll: r.blocked_all,
      failureDays: r.failure_days,
    }));
  }
```

- [ ] **Step 3: Add the route**

In `server/routes.ts`, immediately after the existing `app.get("/api/sources", ...)` handler:

```ts
  app.get("/api/sources/report", async (_req, res) => {
    try {
      res.json(await storage.getSourceReport());
    } catch (err) {
      console.error("Error building source report:", err);
      res.status(500).json({ error: "Failed to build source report" });
    }
  });
```

Confirm no `app.get("/api/sources/:id")` is registered before this line — Express matches in registration order, and an earlier `:id` route would swallow `/report`. Run:

```bash
grep -n 'app.get("/api/sources' server/routes.ts
```

If a `:id` GET route exists above, move the `/report` registration above it.

- [ ] **Step 4: Typecheck and run the suite**

Run: `npm run check && npm run test`
Expected: 0 tsc errors; all tests pass. (The SQL itself is unverifiable locally — no runtime — and is covered by the smoke in Task 6.)

- [ ] **Step 5: Commit**

```bash
git add server/storage.ts server/routes.ts
git commit -m "feat(sources): add GET /api/sources/report aggregate"
```

---

### Task 5: Report tab UI

**Files:**
- Create: `client/src/components/source-report-tab.tsx`
- Modify: `client/src/pages/sources.tsx` (three edits: the `activeTab` union at line ~3409, the `Tabs onValueChange` cast at ~3448, the `TabsList` at ~3462, and the render branch at ~3531)

**Interfaces:**
- Consumes: `GET /api/sources/report`; `SourceReportRow` from `@shared/schema`; `classifySource`, `dismissalRate`, `blockedDisplay` from `@shared/source-report`.
- Produces: `export default function SourceReportTab()`.

- [ ] **Step 1: Create the component**

Create `client/src/components/source-report-tab.tsx`:

```tsx
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ConfirmDestructive } from "@/components/confirm-destructive";
import { AlertTriangle, Trash2 } from "lucide-react";
import type { SourceReportRow } from "@shared/schema";
import { classifySource, dismissalRate, blockedDisplay } from "@shared/source-report";

type Filter = "all" | "silent" | "failing";
type SortKey = "name" | "count30d" | "countAll" | "lastArticleAt" | "dismissedAll" | "blockedAll";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "silent", label: "Silent" },
  { value: "failing", label: "Failing" },
];

function relativeDate(iso: string | null): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  const hours = (Date.now() - then) / 36e5;
  if (hours < 1) return "just now";
  if (hours < 24) return `${Math.floor(hours)}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function isStale(iso: string | null): boolean {
  if (!iso) return true;
  return Date.now() - new Date(iso).getTime() > 30 * 24 * 36e5;
}

function sortRows(rows: SourceReportRow[], key: SortKey, desc: boolean): SourceReportRow[] {
  const dir = desc ? -1 : 1;
  return [...rows].sort((a, b) => {
    if (key === "name") return a.name.localeCompare(b.name) * dir;
    if (key === "lastArticleAt") {
      const av = a.lastArticleAt ? new Date(a.lastArticleAt).getTime() : 0;
      const bv = b.lastArticleAt ? new Date(b.lastArticleAt).getTime() : 0;
      return (av - bv) * dir;
    }
    return ((a[key] as number) - (b[key] as number)) * dir;
  });
}

export default function SourceReportTab() {
  const [filter, setFilter] = useState<Filter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("count30d");
  const [sortDesc, setSortDesc] = useState(true);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const reportQuery = useQuery<SourceReportRow[]>({ queryKey: ["/api/sources/report"] });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/sources/report"] });
    queryClient.invalidateQueries({ queryKey: ["/api/sources"] });
  };

  const pauseMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: number; isActive: boolean }) => {
      await apiRequest("PATCH", `/api/sources/${id}`, { isActive });
    },
    onSuccess: invalidate,
    onError: () => toast({ title: "Could not update source", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/sources/${id}`);
    },
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["/api/articles"] });
      toast({ title: "Source deleted" });
    },
    onError: () => toast({ title: "Could not delete source", variant: "destructive" }),
  });

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) { setSortDesc(!sortDesc); return; }
    setSortKey(key);
    setSortDesc(key !== "name");
  };

  if (reportQuery.isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    );
  }

  if (reportQuery.isError) {
    return <p className="text-sm text-destructive">Could not load the source report. Try again.</p>;
  }

  const all = reportQuery.data ?? [];
  const filtered = filter === "all" ? all : all.filter((r) => classifySource(r) === filter);
  const rows = sortRows(filtered, sortKey, sortDesc);
  const silentCount = all.filter((r) => classifySource(r) === "silent").length;

  const header = (key: SortKey, label: string, className = "") => (
    <TableHead className={className}>
      <button
        className="hover:underline"
        onClick={() => toggleSort(key)}
        data-testid={`sort-${key}`}
      >
        {label}{sortKey === key ? (sortDesc ? " ↓" : " ↑") : ""}
      </button>
    </TableHead>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {FILTERS.map((f) => (
          <Button
            key={f.value}
            size="sm"
            variant={filter === f.value ? "default" : "outline"}
            onClick={() => setFilter(f.value)}
            data-testid={`filter-${f.value}`}
          >
            {f.label}
          </Button>
        ))}
        <span className="text-xs text-muted-foreground ml-1">
          {all.length} sources · {silentCount} silent in 30d
        </span>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            {header("name", "Source")}
            {header("count30d", "30d", "text-right")}
            {header("countAll", "All", "text-right")}
            {header("lastArticleAt", "Last article")}
            {header("dismissedAll", "Dismissed", "text-right")}
            {header("blockedAll", "Blocked", "text-right")}
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id} data-testid={`report-row-${r.id}`}>
              <TableCell>
                <div className="flex items-center gap-2">
                  <span className={r.isActive ? "" : "text-muted-foreground line-through"}>{r.name}</span>
                  <Badge variant="secondary" className="text-[10px]">{r.category}</Badge>
                  {r.failureDays > 0 && (
                    <span className="flex items-center gap-1 text-xs text-destructive">
                      <AlertTriangle className="h-3 w-3" />
                      {r.failureDays}d failing
                    </span>
                  )}
                </div>
              </TableCell>
              <TableCell className="text-right tabular-nums">{r.count30d}</TableCell>
              <TableCell className="text-right tabular-nums">{r.countAll}</TableCell>
              <TableCell className={isStale(r.lastArticleAt) ? "text-muted-foreground" : ""}>
                {relativeDate(r.lastArticleAt)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {r.dismissedAll} <span className="text-muted-foreground">{dismissalRate(r)}</span>
              </TableCell>
              <TableCell className="text-right tabular-nums">{blockedDisplay(r)}</TableCell>
              <TableCell>
                <div className="flex items-center justify-end gap-2">
                  <Switch
                    checked={r.isActive}
                    onCheckedChange={(checked) => pauseMutation.mutate({ id: r.id, isActive: checked })}
                    aria-label={r.isActive ? `Pause ${r.name}` : `Resume ${r.name}`}
                  />
                  <ConfirmDestructive
                    title={`Delete "${r.name}"?`}
                    description={
                      r.countAll > 0
                        ? `This deletes the source and all ${r.countAll} of its articles. This can't be undone.`
                        : "This deletes the source. It has no articles. This can't be undone."
                    }
                    confirmLabel="Delete source"
                    onConfirm={() => deleteMutation.mutate(r.id)}
                  >
                    <Button variant="ghost" size="icon" aria-label={`Delete ${r.name}`}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </ConfirmDestructive>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {rows.length === 0 && (
        <p className="text-sm text-muted-foreground">No sources match this filter.</p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Register the tab in `sources.tsx`**

Four edits, all mechanical:

1. Import, next to the existing `FeedTagsTab` import (line ~35):

```tsx
import SourceReportTab from "@/components/source-report-tab";
```

2. Widen the state union (line ~3409):

```tsx
  const [activeTab, setActiveTab] = useState<"sources" | "uploaded" | "tags" | "report">("sources");
```

3. Widen the cast (line ~3448):

```tsx
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "sources" | "uploaded" | "tags" | "report")}>
```

4. Add the trigger after the `tags` trigger (line ~3462), and the render branch. The existing chain ends with `) : (<FeedTagsTab />)`; change that tail to branch on `tags` explicitly:

```tsx
            <TabsTrigger value="report" data-testid="tab-source-report">
              Report
            </TabsTrigger>
```

```tsx
        ) : activeTab === "tags" ? (
          <FeedTagsTab />
        ) : (
          <SourceReportTab />
        )}
```

- [ ] **Step 3: Verify the query key resolves**

`useQuery` here relies on the project's default query function deriving the URL from `queryKey`. Confirm that is how `FeedTagsTab` works:

```bash
grep -n "queryKey" client/src/components/feed-tags-tab.tsx | head -3
grep -n "queryFn\|defaultOptions" client/src/lib/queryClient.ts | head -10
```

If the default query function does **not** fetch from the key, add an explicit `queryFn` to `reportQuery` matching the pattern `feed-tags-tab.tsx` uses.

- [ ] **Step 4: Typecheck and build**

Run: `npm run check && npm run build`
Expected: 0 tsc errors; build succeeds.

- [ ] **Step 5: Run the full suite**

Run: `npm run test`
Expected: all tests pass (no client tests exist; this confirms nothing regressed).

- [ ] **Step 6: Commit**

```bash
git add client/src/components/source-report-tab.tsx client/src/pages/sources.tsx
git commit -m "feat(sources): add Report tab ranking sources by volume"
```

---

### Task 6: Schema push, deploy, and production smoke

**Files:** none — this task is operational. **Read `.claude/skills/adding-a-feed-source/SKILL.md` and the Deploys section of `CLAUDE.md` before starting.**

- [ ] **Step 1: Apply the schema to production FIRST**

The table must exist before the new ingest code runs. From an interactive terminal:

```bash
DATABASE_URL="$(railway variables --service Postgres --kv | grep '^DATABASE_PUBLIC_URL=' | cut -d= -f2-)" npm run db:push
```

Read the push plan. Expected: it creates `source_blocked_items`. **Any unexpected DROP → abort and reconcile `shared/schema.ts`.** Never accept a drop you can't explain.

- [ ] **Step 2: Confirm the deploy target**

```bash
railway status
```

Expected: project **B2B AI News**, service **B2B AI News**, environment production.

- [ ] **Step 3: Deploy**

```bash
git push origin main
```

- [ ] **Step 4: Watch the deploy to a terminal state**

```bash
for i in $(seq 1 24); do
  S=$(railway deployment list --service "B2B AI News" --limit 1 --json \
      | python3 -c "import json,sys; d=json.load(sys.stdin)[0]; print(d['status'], (d.get('meta') or {}).get('commitHash','?')[:7])")
  echo "poll $i: $S"
  case "$S" in SUCCESS*|FAILED*|CRASHED*) break;; *) sleep 30;; esac
done
```

Run this as a background task — foreground `sleep` is blocked. On `FAILED`/`CRASHED`, read `railway logs --service "B2B AI News" --build`.

- [ ] **Step 5: Smoke the endpoint**

```bash
curl -s "https://b2b-ai-news-production.up.railway.app/api/sources/report" | python3 -c "
import json,sys
rows = json.load(sys.stdin)
print('rows:', len(rows))
for r in rows[:5]:
    print(f\"  {r['name'][:34]:34s} 30d={r['count30d']:4d} all={r['countAll']:5d} dis={r['dismissedAll']:4d} blocked={r['blockedAll']}\")
print('silent (0 in 30d):', sum(1 for r in rows if r['count30d'] == 0))
"
```

Expected: one row per feed source (105 at time of writing), top rows are known-busy sources with large 30d counts, and `Hacker News - LLMs` / `Hacker News - AI Agents` appear with small non-zero 30d counts. Every `blockedAll` is 0 — the instrumentation has no history yet.

- [ ] **Step 6: Confirm the blocked counter is live**

After the next fetch cycle (RSS refreshes every 30 minutes), verify the table exists and is writable:

```bash
railway logs --service "B2B AI News" | grep -i "Failed to record blocked item" | tail -5
```

Expected: no output. Any hits mean the table is missing or misnamed — check Step 1 actually applied.

- [ ] **Step 7: Confirm the tab renders**

Open https://b2b-ai-news-production.up.railway.app, go to Sources → Report. Verify: the table populates, clicking a header re-sorts, "Silent" filters to zero-30d sources, and a delete dialog names the correct article count. **Do not confirm a delete during smoke testing.**

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| Aggregate query, no denormalized counters | 4 |
| Exclude `upload://` sources | 4 (SQL `WHERE`) |
| Exclude NewsAPI (`source_id IS NULL`) | 4 (subquery `WHERE`) |
| `source_blocked_items` table, mirrored in schema | 2 |
| Dedupe blocked items by `(source_id, link)` | 2 |
| Instrumentation never breaks ingest | 2 (try/catch + test) |
| Blocked column reads `—` when unobserved | 3 (`blockedDisplay`) |
| 30d / all-time / last-article columns | 4, 5 |
| Dismissed count + rate, all-time | 3, 4, 5 |
| Fetch-failure signal | 4 (`failureDays`), 5 (badge) |
| Fourth tab, own component file | 5 |
| Sortable headers, default 30d desc | 5 |
| All / Silent / Failing filters | 5 |
| Pause inline | 5 |
| Delete behind confirm, states article count | 5 |
| Unit tests for pure derivations | 3 |
| Unit tests for blocked recorder | 2 |
| `db:push` before deploy, verify no drops | 6 |
| Post-deploy smoke | 6 |

No gaps.

**Placeholder scan:** No TBDs. Every code step carries real code. Two steps ask the implementer to `grep` and branch (route ordering in Task 4 Step 3, query-fn convention in Task 5 Step 3) — both state the exact command and the exact fix for each outcome, so neither is a deferred decision.

**Type consistency:** `SourceReportRow` is defined once in `shared/schema.ts` (Task 3) and consumed by `getSourceReport` (Task 4) and the component (Task 5) with identical camelCase field names. `firstBlockedTag` (Task 1) is consumed in Task 2 with the signature it produces. `classifySource` / `dismissalRate` / `blockedDisplay` are defined in Task 3 and used in Task 5 under those exact names. The SQL returns snake_case and the storage method maps it to camelCase in one place.
