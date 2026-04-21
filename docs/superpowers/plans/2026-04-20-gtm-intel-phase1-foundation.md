# GTM Intelligence Engine — Phase 1: Foundation + Pipeline

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the monorepo, database, auth, article ingestion pipeline, AI classification, and basic admin UI (Sources + Products sections) — a working data pipeline that ingests news and classifies it against the Demandbase product graph.

**Architecture:** npm workspaces monorepo with two apps (web + worker) sharing a schema package. Web is Express 5 + React/Vite. Worker is a standalone Node.js script. PostgreSQL via Drizzle ORM. AI classification via Anthropic Claude.

**Tech Stack:** TypeScript, Express 5, React 18, Vite, Tailwind CSS, shadcn/ui, Drizzle ORM, PostgreSQL, Anthropic SDK, rss-parser, npm workspaces

**Spec:** `docs/superpowers/specs/2026-04-20-gtm-intel-engine-design.md`

**Phase 1 delivers:**
- Monorepo with shared schema
- PostgreSQL database with full schema for users, products, articles, sources
- User auth (email/password, admin/member roles)
- RSS + NewsAPI ingestion (every 30 min)
- AI article classification to Demandbase product graph
- Admin UI: Sources management + Products & Knowledge management
- Seeded Demandbase product graph with keywords

---

## File Structure

```
gtm-intel/
├── package.json                          # Monorepo root (npm workspaces)
├── tsconfig.base.json                    # Shared TS config
├── .env.example                          # Environment variable template
├── packages/
│   └── shared/
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── schema.ts                 # Drizzle schema — all tables
│           ├── types.ts                  # Shared TypeScript types
│           └── product-seed.ts           # Initial Demandbase product graph data
├── apps/
│   ├── web/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vite.config.ts
│   │   ├── tailwind.config.ts
│   │   ├── postcss.config.js
│   │   ├── drizzle.config.ts
│   │   ├── server/
│   │   │   ├── index.ts                  # Express app entry point
│   │   │   ├── db.ts                     # Database connection pool
│   │   │   ├── auth.ts                   # Auth middleware + session handling
│   │   │   ├── routes/
│   │   │   │   ├── auth.ts               # Login/logout/register/me endpoints
│   │   │   │   ├── sources.ts            # CRUD for RSS feeds + NewsAPI queries
│   │   │   │   ├── products.ts           # Product tree CRUD + knowledge + keywords
│   │   │   │   ├── articles.ts           # Article listing + filtering + feedback
│   │   │   │   └── admin.ts              # Admin-only routes (user management)
│   │   │   └── middleware/
│   │   │       ├── require-auth.ts       # Reject unauthenticated requests
│   │   │       └── require-admin.ts      # Reject non-admin requests
│   │   └── client/
│   │       ├── index.html
│   │       ├── src/
│   │       │   ├── main.tsx              # React entry point
│   │       │   ├── App.tsx               # Router + layout
│   │       │   ├── lib/
│   │       │   │   ├── api.ts            # Fetch wrapper with auth
│   │       │   │   └── utils.ts          # cn() helper, etc.
│   │       │   ├── hooks/
│   │       │   │   └── use-auth.ts       # Auth context + hook
│   │       │   ├── components/
│   │       │   │   ├── ui/               # shadcn/ui components
│   │       │   │   ├── layout.tsx         # Shell: sidebar nav + header
│   │       │   │   ├── login-form.tsx     # Login page form
│   │       │   │   └── product-tree.tsx   # Reusable product tree component
│   │       │   └── pages/
│   │       │       ├── login.tsx          # Login page
│   │       │       ├── dashboard.tsx      # Placeholder for Phase 2
│   │       │       ├── feed.tsx           # Placeholder — shows articles
│   │       │       └── admin.tsx          # Admin page with tabs
│   └── worker/
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts                  # Worker entry point — orchestrates pipeline
│           ├── db.ts                     # Database connection (same pool config)
│           ├── ingest/
│           │   ├── rss.ts                # RSS feed fetcher
│           │   └── newsapi.ts            # NewsAPI fetcher
│           └── classify/
│               └── classifier.ts         # AI article classification
```

---

## Task 1: Monorepo Scaffolding

**Files:**
- Create: `gtm-intel/package.json`
- Create: `gtm-intel/tsconfig.base.json`
- Create: `gtm-intel/.env.example`
- Create: `gtm-intel/.gitignore`
- Create: `gtm-intel/packages/shared/package.json`
- Create: `gtm-intel/packages/shared/tsconfig.json`
- Create: `gtm-intel/packages/shared/src/types.ts`
- Create: `gtm-intel/apps/web/package.json`
- Create: `gtm-intel/apps/web/tsconfig.json`
- Create: `gtm-intel/apps/worker/package.json`
- Create: `gtm-intel/apps/worker/tsconfig.json`

**Important:** This task creates the new project in a NEW directory `gtm-intel/` alongside the existing `b2b-ai-news-source/` project. Do NOT modify the existing project.

- [ ] **Step 1: Create monorepo root**

Create directory `~/Desktop/ClaudeApps/gtm-intel/` and the root package.json:

```json
{
  "name": "gtm-intel",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "workspaces": [
    "packages/*",
    "apps/*"
  ],
  "scripts": {
    "dev:web": "npm run dev -w apps/web",
    "dev:worker": "npm run dev -w apps/worker",
    "build": "npm run build -w packages/shared && npm run build -w apps/web && npm run build -w apps/worker",
    "db:push": "npm run db:push -w apps/web",
    "db:generate": "npm run db:generate -w apps/web"
  }
}
```

- [ ] **Step 2: Create base tsconfig**

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

- [ ] **Step 3: Create .env.example**

```
DATABASE_URL=postgresql://user:pass@localhost:5432/gtm_intel
ANTHROPIC_API_KEY=sk-ant-...
NEWSAPI_KEY=...
SESSION_SECRET=change-me-to-random-string
APP_URL=http://localhost:5000
```

- [ ] **Step 4: Create .gitignore**

```
node_modules/
dist/
.env
*.tsbuildinfo
```

- [ ] **Step 5: Create shared package**

`packages/shared/package.json`:

```json
{
  "name": "@gtm-intel/shared",
  "version": "1.0.0",
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "build": "tsc"
  },
  "dependencies": {
    "drizzle-orm": "^0.39.3",
    "drizzle-zod": "^0.7.1",
    "zod": "^3.25.76"
  },
  "devDependencies": {
    "typescript": "^5.6.3"
  }
}
```

`packages/shared/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

`packages/shared/src/types.ts` (placeholder — will be populated in Task 2):

```typescript
export type UserRole = "admin" | "member";
export type ProductType = "platform" | "product" | "feature";
export type DbAngleStrength = "strong" | "moderate" | "none";
export type ArticleCategory = "industry_trend" | "competitor_news" | "product_relevant" | "general";
export type DigestSchedule = "daily" | "weekly" | "custom";
export type FeedbackSignal = "thumbs_down" | "clicked" | "created_content_from";
export type FeedbackReason = "wrong_product" | "not_relevant" | "too_basic" | "bad_source";
export type SourceType = "rss" | "newsapi" | "demandbase_blog" | "demandbase_press" | "competitor_press" | "competitor_blog";
export type BlogFilter = "announcements_only" | "all" | "off";
```

- [ ] **Step 6: Create web app package**

`apps/web/package.json`:

```json
{
  "name": "@gtm-intel/web",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx server/index.ts",
    "build": "vite build && esbuild server/index.ts --bundle --platform=node --format=esm --outfile=dist/server.js --external:pg-native",
    "start": "node dist/server.js",
    "db:push": "drizzle-kit push",
    "db:generate": "drizzle-kit generate"
  },
  "dependencies": {
    "@gtm-intel/shared": "*",
    "@anthropic-ai/sdk": "^0.78.0",
    "@radix-ui/react-dialog": "^1.1.15",
    "@radix-ui/react-dropdown-menu": "^2.1.7",
    "@radix-ui/react-label": "^2.1.3",
    "@radix-ui/react-select": "^2.1.7",
    "@radix-ui/react-separator": "^1.1.3",
    "@radix-ui/react-slot": "^1.2.0",
    "@radix-ui/react-switch": "^1.1.4",
    "@radix-ui/react-tabs": "^1.1.4",
    "@radix-ui/react-toast": "^1.2.7",
    "@radix-ui/react-tooltip": "^1.2.0",
    "@tanstack/react-query": "^5.60.5",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "connect-pg-simple": "^10.0.0",
    "drizzle-orm": "^0.39.3",
    "express": "^5.0.1",
    "express-session": "^1.18.1",
    "lucide-react": "^0.453.0",
    "pg": "^8.16.3",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "tailwind-merge": "^2.6.0",
    "tailwindcss-animate": "^1.0.7",
    "wouter": "^3.3.5",
    "zod": "^3.25.76"
  },
  "devDependencies": {
    "@tailwindcss/typography": "^0.5.15",
    "@types/connect-pg-simple": "^7.0.3",
    "@types/express": "^5.0.0",
    "@types/express-session": "^1.18.0",
    "@types/node": "^20.19.27",
    "@types/react": "^18.3.11",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.7.0",
    "autoprefixer": "^10.4.20",
    "drizzle-kit": "^0.31.8",
    "esbuild": "^0.25.0",
    "postcss": "^8.4.47",
    "tailwindcss": "^3.4.17",
    "tsx": "^4.20.5",
    "typescript": "^5.6.3",
    "vite": "^7.3.0"
  }
}
```

`apps/web/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "outDir": "dist",
    "rootDir": ".",
    "paths": {
      "@gtm-intel/shared": ["../../packages/shared/src"],
      "@/*": ["./client/src/*"]
    }
  },
  "include": ["server", "client/src"]
}
```

- [ ] **Step 7: Create worker app package**

`apps/worker/package.json`:

```json
{
  "name": "@gtm-intel/worker",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx src/index.ts",
    "build": "esbuild src/index.ts --bundle --platform=node --format=esm --outfile=dist/worker.js --external:pg-native",
    "start": "node dist/worker.js"
  },
  "dependencies": {
    "@gtm-intel/shared": "*",
    "@anthropic-ai/sdk": "^0.78.0",
    "drizzle-orm": "^0.39.3",
    "pg": "^8.16.3",
    "rss-parser": "^3.13.0"
  },
  "devDependencies": {
    "@types/node": "^20.19.27",
    "esbuild": "^0.25.0",
    "tsx": "^4.20.5",
    "typescript": "^5.6.3"
  }
}
```

`apps/worker/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "paths": {
      "@gtm-intel/shared": ["../../packages/shared/src"]
    }
  },
  "include": ["src"]
}
```

- [ ] **Step 8: Install dependencies and verify**

Run from `gtm-intel/`:

```bash
npm install
```

Expected: installs all workspace dependencies, creates `node_modules/` with symlinked workspace packages.

- [ ] **Step 9: Initialize git and commit**

```bash
cd ~/Desktop/ClaudeApps/gtm-intel
git init
git add .
git commit -m "feat: initialize monorepo with web + worker + shared packages"
```

---

## Task 2: Database Schema

**Files:**
- Create: `packages/shared/src/schema.ts`
- Create: `packages/shared/src/index.ts`
- Create: `apps/web/drizzle.config.ts`
- Create: `apps/web/server/db.ts`

- [ ] **Step 1: Create Drizzle schema**

`packages/shared/src/schema.ts`:

```typescript
import { sql } from "drizzle-orm";
import {
  pgTable, text, varchar, serial, integer, timestamp,
  boolean, real, jsonb
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ── Users ──

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("member"), // admin | member
  timezone: text("timezone").notNull().default("America/Los_Angeles"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  lastLoginAt: timestamp("last_login_at"),
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true, createdAt: true, lastLoginAt: true,
});

