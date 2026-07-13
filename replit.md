# B2B MarTech Intel

## Overview

B2B MarTech Intel is an AI-powered platform designed for B2B Marketing and Sales Technology professionals. It aggregates news, analyzes market trends, and generates sales enablement content. The project aims to provide timely market intelligence, actionable insights, and brand-compliant content creation through advanced news aggregation, AI-driven executive briefings, trend visualization, a conversational AI analyst, and Google Drive integration.

## User Preferences

I prefer iterative development, with a focus on delivering working features incrementally. Please use clear, concise language in all explanations and documentation. Before making any major architectural changes or introducing new dependencies, please ask for approval. I value detailed explanations for complex logic or design decisions.

## System Architecture

The application utilizes a client-server architecture.

**Frontend:**
Developed with React, Vite, TailwindCSS, and shadcn/ui for a responsive user interface. It incorporates `wouter` for routing and PWA capabilities. Route-based code splitting via `React.lazy()` keeps the initial JS bundle small (only NewsFeed is statically imported; all other pages are lazy-loaded). UI/UX focuses on clean design, dynamic filtering, interactive data visualization, and adherence to specific brand guidelines (Demandbase colors: Midnight, Sky, Sunset).

**Backend:**
Built with Express.js, providing a REST API and Server-Sent Events (SSE) for real-time communication. It handles data aggregation, AI integrations, and database interactions. The production server is bundled to CommonJS by esbuild (`script/build.ts`) with dependencies left external EXCEPT an explicit allowlist — ESM-only packages (e.g., `p-retry`) MUST be added to that allowlist or production fails at runtime with a require/interop error while dev and tests pass.

**Database:**
PostgreSQL is the primary data store, managed with Drizzle ORM. It uses `tsvector` for full-text search and includes an auto-seeded `news_categories` table. The `articles` table has performance indexes on `published_at DESC`, `category`, `source_id`, `dismissed`, and a composite index on `(dismissed, category, published_at DESC)` for the main query pattern. Indexes were created via direct SQL (not Drizzle schema) to avoid interactive `db:push`. IMPORTANT: any DB object created at runtime MUST also be mirrored in `shared/schema.ts` (see the modeled `search_vector` tsvector column and `source_fetch_failures` table) — otherwise `drizzle-kit push` proposes dropping it. Newer additions (`articles.guid`, `articles.tags` + GIN index, `feed_tags`) live in the Drizzle schema and were applied via `db:push` against the Railway DB using its public proxy URL.

**AI & Machine Learning:**
Integrates Gemini 2.5 Flash (via Replit AI Integrations) for brand-compliant content generation. OpenAI is used for the AI Analyst, trend analysis, topic classification, and public company analysis, facilitating executive briefings, content summarization, and strategic assessments. Claude Sonnet 4.6 is used for document upload AI structuring, AI feedback, deck upload analysis, and screenshot analysis.

