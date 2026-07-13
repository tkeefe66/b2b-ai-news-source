# CLAUDE.md — b2b-ai-news-source

Architecture, feature inventory, and per-feature operational notes live in `replit.md` — keep its feature bullets updated when shipping. This file holds only the always-relevant working rules.

## Verification gates

- `npm run check` (tsc) must pass with **0 errors** — that is the baseline, not "no new errors".
- `npm run test` (vitest, `server/**` + `shared/**`) must stay green; `npm run build` must succeed before merging client changes.
- **No local runtime exists**: `.env` is unreadable locally and the dev server cannot boot (AI SDK clients instantiate at import). The gates are typecheck + tests + post-deploy production smoke — never claim runtime verification happened locally.
- Test files importing anything that transitively imports `server/ai-models.ts` MUST `vi.mock` it before the import.

## Deploys & production DB (Railway — the only target)

- Deploy = push to `main` (auto-deploy). Apply schema changes FIRST, interactively, from a terminal:
  ```bash
  DATABASE_URL="$(railway variables --service Postgres --kv | grep '^DATABASE_PUBLIC_URL=' | cut -d= -f2-)" npm run db:push
  ```
  `railway run` injects the internal host (`postgres.railway.internal`), which is unresolvable locally — always use the public proxy URL as above. The same pattern (a small node script + `pg` via `createRequire`) serves read-only prod queries.
- **drizzle drop-trap**: every DB object created at runtime MUST be mirrored in `shared/schema.ts` (see the modeled `search_vector` column and `source_fetch_failures` table) or `db:push` will propose dropping it. Any UNEXPECTED drop in the push plan → abort and reconcile the schema; never accept a drop you can't explain.
- Single-replica assumptions: the Morning Brief scheduler and the tag sweep use per-process guards — do not scale the service above 1 replica without moving their claims into SQL.

## Hard-won gotchas

- The prod bundle is CJS (`script/build.ts`, esbuild) with deps external except an allowlist — ESM-only packages (e.g. `p-retry`) must be added to that allowlist or production fails at runtime while dev and tests pass.
- `chatCompletion`'s `jsonMode` option is honored only by the gemini branch — it is a **no-op for claude-\* models**. Rely on prompt shape + defensive parsing instead.
- Feed-tag semantics: `articles.tags = NULL` means "no tag info yet" (the daily sweep picks it up); `[]` means "examined, nothing fits". `feed_tags.article_count` counts ingested articles only — increment via `incrementTagCounts` after successful inserts, never inside `upsertFeedTags` (that was a shipped-and-fixed counter-inflation bug).
- AI is advise-only in tag moderation: no code path may write a tag status except the explicit admin endpoints.
