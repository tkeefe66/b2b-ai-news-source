import { db } from "./db";
import { eq, desc, sql, and, inArray, arrayContains, getTableColumns } from "drizzle-orm";
import {
  sources, articles, trendAnalyses, trendSnapshots, chatMessages, chatSessions, briefings, knowledgeEntries, companyAnalyses, thoughtLeadership, slideDesigns, pendingKnowledge, enablementContent, articleDigests, productKnowledge, productFeatures, newsapiQueries, tlDocuments, processingJobs, knowledgeReviews, dashboardViews, competitors, trendWatchlist, crawlJobs, crawlPages, crawlEntries, briefs, feedTags,
  type Source, type InsertSource,
  type Article, type InsertArticle,
  type TrendAnalysis, type InsertTrendAnalysis,
  type TrendSnapshot, type InsertTrendSnapshot,
  type ChatSession, type InsertChatSession,
  type ChatMessage, type InsertChatMessage,
  type Briefing, type InsertBriefing,
  type KnowledgeEntry, type InsertKnowledgeEntry,
  type CompanyAnalysis, type InsertCompanyAnalysis,
  type ThoughtLeadership, type InsertThoughtLeadership,
  type SlideDesign, type InsertSlideDesign,
  type PendingKnowledge, type InsertPendingKnowledge,
  type EnablementContent, type InsertEnablementContent,
  type ArticleDigest, type InsertArticleDigest,
  type ProductKnowledge, type InsertProductKnowledge,
  type ProductFeature, type InsertProductFeature,
  type NewsapiQuery, type InsertNewsapiQuery,
  type TlDocument, type InsertTlDocument,
  type ProcessingJob, type InsertProcessingJob,
  type KnowledgeReview, type InsertKnowledgeReview,
  type DashboardView, type InsertDashboardView,
  type Competitor, type InsertCompetitor,
  type TrendWatchlistItem, type InsertTrendWatchlistItem,
  type CrawlJob, type InsertCrawlJob,
  type CrawlPage, type InsertCrawlPage,
  type CrawlEntry, type InsertCrawlEntry,
  type Brief, type InsertBrief,
  type FeedTag, type FeedTagStatus,
} from "@shared/schema";

// List views (getArticles, getFilteredArticles) cap content at the pre-full-text length so
// /api/articles payloads stay bounded; full content is served by single-article fetches
// (getArticle, getArticlesByIds), which select all columns unmodified.
const { content: _fullContent, ...articleListColumns } = getTableColumns(articles);
const ARTICLE_LIST_SELECTION = {
  ...articleListColumns,
  content: sql<string | null>`LEFT(${articles.content}, 2000)`.as("content"),
};

export interface ArticleFilters {
  search?: string;
  category?: string;
  excludeCategory?: string;
  source?: string;
  tag?: string;
  dateRange?: "today" | "week" | "month" | "all" | "custom";
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
}

export interface IStorage {
  getSources(): Promise<Source[]>;
  getSource(id: number): Promise<Source | undefined>;
  createSource(source: InsertSource): Promise<Source>;
  updateSource(id: number, data: Partial<InsertSource>): Promise<Source | undefined>;
  deleteSource(id: number): Promise<void>;
  updateSourceLastFetched(id: number): Promise<void>;

  getArticles(limit?: number, offset?: number): Promise<Article[]>;
  getFilteredArticles(filters: ArticleFilters): Promise<{ articles: Article[]; total: number }>;
  getArticle(id: number): Promise<Article | undefined>;
  getArticlesByIds(ids: number[]): Promise<Article[]>;
  getArticleByLink(link: string): Promise<Article | undefined>;
  getArticleByGuid(sourceId: number, guid: string): Promise<Article | undefined>;
  setArticleGuid(id: number, guid: string): Promise<void>;
  createArticle(article: InsertArticle): Promise<Article>;
  getArticleCount(): Promise<number>;
  getArticlesBySource(sourceId: number): Promise<Article[]>;
  searchArticles(query: string): Promise<Article[]>;
  getDistinctCategories(): Promise<string[]>;
  getDistinctSourceNames(): Promise<string[]>;
  getSourcesByCategory(): Promise<Record<string, string[]>>;

  upsertFeedTags(tags: { name: string; displayName: string }[]): Promise<Record<string, FeedTagStatus>>;
  incrementTagCounts(names: string[]): Promise<void>;
  getFeedTags(status?: FeedTagStatus): Promise<FeedTag[]>;
  updateFeedTagStatus(id: number, status: FeedTagStatus): Promise<FeedTag | undefined>;
  getApprovedTagNames(): Promise<string[]>;

  getTrendAnalyses(limit?: number): Promise<TrendAnalysis[]>;
  createTrendAnalysis(analysis: InsertTrendAnalysis): Promise<TrendAnalysis>;
  getLatestTrendAnalysis(): Promise<TrendAnalysis | undefined>;
  deleteTrendAnalysis(id: number): Promise<void>;

  getTrendSnapshots(limit?: number): Promise<TrendSnapshot[]>;
  createTrendSnapshot(snapshot: InsertTrendSnapshot): Promise<TrendSnapshot>;
  getLatestTrendSnapshot(): Promise<TrendSnapshot | undefined>;
  deleteTrendSnapshot(id: number): Promise<void>;

  getTrendWatchlist(): Promise<TrendWatchlistItem[]>;
  createTrendWatchlistItem(item: InsertTrendWatchlistItem): Promise<TrendWatchlistItem>;
  updateTrendWatchlistItem(id: number, data: Partial<InsertTrendWatchlistItem>): Promise<TrendWatchlistItem | undefined>;
  deleteTrendWatchlistItem(id: number): Promise<void>;

  getChatSessions(): Promise<ChatSession[]>;
  getChatSession(id: number): Promise<ChatSession | undefined>;
  createChatSession(session: InsertChatSession): Promise<ChatSession>;
  updateChatSession(id: number, data: Partial<InsertChatSession>): Promise<ChatSession | undefined>;
  deleteChatSession(id: number): Promise<void>;
  getChatMessages(limit?: number): Promise<ChatMessage[]>;
  getChatMessagesBySession(sessionId: number): Promise<ChatMessage[]>;
  createChatMessage(message: InsertChatMessage): Promise<ChatMessage>;
  clearChatMessages(): Promise<void>;
  clearChatMessagesBySession(sessionId: number): Promise<void>;

  getBriefings(limit?: number): Promise<Briefing[]>;
  getBriefing(id: number): Promise<Briefing | undefined>;
  getLatestBriefing(): Promise<Briefing | undefined>;
  createBriefing(briefing: InsertBriefing): Promise<Briefing>;
  deleteBriefing(id: number): Promise<boolean>;

  // Morning Brief
  getBriefs(limit?: number): Promise<Brief[]>;
  getBrief(id: number): Promise<Brief | undefined>;
  getRealBriefByDate(briefDate: string): Promise<Brief | undefined>;
  getLatestRealBrief(): Promise<Brief | undefined>;
  createBrief(data: InsertBrief): Promise<Brief>;
  updateBrief(id: number, data: Partial<InsertBrief>): Promise<Brief | undefined>;

  dismissArticle(id: number): Promise<Article | undefined>;
  undismissArticle(id: number): Promise<Article | undefined>;
  getDismissalPatterns(): Promise<{ sources: Record<string, number>; categories: Record<string, number>; total: number }>;
  getRecentArticlesByCategory(days?: number): Promise<Record<string, Article[]>>;
  getArticlesByCategoryInRange(startDate: Date, endDate: Date): Promise<Record<string, Article[]>>;
  getArticlesByDateRange(startDate: Date, endDate: Date, category?: string): Promise<Article[]>;
  updateArticlesCategoryBySource(sourceId: number, category: string): Promise<void>;

