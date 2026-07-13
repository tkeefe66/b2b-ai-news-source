const MAX_TAG_LENGTH = 40;
const MAX_TAGS_PER_ARTICLE = 6;
const DENYLIST = new Set(["uncategorized", "news", "general"]);

export function normalizeTag(raw: string): string | null {
  const normalized = raw.trim().replace(/\s+/g, " ").toLowerCase();
  if (!normalized) return null;
  if (normalized.length > MAX_TAG_LENGTH) return null;
  if (/^\d+$/.test(normalized)) return null;
  if (DENYLIST.has(normalized)) return null;
  return normalized;
}

export function extractTags(categories: unknown): { name: string; displayName: string }[] {
  if (!Array.isArray(categories)) return [];
  const seen = new Map<string, string>();
  for (const raw of categories) {
    if (typeof raw !== "string") continue;
    const name = normalizeTag(raw);
    if (!name || seen.has(name)) continue;
    seen.set(name, raw.trim().replace(/\s+/g, " "));
    if (seen.size >= MAX_TAGS_PER_ARTICLE) break;
  }
  return Array.from(seen, ([name, displayName]) => ({ name, displayName }));
}
