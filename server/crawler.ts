import { storage } from "./storage";
import { URL } from "url";

const USER_AGENT = "Mozilla/5.0 (compatible; ResearchBot/1.0; +https://example.com)";
const FETCH_TIMEOUT = 15000;
const RATE_LIMIT_MS = 1500;

const BLOCKED_HOSTS = new Set([
  "localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]",
  "metadata.google.internal", "169.254.169.254",
]);

function isBlockedHost(hostname: string): boolean {
  if (BLOCKED_HOSTS.has(hostname.toLowerCase())) return true;
  const parts = hostname.split(".");
  if (parts[0] === "10") return true;
  if (parts[0] === "172" && parseInt(parts[1]) >= 16 && parseInt(parts[1]) <= 31) return true;
  if (parts[0] === "192" && parts[1] === "168") return true;
  if (hostname.startsWith("169.254.")) return true;
  if (hostname.endsWith(".local") || hostname.endsWith(".internal")) return true;
  return false;
}

function validateCrawlUrl(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    if (isBlockedHost(parsed.hostname)) return false;
    if (parsed.port && !["80", "443", ""].includes(parsed.port)) return false;
    return true;
  } catch {
    return false;
  }
}

interface CrawlOptions {
  maxPages: number;
  maxDepth: number;
  jobId: number;
}

function extractLinks(html: string, baseUrl: string): string[] {
  const links: string[] = [];
  const hrefRegex = /href=["']([^"'#]+?)["']/gi;
  let match;
  while ((match = hrefRegex.exec(html)) !== null) {
    try {
      const resolved = new URL(match[1], baseUrl).href;
      links.push(resolved.split("#")[0].split("?")[0]);
    } catch {
    }
  }
  return [...new Set(links)];
}

function extractTitle(html: string): string {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) return titleMatch[1].replace(/\s+/g, " ").trim();
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match) return h1Match[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  return "";
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
    .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, "")
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, "")
    .replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#\d+;/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .join("\n")
    .trim();
}

function isSameDomain(url: string, rootUrl: string): boolean {
  try {
    const urlHost = new URL(url).hostname;
    const rootHost = new URL(rootUrl).hostname;
    return urlHost === rootHost || urlHost.endsWith("." + rootHost);
  } catch {
    return false;
  }
}

const SKIP_EXTENSIONS = new Set([
  ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".webp",
  ".mp4", ".mp3", ".wav", ".avi", ".mov", ".zip", ".tar", ".gz",
  ".css", ".js", ".json", ".xml", ".rss", ".atom", ".woff", ".woff2",
  ".ttf", ".eot", ".map",
]);

const SKIP_PATTERNS = [
  /\/wp-admin\//i,
  /\/wp-includes\//i,
  /\/wp-json\//i,
  /\/feed\/?$/i,
  /\/rss\/?$/i,
  /\/sitemap.*\.xml/i,
  /\/cdn-cgi\//i,
  /\/api\//i,
  /\/login/i,
  /\/signup/i,
  /\/register/i,
  /\/cart/i,
  /\/checkout/i,
  /\/account/i,
  /mailto:/i,
  /tel:/i,
  /javascript:/i,
];

function shouldSkipUrl(url: string): boolean {
  const lower = url.toLowerCase();
  for (const ext of SKIP_EXTENSIONS) {
    if (lower.endsWith(ext)) return true;
  }
  for (const pattern of SKIP_PATTERNS) {
    if (pattern.test(url)) return true;
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function runCrawl(options: CrawlOptions): Promise<void> {
  const { maxPages, maxDepth, jobId } = options;
  const job = await storage.getCrawlJob(jobId);
  if (!job) throw new Error(`Crawl job ${jobId} not found`);

  const rootUrl = job.rootUrl;
  const visited = new Set<string>();
  const queue: { url: string; depth: number }[] = [{ url: rootUrl, depth: 0 }];

  try {
    await storage.updateCrawlJob(jobId, { status: "crawling" });

    while (queue.length > 0 && visited.size < maxPages) {
      const item = queue.shift();
      if (!item) break;

      const normalizedUrl = item.url.replace(/\/$/, "");
      if (visited.has(normalizedUrl)) continue;
      if (shouldSkipUrl(item.url)) continue;
      if (!isSameDomain(item.url, rootUrl)) continue;
      if (!validateCrawlUrl(item.url)) continue;

      visited.add(normalizedUrl);

      try {
        const response = await fetch(item.url, {
          headers: {
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml",
          },
          signal: AbortSignal.timeout(FETCH_TIMEOUT),
          redirect: "follow",
        });

        const contentType = response.headers.get("content-type") || "";
        if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
          continue;
        }

        if (!response.ok) {
          await storage.createCrawlPage({
            crawlJobId: jobId,
            url: item.url,
            status: "error",
            depth: item.depth,
            contentLength: 0,
            errorMessage: `HTTP ${response.status}`,
          });
          continue;
        }

        const html = await response.text();
        const title = extractTitle(html);
        const textContent = htmlToText(html);

        await storage.createCrawlPage({
          crawlJobId: jobId,
          url: item.url,
          title: title || null,
          textContent: textContent.substring(0, 100000),
          contentLength: textContent.length,
          status: "crawled",
          depth: item.depth,
        });

        await storage.updateCrawlJob(jobId, {
          pagesCrawled: visited.size,
          pagesDiscovered: visited.size + queue.length,
        });

        if (item.depth < maxDepth) {
          const links = extractLinks(html, item.url);
          for (const link of links) {
            const normalizedLink = link.replace(/\/$/, "");
            if (!visited.has(normalizedLink) && isSameDomain(link, rootUrl) && !shouldSkipUrl(link)) {
              queue.push({ url: link, depth: item.depth + 1 });
            }
          }
        }

        await sleep(RATE_LIMIT_MS);

      } catch (err: any) {
        await storage.createCrawlPage({
          crawlJobId: jobId,
          url: item.url,
          status: "error",
          depth: item.depth,
          contentLength: 0,
          errorMessage: err.message?.substring(0, 500) || "Fetch error",
        });
      }
    }

    await storage.updateCrawlJob(jobId, {
      status: "crawled",
      pagesCrawled: visited.size,
      pagesDiscovered: visited.size,
    });

  } catch (err: any) {
    console.error(`Crawl job ${jobId} failed:`, err);
    await storage.updateCrawlJob(jobId, {
      status: "error",
      errorMessage: err.message?.substring(0, 500) || "Crawl failed",
    });
  }
}