// ── Products (graph) ──

export const products = pgTable("products", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  shortName: text("short_name"),
  description: text("description"),
  positioning: text("positioning"),
  keyDifferentiators: text("key_differentiators"),
  keywords: text("keywords").array().notNull().default(sql`'{}'::text[]`),
  productType: text("product_type").notNull().default("feature"), // platform | product | feature
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertProductSchema = createInsertSchema(products).omit({
  id: true, createdAt: true, updatedAt: true,
});

export const productHierarchy = pgTable("product_hierarchy", {
  id: serial("id").primaryKey(),
  parentId: integer("parent_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  childId: integer("child_id").notNull().references(() => products.id, { onDelete: "cascade" }),
});

export const productKnowledge = pgTable("product_knowledge", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  contentType: text("content_type").notNull(), // capability | icp | problems_solved | customer_outcomes | competitive
  content: text("content").notNull(),
  source: text("source").notNull().default("manual"), // manual | auto_suggested
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertProductKnowledgeSchema = createInsertSchema(productKnowledge).omit({
  id: true, createdAt: true, updatedAt: true,
});

// ── Sources ──

export const sources = pgTable("sources", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  feedUrl: text("feed_url").notNull(),
  sourceType: text("source_type").notNull().default("rss"), // rss | newsapi | demandbase_blog | etc.
  competitorId: integer("competitor_id"),
  isActive: boolean("is_active").notNull().default(true),
  failureCount: integer("failure_count").notNull().default(0),
  lastFetchedAt: timestamp("last_fetched_at"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertSourceSchema = createInsertSchema(sources).omit({
  id: true, createdAt: true, lastFetchedAt: true, failureCount: true,
});

export const newsapiQueries = pgTable("newsapi_queries", {
  id: serial("id").primaryKey(),
  query: text("query").notNull(),
  productId: integer("product_id").references(() => products.id),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertNewsapiQuerySchema = createInsertSchema(newsapiQueries).omit({
  id: true, createdAt: true,
});

// ── Articles ──

export const articles = pgTable("articles", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  link: text("link").notNull().unique(),
  description: text("description"),
  content: text("content"),
  author: text("author"),
  publishedAt: timestamp("published_at"),
  sourceId: integer("source_id").references(() => sources.id),
  sourceName: text("source_name"),
  imageUrl: text("image_url"),
  category: text("category"), // industry_trend | competitor_news | product_relevant | general
  isClassified: boolean("is_classified").notNull().default(false),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertArticleSchema = createInsertSchema(articles).omit({
  id: true, createdAt: true, isClassified: true,
});

export const articleProductTags = pgTable("article_product_tags", {
  id: serial("id").primaryKey(),
  articleId: integer("article_id").notNull().references(() => articles.id, { onDelete: "cascade" }),
  productId: integer("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  confidence: real("confidence").notNull().default(0.5),
});

export const articleFeedback = pgTable("article_feedback", {
  id: serial("id").primaryKey(),
  articleId: integer("article_id").notNull().references(() => articles.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  signal: text("signal").notNull(), // thumbs_down | clicked | created_content_from
  reason: text("reason"), // wrong_product | not_relevant | too_basic | bad_source
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// ── User Preferences ──

export const userProductSubscriptions = pgTable("user_product_subscriptions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  productId: integer("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
});

export const userDigestPreferences = pgTable("user_digest_preferences", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }).unique(),
  enabled: boolean("enabled").notNull().default(true),
  schedule: text("schedule").notNull().default("daily"), // daily | weekly | custom
  daysOfWeek: text("days_of_week").array().notNull().default(sql`'{}'::text[]`),
  timeOfDay: text("time_of_day").notNull().default("07:00"),
});

export const userAlertTriggers = pgTable("user_alert_triggers", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  triggerType: text("trigger_type").notNull(), // competitor_mention | product_mention | keyword | custom
  triggerValue: text("trigger_value").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// ── Type exports ──

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type Product = typeof products.$inferSelect;
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type ProductKnowledge = typeof productKnowledge.$inferSelect;
export type Source = typeof sources.$inferSelect;
export type InsertSource = z.infer<typeof insertSourceSchema>;
export type NewsapiQuery = typeof newsapiQueries.$inferSelect;
export type Article = typeof articles.$inferSelect;
export type InsertArticle = z.infer<typeof insertArticleSchema>;
export type ArticleProductTag = typeof articleProductTags.$inferSelect;
export type ArticleFeedback = typeof articleFeedback.$inferSelect;
export type UserProductSubscription = typeof userProductSubscriptions.$inferSelect;
export type UserDigestPreference = typeof userDigestPreferences.$inferSelect;
export type UserAlertTrigger = typeof userAlertTriggers.$inferSelect;
```

- [ ] **Step 2: Create shared index**

`packages/shared/src/index.ts`:

```typescript
export * from "./schema.js";
export * from "./types.js";
```

- [ ] **Step 3: Create Drizzle config**

`apps/web/drizzle.config.ts`:

```typescript
import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

export default defineConfig({
  out: "./migrations",
  schema: "../../packages/shared/src/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
```

- [ ] **Step 4: Create database connection**

`apps/web/server/db.ts`:

```typescript
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@gtm-intel/shared";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export const db = drizzle(pool, { schema });
```

- [ ] **Step 5: Push schema to database**

```bash
cd apps/web
cp ../../.env.example .env
# Edit .env with your actual DATABASE_URL
npx drizzle-kit push
```

Expected: all tables created in PostgreSQL.

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "feat: add database schema with users, products, articles, sources"
```

---

## Task 3: Product Seed Data

**Files:**
- Create: `packages/shared/src/product-seed.ts`

- [ ] **Step 1: Create seed data**

`packages/shared/src/product-seed.ts`:

```typescript
import type { InsertProduct } from "./schema.js";

interface ProductSeed {
  name: string;
  shortName: string | null;
  productType: "platform" | "product" | "feature";
  description: string;
  positioning: string | null;
  keyDifferentiators: string | null;
  keywords: string[];
  children?: ProductSeed[];
}

export const DEMANDBASE_PRODUCT_TREE: ProductSeed = {
  name: "DemandbaseOne",
  shortName: "DB1",
  productType: "platform",
  description: "The only pipeline AI platform that empowers go-to-market teams to hit their revenue goals with fewer resources.",
  positioning: "Demandbase is the leading account-based GTM platform, combining intent data, AI-powered insights, and orchestration to help B2B teams identify, engage, and close their best accounts.",
  keyDifferentiators: "First-party intent data, AI-driven account identification, unified ABM platform across marketing and sales, account-based advertising with intent signals.",
  keywords: ["demandbase", "demandbaseone", "db1", "pipeline ai", "account-based gtm"],
  children: [
    {
      name: "DB1 for Marketing",
      shortName: "DB1M",
      productType: "product",
      description: "Account-based marketing platform with orchestration, personalization, and intent-driven campaign management.",
      positioning: "DB1M gives marketing teams the ability to identify in-market accounts, orchestrate multi-channel campaigns, and personalize every touchpoint — all powered by AI and first-party intent data.",
      keyDifferentiators: "Orchestration engine, website personalization, form enrichment, intent-based audience building.",
      keywords: ["db1m", "db1 for marketing", "demandbase marketing", "account-based marketing", "abm platform"],
      children: [
        {
          name: "Orchestration",
          shortName: null,
          productType: "feature",
          description: "Automated multi-channel campaign orchestration powered by intent signals and account engagement data.",
          positioning: null,
          keyDifferentiators: null,
          keywords: ["orchestration", "campaign orchestration", "marketing orchestration", "automated campaigns", "multi-channel orchestration"],
        },
        {
          name: "Personalization",
          shortName: null,
          productType: "feature",
          description: "Account-based website personalization and form enrichment for B2B.",
          positioning: null,
          keyDifferentiators: null,
          keywords: ["personalization", "website personalization", "b2b personalization", "account-based personalization"],
          children: [
            {
              name: "Website Personalization",
              shortName: null,
              productType: "feature",
              description: "Dynamically personalize website content based on account identity, intent, and engagement stage.",
              positioning: null,
              keyDifferentiators: null,
              keywords: ["website personalization", "web personalization", "dynamic content", "personalized web experience"],
            },
            {
              name: "Form Enrichment",
              shortName: null,
              productType: "feature",
              description: "Auto-enrich form submissions with firmographic and technographic data to reduce form friction.",
              positioning: null,
              keyDifferentiators: null,
              keywords: ["form enrichment", "form shortening", "progressive profiling", "lead enrichment"],
            },
          ],
        },
      ],
    },
    {
      name: "DB1 for Sales",
      shortName: "DB1S",
      productType: "product",
      description: "Sales intelligence platform providing account insights, contact data, and intent signals for B2B sales teams.",
      positioning: "DB1S arms sales reps with real-time account intelligence, buying signals, and contact data so they can prioritize the right accounts and engage at the right time.",
      keyDifferentiators: "Real-time intent alerts for sales, account-level engagement history, contact data with credits, Salesforce native integration.",
      keywords: ["db1s", "db1 for sales", "sales intelligence", "demandbase sales", "account intelligence"],
    },
    {
      name: "Advertising",
      shortName: null,
      productType: "product",
      description: "Account-based advertising platform that uses intent data to target in-market B2B accounts across display, social, and programmatic channels.",
      positioning: "Demandbase Advertising is the only B2B ad platform that combines first-party intent data with account identification to deliver ads to the accounts most likely to buy — not just firmographic lookalikes.",
      keyDifferentiators: "Intent-powered ad targeting, account-based programmatic, cross-channel B2B advertising, integration with DB1 account data.",
      keywords: ["advertising", "account-based advertising", "b2b advertising", "programmatic abm", "abm ads", "demandbase advertising"],
    },
    {
      name: "Data Integrity",
      shortName: null,
      productType: "product",
      description: "B2B data enrichment and hygiene solution that keeps CRM and MAP data accurate and complete.",
      positioning: "Data Integrity ensures your go-to-market data is clean, complete, and current — reducing wasted spend and improving targeting across every channel.",
      keyDifferentiators: "Automated data enrichment, CRM/MAP data hygiene, firmographic and technographic append, duplicate management.",
      keywords: ["data integrity", "data enrichment", "data hygiene", "b2b data", "data quality", "crm enrichment"],
    },
    {
      name: "Demandbase AI",
      shortName: null,
      productType: "product",
      description: "Freemium AI-powered product within DemandbaseOne, providing AI-driven GTM insights and recommendations.",
      positioning: null,
      keyDifferentiators: null,
      keywords: ["demandbase ai", "db ai", "gtm ai", "pipeline ai"],
    },
    {
      name: "Buying Groups",
      shortName: null,
      productType: "feature",
      description: "Identify and engage B2B buying committees with multi-stakeholder tracking and engagement scoring.",
      positioning: "Buying Groups helps teams move beyond single-lead thinking to engage the full buying committee, increasing win rates by ensuring every stakeholder is identified and nurtured.",
      keyDifferentiators: "Buying group identification, multi-stakeholder engagement, committee-level scoring, role-based nurturing.",
      keywords: ["buying groups", "buying committees", "purchase committees", "buying team", "demand unit", "multi-stakeholder", "buying group engagement"],
    },
    {
      name: "Data Provider",
      shortName: null,
      productType: "feature",
      description: "Credit-based system for purchasing account and people records not currently in your systems.",
      positioning: null,
      keyDifferentiators: null,
      keywords: ["data provider", "data credits", "account records", "people records", "contact data", "data marketplace"],
    },
    {
      name: "MCP Integration",
      shortName: null,
      productType: "feature",
      description: "Model Context Protocol connector enabling AI agents to interact with Demandbase data and capabilities.",
      positioning: null,
      keyDifferentiators: null,
      keywords: ["mcp", "model context protocol", "mcp connector", "ai agent integration", "llm tool use"],
    },
  ],
};

// Multi-parent mappings: child name → additional parent names (beyond tree position)
export const MULTI_PARENT_MAPPINGS: Record<string, string[]> = {
  "Buying Groups": ["DB1 for Marketing", "DB1 for Sales"],
  "Data Provider": ["DB1 for Sales", "DB1 for Marketing"],
  "MCP Integration": ["DemandbaseOne"],
};
```

- [ ] **Step 2: Export from shared index**

Add to `packages/shared/src/index.ts`:

```typescript
export * from "./schema.js";
export * from "./types.js";
export * from "./product-seed.js";
```

- [ ] **Step 3: Commit**

```bash
git add .
git commit -m "feat: add Demandbase product tree seed data"
```

---

## Task 4: Auth System

**Files:**
- Create: `apps/web/server/auth.ts`
- Create: `apps/web/server/middleware/require-auth.ts`
- Create: `apps/web/server/middleware/require-admin.ts`
- Create: `apps/web/server/routes/auth.ts`

- [ ] **Step 1: Create auth utilities**

`apps/web/server/auth.ts`:

```typescript
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";

const scryptAsync = promisify(scrypt);

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

export async function verifyPassword(stored: string, supplied: string): Promise<boolean> {
  const [hashed, salt] = stored.split(".");
  const buf = (await scryptAsync(supplied, salt, 64)) as Buffer;
  const storedBuf = Buffer.from(hashed, "hex");
  return timingSafeEqual(buf, storedBuf);
}
```

- [ ] **Step 2: Create middleware**

`apps/web/server/middleware/require-auth.ts`:

```typescript
import type { Request, Response, NextFunction } from "express";

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  next();
}
```

`apps/web/server/middleware/require-admin.ts`:

```typescript
import type { Request, Response, NextFunction } from "express";

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  if (req.session.userRole !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}
```

- [ ] **Step 3: Create auth routes**

`apps/web/server/routes/auth.ts`:

```typescript
import { Router } from "express";
import { db } from "../db.js";
import { users } from "@gtm-intel/shared";
import { eq } from "drizzle-orm";
import { hashPassword, verifyPassword } from "../auth.js";
import { requireAuth } from "../middleware/require-auth.js";
import { requireAdmin } from "../middleware/require-admin.js";
import { z } from "zod";

const router = Router();

const registerSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

// Register (admin-only — admins create accounts for team members)
router.post("/register", requireAdmin, async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const { email, name, password } = parsed.data;

  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing.length > 0) {
    return res.status(409).json({ error: "Email already registered" });
  }

  const passwordHash = await hashPassword(password);
  const [user] = await db.insert(users).values({
    email,
    name,
    passwordHash,
    role: "member",
  }).returning();

  res.status(201).json({ id: user.id, email: user.email, name: user.name, role: user.role });
});

// Login
router.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const { email, password } = parsed.data;

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const valid = await verifyPassword(user.passwordHash, password);
  if (!valid) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  // Update last login
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));

  // Set session
  req.session.userId = user.id;
  req.session.userRole = user.role;

  res.json({ id: user.id, email: user.email, name: user.name, role: user.role });
});

// Logout
router.post("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: "Logout failed" });
    res.json({ ok: true });
  });
});

// Get current user
router.get("/me", requireAuth, async (req, res) => {
  const [user] = await db.select({
    id: users.id,
    email: users.email,
    name: users.name,
    role: users.role,
    timezone: users.timezone,
  }).from(users).where(eq(users.id, req.session.userId!)).limit(1);

  if (!user) {
    return res.status(401).json({ error: "User not found" });
  }

  res.json(user);
});

export default router;
```

- [ ] **Step 4: Add session type declaration**

Create `apps/web/server/session.d.ts`:

```typescript
import "express-session";

declare module "express-session" {
  interface SessionData {
    userId: number;
    userRole: string;
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat: add auth system with register, login, logout, session management"
```

---

## Task 5: Express Server + Vite Setup

**Files:**
- Create: `apps/web/server/index.ts`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/tailwind.config.ts`
- Create: `apps/web/client/index.html`
- Create: `apps/web/client/src/main.tsx`
- Create: `apps/web/client/src/App.tsx`
- Create: `apps/web/client/src/lib/api.ts`
- Create: `apps/web/client/src/lib/utils.ts`

- [ ] **Step 1: Create Express server**

`apps/web/server/index.ts`:

```typescript
import express from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { pool, db } from "./db.js";
import authRoutes from "./routes/auth.js";
import { users, products, productHierarchy, productKnowledge } from "@gtm-intel/shared";
import { DEMANDBASE_PRODUCT_TREE, MULTI_PARENT_MAPPINGS } from "@gtm-intel/shared";
import { eq } from "drizzle-orm";
import { hashPassword } from "./auth.js";

const app = express();
const PgSession = connectPgSimple(session);

app.use(express.json());
app.use(
  session({
    store: new PgSession({ pool, createTableIfMissing: true }),
    secret: process.env.SESSION_SECRET || "dev-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
    },
  })
);

// API routes
app.use("/api/auth", authRoutes);

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Seed admin user + product tree on startup
async function seed() {
  // Seed admin if no users exist
  const existingUsers = await db.select().from(users).limit(1);
  if (existingUsers.length === 0) {
    const passwordHash = await hashPassword("change-me");
    await db.insert(users).values({
      email: "admin@example.com",
      name: "Tom Keefe",
      passwordHash,
      role: "admin",
    });
    console.log("Seeded admin user (admin@example.com / change-me)");
  }

  // Seed product tree if no products exist
  const existingProducts = await db.select().from(products).limit(1);
  if (existingProducts.length === 0) {
    await seedProductTree(DEMANDBASE_PRODUCT_TREE, null);

    // Apply multi-parent mappings
    for (const [childName, parentNames] of Object.entries(MULTI_PARENT_MAPPINGS)) {
      const [child] = await db.select().from(products).where(eq(products.name, childName)).limit(1);
      if (!child) continue;

      for (const parentName of parentNames) {
        const [parent] = await db.select().from(products).where(eq(products.name, parentName)).limit(1);
        if (!parent) continue;

        // Check if link already exists
        const existing = await db.select().from(productHierarchy)
          .where(eq(productHierarchy.parentId, parent.id))
          .limit(1);

        const hasLink = existing.some((e) => e.childId === child.id);
        if (!hasLink) {
          await db.insert(productHierarchy).values({ parentId: parent.id, childId: child.id });
        }
      }
    }

    console.log("Seeded Demandbase product tree");
  }
}

async function seedProductTree(node: typeof DEMANDBASE_PRODUCT_TREE, parentId: number | null) {
  const [product] = await db.insert(products).values({
    name: node.name,
    shortName: node.shortName,
    productType: node.productType,
    description: node.description,
    positioning: node.positioning,
    keyDifferentiators: node.keyDifferentiators,
    keywords: node.keywords,
  }).returning();

  if (parentId !== null) {
    await db.insert(productHierarchy).values({ parentId, childId: product.id });
  }

  if (node.children) {
    for (const child of node.children) {
      await seedProductTree(child, product.id);
    }
  }
}

const PORT = parseInt(process.env.PORT || "5000", 10);

seed().then(() => {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Web server running on port ${PORT}`);
  });
}).catch((err) => {
  console.error("Seed error:", err);
  process.exit(1);
});

export default app;
```

- [ ] **Step 2: Create Vite config**

`apps/web/vite.config.ts`:

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  root: "client",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "client/src"),
    },
  },
  server: {
    proxy: {
      "/api": "http://localhost:5000",
    },
  },
  build: {
    outDir: "../dist/public",
    emptyOutDir: true,
  },
});
```

- [ ] **Step 3: Create Tailwind config**

`apps/web/tailwind.config.ts`:

```typescript
import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: ["./client/src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        db: {
          midnight: "#0D1846",
          blue: "#DBECFF",
          peach: "#FFE4D6",
          orange: "#F26B43",
          gray: "#E7E9EC",
        },
      },
    },
  },
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/typography")],
} satisfies Config;
```

- [ ] **Step 3b: Create PostCSS config**

`apps/web/postcss.config.js`:

```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 4: Create client entry files**

`apps/web/client/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>GTM Intel Engine</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`apps/web/client/src/main.tsx`:

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import "./index.css";

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
);
```

`apps/web/client/src/index.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

`apps/web/client/src/App.tsx`:

```tsx
export default function App() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <h1 className="text-2xl font-bold text-db-midnight">GTM Intel Engine</h1>
    </div>
  );
}
```

- [ ] **Step 5: Create API helper**

`apps/web/client/src/lib/api.ts`:

```typescript
export async function api<T = unknown>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    credentials: "include",
    ...options,
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || res.statusText);
  }

  return res.json();
}
```

`apps/web/client/src/lib/utils.ts`:

```typescript
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 6: Verify server starts**

