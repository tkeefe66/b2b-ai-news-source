import fs from "fs";
import Anthropic from "@anthropic-ai/sdk";
import { storage } from "./storage";
import { report } from "./usage.js";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

interface RawEntry {
  category: string;
  title: string;
  content: string;
  sourceUrl?: string | null;
}

async function extractFromContent(groupName: string, content: string): Promise<RawEntry[]> {
  try {
    const resp = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 8000,
      system: `You are a knowledge extraction expert. Extract ALL meaningful knowledge from the Demandbase content below into structured JSON entries. Be EXHAUSTIVE and capture EVERY distinct piece of information.

Respond with a JSON object: {"entries": [...]}

Each entry in the array needs:
- "category": one of "Platform Overview", "Marketing (ABX)", "Sales Intelligence", "Advertising & B2B DSP", "Data & Account Intelligence", "AI & Agentbase", "Buying Groups", "Customer Case Studies", "Competitive Intelligence", "Messaging & Positioning", "Integrations & Ecosystem", "Support & Documentation", "Product Updates", "Company & Leadership", "Privacy & Security"
- "title": descriptive title
- "content": detailed extraction (200-500 words, include ALL specifics — metrics, feature names, capabilities, help article titles, technical details)
- "sourceUrl": most relevant URL or null

Create separate entries for each distinct topic. Include help article titles for support content.
Respond with valid JSON only, no markdown fences.`,
      messages: [{
        role: "user",
        content: `Extract knowledge entries from "${groupName}" content:\n\n${content.substring(0, 28000)}`
      }],
    });

    report("b2b-ai-news", "claude-haiku-4-5-20251001", resp.usage);
    const textBlock = resp.content.find((b: any) => b.type === "text");
    const parsed = JSON.parse((textBlock as any)?.text || "{}");
    return parsed.entries || [];
  } catch (e: any) {
    console.error(`Failed to extract from ${groupName}:`, e.message);
    return [];
  }
}

export async function runExtraction() {
  const allFiles = fs.readdirSync("/tmp").filter(
    (f) => (f.startsWith("crawl_") || f.startsWith("support_") || f.startsWith("db_")) && (f.endsWith(".json") || f.endsWith(".md"))
  );

  const allContent: Record<string, string> = {};
  for (const f of allFiles) {
    if (f.endsWith(".json")) {
      try {
        const data = JSON.parse(fs.readFileSync(`/tmp/${f}`, "utf8"));
        for (const [k, v] of Object.entries(data)) {
          if (typeof v === "string" && v.length > 400 && !v.includes("oops")) {
            allContent[k] = v;
          }
        }
      } catch (e) {}
    } else if (f.endsWith(".md")) {
      const content = fs.readFileSync(`/tmp/${f}`, "utf8");
      if (content.length > 400) {
        allContent[f.replace("db_", "").replace(".md", "")] = content;
      }
    }
  }

  console.log(`Loaded ${Object.keys(allContent).length} pages of content`);

  const groups: Record<string, { key: string; content: string }[]> = {
    "Products & Platform": [],
    "Sales Intelligence Platform": [],
    "Advertising Platform": [],
    "Case Studies & Customer Success": [],
    "Company Information": [],
    "Support - Marketing Features": [],
    "Support - Integrations Setup": [],
    "Support - Data & Analytics": [],
    "Support - Product Updates & Announcements": [],
  };

  for (const [key, content] of Object.entries(allContent)) {
    const lk = key.toLowerCase();
    const cleaned = content.replace(/!\[.*?\]\(.*?\)/g, "").replace(/\n{3,}/g, "\n\n").trim();

    if (lk.includes("case-study") || lk.includes("thales") || lk.includes("wika") || lk.includes("ingram") || lk.includes("coalfire") || lk.includes("sap-concur") || lk.includes("workforce")) {
      groups["Case Studies & Customer Success"].push({ key, content: cleaned.substring(0, 4000) });
    } else if ((lk.includes("sales") && lk.includes("support")) || (lk.includes("sales") && lk.includes("section"))) {
      groups["Sales Intelligence Platform"].push({ key, content: cleaned.substring(0, 3000) });
    } else if (lk.includes("salesintel") || lk.includes("sales-intelligence")) {
      groups["Sales Intelligence Platform"].push({ key, content: cleaned.substring(0, 4000) });
    } else if (lk.includes("advert") || lk.includes("dsp") || lk.includes("b2bdsp") || lk.includes("ad-creative") || lk.includes("tryadvert")) {
      groups["Advertising Platform"].push({ key, content: cleaned.substring(0, 4000) });
    } else if (lk.includes("integration") || lk.includes("salesforce") || lk.includes("hubspot") || lk.includes("dynamics") || lk.includes("automation") || lk.includes("integrated")) {
      groups["Support - Integrations Setup"].push({ key, content: cleaned.substring(0, 3000) });
    } else if (lk.includes("product-update") || lk.includes("announcement") || lk.includes("beta") || lk.includes("monthly")) {
      groups["Support - Product Updates & Announcements"].push({ key, content: cleaned.substring(0, 3000) });
    } else if (lk.includes("data") || lk.includes("intent") || lk.includes("technograph") || lk.includes("firmograph") || lk.includes("account-ident") || lk.includes("contact") || lk.includes("intelligence") || lk.includes("smarter") || lk.includes("analytics") || lk.includes("report") || lk.includes("api") || lk.includes("matching") || lk.includes("quality")) {
      groups["Support - Data & Analytics"].push({ key, content: cleaned.substring(0, 3000) });
    } else if (lk.includes("marketing") || lk.includes("orchestrat") || lk.includes("personal") || lk.includes("journey") || lk.includes("abx") || lk.includes("audience") || lk.includes("dashboard") || lk.includes("watchlist") || lk.includes("list-building")) {
      groups["Support - Marketing Features"].push({ key, content: cleaned.substring(0, 3000) });
    } else if (lk.includes("company") || lk.includes("career") || lk.includes("privacy") || lk.includes("about") || lk.includes("security") || lk.includes("legal")) {
      groups["Company Information"].push({ key, content: cleaned.substring(0, 3000) });
    } else {
      groups["Products & Platform"].push({ key, content: cleaned.substring(0, 4000) });
    }
  }

  for (const [g, items] of Object.entries(groups)) {
    console.log(`${g}: ${items.length} pages`);
  }

  const allEntries: RawEntry[] = [];
  const validGroups = Object.entries(groups).filter(([, items]) => items.length > 0);

  for (let i = 0; i < validGroups.length; i += 3) {
    const batch = validGroups.slice(i, i + 3);
    console.log(`\nProcessing batch ${i / 3 + 1}...`);
    const batchResults = await Promise.all(
      batch.map(([name, pages]) => {
        const combined = pages.map((p) => `=== ${p.key} ===\n${p.content}`).join("\n\n");
        return extractFromContent(name, combined);
      })
    );
    batchResults.forEach((entries, j) => {
      console.log(`  ${batch[j][0]}: ${entries.length} entries`);
      allEntries.push(...entries);
    });
  }

  console.log(`\nTotal extracted: ${allEntries.length} entries`);
  return allEntries;
}

