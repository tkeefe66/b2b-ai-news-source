---
name: adding-a-feed-source
description: Use when adding, editing, disabling, or removing a news source in DEFAULT_SOURCES (server/rss.ts), when a source stops returning articles or gets auto-removed, or when a feed's articles render with empty or garbage descriptions. Covers feed validation, hnrss.org and Google News query feeds, the seed-by-feedUrl rule, and ingest-side description cleanup.
---

# Adding a Feed Source

## Overview

Sources live in `DEFAULT_SOURCES` (`server/rss.ts`) and are copied into the `sources`
table at boot. **The seeder matches on `feedUrl` and only ever inserts** — it never
updates and never deletes. That one fact drives most of the rules below.

Adding a source is a code change only. No `db:push`, no migration.

## Where the wiring lives

| Concern | Location |
|---|---|
| Source list | `server/rss.ts` → `DEFAULT_SOURCES` |
| Boot seeding | `server/index.ts` (~line 330) — inserts any `feedUrl` not already in `sources` |
| Manual reseed | `POST /api/seed` (`server/routes.ts`) — same insert-only logic |
| Fetch + failure tracking | `server/rss.ts` → `fetchFeedArticles`, `checkAndRemoveFailingSources` |
| Item → article mapping | `server/ingest.ts` → `mapFeedItem` |
| Runtime CRUD | `POST/PATCH/DELETE /api/sources` |

## Validate the feed BEFORE writing the entry

```bash
curl -s --max-time 20 --retry 3 --retry-delay 5 --retry-all-errors "$FEED_URL" \
  | grep -o "<item>" | wc -l
```

`grep -c "<item>"` counts *lines* and returns 0 on the single-line RSS most feeds
serve. Use `grep -o | wc -l`.

Then check what the items actually carry — title, link, guid, and whether
`<description>` holds real prose or boilerplate. A feed that parses is not the
same as a feed worth ingesting.

## Entry shape

```ts
{
  name: "Hacker News - AI Agents",
  url: "https://news.ycombinator.com",              // site homepage, shown in UI
  feedUrl: "https://hnrss.org/newest?q=%22AI+agents%22&points=50",
  category: "AI",                                    // MUST be an existing category
  description: "Hacker News stories about AI agents that cleared 50 points.",
  isActive: true,                                    // false + trailing comment for dead feeds
}
```

**Valid categories** (`news_categories`, seeded in `server/index.ts`):
`GTM Tech`, `AI`, `B2B Mktg & Sales`, `CRM & Enterprise`, `Data & Analytics`,
`Industry Analysts`, `Deals & Markets`, `Technology`, `Company Tracker`.

`PATCH /api/sources/:id` validates category against that table; **seeding and
`POST /api/sources` do not**. A typo'd category seeds silently and its articles
never appear under any filter.

## Broad sites need a keyword-scoped feed, not their front page

Sites like Hacker News, Google News, and Reddit publish firehoses that are mostly
off-beat for a B2B GTM/AI aggregator. Scope them with a query feed and a traction
floor, the way the `Google News - X` block does:

- Google News: `https://news.google.com/rss/search?q=<query>&hl=en-US&gl=US&ceid=US:en`
- Hacker News: `https://hnrss.org/newest?q=<query>&points=<floor>` (URL-encode
  `"quoted phrases"` as `%22`)

hnrss.org 502s intermittently — retry before concluding a query is empty.

## Descriptions: check before you trust them

`mapFeedItem` fills `articles.description` from `contentSnippet`, falling back to
sanitized content. Aggregator feeds often put metadata there instead of prose;
hnrss serves `Article URL: … / Comments URL: … / Points: N / # Comments: N`, which
would render verbatim on cards. `stripHnBoilerplate` in `server/ingest.ts` removes
those lines, gated on the `Comments URL:` marker so no other feed is touched.

A new aggregator with its own boilerplate needs the same treatment: gate the
rewrite on a marker unique to that feed, and add a test proving other feeds are
unaffected.

## Verify an ingest change end-to-end

No local runtime exists (`.env` unreadable, dev server can't boot). To run a real
feed through `mapFeedItem`, use a throwaway `tsx` script — **at the project root**,
not the scratchpad, or `node_modules` won't resolve — and wrap the body in
`main()`, since tsx's CJS transform rejects top-level await:

```ts
import RSSParser from "rss-parser";
import { mapFeedItem, type FeedItemInput } from "./server/ingest";

async function main() {
  const feed = await new RSSParser().parseURL(process.argv[2]);
  for (const item of feed.items.slice(0, 3)) {
    console.log(JSON.stringify(mapFeedItem(item as FeedItemInput)));
  }
}
main();
```

Run with `npx tsx check.ts "$FEED_URL"`, then delete the file.

## What happens after the source lands

- **Dedupe is automatic.** Unique index on `(source_id, guid)`, plus a
  `getArticleByLink` fallback — an article syndicated to two sources inserts once.
- **Tags arrive empty.** Feeds without `<category>` elements map to `tags: []` →
  stored as `NULL` → the daily sweep AI-tags them. Nothing extra to wire.
- **Only the first 20 items per fetch** are considered.

## Failure handling and the edit trap

`checkAndRemoveFailingSources` **deletes** a source after 3 distinct days of fetch
failures. Any successful fetch clears the whole failure record, so intermittent
5xx is tolerated; a genuinely dead feed disappears from the DB while its
`DEFAULT_SOURCES` entry remains — and the next boot re-seeds it, restarting the
cycle. Mark dead feeds `isActive: false` with a trailing comment (`// 404`,
`// XML parse error`) rather than leaving them to churn.

**Editing a `feedUrl` does not update the existing row.** The seeder sees an
unrecognized URL and inserts a second source; the old one keeps fetching under the
old query. To change a feed URL: delete the old source (`DELETE /api/sources/:id`
or SQL against prod) in the same change that edits the constant.

## Common mistakes

| Mistake | Consequence |
|---|---|
| `grep -c "<item>"` to count items | Reports 0 on single-line RSS; a good feed looks dead |
| Category not in `news_categories` | Seeds silently, articles unreachable by filter |
| Editing `feedUrl` in place | Duplicate source; old query keeps running |
| Adding a firehose front page | Floods the feed with off-beat articles |
| Trusting `<description>` unseen | Boilerplate metadata renders on cards |
| Running the tsx check from the scratchpad | `Cannot find module 'rss-parser'` |
| Expecting a migration | There is none — `DEFAULT_SOURCES` + boot seed is the whole path |
