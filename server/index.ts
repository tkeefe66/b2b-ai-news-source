import express, { type Request, Response, NextFunction } from "express";
import path from "path";
import { registerRoutes, setLastFeedFetchAt } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { initializeVectorSupport, updateSearchVectors } from "./embeddings";
import { fetchAllFeeds, DEFAULT_SOURCES } from "./rss";
import { fetchNewsAPIArticles } from "./newsapi";
import { storage } from "./storage";
import { db, pool } from "./db";
import { sql } from "drizzle-orm";
import { ensureBriefsTable } from "./morning-brief/ensure-table";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    limit: "500mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

app.use("/slide-images", express.static(
  path.resolve("public", "slide-images")
));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  initializeVectorSupport().catch(err => {
    console.error("Failed to initialize vector support:", err);
  });

  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    async () => {
      log(`serving on port ${port}`);

      try {
        const { rows: existingCats } = await pool.query("SELECT id FROM news_categories LIMIT 1");
        if (existingCats.length === 0) {
          log("News categories empty — auto-seeding defaults...");
          const defaultCategories = [
            { name: "GTM Tech", color_bg: "bg-blue-100 dark:bg-blue-900/30", color_text: "text-blue-700 dark:text-blue-300", sort_order: 0 },
            { name: "AI", color_bg: "bg-purple-100 dark:bg-purple-900/30", color_text: "text-purple-700 dark:text-purple-300", sort_order: 1 },
            { name: "B2B Mktg & Sales", color_bg: "bg-green-100 dark:bg-green-900/30", color_text: "text-green-700 dark:text-green-300", sort_order: 2 },
            { name: "CRM & Enterprise", color_bg: "bg-indigo-100 dark:bg-indigo-900/30", color_text: "text-indigo-700 dark:text-indigo-300", sort_order: 3 },
            { name: "Data & Analytics", color_bg: "bg-sky-100 dark:bg-sky-900/30", color_text: "text-sky-700 dark:text-sky-300", sort_order: 4 },
            { name: "Industry Analysts", color_bg: "bg-slate-100 dark:bg-slate-900/30", color_text: "text-slate-700 dark:text-slate-300", sort_order: 5 },
            { name: "Deals & Markets", color_bg: "bg-emerald-100 dark:bg-emerald-900/30", color_text: "text-emerald-700 dark:text-emerald-300", sort_order: 6 },
            { name: "Technology", color_bg: "bg-orange-100 dark:bg-orange-900/30", color_text: "text-orange-700 dark:text-orange-300", sort_order: 7 },
          ];
          for (const cat of defaultCategories) {
            await pool.query(
              "INSERT INTO news_categories (name, color_bg, color_text, sort_order) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
              [cat.name, cat.color_bg, cat.color_text, cat.sort_order]
            );
          }
          log(`Auto-seeded ${defaultCategories.length} news categories`);
        }

        const { rows: companyTrackerCat } = await pool.query("SELECT id FROM news_categories WHERE name = 'Company Tracker'");
        if (companyTrackerCat.length === 0) {
          const { rows: maxSort } = await pool.query("SELECT COALESCE(MAX(sort_order), 0) + 1 as next_sort FROM news_categories");
          await pool.query(
            "INSERT INTO news_categories (name, color_bg, color_text, sort_order) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
            ["Company Tracker", "bg-cyan-100 dark:bg-cyan-900/30", "text-cyan-700 dark:text-cyan-300", maxSort[0].next_sort]
          );
          log("Auto-seeded 'Company Tracker' category");
        }

        const { rows: existingCompetitors } = await pool.query("SELECT id FROM competitors LIMIT 1");
        if (existingCompetitors.length === 0) {
          log("Competitors empty — auto-seeding defaults...");
          const defaultCompetitors = [
            { name: "6sense", domain: "6sense.com", notes: "ABM Platform — Primary competitor. AI-powered ABM, predictive analytics, intent data, revenue AI" },
            { name: "Apollo.io", domain: "apollo.io", notes: "Sales Intelligence — Contact database, sales engagement, intent signals" },
            { name: "Bombora", domain: "bombora.com", notes: "Intent Data — B2B intent data cooperative, Company Surge signals" },
            { name: "Clearbit (HubSpot)", domain: "clearbit.com", notes: "B2B Data — Data enrichment, reveal, forms. Acquired by HubSpot" },
            { name: "Cognism", domain: "cognism.com", notes: "Sales Intelligence — B2B contact data, intent data, European focus (GDPR compliant)" },
            { name: "D&B (Dun & Bradstreet)", domain: "dnb.com", notes: "B2B Data — Company data, D-U-N-S numbers, firmographic data, risk analytics" },
            { name: "Drift (Salesloft)", domain: "drift.com", notes: "Conversational Marketing — Conversational AI, chatbots, buyer engagement" },
            { name: "Folloze", domain: "folloze.com", notes: "Content Experience — Personalized buyer experiences, ABM content boards" },
            { name: "Foundry (IDG)", domain: "foundryco.com", notes: "Intent Data — Tech media intent data, ABM, content marketing" },
            { name: "HubSpot", domain: "hubspot.com", notes: "Marketing Automation — CRM, marketing hub, ABM tools, expanding into enterprise ABM" },
            { name: "Integrate", domain: "integrate.com", notes: "Demand Generation — Lead management, data validation, demand orchestration" },
            { name: "Koala", domain: "getkoala.com", notes: "Sales Intelligence — Intent signals, visitor identification, pipeline intelligence" },
            { name: "Lead411", domain: "lead411.com", notes: "Sales Intelligence — Contact data with intent triggers" },
            { name: "Leadspace", domain: "leadspace.com", notes: "B2B Data — B2B customer data platform, lead-to-account matching" },
            { name: "Lusha", domain: "lusha.com", notes: "Sales Intelligence — Contact enrichment, prospecting, intent data" },
            { name: "Madison Logic", domain: "madisonlogic.com", notes: "ABM Platform — ABM media activation, intent-powered content syndication" },
            { name: "Marketo (Adobe)", domain: "marketo.com", notes: "Marketing Automation — Enterprise marketing automation, lead management, ABM features" },
            { name: "Metadata.io", domain: "metadata.io", notes: "B2B Advertising — Demand generation, paid campaign automation, ABM targeting" },
            { name: "N.Rich", domain: "n.rich", notes: "ABM Platform — European ABM advertising and analytics platform" },
            { name: "Ocean.io", domain: "ocean.io", notes: "B2B Data — AI-powered lookalike audience and account targeting" },
            { name: "PathFactory", domain: "pathfactory.com", notes: "Content Experience — Content intelligence, engagement tracking, ABM content" },
            { name: "Qualified", domain: "qualified.com", notes: "Conversational Marketing — Pipeline generation, live chat, meeting scheduling for target accounts" },
            { name: "RollWorks (NextRoll)", domain: "rollworks.com", notes: "ABM Platform — Account-based platform for B2B advertising and sales automation" },
            { name: "Salesforce Marketing Cloud", domain: "salesforce.com", notes: "Marketing Automation — Enterprise marketing platform, account engagement (Pardot)" },
            { name: "Seamless.AI", domain: "seamless.ai", notes: "Sales Intelligence — Real-time contact search, sales prospecting" },
            { name: "TechTarget", domain: "techtarget.com", notes: "Intent Data — Purchase intent data for technology buyers, Priority Engine" },
            { name: "Terminus (DemandScience)", domain: "terminus.com", notes: "ABM Platform — Multi-channel ABM, account-based advertising, chat, email" },
            { name: "Triblio (Foundry)", domain: "triblio.com", notes: "ABM Platform — Multi-channel ABM orchestration, web personalization" },
            { name: "Warmly", domain: "warmly.ai", notes: "Conversational Marketing — Website visitor de-anonymization, real-time orchestration" },
            { name: "ZoomInfo", domain: "zoominfo.com", notes: "Sales Intelligence — Contact database, intent data, engagement platform, GTM platform" },
          ];
          for (const comp of defaultCompetitors) {
            await pool.query(
              "INSERT INTO competitors (name, domain, notes) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
              [comp.name, comp.domain, comp.notes]
            );
          }
          log(`Auto-seeded ${defaultCompetitors.length} competitors`);
        }

        const existingDesigns = await storage.getSlideDesigns();
        if (existingDesigns.length === 0) {
          log("Slide designs empty — auto-seeding defaults...");
          const defaultDesigns = [
            { layoutType: "title", variantName: "Standard", description: "Opening slide with left Midnight accent block, large Roboto Serif title, subtitle, and Sky-blue bottom bar.", designNotes: "White background. Narrow left Midnight accent block. Title: Roboto Serif 36pt Midnight bold. Subtitle: Roboto 16pt. Thin Sky bar at bottom edge.", sampleTitle: "Unlocking ABM at Scale", sampleBody: "A Demandbase Perspective on Account-Based Go-to-Market", isApproved: true, isDefault: true },
            { layoutType: "content", variantName: "Standard", description: "Clean white slide with headline and body text. No header or footer bars — matches corporate template.", designNotes: "White background. Title: Roboto Serif 24pt Midnight bold at top. Body: Roboto 12-14pt (auto-sized). No header/footer bars.", sampleTitle: "Why Account-Based Strategy Wins", sampleBody: "- Aligns sales and marketing around high-value accounts\n- Increases pipeline velocity with precision targeting\n- Reduces wasted spend on unqualified leads\n- Enables personalized engagement at every touchpoint\n- Drives measurable ROI through focused execution", isApproved: true, isDefault: true },
            { layoutType: "stats", variantName: "Standard", description: "Large numbers with labels beneath. Supports 1-4 stats with auto-column layout and colored accent dividers.", designNotes: "White background. Numbers: Roboto 50-54pt Midnight. Labels: Roboto 14pt. Colored accent dividers (Sky, Sunset, Lavender) between number and label.", sampleTitle: "The Impact of ABM", sampleBody: "3.5x | Higher engagement rates vs. traditional marketing\n73% | Of pipeline sourced from target accounts\n40% | Reduction in customer acquisition cost", isApproved: true, isDefault: true },
            { layoutType: "comparison", variantName: "Standard", description: "Two equal columns with Sky tint (#DBECFF) backgrounds for side-by-side comparisons.", designNotes: "White background. Two columns with #DBECFF backgrounds. Headers: Roboto 16pt bold Midnight. Body: Roboto 13pt. Split by --- separator.", sampleTitle: "Traditional vs. Account-Based", sampleBody: "**Traditional Marketing**\n- Broad audience targeting\n- Lead-based metrics\n- Marketing and sales silos\n- One-size-fits-all messaging\n---\n**Account-Based Marketing**\n- Focused on ideal accounts\n- Account-level engagement metrics\n- Unified revenue team\n- Personalized multi-channel campaigns", isApproved: true, isDefault: true },
            { layoutType: "section", variantName: "Standard", description: "Dark Midnight background with auto-incrementing section number in Sky blue and white title.", designNotes: "Midnight background. Section number: Roboto Serif 48pt Sky blue. Title: Roboto Serif 36pt white bold. Subtitle: Roboto 16pt Cloud gray.", sampleTitle: "Platform Deep Dive", sampleBody: "How Demandbase One powers your entire GTM motion", isApproved: true, isDefault: true },
            { layoutType: "statement", variantName: "Standard", description: "White slide with uppercase eyebrow label and large statement text for emphasis.", designNotes: "White background. Uppercase eyebrow: Roboto Medium 14pt bold. Statement: Roboto Serif 32pt Midnight. 150% line spacing.", sampleTitle: "The Opportunity", sampleBody: "B2B buyers are 70% through their decision process before ever talking to sales. The question isn't whether to adopt ABM — it's how fast you can scale it.", isApproved: true, isDefault: true },
            { layoutType: "quote", variantName: "Standard", description: "Sky tint (#DBECFF) background with large opening quotation mark and italic serif quote.", designNotes: "Sky tint (#DBECFF) background. Quote mark: Roboto Serif 72pt Midnight. Quote: Roboto Serif 24pt italic. Attribution: Roboto 14pt bold.", sampleTitle: "Customer Voice", sampleBody: "\"Demandbase helped us identify and engage our top 500 accounts with precision we never had before.\"\n— VP of Marketing, Fortune 500 Tech Company", isApproved: true, isDefault: true },
            { layoutType: "objection", variantName: "Standard", description: "Two-column layout with Sunset tint for the objection and Sky tint for the response.", designNotes: "White background. Left column: Sunset tint (#FFE4D6). Right column: Sky tint (#DBECFF). Headers: Roboto 16pt bold. Body: Roboto 13pt.", sampleTitle: "Handling Objections", sampleBody: "**Common Concern**\n- \"ABM sounds great but our team is too small\"\n- \"We don't have the data to identify target accounts\"\n- \"Our sales team won't adopt new tools\"\n---\n**Our Response**\n- AI automation means a team of 2 can run ABM at scale\n- Demandbase provides built-in intent data and account identification\n- Native CRM integration means zero workflow disruption", isApproved: true, isDefault: true },
            { layoutType: "callout", variantName: "Standard", description: "Numbered circle badges with heading and detail for each item. Supports up to 5 callout items.", designNotes: "White background. Numbered circles: Sky/Sunset/Lavender. Headings: Roboto Serif 13pt bold. Details: Roboto 11pt. Divider lines between items.", sampleTitle: "Five Pillars of ABM Success", sampleBody: "Account Selection\n- Use intent data and firmographics to build your ICP\nPersonalized Engagement\n- Tailor messaging to each account's specific pain points\nSales & Marketing Alignment\n- Unified playbooks and shared KPIs\nMulti-Channel Orchestration\n- Coordinate ads, email, web, and direct outreach\nMeasurement & Optimization\n- Track account-level pipeline and revenue impact", isApproved: true, isDefault: true },
            { layoutType: "closing", variantName: "Standard", description: "Dark Midnight background with centered 'Thank you' headline and CTA.", designNotes: "Midnight background. Headline: Roboto Serif 44pt white bold centered. CTA: Roboto 16pt Sky. Sunset accent bars and dot.", sampleTitle: "Thank you", sampleBody: "Ready to automate your pipeline?\ndemandbase.com", isApproved: true, isDefault: true },

            { layoutType: "title", variantName: "Bold Header", description: "Full-width Midnight header bar at top with Sunset accent line beneath. Clean and commanding.", designNotes: "White background. Bold header: full-width Midnight header bar at top. Sunset accent line below header. Title: Roboto Serif 38pt. Sunset bottom bar.", sampleTitle: "Revenue Intelligence Report", sampleBody: "Q4 2025 Pipeline Analysis & Strategic Recommendations", isApproved: true, isDefault: true },
            { layoutType: "title", variantName: "Minimal Accent", description: "Clean design with thin Lavender accent line on the left and Hunter green bottom bar.", designNotes: "White background. Minimal accent: thin accent line on left edge in Lavender. Lavender divider below title. Hunter green bottom bar.", sampleTitle: "Competitive Landscape", sampleBody: "How Our Platform Outperforms the Market", isApproved: true, isDefault: true },

            { layoutType: "content", variantName: "Left Accent", description: "Tall Sky accent bar running the full height of the left edge with Sunset bullet indicators.", designNotes: "White background. Left accent bar: tall accent bar running full height in Sky. Sunset dot bullets. Sky bottom bar.", sampleTitle: "Key Platform Capabilities", sampleBody: "- Intent signal detection across 500K+ B2B sites\n- AI-powered account scoring and prioritization\n- Real-time buying group identification\n- Cross-channel campaign orchestration\n- Revenue attribution at the account level", isApproved: true, isDefault: true },
            { layoutType: "content", variantName: "Dark Header", description: "Midnight header bar with white title text and Sunset accent line. Clean body area below.", designNotes: "White background. Dark header: Midnight header bar with white title text. Sunset accent dash bullets. Midnight footer bar.", sampleTitle: "Implementation Roadmap", sampleBody: "- Phase 1: Data integration and account matching\n- Phase 2: Intent signal activation and scoring\n- Phase 3: Campaign orchestration and personalization\n- Phase 4: Full revenue attribution and optimization", isApproved: true, isDefault: true },

            { layoutType: "stats", variantName: "Dark Background", description: "Midnight background with colorful stat numbers in Sky, Sunset, and Cascade. High contrast impact.", designNotes: "Midnight background. Numbers in brand colors (Sky, Sunset, Cascade). Subtle colored dividers. White labels.", sampleTitle: "Platform Performance Metrics", sampleBody: "98% | Account match rate across CRM records\n2.1x | Faster pipeline velocity with intent signals\n$4.2M | Average incremental revenue per customer", isApproved: true, isDefault: true },
            { layoutType: "stats", variantName: "Stat Cards", description: "Each metric displayed in its own colored card with Sky, Sunset, and Lavender tint backgrounds.", designNotes: "White background. Stat cards: each metric in card background with colored top accent bar. Sky tint, Sunset tint, Lavender tint cards.", sampleTitle: "Customer Success Highlights", sampleBody: "87% | Customer retention rate year-over-year\n45 | Average days to first value realization\n3.8x | ROI within first 12 months of deployment", isApproved: true, isDefault: true },

            { layoutType: "comparison", variantName: "Contrast Columns", description: "Left column in warm Sunset tint, right in cool Sky tint. Color-coded accent bars at top.", designNotes: "White background. Contrast columns: left in Sunset tint (#FFE4D6), right in Sky tint (#DBECFF). Colored accent bars at top of each column.", sampleTitle: "Before & After Demandbase", sampleBody: "**Without Demandbase**\n- Manual account research taking hours per prospect\n- Disconnected marketing and sales data\n- Spray-and-pray advertising approach\n- Unclear ROI on marketing spend\n---\n**With Demandbase**\n- AI-powered account intelligence in seconds\n- Unified view across the entire revenue team\n- Precision advertising to in-market accounts\n- Clear attribution from impression to revenue", isApproved: true, isDefault: true },
            { layoutType: "comparison", variantName: "Bordered Columns", description: "White columns with bold colored left borders in Merlot and Hunter green. Elegant and distinctive.", designNotes: "White background. Bordered columns: white cards with colored left border. Merlot border on left column, Hunter border on right. Subtle shadow.", sampleTitle: "Sales-Led vs. Account-Based", sampleBody: "**Sales-Led Motion**\n- Relies on individual rep outreach\n- Cold calling and email blasts\n- Pipeline built from scratch each quarter\n- Inconsistent messaging across reps\n---\n**Account-Based Motion**\n- Coordinated across entire revenue team\n- Warm engagement with in-market accounts\n- Always-on pipeline generation engine\n- Consistent brand experience at every touchpoint", isApproved: true, isDefault: true },

            { layoutType: "section", variantName: "Accent Bar", description: "Midnight background with Sunset-colored section number and dual accent bars at the bottom.", designNotes: "Midnight background. Section number in Sunset. Accent bottom bar: Sunset bottom bar with Sky accent line above.", sampleTitle: "Market Analysis", sampleBody: "Understanding the competitive landscape and buyer behavior", isApproved: true, isDefault: true },

            { layoutType: "statement", variantName: "Dark Impact", description: "Midnight background with centered statement in white. Sky eyebrow label and Sunset accent line.", designNotes: "Midnight background. Centered text. Sky eyebrow label. Statement in white Roboto Serif. Sunset accent line below.", sampleTitle: "The Shift", sampleBody: "Companies that adopt account-based strategies see 208% more revenue from their marketing efforts. The era of spray-and-pray is over.", isApproved: true, isDefault: true },
            { layoutType: "statement", variantName: "Pull Quote", description: "White background with a bold Sky accent bar on the left edge. Pull-quote style emphasis.", designNotes: "White background. Pull-quote style: tall Sky left accent bar. Sky-colored eyebrow label. Indented statement text.", sampleTitle: "Our Belief", sampleBody: "Every B2B company deserves the intelligence to compete with the largest enterprises. AI makes that possible today, not tomorrow.", isApproved: true, isDefault: true },

            { layoutType: "quote", variantName: "Dark Testimonial", description: "Midnight background with Sunset quote mark and white italic text. Attribution in Sky blue.", designNotes: "Midnight background. Sunset quote mark at 60% opacity. White italic quote text. Sky attribution. Sunset bottom bar.", sampleTitle: "Executive Endorsement", sampleBody: "\"The precision of Demandbase's intent data transformed how we prioritize accounts. We closed 40% more enterprise deals in Q3.\"\n— CRO, Enterprise Software Company", isApproved: true, isDefault: true },
            { layoutType: "quote", variantName: "Minimal White", description: "Clean white background with large faded Sky quote mark and Lavender accent divider.", designNotes: "White background. Minimal style: large Sky quote mark at 25% opacity. Lavender divider before attribution. Clean and elegant.", sampleTitle: "Partner Perspective", sampleBody: "\"Integrating Demandbase into our tech stack was seamless. The account-level insights changed our entire go-to-market approach.\"\n— VP Partnerships, Global Consulting Firm", isApproved: true, isDefault: true },

            { layoutType: "objection", variantName: "Clean Cards", description: "No header or footer bars. Side-by-side cards with colored top borders in Sunset and Sky.", designNotes: "White background. Clean layout: no header, no footer. Two cards with colored top accents. Sunset tint left, Sky tint right.", sampleTitle: "Addressing Budget Concerns", sampleBody: "**Common Pushback**\n- \"We already invested in a MAP and CRM\"\n- \"The ROI timeline is too long for our board\"\n- \"We need to consolidate tools, not add another\"\n---\n**How We Respond**\n- Demandbase augments your existing stack — no rip-and-replace\n- Average payback period is under 6 months\n- We replace 3-5 point solutions, actually reducing total cost", isApproved: true, isDefault: true },

            { layoutType: "callout", variantName: "Clean Cards", description: "No header or footer. Items displayed as colored cards with left accent bars in brand colors.", designNotes: "White background. Clean layout: no header, no footer. Items as colored card backgrounds (Sky tint, Sunset tint, Lavender tint, Hunter tint). Left accent bars.", sampleTitle: "Four Steps to ABM Maturity", sampleBody: "Foundation & Data\n- Unify CRM, MAP, and intent data into a single source of truth\nTargeting & Prioritization\n- Use AI to identify and score in-market accounts\nEngagement & Orchestration\n- Launch coordinated campaigns across all channels\nMeasurement & Scale\n- Attribute revenue to account-level activities and optimize", isApproved: true, isDefault: true },

            { layoutType: "closing", variantName: "Warm Accent", description: "Midnight background with Sky divider line, Lavender decorative dot, and full Sunset bottom bar.", designNotes: "Midnight background. Warm closing: Sky divider line. Lavender dot. Full Sunset bottom bar.", sampleTitle: "Let's Connect", sampleBody: "Schedule a personalized demo\ndemandbase.com/demo", isApproved: true, isDefault: true },
          ];
          for (const design of defaultDesigns) {
            await storage.createSlideDesign({ ...design, designTemplate: "Classic" });
          }
          log(`Auto-seeded ${defaultDesigns.length} default slide designs`);
        }

        const npDesign = existingDesigns.find((d: any) => d.variantName === "Numbered Paragraphs" && d.layoutType === "content");
        if (!npDesign) {
          await storage.createSlideDesign({
            layoutType: "content",
            variantName: "Numbered Paragraphs",
            description: "Three numbered columns on a Sky tint background with an inner frosted card area. Each column has a large serif number, bold heading, dark divider line, and paragraph body text. Demandbase logo watermark in bottom-left.",
            designNotes: "Sky tint background. Numbered paragraphs layout. Numbered analysis columns. Three columns inside a frosted inner card. Large serif numbers (1. 2. 3.). Bold headings. Dark divider lines. Body paragraph text. Demandbase logo watermark bottom-left.",
            sampleTitle: "Goal Of In-depth Analysis",
            sampleBody: "1 | Assess influence of tiered strategy on pipeline\nFor this part of the analysis we take a look at the deduplicated reached accounts across the TOF/Awareness, RCM, Claims, and Denials verticals and assess pipeline impacts, along with pre-and-post exposure account performance.\n===\n2 | Assess effectiveness of tiered strategy\nFor this part of the analysis we take a look at like audiences for the TOF/Awareness, RCM, Claims, and Denials verticals that were unreached with a DB impression, and compare their funnel movement against the reached accounts in the same verticals.\n===\n3 | Provide recs to take strategy to next level\nFor the last part of the analysis, we take a look at the current segmentation and campaign strategy and make recommendations on how to elevate to the next level.",
            isApproved: true,
            isDefault: true,
            sourceFile: "Demandbase_Corporate_Deck_Template.pptx",
            designTemplate: "Corporate Deck",
          });
          log("Auto-seeded 'Numbered Paragraphs' content design");
        }

        const knowledgeEntries = await storage.getKnowledgeEntries();
        if (knowledgeEntries.length === 0) {
          log("Knowledge base empty — auto-seeding from built-in data...");
          try {
            const seedData = (await import("./knowledge-seed-data.json")).default as Array<{
              category: string; title: string; content: string; sourceUrl: string | null; isActive: boolean;
            }>;
            let seeded = 0;
            for (const entry of seedData) {
              try {
                await storage.createKnowledgeEntry({
                  category: entry.category,
                  title: entry.title,
                  content: entry.content,
                  sourceUrl: entry.sourceUrl || null,
                  isActive: entry.isActive !== false,
                });
                seeded++;
              } catch (e: any) {
                console.error(`Failed to seed "${entry.title}":`, e.message);
              }
            }
            log(`Auto-seeded ${seeded} knowledge entries`);
          } catch (seedErr: any) {
            console.error("Knowledge seed failed (non-fatal):", seedErr.message);
          }
        }

        const categoryMap: Record<string, string> = {
          "AI & Technology": "AI",
          "AI Marketing": "AI",
          "AI & ML": "AI",
          "Artificial Intelligence": "AI",
          "B2B Marketing": "B2B Mktg & Sales",
          "B2B Sales & Marketing": "B2B Mktg & Sales",
          "B2B Sales": "B2B Mktg & Sales",
          "Marketing": "B2B Mktg & Sales",
          "Sales": "B2B Mktg & Sales",
          "MarTech": "B2B Mktg & Sales",
          "SalesTech": "B2B Mktg & Sales",
          "Marketing Technology": "B2B Mktg & Sales",
          "Sales Technology": "B2B Mktg & Sales",
          "CRM": "CRM & Enterprise",
          "Enterprise": "CRM & Enterprise",
          "Enterprise Software": "CRM & Enterprise",
          "Analytics": "Data & Analytics",
          "Data": "Data & Analytics",
          "Data Science": "Data & Analytics",
          "Markets": "Deals & Markets",
          "Funding": "Deals & Markets",
          "M&A": "Deals & Markets",
          "Go-To-Market": "GTM Tech",
          "GTM": "GTM Tech",
          "Analysts": "Industry Analysts",
          "Research": "Industry Analysts",
          "Tech": "Technology",
          "General": "Technology",
          "General Technology": "Technology",
        };
        for (const [variant, standard] of Object.entries(categoryMap)) {
          const updated = await db.execute(sql`UPDATE articles SET category = ${standard} WHERE category = ${variant}`);
          const updatedSrc = await db.execute(sql`UPDATE sources SET category = ${standard} WHERE category = ${variant}`);
        }
        log("Category normalization complete");

        const existingSources = await storage.getSources();
        const existingFeedUrls = new Set(existingSources.map(s => s.feedUrl));
        let addedSources = 0;
        for (const source of DEFAULT_SOURCES) {
          if (!existingFeedUrls.has(source.feedUrl)) {
            await storage.createSource(source);
            addedSources++;
          }
        }
        if (addedSources > 0) {
          log(`Auto-seeded ${addedSources} new sources (total: ${existingSources.length + addedSources})`);
        }
        log("Fetching feeds on startup...");
        const rssResult = await fetchAllFeeds();
        const newsApiResult = await fetchNewsAPIArticles();
        const newArticles = rssResult.total + newsApiResult.total;
        log(`Startup fetch: ${newArticles} new articles (RSS: ${rssResult.total}, NewsAPI: ${newsApiResult.total})`);
        setLastFeedFetchAt();
        if (newArticles > 0) {
          await updateSearchVectors().catch(err => {
            console.error("Error indexing articles on startup:", err);
          });
        }
      } catch (err) {
        console.error("Auto-seed error (non-fatal):", err);
      }

      const RSS_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
      const NEWSAPI_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours (free tier: 100 req/day)

      setInterval(async () => {
        try {
          log("Auto-fetch: starting scheduled RSS refresh...");
          const rssResult = await fetchAllFeeds();
          log(`Auto-fetch: ${rssResult.total} new articles from RSS`);
          setLastFeedFetchAt();
          if (rssResult.total > 0) {
            await updateSearchVectors().catch(err => {
              console.error("Auto-fetch: error indexing articles:", err);
            });
          }
        } catch (err) {
          console.error("Auto-fetch RSS error (non-fatal):", err);
        }
      }, RSS_INTERVAL_MS);

      setInterval(async () => {
        try {
          log("Auto-fetch: starting scheduled NewsAPI refresh...");
          const newsApiResult = await fetchNewsAPIArticles();
          log(`Auto-fetch: ${newsApiResult.total} new articles from NewsAPI (${newsApiResult.errors} errors)`);
          if (newsApiResult.total > 0) {
            await updateSearchVectors().catch(err => {
              console.error("Auto-fetch: error indexing NewsAPI articles:", err);
            });
          }
        } catch (err) {
          console.error("Auto-fetch NewsAPI error (non-fatal):", err);
        }
      }, NEWSAPI_INTERVAL_MS);

      log(`Auto-fetch scheduled: RSS every ${RSS_INTERVAL_MS / 60000} min, NewsAPI every ${NEWSAPI_INTERVAL_MS / 3600000} hrs`);

      ensureBriefsTable().catch(err => {
        console.error("Failed to ensure briefs table (non-fatal):", err);
      });
    },
  );
})();