Run two terminals:

Terminal 1 (Express API):
```bash
cd apps/web
npm run dev
```

Terminal 2 (Vite frontend):
```bash
cd apps/web
npx vite
```

Expected: Express starts on port 5000 and seeds admin user + product tree. Vite starts on port 5173 and proxies `/api` requests to Express.

- [ ] **Step 7: Commit**

```bash
git add .
git commit -m "feat: add Express server with Vite, Tailwind, auth routes, and startup seeding"
```

---

## Task 6: Sources API Routes

**Files:**
- Create: `apps/web/server/routes/sources.ts`

- [ ] **Step 1: Create sources routes**

`apps/web/server/routes/sources.ts`:

```typescript
import { Router } from "express";
import { db } from "../db.js";
import { sources, newsapiQueries, insertSourceSchema, insertNewsapiQuerySchema } from "@gtm-intel/shared";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middleware/require-auth.js";
import { requireAdmin } from "../middleware/require-admin.js";

const router = Router();

// List all sources
router.get("/", requireAuth, async (_req, res) => {
  const allSources = await db.select().from(sources).orderBy(sources.name);
  res.json(allSources);
});

// Create source (admin only)
router.post("/", requireAdmin, async (req, res) => {
  const parsed = insertSourceSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const [source] = await db.insert(sources).values(parsed.data).returning();
  res.status(201).json(source);
});

// Toggle source active status
router.patch("/:id/toggle", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const [source] = await db.select().from(sources).where(eq(sources.id, id)).limit(1);
  if (!source) return res.status(404).json({ error: "Source not found" });

  const [updated] = await db.update(sources)
    .set({ isActive: !source.isActive })
    .where(eq(sources.id, id))
    .returning();

  res.json(updated);
});

// Delete source
router.delete("/:id", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  await db.delete(sources).where(eq(sources.id, id));
  res.json({ ok: true });
});

// ── NewsAPI Queries ──

router.get("/newsapi-queries", requireAuth, async (_req, res) => {
  const queries = await db.select().from(newsapiQueries).orderBy(newsapiQueries.query);
  res.json(queries);
});

router.post("/newsapi-queries", requireAdmin, async (req, res) => {
  const parsed = insertNewsapiQuerySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const [query] = await db.insert(newsapiQueries).values(parsed.data).returning();
  res.status(201).json(query);
});

router.patch("/newsapi-queries/:id/toggle", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const [query] = await db.select().from(newsapiQueries).where(eq(newsapiQueries.id, id)).limit(1);
  if (!query) return res.status(404).json({ error: "Query not found" });

  const [updated] = await db.update(newsapiQueries)
    .set({ isActive: !query.isActive })
    .where(eq(newsapiQueries.id, id))
    .returning();

  res.json(updated);
});

router.delete("/newsapi-queries/:id", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  await db.delete(newsapiQueries).where(eq(newsapiQueries.id, id));
  res.json({ ok: true });
});

export default router;
```

