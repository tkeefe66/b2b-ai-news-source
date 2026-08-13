# Source Report — Design

**Date:** 2026-08-12
**Status:** Approved, ready for planning

## Problem

The Sources page lists 105 feeds (94 active, 11 paused) as cards showing only a name,
category, and "Last fetched" timestamp. `lastFetchedAt` records that a fetch *ran*, not
that it *produced* anything — a feed returning an empty or stale window looks identical to
a healthy one. There is no way to see which sources are carrying the feed and which are
dead weight.

This was concrete during the Hacker News addition: two of four new feeds returned a full
window of items that were 118 and 189 days old. They ingested a stale backlog once and
then produced nothing, and nothing in the UI would have surfaced that.

## Goal

A ranked table of sources by article volume, with enough signal to decide "pause this",
"delete this", or "leave it alone" — and the ability to act on that decision in place.

## Scope

**In:** RSS/feed sources (`sources` rows where `feed_url NOT LIKE 'upload://%'`).

**Out, and why:**

- **NewsAPI articles.** `server/newsapi.ts:105` stamps `sourceId: null` and
  `sourceName: "NewsAPI: <name>"`. They belong to `newsapi_queries`, not `sources`, so a
  report joined on `sources` structurally cannot show them. NewsAPI queries stay managed
  in their own panel.
- **Uploaded documents.** They are `sources` rows (`feedUrl` prefixed `upload://`) but
  produce no feed articles. The Uploaded tab already separates them.
- **Charts, category rollups, trend sparklines.** Not needed to answer "what is producing
  content".

## Approach

Compute on request with one aggregate query. `sources LEFT JOIN` three grouped
subqueries. 106k articles grouped by an indexed `source_id` is tens of milliseconds, and
the tab is opened occasionally rather than polled.

**Rejected: denormalized counter columns on `sources`, incremented at ingest.** Faster
reads, but this codebase has already shipped and fixed exactly that bug —
`feed_tags.article_count` inflation, documented in CLAUDE.md. Counters drift; queries
don't.

**Rejected: materialized view with periodic refresh.** Premature at this row count, and
adds a staleness window to a number whose whole purpose is to be trusted.

## Data layer

`GET /api/sources/report` — read-only, no query params, sorting is client-side.

```sql
SELECT s.id, s.name, s.category, s.is_active, s.last_fetched_at,
       COALESCE(a.count_30d, 0)     AS count_30d,
       COALESCE(a.count_all, 0)     AS count_all,
       a.last_article_at,
       COALESCE(a.dismissed_all, 0) AS dismissed_all,
       COALESCE(b.blocked_all, 0)   AS blocked_all,
       COALESCE(f.failure_days, 0)  AS failure_days
FROM sources s
LEFT JOIN (SELECT source_id,
                  COUNT(*) FILTER (WHERE published_at >= NOW() - INTERVAL '30 days')::int AS count_30d,
                  COUNT(*)::int AS count_all,
                  MAX(published_at) AS last_article_at,
                  COUNT(*) FILTER (WHERE dismissed)::int AS dismissed_all
           FROM articles WHERE source_id IS NOT NULL GROUP BY source_id) a ON a.source_id = s.id
LEFT JOIN (SELECT source_id, COUNT(*)::int AS blocked_all
           FROM source_blocked_items GROUP BY source_id) b ON b.source_id = s.id
LEFT JOIN (SELECT source_id, COUNT(DISTINCT failed_date)::int AS failure_days
           FROM source_fetch_failures GROUP BY source_id) f ON f.source_id = s.id
WHERE s.feed_url NOT LIKE 'upload://%'
```

**Column semantics:**

| Field | Meaning |
|---|---|
| `count_30d` | Articles ingested with `published_at` in the last 30 days |
| `count_all` | Every article ever ingested from this source, **dismissed included** |
| `last_article_at` | `MAX(published_at)` — pins when a source went quiet |
| `dismissed_all` | All-time, no window. Rate is `dismissed_all / count_all` |
| `blocked_all` | All-time count of distinct items skipped for an admin-blocked tag |
| `failure_days` | Distinct days with a fetch failure; 3 triggers auto-removal |

