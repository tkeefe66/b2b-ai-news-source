# Tag Moderation v2 — Design

**Date:** 2026-07-13
**Status:** Approved by Tom (conversation), pending spec review
**Context:** Tag moderation v1 (shipped earlier today) surfaces every normalized feed tag as `pending` with no context. With hundreds of tags and singleton junk (person names, one-off categories), the queue is unreviewable and rows like "M&A — seen 1×" give no basis for a decision.

## Goals

1. An admin should almost never face more than a screenful of tags to review.
2. Each surfaced tag must carry enough context to decide in seconds: where it came from, what it covers, how much volume it has.
3. AI advises, never acts: every status change is an explicit admin click (single or bulk).
4. The long tail is auto-managed: unproven tags stay invisible and cost nothing, with a search-based rescue path.

## Decisions Made (with Tom)

- **Triage model:** auto-managed long tail via a volume threshold. Not AI-pre-triage-everything, not manual-with-better-UX.
- **Per-tag context:** source list, AI one-liner + suggested action, volume trend. (Sample headlines are used internally by the AI, not shown as a UI element.)
- **AI autonomy:** advise only. Suggestions render highlighted; an "Accept all suggestions" button bulk-applies them after a skim. No auto-apply.
- **Architecture:** derive stats live from `articles.tags` (no stats table, no junction table). AI annotations cached as columns on `feed_tags`.

## Behavior

### Surfacing threshold

A `pending` tag is **surfaced** (enters the review queue) when its `feed_tags.article_count >= 3`. `article_count` already counts *ingested* articles only (incremented after successful `createArticle`, per the v1 fix). The threshold is a named constant `TAG_SURFACE_THRESHOLD = 3` in shared server code, referenced by the queue query and the UI copy.

Tags below the threshold: remain `pending`, invisible in the default view, never annotated, never deleted. They surface automatically if volume arrives later.

### Review queue (new)

`GET /api/feed-tags/queue` returns surfaced pending tags sorted by `article_count` desc, each enriched with:

- `sources: string[]` — distinct `source_name` of articles carrying the tag (capped at 5 for display)
- `count30d: number` — articles carrying the tag with `published_at` in the last 30 days
- `countPrev30d: number` — same for the 30 days before that (client derives trend direction: rising / steady / falling)
- `firstSeenAt`, `lastSeenAt` — min/max `created_at` of carrying articles
- `aiSummary: string | null`, `aiSuggestion: "approve" | "reject" | "block" | null` — from cache (below)
- `hiddenCount: number` (top-level in the response) — count of pending tags below the threshold, for the "N low-volume tags auto-hidden" line

Enrichment is one aggregate query over `articles` restricted to the surfaced tag names (small set), using `unnest(tags)`/`@>` as the implementer finds fastest. A new **GIN index on `articles.tags`** supports tag-restricted queries here and in the existing tag filter.

### AI annotation (lazy, cached, batched, non-blocking)

When the queue endpoint finds surfaced tags with `ai_summary IS NULL`, it makes **one batched LLM call** (existing app AI plumbing, `server/ai-models.ts` chat-completion path) covering all un-annotated tags in the response. Input per tag: display name, source names, and up to 3 recent article headlines carrying it (fetched in the same enrichment pass). Output per tag (JSON, zod-validated): `summary` (≤160 chars, concrete: "Media-industry acquisition coverage — Paramount, Warner Bros deals") and `suggestion` (`approve|reject|block`).

- Results persist to new `feed_tags` columns: `ai_summary text`, `ai_suggestion text`, `ai_annotated_at timestamp`. Each tag is annotated at most once (re-annotate only if NULL).
- Failure containment: LLM error, timeout, or malformed/partial JSON → log, skip caching for affected tags, return the queue **without** AI fields. The queue never 500s because of annotation.
- Suggestion vocabulary guidance to the model: `approve` = coherent recurring topic useful as a reader-facing filter; `reject` = not useful as a filter (person names, overly generic, one-off); `block` = content that should not be ingested at all (sponsored/promotional markers). Expected distribution: mostly approve/reject; block is rare.

### Bulk apply (new)

`POST /api/feed-tags/bulk` with body `{ items: [{ id: number, status: FeedTagStatus }] }` (zod-validated, max 100 items). Applies each via the existing storage method; sets `reviewed_at`. Response: `{ applied: number, failed: [{ id, error }] }`. Powers "Accept all suggestions"; also reusable for future multi-select.

### Unchanged

Status model (`pending|approved|rejected|blocked`), blocked-gate at ingest, approved-only surfacing in the news feed, per-tag status endpoint, tag storage on articles.

## UI — Tags tab v2

**Default view: Review queue.**
- Header row: "Accept all suggestions (N)" button (only when ≥1 annotated tag present; disabled while applying) + the auto-hidden summary line: "212 low-volume tags auto-hidden — they surface after 3 articles."
- Card per tag: display name; AI one-liner (italic); "suggested: approve" badge; sources line ("from VentureBeat AI, TechCrunch"); volume line ("14 articles in 30d ↑ rising"); Approve/Reject/Block buttons with the suggested one visually highlighted (e.g. filled vs outline).
- Cards without annotation (AI failed/pending) render everything else; no highlight.
- Empty state: "Nothing needs review — new tags surface automatically once they prove out."

**Secondary views:** existing Approved / Rejected / Blocked / All filter buttons, plus **search input** querying all tags by name (server-side `ILIKE`, includes the hidden long tail). These views keep the v1 compact row format; no AI enrichment shown for un-surfaced tags.

**Feedback:** bulk apply toast reports partial failures ("11 applied, 1 failed"). All existing react-query invalidations (feed-tags, filters, articles) fire after bulk apply.

## Data / API surface summary

| Change | Kind |
|---|---|
| `feed_tags.ai_summary`, `ai_suggestion`, `ai_annotated_at` | 3 nullable columns (additive db:push) |
| GIN index on `articles.tags` | index (additive) |
| `GET /api/feed-tags/queue` | new endpoint |
| `POST /api/feed-tags/bulk` | new endpoint |
| `GET /api/feed-tags?search=` | extend existing list endpoint with ILIKE filter |
| Tags tab queue-first redesign | client (`feed-tags-tab.tsx`) |

## Error handling

- Annotation: never blocks or fails the queue; partial annotation acceptable; malformed model output → those tags stay un-annotated and retry on next queue load.
- Bulk: per-item failure isolation; invalid status/id → 400 for the request (zod), storage miss → counted in `failed`.
- Enrichment query failure → 500 with the file's standard error idiom (queue is broken then, honestly).

## Testing

- Unit (vitest, existing patterns): annotation prompt builder + response parsing (valid, malformed, partial JSON), and the pure parts of queue assembly (threshold filtering, 30-day window math) extracted for testability. Trend *direction* is a trivial client-side comparison of the two server-provided counts and is not separately tested.
- Existing 84-test suite stays green; `npm run check` stays at 0.
- Runtime verification post-deploy (no local DB): queue returns enriched rows; annotation columns populate after first load; bulk endpoint applies and reports.

## Out of scope (explicit)

- Tag merging/aliasing ("ai" vs "artificial intelligence")
- Auto-apply of AI suggestions (revisit only if advise-only proves too chatty)
- Retroactive re-annotation or periodic re-analysis
- Multi-admin workflows
