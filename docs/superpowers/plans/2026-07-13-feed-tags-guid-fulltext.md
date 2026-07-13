# Feed Tags + GUID Dedup + Full-Text Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ingest per-article tags from RSS `<category>` elements behind an admin-moderated allowlist, dedupe articles by feed GUID with link fallback, and store sanitized full-text article content.

**Architecture:** New `feed_tags` table holds every tag ever seen with a moderation status (`pending | approved | rejected | blocked`). Ingest stores all normalized tags on each article but the UI only surfaces approved ones; a `blocked` tag causes the whole article to be skipped at ingest. Articles gain a `guid` column with a DB-level unique index `(source_id, guid)` backstopping app-level dedup; existing rows get their guid backfilled lazily when re-matched by link. Full article HTML is stripped to plain text via `sanitize-html` and stored up to 25,000 chars; every existing AI-prompt consumer of `article.content` gets an explicit 2,000-char cap so prompt costs don't change.

**Tech Stack:** TypeScript, Express, Drizzle ORM (Postgres), rss-parser, sanitize-html (new dep), vitest, React + wouter + @tanstack/react-query + shadcn/ui.

## Global Constraints

- Schema changes apply via `npm run db:push` (drizzle-kit push) — this repo has NO versioned migration files; do not create a `migrations/` directory.
- `npm run check` (tsc) must pass with 0 errors after every task — the baseline is 0 errors.
- Tests are vitest, run with `npm run test`; test files must match `server/**/*.test.ts` or `shared/**/*.test.ts` (see `vitest.config.ts`). There is no client-side test runner — client tasks are verified in the browser.
- API endpoints are unauthenticated, matching every existing `/api/*` route. Do not add auth.
- Existing behavior that must NOT change: 20-item-per-fetch cap (`slice(0, 20)`), image extraction, author handling, publishedAt handling, the 3-day auto-remove of failing sources.
- Tag limits: max 6 tags per article, max 40 chars per tag (post-normalization).
- Content caps: stored `content` ≤ 25,000 chars (plain text); stored `description` ≤ 500 chars; AI-prompt call sites cap `content` at 2,000 chars.
- Follow existing code style: no semicolter changes, plain `app.get(...)` route handlers with try/catch, `data-testid` attributes on interactive client elements.

## File Structure

- `shared/schema.ts` — add `guid` + `tags` columns to `articles`, add `feedTags` table + types (modify)
- `server/tags.ts` — tag normalization pure functions (create)
- `server/tags.test.ts` — tests for normalization (create)
- `server/sanitize.ts` — HTML→text conversion (create)
- `server/sanitize.test.ts` — tests for sanitization (create)
- `server/ingest.ts` — pure feed-item→article mapping (create)
- `server/ingest.test.ts` — tests for mapping (create)
- `server/storage.ts` — feed-tag CRUD, guid lookup/backfill, tag filter (modify)
- `server/rss.ts` — rewire `fetchFeedArticles` to use mapping + tag gate + guid dedup (modify)
- `server/routes.ts` — feed-tag endpoints, tag filter param, filters payload (modify)
- `client/src/components/feed-tags-tab.tsx` — admin moderation UI (create)
- `client/src/pages/sources.tsx` — mount the new tab (modify)
- `client/src/pages/news-feed.tsx` — tag filter + tag chips (modify)

---

### Task 1: Schema — guid, tags, unique index, feed_tags table

**Files:**
- Modify: `shared/schema.ts` (articles table at `:26-42`; add feedTags near other tables; types near `:83-92` and `:147-150`)

**Interfaces:**
- Consumes: existing `articles`, `sources` tables.
- Produces: `articles.guid: text | null`, `articles.tags: string[] | null`, unique index `articles_source_guid_idx` on `(source_id, guid)`; table `feedTags` with type `FeedTag`; `FEED_TAG_STATUSES` const and `FeedTagStatus` type; `insertFeedTagSchema`. Later tasks import `feedTags`, `FeedTag`, `FEED_TAG_STATUSES`, `FeedTagStatus` from `@shared/schema`.

- [ ] **Step 1: Add columns + index to `articles`**

In `shared/schema.ts`, add two columns to the `articles` table and a table-level unique index. Import `uniqueIndex` from `drizzle-orm/pg-core` (add to the existing import). The table gets a third argument:

```ts
export const articles = pgTable("articles", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  link: text("link").notNull(),
  description: text("description"),
  content: text("content"),
  author: text("author"),
  publishedAt: timestamp("published_at"),
  sourceId: integer("source_id").references(() => sources.id),
  sourceName: text("source_name"),
  category: text("category"),
  imageUrl: text("image_url"),
  isRead: boolean("is_read").default(false).notNull(),
  dismissed: boolean("dismissed").default(false).notNull(),
  dismissedAt: timestamp("dismissed_at"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  guid: text("guid"),
  tags: text("tags").array(),
}, (t) => ({
  sourceGuidIdx: uniqueIndex("articles_source_guid_idx").on(t.sourceId, t.guid),
}));
```

(Postgres unique indexes ignore NULLs, so existing rows with `guid IS NULL` are unaffected. If this drizzle-orm version expects the third arg to return an array instead of an object, use `(t) => [uniqueIndex("articles_source_guid_idx").on(t.sourceId, t.guid)]` — check which form compiles.)

- [ ] **Step 2: Add the `feedTags` table + types**

Add after the `sources`/`articles` definitions (import `integer` is already used in the file):

```ts
export const FEED_TAG_STATUSES = ["pending", "approved", "rejected", "blocked"] as const;
export type FeedTagStatus = (typeof FEED_TAG_STATUSES)[number];

export const feedTags = pgTable("feed_tags", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  displayName: text("display_name").notNull(),
  status: text("status").default("pending").notNull(),
  articleCount: integer("article_count").default(0).notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  reviewedAt: timestamp("reviewed_at"),
});
```

Next to the other insert schemas / types add:

```ts
export const insertFeedTagSchema = createInsertSchema(feedTags).omit({
  id: true,
  createdAt: true,
  reviewedAt: true,
});
export type FeedTag = typeof feedTags.$inferSelect;
export type InsertFeedTag = z.infer<typeof insertFeedTagSchema>;
```

`insertArticleSchema` already derives from the table, so `guid`/`tags` flow into `InsertArticle` automatically — no change needed there.

- [ ] **Step 3: Typecheck**

Run: `npm run check`
Expected: 0 errors.

- [ ] **Step 4: Push schema**