const VALID_CATEGORIES = new Set([
  "Platform Overview", "Marketing (ABX)", "Sales Intelligence",
  "Advertising & B2B DSP", "Data & Account Intelligence", "AI & Agentbase",
  "Buying Groups", "Customer Case Studies", "Competitive Intelligence",
  "Messaging & Positioning", "Integrations & Ecosystem", "Support & Documentation",
  "Product Updates", "Company & Leadership", "Privacy & Security",
  "Careers & Employee Experience",
]);

let extractionInProgress = false;

export function isExtractionRunning() {
  return extractionInProgress;
}

export async function seedKnowledge() {
  if (extractionInProgress) {
    console.log("Extraction already in progress, skipping");
    return -1;
  }

  extractionInProgress = true;
  try {
    const existing = await storage.getKnowledgeEntries();
    if (existing.length > 35) {
      console.log(`Already have ${existing.length} entries, skipping seed`);
      return existing.length;
    }

    console.log("Starting knowledge extraction...");
    const entries = await runExtraction();

    const validEntries = entries.filter(e =>
      e.title && typeof e.title === "string" && e.title.length > 3 &&
      e.content && typeof e.content === "string" && e.content.length > 50 &&
      e.category && VALID_CATEGORIES.has(e.category)
    );

    if (validEntries.length < 10) {
      console.log(`Only ${validEntries.length} valid entries extracted (minimum 10 required), aborting to preserve existing data`);
      return 0;
    }

    if (existing.length > 0) {
      console.log(`Clearing ${existing.length} existing entries...`);
      for (const e of existing) {
        await storage.deleteKnowledgeEntry(e.id);
      }
    }

    let created = 0;
    for (const entry of validEntries) {
      try {
        await storage.createKnowledgeEntry({
          category: entry.category,
          title: entry.title,
          content: entry.content,
          sourceUrl: entry.sourceUrl || null,
          isActive: true,
        });
        created++;
      } catch (e: any) {
        console.error(`Failed to create entry "${entry.title}":`, e.message);
      }
    }

    console.log(`Created ${created} knowledge entries`);
    return created;
  } finally {
    extractionInProgress = false;
  }
}
