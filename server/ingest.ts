import type { FeedTagStatus } from "@shared/schema";
import { extractTags } from "./tags";
import { htmlToText } from "./sanitize";

const CONTENT_MAX = 25000;
const DESCRIPTION_MAX = 500;
const GUID_MAX = 500;

export interface FeedItemInput {
  guid?: string;
  categories?: unknown;
  content?: string;
  contentSnippet?: string;
  ["content:encoded"]?: string;
}

export interface MappedItem {
  guid: string | null;
  tags: { name: string; displayName: string }[];
  description: string | null;
  content: string | null;
}

// hnrss.org items carry no article text — the description is fixed metadata:
//   Article URL: https://…
//   Comments URL: https://news.ycombinator.com/item?id=…
//   Points: 401
//   # Comments: 134
// Strip those lines so HN cards render clean instead of showing link noise.
// "Comments URL:" is the HN-only marker that gates the whole rewrite; self-posts
// (Ask HN and friends) keep whatever prose sits alongside the metadata.
const HN_BOILERPLATE_LINE = /^(?:Article URL:|Comments URL:|Points:|#\s*Comments:).*$/gim;

function stripHnBoilerplate(text: string): string {
  if (!text.includes("Comments URL:")) return text;
  return text.replace(HN_BOILERPLATE_LINE, "").replace(/\n{2,}/g, "\n").trim();
}

export function mapFeedItem(item: FeedItemInput): MappedItem {
  const guid =
    typeof item.guid === "string" && item.guid.trim() && item.guid.length <= GUID_MAX
      ? item.guid.trim()
      : null;

  const rawHtml = item["content:encoded"] || item.content || "";
  const text = rawHtml ? stripHnBoilerplate(htmlToText(rawHtml)) : "";
  const content = text ? text.substring(0, CONTENT_MAX) : null;

  const snippet = stripHnBoilerplate((item.contentSnippet || text).trim());
  const description = snippet ? snippet.substring(0, DESCRIPTION_MAX) : null;

  return { guid, tags: extractTags(item.categories), description, content };
}

// server/rss.ts only needs to know THAT a tag is blocked; the source report needs to know
// which one, so the skip can be attributed to a tag in source_blocked_items.
export function firstBlockedTag(statuses: Record<string, FeedTagStatus>): string | null {
  for (const [name, status] of Object.entries(statuses)) {
    if (status === "blocked") return name;
  }
  return null;
}
