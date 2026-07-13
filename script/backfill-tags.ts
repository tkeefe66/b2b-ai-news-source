import pg from "pg";
import { chatCompletion } from "../server/ai-models";
import { buildBackfillPrompt, parseBackfillResponse } from "../server/tag-backfill";
import type { BackfillArticle } from "../server/tag-backfill";

const BATCH_SIZE = 25;
const DEFAULT_LIMIT = 1_000_000;
const DEFAULT_CONCURRENCY = 4;
const RETRY_DELAY_MS = 5000;
const PROGRESS_EVERY_N_BATCHES = 10;
const MODEL = "claude-haiku-4-5-20251001";

interface Args {
  limit: number;
  recomputeOnly: boolean;
  concurrency: number;
}

function parseArgs(argv: string[]): Args {
  let limit = DEFAULT_LIMIT;
  let recomputeOnly = false;
  let concurrency = DEFAULT_CONCURRENCY;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--limit") {
      const val = Number(argv[++i]);
      if (!Number.isFinite(val) || val <= 0) {
        throw new Error(`Invalid --limit value: ${argv[i]}`);
      }
      limit = val;
    } else if (arg === "--recompute-only") {
      recomputeOnly = true;
    } else if (arg === "--concurrency") {
      const val = Number(argv[++i]);
      if (!Number.isFinite(val) || val <= 0) {
        throw new Error(`Invalid --concurrency value: ${argv[i]}`);
      }
      concurrency = val;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { limit, recomputeOnly, concurrency };
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface Counters {
  processedBatches: number;
  tagged: number;
  empty: number;
  skipped: number;
}

async function processBatch(
  pool: pg.Pool,
  vocabulary: string[],
  vocabularySet: Set<string>,
  batch: BackfillArticle[],
  counters: Counters
): Promise<void> {
  const expectedIds = batch.map((a) => a.id);
  const prompt = buildBackfillPrompt(vocabulary, batch);

  let raw: string | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      raw = await chatCompletion({
        model: MODEL,
        messages: [{ role: "user", content: prompt }],
        maxTokens: 4096,
      });
      break;
    } catch (err) {
      if (attempt === 0) {
        console.error(
          `Batch [${expectedIds[0]}..${expectedIds[expectedIds.length - 1]}] failed, retrying in 5s:`,
          err instanceof Error ? err.message : err
        );
        await sleep(RETRY_DELAY_MS);
      } else {
        console.error(
          `Batch [${expectedIds[0]}..${expectedIds[expectedIds.length - 1]}] failed twice, skipping:`,
          err instanceof Error ? err.message : err
        );
      }
    }
  }

  if (raw === null) {
    counters.skipped += batch.length;
    return;
  }

  const results = parseBackfillResponse(raw, expectedIds, vocabularySet);
  const returnedIds = new Set(results.map((r) => r.id));

  for (const result of results) {
    await pool.query("UPDATE articles SET tags = $1 WHERE id = $2 AND tags IS NULL", [
      result.tags,
      result.id,
    ]);
    if (result.tags.length > 0) {
      counters.tagged++;
    } else {
      counters.empty++;
    }
  }

  const missing = expectedIds.filter((id) => !returnedIds.has(id));
  counters.skipped += missing.length;
}

async function runWorkerPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  let nextIndex = 0;
  async function run(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()));
}

async function recomputeArticleCounts(pool: pg.Pool): Promise<void> {
  const updateResult = await pool.query(`
    UPDATE feed_tags ft SET article_count = COALESCE(sub.cnt, 0)
    FROM (SELECT t.tag AS name, COUNT(*)::int AS cnt
          FROM articles a CROSS JOIN LATERAL unnest(a.tags) AS t(tag)
          GROUP BY t.tag) sub
    WHERE ft.name = sub.name;
  `);
  console.log(`Recomputed article_count for ${updateResult.rowCount} feed_tags rows.`);

  const top = await pool.query(
    "SELECT name, status, article_count FROM feed_tags ORDER BY article_count DESC LIMIT 15"
  );
  console.log("Top 15 tags by article_count:");
  for (const row of top.rows) {
    console.log(`  ${row.name} (${row.status}): ${row.article_count}`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const connectionString = process.env.BACKFILL_DATABASE_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("ERROR: BACKFILL_DATABASE_URL or DATABASE_URL must be set.");
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString });

  try {
    await pool.query("SELECT 1");
  } catch (err) {
    console.error("ERROR: database unreachable:", err instanceof Error ? err.message : err);
    process.exit(1);
  }

  if (args.recomputeOnly) {
    await recomputeArticleCounts(pool);
    await pool.end();
    console.log("Done (recompute-only).");
    return;
  }

  const vocabResult = await pool.query<{ name: string }>(
    "SELECT name FROM feed_tags WHERE status IN ('pending','approved') ORDER BY name"
  );
  const vocabulary = vocabResult.rows.map((r) => r.name);
  const vocabularySet = new Set(vocabulary);

  if (vocabulary.length === 0) {
    console.error("ERROR: feed_tags vocabulary is empty (no pending/approved tags). Aborting.");
    await pool.end();
    process.exit(1);
  }

  console.log(`Loaded ${vocabulary.length} vocabulary tags.`);

  const articlesResult = await pool.query<{
    id: number;
    title: string;
    description: string | null;
    source_name: string | null;
    category: string | null;
  }>(
    `SELECT id, title, description, source_name, category FROM articles
     WHERE tags IS NULL AND published_at >= NOW() - INTERVAL '90 days'
     ORDER BY id LIMIT $1`,
    [args.limit]
  );

  const articles: BackfillArticle[] = articlesResult.rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    sourceName: r.source_name,
    category: r.category,
  }));

  console.log(`Found ${articles.length} articles with tags IS NULL in the last 90 days.`);

  if (articles.length === 0) {
    await recomputeArticleCounts(pool);
    await pool.end();
    console.log("Done (nothing to backfill).");
    return;
  }

  const batches = chunk(articles, BATCH_SIZE);
  const counters: Counters = { processedBatches: 0, tagged: 0, empty: 0, skipped: 0 };
  const startTime = Date.now();

  await runWorkerPool(batches, args.concurrency, async (batch) => {
    await processBatch(pool, vocabulary, vocabularySet, batch, counters);
    counters.processedBatches++;
    if (counters.processedBatches % PROGRESS_EVERY_N_BATCHES === 0) {
      const processedArticles = counters.tagged + counters.empty + counters.skipped;
      const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(
        `${processedArticles}/${articles.length} articles, tagged=${counters.tagged}, empty=${counters.empty}, skipped=${counters.skipped}, elapsed=${elapsedSec}s`
      );
    }
  });

  const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(
    `Finished: ${articles.length} articles processed, tagged=${counters.tagged}, empty=${counters.empty}, skipped=${counters.skipped}, elapsed=${elapsedSec}s`
  );

  await recomputeArticleCounts(pool);
  await pool.end();
  console.log("Done.");
}

main().catch((err) => {
  console.error("FATAL:", err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
