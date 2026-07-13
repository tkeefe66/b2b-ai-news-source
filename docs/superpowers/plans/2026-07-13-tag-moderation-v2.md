# Tag Moderation v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the unreviewable flat tag list with a threshold-gated review queue enriched with live stats and cached AI advice, plus bulk apply and search.

**Architecture:** A tag surfaces for review only when `feed_tags.article_count >= TAG_SURFACE_THRESHOLD` (3). The queue endpoint derives per-tag context (sources, 30-day windows, first/last seen) live from `articles.tags` via one aggregate SQL pass, lazily annotates un-analyzed tags with ONE batched LLM call (cached forever in three new `feed_tags` columns, failures non-blocking), and merges everything into the response. The Tags tab becomes queue-first with an "Accept all suggestions" bulk action; status filters and a new search box remain as secondary views.

**Tech Stack:** TypeScript, Express, Drizzle + raw `pool.query` for aggregate SQL, existing `chatCompletion` AI plumbing (haiku model, jsonMode), zod, vitest, React + @tanstack/react-query + shadcn/ui.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-13-tag-moderation-v2-design.md`. AI is advise-only — no code path may change a tag's status except explicit admin endpoints.
- `TAG_SURFACE_THRESHOLD = 3`, exported from `shared/schema.ts`; the queue query, hidden-count query, and UI copy must all reference it (never hardcode 3 elsewhere).
- Schema changes are additive only: 3 nullable columns on `feed_tags`, one GIN index on `articles.tags`. Applied via `npm run db:push` at DEPLOY time — there is no local DATABASE_URL; do not attempt db:push locally.
- Every runtime-created DB object must already be modeled in `shared/schema.ts` (this repo's db:push drops unmodeled objects — incident on 2026-07-13).
- LLM calls: `chatCompletion({ model: "claude-haiku-4-5-20251001", messages, maxTokens, jsonMode: true })` from `server/ai-models.ts` (returns `Promise<string>`). Annotation failure must NEVER fail or block the queue response.
- AI summary ≤ 160 chars (clamp in parser). Batch size: annotate at most 30 tags per queue load (slice; the rest annotate on later loads).
- Bulk endpoint: max 100 items per request, statuses validated with `z.enum(FEED_TAG_STATUSES)`.
- `npm run check` stays at 0 errors; `npm run test` (84 existing tests) stays green; client verified by `npm run check` + `npm run build` (no local dev server).
- Test files importing modules that transitively import `server/ai-models.ts` MUST `vi.mock` it before import (SDK clients instantiate at import; copy the pattern from `server/morning-brief/composer.test.ts`).
- Server endpoints unauthenticated with the file's standard try/catch + safeParse idiom, like all existing routes.

## File Structure

- `shared/schema.ts` — `TAG_SURFACE_THRESHOLD`, 3 new `feed_tags` columns, GIN index on `articles.tags` (modify)
- `server/tag-annotator.ts` — prompt builder, zod response parser, `annotateTags` LLM wrapper (create)
- `server/tag-annotator.test.ts` — tests (create)
- `server/tag-queue.ts` — pure merge of surfaced tags + enrichment + annotations (create)
- `server/tag-queue.test.ts` — tests (create)
- `server/storage.ts` — surfaced/hidden/enrichment/headlines/cache/search methods (modify)
- `server/routes.ts` — queue endpoint, bulk endpoint, search param (modify)
- `client/src/components/feed-tags-tab.tsx` — queue-first rework (rewrite)

---

### Task 1: Schema — annotation columns, GIN index, threshold constant

**Files:**
- Modify: `shared/schema.ts` (feedTags table ~line 60; articles third-arg indexes ~line 55; constant near `FEED_TAG_STATUSES`)

**Interfaces:**
- Produces: `TAG_SURFACE_THRESHOLD: number` exported from `@shared/schema`; `feedTags.aiSummary/aiSuggestion/aiAnnotatedAt` columns (nullable); `FeedTag` type gains the three fields automatically. Index `articles_tags_idx`.

- [ ] **Step 1: Add the constant**

Next to `FEED_TAG_STATUSES` in `shared/schema.ts`:

```ts
export const TAG_SURFACE_THRESHOLD = 3;
```

- [ ] **Step 2: Add columns to `feedTags`**

```ts
export const feedTags = pgTable("feed_tags", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  displayName: text("display_name").notNull(),
  status: text("status").default("pending").notNull(),
  articleCount: integer("article_count").default(0).notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  reviewedAt: timestamp("reviewed_at"),
  aiSummary: text("ai_summary"),
  aiSuggestion: text("ai_suggestion"),
  aiAnnotatedAt: timestamp("ai_annotated_at"),
});
```

Add `aiSummary: true, aiSuggestion: true, aiAnnotatedAt: true` to the `insertFeedTagSchema` `.omit({...})` so API-created tags can't preseed annotations.

- [ ] **Step 3: Add the GIN index on `articles.tags`**

In the `articles` table's third-argument object (which already has `sourceGuidIdx` and `searchIdx`):

```ts
  tagsIdx: index("articles_tags_idx").using("gin", t.tags),
