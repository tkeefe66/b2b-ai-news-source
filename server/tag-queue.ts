import type { FeedTag } from "@shared/schema";
import type { TagEnrichment } from "./storage";
import type { TagAnnotation } from "./tag-annotator";

export interface QueueTag {
  id: number;
  name: string;
  displayName: string;
  articleCount: number;
  sources: string[];
  count30d: number;
  countPrev30d: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  aiSummary: string | null;
  aiSuggestion: string | null;
}

export function mergeQueueTags(
  tags: FeedTag[],
  enrichment: TagEnrichment[],
  annotations: TagAnnotation[]
): QueueTag[] {
  const enrichByName = new Map(enrichment.map((e) => [e.name, e]));
  const annotationByName = new Map(annotations.map((a) => [a.name, a]));
  return tags.map((t) => {
    const e = enrichByName.get(t.name);
    const fresh = annotationByName.get(t.name);
    return {
      id: t.id,
      name: t.name,
      displayName: t.displayName,
      articleCount: t.articleCount,
      sources: e?.sources ?? [],
      count30d: e?.count30d ?? 0,
      countPrev30d: e?.countPrev30d ?? 0,
      firstSeenAt: e?.firstSeenAt ?? null,
      lastSeenAt: e?.lastSeenAt ?? null,
      aiSummary: fresh?.summary ?? t.aiSummary,
      aiSuggestion: fresh?.suggestion ?? t.aiSuggestion,
    };
  });
}
