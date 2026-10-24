# Article retention

Goal: keep 30 days of news for alerts while preserving briefs, knowledge-base data,
uploaded documents, and saved research. User approved production cleanup and automation.

Architecture: one retention module, an hourly startup-independent scheduler, and
transactional ingestion with compact SHA-256 identity receipts. Keep receipts for
90 days since last seen; refresh them when a feed repeats an item. Reject published
stories older than 30 days even after their receipt expires. Use the earlier of
publication and ingestion time so future publisher dates cannot defeat expiration.
Store descriptions/links, not full news bodies. Upload sources and upload links are
excluded. Batched deletion and receipt creation commit together. A shared transaction
advisory lock serializes ingestion and each cleanup batch; a separate session lock
prevents overlapping cleanup runs. Normal vacuum reuses freed space; perform one
explicit VACUUM FULL after the initial production cleanup to return disk space.

Stack: TypeScript, pg, Drizzle, Vitest, isolated Docker PostgreSQL integration tests.
Spec: approved 30-day plan in this chat.

Global constraints: no changes to briefs/knowledge/research records; no paid AI or
manual email calls; migration must be additive and modeled in shared/schema.ts;
production target is the existing B2B AI News Railway service and Postgres.

Review focus: concurrency between ingestion and pruning; source/GUID and URL identity
collisions; uploaded documents; NULL/future publisher dates; bounded receipts;
partial failures; UTC timestamps; preservation of brief snapshots; disk reclamation.

## Task 1: implement and verify retention

Files: server/article-retention.ts and tests, server/storage.ts, server/rss.ts,
server/newsapi.ts, server/ingest.ts and tests, server/index.ts, shared/schema.ts,
script/article-retention.ts, migrations, replit.md, source report copy.

- [ ] Write behavioral tests for body stripping, cutoff boundaries, upload preservation,
  receipt deduplication, expiry, rollback, concurrency, and repeated runs. Run RED.
  Expected: missing retention behavior fails.
- [ ] Implement transactional ingestion, batched retention, receipt expiration, daily
  reusable-space maintenance, startup/hourly retry and dry-run/apply CLI.
- [ ] Run tests against isolated PostgreSQL, mutation-check key cutoff/preservation
  guards, then run npm run check, npm run test, npm run build.
  Expected: zero type errors, green tests and build.
- [ ] Fresh-context code review; fix consequential findings with regression tests.
- [ ] Capture production preview and protected-table fingerprints, apply additive
  migration, commit, push main, and verify exact deployment reaches SUCCESS.
- [ ] Apply cleanup, reclaim physical space, compare protected-table fingerprints,
  and verify health, recent data, scheduler logs, and final disk usage.
  Expected: no expired news or full news bodies, protected records unchanged,
  automatic retention active, substantial disk space recovered.

## Execution evidence

- RED: four existing ingest assertions failed when bodies were still retained;
  nine new retention tests failed against the no-retention baseline.
- GREEN: 33 files / 263 tests passed, including eight real PostgreSQL integration
  tests. `npm run check` passed with zero errors; `npm run build` succeeded.
  Build emitted the existing PostCSS `from`-option warning.
- Mutation checks: changing `<` to `<=`, removing upload-source protection, and
  ignoring identity receipts each failed its named regression test. Source restored
  byte-for-byte, then the full suite passed again.
- Fresh reviewer approved with no blocking findings. Minor (deferred): add a
  deterministic ingestion-versus-pruning race test; both paths currently acquire
  the same database transaction lock. Concurrent inserts are covered.
- Ruling: historical article drilldowns stop at 30 days; saved report/brief text
  remains. This is the approved retention tradeoff; older source rows are unavailable.
- Ruling: undated items may return after 90 days without observation. Refreshing
  receipts on every observation plus a permanent age check for dated arrivals keeps
  storage bounded; the cost is occasional resurfacing of a truly undated old item.
- Ruling: initial physical compaction is an operator action; hourly runs use ordinary
  vacuum to keep space reusable without repeatedly locking readers.
- Production target confirmed: existing B2B AI News service and Postgres, production.
  Interactive `db:push` applied the additive schema successfully. Verified new
  receipt/retention indexes and all existing article indexes remain present.
- Recorded before-cleanup fingerprints for 24 protected tables and uploaded articles.
  Optional full database export was rejected by automatic approval review; no export
  occurred. Continue the authorized deletion using preservation fingerprints.
- Production deployment, cleanup, physical compaction and final preservation proof
  are the remaining operator steps, recorded in the task's result artifacts.

## Optional skill candidate

Proposed path: `.agents/skills/news-retention-operations/SKILL.md`.
Description: Use when changing `server/article-retention.ts`, applying news-retention
migrations, or reclaiming storage from the B2B AI News Railway Postgres volume.
Applies to retention policy, protected-table fingerprints, additive schema review,
initial compaction and production preservation checks. Nothing needs to move out of
AGENTS.md; this is a project-specific operational runbook. Scope test: the body would
not be safe unchanged in another repository, so project scope is appropriate.
Proposal only; no skill was created.
