import { storage } from "./storage";
import type { InsertArticle, Article } from "@shared/schema";
import { htmlToText } from "./sanitize";
import { tagUntaggedArticles } from "./tag-sweep";
import type { BackfillArticle } from "./tag-backfill";

const NEWSAPI_BASE = "https://newsapi.org/v2";

export const DEFAULT_NEWSAPI_QUERIES = [
  { query: "martech OR marketing technology", category: "GTM Tech" },
  { query: "B2B sales technology OR salestech", category: "GTM Tech" },
  { query: "AI marketing automation", category: "AI" },
  { query: "CRM software enterprise", category: "CRM & Enterprise" },
  { query: "demand generation B2B", category: "B2B Mktg & Sales" },
  { query: "revenue operations OR RevOps", category: "GTM Tech" },
  { query: "marketing automation platform", category: "GTM Tech" },
  { query: "SaaS acquisition merger funding", category: "Deals & Markets" },
];

interface NewsAPIArticle {
  title: string;
  url: string;
  description: string | null;
  content: string | null;
  author: string | null;
  publishedAt: string;
  urlToImage: string | null;
  source: { id: string | null; name: string };
}

interface NewsAPIResponse {
  status: string;
  totalResults: number;
  articles: NewsAPIArticle[];
}

export async function seedDefaultNewsapiQueries(): Promise<number> {
  const existing = await storage.getNewsapiQueries();
  if (existing.length > 0) return 0;

  let created = 0;
  for (const q of DEFAULT_NEWSAPI_QUERIES) {
    await storage.createNewsapiQuery({ query: q.query, category: q.category, isActive: true });
    created++;
  }
  return created;
}

export async function fetchNewsAPIArticles(): Promise<{ total: number; errors: number }> {
  const apiKey = process.env.NEWSAPI_KEY;
  if (!apiKey) {
    console.log("NewsAPI: No API key configured, skipping");
    return { total: 0, errors: 0 };
  }

  await seedDefaultNewsapiQueries();

  const queries = await storage.getActiveNewsapiQueries();
  if (queries.length === 0) {
    console.log("NewsAPI: No active queries configured, skipping");
    return { total: 0, errors: 0 };
  }

  let total = 0;
  let errors = 0;
  const createdRows: Article[] = [];

  for (const query of queries) {
    try {
      const params = new URLSearchParams({
        q: query.query,
        language: "en",
        sortBy: "publishedAt",
        pageSize: "20",
        apiKey,
      });

      const response = await fetch(`${NEWSAPI_BASE}/everything?${params}`);
      if (!response.ok) {
        const errText = await response.text();
        console.error(`NewsAPI error for "${query.query}": ${response.status} ${errText}`);
        errors++;
        continue;
      }

      const data: NewsAPIResponse = await response.json();

      for (const item of data.articles) {
        if (!item.url || !item.title) continue;
        if (item.title === "[Removed]") continue;

        const existing = await storage.getArticleByLink(item.url);
        if (existing) continue;

        const description = item.description ? htmlToText(item.description).substring(0, 500) : "";
        const content = item.content ? htmlToText(item.content).substring(0, 25000) : "";

        const article: InsertArticle = {
          title: item.title,
          link: item.url,
          description: description || null,
          content: content || null,
          author: item.author || null,
          publishedAt: item.publishedAt ? new Date(item.publishedAt) : new Date(),
          sourceId: null,
          sourceName: `NewsAPI: ${item.source.name}`,
          category: query.category,
          imageUrl: item.urlToImage || null,
          isRead: false,
        };

        const created = await storage.createArticle(article);
        createdRows.push(created);
        total++;
      }
    } catch (err) {
      console.error(`NewsAPI fetch error for "${query.query}":`, err instanceof Error ? err.message : err);
      errors++;
    }
  }

  console.log(`NewsAPI: Added ${total} articles with ${errors} errors`);

  if (createdRows.length > 0) {
    try {
      const backfillArticles: BackfillArticle[] = createdRows.map((a) => ({
        id: a.id,
        title: a.title,
        description: a.description,
        sourceName: a.sourceName,
        category: a.category,
      }));
      const tagResult = await tagUntaggedArticles(backfillArticles);
      console.log(
        `NewsAPI: real-time tagging — tagged=${tagResult.tagged}, empty=${tagResult.empty}, skipped=${tagResult.skipped}`
      );
    } catch (err) {
      console.error("NewsAPI: real-time tagging failed (non-blocking):", err instanceof Error ? err.message : err);
    }
  }

  return { total, errors };
}