  getKnowledgeEntries(): Promise<KnowledgeEntry[]>;
  getKnowledgeEntriesByIds(ids: number[]): Promise<KnowledgeEntry[]>;
  getKnowledgeEntry(id: number): Promise<KnowledgeEntry | undefined>;
  createKnowledgeEntry(entry: InsertKnowledgeEntry): Promise<KnowledgeEntry>;
  updateKnowledgeEntry(id: number, data: Partial<InsertKnowledgeEntry>): Promise<KnowledgeEntry | undefined>;
  deleteKnowledgeEntry(id: number): Promise<void>;
  deleteKnowledgeEntriesBySource(sourceUrl: string): Promise<number>;
  getActiveKnowledgeByCategory(): Promise<Record<string, KnowledgeEntry[]>>;

  getCompanyAnalyses(limit?: number): Promise<CompanyAnalysis[]>;
  getCompanyAnalysis(id: number): Promise<CompanyAnalysis | undefined>;
  createCompanyAnalysis(analysis: InsertCompanyAnalysis): Promise<CompanyAnalysis>;
  deleteCompanyAnalysis(id: number): Promise<void>;

  getThoughtLeadership(limit?: number): Promise<ThoughtLeadership[]>;
  getThoughtLeadershipById(id: number): Promise<ThoughtLeadership | undefined>;
  createThoughtLeadership(data: InsertThoughtLeadership): Promise<ThoughtLeadership>;
  deleteThoughtLeadership(id: number): Promise<void>;

  getSlideDesigns(): Promise<SlideDesign[]>;
  getApprovedSlideDesigns(): Promise<SlideDesign[]>;
  getSlideDesign(id: number): Promise<SlideDesign | undefined>;
  createSlideDesign(design: InsertSlideDesign): Promise<SlideDesign>;
  updateSlideDesign(id: number, data: Partial<InsertSlideDesign>): Promise<SlideDesign | undefined>;
  deleteSlideDesign(id: number): Promise<void>;
  getSlideDesignsByLayoutType(layoutType: string): Promise<SlideDesign[]>;

  getEnablementContent(limit?: number): Promise<EnablementContent[]>;
  createEnablementContent(data: InsertEnablementContent): Promise<EnablementContent>;
  updateEnablementContent(id: number, data: Partial<InsertEnablementContent>): Promise<EnablementContent | undefined>;
  deleteEnablementContent(id: number): Promise<void>;

  createPendingKnowledge(entry: InsertPendingKnowledge): Promise<PendingKnowledge>;
  getAllPendingKnowledge(): Promise<PendingKnowledge[]>;
  getPendingKnowledgeByBatch(batchId: string): Promise<PendingKnowledge[]>;
  updatePendingKnowledge(id: number, data: Partial<InsertPendingKnowledge>): Promise<PendingKnowledge | undefined>;
  deletePendingKnowledge(id: number): Promise<void>;
  approvePendingEntry(id: number): Promise<KnowledgeEntry>;
  hasUndigestedArticles(): Promise<boolean>;
  getLatestDigestCreatedAt(): Promise<Date | null>;

  getProductKnowledge(): Promise<ProductKnowledge[]>;
  getActiveProductKnowledge(): Promise<ProductKnowledge[]>;
  createProductKnowledge(entry: InsertProductKnowledge): Promise<ProductKnowledge>;
  updateProductKnowledge(id: number, data: Partial<InsertProductKnowledge>): Promise<ProductKnowledge | undefined>;
  deleteProductKnowledge(id: number): Promise<void>;

  getFeaturesByProduct(productId: number): Promise<ProductFeature[]>;
  getActiveFeaturesByProduct(productId: number): Promise<ProductFeature[]>;
  createProductFeature(entry: InsertProductFeature): Promise<ProductFeature>;
  updateProductFeature(id: number, data: Partial<InsertProductFeature>): Promise<ProductFeature | undefined>;
  deleteProductFeature(id: number): Promise<void>;
  deleteFeaturesByProduct(productId: number): Promise<void>;

  getNewsapiQueries(): Promise<NewsapiQuery[]>;
  getActiveNewsapiQueries(): Promise<NewsapiQuery[]>;
  createNewsapiQuery(entry: InsertNewsapiQuery): Promise<NewsapiQuery>;
  updateNewsapiQuery(id: number, data: Partial<InsertNewsapiQuery>): Promise<NewsapiQuery | undefined>;
  deleteNewsapiQuery(id: number): Promise<void>;

  getTlDocuments(): Promise<TlDocument[]>;
  getActiveTlDocuments(): Promise<TlDocument[]>;
  createTlDocument(doc: InsertTlDocument): Promise<TlDocument>;
  updateTlDocument(id: number, data: Partial<InsertTlDocument>): Promise<TlDocument | undefined>;
  deleteTlDocument(id: number): Promise<void>;

  createProcessingJob(job: InsertProcessingJob): Promise<ProcessingJob>;
  getProcessingJob(jobId: string): Promise<ProcessingJob | undefined>;
  getActiveProcessingJobs(): Promise<ProcessingJob[]>;
  getAllProcessingJobs(limit?: number): Promise<ProcessingJob[]>;
  updateProcessingJob(jobId: string, data: Partial<InsertProcessingJob>): Promise<ProcessingJob | undefined>;
  deleteProcessingJob(jobId: string): Promise<void>;
  cleanupOldProcessingJobs(): Promise<void>;

  createKnowledgeReview(review: InsertKnowledgeReview): Promise<KnowledgeReview>;
  getLatestKnowledgeReview(): Promise<KnowledgeReview | undefined>;
  getKnowledgeReviews(limit?: number): Promise<KnowledgeReview[]>;

  getDashboardViews(): Promise<DashboardView[]>;
  getDashboardView(id: number): Promise<DashboardView | undefined>;
  createDashboardView(view: InsertDashboardView): Promise<DashboardView>;
  updateDashboardView(id: number, data: Partial<InsertDashboardView>): Promise<DashboardView | undefined>;
  deleteDashboardView(id: number): Promise<void>;

  getCompetitors(): Promise<Competitor[]>;
  getCompetitor(id: number): Promise<Competitor | undefined>;
  createCompetitor(competitor: InsertCompetitor): Promise<Competitor>;
  updateCompetitor(id: number, data: Partial<InsertCompetitor>): Promise<Competitor | undefined>;
  deleteCompetitor(id: number): Promise<void>;

  getCrawlJobs(type?: string, competitorId?: number): Promise<CrawlJob[]>;
  getCrawlJob(id: number): Promise<CrawlJob | undefined>;
  createCrawlJob(job: InsertCrawlJob): Promise<CrawlJob>;
  updateCrawlJob(id: number, data: Partial<CrawlJob>): Promise<CrawlJob | undefined>;
  deleteCrawlJob(id: number): Promise<void>;

  getCrawlPages(jobId: number, status?: string): Promise<CrawlPage[]>;
  createCrawlPage(page: InsertCrawlPage): Promise<CrawlPage>;
  updateCrawlPage(id: number, data: Partial<CrawlPage>): Promise<CrawlPage | undefined>;

  getCrawlEntries(jobId: number, status?: string, limit?: number, offset?: number): Promise<{ entries: CrawlEntry[]; total: number }>;
  getCrawlEntry(id: number): Promise<CrawlEntry | undefined>;
  createCrawlEntry(entry: InsertCrawlEntry): Promise<CrawlEntry>;
  updateCrawlEntry(id: number, data: Partial<CrawlEntry>): Promise<CrawlEntry | undefined>;
  updateCrawlEntriesBatch(ids: number[], data: Partial<CrawlEntry>): Promise<void>;
  deleteCrawlEntriesByJob(jobId: number): Promise<void>;

