# GTM Intelligence Engine for Demandbase — Design Spec

**Date:** 2026-04-20
**Status:** Draft
**Author:** Tom Keefe + Claude

---

## 1. Overview

### What This Is
A push-first intelligence platform that aggregates B2B/MarTech news, classifies it against Demandbase's product portfolio, generates actionable summaries with Demandbase positioning angles, and enables the team to create branded content (decks, LinkedIn posts, blog posts) directly from intelligence insights.

### Who It's For
- **Primary users:** 3-4 Demandbase product evangelists who need to stay current in their product areas and create content
- **Admin:** Tom Keefe — manages product knowledge, competitors, topics, sources, and slide layouts
- **Scale target:** Designed for 4 users today, architected to support 40+

### Core Principle
The system delivers intelligence to users (via email), not the other way around. The app is for depth and content creation. Email is the daily entry point. Every piece of intelligence includes: what happened, why it matters for Demandbase (when genuine), and what content to create from it.

### What This Is NOT
- This is a brand-new project — separate repo, separate database, separate Railway services
- The existing v1 app remains untouched and keeps running independently
- One-time migration script carries over knowledge data, RSS feed list, and the .pptx template

---

## 2. System Architecture

### Two-Service Split

```
┌─────────────────────────────────────────────────────┐
│                    WORKER SERVICE                     │
│              (Railway cron, runs every 30 min)        │
│                                                       │
│  1. Ingest: RSS + NewsAPI → articles table            │
│  2. Classify: AI tags each article to products        │
│  3. Match alerts: Check user-defined triggers         │
│  4. Send alert emails (immediate)                     │
│  5. Summarize: Per-product summaries with DB angles   │
│  6. Generate content ideas from summaries             │
│  7. Deliver digests on each user's schedule           │
│                                                       │
└──────────────────────┬──────────────────────────────┘
                       │
                  PostgreSQL
                  (shared DB)
                       │
┌──────────────────────┴──────────────────────────────┐
│                    WEB SERVICE                        │
│              (Express + React, always-on)             │
│                                                       │
│  API: Auth, preferences, feed, feedback, content gen  │
│  Frontend: Dashboard, Feed, Content Studio,           │
│            Preferences, Admin                         │
│                                                       │
└─────────────────────────────────────────────────────┘
```

### Tech Stack

| Component | Technology |
|---|---|
| Web server | Express 5 |
| Frontend | React 18 + Vite + Tailwind + shadcn/ui |
| Database | PostgreSQL via Drizzle ORM |
| AI | Anthropic Claude (classification, summaries, content generation) |
| Slide generation | python-pptx (Python subprocess called by web service) |
| Email | Resend (transactional email API) |
| Auth | Email/password or magic link |
| Deploy | Railway (2 services + 1 Postgres) |

### Project Structure (Monorepo)

```
gtm-intel/
├── packages/
│   └── shared/              # Schema, types, product taxonomy — used by both services
├── apps/
│   ├── web/                 # Express API + React frontend
│   │   ├── server/
│   │   └── client/
│   └── worker/              # Cron pipeline (ingest → classify → summarize → deliver)
├── scripts/
│   └── migrate-v1.ts        # One-time migration from v1
├── templates/
│   └── deck-template.pptx   # Demandbase corporate template
└── package.json             # Monorepo root (npm workspaces)
```

---

## 3. Data Model

### Users & Preferences

```
users
  id, email, name, password_hash
  role (admin/member)
  timezone
  created_at, last_login_at

user_product_subscriptions
  user_id, product_id

user_topic_subscriptions
  user_id, watched_topic_id

user_competitor_subscriptions
  user_id, competitor_id

user_digest_preferences
  user_id
  enabled (boolean)
  schedule (daily/weekly/custom)
  days_of_week[] (e.g., [mon, wed, fri])
  time_of_day (e.g., "07:00")

user_alert_triggers
  id, user_id
  trigger_type (competitor_mention/product_mention/keyword/custom)
  trigger_value (e.g., "6sense", "cookie deprecation")
  enabled
```

