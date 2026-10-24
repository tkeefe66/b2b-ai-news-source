import { createHash } from "node:crypto";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type pg from "pg";
import * as schema from "@shared/schema";

const DAY_MS = 86_400_000;
const ARTICLE_DAYS = 30;
const RECEIPT_DAYS = 90;
// A transaction lock shared by news insertion and each cleanup batch; the second
// lock is session-scoped and only excludes overlapping retention jobs.
const LOCK_NAMESPACE = 724301;
const WRITE_LOCK = 1;
const RUN_LOCK = 2;
const NEWS_PREDICATE = `a.link NOT LIKE 'upload://%'
  AND NOT EXISTS (SELECT 1 FROM sources s WHERE s.id = a.source_id AND s.feed_url LIKE 'upload://%')`;
const AGE_EXPRESSION = "LEAST(COALESCE(a.published_at, a.created_at), a.created_at)";

function identityKeys(link: string, sourceId?: number | null, guid?: string | null): string[] {
  const values = [`link:${link}`];
  if (sourceId != null && guid) values.push(`guid:${sourceId}:${guid}`);
  return values.map(value => createHash("sha256").update(value).digest("hex"));
}

// Called by both RSS and NewsAPI. The age check, identity receipts and insertion
// are atomic, including when a cleanup batch deletes the previous article row.
export async function ingestNewsArticle(
  db: NodePgDatabase<typeof schema>, article: schema.InsertArticle, now = new Date(),
): Promise<schema.Article | undefined> {
  const rawDate = article.publishedAt?.getTime();
  const publishedAt = rawDate != null && Number.isFinite(rawDate)
    ? new Date(Math.min(rawDate, now.getTime())) : now;
  const keys = identityKeys(article.link, article.sourceId, article.guid);
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${LOCK_NAMESPACE}, ${WRITE_LOCK})`);
    const [seen] = await tx.select({ key: schema.articleSeenKeys.keyHash })
      .from(schema.articleSeenKeys).where(inArray(schema.articleSeenKeys.keyHash, keys)).limit(1);
    await tx.insert(schema.articleSeenKeys).values(keys.map(keyHash => ({ keyHash, lastSeenAt: now })))
      .onConflictDoUpdate({ target: schema.articleSeenKeys.keyHash, set: { lastSeenAt: sql`GREATEST(article_seen_keys.last_seen_at, excluded.last_seen_at)` } });
    if (seen || publishedAt.getTime() < now.getTime() - ARTICLE_DAYS * DAY_MS) return undefined;

    // Also recognize pre-retention rows that don't have receipts yet.
    const [existing] = await tx.select({ id: schema.articles.id, guid: schema.articles.guid, sourceId: schema.articles.sourceId })
      .from(schema.articles).where(or(eq(schema.articles.link, article.link),
        article.sourceId != null && article.guid
          ? and(eq(schema.articles.sourceId, article.sourceId), eq(schema.articles.guid, article.guid)) : undefined,
      )).limit(1);
    if (existing) {
      if (article.guid && !existing.guid && existing.sourceId === article.sourceId) {
        await tx.update(schema.articles).set({ guid: article.guid }).where(eq(schema.articles.id, existing.id));
      }
      return undefined;
    }
    const [created] = await tx.insert(schema.articles).values({
      ...article, publishedAt, content: null, description: article.description?.slice(0, 500) || null,
    }).returning();
    return created;
  });
}

export interface RetentionOptions {
  now?: Date;
  batchSize?: number;
  dryRun?: boolean;
  /** Operator/tests may postpone ordinary vacuum; never runs VACUUM FULL automatically. */
  vacuum?: boolean;
}

export async function runArticleRetention(pool: pg.Pool, options: RetentionOptions = {}) {
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("Article retention requires a valid current date");
  const cutoff = new Date(now.getTime() - ARTICLE_DAYS * DAY_MS).toISOString();
  const receiptCutoff = new Date(now.getTime() - RECEIPT_DAYS * DAY_MS).toISOString();
  const batchSize = options.batchSize ?? 500;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 2000) throw new Error("Retention batch size must be between 1 and 2000");
  const result = { cutoff, dryRun: !!options.dryRun, skipped: false, expired: 0, bodies: 0, deleted: 0, cleared: 0, receiptsExpired: 0 };
  const client = await pool.connect();
  let locked = false;
  let discardClient = false;
  async function transaction<T>(work: () => Promise<T>): Promise<T> {
    await client.query("BEGIN");
    try {
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query("SET LOCAL statement_timeout = '30s'");
      await client.query("SELECT pg_advisory_xact_lock($1, $2)", [LOCK_NAMESPACE, WRITE_LOCK]);
      const value = await work();
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => { discardClient = true; });
      throw error;
    }
  }
  try {
    if (!options.dryRun) {
      const claim = await client.query("SELECT pg_try_advisory_lock($1, $2) AS acquired", [LOCK_NAMESPACE, RUN_LOCK]);
      locked = claim.rows[0].acquired;
      if (!locked) return { ...result, skipped: true };
    }
    const preview = await client.query(`SELECT
      count(*) FILTER (WHERE ${AGE_EXPRESSION} < $1)::int AS expired,
      count(*) FILTER (WHERE content IS NOT NULL)::int AS bodies
      FROM articles a WHERE ${NEWS_PREDICATE}`, [cutoff]);
    Object.assign(result, preview.rows[0]);
    if (options.dryRun) return result;
    console.log(`Article retention: starting ${JSON.stringify(result)}`);

    while (true) {
      const count = await transaction(async () => {
        const expired = await client.query(`DELETE FROM article_seen_keys WHERE key_hash IN
          (SELECT key_hash FROM article_seen_keys WHERE last_seen_at < $1 ORDER BY last_seen_at LIMIT $2)`, [receiptCutoff, batchSize]);
        return expired.rowCount ?? 0;
      });
      result.receiptsExpired += count;
      if (count < batchSize) break;
    }
    while (true) {
      const count = await transaction(async () => {
        const { rows } = await client.query(`SELECT a.id, a.link, a.source_id, a.guid FROM articles a
          WHERE ${NEWS_PREDICATE} AND ${AGE_EXPRESSION} < $1 ORDER BY a.id LIMIT $2 FOR UPDATE OF a`, [cutoff, batchSize]);
        if (!rows.length) return 0;
        const keys = Array.from(new Set(rows.flatMap(row => identityKeys(row.link, row.source_id, row.guid))));
        await client.query(`INSERT INTO article_seen_keys(key_hash, last_seen_at)
          SELECT unnest($1::text[]), $2::timestamp ON CONFLICT (key_hash)
          DO UPDATE SET last_seen_at = GREATEST(article_seen_keys.last_seen_at, excluded.last_seen_at)`, [keys, now.toISOString()]);
        // Decrement cached counts atomically; do not overwrite tag moderation status.
        await client.query(`WITH removed AS (DELETE FROM articles WHERE id = ANY($1::int[]) RETURNING tags),
          counts AS (SELECT tag, count(*)::int AS n FROM removed CROSS JOIN LATERAL unnest(tags) AS tag GROUP BY tag)
          UPDATE feed_tags f SET article_count = GREATEST(0, f.article_count - counts.n) FROM counts WHERE f.name = counts.tag`, [rows.map(row => row.id)]);
        return rows.length;
      });
      result.deleted += count;
      if (count < batchSize) break;
      if (result.deleted % 10000 === 0) console.log(`Article retention: deleted ${result.deleted} expired news rows`);
    }
    while (true) {
      const count = await transaction(async () => {
        const cleared = await client.query(`UPDATE articles SET content = NULL WHERE id IN
          (SELECT a.id FROM articles a WHERE ${NEWS_PREDICATE} AND a.content IS NOT NULL ORDER BY a.id LIMIT $1)`, [batchSize]);
        return cleared.rowCount ?? 0;
      });
      result.cleared += count;
      if (count < batchSize) break;
    }
    if (options.vacuum !== false && (result.deleted || result.cleared || result.receiptsExpired)) {
      // Ordinary vacuum allows concurrent readers/writers and makes space reusable.
      await client.query("VACUUM (ANALYZE) articles, article_seen_keys");
    }
    console.log(`Article retention: completed ${JSON.stringify(result)}`);
    return result;
  } finally {
    if (locked) {
      try { await client.query("SELECT pg_advisory_unlock($1, $2)", [LOCK_NAMESPACE, RUN_LOCK]); }
      catch { discardClient = true; }
    }
    client.release(discardClient);
  }
}

export function startArticleRetention(run: () => Promise<unknown>): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await run(); }
    catch (error) {
      console.error("Article retention failed; will retry hourly. Check database availability and the retention migration:", error instanceof Error ? error.message : String(error));
    } finally { running = false; }
  };
  const boot = setTimeout(() => void tick(), 60_000);
  const interval = setInterval(() => void tick(), 3_600_000);
  boot.unref();
  interval.unref();
  console.log("Article retention scheduled: startup in 1 minute, then hourly; news 30 days, identity receipts 90 days since last seen");
  return () => { clearTimeout(boot); clearInterval(interval); };
}