  getArticleVolumeByDay(days: number, category?: string): Promise<Array<{ date: string; count: number; category: string }>>;
  getCompetitorMentions(days: number, dateFrom?: string, dateTo?: string): Promise<Array<{ date: string; competitor: string; count: number }>>;
  getDemandbaseMentions(days: number, dateFrom?: string, dateTo?: string): Promise<{ byDate: Array<{ date: string; count: number }>; byCategory: Array<{ category: string; count: number }>; total: number; topArticles: Article[] }>;
}

export class DatabaseStorage implements IStorage {
  async getSources(): Promise<Source[]> {
    return db.select().from(sources).orderBy(sources.name);
  }

  async getSource(id: number): Promise<Source | undefined> {
    const [source] = await db.select().from(sources).where(eq(sources.id, id));
    return source;
  }

  async createSource(source: InsertSource): Promise<Source> {
    const [created] = await db.insert(sources).values(source).returning();
    return created;
  }

  async updateSource(id: number, data: Partial<InsertSource>): Promise<Source | undefined> {
    const [updated] = await db.update(sources).set(data).where(eq(sources.id, id)).returning();
    return updated;
  }

  async deleteSource(id: number): Promise<void> {
    await db.delete(articles).where(eq(articles.sourceId, id));
    await db.delete(sources).where(eq(sources.id, id));
  }

  async updateSourceLastFetched(id: number): Promise<void> {
    await db.update(sources).set({ lastFetchedAt: new Date() }).where(eq(sources.id, id));
  }

  async getArticles(limit = 50, offset = 0): Promise<Article[]> {
    return db.select(ARTICLE_LIST_SELECTION).from(articles).where(eq(articles.dismissed, false)).orderBy(desc(articles.publishedAt)).limit(limit).offset(offset);
  }