- [ ] **Step 2: Register routes in server**

Add to `apps/web/server/index.ts`, after the auth routes import:

```typescript
import sourcesRoutes from "./routes/sources.js";
```

And after `app.use("/api/auth", authRoutes);`:

```typescript
app.use("/api/sources", sourcesRoutes);
```

- [ ] **Step 3: Commit**

```bash
git add .
git commit -m "feat: add sources and NewsAPI queries CRUD routes"
```

---

## Task 7: Products API Routes

**Files:**
- Create: `apps/web/server/routes/products.ts`

- [ ] **Step 1: Create products routes**

`apps/web/server/routes/products.ts`:

```typescript
import { Router } from "express";
import { db } from "../db.js";
import {
  products, productHierarchy, productKnowledge,
  insertProductSchema, insertProductKnowledgeSchema,
} from "@gtm-intel/shared";
import { eq, inArray } from "drizzle-orm";
import { requireAuth } from "../middleware/require-auth.js";
import { requireAdmin } from "../middleware/require-admin.js";
import { z } from "zod";

const router = Router();

// Get full product tree
router.get("/", requireAuth, async (_req, res) => {
  const allProducts = await db.select().from(products).orderBy(products.sortOrder);
  const hierarchy = await db.select().from(productHierarchy);
  const knowledge = await db.select().from(productKnowledge);

  // Build tree structure for the client
  const tree = allProducts.map((p) => ({
    ...p,
    parentIds: hierarchy.filter((h) => h.childId === p.id).map((h) => h.parentId),
    childIds: hierarchy.filter((h) => h.parentId === p.id).map((h) => h.childId),
    knowledge: knowledge.filter((k) => k.productId === p.id),
  }));

  res.json(tree);
});

// Create product/feature (admin only)
const createProductSchema = insertProductSchema.extend({
  parentIds: z.array(z.number()).optional(),
});

router.post("/", requireAdmin, async (req, res) => {
  const parsed = createProductSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const { parentIds, ...productData } = parsed.data;

  const [product] = await db.insert(products).values(productData).returning();

  // Create hierarchy links
  if (parentIds && parentIds.length > 0) {
    await db.insert(productHierarchy).values(
      parentIds.map((parentId) => ({ parentId, childId: product.id }))
    );
  }

  res.status(201).json(product);
});

// Update product (admin only)
router.patch("/:id", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);

  const updateSchema = z.object({
    name: z.string().optional(),
    shortName: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    positioning: z.string().nullable().optional(),
    keyDifferentiators: z.string().nullable().optional(),
    keywords: z.array(z.string()).optional(),
    productType: z.enum(["platform", "product", "feature"]).optional(),
    isActive: z.boolean().optional(),
    sortOrder: z.number().optional(),
    parentIds: z.array(z.number()).optional(),
  });

  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const { parentIds, ...updateData } = parsed.data;

  if (Object.keys(updateData).length > 0) {
    await db.update(products)
      .set({ ...updateData, updatedAt: new Date() })
      .where(eq(products.id, id));
  }

  // Update hierarchy if parentIds provided
  if (parentIds !== undefined) {
    await db.delete(productHierarchy).where(eq(productHierarchy.childId, id));
    if (parentIds.length > 0) {
      await db.insert(productHierarchy).values(
        parentIds.map((parentId) => ({ parentId, childId: id }))
      );
    }
  }

  const [updated] = await db.select().from(products).where(eq(products.id, id)).limit(1);
  res.json(updated);
});

// Delete product (admin only)
router.delete("/:id", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  await db.delete(products).where(eq(products.id, id));
  res.json({ ok: true });
});

// ── Product Knowledge ──

router.post("/:id/knowledge", requireAdmin, async (req, res) => {
  const productId = parseInt(req.params.id, 10);
  const parsed = insertProductKnowledgeSchema.safeParse({ ...req.body, productId });
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const [entry] = await db.insert(productKnowledge).values(parsed.data).returning();
  res.status(201).json(entry);
});

router.patch("/knowledge/:id", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { content, contentType } = req.body;

  const [updated] = await db.update(productKnowledge)
    .set({ content, contentType, updatedAt: new Date() })
    .where(eq(productKnowledge.id, id))
    .returning();

  res.json(updated);
});

router.delete("/knowledge/:id", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  await db.delete(productKnowledge).where(eq(productKnowledge.id, id));
  res.json({ ok: true });
});

export default router;
```

- [ ] **Step 2: Register routes in server**

Add to `apps/web/server/index.ts`:

```typescript
import productsRoutes from "./routes/products.js";
```

And:

```typescript
app.use("/api/products", productsRoutes);
```

- [ ] **Step 3: Commit**

```bash
git add .
git commit -m "feat: add products CRUD with hierarchy, knowledge, and keywords"
```

---

## Task 8: Articles API Routes

**Files:**
- Create: `apps/web/server/routes/articles.ts`

- [ ] **Step 1: Create articles routes**

`apps/web/server/routes/articles.ts`:

```typescript
import { Router } from "express";
import { db } from "../db.js";
import {
  articles, articleProductTags, articleFeedback, products,
} from "@gtm-intel/shared";
import { eq, desc, and, ilike, inArray, sql, gte, lte } from "drizzle-orm";
import { requireAuth } from "../middleware/require-auth.js";
import { z } from "zod";

const router = Router();

// List articles with filtering
router.get("/", requireAuth, async (req, res) => {
  const {
    search, productId, category, limit: limitStr, offset: offsetStr,
    startDate, endDate,
  } = req.query;

  const limit = Math.min(parseInt(limitStr as string, 10) || 50, 100);
  const offset = parseInt(offsetStr as string, 10) || 0;

  let query = db.select().from(articles).orderBy(desc(articles.publishedAt)).limit(limit).offset(offset);

  const conditions = [];

  if (search) {
    conditions.push(
      sql`(${articles.title} ILIKE ${"%" + search + "%"} OR ${articles.description} ILIKE ${"%" + search + "%"})`
    );
  }

  if (category) {
    conditions.push(eq(articles.category, category as string));
  }

  if (startDate) {
    conditions.push(gte(articles.publishedAt, new Date(startDate as string)));
  }

  if (endDate) {
    conditions.push(lte(articles.publishedAt, new Date(endDate as string)));
  }

  let result;
  if (conditions.length > 0) {
    result = await db.select().from(articles)
      .where(and(...conditions))
      .orderBy(desc(articles.publishedAt))
      .limit(limit)
      .offset(offset);
  } else {
    result = await db.select().from(articles)
      .orderBy(desc(articles.publishedAt))
      .limit(limit)
      .offset(offset);
  }

  // If filtering by productId, join through tags
  if (productId) {
    const taggedArticleIds = await db.select({ articleId: articleProductTags.articleId })
      .from(articleProductTags)
      .where(eq(articleProductTags.productId, parseInt(productId as string, 10)));

    const ids = taggedArticleIds.map((t) => t.articleId);
    if (ids.length === 0) return res.json([]);

    result = result.filter((a) => ids.includes(a.id));
  }

  // Attach product tags to each article
  const articleIds = result.map((a) => a.id);
  let tags: Array<{ articleId: number; productId: number; confidence: number }> = [];
  if (articleIds.length > 0) {
    tags = await db.select().from(articleProductTags)
      .where(inArray(articleProductTags.articleId, articleIds));
  }

  const articlesWithTags = result.map((a) => ({
    ...a,
    productTags: tags.filter((t) => t.articleId === a.id),
  }));

  res.json(articlesWithTags);
});

// Submit feedback
const feedbackSchema = z.object({
  signal: z.enum(["thumbs_down", "clicked", "created_content_from"]),
  reason: z.enum(["wrong_product", "not_relevant", "too_basic", "bad_source"]).nullable().optional(),
});

router.post("/:id/feedback", requireAuth, async (req, res) => {
  const articleId = parseInt(req.params.id, 10);
  const userId = req.session.userId!;

  const parsed = feedbackSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const [entry] = await db.insert(articleFeedback).values({
    articleId,
    userId,
    signal: parsed.data.signal,
    reason: parsed.data.reason ?? null,
  }).returning();

  res.status(201).json(entry);
});

// Get article count
router.get("/count", requireAuth, async (_req, res) => {
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(articles);
  res.json({ count });
});

export default router;
```

- [ ] **Step 2: Register routes in server**

Add to `apps/web/server/index.ts`:

```typescript
import articlesRoutes from "./routes/articles.js";
```

And:

```typescript
app.use("/api/articles", articlesRoutes);
```

- [ ] **Step 3: Commit**

```bash
git add .
git commit -m "feat: add articles listing, filtering, and feedback routes"
```

---

## Task 9: Worker — RSS Ingestion

**Files:**
- Create: `apps/worker/src/db.ts`
- Create: `apps/worker/src/ingest/rss.ts`

- [ ] **Step 1: Create worker DB connection**

`apps/worker/src/db.ts`:

```typescript
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@gtm-intel/shared";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export const db = drizzle(pool, { schema });
```

- [ ] **Step 2: Create RSS fetcher**

`apps/worker/src/ingest/rss.ts`:

```typescript
import Parser from "rss-parser";
import { db } from "../db.js";
import { sources, articles, type InsertArticle } from "@gtm-intel/shared";
import { eq, and } from "drizzle-orm";

const parser = new Parser({
  timeout: 10000,
  maxRedirects: 5,
});

export async function fetchAllRssFeeds(): Promise<{ total: number; errors: number }> {
  const activeSources = await db.select().from(sources)
    .where(and(eq(sources.isActive, true), eq(sources.sourceType, "rss")));

  let total = 0;
  let errors = 0;

  for (const source of activeSources) {
    try {
      const result = await fetchSingleFeed(source);
      total += result;

      // Reset failure count on success
      if (source.failureCount > 0) {
        await db.update(sources)
          .set({ failureCount: 0, lastFetchedAt: new Date() })
          .where(eq(sources.id, source.id));
      } else {
        await db.update(sources)
          .set({ lastFetchedAt: new Date() })
          .where(eq(sources.id, source.id));
      }
    } catch (err) {
      console.error(`Error fetching feed ${source.feedUrl}:`, err instanceof Error ? err.message : err);
      errors++;

      // Increment failure count
      const newCount = source.failureCount + 1;
      await db.update(sources)
        .set({ failureCount: newCount })
        .where(eq(sources.id, source.id));

      // Auto-disable after 3 days of failures (144 attempts at 30 min intervals)
      if (newCount >= 144) {
        await db.update(sources)
          .set({ isActive: false })
          .where(eq(sources.id, source.id));
        console.log(`Auto-disabled source "${source.name}" after persistent failures`);
      }
    }
  }

  return { total, errors };
}

async function fetchSingleFeed(source: typeof sources.$inferSelect): Promise<number> {
  const feed = await parser.parseURL(source.feedUrl);
  let added = 0;

  for (const item of feed.items.slice(0, 20)) {
    if (!item.link || !item.title) continue;

    // Deduplicate by link
    const existing = await db.select({ id: articles.id })
      .from(articles)
      .where(eq(articles.link, item.link))
      .limit(1);

    if (existing.length > 0) continue;

    const article: InsertArticle = {
      title: item.title,
      link: item.link,
      description: item.contentSnippet?.substring(0, 500) || item.content?.substring(0, 500) || null,
      content: item.content?.substring(0, 5000) || null,
      author: item.creator || item.author || null,
      publishedAt: item.pubDate ? new Date(item.pubDate) : new Date(),
      sourceId: source.id,
      sourceName: source.name,
      imageUrl: item.enclosure?.url || null,
    };

    await db.insert(articles).values(article);
    added++;
  }

  return added;
}
```

- [ ] **Step 3: Commit**

```bash
git add .
git commit -m "feat: add worker RSS feed ingestion"
```

---

## Task 10: Worker — NewsAPI Ingestion

**Files:**
- Create: `apps/worker/src/ingest/newsapi.ts`

- [ ] **Step 1: Create NewsAPI fetcher**

`apps/worker/src/ingest/newsapi.ts`:

```typescript
import { db } from "../db.js";
import { newsapiQueries, articles, type InsertArticle } from "@gtm-intel/shared";
import { eq } from "drizzle-orm";

const NEWSAPI_BASE = "https://newsapi.org/v2";

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

export async function fetchAllNewsAPI(): Promise<{ total: number; errors: number }> {
  const apiKey = process.env.NEWSAPI_KEY;
  if (!apiKey) {
    console.log("NewsAPI: No API key configured, skipping");
    return { total: 0, errors: 0 };
  }

  const activeQueries = await db.select().from(newsapiQueries)
    .where(eq(newsapiQueries.isActive, true));

  if (activeQueries.length === 0) {
    return { total: 0, errors: 0 };
  }

  let total = 0;
  let errors = 0;

  for (const query of activeQueries) {
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
        if (!item.url || !item.title || item.title === "[Removed]") continue;

        const existing = await db.select({ id: articles.id })
          .from(articles)
          .where(eq(articles.link, item.url))
          .limit(1);

        if (existing.length > 0) continue;

        const article: InsertArticle = {
          title: item.title,
          link: item.url,
          description: item.description?.substring(0, 500) || null,
          content: item.content?.substring(0, 5000) || null,
          author: item.author || null,
          publishedAt: item.publishedAt ? new Date(item.publishedAt) : new Date(),
          sourceId: null,
          sourceName: `NewsAPI: ${item.source.name}`,
          imageUrl: item.urlToImage || null,
        };

        await db.insert(articles).values(article);
        total++;
      }
    } catch (err) {
      console.error(`NewsAPI error for "${query.query}":`, err instanceof Error ? err.message : err);
      errors++;
    }
  }

  console.log(`NewsAPI: Added ${total} articles with ${errors} errors`);
  return { total, errors };
}
```

- [ ] **Step 2: Commit**

```bash
git add .
git commit -m "feat: add worker NewsAPI ingestion"
```

---

## Task 11: Worker — AI Article Classification

**Files:**
- Create: `apps/worker/src/classify/classifier.ts`

- [ ] **Step 1: Create classifier**

`apps/worker/src/classify/classifier.ts`:

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { db } from "../db.js";
import {
  articles, products, productHierarchy, articleProductTags,
} from "@gtm-intel/shared";
import { eq, and } from "drizzle-orm";

const anthropic = new Anthropic();

interface ClassificationResult {
  category: "industry_trend" | "competitor_news" | "product_relevant" | "general";
  productTags: Array<{ productName: string; confidence: number }>;
}

