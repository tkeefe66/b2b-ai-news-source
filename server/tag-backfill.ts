import { z } from "zod";

const DESCRIPTION_MAX = 300;
const MAX_TAGS = 6;

export interface BackfillArticle {
  id: number;
  title: string;
  description: string | null;
  sourceName: string | null;
  category: string | null;
}

export interface BackfillResult {
  id: number;
  tags: string[]; // subset of vocabulary, deduped, max 6, may be empty
}

const backfillEntrySchema = z.object({
  id: z.number().int(),
  tags: z.array(z.string()),
});

export function buildBackfillPrompt(vocabulary: string[], articles: BackfillArticle[]): string {
  const articleBlocks = articles
    .map((a) => {
      const description = (a.description ?? "").substring(0, DESCRIPTION_MAX);
      const lines = [
        `- id: ${a.id}`,
        `  title: ${JSON.stringify(a.title)}`,
        `  source: ${a.sourceName ?? "unknown"}`,
        `  category: ${a.category ?? "unknown"}`,
        `  description: ${JSON.stringify(description)}`,
      ];
      return lines.join("\n");
    })
    .join("\n");

  return [
    "You are tagging historic articles for a B2B AI/martech news aggregator.",
    "For EACH article below, assign 0 to 6 tags chosen EXACTLY (verbatim, lowercase) from the vocabulary list — never invent a tag not in this list. An empty array is correct when nothing in the vocabulary fits well.",
    "",
    "Vocabulary:",
    vocabulary.join(", "),
    "",
    "Articles:",
    articleBlocks,
    "",
    'Respond with ONLY a JSON array: [{"id": <number>, "tags": ["...", ...]}] with exactly one entry per article.',
  ].join("\n");
}

export function parseBackfillResponse(
  raw: string,
  expectedIds: number[],
  vocabulary: Set<string>
): BackfillResult[] {
  const stripped = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const allowedIds = new Set(expectedIds);
  const results: BackfillResult[] = [];
  for (const entry of parsed) {
    const check = backfillEntrySchema.safeParse(entry);
    if (!check.success || !allowedIds.has(check.data.id)) continue;
    const deduped = Array.from(new Set(check.data.tags.filter((t) => vocabulary.has(t))));
    results.push({ id: check.data.id, tags: deduped.slice(0, MAX_TAGS) });
  }
  return results;
}