```

- [ ] **Step 4: Typecheck + suite**

Run: `npm run check && npm run test`
Expected: 0 errors, 84/84. (No db:push — deploy-time step.)

- [ ] **Step 5: Commit**

```bash
git add shared/schema.ts
git commit -m "feat: tag annotation columns, tags GIN index, surface threshold constant"
```

---

### Task 2: Annotation module (server/tag-annotator.ts, TDD)

**Files:**
- Create: `server/tag-annotator.ts`
- Test: `server/tag-annotator.test.ts`

**Interfaces:**
- Consumes: `chatCompletion` from `./ai-models`.
- Produces (used by Task 4):
  - `interface AnnotationInput { name: string; displayName: string; sources: string[]; headlines: string[] }`
  - `interface TagAnnotation { name: string; summary: string; suggestion: "approve" | "reject" | "block" }`
  - `buildAnnotationPrompt(inputs: AnnotationInput[]): string`
  - `parseAnnotationResponse(raw: string, expectedNames: string[]): TagAnnotation[]`
  - `annotateTags(inputs: AnnotationInput[]): Promise<TagAnnotation[]>`

- [ ] **Step 1: Write the failing tests**

Create `server/tag-annotator.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";

vi.mock("./ai-models", () => ({
  chatCompletion: vi.fn(),
}));

import { buildAnnotationPrompt, parseAnnotationResponse, annotateTags } from "./tag-annotator";
import { chatCompletion } from "./ai-models";

const INPUT = [
  {
    name: "m&a",
    displayName: "M&A",
    sources: ["VentureBeat AI", "TechCrunch"],
    headlines: ["Paramount explores merger", "Warner Bros deal talk"],
  },
];

describe("buildAnnotationPrompt", () => {
  it("includes every tag name, its sources, and its headlines", () => {
    const prompt = buildAnnotationPrompt(INPUT);
    expect(prompt).toContain('"m&a"');
    expect(prompt).toContain("VentureBeat AI");
    expect(prompt).toContain("Paramount explores merger");
  });
  it("instructs the model on the three suggestion values", () => {
    const prompt = buildAnnotationPrompt(INPUT);
    expect(prompt).toContain("approve");
    expect(prompt).toContain("reject");
    expect(prompt).toContain("block");
  });
});

describe("parseAnnotationResponse", () => {
  const expected = ["m&a", "cars"];
  it("parses a valid response", () => {
    const raw = JSON.stringify([
      { name: "m&a", summary: "Media acquisition coverage", suggestion: "approve" },
      { name: "cars", summary: "One-off automotive tag", suggestion: "reject" },
    ]);
    expect(parseAnnotationResponse(raw, expected)).toHaveLength(2);
  });
  it("strips markdown code fences", () => {
    const raw = '```json\n[{"name":"m&a","summary":"S","suggestion":"approve"}]\n```';
    expect(parseAnnotationResponse(raw, expected)).toEqual([
      { name: "m&a", summary: "S", suggestion: "approve" },
    ]);
  });
  it("drops entries with unknown names, bad suggestions, or missing fields", () => {
    const raw = JSON.stringify([
      { name: "hacked", summary: "S", suggestion: "approve" },
      { name: "m&a", summary: "S", suggestion: "promote" },
      { name: "cars", suggestion: "reject" },
    ]);
    expect(parseAnnotationResponse(raw, expected)).toEqual([]);
  });
  it("clamps summaries to 160 chars", () => {
    const raw = JSON.stringify([{ name: "m&a", summary: "x".repeat(300), suggestion: "approve" }]);
    expect(parseAnnotationResponse(raw, expected)[0].summary).toHaveLength(160);
  });
  it("returns [] on non-JSON garbage", () => {
    expect(parseAnnotationResponse("the model rambled", expected)).toEqual([]);
  });
});

