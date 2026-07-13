# Real-Time NewsAPI Tagging + Daily Sweep — Design

**Date:** 2026-07-13
**Status:** Approved by Tom (conversation)
**Context:** Tags are captured at ingest only from RSS `<category>` elements. NewsAPI articles (~90% of volume) arrive untagged; RSS articles from category-less feeds store `tags = []` (conflating "no info" with "examined, none fit"). The 90-day backfill covered history; nothing covers the future.

## Decisions

1. **Real-time NewsAPI tagging**: after each NewsAPI fetch cycle, one batched haiku pass (reusing `buildBackfillPrompt`/`parseBackfillResponse` from `server/tag-backfill.ts`) assigns tags from the pending+approved vocabulary to the cycle's newly inserted articles, then increments those tags' counts. Failures logged, non-blocking — articles stay `NULL` for the sweeper.
2. **NULL/[] semantics fix**: RSS ingest stores `tags = NULL` when the feed provided no categories (was `[]`). `[]` now always means "AI examined, nothing fits". Blocked-gate behavior unchanged (no categories → nothing to block on).
3. **Daily in-process sweep**: a server module sweeps `tags IS NULL` articles from the last 7 days (cap 5,000/run), tags them the same way, then recomputes ALL `feed_tags.article_count` wholesale (self-corrects any incremental drift). Runs ~2 minutes after boot (post-deploy catch-up) and every 24h thereafter — same `setInterval` idiom as the RSS scheduler in `server/index.ts`. Single-replica assumption, like Morning Brief's scheduler.
4. **NewsAPI content parity**: while in the file, `newsapi.ts` adopts the RSS path's content handling — `htmlToText` sanitize, 25,000-char cap (description keeps its 500 cap, sanitized). (NewsAPI truncates content server-side anyway; this is consistency, not expansion.)
5. **Backfill script untouched**: `script/backfill-tags.ts` stays as-is (proven, standalone CLI for manual catch-ups). The sweep module re-implements the small update loop against the app's own `db`/`storage` rather than sharing the script's pg-pool plumbing. Deviation from the earlier "script becomes thin CLI" phrasing — deliberate, avoids touching a proven one-off.

## Components

### `server/tag-sweep.ts` (new)
- `tagUntaggedArticles(articles: BackfillArticle[]): Promise<{tagged: number; empty: number; skipped: number}>` — loads vocabulary via storage, chunks by 25, one `chatCompletion` (haiku, maxTokens 4096, no jsonMode) per chunk via the existing prompt/parse helpers, writes `UPDATE articles SET tags=... WHERE id=... AND tags IS NULL` via a new storage method, calls `storage.incrementTagCounts(names)` per tagged article. Returns counts. Never throws for LLM/parse failures on a chunk (log + count as skipped); throws only on DB unavailability.
- `sweepRecentUntagged(): Promise<void>` — fetches `tags IS NULL AND published_at >= NOW()-'7 days'` capped 5,000 via storage, runs `tagUntaggedArticles`, then `storage.recomputeTagCounts()`, logs a one-line summary. Catches and logs everything (scheduler-safe).

### Storage additions (`server/storage.ts`)
- `getTagVocabulary(): Promise<string[]>` — feed_tags names where status IN ('pending','approved'), sorted.
- `getUntaggedRecentArticles(windowDays: number, cap: number): Promise<BackfillArticle[]>` — id/title/description/sourceName/category where `tags IS NULL` and `published_at >= NOW() - windowDays`.
- `setArticleTagsIfNull(id: number, tags: string[]): Promise<boolean>` — the guarded update; returns whether a row changed (so counts increment only on actual writes).
- `recomputeTagCounts(): Promise<number>` — the wholesale UPDATE...FROM unnest aggregate (same SQL as the backfill script's final step; also resets tags that lost all articles to 0 — use a LEFT JOIN form or a second UPDATE for names not in the aggregate).

### `server/newsapi.ts`
- Collect `storage.createArticle` results during the fetch loop; after all queries complete, call `tagUntaggedArticles(newRows)` inside try/catch (log-only on failure).
- Content: `htmlToText(item.content ?? "")` capped 25,000; description: `htmlToText(item.description ?? "")` capped 500 (empty → null).

### `server/rss.ts`
- `tags: mapped.tags.length > 0 ? mapped.tags.map(t => t.name) : null` in the InsertArticle build.

### `server/index.ts`
- After the existing schedulers: `setTimeout(sweep, 2min)` boot catch-up + `setInterval(sweep, 24h)`, both wrapped in the same log-and-continue error style as the RSS interval.

## Testing
- tsc 0; existing 112 tests stay green. The heavy pure logic (prompt/parse) is already tested in `tag-backfill.test.ts`. New unit tests only if a new pure function emerges (chunking assembly if extracted); effectful sweep verified at deploy smoke.
- Deploy smoke: after a NewsAPI cycle, new NewsAPI articles carry tags or `[]` (not NULL); boot log shows sweep summary line; `feed_tags` counts move.

## Cost
- Real-time: ≤160 new articles/cycle → ≤7 haiku calls per 4h NewsAPI cycle. Sweep: mostly no-op after real-time is live. Order of ~$1/day total.

## Out of scope
- Tagging older-than-90-day articles; re-tagging `[]` articles when vocabulary grows; multi-replica coordination.