### Product Taxonomy

Products form a graph (not a strict tree) because features can belong to multiple products.

```
products
  id, name, short_name (e.g., "DB1M")
  description, positioning, key_differentiators
  keywords[] (aliases and search terms for classification)
  product_type (platform/product/feature)
  is_active, sort_order
  created_at, updated_at

product_hierarchy
  parent_id, child_id

product_knowledge
  id, product_id
  content_type (capability/icp/problems_solved/customer_outcomes/competitive)
  content
  source (manual/auto_suggested)
  created_at, updated_at
```

**Initial product graph:**

```
DemandbaseOne (platform)
├── DB1 for Marketing — DB1M (product)
│   ├── Orchestration (feature)
│   └── Personalization (feature)
│       ├── Website Personalization (feature)
│       └── Form Enrichment (feature)
├── DB1 for Sales — DB1S / Sales Intelligence (product)
├── Advertising (product)
├── Data Integrity (product)
├── Data Provider (feature) — parent: DB1S, DB1M (many-to-many)
├── Buying Groups (feature) — parent: DB1M, DB1S (many-to-many)
├── MCP Integration (feature) — parent: DB1 (many-to-many)
└── Demandbase AI (product, coming soon)
```

### Product Update Suggestions

Auto-detected from crawling Demandbase's blog and press releases.

```
product_update_suggestions
  id, source_article_id
  suggested_product_name, suggested_parent_id
  suggested_description, suggested_keywords[]
  suggestion_type (new_feature/positioning_change/capability_update)
  status (pending/approved/dismissed)
  reviewed_by, reviewed_at
  created_at
```

### Watched Topics

Admin-created topics not tied to a Demandbase product (e.g., "AI Regulation", "Cookie Deprecation").

```
watched_topics
  id, name, keywords[], description
  created_by
  is_active
  created_at

topic_requests
  id, user_id
  suggested_name, suggested_keywords[]
  reason
  status (pending/approved/dismissed)
  created_at, reviewed_at
```

### Competitors

```
competitors
  id, name, website_url
  press_release_url, blog_url
  blog_filter (announcements_only/all/off)
  news_mention_keywords[]
  is_active
  created_at

competitor_updates
  id, competitor_id, article_id
  update_type (press_release/product_launch/partnership/funding/leadership_change)
  ai_summary
  created_at
```

### Articles & Classification

```
articles
  id, title, link, description, content, author
  published_at, source_id, source_name, image_url
  created_at

article_product_tags
  article_id, product_id
  confidence (0.0-1.0)

(category is a column on articles, not a separate table:)
articles.category (industry_trend/competitor_news/product_relevant/general)

article_feedback
  article_id, user_id
  signal (thumbs_down/clicked/created_content_from)
  reason (wrong_product/not_relevant/too_basic/bad_source — nullable)
  created_at
```

### Intelligence Layer

```
summaries
  id, product_id (nullable — null for watched topic summaries)
  watched_topic_id (nullable)
  period_start, period_end
  summary_text
  db_angle_text (nullable — null when no genuine angle)
  db_angle_strength (strong/moderate/none)
  content_ideas (JSON array: [{type, title, description}])
  article_ids[]
  created_at

alerts
  id, user_id, trigger_id, article_id
  alert_text
  is_sent, sent_at
  created_at
```

### Content Creation

```
generated_content
  id, user_id
  content_type (deck/linkedin/blog)
  title, content (markdown for blog/linkedin, JSON for decks)
  source_summary_id (nullable — which summary inspired it)
  drive_url (nullable)
  status (generating/complete/failed)
  created_at

deck_slides (for deck content type)
  id, content_id, slide_number
  layout_name (references slide_layouts)
  placeholder_content (JSON: {title: "...", body1: "...", ...})
  speaker_notes
```

### Slide Layouts

Parsed from the corporate .pptx template.