  async getFilteredArticles(filters: ArticleFilters): Promise<{ articles: Article[]; total: number }> {
    const conditions = [eq(articles.dismissed, false)];

    if (filters.search) {
      const pattern = `%${filters.search}%`;
      conditions.push(sql`(${articles.title} ILIKE ${pattern} OR ${articles.description} ILIKE ${pattern})`);
    }
    if (filters.category) {
      conditions.push(eq(articles.category, filters.category));
    }
    if (filters.excludeCategory) {
      conditions.push(sql`${articles.category} != ${filters.excludeCategory}`);
    }
    if (filters.source) {
      conditions.push(eq(articles.sourceName, filters.source));
    }
    if (filters.tag) {
      conditions.push(arrayContains(articles.tags, [filters.tag]));
    }
    if (filters.dateRange === "custom" && filters.dateFrom && filters.dateTo) {
      const from = new Date(filters.dateFrom);
      const to = new Date(filters.dateTo);
      to.setHours(23, 59, 59, 999);
      conditions.push(sql`${articles.publishedAt} >= ${from}`);
      conditions.push(sql`${articles.publishedAt} <= ${to}`);
    } else if (filters.dateRange && filters.dateRange !== "all") {
      const now = new Date();
      let since: Date;
      if (filters.dateRange === "today") {
        since = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      } else if (filters.dateRange === "week") {
        since = new Date(now.getTime() - 7 * 86400000);
      } else {
        since = new Date(now.getTime() - 30 * 86400000);
      }
      conditions.push(sql`${articles.publishedAt} >= ${since}`);
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const limit = filters.limit || 50;
    const offset = filters.offset || 0;

    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(articles)
      .where(whereClause);

    const result = await db
      .select(ARTICLE_LIST_SELECTION)
      .from(articles)
      .where(whereClause)
      .orderBy(desc(articles.publishedAt))
      .limit(limit)
      .offset(offset);

    return { articles: result, total: Number(countResult.count) };
  }

  async getArticle(id: number): Promise<Article | undefined> {
    const [article] = await db.select().from(articles).where(eq(articles.id, id));
    return article;
  }

  async getArticlesByIds(ids: number[]): Promise<Article[]> {
    if (ids.length === 0) return [];
    return db.select().from(articles).where(inArray(articles.id, ids));
  }

  async getArticleByLink(link: string): Promise<Article | undefined> {
    const [article] = await db.select().from(articles).where(eq(articles.link, link));
    return article;
  }

  async getArticleByGuid(sourceId: number, guid: string): Promise<Article | undefined> {
    const [article] = await db
      .select()
      .from(articles)
      .where(and(eq(articles.sourceId, sourceId), eq(articles.guid, guid)));
    return article;
  }

  async setArticleGuid(id: number, guid: string): Promise<void> {
    await db.update(articles).set({ guid }).where(eq(articles.id, id));
  }

  async createArticle(article: InsertArticle): Promise<Article> {
    const [created] = await db.insert(articles).values(article).returning();
    return created;
  }

  async getArticleCount(): Promise<number> {
    const [result] = await db.select({ count: sql<number>`count(*)` }).from(articles).where(eq(articles.dismissed, false));
    return Number(result.count);
  }

  async dismissArticle(id: number): Promise<Article | undefined> {
    const [updated] = await db
      .update(articles)
      .set({ dismissed: true, dismissedAt: new Date() })
      .where(eq(articles.id, id))
      .returning();
    return updated;
  }

  async undismissArticle(id: number): Promise<Article | undefined> {
    const [updated] = await db
      .update(articles)
      .set({ dismissed: false, dismissedAt: null })
      .where(eq(articles.id, id))
      .returning();
    return updated;
  }

  async getDismissalPatterns(): Promise<{ sources: Record<string, number>; categories: Record<string, number>; total: number }> {
    const dismissed = await db
      .select({ sourceName: articles.sourceName, category: articles.category })
      .from(articles)
      .where(eq(articles.dismissed, true));

    const sources: Record<string, number> = {};
    const categories: Record<string, number> = {};
    for (const row of dismissed) {
      if (row.sourceName) sources[row.sourceName] = (sources[row.sourceName] || 0) + 1;
      if (row.category) categories[row.category] = (categories[row.category] || 0) + 1;
    }
    return { sources, categories, total: dismissed.length };
  }

  async getArticlesBySource(sourceId: number): Promise<Article[]> {
    return db.select().from(articles).where(and(eq(articles.sourceId, sourceId), eq(articles.dismissed, false))).orderBy(desc(articles.publishedAt));
  }

  async getDistinctCategories(): Promise<string[]> {
    const result = await db
      .selectDistinct({ category: articles.category })
      .from(articles)
      .where(and(sql`${articles.category} IS NOT NULL`, eq(articles.dismissed, false)))
      .orderBy(articles.category);
    return result.map(r => r.category!);
  }

  async getDistinctSourceNames(): Promise<string[]> {
    const result = await db
      .selectDistinct({ sourceName: articles.sourceName })
      .from(articles)
      .where(and(sql`${articles.sourceName} IS NOT NULL`, eq(articles.dismissed, false)))
      .orderBy(articles.sourceName);
    return result.map(r => r.sourceName!);
  }

  async getSourcesByCategory(): Promise<Record<string, string[]>> {
    const result = await db
      .selectDistinct({ sourceName: articles.sourceName, category: articles.category })
      .from(articles)
      .where(and(sql`${articles.sourceName} IS NOT NULL AND ${articles.category} IS NOT NULL`, eq(articles.dismissed, false)))
      .orderBy(articles.sourceName);
    const map: Record<string, string[]> = {};
    for (const r of result) {
      if (!map[r.category!]) map[r.category!] = [];
      if (!map[r.category!].includes(r.sourceName!)) map[r.category!].push(r.sourceName!);
    }
    return map;
  }

  // Registers tags without touching articleCount (see incrementTagCounts for the counting half).
  // Callers must pass deduped names — Postgres errors with "cannot affect row a second time"
  // if the same name appears twice in one batch. The only caller (mapFeedItem's extractTags
  // output, via server/rss.ts) already dedupes.
  async upsertFeedTags(
    tags: { name: string; displayName: string }[]
  ): Promise<Record<string, FeedTagStatus>> {
    if (tags.length === 0) return {};
    const rows = await db
      .insert(feedTags)
      .values(tags.map((t) => ({ name: t.name, displayName: t.displayName, articleCount: 0 })))
      .onConflictDoUpdate({
        target: feedTags.name,
        // No-op update (re-set the existing displayName) so ON CONFLICT still RETURNs the row.
        set: { displayName: sql`${feedTags.displayName}` },
      })
      .returning();
    return Object.fromEntries(rows.map((r) => [r.name, r.status as FeedTagStatus]));
  }

  async incrementTagCounts(names: string[]): Promise<void> {
    if (names.length === 0) return;
    await db
      .update(feedTags)
      .set({ articleCount: sql`${feedTags.articleCount} + 1` })
      .where(inArray(feedTags.name, names));
  }

  async getFeedTags(status?: FeedTagStatus): Promise<FeedTag[]> {
    const query = db.select().from(feedTags);
    const rows = status ? await query.where(eq(feedTags.status, status)) : await query;
    return rows.sort((a, b) => b.articleCount - a.articleCount);
  }

  async updateFeedTagStatus(id: number, status: FeedTagStatus): Promise<FeedTag | undefined> {
    const [updated] = await db
      .update(feedTags)
      .set({ status, reviewedAt: new Date() })
      .where(eq(feedTags.id, id))
      .returning();
    return updated;
  }

  async getApprovedTagNames(): Promise<string[]> {
    const rows = await db
      .select({ name: feedTags.name })
      .from(feedTags)
      .where(eq(feedTags.status, "approved"));
    return rows.map((r) => r.name).sort();
  }

  async searchArticles(query: string): Promise<Article[]> {
    const searchPattern = `%${query}%`;
    return db.select().from(articles)
      .where(and(sql`(${articles.title} ILIKE ${searchPattern} OR ${articles.description} ILIKE ${searchPattern})`, eq(articles.dismissed, false)))
      .orderBy(desc(articles.publishedAt))
      .limit(50);
  }

  async getTrendAnalyses(limit = 10): Promise<TrendAnalysis[]> {
    return db.select().from(trendAnalyses).orderBy(desc(trendAnalyses.createdAt)).limit(limit);
  }

  async createTrendAnalysis(analysis: InsertTrendAnalysis): Promise<TrendAnalysis> {
    const [created] = await db.insert(trendAnalyses).values(analysis).returning();
    return created;
  }

  async getLatestTrendAnalysis(): Promise<TrendAnalysis | undefined> {
    const [latest] = await db.select().from(trendAnalyses).orderBy(desc(trendAnalyses.createdAt)).limit(1);
    return latest;
  }

  async deleteTrendAnalysis(id: number): Promise<void> {
    await db.delete(trendAnalyses).where(eq(trendAnalyses.id, id));
  }

  async getTrendSnapshots(limit = 20): Promise<TrendSnapshot[]> {
    return db.select().from(trendSnapshots).orderBy(desc(trendSnapshots.createdAt)).limit(limit);
  }

  async createTrendSnapshot(snapshot: InsertTrendSnapshot): Promise<TrendSnapshot> {
    const [created] = await db.insert(trendSnapshots).values(snapshot).returning();
    return created;
  }

  async getLatestTrendSnapshot(): Promise<TrendSnapshot | undefined> {
    const [latest] = await db.select().from(trendSnapshots).orderBy(desc(trendSnapshots.createdAt)).limit(1);
    return latest;
  }

  async deleteTrendSnapshot(id: number): Promise<void> {
    await db.delete(trendSnapshots).where(eq(trendSnapshots.id, id));
  }

  async getTrendWatchlist(): Promise<TrendWatchlistItem[]> {
    return db.select().from(trendWatchlist).orderBy(desc(trendWatchlist.createdAt));
  }

  async createTrendWatchlistItem(item: InsertTrendWatchlistItem): Promise<TrendWatchlistItem> {
    const [created] = await db.insert(trendWatchlist).values(item).returning();
    return created;
  }

  async updateTrendWatchlistItem(id: number, data: Partial<InsertTrendWatchlistItem>): Promise<TrendWatchlistItem | undefined> {
    const [updated] = await db.update(trendWatchlist).set(data).where(eq(trendWatchlist.id, id)).returning();
    return updated;
  }

  async deleteTrendWatchlistItem(id: number): Promise<void> {
    await db.delete(trendWatchlist).where(eq(trendWatchlist.id, id));
  }

  async getChatSessions(): Promise<ChatSession[]> {
    return db.select().from(chatSessions).orderBy(desc(chatSessions.updatedAt));
  }

  async getChatSession(id: number): Promise<ChatSession | undefined> {
    const [session] = await db.select().from(chatSessions).where(eq(chatSessions.id, id));
    return session;
  }

  async createChatSession(session: InsertChatSession): Promise<ChatSession> {
    const [created] = await db.insert(chatSessions).values(session).returning();
    return created;
  }

  async updateChatSession(id: number, data: Partial<InsertChatSession>): Promise<ChatSession | undefined> {
    const [updated] = await db.update(chatSessions).set({ ...data, updatedAt: new Date() }).where(eq(chatSessions.id, id)).returning();
    return updated;
  }

  async deleteChatSession(id: number): Promise<void> {
    await db.delete(chatMessages).where(eq(chatMessages.sessionId, id));
    await db.delete(chatSessions).where(eq(chatSessions.id, id));
  }

  async getChatMessages(limit = 50): Promise<ChatMessage[]> {
    return db.select().from(chatMessages).orderBy(chatMessages.createdAt).limit(limit);
  }

  async getChatMessagesBySession(sessionId: number): Promise<ChatMessage[]> {
    return db.select().from(chatMessages).where(eq(chatMessages.sessionId, sessionId)).orderBy(chatMessages.createdAt);
  }

  async createChatMessage(message: InsertChatMessage): Promise<ChatMessage> {
    const [created] = await db.insert(chatMessages).values(message).returning();
    return created;
  }

  async clearChatMessages(): Promise<void> {
    await db.delete(chatMessages);
  }

  async clearChatMessagesBySession(sessionId: number): Promise<void> {
    await db.delete(chatMessages).where(eq(chatMessages.sessionId, sessionId));
  }

  async getBriefings(limit = 50): Promise<Briefing[]> {
    return db.select().from(briefings).orderBy(desc(briefings.createdAt)).limit(limit);
  }

  async getBriefing(id: number): Promise<Briefing | undefined> {
    const [briefing] = await db.select().from(briefings).where(eq(briefings.id, id));
    return briefing;
  }

  async getLatestBriefing(): Promise<Briefing | undefined> {
    const [latest] = await db.select().from(briefings).orderBy(desc(briefings.createdAt)).limit(1);
    return latest;
  }

  async createBriefing(briefing: InsertBriefing): Promise<Briefing> {
    const [created] = await db.insert(briefings).values(briefing).returning();
    return created;
  }

  async deleteBriefing(id: number): Promise<boolean> {
    const result = await db.delete(briefings).where(eq(briefings.id, id)).returning();
    return result.length > 0;
  }

  // Morning Brief
  async getBriefs(limit = 30): Promise<Brief[]> {
    return db.select().from(briefs).orderBy(desc(briefs.createdAt)).limit(limit);
  }

  async getBrief(id: number): Promise<Brief | undefined> {
    const [row] = await db.select().from(briefs).where(eq(briefs.id, id));
    return row;
  }

  async getRealBriefByDate(briefDate: string): Promise<Brief | undefined> {
    const [row] = await db
      .select()
      .from(briefs)
      .where(and(eq(briefs.briefDate, briefDate), eq(briefs.manual, false)));
    return row;
  }

  async getLatestRealBrief(): Promise<Brief | undefined> {
    const [row] = await db
      .select()
      .from(briefs)
      .where(eq(briefs.manual, false))
      .orderBy(desc(briefs.createdAt))
      .limit(1);
    return row;
  }

  async createBrief(data: InsertBrief): Promise<Brief> {
    const [row] = await db.insert(briefs).values(data).returning();
    return row;
  }

  async updateBrief(id: number, data: Partial<InsertBrief>): Promise<Brief | undefined> {
    const [row] = await db.update(briefs).set(data).where(eq(briefs.id, id)).returning();
    return row;
  }

  async getRecentArticlesByCategory(days = 7): Promise<Record<string, Article[]>> {
    const since = new Date(Date.now() - days * 86400000);
    const result = await db.select().from(articles)
      .where(and(sql`${articles.publishedAt} >= ${since}`, eq(articles.dismissed, false)))
      .orderBy(desc(articles.publishedAt));

    const grouped: Record<string, Article[]> = {};
    for (const article of result) {
      const cat = article.category || "General";
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(article);
    }
    return grouped;
  }

  async getArticlesByCategoryInRange(startDate: Date, endDate: Date): Promise<Record<string, Article[]>> {
    const adjustedEnd = new Date(endDate);
    adjustedEnd.setHours(23, 59, 59, 999);
    const result = await db.select().from(articles)
      .where(and(
        sql`${articles.publishedAt} >= ${startDate}`,
        sql`${articles.publishedAt} <= ${adjustedEnd}`,
        eq(articles.dismissed, false)
      ))
      .orderBy(desc(articles.publishedAt));
    const grouped: Record<string, Article[]> = {};
    for (const article of result) {
      const cat = article.category || "General";
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(article);
    }
    return grouped;
  }

  async getArticlesByDateRange(startDate: Date, endDate: Date, category?: string): Promise<Article[]> {
    const conditions = [
      sql`${articles.publishedAt} >= ${startDate}`,
      sql`${articles.publishedAt} <= ${endDate}`,
      eq(articles.dismissed, false),
    ];
    if (category) {
      conditions.push(eq(articles.category, category));
    }
    return db.select().from(articles)
      .where(and(...conditions))
      .orderBy(desc(articles.publishedAt));
  }
  async updateArticlesCategoryBySource(sourceId: number, category: string): Promise<void> {
    await db.update(articles)
      .set({ category })
      .where(eq(articles.sourceId, sourceId));
  }

  async getKnowledgeEntries(): Promise<KnowledgeEntry[]> {
    return db.select().from(knowledgeEntries).orderBy(knowledgeEntries.category, knowledgeEntries.title);
  }

  async getKnowledgeEntriesByIds(ids: number[]): Promise<KnowledgeEntry[]> {
    if (ids.length === 0) return [];
    return db.select().from(knowledgeEntries).where(inArray(knowledgeEntries.id, ids));
  }

  async getKnowledgeEntry(id: number): Promise<KnowledgeEntry | undefined> {
    const [entry] = await db.select().from(knowledgeEntries).where(eq(knowledgeEntries.id, id));
    return entry;
  }

  async createKnowledgeEntry(entry: InsertKnowledgeEntry): Promise<KnowledgeEntry> {
    const [created] = await db.insert(knowledgeEntries).values(entry).returning();
    return created;
  }

  async updateKnowledgeEntry(id: number, data: Partial<InsertKnowledgeEntry>): Promise<KnowledgeEntry | undefined> {
    const [updated] = await db.update(knowledgeEntries)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(knowledgeEntries.id, id))
      .returning();
    return updated;
  }

