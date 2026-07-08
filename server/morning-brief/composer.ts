import type { Article, Competitor, TrendSnapshot } from "@shared/schema";
import { briefPayloadSchema, type BriefPayload } from "@shared/brief-payload";
import { storage } from "../storage";
import { getDemandbaseContext } from "../demandbase-context";
import { chatCompletion } from "../ai-models";
import { blog } from "./log";

export const BRIEF_MODEL = "claude-sonnet-4-6";
const MAX_ARTICLES = 120;

export interface ComposerInputs {
  dateStr: string;
  window: { periodStart: Date; periodEnd: Date };
  articles: Article[];
  competitorCandidates: Array<{ name: string; articleIds: number[] }>;
  latestSnapshot: TrendSnapshot | null;
  previousSnapshot: TrendSnapshot | null;
  dbContext: string;
}

export function matchCompetitors(
  articles: Article[],
  competitors: Competitor[],
): Array<{ name: string; articleIds: number[] }> {
  const out: Array<{ name: string; articleIds: number[] }> = [];
  for (const c of competitors) {
    const needle = c.name.replace(/\s*\(.*\)\s*$/, "").toLowerCase();
    if (!needle) continue;
    const ids = articles
      .filter(a => {
        const hay = `${a.title} ${a.description || ""}`.toLowerCase();
        return hay.includes(needle);
      })
      .map(a => a.id);
    if (ids.length > 0) out.push({ name: c.name, articleIds: ids });
  }
  return out;
}

export async function gatherInputs(
  dateStr: string,
  window: { periodStart: Date; periodEnd: Date },
): Promise<ComposerInputs> {
  const [rawArticles, competitors, snapshots, dbContext] = await Promise.all([
    storage.getArticlesByDateRange(window.periodStart, window.periodEnd),
    storage.getCompetitors(),
    storage.getTrendSnapshots(2),
    getDemandbaseContext(),
  ]);
  const articles = rawArticles
    .filter(a => !a.dismissed)
    .sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0))
    .slice(0, MAX_ARTICLES);
  blog(`gathered ${articles.length} articles for ${dateStr} window`);
  return {
    dateStr,
    window,
    articles,
    competitorCandidates: matchCompetitors(articles, competitors),
    latestSnapshot: snapshots[0] ?? null,
    previousSnapshot: snapshots[1] ?? null,
    dbContext,
  };
}

export function buildBriefPrompt(inputs: ComposerInputs): { system: string; user: string } {
  const system = `You are the intelligence editor for Demandbase's GTM team. Each weekday morning you compose a brief that makes the reader fully current on B2B/MarTech in a 3-minute read (~500 words total).

Return ONLY strict JSON (no markdown fences, no prose) with exactly this shape:
{
  "date": "YYYY-MM-DD",
  "headline": "the day in one line, <= 12 words",
  "periodStart": "ISO timestamp", "periodEnd": "ISO timestamp",
  "topStories": [3-5 items, fewer only on quiet days: {
    "title": "...", "whyItMatters": "1-2 sentences, <= 40 words",
    "dbAngle": OMIT unless genuine: { "strength": "strong"|"moderate", "text": "<= 30 words" },
    "sourceName": "...", "link": "original article URL", "articleId": <id from the list>
  }],
  "competitorWatch": [{ "competitor": "...", "summary": "<= 30 words", "links": [{"title","url"}] }],
  "trendPulse": [{ "trend": "...", "direction": "rising"|"cooling", "note": "<= 20 words" }],
  "radar": [5-8 one-liners: { "title": "...", "sourceName": "...", "link": "..." }],
  "contentIdea": OMIT or at most one: { "title": "...", "description": "<= 25 words", "deepLink": "/thought-leadership" },
  "quietDay": boolean
}

Rules:
- dbAngle HONESTY: include one only when the story genuinely intersects Demandbase's business. Most stories should have NO dbAngle. Never manufacture relevance.
- Select stories by significance to B2B GTM professionals, not recency alone. No duplicate coverage of one event across topStories and radar.
- trendPulse: only movements you can infer by comparing the two snapshots; empty array if no snapshot data.
- competitorWatch: only from the provided candidates; empty array if none are genuinely newsworthy.
- quietDay: set true when fewer than 3 substantive stories exist; then include only what's real (1-2 stories is fine) and keep everything shorter.
- Every articleId and link must come from the provided article list.`;

  const articleLines = inputs.articles
    .map(a => `[${a.id}] ${a.title} — ${a.sourceName || "unknown"} — ${a.category || "uncategorized"} — ${a.link}${a.description ? ` — ${a.description.slice(0, 300)}` : ""}`)
    .join("\n");
  const competitorLines = inputs.competitorCandidates.length
    ? inputs.competitorCandidates.map(c => `${c.name}: article ids ${c.articleIds.join(", ")}`).join("\n")
    : "none detected in this window";

  const user = `Date: ${inputs.dateStr}
Window: ${inputs.window.periodStart.toISOString()} to ${inputs.window.periodEnd.toISOString()}

=== DEMANDBASE CONTEXT (for dbAngle judgment) ===
${inputs.dbContext.slice(0, 4000)}

=== COMPETITOR CANDIDATES ===
${competitorLines}

=== LATEST TREND SNAPSHOT ===
${inputs.latestSnapshot ? inputs.latestSnapshot.trends.slice(0, 1500) : "none"}

=== PREVIOUS TREND SNAPSHOT ===
${inputs.previousSnapshot ? inputs.previousSnapshot.trends.slice(0, 800) : "none"}

=== ARTICLES (${inputs.articles.length}) ===
${articleLines}

Compose today's brief JSON now.`;

  return { system, user };
}

export function extractJson(raw: string): string {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first >= 0 && last > first) s = s.slice(first, last + 1);
  return s;
}

function tryParse(raw: string): { ok: true; data: BriefPayload } | { ok: false; issues: string } {
  let obj: unknown;
  try {
    obj = JSON.parse(extractJson(raw));
  } catch (e: any) {
    return { ok: false, issues: `JSON.parse error: ${e.message}` };
  }
  const parsed = briefPayloadSchema.safeParse(obj);
  if (parsed.success) return { ok: true, data: parsed.data };
  return {
    ok: false,
    issues: parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "),
  };
}

export async function composeBrief(
  inputs: ComposerInputs,
  chat: typeof chatCompletion = chatCompletion,
): Promise<BriefPayload> {
  const { system, user } = buildBriefPrompt(inputs);
  const started = Date.now();
  const first = await chat({
    model: BRIEF_MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    // 4096 truncated real payloads mid-array (article URLs tokenize expensively)
    maxTokens: 8192,
    jsonMode: true,
  });
  let attempt = tryParse(first);
  if (attempt.ok) {
    blog(`composed brief in ${Date.now() - started}ms (first pass)`);
    return attempt.data;
  }

  blog(`compose output invalid, running repair pass: ${attempt.issues.slice(0, 200)}`);
  const second = await chat({
    model: BRIEF_MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
      { role: "assistant", content: first },
      {
        role: "user",
        content: `That JSON was invalid: ${attempt.issues}. Return the corrected strict JSON only — no fences, no commentary.`,
      },
    ],
    // 4096 truncated real payloads mid-array (article URLs tokenize expensively)
    maxTokens: 8192,
    jsonMode: true,
  });
  attempt = tryParse(second);
  if (attempt.ok) {
    blog(`composed brief in ${Date.now() - started}ms (repair pass)`);
    return attempt.data;
  }
  throw new Error(`Brief composition failed schema validation after repair pass: ${attempt.issues}`);
}