```
slide_layouts
  id, layout_name (e.g., "2_Headline - 2 column - lines")
  description (AI-facing: when to use this layout)
  placeholders (JSON: [{idx, name, type, max_words}])
  category (title/content/section_divider/data/quote/back_cover)
  is_enabled (admin can disable layouts)
  created_at, updated_at
```

### Sources

```
sources
  id, name, url, feed_url
  source_type (rss/newsapi/demandbase_blog/demandbase_press/competitor_press/competitor_blog)
  competitor_id (nullable — links to competitor if applicable)
  is_active, failure_count, last_fetched_at
  created_at

newsapi_queries
  id, query
  product_id (nullable — can tie queries to specific products)
  is_active
  created_at
```

### Notifications

```
digest_deliveries
  id, user_id
  period_start, period_end
  content_snapshot (full email content for reference)
  sent_at, opened_at (nullable)

unsubscribe_events
  id, user_id
  unsubscribed_at
  resubscribed_at (nullable)
```

---

## 4. Worker Pipeline

### Execution Schedule

| Task | Frequency | Trigger |
|---|---|---|
| Ingest (RSS + NewsAPI) | Every 30 min | Cron |
| Classify articles to products | Immediately after ingest | Chained |
| Match alert triggers | Immediately after classification | Chained |
| Send alert emails | Immediately on match | Event-driven |
| Summarize per product | Daily (configurable, default 5am) | Cron |
| Generate content ideas | Part of summarization | Chained |
| Deliver digests | Per user schedule | Cron checks every 15 min |
| Crawl Demandbase blog/press | Daily | Cron |
| Crawl competitor press/blogs | Daily | Cron |

### Step 1: Ingest

- Fetch all active RSS feeds and NewsAPI queries
- Deduplicate by article URL
- Store raw articles
- Same proven logic from v1 (rss-parser, fetch API)

### Step 2: Classify

For each new article, send to Claude with this context:
- The full product graph with names, descriptions, and keywords
- The watched topics list with keywords
- Instruction to tag to one or more products/features with confidence scores (0.0-1.0)
- Instruction to categorize: industry_trend, competitor_news, product_relevant, general

The keywords on each product/feature guide the classifier. "Buying groups", "buying committees", "purchase committees" all map to the Buying Groups feature.

### Step 3: Match Alerts

For each classified article, check against all user alert triggers:
- Keyword triggers: check if keyword appears in title/description
- Competitor mention triggers: check if article is tagged as competitor_news for that competitor
- Product mention triggers: check if article is tagged to that product with confidence > 0.5

### Step 4: Send Alert Emails

Immediate email via Resend. Short format:
- What happened (article title + 2-line summary)
- Why it matters (based on trigger type)
- Link to article in the app

### Step 5: Summarize

Runs daily. For each product the user subscribes to:
- Gather articles tagged to that product since last summary
- Send to Claude with product knowledge (positioning, capabilities, differentiators)
- Generate:
  - **Summary:** 3-5 sentences, what happened
  - **DB Angle:** Only when genuine. Three levels:
    - **Strong:** News directly impacts this product's space or a competitor moved
    - **Moderate:** Tangentially relevant, brief note
    - **None:** Interesting context, no real DB stake — explicitly marked "For awareness"
  - **Content Ideas:** 2-3 specific suggestions with type (deck/linkedin/blog) and one-line description

Same process for watched topics, minus the DB angle.

### Step 6: Deliver Digests

Cron checks every 15 minutes which users are due for a digest based on their schedule + timezone:
- Assemble email from summaries for their subscribed products, topics, and competitors
- Product sections with DB angles and content ideas
- Competitor watch section
- Category sections for no-angle articles (not thrown away — organized by topic)
- "Create →" links deep-link into Content Studio with context pre-loaded
- Send via Resend
- Store delivery record

### Auto-Crawl: Demandbase Content

Daily crawl of Demandbase blog + press releases page:
- Detect new posts about product features, launches, positioning changes
- Generate product_update_suggestions for admin review
- Admin approves → product knowledge updated, classifier immediately benefits

### Auto-Crawl: Competitor Content