  async deleteKnowledgeEntry(id: number): Promise<void> {
    await db.delete(knowledgeEntries).where(eq(knowledgeEntries.id, id));
  }

  async deleteKnowledgeEntriesBySource(sourceUrl: string): Promise<number> {
    const deleted = await db.delete(knowledgeEntries)
      .where(eq(knowledgeEntries.sourceUrl, sourceUrl))
      .returning();
    return deleted.length;
  }

  async getActiveKnowledgeByCategory(): Promise<Record<string, KnowledgeEntry[]>> {
    const entries = await db.select().from(knowledgeEntries)
      .where(eq(knowledgeEntries.isActive, true))
      .orderBy(knowledgeEntries.category, knowledgeEntries.title);
    const grouped: Record<string, KnowledgeEntry[]> = {};
    for (const entry of entries) {
      if (!grouped[entry.category]) grouped[entry.category] = [];
      grouped[entry.category].push(entry);
    }
    return grouped;
  }

  async getCompanyAnalyses(limit = 20): Promise<CompanyAnalysis[]> {
    return db.select().from(companyAnalyses).orderBy(desc(companyAnalyses.createdAt)).limit(limit);
  }

  async getCompanyAnalysis(id: number): Promise<CompanyAnalysis | undefined> {
    const [analysis] = await db.select().from(companyAnalyses).where(eq(companyAnalyses.id, id));
    return analysis;
  }

  async createCompanyAnalysis(analysis: InsertCompanyAnalysis): Promise<CompanyAnalysis> {
    const [created] = await db.insert(companyAnalyses).values(analysis).returning();
    return created;
  }

  async deleteCompanyAnalysis(id: number): Promise<void> {
    await db.delete(companyAnalyses).where(eq(companyAnalyses.id, id));
  }

  async getThoughtLeadership(limit = 10): Promise<ThoughtLeadership[]> {
    return db.select().from(thoughtLeadership).orderBy(desc(thoughtLeadership.createdAt)).limit(limit);
  }

  async getThoughtLeadershipById(id: number): Promise<ThoughtLeadership | undefined> {
    const [item] = await db.select().from(thoughtLeadership).where(eq(thoughtLeadership.id, id)).limit(1);
    return item;
  }

  async createThoughtLeadership(data: InsertThoughtLeadership): Promise<ThoughtLeadership> {
    const [created] = await db.insert(thoughtLeadership).values(data).returning();
    return created;
  }

  async deleteThoughtLeadership(id: number): Promise<void> {
    await db.delete(thoughtLeadership).where(eq(thoughtLeadership.id, id));
  }

  async getSlideDesigns(): Promise<SlideDesign[]> {
    return db.select().from(slideDesigns).orderBy(slideDesigns.layoutType, slideDesigns.variantName);
  }

  async getApprovedSlideDesigns(): Promise<SlideDesign[]> {
    return db.select().from(slideDesigns).where(eq(slideDesigns.isApproved, true)).orderBy(slideDesigns.layoutType, slideDesigns.variantName);
  }

  async getSlideDesign(id: number): Promise<SlideDesign | undefined> {
    const [design] = await db.select().from(slideDesigns).where(eq(slideDesigns.id, id));
    return design;
  }

  async createSlideDesign(design: InsertSlideDesign): Promise<SlideDesign> {
    const [created] = await db.insert(slideDesigns).values({
      ...design,
      designTemplate: design.designTemplate || "Classic",
    }).returning();
    return created;
  }