Run: `npm run db:push`
Expected: drizzle-kit reports adding `guid`, `tags` columns, the unique index, and the `feed_tags` table, then applies cleanly. If it prompts interactively about the new columns, choose "add column" (they're new, no renames).

- [ ] **Step 5: Commit**

```bash
git add shared/schema.ts
git commit -m "feat: add article guid/tags columns and feed_tags moderation table"
```

---

### Task 2: Tag normalization module

**Files:**
- Create: `server/tags.ts`
- Test: `server/tags.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `normalizeTag(raw: string): string | null` and `extractTags(categories: unknown): { name: string; displayName: string }[]` — imported by `server/ingest.ts` (Task 4).

- [ ] **Step 1: Write the failing tests**

Create `server/tags.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/tags.test.ts`
Expected: FAIL — cannot resolve `./tags`.

- [ ] **Step 3: Implement**

Create `server/tags.ts`:

```ts
const MAX_TAG_LENGTH = 40;
const MAX_TAGS_PER_ARTICLE = 6;
const DENYLIST = new Set(["uncategorized", "news", "general"]);

export function normalizeTag(raw: string): string | null {
  const normalized = raw.trim().replace(/\s+/g, " ").toLowerCase();
  if (!normalized) return null;
  if (normalized.length > MAX_TAG_LENGTH) return null;
  if (/^\d+$/.test(normalized)) return null;
  if (DENYLIST.has(normalized)) return null;
  return normalized;
}

export function extractTags(categories: unknown): { name: string; displayName: string }[] {
  if (!Array.isArray(categories)) return [];
  const seen = new Map<string, string>();
  for (const raw of categories) {
    if (typeof raw !== "string") continue;
    const name = normalizeTag(raw);
    if (!name || seen.has(name)) continue;
    seen.set(name, raw.trim().replace(/\s+/g, " "));
    if (seen.size >= MAX_TAGS_PER_ARTICLE) break;
  }
  return Array.from(seen, ([name, displayName]) => ({ name, displayName }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/tags.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add server/tags.ts server/tags.test.ts
git commit -m "feat: add feed tag normalization module"
```

---

### Task 3: HTML sanitizer

**Files:**
- Create: `server/sanitize.ts`
- Test: `server/sanitize.test.ts`
- Modify: `package.json` (new dependency)

**Interfaces:**
- Consumes: `sanitize-html` npm package.
- Produces: `htmlToText(html: string): string` — imported by `server/ingest.ts` (Task 4).

- [ ] **Step 1: Install the dependency**

Run: `npm install sanitize-html && npm install -D @types/sanitize-html`
Expected: both added to package.json without errors.

- [ ] **Step 2: Write the failing tests**

Create `server/sanitize.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { htmlToText } from "./sanitize";

describe("htmlToText", () => {
  it("strips tags to plain text", () => {
    expect(htmlToText("<p>Hello <b>world</b></p>")).toBe("Hello world");
  });
  it("preserves paragraph breaks as newlines", () => {
    expect(htmlToText("<p>One</p><p>Two</p>")).toBe("One\nTwo");
  });
  it("converts <br> to newline", () => {
    expect(htmlToText("line1<br/>line2")).toBe("line1\nline2");
  });
  it("removes scripts, styles, and images entirely", () => {
    expect(htmlToText('<script>alert(1)</script><img src="x.gif">text')).toBe("text");
  });
  it("decodes common HTML entities", () => {
    expect(htmlToText("<p>Fish &amp; Chips &lt;3 &quot;quoted&quot; it&#39;s&nbsp;here</p>")).toBe(
      'Fish & Chips <3 "quoted" it\'s here'
    );
  });
  it("collapses whitespace runs and newline runs to single separators", () => {
    expect(htmlToText("<p>a   b</p>\n\n\n<p>c</p>")).toBe("a b\nc");
  });
  it("returns empty string for empty/whitespace input", () => {
    expect(htmlToText("")).toBe("");
    expect(htmlToText("   ")).toBe("");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run server/sanitize.test.ts`
Expected: FAIL — cannot resolve `./sanitize`.

- [ ] **Step 4: Implement**

Create `server/sanitize.ts`:

```ts
import sanitizeHtml from "sanitize-html";

const BLOCK_BOUNDARY = /<\/(?:p|div|h[1-6]|li|blockquote|tr|section|article)>|<br\s*\/?>/gi;

export function htmlToText(html: string): string {
  const withBreaks = html.replace(BLOCK_BOUNDARY, (m) => `${m}\n`);
  const stripped = sanitizeHtml(withBreaks, { allowedTags: [], allowedAttributes: {} });
  return stripped
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, "&") // decode ampersand LAST to avoid double-decoding
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}
```

(sanitize-html removes `<script>`/`<style>` content entirely by default and HTML-escapes its text output, which is why the entity decode pass comes after stripping.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run server/sanitize.test.ts`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add server/sanitize.ts server/sanitize.test.ts package.json package-lock.json
git commit -m "feat: add HTML-to-text sanitizer for feed content"
```

---

### Task 4: Feed-item mapping module

**Files:**
- Create: `server/ingest.ts`
- Test: `server/ingest.test.ts`

**Interfaces:**
- Consumes: `extractTags` from `./tags`, `htmlToText` from `./sanitize`.
- Produces: `mapFeedItem(item: FeedItemInput): MappedItem` and the `FeedItemInput` / `MappedItem` types — imported by `server/rss.ts` (Task 6). `MappedItem` is `{ guid: string | null; tags: { name: string; displayName: string }[]; description: string | null; content: string | null }`.

- [ ] **Step 1: Write the failing tests**

Create `server/ingest.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/ingest.test.ts`
Expected: FAIL — cannot resolve `./ingest`.

- [ ] **Step 3: Implement**

Create `server/ingest.ts`:

```ts
import { extractTags } from "./tags";
import { htmlToText } from "./sanitize";

const CONTENT_MAX = 25000;
const DESCRIPTION_MAX = 500;
const GUID_MAX = 500;

export interface FeedItemInput {
  guid?: string;
  categories?: unknown;
  content?: string;
  contentSnippet?: string;
  ["content:encoded"]?: string;
}

export interface MappedItem {
  guid: string | null;
  tags: { name: string; displayName: string }[];
  description: string | null;
  content: string | null;
}

export function mapFeedItem(item: FeedItemInput): MappedItem {
  const guid =
    typeof item.guid === "string" && item.guid.trim() && item.guid.length <= GUID_MAX
      ? item.guid.trim()
      : null;

  const rawHtml = item["content:encoded"] || item.content || "";
  const text = rawHtml ? htmlToText(rawHtml) : "";
  const content = text ? text.substring(0, CONTENT_MAX) : null;

  const snippet = (item.contentSnippet || text).trim();
  const description = snippet ? snippet.substring(0, DESCRIPTION_MAX) : null;

  return { guid, tags: extractTags(item.categories), description, content };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/ingest.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add server/ingest.ts server/ingest.test.ts
git commit -m "feat: add pure feed-item mapping (guid, tags, sanitized full text)"
```

---

### Task 5: Storage methods

**Files:**
- Modify: `server/storage.ts` (interface at `:46-70`, `DatabaseStorage` class at `:227+`, `ArticleFilters` at `:34-44`, `getFilteredArticles` at `:260-313`)

**Interfaces:**
- Consumes: `feedTags`, `FeedTag`, `FeedTagStatus` from `@shared/schema` (Task 1).
- Produces (used by Tasks 6-7):
  - `getArticleByGuid(sourceId: number, guid: string): Promise<Article | undefined>`
  - `setArticleGuid(id: number, guid: string): Promise<void>`
  - `upsertFeedTags(tags: { name: string; displayName: string }[]): Promise<Record<string, FeedTagStatus>>`
  - `getFeedTags(status?: FeedTagStatus): Promise<FeedTag[]>`
  - `updateFeedTagStatus(id: number, status: FeedTagStatus): Promise<FeedTag | undefined>`
  - `getApprovedTagNames(): Promise<string[]>`
  - `ArticleFilters` gains optional `tag?: string`

- [ ] **Step 1: Extend imports, `ArticleFilters`, and the `IStorage` interface**

Add `feedTags` and types to the existing `@shared/schema` import; add `arrayContains`, `asc`, `desc` to the drizzle-orm import if not already present. Add `tag?: string;` to `ArticleFilters`. Add to `IStorage`:

```ts
getArticleByGuid(sourceId: number, guid: string): Promise<Article | undefined>;
setArticleGuid(id: number, guid: string): Promise<void>;
upsertFeedTags(tags: { name: string; displayName: string }[]): Promise<Record<string, FeedTagStatus>>;
getFeedTags(status?: FeedTagStatus): Promise<FeedTag[]>;
updateFeedTagStatus(id: number, status: FeedTagStatus): Promise<FeedTag | undefined>;
getApprovedTagNames(): Promise<string[]>;
```

- [ ] **Step 2: Implement in `DatabaseStorage`**

Add methods (place near `getArticleByLink` / the other article methods):

```ts
async getArticleByGuid(sourceId: number, guid: string): Promise<Article | undefined> {
  const [article] = await db
    .select()
    .from(articles)
    .where(and(eq(articles.sourceId, sourceId), eq(articles.guid, guid)));
  return article;
}

async setArticleGuid(id: number, guid: string): Promise<void> {
  await db.update(articles).set({ guid }).where(eq(articles.id, id));
}

async upsertFeedTags(
  tags: { name: string; displayName: string }[]
): Promise<Record<string, FeedTagStatus>> {
  if (tags.length === 0) return {};
  const rows = await db
    .insert(feedTags)
    .values(tags.map((t) => ({ name: t.name, displayName: t.displayName, articleCount: 1 })))
    .onConflictDoUpdate({
      target: feedTags.name,
      set: { articleCount: sql`${feedTags.articleCount} + 1` },
    })
    .returning();
  return Object.fromEntries(rows.map((r) => [r.name, r.status as FeedTagStatus]));
}

async getFeedTags(status?: FeedTagStatus): Promise<FeedTag[]> {
  const query = db.select().from(feedTags);
  const rows = status ? await query.where(eq(feedTags.status, status)) : await query;
  return rows.sort((a, b) => b.articleCount - a.articleCount);
}

async updateFeedTagStatus(id: number, status: FeedTagStatus): Promise<FeedTag | undefined> {
  const [updated] = await db
    .update(feedTags)
    .set({ status, reviewedAt: new Date() })
    .where(eq(feedTags.id, id))
    .returning();
  return updated;
}

async getApprovedTagNames(): Promise<string[]> {
  const rows = await db
    .select({ name: feedTags.name })
    .from(feedTags)
    .where(eq(feedTags.status, "approved"));
  return rows.map((r) => r.name).sort();
}
```

(`sql`, `and`, `eq` are already imported in this file; verify and add any that are missing.)

- [ ] **Step 3: Add tag filter to `getFilteredArticles`**

In `getFilteredArticles` (`server/storage.ts:260-313`), where the other filter conditions are accumulated, add:

```ts
if (filters.tag) {
  conditions.push(arrayContains(articles.tags, [filters.tag]));
}
```

(Match the surrounding pattern — if conditions are combined differently, e.g. inline `and(...)`, integrate the same way the `category` filter does. `arrayContains` comes from `drizzle-orm`.)

- [ ] **Step 4: Typecheck**

Run: `npm run check`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add server/storage.ts
git commit -m "feat: add feed-tag storage, guid lookup/backfill, tag filter"
```

---

### Task 6: Rewire feed ingestion

**Files:**
- Modify: `server/rss.ts` (`fetchFeedArticles` at `:56-90`)

**Interfaces:**
- Consumes: `mapFeedItem`, `FeedItemInput` from `./ingest` (Task 4); storage methods from Task 5.
- Produces: same external signature `fetchFeedArticles(sourceId, feedUrl, sourceName, category): Promise<number>` — callers unchanged.

- [ ] **Step 1: Rewrite the ingest loop**

Replace the body of the `for` loop in `fetchFeedArticles` (keep imports `mapFeedItem` / types at top of file):

```ts
import { mapFeedItem, type FeedItemInput } from "./ingest";
```

```ts
for (const item of feed.items.slice(0, 20)) {
  if (!item.link || !item.title) continue;

  const mapped = mapFeedItem(item as FeedItemInput);

  const tagStatuses = await storage.upsertFeedTags(mapped.tags);
  if (Object.values(tagStatuses).includes("blocked")) {
    continue; // article carries an admin-blocked tag (e.g. "sponsored")
  }

  let existing = mapped.guid ? await storage.getArticleByGuid(sourceId, mapped.guid) : undefined;
  if (!existing) existing = await storage.getArticleByLink(item.link);
  if (existing) {
    if (mapped.guid && !existing.guid) {
      await storage.setArticleGuid(existing.id, mapped.guid);
    }
    continue;
  }

  const article: InsertArticle = {
    title: item.title,
    link: item.link,
    guid: mapped.guid,
    tags: mapped.tags.map((t) => t.name),
    description: mapped.description,
    content: mapped.content,
    author: item.creator || item.author || null,
    publishedAt: item.pubDate ? new Date(item.pubDate) : new Date(),
    sourceId,
    sourceName,
    category,
    imageUrl: extractImageUrl(item) || null,
    isRead: false,
  };

  try {
    await storage.createArticle(article);
    added++;
  } catch (err: any) {
    const pgCode = err?.code ?? err?.cause?.code;
    if (pgCode === "23505") continue; // unique-index race: another fetch inserted it first
    throw err;
  }
}
```

Note: all tags (pending/approved/rejected) are stored on the article — only `blocked` gates ingest. The UI decides what to display. This means approving a tag later retroactively surfaces it on already-ingested articles.

- [ ] **Step 2: Typecheck + full test suite**

Run: `npm run check && npm run test`
Expected: 0 tsc errors, all vitest suites pass.

- [ ] **Step 3: Smoke-test a real fetch**

Start the dev server (`npm run dev`), wait for the startup fetch to complete, then verify against the dev database that new articles carry guids and tags and that `feed_tags` is populating (any psql/SQL client works):

```sql
SELECT guid, tags, LENGTH(content) AS content_len FROM articles WHERE guid IS NOT NULL ORDER BY id DESC LIMIT 5;
SELECT name, status, article_count FROM feed_tags ORDER BY article_count DESC LIMIT 10;
```

Expected: recent articles have non-null `guid`, populated `tags`, and `content_len` up to 25000; `feed_tags` has rows, all `status = 'pending'`.

- [ ] **Step 4: Commit**

```bash
git add server/rss.ts
git commit -m "feat: ingest via mapFeedItem — guid dedup, tag gate, full-text content"
```

---

### Task 7: API endpoints

**Files:**
- Modify: `server/routes.ts` (articles list at `:201`, filters endpoint at `:254`; add feed-tag routes near the news-categories block at `:575-655`)

**Interfaces:**
- Consumes: storage methods from Task 5; `FEED_TAG_STATUSES` from `@shared/schema`.
- Produces:
  - `GET /api/feed-tags?status=<pending|approved|rejected|blocked>` → `FeedTag[]` (all tags when no status)
  - `POST /api/feed-tags/:id/status` body `{ "status": "approved" }` → updated `FeedTag`
  - `GET /api/articles/filters` response gains `tags: string[]` (approved tag names)
  - `GET /api/articles` accepts `&tag=<name>`

- [ ] **Step 1: Add feed-tag routes**

Following the existing plain-handler pattern (see `POST /api/sources` at `:530` and the knowledge-approve pattern at `:4291`), add:

```ts
app.get("/api/feed-tags", async (req, res) => {
  try {
    const status = req.query.status as string | undefined;
    if (status && !FEED_TAG_STATUSES.includes(status as any)) {
      return res.status(400).json({ error: "Invalid status", valid: FEED_TAG_STATUSES });
    }
    const tags = await storage.getFeedTags(status as FeedTagStatus | undefined);
    res.json(tags);
  } catch (err) {
    console.error("Error listing feed tags:", err);
    res.status(500).json({ error: "Failed to list feed tags" });
  }
});

app.post("/api/feed-tags/:id/status", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
    const parsed = z.object({ status: z.enum(FEED_TAG_STATUSES) }).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid status", details: parsed.error.errors });
    }
    const tag = await storage.updateFeedTagStatus(id, parsed.data.status);
    if (!tag) return res.status(404).json({ error: "Tag not found" });
    res.json(tag);
  } catch (err) {
    console.error("Error updating feed tag status:", err);
    res.status(500).json({ error: "Failed to update tag status" });
  }
});
```

Add `FEED_TAG_STATUSES` and `FeedTagStatus` to the `@shared/schema` import; `z` is already imported.

- [ ] **Step 2: Extend the filters endpoint and articles list**

In `GET /api/articles/filters` (`:254`), add approved tags to the response object:

```ts
const tags = await storage.getApprovedTagNames();
// include `tags` in the res.json({...}) payload alongside categories/sources
```

In `GET /api/articles` (`:201`), pass the query param through to `getFilteredArticles` the same way `category` is passed:

```ts
tag: typeof req.query.tag === "string" && req.query.tag !== "all" ? req.query.tag : undefined,
```

(Match the exact parsing idiom used for `category` in that handler.)

- [ ] **Step 3: Typecheck**

Run: `npm run check`
Expected: 0 errors.

- [ ] **Step 4: Verify endpoints against the dev server**

With `npm run dev` running:

```bash
curl -s "http://localhost:5000/api/feed-tags?status=pending" | head -c 500
curl -s -X POST "http://localhost:5000/api/feed-tags/1/status" -H "Content-Type: application/json" -d '{"status":"approved"}'
curl -s "http://localhost:5000/api/articles/filters" | head -c 500
curl -s "http://localhost:5000/api/feed-tags?status=bogus"
```

Expected: pending list returns rows from Task 6's smoke test; the POST returns the tag with `"status":"approved"` and a `reviewedAt`; filters payload now contains `"tags":["..."]` including the approved one; bogus status returns 400. (Confirm the dev port from server startup logs; adjust if not 5000.)

- [ ] **Step 5: Commit**

```bash
git add server/routes.ts
git commit -m "feat: feed-tag moderation endpoints and tag filter param"
```

---

### Task 8: Cap `article.content` at AI-prompt call sites

**Files:**
- Modify: every server file that interpolates `article.content` (or `a.content` etc.) into an LLM prompt — find them with the grep below. Likely candidates: `server/morning-brief/composer.ts`, analyst/briefing/report generators in `server/routes.ts` or `server/` modules.

**Interfaces:**
- Consumes: nothing new.
- Produces: no signature changes — behavior-preserving caps.

- [ ] **Step 1: Find every prompt consumer of stored content**

Run: `grep -rn "\.content" server --include="*.ts" | grep -v "content:" | grep -v test | grep -v node_modules`

Review each hit. The ones that matter are places where article content is embedded into an AI prompt or sent to an external API. Ignore: `item.content` in `rss.ts`/`ingest.ts` (feed parsing, already handled), `res.json` passthroughs (client display is snippet-based; returning longer content in JSON is acceptable).

- [ ] **Step 2: Apply a 2,000-char cap at each prompt call site**

At each prompt-building site, wrap the content reference:

```ts
article.content?.substring(0, 2000)
```

This preserves today's prompt sizes exactly (stored content was previously capped at 2,000 chars at ingest). Do NOT raise these caps in this task — that's a deliberate later decision with cost implications.

- [ ] **Step 3: Typecheck + tests**

Run: `npm run check && npm run test`
Expected: 0 errors, all pass (morning-brief composer tests exist and must still pass).

- [ ] **Step 4: Commit**

```bash
git add -A server
git commit -m "chore: cap article content at 2000 chars in AI prompt call sites"
```

---

### Task 9: Admin moderation UI — Tags tab

**Files:**
- Create: `client/src/components/feed-tags-tab.tsx`
- Modify: `client/src/pages/sources.tsx` (tab system near `:3449` — existing tabs `tab-sources`, `tab-uploaded-sources`)

**Interfaces:**
- Consumes: `GET /api/feed-tags?status=...`, `POST /api/feed-tags/:id/status` (Task 7); `apiRequest` from `@/lib/queryClient`; shadcn `Button`, `Badge`, `Card` components and `useToast` as used elsewhere in `sources.tsx`.
- Produces: `<FeedTagsTab />` default-exported component.

- [ ] **Step 1: Build the component**

Create `client/src/components/feed-tags-tab.tsx`:

```tsx
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { FeedTag, FeedTagStatus } from "@shared/schema";

const STATUS_FILTERS: { value: FeedTagStatus | "all"; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "blocked", label: "Blocked" },
  { value: "all", label: "All" },
];

const STATUS_BADGE_VARIANT: Record<FeedTagStatus, "default" | "secondary" | "outline" | "destructive"> = {
  pending: "outline",
  approved: "default",
  rejected: "secondary",
  blocked: "destructive",
};

export default function FeedTagsTab() {
  const [statusFilter, setStatusFilter] = useState<FeedTagStatus | "all">("pending");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const tagsQuery = useQuery<FeedTag[]>({
    queryKey: ["/api/feed-tags", statusFilter],
    queryFn: async () => {
      const qs = statusFilter === "all" ? "" : `?status=${statusFilter}`;
      const res = await fetch(`/api/feed-tags${qs}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load tags");
      return res.json();
    },
  });

  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: FeedTagStatus }) => {
      await apiRequest("POST", `/api/feed-tags/${id}/status`, { status });
    },
    onSuccess: (_data, { status }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/feed-tags"] });
      queryClient.invalidateQueries({ queryKey: ["/api/articles/filters"] });
      queryClient.invalidateQueries({ queryKey: ["/api/articles"] });
      toast({ title: `Tag ${status}` });
    },
    onError: () => {
      toast({ title: "Failed to update tag", variant: "destructive" });
    },
  });

  const tags = tagsQuery.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-sm text-muted-foreground">
          Tags found in feeds. Approved tags appear as filters on the news feed. Blocked tags stop
          matching articles from being ingested at all.
        </p>
        <div className="flex gap-1">
          {STATUS_FILTERS.map((f) => (
            <Button
              key={f.value}
              size="sm"
              variant={statusFilter === f.value ? "default" : "outline"}
              onClick={() => setStatusFilter(f.value)}
              data-testid={`button-tag-filter-${f.value}`}
            >
              {f.label}
            </Button>
          ))}
        </div>
      </div>

      {tagsQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading tags…</p>
      ) : tags.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="text-no-tags">
          No {statusFilter === "all" ? "" : statusFilter + " "}tags yet. Tags appear here as feeds
          are fetched.
        </p>
      ) : (
        <div className="divide-y rounded-md border">
          {tags.map((tag) => (
            <div
              key={tag.id}
              className="flex items-center justify-between gap-3 p-3 flex-wrap"
              data-testid={`row-tag-${tag.name}`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="font-medium truncate">{tag.displayName}</span>
                <Badge variant={STATUS_BADGE_VARIANT[tag.status as FeedTagStatus]}>
                  {tag.status}
                </Badge>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  seen {tag.articleCount}×
                </span>
              </div>
              <div className="flex gap-1">
                {tag.status !== "approved" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={statusMutation.isPending}
                    onClick={() => statusMutation.mutate({ id: tag.id, status: "approved" })}
                    data-testid={`button-approve-tag-${tag.name}`}
                  >
                    Approve
                  </Button>
                )}
                {tag.status !== "rejected" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={statusMutation.isPending}
                    onClick={() => statusMutation.mutate({ id: tag.id, status: "rejected" })}
                    data-testid={`button-reject-tag-${tag.name}`}
                  >
                    Reject
                  </Button>
                )}
                {tag.status !== "blocked" && (
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={statusMutation.isPending}
                    onClick={() => statusMutation.mutate({ id: tag.id, status: "blocked" })}
                    data-testid={`button-block-tag-${tag.name}`}
                  >
                    Block
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

Adjust import paths (`@/components/ui/button`, `@/hooks/use-toast`) to match what `sources.tsx` actually imports — copy its exact import lines.

- [ ] **Step 2: Mount as a tab in `sources.tsx`**

Locate the tab system around `client/src/pages/sources.tsx:3449` (`data-testid="tab-sources"` / `tab-uploaded-sources"`). Add a third tab labeled **Tags** with `data-testid="tab-feed-tags"` following the exact same trigger/content structure the two existing tabs use, rendering `<FeedTagsTab />` (lazy import is unnecessary; a plain import at the top of `sources.tsx` matches existing component imports).

- [ ] **Step 3: Typecheck**

Run: `npm run check`
Expected: 0 errors.

- [ ] **Step 4: Verify in the browser**

With `npm run dev` running, open `/sources`, click the Tags tab. Expected: pending tags listed with counts; clicking Approve moves a tag out of the Pending filter and a toast confirms; the Approved filter shows it.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/feed-tags-tab.tsx client/src/pages/sources.tsx
git commit -m "feat: admin tag moderation tab on Sources page"
```

---

### Task 10: News feed — tag filter + tag chips

**Files:**
- Modify: `client/src/pages/news-feed.tsx` (filter state near `:140`, filters query `:178`, queryParams `:200-226`, category Select `:428-438`, article card render)

**Interfaces:**
- Consumes: `tags` array from `GET /api/articles/filters` (Task 7); `tag` query param on `GET /api/articles` (Task 7); `article.tags` (Task 1).
- Produces: user-visible tag filter + tag chips.

- [ ] **Step 1: Add tag filter state and wire it into the query**

Next to `selectedCategory` (`:140`):

```tsx
const [selectedTag, setSelectedTag] = useState<string>("all");
```

In the `queryParams` construction (`:200-226`), add (matching the category param idiom):

```tsx
if (selectedTag !== "all") params.set("tag", selectedTag);
```

Ensure `selectedTag` is included in the articles query key the same way `selectedCategory` is, so changing it refetches.

- [ ] **Step 2: Add the tag Select**

Immediately after the category `<Select>` (`:428-438`), add a parallel one (only render it when there are approved tags):

```tsx
{(filtersQuery.data?.tags?.length ?? 0) > 0 && (
  <Select value={selectedTag} onValueChange={setSelectedTag}>
    <SelectTrigger className="h-8 w-auto min-w-[110px] text-xs" data-testid="select-filter-tag">
      <SelectValue placeholder="Tag" />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="all">All Tags</SelectItem>
      {filtersQuery.data!.tags.map((tag: string) => (
        <SelectItem key={tag} value={tag}>{tag}</SelectItem>
      ))}
    </SelectContent>
  </Select>
)}
```

(If `filtersQuery.data` is typed, extend its type to include `tags: string[]`.)

- [ ] **Step 3: Add approved-tag chips to article cards**

Locate the article card render in `news-feed.tsx` (the block that shows title/source/category per article). Compute the approved set once:

```tsx
const approvedTags = new Set(filtersQuery.data?.tags ?? []);
```

Inside the card, where secondary metadata renders, add:

```tsx
{(article.tags ?? []).filter((t: string) => approvedTags.has(t)).slice(0, 4).map((t: string) => (
  <Badge key={t} variant="outline" className="text-xs" data-testid={`badge-tag-${t}`}>
    {t}
  </Badge>
))}
```

Import `Badge` if the file doesn't already. Only approved tags render — pending/rejected tags stay invisible.

- [ ] **Step 4: Typecheck**

Run: `npm run check`
Expected: 0 errors.

- [ ] **Step 5: Verify in the browser**

With tags approved in Task 9's verification: open `/`, confirm (a) the Tag select appears listing approved tags, (b) selecting one filters the list, (c) article cards show chips for approved tags only.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/news-feed.tsx
git commit -m "feat: tag filter and approved-tag chips on news feed"
```

---

### Task 11: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Full suite**

Run: `npm run check && npm run test`
Expected: 0 tsc errors, all vitest suites pass.

- [ ] **Step 2: Fresh-ingest walkthrough**

1. Restart `npm run dev`; wait for the startup RSS fetch.
2. `/sources` → Tags tab: verify new pending tags accumulated with counts.
3. Approve one common tag (e.g. `ai`), block a junk one if present.
4. Trigger a manual refresh (the existing refresh button / `POST` refresh endpoint at `routes.ts:727`).
5. `/` news feed: approved tag appears in the Tag filter and as chips; filtering works.
6. DB check: re-run the Task 6 SQL — confirm guid backfill is happening on existing rows re-seen by link (`SELECT COUNT(*) FROM articles WHERE guid IS NOT NULL` increases across fetches) and no duplicate articles were created (`SELECT link, COUNT(*) FROM articles GROUP BY link HAVING COUNT(*) > 1` stays empty or unchanged from before).

- [ ] **Step 3: Commit any stragglers and stop**

No new feature code in this task. If verification exposed bugs, fix them with the systematic-debugging skill, keep tests green, and commit fixes individually.