Daily crawl of competitor press release pages + blogs (if enabled):
- Press releases: always captured
- Blog posts: filtered by AI — only product announcements, partnerships, funding, leadership changes
- Generic thought leadership / marketing content: discarded
- Stored as competitor_updates with AI summary

---

## 5. Frontend

### Navigation

| Page | Visibility | Purpose |
|---|---|---|
| Dashboard | All users | Daily intel home — summaries, angles, content ideas, articles |
| Feed | All users | Full article list with search/filter |
| Content Studio | All users | Create decks, LinkedIn posts, blog posts |
| My Preferences | All users | Product/topic/competitor subscriptions, digest schedule, alerts |
| Admin | Admin only | 6 sections (see below) |

### Dashboard (Home)

**Layout:** Panel — sidebar with product/topic list + detail panel on right.

**Sidebar:** Lists all subscribed products, topics, and competitors with article counts and content idea counts. Click to switch.

**Detail panel:** For the selected product/topic:
1. **AI Summary** — what happened (3-5 sentences)
2. **Demandbase Angle** — orange callout, only when genuine. Three visual treatments:
   - Strong: full orange callout with positioning text
   - Moderate: subtle note
   - None: gray "For awareness" tag
3. **Content Ideas** — each with "Create →" button linking to Content Studio
4. **Articles** — list with title, source, date, thumbs-down button, optional reason dropdown

**Mobile responsive:** Sidebar collapses to horizontal tabs or dropdown on small screens.

**Feedback mechanisms:**
- Thumbs-down on individual articles (with optional reason: wrong_product, not_relevant, too_basic, bad_source)
- "This angle was off" on DB angles
- Implicit: track clicks and "created content from" events

### Feed

Full article list, filtered to user's subscriptions by default. Features:
- Search bar (full-text)
- Filter by: product/feature, competitor, watched topic, date range
- Each article: title, source, date, product tags (as chips), thumbs-down button
- Click article to read summary + link to original source

### Content Studio

**Entry points:**
- "Create →" from Dashboard (pre-loaded with context from summary + content idea)
- "Create →" from digest email (deep link with context)
- Direct navigation (start from scratch)

**Guided flow (top to bottom, single page):**
1. **Context banner** — if arriving from a content idea, shows the summary and idea that inspired it
2. **Content type selector** — Deck, LinkedIn Post, Blog Post (3 cards)
3. **Type-specific options:**
   - **Deck:** Audience dropdown, slide count range, tone dropdown
   - **LinkedIn:** Tone (hot take / informational / thought leadership), post count (1-3)
   - **Blog:** Audience, length (short/medium/long), angle
4. **Optional text field** — "Anything else?" for additional context or direction
5. **Generate button**

**After generation — Deck (Slide Navigator):**
- Left: thumbnail strip of all slides
- Right: selected slide preview showing content rendered in approximate layout style + speaker notes
- "Swap layout" dropdown on selected slide to change the master layout
- Refine bar at bottom for AI-assisted changes ("make slide 3 more competitive")
- Top: Download .pptx + Save to Google Drive buttons

**After generation — LinkedIn Post:**
- Preview of the post text
- Copy to clipboard button
- Refine bar for tweaks

**After generation — Blog Post:**
- Markdown preview of the full post
- Download as .docx + Save to Google Drive buttons
- Refine bar for tweaks

### My Preferences

- **Products:** Visual product tree/graph with toggle switches per product/feature
- **Watched Topics:** List of available topics with toggles + "Request a topic" button (sends to admin)
- **Competitors:** List of available competitors with toggles
- **Digest:** Frequency (daily / specific days / weekly), time of day, timezone
- **Alerts:** List of personal triggers with add/edit/delete/toggle. Form: trigger type dropdown + value input.

### Admin (6 sections)

**1. Products & Knowledge**
- Tree/graph view of all products and features
- Click to expand: see knowledge entries, keywords, positioning
- Edit knowledge, keywords, description inline
- Add new products/features (name + description + keywords + parent(s))
- Drag to reorganize
- Notification badge for pending product_update_suggestions from Demandbase blog/press crawl
- Review suggestions: approve (one-click), edit + approve, or dismiss
- **Visual product map** — downloadable as image/PDF, shows full hierarchy with connections