  async updateSlideDesign(id: number, data: Partial<InsertSlideDesign>): Promise<SlideDesign | undefined> {
    const [updated] = await db.update(slideDesigns).set(data).where(eq(slideDesigns.id, id)).returning();
    return updated;
  }

  async deleteSlideDesign(id: number): Promise<void> {
    await db.delete(slideDesigns).where(eq(slideDesigns.id, id));
  }

  async getSlideDesignsByLayoutType(layoutType: string): Promise<SlideDesign[]> {
    return db.select().from(slideDesigns).where(eq(slideDesigns.layoutType, layoutType)).orderBy(slideDesigns.variantName);
  }

  async getEnablementContent(limit = 50): Promise<EnablementContent[]> {
    return db.select().from(enablementContent).orderBy(desc(enablementContent.createdAt)).limit(limit);
  }

  async createEnablementContent(data: InsertEnablementContent): Promise<EnablementContent> {
    const [created] = await db.insert(enablementContent).values(data).returning();
    return created;
  }

  async updateEnablementContent(id: number, data: Partial<InsertEnablementContent>): Promise<EnablementContent | undefined> {
    const [updated] = await db.update(enablementContent).set(data).where(eq(enablementContent.id, id)).returning();
    return updated;
  }

  async deleteEnablementContent(id: number): Promise<void> {
    await db.delete(enablementContent).where(eq(enablementContent.id, id));
  }

  async createPendingKnowledge(entry: InsertPendingKnowledge): Promise<PendingKnowledge> {
    const [created] = await db.insert(pendingKnowledge).values(entry).returning();
    return created;
  }

  async getAllPendingKnowledge(): Promise<PendingKnowledge[]> {
    return db.select().from(pendingKnowledge)
      .where(eq(pendingKnowledge.status, "pending"))
      .orderBy(desc(pendingKnowledge.createdAt));
  }

  async getPendingKnowledgeByBatch(batchId: string): Promise<PendingKnowledge[]> {
    return db.select().from(pendingKnowledge)
      .where(eq(pendingKnowledge.batchId, batchId))
      .orderBy(pendingKnowledge.category, pendingKnowledge.title);
  }

  async updatePendingKnowledge(id: number, data: Partial<InsertPendingKnowledge>): Promise<PendingKnowledge | undefined> {
    const [updated] = await db.update(pendingKnowledge).set(data).where(eq(pendingKnowledge.id, id)).returning();
    return updated;
  }

  async deletePendingKnowledge(id: number): Promise<void> {
    await db.delete(pendingKnowledge).where(eq(pendingKnowledge.id, id));
  }

  async getArticleDigests(since?: Date): Promise<ArticleDigest[]> {
    if (since) {
      return db.select().from(articleDigests)
        .where(sql`${articleDigests.periodStart} >= ${since}`)
        .orderBy(desc(articleDigests.periodStart));
    }
    return db.select().from(articleDigests).orderBy(desc(articleDigests.periodStart));
  }

  async createArticleDigest(data: InsertArticleDigest): Promise<ArticleDigest> {
    const [created] = await db.insert(articleDigests).values(data).returning();
    return created;
  }

  async getUndigestedArticleIds(): Promise<{ id: number; title: string; description: string | null; sourceName: string | null; category: string | null; publishedAt: Date | null }[]> {
    const allDigests = await db.select({ articleIds: articleDigests.articleIds }).from(articleDigests);
    const digestedIds = new Set(allDigests.flatMap(d => d.articleIds));

    const allArticlesResult = await db.select({
      id: articles.id,
      title: articles.title,
      description: articles.description,
      sourceName: articles.sourceName,
      category: articles.category,
      publishedAt: articles.publishedAt,
    }).from(articles).where(eq(articles.dismissed, false));

    return allArticlesResult.filter(a => !digestedIds.has(a.id));
  }

  async hasUndigestedArticles(): Promise<boolean> {
    const allDigests = await db.select({ articleIds: articleDigests.articleIds }).from(articleDigests);
    const digestedIds = new Set(allDigests.flatMap(d => d.articleIds));
    const [result] = await db.select({ count: sql<number>`count(*)` })
      .from(articles)
      .where(eq(articles.dismissed, false));
    const totalArticles = result?.count || 0;
    return totalArticles > digestedIds.size;
  }

  async getLatestDigestCreatedAt(): Promise<Date | null> {
    const [result] = await db.select({ latest: sql<Date>`max(${articleDigests.createdAt})` }).from(articleDigests);
    return result?.latest || null;
  }

  async approvePendingEntry(id: number): Promise<KnowledgeEntry> {
    const [pending] = await db.select().from(pendingKnowledge).where(eq(pendingKnowledge.id, id));
    if (!pending) throw new Error("Pending entry not found");

    const [entry] = await db.insert(knowledgeEntries).values({
      category: pending.category,
      title: pending.title,
      content: pending.content,
      sourceUrl: pending.sourceFilename,
      isActive: true,
    }).returning();

    await db.update(pendingKnowledge)
      .set({ status: "approved" })
      .where(eq(pendingKnowledge.id, id));

    return entry;
  }

  async getProductKnowledge(): Promise<ProductKnowledge[]> {
    return db.select().from(productKnowledge).orderBy(productKnowledge.sortOrder);
  }

  async getActiveProductKnowledge(): Promise<ProductKnowledge[]> {
    return db.select().from(productKnowledge)
      .where(eq(productKnowledge.isActive, true))
      .orderBy(productKnowledge.sortOrder);
  }

  async createProductKnowledge(entry: InsertProductKnowledge): Promise<ProductKnowledge> {
    const [created] = await db.insert(productKnowledge).values(entry).returning();
    return created;
  }

