import { sql } from "drizzle-orm";
import { pgTable, text, varchar, serial, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const newsCategories = pgTable("news_categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  colorBg: text("color_bg").notNull(),
  colorText: text("color_text").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const sources = pgTable("sources", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  feedUrl: text("feed_url").notNull(),
  category: text("category").notNull(),
  description: text("description"),
  isActive: boolean("is_active").default(true).notNull(),
  lastFetchedAt: timestamp("last_fetched_at"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const articles = pgTable("articles", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  link: text("link").notNull(),
  description: text("description"),
  content: text("content"),
  author: text("author"),
  publishedAt: timestamp("published_at"),
  sourceId: integer("source_id").references(() => sources.id),
  sourceName: text("source_name"),
  category: text("category"),
  imageUrl: text("image_url"),
  isRead: boolean("is_read").default(false).notNull(),
  dismissed: boolean("dismissed").default(false).notNull(),
  dismissedAt: timestamp("dismissed_at"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const trendAnalyses = pgTable("trend_analyses", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  keyThemes: text("key_themes").array().notNull(),
  insights: text("insights").notNull(),
  visualData: text("visual_data"),
  articleIds: integer("article_ids").array(),
  model: text("model"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const trendSnapshots = pgTable("trend_snapshots", {
  id: serial("id").primaryKey(),
  trends: text("trends").notNull(),
  emergingSignals: text("emerging_signals"),
  companySentiment: text("company_sentiment"),
  articleCount: integer("article_count").notNull().default(0),
  days: integer("days").notNull().default(30),
  model: text("model"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const chatSessions = pgTable("chat_sessions", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  model: text("model"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const chatMessages = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id"),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertSourceSchema = createInsertSchema(sources).omit({
  id: true,
  createdAt: true,
  lastFetchedAt: true,
});

export const insertArticleSchema = createInsertSchema(articles).omit({
  id: true,
  createdAt: true,
});

export const insertTrendAnalysisSchema = createInsertSchema(trendAnalyses).omit({
  id: true,
  createdAt: true,
});

export const insertTrendSnapshotSchema = createInsertSchema(trendSnapshots).omit({
  id: true,
  createdAt: true,
});

export const briefings = pgTable("briefings", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  period: text("period").notNull(),
  executiveSummary: text("executive_summary").notNull(),
  sections: text("sections").notNull(),
  articleCount: integer("article_count").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertChatSessionSchema = createInsertSchema(chatSessions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertChatMessageSchema = createInsertSchema(chatMessages).omit({
  id: true,
  createdAt: true,
});

export const insertBriefingSchema = createInsertSchema(briefings).omit({
  id: true,
  createdAt: true,
});

export const knowledgeEntries = pgTable("knowledge_entries", {
  id: serial("id").primaryKey(),
  category: text("category").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  sourceUrl: text("source_url"),
  isActive: boolean("is_active").default(true).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertKnowledgeEntrySchema = createInsertSchema(knowledgeEntries).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Source = typeof sources.$inferSelect;
export type InsertSource = z.infer<typeof insertSourceSchema>;
export type Article = typeof articles.$inferSelect;
export type InsertArticle = z.infer<typeof insertArticleSchema>;
export type TrendAnalysis = typeof trendAnalyses.$inferSelect;
export type InsertTrendAnalysis = z.infer<typeof insertTrendAnalysisSchema>;
export type TrendSnapshot = typeof trendSnapshots.$inferSelect;
export type InsertTrendSnapshot = z.infer<typeof insertTrendSnapshotSchema>;
export type ChatSession = typeof chatSessions.$inferSelect;
export type InsertChatSession = z.infer<typeof insertChatSessionSchema>;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;
export type Briefing = typeof briefings.$inferSelect;
export type InsertBriefing = z.infer<typeof insertBriefingSchema>;
export type KnowledgeEntry = typeof knowledgeEntries.$inferSelect;
export type InsertKnowledgeEntry = z.infer<typeof insertKnowledgeEntrySchema>;

export const pendingKnowledge = pgTable("pending_knowledge", {
  id: serial("id").primaryKey(),
  batchId: text("batch_id").notNull(),
  category: text("category").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  sourceFilename: text("source_filename").notNull(),
  sourceUrl: text("source_url"),
  confidence: integer("confidence"),
  status: text("status").default("pending").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertPendingKnowledgeSchema = createInsertSchema(pendingKnowledge).omit({
  id: true,
  createdAt: true,
});

export type PendingKnowledge = typeof pendingKnowledge.$inferSelect;
export type InsertPendingKnowledge = z.infer<typeof insertPendingKnowledgeSchema>;

export const companyAnalyses = pgTable("company_analyses", {
  id: serial("id").primaryKey(),
  companyName: text("company_name").notNull(),
  companyWebsite: text("company_website").notNull(),
  ticker: text("ticker"),
  financialOutlook: text("financial_outlook").notNull(),
  strategicDirection: text("strategic_direction").notNull(),
  growthSignals: text("growth_signals").notNull(),
  risksAndChallenges: text("risks_and_challenges").notNull(),
  demandbaseOpportunity: text("demandbase_opportunity").notNull(),
  fullAnalysis: text("full_analysis").notNull(),
  sourcesUsed: text("sources_used").array(),
  model: text("model"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertCompanyAnalysisSchema = createInsertSchema(companyAnalyses).omit({
  id: true,
  createdAt: true,
});

export type CompanyAnalysis = typeof companyAnalyses.$inferSelect;
export type InsertCompanyAnalysis = z.infer<typeof insertCompanyAnalysisSchema>;

export const competitors = pgTable("competitors", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  domain: text("domain"),
  websiteUrl: text("website_url"),
  description: text("description"),
  logoUrl: text("logo_url"),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertCompetitorSchema = createInsertSchema(competitors).omit({
  id: true,
  createdAt: true,
});

export type Competitor = typeof competitors.$inferSelect;
export type InsertCompetitor = z.infer<typeof insertCompetitorSchema>;

export const thoughtLeadership = pgTable("thought_leadership", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  opportunities: text("opportunities").notNull(),
  articleCount: integer("article_count").notNull().default(0),
  model: text("model"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertThoughtLeadershipSchema = createInsertSchema(thoughtLeadership).omit({
  id: true,
  createdAt: true,
});

export type ThoughtLeadership = typeof thoughtLeadership.$inferSelect;
export type InsertThoughtLeadership = z.infer<typeof insertThoughtLeadershipSchema>;

export const enablementContent = pgTable("enablement_content", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  contentType: text("content_type").notNull(),
  prompt: text("prompt").notNull(),
  content: text("content").notNull(),
  driveUrl: text("drive_url"),
  driveFormat: text("drive_format"),
  model: text("model"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertEnablementContentSchema = createInsertSchema(enablementContent).omit({
  id: true,
  createdAt: true,
});

export type EnablementContent = typeof enablementContent.$inferSelect;
export type InsertEnablementContent = z.infer<typeof insertEnablementContentSchema>;

export const slideDesigns = pgTable("slide_designs", {
  id: serial("id").primaryKey(),
  layoutType: text("layout_type").notNull(),
  variantName: text("variant_name").notNull(),
  description: text("description").notNull(),
  designNotes: text("design_notes").notNull(),
  sampleTitle: text("sample_title").notNull(),
  sampleBody: text("sample_body").notNull(),
  isApproved: boolean("is_approved").default(false).notNull(),
  isDefault: boolean("is_default").default(false).notNull(),
  sourceFile: text("source_file"),
  designTemplate: text("design_template"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertSlideDesignSchema = createInsertSchema(slideDesigns).omit({
  id: true,
  createdAt: true,
});

export type SlideDesign = typeof slideDesigns.$inferSelect;
export type InsertSlideDesign = z.infer<typeof insertSlideDesignSchema>;

export const articleDigests = pgTable("article_digests", {
  id: serial("id").primaryKey(),
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  category: text("category").notNull(),
  articleCount: integer("article_count").notNull(),
  digest: text("digest").notNull(),
  articleIds: integer("article_ids").array().notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertArticleDigestSchema = createInsertSchema(articleDigests).omit({
  id: true,
  createdAt: true,
});

export type ArticleDigest = typeof articleDigests.$inferSelect;
export type InsertArticleDigest = z.infer<typeof insertArticleDigestSchema>;

export const productKnowledge = pgTable("product_knowledge", {
  id: serial("id").primaryKey(),
  productName: text("product_name").notNull(),
  parentId: integer("parent_id"),
  productType: text("product_type").default("product").notNull(),
  keyCapabilities: text("key_capabilities").notNull(),
  idealCustomerProfile: text("ideal_customer_profile").notNull(),
  problemsItSolves: text("problems_it_solves").notNull(),
  customerOutcomes: text("customer_outcomes").notNull(),
  talkTrack: text("talk_track").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertProductKnowledgeSchema = createInsertSchema(productKnowledge).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type ProductKnowledge = typeof productKnowledge.$inferSelect;
export type InsertProductKnowledge = z.infer<typeof insertProductKnowledgeSchema>;

export const productFeatures = pgTable("product_features", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").notNull(),
  featureName: text("feature_name").notNull(),
  keyCapabilities: text("key_capabilities").notNull(),
  keyPersonas: text("key_personas").notNull(),
  problemsItSolves: text("problems_it_solves").notNull(),
  customerOutcomes: text("customer_outcomes").notNull(),
  talkTrack: text("talk_track").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertProductFeatureSchema = createInsertSchema(productFeatures).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type ProductFeature = typeof productFeatures.$inferSelect;
export type InsertProductFeature = z.infer<typeof insertProductFeatureSchema>;

export const newsapiQueries = pgTable("newsapi_queries", {
  id: serial("id").primaryKey(),
  query: text("query").notNull(),
  category: text("category").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertNewsapiQuerySchema = createInsertSchema(newsapiQueries).omit({
  id: true,
  createdAt: true,
});

export type NewsapiQuery = typeof newsapiQueries.$inferSelect;
export type InsertNewsapiQuery = z.infer<typeof insertNewsapiQuerySchema>;

export const tlDocuments = pgTable("tl_documents", {
  id: serial("id").primaryKey(),
  filename: text("filename").notNull(),
  description: text("description").notNull(),
  extractedText: text("extracted_text").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertTlDocumentSchema = createInsertSchema(tlDocuments).omit({
  id: true,
  createdAt: true,
});

export type TlDocument = typeof tlDocuments.$inferSelect;
export type InsertTlDocument = z.infer<typeof insertTlDocumentSchema>;

export const processingJobs = pgTable("processing_jobs", {
  id: serial("id").primaryKey(),
  jobId: text("job_id").notNull().unique(),
  section: text("section").notNull(),
  filename: text("filename").notNull(),
  fileSize: integer("file_size").notNull().default(0),
  status: text("status").notNull().default("uploading"),
  progress: integer("progress").notNull().default(0),
  progressMessage: text("progress_message").default("Uploading..."),
  result: text("result"),
  error: text("error"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  completedAt: timestamp("completed_at"),
});

export const insertProcessingJobSchema = createInsertSchema(processingJobs).omit({
  id: true,
  createdAt: true,
  completedAt: true,
});

export type ProcessingJob = typeof processingJobs.$inferSelect;
export type InsertProcessingJob = z.infer<typeof insertProcessingJobSchema>;

export const knowledgeReviews = pgTable("knowledge_reviews", {
  id: serial("id").primaryKey(),
  conflicts: text("conflicts").notNull(),
  suggestions: text("suggestions").notNull(),
  totalEntries: integer("total_entries").notNull().default(0),
  issueCount: integer("issue_count").notNull().default(0),
  status: text("status").notNull().default("complete"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertKnowledgeReviewSchema = createInsertSchema(knowledgeReviews).omit({
  id: true,
  createdAt: true,
});

export type KnowledgeReview = typeof knowledgeReviews.$inferSelect;
export type InsertKnowledgeReview = z.infer<typeof insertKnowledgeReviewSchema>;

export const dashboardViews = pgTable("dashboard_views", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  config: text("config").notNull(),
  isDefault: boolean("is_default").default(false).notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertDashboardViewSchema = createInsertSchema(dashboardViews).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type DashboardView = typeof dashboardViews.$inferSelect;
export type InsertDashboardView = z.infer<typeof insertDashboardViewSchema>;

export const trendWatchlist = pgTable("trend_watchlist", {
  id: serial("id").primaryKey(),
  trendName: text("trend_name").notNull(),
  category: text("category"),
  firstSeenSnapshotId: integer("first_seen_snapshot_id"),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertTrendWatchlistSchema = createInsertSchema(trendWatchlist).omit({
  id: true,
  createdAt: true,
});

export type TrendWatchlistItem = typeof trendWatchlist.$inferSelect;
export type InsertTrendWatchlistItem = z.infer<typeof insertTrendWatchlistSchema>;

export const crawlJobs = pgTable("crawl_jobs", {
  id: serial("id").primaryKey(),
  rootUrl: text("root_url").notNull(),
  type: text("type").notNull(),
  competitorId: integer("competitor_id"),
  status: text("status").notNull().default("pending"),
  maxPages: integer("max_pages").notNull().default(50),
  maxDepth: integer("max_depth").notNull().default(3),
  pagesDiscovered: integer("pages_discovered").notNull().default(0),
  pagesCrawled: integer("pages_crawled").notNull().default(0),
  pagesExtracted: integer("pages_extracted").notNull().default(0),
  entriesExtracted: integer("entries_extracted").notNull().default(0),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  completedAt: timestamp("completed_at"),
});

export const insertCrawlJobSchema = createInsertSchema(crawlJobs).omit({
  id: true,
  createdAt: true,
  completedAt: true,
  pagesDiscovered: true,
  pagesCrawled: true,
  pagesExtracted: true,
  entriesExtracted: true,
  errorMessage: true,
});

export type CrawlJob = typeof crawlJobs.$inferSelect;
export type InsertCrawlJob = z.infer<typeof insertCrawlJobSchema>;

export const crawlPages = pgTable("crawl_pages", {
  id: serial("id").primaryKey(),
  crawlJobId: integer("crawl_job_id").notNull(),
  url: text("url").notNull(),
  title: text("title"),
  textContent: text("text_content"),
  contentLength: integer("content_length").notNull().default(0),
  status: text("status").notNull().default("pending"),
  depth: integer("depth").notNull().default(0),
  errorMessage: text("error_message"),
  crawledAt: timestamp("crawled_at"),
});

export const insertCrawlPageSchema = createInsertSchema(crawlPages).omit({
  id: true,
  crawledAt: true,
  errorMessage: true,
});

export type CrawlPage = typeof crawlPages.$inferSelect;
export type InsertCrawlPage = z.infer<typeof insertCrawlPageSchema>;

export const crawlEntries = pgTable("crawl_entries", {
  id: serial("id").primaryKey(),
  crawlJobId: integer("crawl_job_id").notNull(),
  pageId: integer("page_id"),
  category: text("category").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  sourceUrl: text("source_url"),
  status: text("status").notNull().default("pending"),
  conflictEntryId: integer("conflict_entry_id"),
  conflictType: text("conflict_type"),
  conflictDescription: text("conflict_description"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertCrawlEntrySchema = createInsertSchema(crawlEntries).omit({
  id: true,
  createdAt: true,
  conflictEntryId: true,
  conflictType: true,
  conflictDescription: true,
});

export type CrawlEntry = typeof crawlEntries.$inferSelect;
export type InsertCrawlEntry = z.infer<typeof insertCrawlEntrySchema>;

export const briefs = pgTable("briefs", {
  id: serial("id").primaryKey(),
  briefDate: text("brief_date").notNull(), // YYYY-MM-DD in BRIEF_TZ
  manual: boolean("manual").default(false).notNull(),
  periodStart: timestamp("period_start"),
  periodEnd: timestamp("period_end"),
  payload: text("payload"), // JSON string of BriefPayload (null until composed)
  status: text("status").notNull().default("pending"), // pending|composed|sent|sent_fallback|failed_compose|failed_send
  attempts: integer("attempts").notNull().default(0),
  error: text("error"),
  sentAt: timestamp("sent_at"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertBriefSchema = createInsertSchema(briefs).omit({
  id: true,
  createdAt: true,
});

export type Brief = typeof briefs.$inferSelect;
export type InsertBrief = z.infer<typeof insertBriefSchema>;
