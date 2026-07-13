# Real-Time Tagging + Daily Sweep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every article from every source gets tags within one fetch cycle (NewsAPI real-time) or one day (sweep), with counts self-correcting daily.

**Architecture:** New `server/tag-sweep.ts` orchestrates batched AI tagging via the existing `tag-backfill` prompt/parse helpers and four new storage methods; `newsapi.ts` calls it post-fetch; `index.ts` schedules a daily sweep + boot catch-up; `rss.ts` stores NULL (not []) when a feed has no categories.

**Tech Stack:** Existing stack. No new dependencies.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-13-realtime-tagging-and-sweep-design.md` — component contracts there are binding, including exact method signatures.
- Vocabulary = feed_tags with status IN ('pending','approved') ONLY — the AI must never be able to assign a blocked or rejected tag.
- All LLM work: model `claude-haiku-4-5-20251001`, maxTokens 4096, NO jsonMode (no-op for anthropic models here), chunks of 25 articles, reuse `buildBackfillPrompt`/`parseBackfillResponse` from `server/tag-backfill.ts` unchanged.
- Tag writes always guarded `AND tags IS NULL`; count increments only when the guarded update actually changed a row.
- Sweep window 7 days, cap 5,000 articles/run, boot catch-up after 2 minutes, interval 24h. All scheduler entry points log-and-continue on error (never crash the process).
- `[]` vs NULL semantics per spec decision 2. RSS blocked-gate and all other ingest behavior unchanged.
- `newsapi.ts` content parity per spec decision 4 (sanitize + 25k/500 caps).
- tsc 0 errors; 112/112 tests stay green; build succeeds. No db:push needed (no schema change).

---

### Task 1: Everything (single cohesive task — the pieces are interdependent)

**Files:**
- Create: `server/tag-sweep.ts`
- Modify: `server/storage.ts` (4 new methods per spec), `server/newsapi.ts`, `server/rss.ts` (one line), `server/index.ts` (scheduler block)

**Interfaces:**
- Consumes: `buildBackfillPrompt`, `parseBackfillResponse`, `BackfillArticle`, `BackfillResult` from `./tag-backfill`; `chatCompletion` from `./ai-models`; `incrementTagCounts` (exists) and the 4 new storage methods.
- Produces: `tagUntaggedArticles(articles): Promise<{tagged, empty, skipped}>` and `sweepRecentUntagged(): Promise<void>` from `./tag-sweep`.

- [ ] **Step 1:** Add the four storage methods per the spec's Storage additions section (interface + implementation; `recomputeTagCounts` must also zero counts for tags no longer on any article — two-statement or LEFT JOIN form, count rows affected)
- [ ] **Step 2:** Create `server/tag-sweep.ts` per the spec's component contract
- [ ] **Step 3:** Wire `newsapi.ts`: collect created rows, post-loop `tagUntaggedArticles` in try/catch; content/description sanitize+caps (import `htmlToText` from `./sanitize`)
- [ ] **Step 4:** `rss.ts` NULL-when-empty tags line
- [ ] **Step 5:** `index.ts` scheduler block (boot setTimeout 2min + setInterval 24h), matching the file's existing log style
- [ ] **Step 6:** `npm run check` (0), `npm run test` (112/112), `npm run build` (success)
- [ ] **Step 7:** Commit: `feat: real-time NewsAPI tagging + daily untagged sweep`

### Task 2: Verification (controller)

- [ ] Review diff; merge; deploy (no db:push); smoke: boot log shows sweep catch-up summary; post-NewsAPI-cycle articles have tags/[] not NULL; counts recompute.