export async function classifyNewArticles(): Promise<{ classified: number; errors: number }> {
  // Get unclassified articles
  const unclassified = await db.select().from(articles)
    .where(eq(articles.isClassified, false))
    .limit(50);

  if (unclassified.length === 0) return { classified: 0, errors: 0 };

  // Load product catalog for the prompt
  const allProducts = await db.select().from(products).where(eq(products.isActive, true));
  const hierarchy = await db.select().from(productHierarchy);

  const productCatalog = allProducts.map((p) => {
    const parentIds = hierarchy.filter((h) => h.childId === p.id).map((h) => h.parentId);
    const parentNames = parentIds.map((pid) => allProducts.find((pp) => pp.id === pid)?.name).filter(Boolean);
    return {
      name: p.name,
      type: p.productType,
      description: p.description,
      keywords: p.keywords,
      parents: parentNames,
    };
  });

  const catalogText = productCatalog.map((p) =>
    `- ${p.name} (${p.type}${p.parents.length > 0 ? `, under: ${p.parents.join(", ")}` : ""}): ${p.description || "No description"}\n  Keywords: ${p.keywords.join(", ") || "none"}`
  ).join("\n");

  let classified = 0;
  let errors = 0;

  // Classify in batches of 10
  for (let i = 0; i < unclassified.length; i += 10) {
    const batch = unclassified.slice(i, i + 10);

    const articlesText = batch.map((a, idx) =>
      `[${idx}] Title: ${a.title}\nDescription: ${a.description || "N/A"}\nSource: ${a.sourceName || "Unknown"}`
    ).join("\n\n");

    try {
      const response = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2000,
        messages: [{
          role: "user",
          content: `You are classifying news articles for a B2B go-to-market intelligence platform focused on Demandbase products.

PRODUCT CATALOG:
${catalogText}

ARTICLES TO CLASSIFY:
${articlesText}

For each article, return a JSON array with one object per article:
[
  {
    "index": 0,
    "category": "industry_trend|competitor_news|product_relevant|general",
    "productTags": [
      {"productName": "exact product name from catalog", "confidence": 0.0-1.0}
    ]
  }
]

Rules:
- Only tag to products from the catalog above. Use exact names.
- An article can tag to multiple products.
- confidence 0.8+ = directly about this product/feature area
- confidence 0.5-0.79 = tangentially related
- confidence below 0.5 = don't include
- category "competitor_news" = mentions a Demandbase competitor by name
- category "product_relevant" = directly relevant to a product area
- category "industry_trend" = broader market trend
- category "general" = doesn't fit other categories
- Return ONLY valid JSON, no other text.`,
        }],
      });

      const text = response.content[0].type === "text" ? response.content[0].text : "";
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        console.error("Classification: no JSON found in response");
        errors += batch.length;
        continue;
      }

      const results: Array<{ index: number } & ClassificationResult> = JSON.parse(jsonMatch[0]);

      for (const result of results) {
        const article = batch[result.index];
        if (!article) continue;

        // Update article category
        await db.update(articles)
          .set({ category: result.category, isClassified: true })
          .where(eq(articles.id, article.id));

        // Insert product tags
        for (const tag of result.productTags) {
          const product = allProducts.find((p) => p.name === tag.productName);
          if (!product) continue;

          await db.insert(articleProductTags).values({
            articleId: article.id,
            productId: product.id,
            confidence: tag.confidence,
          });
        }

        classified++;
      }
    } catch (err) {
      console.error("Classification error:", err instanceof Error ? err.message : err);
      errors += batch.length;
    }
  }

  return { classified, errors };
}
```

- [ ] **Step 2: Commit**

```bash
git add .
git commit -m "feat: add AI article classification against product graph"
```

---

## Task 12: Worker — Entry Point & Orchestration

**Files:**
- Create: `apps/worker/src/index.ts`

- [ ] **Step 1: Create worker orchestrator**

`apps/worker/src/index.ts`:

```typescript
import { fetchAllRssFeeds } from "./ingest/rss.js";
import { fetchAllNewsAPI } from "./ingest/newsapi.js";
import { classifyNewArticles } from "./classify/classifier.js";
import { pool } from "./db.js";

