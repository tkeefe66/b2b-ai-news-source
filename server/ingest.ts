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

export function mapFeedItem(item: FeedItemInput): MappedItem {
  const guid =
    typeof item.guid === "string" && item.guid.trim() && item.guid.length <= GUID_MAX
      ? item.guid.trim()
      : null;

  const rawHtml = item["content:encoded"] || item.content || "";
  const text = rawHtml ? htmlToText(rawHtml) : "";
  const content = text ? text.substring(0, CONTENT_MAX) : null;

  const snippet = (item.contentSnippet || text).trim();
  const description = snippet ? snippet.substring(0, DESCRIPTION_MAX) : null;

  return { guid, tags: extractTags(item.categories), description, content };
}
