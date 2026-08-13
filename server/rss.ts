import RSSParser from "rss-parser";
import { storage } from "./storage";
import { pool } from "./db";
import type { InsertArticle } from "@shared/schema";
import { mapFeedItem, type FeedItemInput } from "./ingest";

const parser = new RSSParser({
  timeout: 10000,
  headers: {
    "User-Agent": "MarTech-News-Aggregator/1.0",
  },
});

async function recordFetchFailure(sourceId: number, errorMessage: string): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO source_fetch_failures (source_id, failed_date, error_message)
       VALUES ($1, CURRENT_DATE, $2)
       ON CONFLICT (source_id, failed_date) DO NOTHING`,
      [sourceId, errorMessage.substring(0, 500)]
    );
  } catch (err) {
    console.error(`Failed to record fetch failure for source ${sourceId}:`, err);
  }
}

async function clearFetchFailures(sourceId: number): Promise<void> {
  try {
    await pool.query("DELETE FROM source_fetch_failures WHERE source_id = $1", [sourceId]);
  } catch (err) {
    console.error(`Failed to clear fetch failures for source ${sourceId}:`, err);
  }
}

async function checkAndRemoveFailingSources(): Promise<string[]> {
  const removed: string[] = [];
  try {
    const { rows } = await pool.query(`
      SELECT sff.source_id, s.name, COUNT(DISTINCT sff.failed_date) as failure_days
      FROM source_fetch_failures sff
      JOIN sources s ON s.id = sff.source_id
      GROUP BY sff.source_id, s.name
      HAVING COUNT(DISTINCT sff.failed_date) >= 3
    `);
    for (const row of rows) {
      console.log(`Auto-removing source "${row.name}" (ID: ${row.source_id}) after ${row.failure_days} days of fetch failures`);
      await pool.query("DELETE FROM source_fetch_failures WHERE source_id = $1", [row.source_id]);
      await pool.query("DELETE FROM sources WHERE id = $1", [row.source_id]);
      removed.push(row.name);
    }
  } catch (err) {
    console.error("Error checking for failing sources:", err);
  }
  return removed;
}

export async function fetchFeedArticles(sourceId: number, feedUrl: string, sourceName: string, category: string): Promise<number> {
  let added = 0;
  try {
    const feed = await parser.parseURL(feedUrl);
    for (const item of feed.items.slice(0, 20)) {
      if (!item.link || !item.title) continue;

      const mapped = mapFeedItem(item as FeedItemInput);

      const tagStatuses = await storage.upsertFeedTags(mapped.tags);
      if (Object.values(tagStatuses).includes("blocked")) {
        continue; // article carries an admin-blocked tag (e.g. "sponsored")
      }

      let existing = mapped.guid ? await storage.getArticleByGuid(sourceId, mapped.guid) : undefined;
      if (!existing) existing = await storage.getArticleByLink(item.link);
      if (existing) {
        if (mapped.guid && !existing.guid) {
          await storage.setArticleGuid(existing.id, mapped.guid);
        }
        continue;
      }

      const article: InsertArticle = {
        title: item.title,
        link: item.link,
        guid: mapped.guid,
        tags: mapped.tags.length > 0 ? mapped.tags.map((t) => t.name) : null,
        description: mapped.description,
        content: mapped.content,
        author: item.creator || item.author || null,
        publishedAt: item.pubDate ? new Date(item.pubDate) : new Date(),
        sourceId,
        sourceName,
        category,
        imageUrl: extractImageUrl(item) || null,
        isRead: false,
      };

      try {
        await storage.createArticle(article);
        added++;
        if (mapped.tags.length) await storage.incrementTagCounts(mapped.tags.map((t) => t.name));
      } catch (err: any) {
        const pgCode = err?.code ?? err?.cause?.code;
        if (pgCode === "23505") continue; // unique-index race: another fetch inserted it first
        throw err;
      }
    }
    await storage.updateSourceLastFetched(sourceId);
    await clearFetchFailures(sourceId);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`Error fetching feed ${feedUrl}:`, errorMsg);
    await recordFetchFailure(sourceId, errorMsg);
  }
  return added;
}

function extractImageUrl(item: any): string | null {
  if (item.enclosure?.url) return item.enclosure.url;
  if (item["media:content"]?.url) return item["media:content"].url;
  if (item.content) {
    const match = item.content.match(/<img[^>]+src="([^"]+)"/);
    if (match) return match[1];
  }
  return null;
}

export async function fetchAllFeeds(): Promise<{ total: number; errors: number; removed: string[] }> {
  const allSources = await storage.getSources();
  const activeSources = allSources.filter(s => s.isActive);
  let total = 0;
  let errors = 0;

  for (const source of activeSources) {
    try {
      const count = await fetchFeedArticles(source.id, source.feedUrl, source.name, source.category);
      total += count;
    } catch {
      errors++;
    }
  }

  const removed = await checkAndRemoveFailingSources();
  if (removed.length > 0) {
    console.log(`Auto-removed ${removed.length} failing sources: ${removed.join(", ")}`);
  }

  return { total, errors, removed };
}

export const DEFAULT_SOURCES = [
  // === MarTech & Marketing Technology ===
  {
    name: "MarTech.org",
    url: "https://martech.org",
    feedUrl: "https://martech.org/feed/",
    category: "GTM Tech",
    description: "Premier martech news covering AI agents, marketing automation, demand gen, and analytics.",
    isActive: true,
  },
  {
    name: "Martech Zone",
    url: "https://martech.zone",
    feedUrl: "https://feed.martech.zone",
    category: "GTM Tech",
    description: "Deep dives into sales and marketing platforms, tech implementation guides.",
    isActive: true,
  },
  {
    name: "ChiefMartec",
    url: "https://chiefmartec.com",
    feedUrl: "https://chiefmartec.com/feed/",
    category: "GTM Tech",
    description: "Scott Brinker's blog on marketing technology landscape, martech stacks, and vendor analysis.",
    isActive: true,
  },

  // === AI ===
  {
    name: "VentureBeat AI",
    url: "https://venturebeat.com/category/ai/",
    feedUrl: "https://venturebeat.com/category/ai/feed/",
    category: "AI",
    description: "Transformative AI tech news with business context for decision-makers.",
    isActive: true,
  },
  {
    name: "TechCrunch",
    url: "https://techcrunch.com",
    feedUrl: "https://techcrunch.com/feed/",
    category: "Technology",
    description: "Startup funding, product launches, and venture capital news.",
    isActive: true,
  },
  {
    name: "The Verge - AI",
    url: "https://www.theverge.com/ai-artificial-intelligence",
    feedUrl: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml",
    category: "AI",
    description: "AI coverage from The Verge, focused on products and industry shifts.",
    isActive: true,
  },
  {
    name: "MIT Technology Review - AI",
    url: "https://www.technologyreview.com/topic/artificial-intelligence/",
    feedUrl: "https://www.technologyreview.com/topic/artificial-intelligence/feed",
    category: "AI",
    description: "MIT's coverage of breakthroughs in AI research and commercial applications.",
    isActive: true,
  },
  {
    name: "Wired - AI",
    url: "https://www.wired.com/tag/artificial-intelligence/",
    feedUrl: "https://www.wired.com/feed/tag/ai/latest/rss",
    category: "AI",
    description: "In-depth AI stories from Wired covering ethics, business, and innovation.",
    isActive: true,
  },
  {
    name: "Ars Technica - AI",
    url: "https://arstechnica.com/ai/",
    feedUrl: "https://feeds.arstechnica.com/arstechnica/features",
    category: "AI",
    description: "Deep technical AI coverage from Ars Technica.",
    isActive: true,
  },

  // === AI (Marketing) ===
  {
    name: "Marketing AI Institute",
    url: "https://www.marketingaiinstitute.com",
    feedUrl: "https://www.marketingaiinstitute.com/blog/rss.xml",
    category: "AI",
    description: "AI, ML, and cognitive computing insights for marketers.",
    isActive: true,
  },
  {
    name: "WordLift AI Blog",
    url: "https://wordlift.io/blog/en/",
    feedUrl: "https://wordlift.io/blog/en/feed/",
    category: "AI",
    description: "Machine learning for content marketing and AI-driven SEO automation.",
    isActive: true,
  },

  // === B2B Mktg & Sales ===
  {
    name: "HubSpot Marketing Blog",
    url: "https://blog.hubspot.com/marketing",
    feedUrl: "https://blog.hubspot.com/marketing/rss.xml",
    category: "B2B Mktg & Sales",
    description: "Inbound marketing, SEO, social media, email marketing, and automation.",
    isActive: true,
  },
  {
    name: "HubSpot Sales Blog",
    url: "https://blog.hubspot.com/sales",
    feedUrl: "https://blog.hubspot.com/sales/rss.xml",
    category: "B2B Mktg & Sales",
    description: "Sales strategies, CRM tips, pipeline management, and closing techniques.",
    isActive: true,
  },
  {
    name: "Content Marketing Institute",
    url: "https://contentmarketinginstitute.com",
    feedUrl: "https://contentmarketinginstitute.com/feed/",
    category: "B2B Mktg & Sales",
    description: "Content marketing strategy, best practices, and research for B2B.",
    isActive: false, // XML parse error
  },
  {
    name: "Demand Gen Report",
    url: "https://www.demandgenreport.com",
    feedUrl: "https://www.demandgenreport.com/feed/",
    category: "B2B Mktg & Sales",
    description: "B2B demand generation news, ABM strategies, and buyer engagement tactics.",
    isActive: true,
  },
  {
    name: "Smart Insights",
    url: "https://www.smartinsights.com",
    feedUrl: "https://www.smartinsights.com/feed/",
    category: "B2B Mktg & Sales",
    description: "Digital marketing strategy, analytics, and tactics for business marketers.",
    isActive: true,
  },
  {
    name: "TopRank Marketing",
    url: "https://www.toprankmarketing.com",
    feedUrl: "https://www.toprankmarketing.com/blog/feed/",
    category: "B2B Mktg & Sales",
    description: "SEO, influencer marketing, full-funnel B2B content strategy.",
    isActive: true,
  },
  {
    name: "Convince & Convert",
    url: "https://www.convinceandconvert.com",
    feedUrl: "https://www.convinceandconvert.com/feed/",
    category: "B2B Mktg & Sales",
    description: "Digital marketing and CX advisory with data-driven insights.",
    isActive: true,
  },
  {
    name: "Drift / Salesloft Blog",
    url: "https://www.salesloft.com/resources/blog",
    feedUrl: "https://www.salesloft.com/resources/blog/feed/",
    category: "B2B Mktg & Sales",
    description: "Conversational marketing, revenue orchestration, and sales engagement.",
    isActive: false, // XML parse error
  },

  // === SalesTech & Revenue Operations ===
  {
    name: "SalesTechStar",
    url: "https://salestechstar.com",
    feedUrl: "https://salestechstar.com/feed/",
    category: "GTM Tech",
    description: "SalesTech news, AI-powered sales tools, CRM trends, and buyer journey insights.",
    isActive: true,
  },
  {
    name: "Heinz Marketing",
    url: "https://heinzmarketing.com",
    feedUrl: "https://heinzmarketing.com/blog/feed/",
    category: "B2B Mktg & Sales",
    description: "Daily B2B sales and marketing insights, pipeline strategy, and content marketing.",
    isActive: true,
  },
  {
    name: "SaaStr",
    url: "https://www.saastr.com",
    feedUrl: "https://www.saastr.com/feed/",
    category: "GTM Tech",
    description: "SaaS sales strategies, CEO insights, founder stories, and growth playbooks.",
    isActive: true,
  },
  {
    name: "Gong Blog",
    url: "https://www.gong.io/blog/",
    feedUrl: "https://www.gong.io/blog/feed/",
    category: "GTM Tech",
    description: "Revenue intelligence, conversation analytics, and sales best practices.",
    isActive: false, // 404
  },
  {
    name: "Outreach Blog",
    url: "https://www.outreach.io/blog",
    feedUrl: "https://www.outreach.io/blog/rss.xml",
    category: "GTM Tech",
    description: "Sales execution, engagement strategies, and pipeline management insights.",
    isActive: false, // 404
  },
  {
    name: "Cognism Blog",
    url: "https://www.cognism.com/blog",
    feedUrl: "https://www.cognism.com/blog/rss.xml",
    category: "B2B Mktg & Sales",
    description: "B2B lead generation, outbound strategies, data-driven sales, and ABM.",
    isActive: true,
  },
  {
    name: "Pipedrive Blog",
    url: "https://www.pipedrive.com/en/blog",
    feedUrl: "https://www.pipedrive.com/en/blog/feed",
    category: "GTM Tech",
    description: "CRM tips, sales strategies, and small business sales technology advice.",
    isActive: false, // XML parse error
  },

  // === CRM & Enterprise ===
  {
    name: "Salesforce Blog",
    url: "https://www.salesforce.com/blog/",
    feedUrl: "https://www.salesforce.com/blog/feed/",
    category: "CRM & Enterprise",
    description: "CRM trends, AI (Einstein), customer success, and enterprise digital transformation.",
    isActive: true,
  },
  {
    name: "ZoomInfo Blog",
    url: "https://pipeline.zoominfo.com",
    feedUrl: "https://pipeline.zoominfo.com/feed",
    category: "GTM Tech",
    description: "Go-to-market intelligence, data quality, and B2B sales & marketing insights.",
    isActive: false, // 404
  },

  // === Demand Gen & ABM ===
  {
    name: "The Smarketers",
    url: "https://thesmarketers.com",
    feedUrl: "https://thesmarketers.com/feed/",
    category: "B2B Mktg & Sales",
    description: "RevOps, ABM, AI in B2B marketing, and demand generation strategies.",
    isActive: true,
  },
  {
    name: "Terminus Blog",
    url: "https://terminus.com/blog/",
    feedUrl: "https://terminus.com/blog/feed/",
    category: "B2B Mktg & Sales",
    description: "Account-based marketing (ABM) strategies, multichannel engagement, and B2B growth.",
    isActive: true,
  },
  {
    name: "6sense Blog",
    url: "https://6sense.com/blog/",
    feedUrl: "https://6sense.com/blog/feed/",
    category: "GTM Tech",
    description: "Predictive intelligence, intent data, and AI-driven revenue generation.",
    isActive: false, // 403 forbidden
  },

  // === Industry Analysts & Strategy ===
  {
    name: "Forrester Blogs",
    url: "https://www.forrester.com/blogs/",
    feedUrl: "https://go.forrester.com/blogs/feed/",
    category: "Industry Analysts",
    description: "Enterprise tech strategy, ROI analysis, and digital transformation from Forrester.",
    isActive: true,
  },
  {
    name: "Webbiquity",
    url: "https://webbiquity.com",
    feedUrl: "https://webbiquity.com/feed/",
    category: "B2B Mktg & Sales",
    description: "B2B content strategy, SEO, digital marketing, and case studies.",
    isActive: true,
  },
  {
    name: "Grow and Convert",
    url: "https://www.growandconvert.com",
    feedUrl: "https://www.growandconvert.com/feed/",
    category: "B2B Mktg & Sales",
    description: "ROI-focused content marketing strategies and frameworks for B2B.",
    isActive: false, // XML parse error
  },

  // === MarTech (Email & Automation) ===
  {
    name: "Litmus Blog",
    url: "https://www.litmus.com/blog",
    feedUrl: "https://www.litmus.com/blog/feed/",
    category: "GTM Tech",
    description: "Email marketing best practices, design, deliverability, and analytics.",
    isActive: true,
  },
  {
    name: "Mailchimp Resources",
    url: "https://mailchimp.com/resources/",
    feedUrl: "https://mailchimp.com/resources/feed/",
    category: "GTM Tech",
    description: "Email and marketing automation tips, templates, and strategy guides.",
    isActive: false, // 404
  },

  // === Data & Analytics ===
  {
    name: "Databox Blog",
    url: "https://databox.com/blog",
    feedUrl: "https://databox.com/feed",
    category: "Data & Analytics",
    description: "Marketing and sales analytics, KPIs, dashboards, and performance reporting.",
    isActive: true,
  },
  {
    name: "Supermetrics Blog",
    url: "https://supermetrics.com/blog",
    feedUrl: "https://supermetrics.com/blog/feed/",
    category: "Data & Analytics",
    description: "Marketing data integration, reporting automation, and analytics strategy.",
    isActive: false, // 404
  },

  // === Google News RSS Feeds ===
  {
    name: "Google News - MarTech",
    url: "https://news.google.com/search?q=martech+marketing+technology",
    feedUrl: "https://news.google.com/rss/search?q=martech+marketing+technology&hl=en-US&gl=US&ceid=US:en",
    category: "GTM Tech",
    description: "Google News aggregation for marketing technology topics.",
    isActive: true,
  },
  {
    name: "Google News - B2B Sales Technology",
    url: "https://news.google.com/search?q=B2B+sales+technology",
    feedUrl: "https://news.google.com/rss/search?q=B2B+sales+technology&hl=en-US&gl=US&ceid=US:en",
    category: "GTM Tech",
    description: "Google News aggregation for B2B sales technology.",
    isActive: true,
  },
  {
    name: "Google News - AI Marketing",
    url: "https://news.google.com/search?q=AI+marketing+automation",
    feedUrl: "https://news.google.com/rss/search?q=AI+marketing+automation&hl=en-US&gl=US&ceid=US:en",
    category: "AI",
    description: "Google News aggregation for AI-powered marketing and automation.",
    isActive: true,
  },
  {
    name: "Google News - CRM Software",
    url: "https://news.google.com/search?q=CRM+software+enterprise",
    feedUrl: "https://news.google.com/rss/search?q=CRM+software+enterprise&hl=en-US&gl=US&ceid=US:en",
    category: "CRM & Enterprise",
    description: "Google News aggregation for CRM and enterprise software.",
    isActive: true,
  },
  {
    name: "Google News - Revenue Operations",
    url: "https://news.google.com/search?q=revenue+operations+RevOps",
    feedUrl: "https://news.google.com/rss/search?q=revenue+operations+RevOps&hl=en-US&gl=US&ceid=US:en",
    category: "GTM Tech",
    description: "Google News aggregation for RevOps and revenue operations.",
    isActive: true,
  },
  {
    name: "Google News - Account Based Marketing",
    url: "https://news.google.com/search?q=account+based+marketing+ABM",
    feedUrl: "https://news.google.com/rss/search?q=account+based+marketing+ABM&hl=en-US&gl=US&ceid=US:en",
    category: "B2B Mktg & Sales",
    description: "Google News aggregation for ABM and account-based marketing.",
    isActive: true,
  },
  {
    name: "Google News - Demandbase",
    url: "https://news.google.com/search?q=Demandbase+ABM",
    feedUrl: "https://news.google.com/rss/search?q=Demandbase+ABM&hl=en-US&gl=US&ceid=US:en",
    category: "B2B Mktg & Sales",
    description: "Google News coverage of Demandbase and account-based marketing platform.",
    isActive: true,
  },
  {
    name: "Google News - Adobe Experience Cloud",
    url: "https://news.google.com/search?q=Adobe+Experience+Cloud+marketing",
    feedUrl: "https://news.google.com/rss/search?q=Adobe+Experience+Cloud+marketing&hl=en-US&gl=US&ceid=US:en",
    category: "GTM Tech",
    description: "Google News coverage of Adobe Experience Cloud and marketing solutions.",
    isActive: true,
  },
  {
    name: "Google News - Adobe Marketo",
    url: "https://news.google.com/search?q=Adobe+Marketo+marketing+automation",
    feedUrl: "https://news.google.com/rss/search?q=Adobe+Marketo+marketing+automation&hl=en-US&gl=US&ceid=US:en",
    category: "GTM Tech",
    description: "Google News coverage of Adobe Marketo and marketing automation.",
    isActive: true,
  },

  // === Deals & Markets ===
  {
    name: "Crunchbase News",
    url: "https://news.crunchbase.com",
    feedUrl: "https://news.crunchbase.com/feed/",
    category: "Deals & Markets",
    description: "Funding rounds, acquisitions, IPOs, and startup ecosystem news from Crunchbase.",
    isActive: true,
  },
  {
    name: "TechCrunch Venture",
    url: "https://techcrunch.com/category/venture/",
    feedUrl: "https://techcrunch.com/category/venture/feed/",
    category: "Deals & Markets",
    description: "Venture capital deals, startup funding, and investment trends.",
    isActive: true,
  },
  {
    name: "Google News - MarTech M&A",
    url: "https://news.google.com/search?q=martech+acquisition+merger",
    feedUrl: "https://news.google.com/rss/search?q=martech+acquisition+merger&hl=en-US&gl=US&ceid=US:en",
    category: "Deals & Markets",
    description: "Google News tracking MarTech acquisitions and mergers.",
    isActive: true,
  },
  {
    name: "Google News - SaaS IPO & Stock",
    url: "https://news.google.com/search?q=SaaS+IPO+stock+market",
    feedUrl: "https://news.google.com/rss/search?q=SaaS+IPO+stock+market&hl=en-US&gl=US&ceid=US:en",
    category: "Deals & Markets",
    description: "Google News tracking SaaS IPOs and tech stock market activity.",
    isActive: true,
  },
  {
    name: "Google News - B2B Tech Funding",
    url: "https://news.google.com/search?q=B2B+technology+funding+venture+capital",
    feedUrl: "https://news.google.com/rss/search?q=B2B+technology+funding+venture+capital&hl=en-US&gl=US&ceid=US:en",
    category: "Deals & Markets",
    description: "Google News tracking B2B tech venture capital and funding rounds.",
    isActive: true,
  },
  {
    name: "Google News - Tech Private Equity",
    url: "https://news.google.com/search?q=technology+private+equity+acquisition",
    feedUrl: "https://news.google.com/rss/search?q=technology+private+equity+acquisition&hl=en-US&gl=US&ceid=US:en",
    category: "Deals & Markets",
    description: "Google News tracking tech private equity deals and acquisitions.",
    isActive: true,
  },
  {
    name: "Google News - Tech Layoffs & Restructuring",
    url: "https://news.google.com/search?q=technology+company+layoffs+restructuring",
    feedUrl: "https://news.google.com/rss/search?q=technology+company+layoffs+restructuring&hl=en-US&gl=US&ceid=US:en",
    category: "Deals & Markets",
    description: "Google News tracking tech company layoffs, restructuring, and workforce changes.",
    isActive: true,
  },
  {
    name: "Google News - Tech Leadership Changes",
    url: "https://news.google.com/search?q=tech+CEO+executive+changes+leadership",
    feedUrl: "https://news.google.com/rss/search?q=tech+CEO+executive+changes+leadership&hl=en-US&gl=US&ceid=US:en",
    category: "Deals & Markets",
    description: "Google News tracking tech CEO and executive leadership changes.",
    isActive: true,
  },
  {
    name: "Google News - SaaS Business Moves",
    url: "https://news.google.com/search?q=SaaS+company+layoffs+valuation+restructuring",
    feedUrl: "https://news.google.com/rss/search?q=SaaS+company+layoffs+valuation+restructuring&hl=en-US&gl=US&ceid=US:en",
    category: "Deals & Markets",
    description: "Google News tracking SaaS company layoffs, valuation changes, and restructuring.",
    isActive: true,
  },
  // === AI-Focused Curated Feeds ===
  {
    name: "DeepMind Blog",
    url: "https://deepmind.google",
    feedUrl: "https://deepmind.google/blog/rss.xml",
    category: "AI",
    description: "Latest breakthroughs in AI research from Google DeepMind.",
    isActive: true,
  },
  {
    name: "NVIDIA AI Blog",
    url: "https://blogs.nvidia.com/ai/",
    feedUrl: "https://blogs.nvidia.com/feed/",
    category: "AI",
    description: "Updates on GPU technology, AI, and deep learning from NVIDIA.",
    isActive: true,
  },
  {
    name: "AI News Daily",
    url: "https://ainewsdaily.com",
    feedUrl: "https://ainewsdaily.com/feed/",
    category: "AI",
    description: "Daily, digestible AI news updates.",
    isActive: false, // feed not recognized as RSS
  },
  {
    name: "HPCwire",
    url: "https://www.hpcwire.com",
    feedUrl: "https://www.hpcwire.com/feed/",
    category: "AI",
    description: "AI developments in data center operations and high-performance computing.",
    isActive: true,
  },
  {
    name: "Analytics India Magazine",
    url: "https://analyticsindiamag.com",
    feedUrl: "https://analyticsindiamag.com/feed/",
    category: "AI",
    description: "AI trends and developments coverage.",
    isActive: false, // XML parse error
  },
  // === Hacker News (keyword-scoped via hnrss.org) ===
  // The HN front page is mostly off-beat for us, so these are Algolia queries with a
  // points floor — only stories that got real traction. hnrss.org 502s intermittently;
  // that is tolerated (a source is only auto-removed after 3 straight days of failures).
  {
    name: "Hacker News - AI Agents",
    url: "https://news.ycombinator.com",
    feedUrl: "https://hnrss.org/newest?q=%22AI+agents%22&points=50",
    category: "AI",
    description: "Hacker News stories about AI agents that cleared 50 points.",
    isActive: true,
  },
  {
    name: "Hacker News - LLMs",
    url: "https://news.ycombinator.com",
    feedUrl: "https://hnrss.org/newest?q=LLM&points=100",
    category: "AI",
    description: "Model releases, benchmarks, and LLM engineering debate from Hacker News (100+ points).",
    isActive: true,
  },
  {
    name: "Hacker News - Enterprise AI",
    url: "https://news.ycombinator.com",
    feedUrl: "https://hnrss.org/newest?q=enterprise+AI&points=20",
    category: "CRM & Enterprise",
    description: "Hacker News discussion of AI inside enterprise software and buying decisions.",
    isActive: true,
  },
  {
    name: "Hacker News - B2B SaaS",
    url: "https://news.ycombinator.com",
    feedUrl: "https://hnrss.org/newest?q=%22B2B+SaaS%22&points=20",
    category: "GTM Tech",
    description: "Practitioner takes on B2B SaaS pricing, GTM, and product from Hacker News.",
    isActive: true,
  },

  {
    name: "Single Grain Blog",
    url: "https://www.singlegrain.com/blog/",
    feedUrl: "https://www.singlegrain.com/feed/",
    category: "AI",
    description: "AI in digital marketing, tools, and strategy.",
    isActive: true,
  },
];