**2. Topics**
- CRUD for watched topics (name, keywords, description)
- Pending topic requests from users — approve (auto-creates topic) or dismiss

**3. Competitors**
- Add/edit/remove competitors
- Configure per competitor: press release URL, blog URL, blog filter mode (announcements_only / all / off), news mention keywords

**4. Sources**
- RSS feeds: list with active toggle, failure count, last fetched
- NewsAPI queries: list with active toggle, optional product association
- Add/remove sources
- Mostly set-and-forget after initial setup

**5. Users**
- List all users: name, email, role, subscription status, last digest sent
- See who has unsubscribed and when
- Can re-enable digest for a user
- Can change user role (member/admin)

**6. Slide Layouts**
- Full catalog of layouts parsed from the .pptx template
- Each layout shows: name, description (used by AI for selection), placeholder slots with constraints
- Edit descriptions to guide AI layout selection
- Disable/enable layouts
- Upload new .pptx template — system re-parses and detects new/changed layouts

---

## 6. Email Design

### Digest Email

Branded but text-driven. Demandbase navy (#0D1846) header, orange (#F26B43) accents.

**Structure:**
1. **Header:** GTM Intel Engine logo/text + date
2. **Greeting:** "Good morning, {name}" + article count
3. **Product sections** (one per subscribed product with articles):
   - Product name header with article count
   - Summary text (3-5 sentences)
   - DB Angle callout (orange left border) — only when genuine
   - Content ideas with "Create →" deep links to Content Studio
   - "View all articles →" link to app
4. **Competitor Watch section** (red accent):
   - Per-competitor updates with AI summary
5. **Topic/category sections** (for articles without DB angle):
   - Same card treatment as product sections, organized by topic (AI Trends, Deals & Markets, etc.)
   - No DB angle callout, but still full sections with summaries
6. **Footer:**
   - "Open Dashboard →" button (orange)
   - "Manage preferences" link → My Preferences page (requires login)
   - "Unsubscribe" → one-click signed URL, no login required
   - Unsubscribe confirmation page shows "Resubscribe →" button for accidental clicks

### Alert Email

Short, immediate, single-article format:
- Subject: "[Alert] {trigger_value}: {article_title}"
- Body: article summary (2-3 lines) + why this triggered + link to article in app

### Email Technical Requirements
- One-click unsubscribe header (Gmail compliance)
- Signed token URLs for unsubscribe (no login required)
- Resubscribe page for accidental unsubscribes
- Open tracking pixel for digest_deliveries.opened_at

---

## 7. Slide Generation System

### Approach: Clone-and-Fill

The AI does not create slides from scratch. It picks layouts from the corporate template and fills placeholders. python-pptx preserves all branding, gradients, backgrounds, and formatting.

### Layout Catalog

The 56 master layouts from the Demandbase corporate template are parsed and stored in slide_layouts table. Each entry includes:
- **Name:** e.g., "2_Headline - 2 column - lines"
- **Description:** AI-facing guidance on when to use (editable by admin)
- **Placeholders:** slot index, name, type (title/body/subtitle/picture), max word count
- **Category:** title, content, section_divider, data, quote, headshot, back_cover

### Generation Flow

1. User provides: topic, audience, slide count, tone, optional context
2. AI receives: layout catalog + product knowledge + source articles/summary
3. AI returns structured JSON:
```json
{
  "title": "The Orchestration Advantage",
  "slides": [
    {
      "layout": "1_Large Title Slide Sky",
      "placeholders": {
        "title": "The Orchestration Advantage",
        "subtitle": "Why Human-Led AI Outperforms Full Automation"
      },
      "speaker_notes": "Open with the tension..."
    },
    {
      "layout": "2_Headline - 2 column - lines",
      "placeholders": {
        "title": "Full Automation vs. Orchestration",
        "subtitle_left": "The Promise",
        "body_left": "...",
        "subtitle_right": "The Reality",
        "body_right": "..."
      },
      "speaker_notes": "This is the core comparison..."
    }
  ]
}
```
4. Validation: check text fits constraints, layout exists and is enabled
5. python-pptx: clone template, for each slide pick the master layout by name, fill placeholders
6. Output: .pptx file for download or Google Drive upload

### Template Management

- Admin uploads .pptx template via Slide Layouts admin section
- System parses all master layouts, extracts placeholder info
- Admin reviews/edits descriptions and constraints
- When corporate template is updated, admin re-uploads and system detects changes

### Brand Details (from template analysis)

| Element | Value |
|---|---|
| Colors | Midnight navy #0D1846, Soft blue #DBECFF, Warm peach #FFE4D6, Orange accent #F26B43, Gray #E7E9EC |
| Fonts | Roboto Light (body), Roboto Medium (subheadings), Roboto SemiBold (emphasis), Roboto Serif Medium (accents) |
| Slide size | 13.33" x 7.5" (widescreen 16:9) |
| Layout count | 56 master layouts |
| Layout categories | Title (4), Content/Headline (20+), Section dividers (6), Data/Charts (6), Bento (6), Headshots (6), Back covers (4), Appendix (2), Custom (3) |

---

## 8. Feedback & Learning System

### Explicit Feedback

- **Article thumbs-down:** per-user, per-article. Optional reason: wrong_product, not_relevant, too_basic, bad_source
- **Angle feedback:** "This angle was off" button on DB angle callouts
- **All feedback is per-user** — one person's thumbs-down doesn't affect another's feed

### Implicit Signals

- Article clicks (user opened/read the article)
- "Created content from" events (user went from article/summary to Content Studio)
- Digest open tracking (did they open the email?)

### How Learning Works

- Feedback feeds into the classification and summarization prompts over time
- If a user consistently thumbs-down articles from a specific source → that source is de-prioritized in their digest
- If a user thumbs-down articles tagged to a product they subscribe to with reason "wrong_product" → classification model gets corrective signal
- Implemented as weighted scoring in the digest assembly, not model fine-tuning

---

## 9. Migration from V1

One-time migration script (`scripts/migrate-v1.ts`):

| V1 Source | V2 Destination |
|---|---|
| `knowledge_entries` table | `product_knowledge` table |
| `product_knowledge` + `product_features` tables | `products` + `product_knowledge` tables |
| `demandbase-context.ts` (hardcoded) | `products.positioning` + `product_knowledge` entries |
| `DEFAULT_SOURCES` (working feeds only) | `sources` table |
| `newsapi_queries` table | `newsapi_queries` table |
| `Demandbase_Corporate Deck Template.pptx` | `templates/deck-template.pptx` + parsed `slide_layouts` |

No article migration — v2 starts fresh with its own article corpus.

---

## 10. Deployment

### Railway Services

| Service | Type | Details |
|---|---|---|
| Web | Always-on | Express + React, serves frontend + API |
| Worker | Cron | Runs every 30 min for ingest/classify, daily for summaries/crawls, every 15 min for digest delivery checks |
| PostgreSQL | Database | Shared between web and worker |

### Environment Variables

```
DATABASE_URL          — PostgreSQL connection string
ANTHROPIC_API_KEY     — Claude API access
RESEND_API_KEY        — Email delivery
GOOGLE_CLIENT_ID      — Google Drive OAuth (for slide/doc export)
GOOGLE_CLIENT_SECRET
NEWSAPI_KEY           — NewsAPI access
SESSION_SECRET        — Express session signing
APP_URL               — Public URL for email links
```

### Cost Estimates

| Service | Estimated Monthly Cost |
|---|---|
| Railway (2 services + DB) | ~$10-20 |
| Anthropic Claude API | ~$20-50 (classification + summaries + content gen) |
| Resend (email) | Free tier (100 emails/day) — sufficient for 4 users |
| NewsAPI | Free tier (100 req/day) — sufficient with 4-hour interval |
