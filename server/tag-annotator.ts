import { z } from "zod";
import { chatCompletion } from "./ai-models";

const SUMMARY_MAX = 160;
const ANNOTATION_MODEL = "claude-haiku-4-5-20251001";

export interface AnnotationInput {
  name: string;
  displayName: string;
  sources: string[];
  headlines: string[];
}

export interface TagAnnotation {
  name: string;
  summary: string;
  suggestion: "approve" | "reject" | "block";
}

const annotationSchema = z.object({
  name: z.string(),
  summary: z.string().min(1),
  suggestion: z.enum(["approve", "reject", "block"]),
});

export function buildAnnotationPrompt(inputs: AnnotationInput[]): string {
  const tagBlocks = inputs
    .map((t) => {
      const lines = [
        `- name: "${t.name}" (displayed as "${t.displayName}")`,
        `  sources: ${t.sources.join(", ") || "unknown"}`,
        `  recent headlines: ${t.headlines.map((h) => JSON.stringify(h)).join("; ") || "none"}`,
      ];
      return lines.join("\n");
    })
    .join("\n");

  return [
    "You are triaging content tags for a B2B AI/martech news aggregator's reader-facing filter list.",
    "For EACH tag below, write a concrete one-line summary (max 160 chars) of what articles carrying it cover, grounded in its headlines and sources, then suggest exactly one action:",
    '- "approve": a coherent recurring topic readers would use as a filter',
    '- "reject": not useful as a filter (person names, overly generic terms, one-off subjects)',
    '- "block": articles carrying it should not be ingested at all (sponsored/promotional/press-release markers). Block is rare.',
    "",
    "Tags:",
    tagBlocks,
    "",
    'Respond with ONLY a JSON array: [{"name": "<name exactly as given>", "summary": "<one line>", "suggestion": "approve|reject|block"}]',
  ].join("\n");
}

export function parseAnnotationResponse(raw: string, expectedNames: string[]): TagAnnotation[] {
  const stripped = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const allowed = new Set(expectedNames);
  const results: TagAnnotation[] = [];
  for (const entry of parsed) {
    const check = annotationSchema.safeParse(entry);
    if (!check.success || !allowed.has(check.data.name)) continue;
    results.push({ ...check.data, summary: check.data.summary.substring(0, SUMMARY_MAX) });
  }
  return results;
}

export async function annotateTags(inputs: AnnotationInput[]): Promise<TagAnnotation[]> {
  if (inputs.length === 0) return [];
  const raw = await chatCompletion({
    model: ANNOTATION_MODEL,
    messages: [{ role: "user", content: buildAnnotationPrompt(inputs) }],
    maxTokens: 4096,
    jsonMode: true,
  });
  return parseAnnotationResponse(raw, inputs.map((i) => i.name));
}