async function run() {
  const startTime = Date.now();
  console.log(`[${new Date().toISOString()}] Worker: starting pipeline...`);

  // Step 1: Ingest
  console.log("Worker: ingesting RSS feeds...");
  const rssResult = await fetchAllRssFeeds();
  console.log(`Worker: RSS done — ${rssResult.total} new, ${rssResult.errors} errors`);

  console.log("Worker: ingesting NewsAPI...");
  const newsResult = await fetchAllNewsAPI();
  console.log(`Worker: NewsAPI done — ${newsResult.total} new, ${newsResult.errors} errors`);

  const totalNew = rssResult.total + newsResult.total;

  // Step 2: Classify (only if we have new articles)
  if (totalNew > 0) {
    console.log(`Worker: classifying ${totalNew} new articles...`);
    const classifyResult = await classifyNewArticles();
    console.log(`Worker: classified ${classifyResult.classified}, ${classifyResult.errors} errors`);
  } else {
    // Also classify any unclassified backlog
    const classifyResult = await classifyNewArticles();
    if (classifyResult.classified > 0) {
      console.log(`Worker: classified ${classifyResult.classified} backlog articles`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`Worker: pipeline complete in ${elapsed}s`);

  // Close DB pool
  await pool.end();
}

run().catch((err) => {
  console.error("Worker fatal error:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Verify worker runs**

```bash
cd apps/worker
cp ../../.env.example .env
# Edit .env with actual values
npm run dev
```

Expected: worker runs pipeline, ingests articles, classifies them, exits.

- [ ] **Step 3: Commit**

```bash
git add .
git commit -m "feat: add worker entry point orchestrating ingest → classify pipeline"
```

---

## Task 13: Seed V1 RSS Sources

**Files:**
- Create: `apps/web/server/seed-sources.ts`

- [ ] **Step 1: Create source seed data**

`apps/web/server/seed-sources.ts`:

```typescript
import type { InsertSource } from "@gtm-intel/shared";

// Working feeds from v1 (broken feeds excluded)
export const DEFAULT_SOURCES: InsertSource[] = [
  { name: "MarTech.org", url: "https://martech.org", feedUrl: "https://martech.org/feed/", sourceType: "rss" },
  { name: "Martech Zone", url: "https://martech.zone", feedUrl: "https://feed.martech.zone", sourceType: "rss" },
  { name: "ChiefMartec", url: "https://chiefmartec.com", feedUrl: "https://chiefmartec.com/feed/", sourceType: "rss" },
  { name: "VentureBeat AI", url: "https://venturebeat.com/category/ai/", feedUrl: "https://venturebeat.com/category/ai/feed/", sourceType: "rss" },
  { name: "TechCrunch", url: "https://techcrunch.com", feedUrl: "https://techcrunch.com/feed/", sourceType: "rss" },
  { name: "The Verge - AI", url: "https://www.theverge.com/ai-artificial-intelligence", feedUrl: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml", sourceType: "rss" },
  { name: "MIT Technology Review - AI", url: "https://www.technologyreview.com/topic/artificial-intelligence/", feedUrl: "https://www.technologyreview.com/topic/artificial-intelligence/feed", sourceType: "rss" },
  { name: "Wired - AI", url: "https://www.wired.com/tag/artificial-intelligence/", feedUrl: "https://www.wired.com/feed/tag/ai/latest/rss", sourceType: "rss" },
  { name: "Ars Technica - AI", url: "https://arstechnica.com/ai/", feedUrl: "https://feeds.arstechnica.com/arstechnica/features", sourceType: "rss" },
  { name: "Marketing AI Institute", url: "https://www.marketingaiinstitute.com", feedUrl: "https://www.marketingaiinstitute.com/blog/rss.xml", sourceType: "rss" },
  { name: "HubSpot Marketing Blog", url: "https://blog.hubspot.com/marketing", feedUrl: "https://blog.hubspot.com/marketing/rss.xml", sourceType: "rss" },
  { name: "HubSpot Sales Blog", url: "https://blog.hubspot.com/sales", feedUrl: "https://blog.hubspot.com/sales/rss.xml", sourceType: "rss" },
  { name: "Demand Gen Report", url: "https://www.demandgenreport.com", feedUrl: "https://www.demandgenreport.com/feed/", sourceType: "rss" },
  { name: "SalesTechStar", url: "https://salestechstar.com", feedUrl: "https://salestechstar.com/feed/", sourceType: "rss" },
  { name: "SaaStr", url: "https://www.saastr.com", feedUrl: "https://www.saastr.com/feed/", sourceType: "rss" },
  { name: "Cognism Blog", url: "https://www.cognism.com/blog", feedUrl: "https://www.cognism.com/blog/rss.xml", sourceType: "rss" },
  { name: "Salesforce Blog", url: "https://www.salesforce.com/blog/", feedUrl: "https://www.salesforce.com/blog/feed/", sourceType: "rss" },
  { name: "Crunchbase News", url: "https://news.crunchbase.com", feedUrl: "https://news.crunchbase.com/feed/", sourceType: "rss" },
  { name: "TechCrunch Venture", url: "https://techcrunch.com/category/venture/", feedUrl: "https://techcrunch.com/category/venture/feed/", sourceType: "rss" },
  { name: "DeepMind Blog", url: "https://deepmind.google", feedUrl: "https://deepmind.google/blog/rss.xml", sourceType: "rss" },
  { name: "NVIDIA AI Blog", url: "https://blogs.nvidia.com/ai/", feedUrl: "https://blogs.nvidia.com/feed/", sourceType: "rss" },
  { name: "HPCwire", url: "https://www.hpcwire.com", feedUrl: "https://www.hpcwire.com/feed/", sourceType: "rss" },
];

export const DEFAULT_NEWSAPI_QUERIES = [
  { query: "martech OR marketing technology" },
  { query: "B2B sales technology OR salestech" },
  { query: "AI marketing automation" },
  { query: "CRM software enterprise" },
  { query: "demand generation B2B" },
  { query: "revenue operations OR RevOps" },
  { query: "SaaS acquisition merger funding" },
  { query: "demandbase" },
];
```

- [ ] **Step 2: Add source seeding to startup**

In `apps/web/server/index.ts`, add this import at the top alongside the existing imports:

```typescript
import { DEFAULT_SOURCES, DEFAULT_NEWSAPI_QUERIES } from "./seed-sources.js";
```

Also add `sources` and `newsapiQueries` to the existing `@gtm-intel/shared` import:

```typescript
import { users, products, productHierarchy, productKnowledge, sources, newsapiQueries } from "@gtm-intel/shared";
```

Then inside the `seed()` function, after product tree seeding, add:

// Seed RSS sources if none exist
const existingSources = await db.select().from(sources).limit(1);
if (existingSources.length === 0) {
  for (const source of DEFAULT_SOURCES) {
    await db.insert(sources).values(source);
  }
  console.log(`Seeded ${DEFAULT_SOURCES.length} RSS sources`);
}

// Seed NewsAPI queries if none exist
const existingQueries = await db.select().from(newsapiQueries).limit(1);
if (existingQueries.length === 0) {
  for (const q of DEFAULT_NEWSAPI_QUERIES) {
    await db.insert(newsapiQueries).values(q);
  }
  console.log(`Seeded ${DEFAULT_NEWSAPI_QUERIES.length} NewsAPI queries`);
}
```

- [ ] **Step 3: Commit**

```bash
git add .
git commit -m "feat: seed working RSS sources and NewsAPI queries from v1"
```

---

## Task 14: Frontend — Login Page + Auth Hook

**Files:**
- Create: `apps/web/client/src/hooks/use-auth.tsx`
- Create: `apps/web/client/src/components/login-form.tsx`
- Create: `apps/web/client/src/pages/login.tsx`
- Modify: `apps/web/client/src/App.tsx`

- [ ] **Step 1: Create auth hook**

`apps/web/client/src/hooks/use-auth.tsx`:

```tsx
import { createContext, useContext, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

interface User {
  id: number;
  email: string;
  name: string;
  role: string;
  timezone: string;
}

interface AuthContext {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContext | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const { data: user, isLoading } = useQuery<User | null>({
    queryKey: ["auth", "me"],
    queryFn: async () => {
      try {
        return await api<User>("/auth/me");
      } catch {
        return null;
      }
    },
    retry: false,
  });

  const loginMutation = useMutation({
    mutationFn: async ({ email, password }: { email: string; password: string }) => {
      await api("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["auth"] }),
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await api("/auth/logout", { method: "POST" });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["auth"] }),
  });

  return (
    <AuthContext.Provider value={{
      user: user ?? null,
      isLoading,
      login: async (email, password) => { await loginMutation.mutateAsync({ email, password }); },
      logout: async () => { await logoutMutation.mutateAsync(); },
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
```

- [ ] **Step 2: Create login page**

`apps/web/client/src/pages/login.tsx`:

```tsx
import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-db-midnight flex items-center justify-center">
      <div className="bg-white rounded-lg shadow-xl p-8 w-full max-w-sm">
        <h1 className="text-2xl font-bold text-db-midnight mb-2">GTM Intel Engine</h1>
        <p className="text-gray-500 text-sm mb-6">Sign in to your account</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-db-orange"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-db-orange"
              required
            />
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-db-orange text-white py-2 rounded-md font-medium hover:bg-orange-600 disabled:opacity-50"
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Update App.tsx with auth routing**

`apps/web/client/src/App.tsx`:

```tsx
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import LoginPage from "@/pages/login";

function AppContent() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="p-8">
        <h1 className="text-2xl font-bold text-db-midnight mb-2">GTM Intel Engine</h1>
        <p className="text-gray-600">Welcome, {user.name} ({user.role})</p>
        <p className="text-gray-400 text-sm mt-4">Dashboard, Feed, Content Studio, and Admin pages coming in next tasks.</p>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
```

- [ ] **Step 4: Update main.tsx**

`apps/web/client/src/main.tsx` (already created in Task 5 — no changes needed)

- [ ] **Step 5: Verify login flow works**

Start the web server, open browser, login with `admin@example.com` / `change-me`.

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "feat: add login page, auth hook, and authenticated app shell"
```

---

## Task 15: Frontend — Layout Shell + Navigation

**Files:**
- Create: `apps/web/client/src/components/layout.tsx`
- Modify: `apps/web/client/src/App.tsx`

- [ ] **Step 1: Create layout shell**

`apps/web/client/src/components/layout.tsx`:

```tsx
import { useAuth } from "@/hooks/use-auth";
import { Link, useLocation } from "wouter";
import { LayoutDashboard, Newspaper, PenTool, Settings, Shield, LogOut } from "lucide-react";

const NAV_ITEMS = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard },
  { path: "/feed", label: "Feed", icon: Newspaper },
  { path: "/content", label: "Content Studio", icon: PenTool },
  { path: "/preferences", label: "My Preferences", icon: Settings },
];

const ADMIN_ITEM = { path: "/admin", label: "Admin", icon: Shield };

export default function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const [location] = useLocation();

  const items = user?.role === "admin" ? [...NAV_ITEMS, ADMIN_ITEM] : NAV_ITEMS;

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar */}
      <aside className="w-56 bg-db-midnight text-white flex flex-col flex-shrink-0">
        <div className="p-4 border-b border-white/10">
          <h1 className="font-bold text-sm">GTM Intel Engine</h1>
          <p className="text-xs text-gray-400 mt-0.5">Demandbase</p>
        </div>

        <nav className="flex-1 py-2">
          {items.map((item) => {
            const active = location === item.path || (item.path !== "/" && location.startsWith(item.path));
            const Icon = item.icon;
            return (
              <Link key={item.path} href={item.path}>
                <a className={`flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                  active
                    ? "bg-white/10 text-white font-medium"
                    : "text-gray-400 hover:text-white hover:bg-white/5"
                }`}>
                  <Icon size={18} />
                  {item.label}
                </a>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-white/10">
          <div className="text-xs text-gray-400 mb-2">{user?.name}</div>
          <button
            onClick={logout}
            className="flex items-center gap-2 text-xs text-gray-400 hover:text-white transition-colors"
          >
            <LogOut size={14} />
            Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Update App.tsx with routing**

```tsx
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { Route, Switch } from "wouter";
import LoginPage from "@/pages/login";
import Layout from "@/components/layout";

function DashboardPage() {
  return <div className="p-6"><h2 className="text-xl font-bold text-db-midnight">Dashboard</h2><p className="text-gray-500 mt-2">Coming in Phase 2</p></div>;
}

function FeedPage() {
  return <div className="p-6"><h2 className="text-xl font-bold text-db-midnight">Feed</h2><p className="text-gray-500 mt-2">Coming in Phase 3</p></div>;
}

function ContentStudioPage() {
  return <div className="p-6"><h2 className="text-xl font-bold text-db-midnight">Content Studio</h2><p className="text-gray-500 mt-2">Coming in Phase 3</p></div>;
}

function PreferencesPage() {
  return <div className="p-6"><h2 className="text-xl font-bold text-db-midnight">My Preferences</h2><p className="text-gray-500 mt-2">Coming in Phase 2</p></div>;
}

function AdminPage() {
  return <div className="p-6"><h2 className="text-xl font-bold text-db-midnight">Admin</h2><p className="text-gray-500 mt-2">Sources + Products sections in Task 16-17</p></div>;
}

function AppContent() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center"><p className="text-gray-500">Loading...</p></div>;
  }

  if (!user) return <LoginPage />;

  return (
    <Layout>
      <Switch>
        <Route path="/" component={DashboardPage} />
        <Route path="/feed" component={FeedPage} />
        <Route path="/content" component={ContentStudioPage} />
        <Route path="/preferences" component={PreferencesPage} />
        <Route path="/admin" component={AdminPage} />
      </Switch>
    </Layout>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add .
git commit -m "feat: add sidebar layout shell with navigation and page routing"
```

---

## Task 16: Frontend — Admin Sources Section

**Files:**
- Create: `apps/web/client/src/pages/admin.tsx` (replace placeholder)

- [ ] **Step 1: Create admin page with Sources tab**

`apps/web/client/src/pages/admin.tsx`:

```tsx
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Source, NewsapiQuery } from "@gtm-intel/shared";

type AdminTab = "products" | "topics" | "competitors" | "sources" | "users" | "slides";

export default function AdminPage() {
  const [tab, setTab] = useState<AdminTab>("sources");

  const tabs: { id: AdminTab; label: string }[] = [
    { id: "products", label: "Products & Knowledge" },
    { id: "topics", label: "Topics" },
    { id: "competitors", label: "Competitors" },
    { id: "sources", label: "Sources" },
    { id: "users", label: "Users" },
    { id: "slides", label: "Slide Layouts" },
  ];

  return (
    <div className="p-6">
      <h2 className="text-xl font-bold text-db-midnight mb-4">Admin</h2>

      {/* Tab bar */}
      <div className="flex gap-1 border-b mb-6">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.id
                ? "border-db-orange text-db-midnight"
                : "border-transparent text-gray-400 hover:text-gray-600"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "sources" && <SourcesTab />}
      {tab === "products" && <div className="text-gray-500">Products & Knowledge — Task 17</div>}
      {tab === "topics" && <div className="text-gray-500">Topics — Phase 2</div>}
      {tab === "competitors" && <div className="text-gray-500">Competitors — Phase 4</div>}
      {tab === "users" && <div className="text-gray-500">Users — Phase 2</div>}
      {tab === "slides" && <div className="text-gray-500">Slide Layouts — Phase 4</div>}
    </div>
  );
}

function SourcesTab() {
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [newSource, setNewSource] = useState({ name: "", url: "", feedUrl: "" });

  const { data: sourcesList = [] } = useQuery<Source[]>({
    queryKey: ["sources"],
    queryFn: () => api("/sources"),
  });

  const { data: queries = [] } = useQuery<NewsapiQuery[]>({
    queryKey: ["newsapi-queries"],
    queryFn: () => api("/sources/newsapi-queries"),
  });

  const toggleSource = useMutation({
    mutationFn: (id: number) => api(`/sources/${id}/toggle`, { method: "PATCH" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sources"] }),
  });

  const deleteSource = useMutation({
    mutationFn: (id: number) => api(`/sources/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sources"] }),
  });

  const addSource = useMutation({
    mutationFn: () => api("/sources", {
      method: "POST",
      body: JSON.stringify({ ...newSource, sourceType: "rss" }),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sources"] });
      setShowAdd(false);
      setNewSource({ name: "", url: "", feedUrl: "" });
    },
  });

  return (
    <div className="space-y-6">
      {/* RSS Sources */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-db-midnight">RSS Sources ({sourcesList.length})</h3>
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="text-sm bg-db-orange text-white px-3 py-1.5 rounded-md hover:bg-orange-600"
          >
            + Add Source
          </button>
        </div>

        {showAdd && (
          <div className="bg-gray-50 border rounded-lg p-4 mb-4 space-y-3">
            <input
              placeholder="Source name"
              value={newSource.name}
              onChange={(e) => setNewSource((s) => ({ ...s, name: e.target.value }))}
              className="w-full border rounded px-3 py-1.5 text-sm"
            />
            <input
              placeholder="Website URL"
              value={newSource.url}
              onChange={(e) => setNewSource((s) => ({ ...s, url: e.target.value }))}
              className="w-full border rounded px-3 py-1.5 text-sm"
            />
            <input
              placeholder="RSS Feed URL"
              value={newSource.feedUrl}
              onChange={(e) => setNewSource((s) => ({ ...s, feedUrl: e.target.value }))}
              className="w-full border rounded px-3 py-1.5 text-sm"
            />
            <div className="flex gap-2">
              <button onClick={() => addSource.mutate()} className="bg-db-orange text-white px-3 py-1.5 rounded text-sm">Save</button>
              <button onClick={() => setShowAdd(false)} className="text-gray-500 px-3 py-1.5 text-sm">Cancel</button>
            </div>
          </div>
        )}

        <div className="space-y-1">
          {sourcesList.map((source) => (
            <div key={source.id} className="flex items-center justify-between py-2 px-3 bg-white rounded border">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900 truncate">{source.name}</div>
                <div className="text-xs text-gray-400 truncate">{source.feedUrl}</div>
              </div>
              <div className="flex items-center gap-3 ml-4">
                {source.failureCount > 0 && (
                  <span className="text-xs text-red-500">{source.failureCount} failures</span>
                )}
                <button
                  onClick={() => toggleSource.mutate(source.id)}
                  className={`text-xs px-2 py-1 rounded ${
                    source.isActive
                      ? "bg-green-100 text-green-700"
                      : "bg-gray-100 text-gray-500"
                  }`}
                >
                  {source.isActive ? "Active" : "Disabled"}
                </button>
                <button
                  onClick={() => deleteSource.mutate(source.id)}
                  className="text-xs text-red-400 hover:text-red-600"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* NewsAPI Queries */}
      <div>
        <h3 className="font-semibold text-db-midnight mb-3">NewsAPI Queries ({queries.length})</h3>
        <div className="space-y-1">
          {queries.map((q) => (
            <div key={q.id} className="flex items-center justify-between py-2 px-3 bg-white rounded border">
              <span className="text-sm text-gray-700">{q.query}</span>
              <span className={`text-xs px-2 py-1 rounded ${q.isActive ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                {q.isActive ? "Active" : "Disabled"}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update App.tsx to use new admin page**

Replace the `AdminPage` placeholder in `App.tsx`:

```tsx
import AdminPage from "@/pages/admin";
```

And update the route:

```tsx
<Route path="/admin" component={AdminPage} />
```

- [ ] **Step 3: Commit**

```bash
git add .
git commit -m "feat: add admin page with Sources tab (RSS feeds + NewsAPI queries)"
```

---

## Task 17: Frontend — Admin Products & Knowledge Section

**Files:**
- Create: `apps/web/client/src/components/product-tree.tsx`
- Modify: `apps/web/client/src/pages/admin.tsx`

- [ ] **Step 1: Create product tree component**

`apps/web/client/src/components/product-tree.tsx`:

```tsx
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ChevronRight, ChevronDown, Plus, Pencil, Trash2 } from "lucide-react";

interface ProductNode {
  id: number;
  name: string;
  shortName: string | null;
  productType: string;
  description: string | null;
  positioning: string | null;
  keyDifferentiators: string | null;
  keywords: string[];
  isActive: boolean;
  parentIds: number[];
  childIds: number[];
  knowledge: Array<{ id: number; contentType: string; content: string }>;
}

interface ProductTreeProps {
  products: ProductNode[];
}

export default function ProductTree({ products }: ProductTreeProps) {
  // Find root nodes (no parents)
  const roots = products.filter((p) => p.parentIds.length === 0);

  return (
    <div className="space-y-1">
      {roots.map((root) => (
        <ProductTreeNode key={root.id} node={root} allProducts={products} depth={0} />
      ))}
    </div>
  );
}

function ProductTreeNode({ node, allProducts, depth }: { node: ProductNode; allProducts: ProductNode[]; depth: number }) {
  const [expanded, setExpanded] = useState(depth < 2);
  const [editing, setEditing] = useState(false);
  const [editKeywords, setEditKeywords] = useState(node.keywords.join(", "));
  const queryClient = useQueryClient();

  const children = allProducts.filter((p) => p.parentIds.includes(node.id));
  const hasChildren = children.length > 0;

  const updateProduct = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      api(`/products/${node.id}`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      setEditing(false);
    },
  });

  const typeColors: Record<string, string> = {
    platform: "bg-purple-100 text-purple-700",
    product: "bg-blue-100 text-blue-700",
    feature: "bg-gray-100 text-gray-600",
  };

  return (
    <div style={{ marginLeft: depth * 16 }}>
      <div className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-gray-50 group">
        {/* Expand toggle */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-5 h-5 flex items-center justify-center text-gray-400"
        >
          {hasChildren ? (expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : <span className="w-3.5" />}
        </button>

        {/* Product info */}
        <span className={`text-xs px-1.5 py-0.5 rounded ${typeColors[node.productType] || typeColors.feature}`}>
          {node.productType}
        </span>
        <span className="text-sm font-medium text-gray-900">{node.name}</span>
        {node.shortName && <span className="text-xs text-gray-400">({node.shortName})</span>}
        {!node.isActive && <span className="text-xs text-red-400">disabled</span>}

        {/* Actions */}
        <button
          onClick={() => setEditing(!editing)}
          className="ml-auto opacity-0 group-hover:opacity-100 text-gray-400 hover:text-gray-600"
        >
          <Pencil size={14} />
        </button>
      </div>

      {/* Edit panel */}
      {editing && (
        <div className="ml-7 mb-2 bg-gray-50 rounded-lg border p-3 space-y-3">
          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1">Description</label>
            <textarea
              defaultValue={node.description || ""}
              onBlur={(e) => updateProduct.mutate({ description: e.target.value })}
              className="w-full border rounded px-2 py-1.5 text-sm"
              rows={2}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1">Positioning</label>
            <textarea
              defaultValue={node.positioning || ""}
              onBlur={(e) => updateProduct.mutate({ positioning: e.target.value })}
              className="w-full border rounded px-2 py-1.5 text-sm"
              rows={2}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1">Keywords (comma-separated)</label>
            <input
              value={editKeywords}
              onChange={(e) => setEditKeywords(e.target.value)}
              onBlur={() => updateProduct.mutate({
                keywords: editKeywords.split(",").map((k) => k.trim()).filter(Boolean)
              })}
              className="w-full border rounded px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1">Knowledge Entries ({node.knowledge.length})</label>
            {node.knowledge.map((k) => (
              <div key={k.id} className="text-xs text-gray-600 py-1 border-b last:border-b-0">
                <span className="font-medium">{k.contentType}:</span> {k.content.substring(0, 100)}...
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Children */}
      {expanded && children.map((child) => (
        <ProductTreeNode key={child.id} node={child} allProducts={allProducts} depth={depth + 1} />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Add Products tab to admin page**

In `apps/web/client/src/pages/admin.tsx`, replace the products placeholder:

```tsx
{tab === "products" && <ProductsTab />}
```

And add the `ProductsTab` component:

```tsx
import ProductTree from "@/components/product-tree";

function ProductsTab() {
  const { data: productList = [] } = useQuery({
    queryKey: ["products"],
    queryFn: () => api("/products"),
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-db-midnight">Demandbase Product Graph</h3>
      </div>
      <ProductTree products={productList as any[]} />
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add .
git commit -m "feat: add admin Products & Knowledge tab with editable product tree"
```

---

## Task 18: End-to-End Verification

- [ ] **Step 1: Start web server and verify**

```bash
cd apps/web && npm run dev
```

- Open browser to `http://localhost:5173` (Vite dev server)
- Login with `admin@example.com` / `change-me`
- Verify sidebar navigation shows all 5 items (including Admin)
- Navigate to Admin → Sources: verify 22 RSS sources + 8 NewsAPI queries seeded
- Navigate to Admin → Products & Knowledge: verify full Demandbase product tree with expandable nodes, keywords, editing

- [ ] **Step 2: Run worker pipeline**

```bash
cd apps/worker && npm run dev
```

- Verify articles are ingested from RSS feeds
- Verify articles are classified against product graph
- Check database: `SELECT count(*) FROM articles; SELECT count(*) FROM article_product_tags;`

- [ ] **Step 3: Verify articles API**

```bash
curl http://localhost:5000/api/articles?limit=5 -H "Cookie: <session-cookie>"
```

Verify articles return with product tags attached.

- [ ] **Step 4: Commit any fixes**

```bash
git add .
git commit -m "fix: end-to-end verification fixes"
```

- [ ] **Step 5: Create GitHub repo and push**

```bash
cd ~/Desktop/ClaudeApps/gtm-intel
gh repo create gtm-intel --private --source=. --push
```

---

## Phase 1 Complete

At this point you have:
- Monorepo with shared schema
- PostgreSQL with full schema
- Auth (email/password, admin/member)
- 22 RSS sources + 8 NewsAPI queries ingesting articles
- AI classification tagging articles to the Demandbase product graph
- Admin UI: Sources management + Products & Knowledge tree
- App shell with sidebar navigation and placeholder pages

**Next:** Phase 2 — Intelligence + Email (summaries, DB angles, content ideas, digest/alert emails, user preferences)