Aggregation is by `source_id` (the FK), not `source_name`. The existing
`getDismissalPatterns` groups by the denormalized `source_name` string and pulls every
dismissed row into JS to count in a loop; the new endpoint counts in SQL. The old function
is not in this path and is left alone.

## Blocked instrumentation

`server/rss.ts:67` currently skips articles carrying an admin-blocked tag with a bare
`continue` — nothing records it. New table, modeled on `source_fetch_failures` (written
via raw SQL at runtime, mirrored in `shared/schema.ts` per the drop-trap rule):

```ts
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

The blocked branch records before it continues, `INSERT … ON CONFLICT DO NOTHING`, so the
same sponsored item reappearing every 30-minute cycle counts once. Wrapped in try/catch
like `recordFetchFailure` — instrumentation must never break ingest.

`link` is the dedupe key rather than `guid` because the ingest loop already guarantees
`item.link` is present, while `guid` is frequently absent.

Schema applied with `db:push` against the public proxy URL **before** the deploy.

**No backfill is possible.** Skipped articles were never recorded, so the column starts at
zero for every source. The UI renders `—` instead of `0` until a source has completed a
fetch cycle after ship, so an unobserved column is never misread as "no sponsored noise".

## UI

`client/src/components/source-report-tab.tsx` — a new file, following the
`feed-tags-tab.tsx` precedent rather than growing `sources.tsx` (already 3,536 lines).
Mounted as a fourth tab: Sources / Uploaded / Tags / Report. Query is `enabled` only when
the tab is active.

**Columns:** Source (with category), 30d, All, Last article, Dismissed (count + %),
Blocked, Status, Actions. Every header sorts; default is 30d descending.

**Filter chips:** All · Silent (0 in 30d) · Failing (`failure_days > 0`). "Silent" is the
view that answers the original question.

**Row treatment:** `last_article_at` renders relative ("2h ago", "May 3") with a warning
marker past 30 days. A source with `count_all = 0` shows `—` in the dismissal-rate column
rather than `0%`.

**Actions:** Pause is a switch reusing `PATCH /api/sources/:id`. Delete goes through the
existing `confirm-destructive` component, and the dialog states the real damage —
`storage.deleteSource` deletes the source's articles first, so removing a 156-article
source destroys 156 articles and the dialog says that number.

## Testing

Vitest covers `server/**` and `shared/**` with no database, so:

- **Blocked recording helper** (mocked pool): fires on a blocked tag, passes the correct
  `source_id` / `link` / `blocked_tag`, and swallows its own errors so a logging failure
  cannot break the fetch loop.
- **Pure derivations**, extracted out of the component so they are testable: the
  silent/failing classification and dismissal-rate formatting, including the
  `count_all = 0` case.

The SQL is verified by post-deploy smoke against production — no local runtime exists
(`.env` unreadable, dev server cannot boot). Gates before merge: `npm run check` at 0
errors, `npm run test` green, `npm run build` succeeds.

## Rollout

1. Add `sourceBlockedItems` to `shared/schema.ts`; apply with `db:push` via the public
   proxy URL, verifying the push plan proposes no drops.
2. Ship the ingest instrumentation and the endpoint.
3. Ship the tab.
4. Post-deploy smoke: `GET /api/sources/report` returns one row per feed source — 105 at
   time of writing, since production currently holds zero `upload://` rows, so the
   exclusion filter is untested by real data and should be confirmed against a seeded
   upload if one is ever added. The top rows should match known-busy sources, and the two
   live Hacker News feeds should show small non-zero 30d counts.

## Success criteria

Opening the Report tab and clicking "Silent" lists every source that produced nothing in
30 days, ordered so the worst offenders are visible without scrolling, with enough context
to pause or delete each one without leaving the tab.
