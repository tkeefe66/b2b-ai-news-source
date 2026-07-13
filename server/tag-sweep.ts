import { storage } from "./storage";
import { chatCompletion } from "./ai-models";
import { buildBackfillPrompt, parseBackfillResponse, type BackfillArticle } from "./tag-backfill";

const MODEL = "claude-haiku-4-5-20251001";
const CHUNK_SIZE = 25;
const SWEEP_WINDOW_DAYS = 7;
const SWEEP_CAP = 5000;

export interface TagUntaggedResult {
  tagged: number;
  empty: number;
  skipped: number;
}

// Batched AI tagging shared by the real-time NewsAPI path and the daily sweep.
// LLM/parse failures on a chunk are logged and counted as skipped — never thrown.
// DB errors (guarded write / count increment) propagate, since the caller (sweepRecentUntagged)
// needs to know when the database itself is unavailable rather than silently losing writes.
export async function tagUntaggedArticles(articles: BackfillArticle[]): Promise<TagUntaggedResult> {
  const counters: TagUntaggedResult = { tagged: 0, empty: 0, skipped: 0 };
  if (articles.length === 0) return counters;

  const vocabulary = await storage.getTagVocabulary();
  if (vocabulary.length === 0) {
    console.error("tag-sweep: vocabulary is empty (no pending/approved feed_tags) — skipping all articles");
    counters.skipped = articles.length;
    return counters;
  }
  const vocabularySet = new Set(vocabulary);

  for (let i = 0; i < articles.length; i += CHUNK_SIZE) {
    const chunk = articles.slice(i, i + CHUNK_SIZE);
    const expectedIds = chunk.map((a) => a.id);

    let raw: string;
    try {
      const prompt = buildBackfillPrompt(vocabulary, chunk);
      raw = await chatCompletion({
        model: MODEL,
        messages: [{ role: "user", content: prompt }],
        maxTokens: 4096,
      });
    } catch (err) {
      console.error(
        `tag-sweep: chunk [${expectedIds[0]}..${expectedIds[expectedIds.length - 1]}] LLM call failed, skipping:`,
        err instanceof Error ? err.message : err
      );
      counters.skipped += chunk.length;
      continue;
    }

    const results = parseBackfillResponse(raw, expectedIds, vocabularySet);
    const returnedIds = new Set(results.map((r) => r.id));

    for (const result of results) {
      const wrote = await storage.setArticleTagsIfNull(result.id, result.tags);
      if (!wrote) continue; // already tagged by another run — don't double-count
      if (result.tags.length > 0) {
        counters.tagged++;
        await storage.incrementTagCounts(result.tags);
      } else {
        counters.empty++;
      }
    }

    const missing = expectedIds.filter((id) => !returnedIds.has(id));
    counters.skipped += missing.length;
  }

  return counters;
}

// Daily catch-up: tags anything still NULL in the last 7 days, then recomputes all
// feed_tags.article_count wholesale (self-corrects any incremental drift from real-time tagging
// races). Scheduler-safe — catches and logs everything, never throws.
export async function sweepRecentUntagged(): Promise<void> {
  try {
    const articles = await storage.getUntaggedRecentArticles(SWEEP_WINDOW_DAYS, SWEEP_CAP);
    if (articles.length === 0) {
      console.log("tag-sweep: no untagged articles in the last 7 days");
      return;
    }

    const result = await tagUntaggedArticles(articles);
    const recomputed = await storage.recomputeTagCounts();
    console.log(
      `tag-sweep: processed ${articles.length} articles (tagged=${result.tagged}, empty=${result.empty}, skipped=${result.skipped}), recomputed ${recomputed} feed_tags rows`
    );
  } catch (err) {
    console.error("tag-sweep: sweep run failed (non-fatal):", err instanceof Error ? err.message : err);
  }
}
