import { storage } from "./storage";
import { chatCompletion } from "./ai-models";

export async function generateDigestsForNewArticles(): Promise<{ digestsCreated: number; articlesProcessed: number }> {
  const undigested = await storage.getUndigestedArticleIds();
  if (undigested.length === 0) {
    return { digestsCreated: 0, articlesProcessed: 0 };
  }

  const byCategory: Record<string, typeof undigested> = {};
  for (const article of undigested) {
    const cat = article.category || "General";
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(article);
  }

  let digestsCreated = 0;

  const categoryEntries = Object.entries(byCategory);
  const PARALLEL_LIMIT = 5;

  for (let i = 0; i < categoryEntries.length; i += PARALLEL_LIMIT) {
    const batch = categoryEntries.slice(i, i + PARALLEL_LIMIT);
    const promises = batch.map(async ([category, arts]) => {
      try {
        const articleText = arts.map(a =>
          `- "${a.title}" (${a.sourceName || "Unknown"}, ${a.publishedAt ? new Date(a.publishedAt).toLocaleDateString() : "recent"}): ${a.description?.substring(0, 100) || ""}`
        ).join("\n");

        const digest = await chatCompletion({
          model: "claude-haiku-4-5-20251001",
          messages: [
            {
              role: "system",
              content: `You are a B2B MarTech and SalesTech intelligence analyst. Condense the following ${arts.length} articles in the "${category}" category into a dense, information-rich digest (300-500 words). Focus on:
1. Key themes and patterns across the articles
2. Notable companies, products, and announcements
3. Emerging trends and market signals
4. Contrarian or surprising developments
5. Implications for B2B marketing and sales technology

Be specific: cite company names, product names, and concrete data points. Do NOT pad with generic observations. Every sentence should carry information value.

WRITING STYLE RULE (STRICTLY ENFORCED): Never use a hyphen "-", double-hyphen "--", em-dash "—", or en-dash "–" to connect or bridge clauses or sentences. Do not use dashes as punctuation between thoughts. Instead, use periods, commas, semicolons, colons, or parentheses to separate ideas. Hyphens in compound words (e.g., "go-to-market", "data-driven") and as bullet point markers are fine.`
            },
            {
              role: "user",
              content: `Condense these ${arts.length} "${category}" articles into a dense digest:\n\n${articleText}`
            }
          ],
          maxTokens: 1000,
        });

        if (digest) {
          const dates = arts
            .filter(a => a.publishedAt)
            .map(a => new Date(a.publishedAt!).getTime());
          const periodStart = dates.length > 0 ? new Date(Math.min(...dates)) : new Date();
          const periodEnd = dates.length > 0 ? new Date(Math.max(...dates)) : new Date();

          await storage.createArticleDigest({
            periodStart,
            periodEnd,
            category,
            articleCount: arts.length,
            digest,
            articleIds: arts.map(a => a.id),
          });
          digestsCreated++;
        }
      } catch (err) {
        console.error(`[digest] Failed to generate digest for category "${category}":`, err);
      }
    });

    await Promise.all(promises);
  }

  console.log(`[digest] Created ${digestsCreated} digests from ${undigested.length} articles across ${categoryEntries.length} categories`);
  return { digestsCreated, articlesProcessed: undigested.length };
}