describe("annotateTags", () => {
  it("calls chatCompletion with jsonMode and parses the result", async () => {
    vi.mocked(chatCompletion).mockResolvedValue(
      JSON.stringify([{ name: "m&a", summary: "Media deals", suggestion: "approve" }])
    );
    const result = await annotateTags(INPUT);
    expect(result).toEqual([{ name: "m&a", summary: "Media deals", suggestion: "approve" }]);
    expect(vi.mocked(chatCompletion).mock.calls[0][0]).toMatchObject({
      model: "claude-haiku-4-5-20251001",
      jsonMode: true,
    });
  });
  it("returns [] for empty input without calling the model", async () => {
    vi.mocked(chatCompletion).mockClear();
    expect(await annotateTags([])).toEqual([]);
    expect(chatCompletion).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/tag-annotator.test.ts`
Expected: FAIL — cannot resolve `./tag-annotator`.

- [ ] **Step 3: Implement**

Create `server/tag-annotator.ts`:

```ts
import { z } from "zod";
import { chatCompletion } from "./ai-models";

const SUMMARY_MAX = 160;
const ANNOTATION_MODEL = "claude-haiku-4-5-20251001";

export interface AnnotationInput {
  name: string;
  displayName: string;
  sources: string[];
  headlines: string[];
}

export interface TagAnnotation {
  name: string;
  summary: string;
  suggestion: "approve" | "reject" | "block";
}

const annotationSchema = z.object({
  name: z.string(),
  summary: z.string().min(1),
  suggestion: z.enum(["approve", "reject", "block"]),
});

export function buildAnnotationPrompt(inputs: AnnotationInput[]): string {
  const tagBlocks = inputs
    .map((t) => {
      const lines = [
        `- name: "${t.name}" (displayed as "${t.displayName}")`,
        `  sources: ${t.sources.join(", ") || "unknown"}`,
        `  recent headlines: ${t.headlines.map((h) => JSON.stringify(h)).join("; ") || "none"}`,
      ];
      return lines.join("\n");
    })
    .join("\n");

  return [
    "You are triaging content tags for a B2B AI/martech news aggregator's reader-facing filter list.",
    "For EACH tag below, write a concrete one-line summary (max 160 chars) of what articles carrying it cover, grounded in its headlines and sources, then suggest exactly one action:",
    '- "approve": a coherent recurring topic readers would use as a filter',
    '- "reject": not useful as a filter (person names, overly generic terms, one-off subjects)',
    '- "block": articles carrying it should not be ingested at all (sponsored/promotional/press-release markers). Block is rare.',
    "",
    "Tags:",
    tagBlocks,
    "",
    'Respond with ONLY a JSON array: [{"name": "<name exactly as given>", "summary": "<one line>", "suggestion": "approve|reject|block"}]',
  ].join("\n");
}

export function parseAnnotationResponse(raw: string, expectedNames: string[]): TagAnnotation[] {
  const stripped = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const allowed = new Set(expectedNames);
  const results: TagAnnotation[] = [];
  for (const entry of parsed) {
    const check = annotationSchema.safeParse(entry);
    if (!check.success || !allowed.has(check.data.name)) continue;
    results.push({ ...check.data, summary: check.data.summary.substring(0, SUMMARY_MAX) });
  }
  return results;
}

export async function annotateTags(inputs: AnnotationInput[]): Promise<TagAnnotation[]> {
  if (inputs.length === 0) return [];
  const raw = await chatCompletion({
    model: ANNOTATION_MODEL,
    messages: [{ role: "user", content: buildAnnotationPrompt(inputs) }],
    maxTokens: 4096,
    jsonMode: true,
  });
  return parseAnnotationResponse(raw, inputs.map((i) => i.name));
}
```

(If `ChatMessage`'s `role`/`content` typing requires a different message shape, match what `server/digest.ts:30` passes.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/tag-annotator.test.ts`
Expected: all PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `npm run check`
Expected: 0 errors.

```bash
git add server/tag-annotator.ts server/tag-annotator.test.ts
git commit -m "feat: batched tag annotation module (prompt, parser, LLM wrapper)"
```

---

### Task 3: Storage — queue, enrichment, headlines, cache, search

**Files:**
- Modify: `server/storage.ts` (IStorage interface + DatabaseStorage class; `pool` is importable from `./db` — see `server/rss.ts:3` for the import precedent)

**Interfaces:**
- Consumes: `TAG_SURFACE_THRESHOLD`, `feedTags`, `FeedTag` from `@shared/schema`; `pool` from `./db`.
- Produces (used by Task 4):
  - `interface TagEnrichment { name: string; sources: string[]; count30d: number; countPrev30d: number; firstSeenAt: string | null; lastSeenAt: string | null }` (export from `server/storage.ts`)
  - `getSurfacedPendingTags(): Promise<FeedTag[]>` — pending AND `articleCount >= TAG_SURFACE_THRESHOLD`, sorted by articleCount desc
  - `countHiddenPendingTags(): Promise<number>` — pending AND below threshold
  - `getTagEnrichment(names: string[]): Promise<TagEnrichment[]>`
  - `getTagHeadlines(names: string[], limitPerTag: number): Promise<Record<string, string[]>>`
  - `cacheTagAnnotations(items: { name: string; summary: string; suggestion: string }[]): Promise<void>`
  - `searchFeedTags(query: string): Promise<FeedTag[]>` — any status, ILIKE on name/displayName, limit 50

- [ ] **Step 1: Add interface signatures and implementations**

Add to `IStorage` (near the existing feed-tag methods) the six signatures above. Implement in `DatabaseStorage`:

```ts
async getSurfacedPendingTags(): Promise<FeedTag[]> {
  return db
    .select()
    .from(feedTags)
    .where(and(eq(feedTags.status, "pending"), gte(feedTags.articleCount, TAG_SURFACE_THRESHOLD)))
    .orderBy(desc(feedTags.articleCount));
}

async countHiddenPendingTags(): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(feedTags)
    .where(and(eq(feedTags.status, "pending"), lt(feedTags.articleCount, TAG_SURFACE_THRESHOLD)));
  return row?.count ?? 0;
}

async getTagEnrichment(names: string[]): Promise<TagEnrichment[]> {
  if (names.length === 0) return [];
  const { rows } = await pool.query(
    `SELECT t.tag AS name,
            (array_agg(DISTINCT a.source_name) FILTER (WHERE a.source_name IS NOT NULL))[1:5] AS sources,
            COUNT(*) FILTER (WHERE a.published_at >= NOW() - INTERVAL '30 days')::int AS count30d,
            COUNT(*) FILTER (WHERE a.published_at >= NOW() - INTERVAL '60 days'
                               AND a.published_at <  NOW() - INTERVAL '30 days')::int AS count_prev30d,
            MIN(a.created_at) AS first_seen_at,
            MAX(a.created_at) AS last_seen_at
     FROM articles a
     CROSS JOIN LATERAL unnest(a.tags) AS t(tag)
     WHERE a.tags && $1::text[] AND t.tag = ANY($1::text[])
     GROUP BY t.tag`,
    [names]
  );
  return rows.map((r: any) => ({
    name: r.name,
    sources: r.sources ?? [],
    count30d: r.count30d,
    countPrev30d: r.count_prev30d,
    firstSeenAt: r.first_seen_at ? new Date(r.first_seen_at).toISOString() : null,
    lastSeenAt: r.last_seen_at ? new Date(r.last_seen_at).toISOString() : null,
  }));
}

async getTagHeadlines(names: string[], limitPerTag: number): Promise<Record<string, string[]>> {
  if (names.length === 0) return {};
  const { rows } = await pool.query(
    `SELECT name, title FROM (
       SELECT t.tag AS name, a.title,
              ROW_NUMBER() OVER (PARTITION BY t.tag ORDER BY a.published_at DESC NULLS LAST) AS rn
       FROM articles a
       CROSS JOIN LATERAL unnest(a.tags) AS t(tag)
       WHERE a.tags && $1::text[] AND t.tag = ANY($1::text[])
     ) ranked
     WHERE rn <= $2`,
    [names, limitPerTag]
  );
  const result: Record<string, string[]> = {};
  for (const row of rows as { name: string; title: string }[]) {
    (result[row.name] ??= []).push(row.title);
  }
  return result;
}

async cacheTagAnnotations(items: { name: string; summary: string; suggestion: string }[]): Promise<void> {
  for (const item of items) {
    await db
      .update(feedTags)
      .set({ aiSummary: item.summary, aiSuggestion: item.suggestion, aiAnnotatedAt: new Date() })
      .where(eq(feedTags.name, item.name));
  }
}

async searchFeedTags(query: string): Promise<FeedTag[]> {
  const pattern = `%${query}%`;
  return db
    .select()
    .from(feedTags)
    .where(or(ilike(feedTags.name, pattern), ilike(feedTags.displayName, pattern)))
    .orderBy(desc(feedTags.articleCount))
    .limit(50);
}
```

Add missing drizzle imports (`gte`, `lt`, `or`, `ilike` — check which are already imported). Import `pool` from `./db` and `TAG_SURFACE_THRESHOLD` from `@shared/schema` if not present.

- [ ] **Step 2: Typecheck + suite**

Run: `npm run check && npm run test`
Expected: 0 errors, 84/84 + Task 2's tests.

- [ ] **Step 3: Commit**

```bash
git add server/storage.ts
git commit -m "feat: tag queue storage — surfaced/hidden/enrichment/headlines/cache/search"
```

---

### Task 4: Queue merge helper + endpoints

**Files:**
- Create: `server/tag-queue.ts`
- Test: `server/tag-queue.test.ts`
- Modify: `server/routes.ts` (next to the existing `/api/feed-tags` routes)

**Interfaces:**
- Consumes: Task 2's `TagAnnotation`/`annotateTags`, Task 3's storage methods + `TagEnrichment`, `TAG_SURFACE_THRESHOLD` + `FEED_TAG_STATUSES` from `@shared/schema`.
- Produces:
  - `interface QueueTag { id: number; name: string; displayName: string; articleCount: number; sources: string[]; count30d: number; countPrev30d: number; firstSeenAt: string | null; lastSeenAt: string | null; aiSummary: string | null; aiSuggestion: string | null }`
  - `mergeQueueTags(tags: FeedTag[], enrichment: TagEnrichment[], annotations: TagAnnotation[]): QueueTag[]`
  - `GET /api/feed-tags/queue` → `{ threshold: number, hiddenCount: number, tags: QueueTag[] }`
  - `POST /api/feed-tags/bulk` body `{ items: [{ id, status }] }` → `{ applied: number, failed: { id: number, error: string }[] }`
  - `GET /api/feed-tags?search=<q>` → FeedTag[] (any status)

- [ ] **Step 1: Write the failing merge tests**

Create `server/tag-queue.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mergeQueueTags } from "./tag-queue";
import type { FeedTag } from "@shared/schema";

const tag = (over: Partial<FeedTag>): FeedTag => ({
  id: 1,
  name: "m&a",
  displayName: "M&A",
  status: "pending",
  articleCount: 5,
  createdAt: new Date(),
  reviewedAt: null,
  aiSummary: null,
  aiSuggestion: null,
  aiAnnotatedAt: null,
  ...over,
});

describe("mergeQueueTags", () => {
  it("merges enrichment and fresh annotations onto tags", () => {
    const [merged] = mergeQueueTags(
      [tag({})],
      [{ name: "m&a", sources: ["VB"], count30d: 4, countPrev30d: 1, firstSeenAt: "2026-07-01T00:00:00.000Z", lastSeenAt: "2026-07-13T00:00:00.000Z" }],
      [{ name: "m&a", summary: "Media deals", suggestion: "approve" }]
    );
    expect(merged).toMatchObject({
      name: "m&a",
      sources: ["VB"],
      count30d: 4,
      aiSummary: "Media deals",
      aiSuggestion: "approve",
    });
  });
  it("fresh annotation wins over stale cached fields", () => {
    const [merged] = mergeQueueTags(
      [tag({ aiSummary: "old", aiSuggestion: "reject" })],
      [],
      [{ name: "m&a", summary: "new", suggestion: "approve" }]
    );
    expect(merged.aiSummary).toBe("new");
    expect(merged.aiSuggestion).toBe("approve");
  });
  it("falls back to cached annotation and zeroed enrichment when absent", () => {
    const [merged] = mergeQueueTags([tag({ aiSummary: "cached", aiSuggestion: "approve" })], [], []);
    expect(merged).toMatchObject({
      sources: [],
      count30d: 0,
      countPrev30d: 0,
      firstSeenAt: null,
      lastSeenAt: null,
      aiSummary: "cached",
      aiSuggestion: "approve",
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/tag-queue.test.ts`
Expected: FAIL — cannot resolve `./tag-queue`.

- [ ] **Step 3: Implement the merge helper**

Create `server/tag-queue.ts`:

```ts
import type { FeedTag } from "@shared/schema";
import type { TagEnrichment } from "./storage";
import type { TagAnnotation } from "./tag-annotator";

export interface QueueTag {
  id: number;
  name: string;
  displayName: string;
  articleCount: number;
  sources: string[];
  count30d: number;
  countPrev30d: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  aiSummary: string | null;
  aiSuggestion: string | null;
}

export function mergeQueueTags(
  tags: FeedTag[],
  enrichment: TagEnrichment[],
  annotations: TagAnnotation[]
): QueueTag[] {
  const enrichByName = new Map(enrichment.map((e) => [e.name, e]));
  const annotationByName = new Map(annotations.map((a) => [a.name, a]));
  return tags.map((t) => {
    const e = enrichByName.get(t.name);
    const fresh = annotationByName.get(t.name);
    return {
      id: t.id,
      name: t.name,
      displayName: t.displayName,
      articleCount: t.articleCount,
      sources: e?.sources ?? [],
      count30d: e?.count30d ?? 0,
      countPrev30d: e?.countPrev30d ?? 0,
      firstSeenAt: e?.firstSeenAt ?? null,
      lastSeenAt: e?.lastSeenAt ?? null,
      aiSummary: fresh?.summary ?? t.aiSummary,
      aiSuggestion: fresh?.suggestion ?? t.aiSuggestion,
    };
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/tag-queue.test.ts`
Expected: all PASS.

- [ ] **Step 5: Add the three route changes**

In `server/routes.ts`, next to the existing feed-tags routes. Imports to add: `mergeQueueTags` from `./tag-queue`, `annotateTags` from `./tag-annotator`, `TAG_SURFACE_THRESHOLD` added to the `@shared/schema` import.

```ts
app.get("/api/feed-tags/queue", async (req, res) => {
  try {
    const surfaced = await storage.getSurfacedPendingTags();
    const hiddenCount = await storage.countHiddenPendingTags();
    const names = surfaced.map((t) => t.name);
    const enrichment = names.length ? await storage.getTagEnrichment(names) : [];

    let annotations: Awaited<ReturnType<typeof annotateTags>> = [];
    const unannotated = surfaced.filter((t) => !t.aiSummary).slice(0, 30);
    if (unannotated.length > 0) {
      try {
        const headlines = await storage.getTagHeadlines(unannotated.map((t) => t.name), 3);
        const enrichByName = new Map(enrichment.map((e) => [e.name, e]));
        annotations = await annotateTags(
          unannotated.map((t) => ({
            name: t.name,
            displayName: t.displayName,
            sources: enrichByName.get(t.name)?.sources ?? [],
            headlines: headlines[t.name] ?? [],
          }))
        );
        if (annotations.length > 0) await storage.cacheTagAnnotations(annotations);
      } catch (err) {
        console.error("Tag annotation failed (queue still served):", err);
      }
    }

    res.json({
      threshold: TAG_SURFACE_THRESHOLD,
      hiddenCount,
      tags: mergeQueueTags(surfaced, enrichment, annotations),
    });
  } catch (err) {
    console.error("Error building feed-tag queue:", err);
    res.status(500).json({ error: "Failed to build tag review queue" });
  }
});

app.post("/api/feed-tags/bulk", async (req, res) => {
  try {
    const parsed = z
      .object({
        items: z
          .array(z.object({ id: z.number().int(), status: z.enum(FEED_TAG_STATUSES) }))
          .min(1)
          .max(100),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid bulk payload", details: parsed.error.errors });
    }
    let applied = 0;
    const failed: { id: number; error: string }[] = [];
    for (const item of parsed.data.items) {
      try {
        const updated = await storage.updateFeedTagStatus(item.id, item.status);
        if (updated) applied++;
        else failed.push({ id: item.id, error: "Tag not found" });
      } catch (err) {
        failed.push({ id: item.id, error: err instanceof Error ? err.message : String(err) });
      }
    }
    res.json({ applied, failed });
  } catch (err) {
    console.error("Error bulk-updating feed tags:", err);
    res.status(500).json({ error: "Failed to bulk-update tags" });
  }
});
```

**Ordering constraint:** `GET /api/feed-tags/queue` must be registered BEFORE any parameterized `/api/feed-tags/:id...` route if one is ever added; today only `/api/feed-tags/:id/status` (POST) exists so there is no clash, but keep queue registration adjacent to `GET /api/feed-tags` for readability.

Extend the existing `GET /api/feed-tags` handler: before the status handling, add

```ts
const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
if (search) {
  return res.json(await storage.searchFeedTags(search));
}
```

- [ ] **Step 6: Typecheck + full suite**

Run: `npm run check && npm run test`
Expected: 0 errors, all green.

- [ ] **Step 7: Commit**

```bash
git add server/tag-queue.ts server/tag-queue.test.ts server/routes.ts
git commit -m "feat: tag review queue endpoint, bulk apply, tag search"
```

---

### Task 5: Tags tab v2 (client)

**Files:**
- Rewrite: `client/src/components/feed-tags-tab.tsx` (current v1 is 143 lines: status-filter buttons + flat rows)

**Interfaces:**
- Consumes: `GET /api/feed-tags/queue` → `{ threshold, hiddenCount, tags: QueueTag[] }`; `POST /api/feed-tags/bulk`; `GET /api/feed-tags?status=` and `?search=`; existing `POST /api/feed-tags/:id/status`; `TAG_SURFACE_THRESHOLD` import unnecessary (threshold arrives in the response).
- Produces: default-exported `FeedTagsTab` (mount point in sources.tsx unchanged).

- [ ] **Step 1: Rewrite the component**

Replace `client/src/components/feed-tags-tab.tsx` with the queue-first version. Keep the existing import paths (they were verified in v1: `@/lib/queryClient`, `@/hooks/use-toast`, `@/components/ui/button`, `@/components/ui/badge`). Add `Input` from `@/components/ui/input`.

```tsx
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import type { FeedTag, FeedTagStatus } from "@shared/schema";

interface QueueTag {
  id: number;
  name: string;
  displayName: string;
  articleCount: number;
  sources: string[];
  count30d: number;
  countPrev30d: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  aiSummary: string | null;
  aiSuggestion: string | null;
}

interface QueueResponse {
  threshold: number;
  hiddenCount: number;
  tags: QueueTag[];
}

type View = "queue" | FeedTagStatus | "all";
type SuggestionVerb = "approve" | "reject" | "block";

const SUGGESTION_TO_STATUS: Record<SuggestionVerb, FeedTagStatus> = {
  approve: "approved",
  reject: "rejected",
  block: "blocked",
};

const VIEWS: { value: View; label: string }[] = [
  { value: "queue", label: "Review queue" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "blocked", label: "Blocked" },
  { value: "all", label: "All" },
];

function trendLabel(t: QueueTag): string {
  const dir = t.count30d > t.countPrev30d ? "↑ rising" : t.count30d < t.countPrev30d ? "↓ falling" : "steady";
  return `${t.count30d} article${t.count30d === 1 ? "" : "s"} in 30d · ${dir}`;
}

export default function FeedTagsTab() {
  const [view, setView] = useState<View>("queue");
  const [search, setSearch] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/feed-tags"] });
    queryClient.invalidateQueries({ queryKey: ["/api/feed-tags/queue"] });
    queryClient.invalidateQueries({ queryKey: ["/api/articles/filters"] });
    queryClient.invalidateQueries({ queryKey: ["/api/articles"] });
  };

  const queueQuery = useQuery<QueueResponse>({
    queryKey: ["/api/feed-tags/queue"],
    queryFn: async () => {
      const res = await fetch("/api/feed-tags/queue", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load review queue");
      return res.json();
    },
    enabled: view === "queue" && !search,
  });

  const listQuery = useQuery<FeedTag[]>({
    queryKey: ["/api/feed-tags", view, search],
    queryFn: async () => {
      const qs = search
        ? `?search=${encodeURIComponent(search)}`
        : view === "all" || view === "queue"
          ? ""
          : `?status=${view}`;
      const res = await fetch(`/api/feed-tags${qs}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load tags");
      return res.json();
    },
    enabled: Boolean(search) || (view !== "queue" && !search),
  });

  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: FeedTagStatus }) => {
      await apiRequest("POST", `/api/feed-tags/${id}/status`, { status });
    },
    onSuccess: (_d, { status }) => {
      invalidateAll();
      toast({ title: `Tag ${status}` });
    },
    onError: () => toast({ title: "Failed to update tag", variant: "destructive" }),
  });

  const bulkMutation = useMutation({
    mutationFn: async (items: { id: number; status: FeedTagStatus }[]) => {
      const res = await apiRequest("POST", "/api/feed-tags/bulk", { items });
      return res.json() as Promise<{ applied: number; failed: { id: number; error: string }[] }>;
    },
    onSuccess: (result) => {
      invalidateAll();
      toast({
        title:
          result.failed.length > 0
            ? `${result.applied} applied, ${result.failed.length} failed`
            : `${result.applied} suggestions applied`,
        variant: result.failed.length > 0 ? "destructive" : undefined,
      });
    },
    onError: () => toast({ title: "Bulk apply failed", variant: "destructive" }),
  });

  const queue = queueQuery.data;
  const annotated = (queue?.tags ?? []).filter(
    (t): t is QueueTag & { aiSuggestion: SuggestionVerb } =>
      t.aiSuggestion === "approve" || t.aiSuggestion === "reject" || t.aiSuggestion === "block"
  );

  const actionButton = (t: QueueTag, action: SuggestionVerb) => {
    const suggested = t.aiSuggestion === action;
    return (
      <Button
        size="sm"
        variant={suggested ? (action === "block" ? "destructive" : "default") : "outline"}
        disabled={statusMutation.isPending || bulkMutation.isPending}
        onClick={() => statusMutation.mutate({ id: t.id, status: SUGGESTION_TO_STATUS[action] })}
        data-testid={`button-${action}-tag-${t.name}`}
      >
        {action.charAt(0).toUpperCase() + action.slice(1)}
        {suggested ? " ✓" : ""}
      </Button>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex gap-1 flex-wrap">
          {VIEWS.map((v) => (
            <Button
              key={v.value}
              size="sm"
              variant={view === v.value && !search ? "default" : "outline"}
              onClick={() => {
                setView(v.value);
                setSearch("");
              }}
              data-testid={`button-tag-view-${v.value}`}
            >
              {v.label}
              {v.value === "queue" && queue && queue.tags.length > 0 ? ` (${queue.tags.length})` : ""}
            </Button>
          ))}
        </div>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search all tags…"
          className="h-8 w-56"
          data-testid="input-tag-search"
        />
      </div>

      {search ? (
        <TagRows tags={listQuery.data ?? []} loading={listQuery.isLoading} onAction={(id, status) => statusMutation.mutate({ id, status })} busy={statusMutation.isPending} />
      ) : view === "queue" ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-sm text-muted-foreground" data-testid="text-hidden-tags">
              {queue
                ? `${queue.hiddenCount} low-volume tags auto-hidden — they surface after ${queue.threshold} articles.`
                : "Loading review queue…"}
            </p>
            {annotated.length > 0 && (
              <Button
                size="sm"
                disabled={bulkMutation.isPending}
                onClick={() =>
                  bulkMutation.mutate(
                    annotated.map((t) => ({ id: t.id, status: SUGGESTION_TO_STATUS[t.aiSuggestion] }))
                  )
                }
                data-testid="button-accept-all-suggestions"
              >
                Accept all suggestions ({annotated.length})
              </Button>
            )}
          </div>

          {queueQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading review queue…</p>
          ) : (queue?.tags.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-queue-empty">
              Nothing needs review — new tags surface automatically once they prove out.
            </p>
          ) : (
            <div className="space-y-2">
              {queue!.tags.map((t) => (
                <div key={t.id} className="rounded-md border p-3 space-y-1.5" data-testid={`card-tag-${t.name}`}>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{t.displayName}</span>
                      {t.aiSuggestion && <Badge variant="outline">suggested: {t.aiSuggestion}</Badge>}
                    </div>
                    <div className="flex gap-1">
                      {actionButton(t, "approve")}
                      {actionButton(t, "reject")}
                      {actionButton(t, "block")}
                    </div>
                  </div>
                  {t.aiSummary && <p className="text-sm italic text-muted-foreground">{t.aiSummary}</p>}
                  <p className="text-xs text-muted-foreground">
                    {t.sources.length > 0 ? `from ${t.sources.join(", ")} · ` : ""}
                    {trendLabel(t)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <TagRows tags={listQuery.data ?? []} loading={listQuery.isLoading} onAction={(id, status) => statusMutation.mutate({ id, status })} busy={statusMutation.isPending} />
      )}
    </div>
  );
}

function TagRows({
  tags,
  loading,
  onAction,
  busy,
}: {
  tags: FeedTag[];
  loading: boolean;
  onAction: (id: number, status: FeedTagStatus) => void;
  busy: boolean;
}) {
  if (loading) return <p className="text-sm text-muted-foreground">Loading tags…</p>;
  if (tags.length === 0)
    return (
      <p className="text-sm text-muted-foreground" data-testid="text-no-tags">
        No matching tags.
      </p>
    );
  return (
    <div className="divide-y rounded-md border">
      {tags.map((tag) => (
        <div key={tag.id} className="flex items-center justify-between gap-3 p-3 flex-wrap" data-testid={`row-tag-${tag.name}`}>
          <div className="flex items-center gap-3 min-w-0">
            <span className="font-medium truncate">{tag.displayName}</span>
            <Badge variant="outline">{tag.status}</Badge>
            <span className="text-xs text-muted-foreground whitespace-nowrap">seen {tag.articleCount}×</span>
          </div>
          <div className="flex gap-1">
            {(["approve", "reject", "block"] as const)
              .filter((a) => {
                const target = a === "approve" ? "approved" : a === "reject" ? "rejected" : "blocked";
                return tag.status !== target;
              })
              .map((a) => (
                <Button
                  key={a}
                  size="sm"
                  variant={a === "block" ? "destructive" : "outline"}
                  disabled={busy}
                  onClick={() => onAction(tag.id, (a === "approve" ? "approved" : a === "reject" ? "rejected" : "blocked") as FeedTagStatus)}
                  data-testid={`button-${a}-tag-${tag.name}`}
                >
                  {a.charAt(0).toUpperCase() + a.slice(1)}
                </Button>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}
```

**Semantic note (already handled in the code above):** the status endpoints expect `approved|rejected|blocked` (STATUS values), while `aiSuggestion` arrives as `approve|reject|block` (ACTION verbs). Every mutate call maps through `SUGGESTION_TO_STATUS` — never send a verb to the server or zod will 400. If you touch any mutate call, preserve that mapping.

- [ ] **Step 2: Typecheck + build + suite**

Run: `npm run check && npm run build && npm run test`
Expected: 0 errors, build succeeds, tests green.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/feed-tags-tab.tsx
git commit -m "feat: queue-first Tags tab — AI-annotated cards, accept-all, search"
```

---

### Task 6: Static verification + deploy notes

**Files:** none (verification only)

- [ ] **Step 1: Full static gate**

Run: `npm run check && npm run test && npm run build`
Expected: 0 tsc errors, all tests green, build succeeds.

- [ ] **Step 2: Confirm the deploy checklist is recorded**

Ensure `.superpowers/sdd/progress.md` (ledger) records: deploy needs `npm run db:push` against the Railway DB (3 additive columns + 1 GIN index — expect NO drop proposals now that runtime objects are modeled), then push main → auto-deploy, then smoke: `GET /api/feed-tags/queue` returns `{threshold, hiddenCount, tags}`; after first load with surfaced tags, `feed_tags.ai_summary` populates; bulk endpoint applies and reports.

- [ ] **Step 3: Commit any stragglers**

No new feature code. Fix-and-commit only if verification exposed issues.