**Core Features & Technical Implementations:**
- **News Aggregation:** Gathers articles from RSS feeds, Google News, and NewsAPI, with dynamic filtering (including custom date range picker) and a recommendation system. Feeds are automatically fetched on server startup and refreshed every 30 minutes in the background. The News Feed page loads instantly from cached database articles; a manual "Refresh" button and "last updated" timestamp let users trigger on-demand fetches without blocking page load.
- **Feed Tags (shipped 2026-07-13):** RSS `<category>` values are normalized (`server/tags.ts`) and stored per-article (`articles.tags text[]`); every tag is registered in `feed_tags` with a moderation status (pending/approved/rejected/blocked). Blocked tags skip the article at ingest; only approved tags surface as news-feed filters and card chips. Admin review lives in Sources → Tags: a threshold-gated queue (tags surface at `TAG_SURFACE_THRESHOLD` = 3 ingested articles) with live-derived context (sources, 30-day trend) and cached one-line AI annotations + suggested actions (haiku, advise-only — AI never writes status; "Accept all suggestions" bulk-applies in 100-item chunks). Articles also dedupe by feed GUID (unique index on `(source_id, guid)`, link fallback, lazy backfill) and store sanitized full text up to 25k chars (`server/sanitize.ts`; list endpoints serve `LEFT(content, 2000)` to keep payloads bounded). A one-off backfill (`script/backfill-tags.ts`) AI-tagged 90 days of historic articles against the existing vocabulary.
- **Morning Brief (Push Email):** Weekday-morning email digest (default 7:00 America/Chicago, config via `BRIEF_HOUR`/`BRIEF_TZ`/`BRIEF_RECIPIENTS`; malformed hour falls back to 7 with a logged warning) composed by Claude Sonnet from the last 24h of articles (72h cap covers weekends), trend snapshot deltas, and competitor mentions. Structured `BriefPayload` (shared zod schema; model-generated links are validated http(s)-only and deep links app-relative to block scheme abuse) renders to branded HTML email via Resend and to the in-app `/morning-brief` archive page, which includes a collapsible "How it works" explainer (auto-expands when the archive is empty). In-process 5-min scheduler (re-entrancy-guarded tick) with a `briefs` table ledger (partial unique index; `manual` test sends never block the daily send), 3 compose attempts — pre-send render failures re-enter the compose ladder rather than looping — then a fallback headlines email — a weekday morning never passes silently. Composer output cap is 8192 tokens (4096 truncated real payloads). First production send 2026-07-08. Module: `server/morning-brief/`. Single-replica assumption: the tick's in-flight guard is per-process — do not scale this service above 1 replica without moving the send claim into SQL.
- **Briefings Hub (`/briefings`):** Two tabs — Morning Brief (email digest archive, above) and Deep Reports (AI trend reports, from the Trends system). The former Daily Briefing (on-demand executive summaries, Compare, Time Machine) was removed 2026-07-13 — Morning Brief supersedes it; the `briefings` table and `/api/briefings/*` endpoints no longer exist.
- **Trends:** Features an AI-powered trend snapshot system with a dashboard displaying AI-identified B2B GTM trends (collapsible), emerging signals (collapsible), and company sentiment. Snapshot history dropdown shows "Date Range - Model Name" format. Competitive Intelligence tracks all companies from Sources Competitor Database. Supports historical snapshot selection, category filtering, custom date range filtering, and a Trend Watchlist for tracking specific trends across snapshots over time (with momentum/confidence history, notes, pause/resume, and fuzzy name matching).
- **Thought Leadership:** Offers AI-generated content opportunities from articles and user-submitted ideas. It uses a pre-computed article digest system for scalable analysis and supports document uploads (PDF, DOCX, PPTX, TXT) for context injection. Presentation generation features 4 style profiles (Executive Briefing, Sales Enablement, Thought Leadership, Technical Deep-Dive) with style-specific deck structures, slide counts, timing, and tone. Presentations are enriched with real article evidence and knowledge base context. The in-app slide preview is layout-aware with Demandbase brand styling (Midnight, Sky, Sunset colors) for each layout type (CONTENT, STATS, COMPARISON, SECTION, STATEMENT, QUOTE, CALLOUT, OBJECTION).
- **AI Analyst:** A conversational agent providing access to news, trend analyses, and company analyses with full-text search and streaming responses. It supports saved, browsable chat sessions.
- **Field Enablement:** An AI assistant for creating sales materials (battle cards, email sequences, presentations) with Google Drive integration, adhering to brand guidelines. It selectively injects public company analysis data for relevant queries.
- **DB POV (Knowledge Base):** An editable knowledge base with AI-extracted entries dynamically integrated into the Field Enablement agent. It includes a knowledge approval workflow, structured product knowledge with hierarchical product types (suites, products, sub-products at any nesting level, and features on any product level), manual product/sub-product creation, feature duplication across products, drag-and-drop nesting of products into suites or other products (with cycle prevention), and overlap detection.
- **Research:** Web crawler-based competitive intelligence system with two tabs: Company Intel (crawl Demandbase website) and Competitor Research (track/crawl competitor sites). Features BFS web crawler with same-domain filtering, depth/page limits, rate limiting, and SSRF protection. AI extraction pipeline uses Claude/GPT to extract structured knowledge entries from crawled pages. Entries can be reviewed (approve/reject), batch-managed, and pushed to the Knowledge Base with conflict detection. Database tables: `crawl_jobs`, `crawl_pages`, `crawl_entries`.
- **Sources Management (Knowledge Quality Detection):** Supports adding and managing RSS feeds, NewsAPI queries, and document uploads. It includes AI-powered conflict/quality detection for knowledge entries with actionable AI Assist suggestions (merge duplicates, delete redundant entries, update outdated content, clarify vague entries) that execute via `/api/knowledge/consolidate` and `/api/knowledge/ai-rewrite` endpoints.
- **Topic Tracking & Company Tracker:** Manages topics and categories, including automated Google News RSS source creation for tracked companies.
- **Public Company Analysis:** AI-driven analysis of public companies, providing detailed reports with a Q&A section for follow-up questions grounded in the analysis data.
- **Slide Outlines:** A design management page for presentation layouts, storing `slide_designs` for AI-generated presentations, integrating brand color palettes. Screenshot/deck upload features a two-step feedback flow: users enter feedback, click "Apply Feedback" to refine the design via AI, preview updates, then "Save & Approve" saves the refined version.
- **Voice Input:** Integrated `VoiceInputButton` for speech-to-text transcription using OpenAI's `gpt-4o-mini-transcribe`.

**Shared Components:**
A `MarkdownRenderer.tsx` component is used across the application for consistent markdown formatting.

**File Processing Pipeline:**
A unified, database-backed processing queue (`processing_jobs` table) handles file uploads up to 250MB for various types (PPTX, PDF, DOCX, TXT, images, videos). It supports asynchronous processing, progress tracking, and UI display of active and recent jobs. The pipeline includes text extraction, image/video frame extraction, and AI vision analysis using Claude Sonnet 4.6 for descriptions.

## External Dependencies

-   **`rss-parser`:** For fetching and parsing RSS feeds.
-   **NewsAPI:** For broader news article fetching.
-   **Replit AI Integrations:** For accessing Gemini 2.5 Flash.
-   **OpenAI API:** For various AI capabilities.
-   **Google Drive API (via Replit Connector):** For exporting content.
-   **`pdf-parse`:** For extracting text from PDF files.
-   **`jszip`:** For PPTX extraction.
-   **`ffmpeg` (system):** For video frame extraction.