  async updateProductKnowledge(id: number, data: Partial<InsertProductKnowledge>): Promise<ProductKnowledge | undefined> {
    const [updated] = await db.update(productKnowledge)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(productKnowledge.id, id))
      .returning();
    return updated;
  }

  async deleteProductKnowledge(id: number): Promise<void> {
    await db.delete(productFeatures).where(eq(productFeatures.productId, id));
    await db.delete(productKnowledge).where(eq(productKnowledge.id, id));
  }

  async getFeaturesByProduct(productId: number): Promise<ProductFeature[]> {
    return db.select().from(productFeatures)
      .where(eq(productFeatures.productId, productId))
      .orderBy(productFeatures.sortOrder);
  }

  async getActiveFeaturesByProduct(productId: number): Promise<ProductFeature[]> {
    return db.select().from(productFeatures)
      .where(and(eq(productFeatures.productId, productId), eq(productFeatures.isActive, true)))
      .orderBy(productFeatures.sortOrder);
  }

  async createProductFeature(entry: InsertProductFeature): Promise<ProductFeature> {
    const [created] = await db.insert(productFeatures).values(entry).returning();
    return created;
  }

  async updateProductFeature(id: number, data: Partial<InsertProductFeature>): Promise<ProductFeature | undefined> {
    const [updated] = await db.update(productFeatures)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(productFeatures.id, id))
      .returning();
    return updated;
  }

  async deleteProductFeature(id: number): Promise<void> {
    await db.delete(productFeatures).where(eq(productFeatures.id, id));
  }

  async deleteFeaturesByProduct(productId: number): Promise<void> {
    await db.delete(productFeatures).where(eq(productFeatures.productId, productId));
  }

  async getNewsapiQueries(): Promise<NewsapiQuery[]> {
    return db.select().from(newsapiQueries).orderBy(newsapiQueries.category, newsapiQueries.query);
  }

  async getActiveNewsapiQueries(): Promise<NewsapiQuery[]> {
    return db.select().from(newsapiQueries).where(eq(newsapiQueries.isActive, true)).orderBy(newsapiQueries.category, newsapiQueries.query);
  }

  async createNewsapiQuery(entry: InsertNewsapiQuery): Promise<NewsapiQuery> {
    const [created] = await db.insert(newsapiQueries).values(entry).returning();
    return created;
  }

  async updateNewsapiQuery(id: number, data: Partial<InsertNewsapiQuery>): Promise<NewsapiQuery | undefined> {
    const [updated] = await db.update(newsapiQueries).set(data).where(eq(newsapiQueries.id, id)).returning();
    return updated;
  }

  async deleteNewsapiQuery(id: number): Promise<void> {
    await db.delete(newsapiQueries).where(eq(newsapiQueries.id, id));
  }

  async getTlDocuments(): Promise<TlDocument[]> {
    return db.select().from(tlDocuments).orderBy(desc(tlDocuments.createdAt));
  }

  async getActiveTlDocuments(): Promise<TlDocument[]> {
    return db.select().from(tlDocuments).where(eq(tlDocuments.isActive, true)).orderBy(desc(tlDocuments.createdAt));
  }

  async createTlDocument(doc: InsertTlDocument): Promise<TlDocument> {
    const [created] = await db.insert(tlDocuments).values(doc).returning();
    return created;
  }

  async updateTlDocument(id: number, data: Partial<InsertTlDocument>): Promise<TlDocument | undefined> {
    const [updated] = await db.update(tlDocuments).set(data).where(eq(tlDocuments.id, id)).returning();
    return updated;
  }

  async deleteTlDocument(id: number): Promise<void> {
    await db.delete(tlDocuments).where(eq(tlDocuments.id, id));
  }

  async createProcessingJob(job: InsertProcessingJob): Promise<ProcessingJob> {
    const [created] = await db.insert(processingJobs).values(job).returning();
    return created;
  }

  async getProcessingJob(jobId: string): Promise<ProcessingJob | undefined> {
    const [job] = await db.select().from(processingJobs).where(eq(processingJobs.jobId, jobId));
    return job;
  }

  async getActiveProcessingJobs(): Promise<ProcessingJob[]> {
    return db.select().from(processingJobs)
      .where(
        sql`${processingJobs.status} NOT IN ('done', 'error') OR (${processingJobs.completedAt} IS NOT NULL AND ${processingJobs.completedAt} > NOW() - INTERVAL '1 hour')`
      )
      .orderBy(desc(processingJobs.createdAt));
  }

  async getAllProcessingJobs(limit = 50): Promise<ProcessingJob[]> {
    return db.select().from(processingJobs)
      .orderBy(desc(processingJobs.createdAt))
      .limit(limit);
  }

  async updateProcessingJob(jobId: string, data: Partial<InsertProcessingJob>): Promise<ProcessingJob | undefined> {
    const [updated] = await db.update(processingJobs).set(data).where(eq(processingJobs.jobId, jobId)).returning();
    return updated;
  }

  async deleteProcessingJob(jobId: string): Promise<void> {
    await db.delete(processingJobs).where(eq(processingJobs.jobId, jobId));
  }

  async cleanupOldProcessingJobs(): Promise<void> {
    await db.delete(processingJobs).where(
      sql`${processingJobs.completedAt} IS NOT NULL AND ${processingJobs.completedAt} < NOW() - INTERVAL '24 hours'`
    );
  }

  async createKnowledgeReview(review: InsertKnowledgeReview): Promise<KnowledgeReview> {
    const [created] = await db.insert(knowledgeReviews).values(review).returning();
    return created;
  }

  async getLatestKnowledgeReview(): Promise<KnowledgeReview | undefined> {
    const [latest] = await db.select().from(knowledgeReviews).orderBy(desc(knowledgeReviews.createdAt)).limit(1);
    return latest;
  }

  async getKnowledgeReviews(limit = 10): Promise<KnowledgeReview[]> {
    return db.select().from(knowledgeReviews).orderBy(desc(knowledgeReviews.createdAt)).limit(limit);
  }

  async getDashboardViews(): Promise<DashboardView[]> {
    return db.select().from(dashboardViews).orderBy(dashboardViews.name);
  }

  async getDashboardView(id: number): Promise<DashboardView | undefined> {
    const [view] = await db.select().from(dashboardViews).where(eq(dashboardViews.id, id));
    return view;
  }

  async createDashboardView(view: InsertDashboardView): Promise<DashboardView> {
    const [created] = await db.insert(dashboardViews).values(view).returning();
    return created;
  }

  async updateDashboardView(id: number, data: Partial<InsertDashboardView>): Promise<DashboardView | undefined> {
    const [updated] = await db.update(dashboardViews).set({ ...data, updatedAt: new Date() }).where(eq(dashboardViews.id, id)).returning();
    return updated;
  }

  async deleteDashboardView(id: number): Promise<void> {
    await db.delete(dashboardViews).where(eq(dashboardViews.id, id));
  }

  async getCompetitors(): Promise<Competitor[]> {
    return db.select().from(competitors).orderBy(competitors.name);
  }

  async getArticleVolumeByDay(days: number, category?: string): Promise<Array<{ date: string; count: number; category: string }>> {
    const since = new Date(Date.now() - days * 86400000);
    const conditions = [
      sql`${articles.publishedAt} >= ${since}`,
      eq(articles.dismissed, false),
      sql`${articles.publishedAt} IS NOT NULL`,
    ];
    if (category) {
      conditions.push(eq(articles.category, category));
    }
    const result = await db.execute(sql`
      SELECT 
        TO_CHAR(${articles.publishedAt}, 'YYYY-MM-DD') as date,
        COALESCE(${articles.category}, 'Uncategorized') as category,
        COUNT(*)::int as count
      FROM ${articles}
      WHERE ${and(...conditions)}
      GROUP BY TO_CHAR(${articles.publishedAt}, 'YYYY-MM-DD'), COALESCE(${articles.category}, 'Uncategorized')
      ORDER BY date ASC
    `);
    return (result.rows || result) as Array<{ date: string; count: number; category: string }>;
  }

  async getCompetitorMentions(days: number, dateFrom?: string, dateTo?: string): Promise<Array<{ date: string; competitor: string; count: number }>> {
    let since: Date;
    let until: Date | undefined;
    if (dateFrom && dateTo) {
      since = new Date(dateFrom);
      until = new Date(dateTo);
      until.setHours(23, 59, 59, 999);
    } else {
      since = new Date(Date.now() - days * 86400000);
    }
    const competitorList = await this.getCompetitors();
    if (competitorList.length === 0) return [];

    const results: Array<{ date: string; competitor: string; count: number }> = [];
    for (const comp of competitorList) {
      const pattern = `%${comp.name}%`;
      const dateCondition = until
        ? sql`${articles.publishedAt} >= ${since} AND ${articles.publishedAt} <= ${until}`
        : sql`${articles.publishedAt} >= ${since}`;
      const rows = await db.execute(sql`
        SELECT 
          TO_CHAR(${articles.publishedAt}, 'YYYY-MM-DD') as date,
          COUNT(*)::int as count
        FROM ${articles}
        WHERE ${dateCondition}
          AND ${articles.dismissed} = false
          AND ${articles.publishedAt} IS NOT NULL
          AND (${articles.title} ILIKE ${pattern} OR ${articles.description} ILIKE ${pattern} OR ${articles.content} ILIKE ${pattern})
        GROUP BY TO_CHAR(${articles.publishedAt}, 'YYYY-MM-DD')
        ORDER BY date ASC
      `);
      for (const row of (rows.rows || rows) as Array<{ date: string; count: number }>) {
        results.push({ date: row.date, competitor: comp.name, count: row.count });
      }
    }
    return results;
  }

  async getDemandbaseMentions(days: number, dateFrom?: string, dateTo?: string): Promise<{ byDate: Array<{ date: string; count: number }>; byCategory: Array<{ category: string; count: number }>; total: number; topArticles: Article[] }> {
    let since: Date;
    let until: Date | undefined;
    if (dateFrom && dateTo) {
      since = new Date(dateFrom);
      until = new Date(dateTo);
      until.setHours(23, 59, 59, 999);
    } else {
      since = new Date(Date.now() - days * 86400000);
    }
    const dateCondition = until
      ? sql`${articles.publishedAt} >= ${since} AND ${articles.publishedAt} <= ${until}`
      : sql`${articles.publishedAt} >= ${since}`;

    const dbSourceRows = await db.select({ id: sources.id }).from(sources)
      .where(sql`${sources.name} ILIKE '%demandbase%'`);
    const dbSourceIds = dbSourceRows.map(r => r.id);
    if (dbSourceIds.length === 0) return { byDate: [], byCategory: [], total: 0, topArticles: [] };

    const sourceCondition = sql`${articles.sourceId} IN (${sql.join(dbSourceIds.map(id => sql`${id}`), sql`, `)})`;

    const dateRows = await db.execute(sql`
      SELECT
        TO_CHAR(${articles.publishedAt}, 'YYYY-MM-DD') as date,
        COUNT(*)::int as count
      FROM ${articles}
      WHERE ${dateCondition}
        AND ${articles.dismissed} = false
        AND ${articles.publishedAt} IS NOT NULL
        AND ${sourceCondition}
      GROUP BY TO_CHAR(${articles.publishedAt}, 'YYYY-MM-DD')
      ORDER BY date ASC
    `);
    const byDate = ((dateRows.rows || dateRows) as Array<{ date: string; count: number }>).map(r => ({ date: r.date, count: r.count }));

    const catRows = await db.execute(sql`
      SELECT
        COALESCE(${articles.category}, 'General') as category,
        COUNT(*)::int as count
      FROM ${articles}
      WHERE ${dateCondition}
        AND ${articles.dismissed} = false
        AND ${articles.publishedAt} IS NOT NULL
        AND ${sourceCondition}
      GROUP BY COALESCE(${articles.category}, 'General')
      ORDER BY count DESC
    `);
    const byCategory = ((catRows.rows || catRows) as Array<{ category: string; count: number }>).map(r => ({ category: r.category, count: r.count }));

    const total = byDate.reduce((s, r) => s + r.count, 0);

    const topArticlesResult = await db.select().from(articles)
      .where(and(
        dateCondition,
        eq(articles.dismissed, false),
        sql`${articles.publishedAt} IS NOT NULL`,
        sourceCondition
      ))
      .orderBy(desc(articles.publishedAt))
      .limit(10);

    return { byDate, byCategory, total, topArticles: topArticlesResult };
  }

  async getCompetitor(id: number): Promise<Competitor | undefined> {
    const [c] = await db.select().from(competitors).where(eq(competitors.id, id));
    return c;
  }

  async createCompetitor(competitor: InsertCompetitor): Promise<Competitor> {
    const [c] = await db.insert(competitors).values(competitor).returning();
    return c;
  }

  async updateCompetitor(id: number, data: Partial<InsertCompetitor>): Promise<Competitor | undefined> {
    const [c] = await db.update(competitors).set(data).where(eq(competitors.id, id)).returning();
    return c;
  }

  async deleteCompetitor(id: number): Promise<void> {
    await db.delete(competitors).where(eq(competitors.id, id));
  }

  async getCrawlJobs(type?: string, competitorId?: number): Promise<CrawlJob[]> {
    const conditions = [];
    if (type) conditions.push(eq(crawlJobs.type, type));
    if (competitorId) conditions.push(eq(crawlJobs.competitorId, competitorId));
    if (conditions.length > 0) {
      return db.select().from(crawlJobs).where(and(...conditions)).orderBy(desc(crawlJobs.createdAt));
    }
    return db.select().from(crawlJobs).orderBy(desc(crawlJobs.createdAt));
  }

  async getCrawlJob(id: number): Promise<CrawlJob | undefined> {
    const [j] = await db.select().from(crawlJobs).where(eq(crawlJobs.id, id));
    return j;
  }

  async createCrawlJob(job: InsertCrawlJob): Promise<CrawlJob> {
    const [j] = await db.insert(crawlJobs).values(job).returning();
    return j;
  }

  async updateCrawlJob(id: number, data: Partial<CrawlJob>): Promise<CrawlJob | undefined> {
    const [j] = await db.update(crawlJobs).set(data).where(eq(crawlJobs.id, id)).returning();
    return j;
  }

  async deleteCrawlJob(id: number): Promise<void> {
    await db.delete(crawlEntries).where(eq(crawlEntries.crawlJobId, id));
    await db.delete(crawlPages).where(eq(crawlPages.crawlJobId, id));
    await db.delete(crawlJobs).where(eq(crawlJobs.id, id));
  }

  async getCrawlPages(jobId: number, status?: string): Promise<CrawlPage[]> {
    if (status) {
      return db.select().from(crawlPages).where(and(eq(crawlPages.crawlJobId, jobId), eq(crawlPages.status, status)));
    }
    return db.select().from(crawlPages).where(eq(crawlPages.crawlJobId, jobId));
  }

  async createCrawlPage(page: InsertCrawlPage): Promise<CrawlPage> {
    const [p] = await db.insert(crawlPages).values({
      ...page,
      crawledAt: new Date(),
    }).returning();
    return p;
  }

  async updateCrawlPage(id: number, data: Partial<CrawlPage>): Promise<CrawlPage | undefined> {
    const [p] = await db.update(crawlPages).set(data).where(eq(crawlPages.id, id)).returning();
    return p;
  }

  async getCrawlEntries(jobId: number, status?: string, limit?: number, offset?: number): Promise<{ entries: CrawlEntry[]; total: number }> {
    const conditions = [eq(crawlEntries.crawlJobId, jobId)];
    if (status) conditions.push(eq(crawlEntries.status, status));

    const countResult = await db.select({ count: sql<number>`count(*)::int` }).from(crawlEntries).where(and(...conditions));
    const total = countResult[0]?.count || 0;

    let query = db.select().from(crawlEntries).where(and(...conditions)).orderBy(crawlEntries.category, crawlEntries.title);
    if (limit) query = query.limit(limit) as any;
    if (offset) query = query.offset(offset) as any;

    const entries = await query;
    return { entries, total };
  }

  async getCrawlEntry(id: number): Promise<CrawlEntry | undefined> {
    const [e] = await db.select().from(crawlEntries).where(eq(crawlEntries.id, id));
    return e;
  }

  async createCrawlEntry(entry: InsertCrawlEntry): Promise<CrawlEntry> {
    const [e] = await db.insert(crawlEntries).values(entry).returning();
    return e;
  }

  async updateCrawlEntry(id: number, data: Partial<CrawlEntry>): Promise<CrawlEntry | undefined> {
    const [e] = await db.update(crawlEntries).set(data).where(eq(crawlEntries.id, id)).returning();
    return e;
  }

  async updateCrawlEntriesBatch(ids: number[], data: Partial<CrawlEntry>): Promise<void> {
    if (ids.length === 0) return;
    await db.update(crawlEntries).set(data).where(inArray(crawlEntries.id, ids));
  }

  async deleteCrawlEntriesByJob(jobId: number): Promise<void> {
    await db.delete(crawlEntries).where(eq(crawlEntries.crawlJobId, jobId));
  }
}

export const storage = new DatabaseStorage();
