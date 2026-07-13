import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { pool } from "./db";
import { fetchAllFeeds, fetchFeedArticles, DEFAULT_SOURCES } from "./rss";
import { fetchNewsAPIArticles, seedDefaultNewsapiQueries } from "./newsapi";
import { insertSourceSchema, insertKnowledgeEntrySchema, insertPendingKnowledgeSchema, insertEnablementContentSchema, insertProductFeatureSchema, insertNewsapiQuerySchema, insertTrendWatchlistSchema, FEED_TAG_STATUSES, TAG_SURFACE_THRESHOLD, type FeedTagStatus, type Article } from "@shared/schema";
import { mergeQueueTags } from "./tag-queue";
import { annotateTags } from "./tag-annotator";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import { AVAILABLE_MODELS, chatCompletion, chatStream, resolveModel } from "./ai-models";
import { searchRelevantArticles, getSearchStats, updateSearchVectors } from "./embeddings";
import { getDemandbaseContext, getProductKnowledgeContext, DEMANDBASE_CONTEXT } from "./demandbase-context";
import { upload, chunkUpload, handleChunkUpload, extractTextFromFile, extractTextAndImagesFromFile, extractFramesFromVideo, processFileToKnowledge, processUrlToKnowledge, saveExtractedEntries, cleanupTempFile, type ExtractedImage } from "./file-parser";
import { analyzeImages, analyzeVideoFrames } from "./image-analyzer";
import fs from "fs";
import sharp from "sharp";
import { getBrandGuidelinesContext, getPresentationSystemPrompt } from "./brand-guidelines";
import { generateDigestsForNewArticles } from "./digest";
import { runManualBrief } from "./morning-brief/scheduler";
import { createGoogleDoc, createGoogleSlides, listDriveFiles, downloadDriveFile } from "./google-drive";
import { ensureCompatibleFormat, speechToText } from "./replit_integrations/audio/client";

export let lastFeedFetchAt: string | null = null;
export function setLastFeedFetchAt() { lastFeedFetchAt = new Date().toISOString(); }
import express from "express";

function parseMarkdownToSlides(markdown: string): Array<{ title: string; body: string; speakerNotes?: string }> {
  const slides: Array<{ title: string; body: string; speakerNotes?: string }> = [];
  const sections = markdown.split(/^##\s+/m).filter(s => s.trim());
  for (const section of sections) {
    const lines = section.split("\n");
    const title = lines[0].replace(/\[.*?\]\s*/g, "").trim();
    const bodyLines: string[] = [];
    let notes = "";
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith("NOTES:")) {
        notes = line.replace("NOTES:", "").trim();
      } else {
        bodyLines.push(line);
      }
    }
    if (title) {
      slides.push({ title, body: bodyLines.join("\n").trim(), speakerNotes: notes || undefined });
    }
  }
  return slides.length > 0 ? slides : [{ title: "Slide", body: markdown.substring(0, 500) }];
}

function parseAIJson(text: string | null | undefined): any {
  let cleaned = (text || "{}").trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?\s*```\s*$/, "");
  }
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    let repaired = cleaned;
    repaired = repaired.replace(/,\s*$/, "");
    let openBrackets = 0, openBraces = 0;
    for (const ch of repaired) {
      if (ch === '[') openBrackets++;
      else if (ch === ']') openBrackets--;
      else if (ch === '{') openBraces++;
      else if (ch === '}') openBraces--;
    }
    const lastComplete = Math.max(repaired.lastIndexOf('},'), repaired.lastIndexOf('}]'));
    if (lastComplete > 0) {
      repaired = repaired.substring(0, lastComplete + 1);
      openBrackets = 0; openBraces = 0;
      for (const ch of repaired) {
        if (ch === '[') openBrackets++;
        else if (ch === ']') openBrackets--;
        else if (ch === '{') openBraces++;
        else if (ch === '}') openBraces--;
      }
    }
    repaired += ']'.repeat(Math.max(0, openBrackets)) + '}'.repeat(Math.max(0, openBraces));
    try {
      console.log(`[parseAIJson] Repaired truncated JSON (original length: ${cleaned.length}, repaired: ${repaired.length})`);
      return JSON.parse(repaired);
    } catch (e2) {
      throw e;
    }
  }
}

const NO_DASH_RULE = `
WRITING STYLE RULE (STRICTLY ENFORCED): Never use a hyphen "-", double-hyphen "--", em-dash "—", or en-dash "–" to connect or bridge clauses or sentences. Do not use dashes as punctuation between thoughts. Instead, use periods, commas, semicolons, colons, or parentheses to separate ideas. Hyphens in compound words (e.g., "go-to-market", "data-driven") and as bullet point markers are fine.`;

const CITATION_RULES_INLINE = `
METRIC CITATION RULES (MANDATORY):
Every numeric value you use — percentages, multipliers, dollar amounts, growth rates, counts, or any quantitative claim — MUST include a parenthetical source citation immediately after the metric. No exceptions.
- If the metric comes from a tracked article: cite as (Source: [Publication Name], [Month Year]) — e.g., "73% of pipeline sourced from ABM (Source: TechCrunch, March 2026)"
- If the metric comes from general industry knowledge or analyst reports not in the provided articles: cite as (Source: [Organization/Report], general industry data) — e.g., "88% of B2B marketers use ABM (Source: Gartner, general industry data)"
- If the metric is a Demandbase customer proof point from the knowledge base: cite as (Source: Demandbase customer data) — e.g., "3X conversion increase (Source: Demandbase customer data)"
- NEVER use a numeric metric without a parenthetical citation. If you cannot identify the source of a number, do not use it.`;

const CITATION_RULES_SLIDES = `
METRIC CITATION RULES FOR SLIDES (MANDATORY):
Every numeric value you use — percentages, multipliers, dollar amounts, growth rates, counts — MUST be cited. However, on slides keep the slide content clean and concise. Place all metric citations in the NOTES section for that slide.
- In the NOTES, list each metric used on the slide with its source: "73% stat from TechCrunch, March 2026" or "88% figure from Gartner, general industry data" or "3X conversion from Demandbase customer data"
- If a metric comes from general knowledge (not a tracked article), note it: "Industry stat from Forrester, general industry data"
- NEVER use a numeric metric on a slide without citing its source in the NOTES. If you cannot identify the source of a number, do not use it.`;

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const gemini = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY!,
});

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.get("/api/models", (_req, res) => {
    res.json(AVAILABLE_MODELS);
  });

  app.get("/api/processing-queue", async (_req, res) => {
    try {
      const jobs = await storage.getActiveProcessingJobs();
      const lightweight = jobs.map(j => ({ ...j, result: j.status === "done" || j.status === "error" ? (j.result ? "HAS_RESULT" : null) : null }));
      res.json(lightweight);
    } catch (err) {
      console.error("Error fetching processing queue:", err);
      res.status(500).json({ error: "Failed to fetch processing queue" });
    }
  });

  app.get("/api/processing-queue/all", async (_req, res) => {
    try {
      const jobs = await storage.getAllProcessingJobs(100);
      const lightweight = jobs.map(j => ({ ...j, result: j.result ? "HAS_RESULT" : null }));
      res.json(lightweight);
    } catch (err) {
      console.error("Error fetching all processing jobs:", err);
      res.status(500).json({ error: "Failed to fetch processing jobs" });
    }
  });

  app.get("/api/processing-queue/:jobId", async (req, res) => {
    try {
      const job = await storage.getProcessingJob(req.params.jobId);
      if (!job) return res.status(404).json({ error: "Job not found" });
      res.json(job);
    } catch (err) {
      console.error("Error fetching processing job:", err);
      res.status(500).json({ error: "Failed to fetch processing job" });
    }
  });

  app.delete("/api/processing-queue/:jobId", async (req, res) => {
    try {
      await storage.deleteProcessingJob(req.params.jobId);
      res.json({ success: true });
    } catch (err) {
      console.error("Error deleting processing job:", err);
      res.status(500).json({ error: "Failed to delete processing job" });
    }
  });

  app.post("/api/processing-queue/cleanup", async (_req, res) => {
    try {
      await storage.cleanupOldProcessingJobs();
      res.json({ success: true });
    } catch (err) {
      console.error("Error cleaning up processing jobs:", err);
      res.status(500).json({ error: "Failed to cleanup processing jobs" });
    }
  });

  const audioBodyParser = express.json({ limit: "50mb" });

  app.post("/api/transcribe", audioBodyParser, async (req, res) => {
    try {
      const { audio } = req.body;
      if (!audio || typeof audio !== "string") {
        return res.status(400).json({ error: "Base64 audio data is required" });
      }
      if (audio.length > 15_000_000) {
        return res.status(413).json({ error: "Audio too large. Maximum 10MB." });
      }
      const rawBuffer = Buffer.from(audio, "base64");
      if (rawBuffer.length < 100) {
        return res.status(400).json({ error: "Audio data too small to be valid" });
      }
      const { buffer: audioBuffer, format } = await ensureCompatibleFormat(rawBuffer);
      const text = await speechToText(audioBuffer, format);
      res.json({ text });
    } catch (err) {
      console.error("Transcription error:", err);
      res.status(500).json({ error: "Failed to transcribe audio" });
    }
  });

  app.get("/api/articles", async (req, res) => {
    try {
      const normalize = (val: string | undefined) => val && val !== "all" ? val : undefined;
      const filters: import("./storage").ArticleFilters = {
        search: normalize(req.query.q as string),
        category: normalize(req.query.category as string),
        excludeCategory: normalize(req.query.excludeCategory as string),
        source: normalize(req.query.source as string),
        tag: normalize(req.query.tag as string),
        dateRange: normalize(req.query.dateRange as string) as "today" | "week" | "month" | "custom" | undefined,
        dateFrom: req.query.dateFrom as string | undefined,
        dateTo: req.query.dateTo as string | undefined,
        limit: parseInt(req.query.limit as string) || 50,
        offset: parseInt(req.query.offset as string) || 0,
      };
      const hasFilters = filters.search || filters.category || filters.excludeCategory || filters.source || filters.tag || (filters.dateRange && filters.dateRange !== "all");
      if (hasFilters) {
        const result = await storage.getFilteredArticles(filters);
        res.json(result);
      } else {
        const articles = await storage.getArticles(filters.limit, filters.offset);
        const count = await storage.getArticleCount();
        res.json({ articles, total: count });
      }
    } catch (err) {
      console.error("Error fetching articles:", err);
      res.status(500).json({ error: "Failed to fetch articles" });
    }
  });

  app.post("/api/articles/by-ids", async (req, res) => {
    try {
      const ids = req.body.ids as number[];
      if (!ids || !Array.isArray(ids) || ids.length === 0) return res.json({ articles: [] });
      const result = await storage.getArticlesByIds(ids.slice(0, 200));
      res.json({ articles: result });
    } catch (err) {
      console.error("Error fetching articles by IDs:", err);
      res.status(500).json({ error: "Failed to fetch articles" });
    }
  });

  app.get("/api/articles/search", async (req, res) => {
    try {
      const query = req.query.q as string;
      if (!query) return res.json({ articles: [] });
      const articles = await storage.searchArticles(query);
      res.json({ articles });
    } catch (err) {
      console.error("Error searching articles:", err);
      res.status(500).json({ error: "Failed to search articles" });
    }
  });

  app.get("/api/articles/filters", async (_req, res) => {
    try {
      const [categories, sourceNames, sourcesByCategory, allSources, tags] = await Promise.all([
        storage.getDistinctCategories(),
        storage.getDistinctSourceNames(),
        storage.getSourcesByCategory(),
        storage.getSources(),
        storage.getApprovedTagNames(),
      ]);
      const trackedCompanySources = allSources
        .filter(s => s.category === "Company Tracker")
        .map(s => s.name);
      if (trackedCompanySources.length > 0) {
        if (!sourcesByCategory["Company Tracker"]) {
          sourcesByCategory["Company Tracker"] = [];
        }
        for (const name of trackedCompanySources) {
          if (!sourcesByCategory["Company Tracker"].includes(name)) {
            sourcesByCategory["Company Tracker"].push(name);
          }
          if (!sourceNames.includes(name)) {
            sourceNames.push(name);
          }
        }
        sourcesByCategory["Company Tracker"].sort();
        if (!categories.includes("Company Tracker")) {
          categories.push("Company Tracker");
        }
      }
      res.json({ categories, sources: sourceNames, sourcesByCategory, tags });
    } catch (err) {
      console.error("Error fetching filter options:", err);
      res.status(500).json({ error: "Failed to fetch filter options" });
    }
  });

  app.get("/api/sources", async (_req, res) => {
    try {
      const allSources = await storage.getSources();
      res.json(allSources);
    } catch (err) {
      console.error("Error fetching sources:", err);
      res.status(500).json({ error: "Failed to fetch sources" });
    }
  });

  app.post("/api/classify-topic", async (req, res) => {
    try {
      const classifySchema = z.object({ topic: z.string().min(1).max(200) });
      const parsed = classifySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Topic is required", details: parsed.error.errors });
      }
      const { topic } = parsed.data;
      const { rows: catRows } = await pool.query("SELECT name FROM news_categories ORDER BY sort_order");
      const categories = catRows.map(r => r.name);
      if (categories.length === 0) {
        return res.json({ category: "Technology" });
      }
      const response = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 20,
        system: `You are a B2B marketing and sales technology classifier. Given a topic, classify it into exactly one of these categories: ${categories.join(", ")}.

Choose the category that best matches the topic. If none fit well, pick the closest match.

Respond with ONLY the category name, nothing else.`,
        messages: [{ role: "user", content: topic }],
      });
      const classifyBlock = response.content.find((b: any) => b.type === "text");
      const classified = (classifyBlock as any)?.text?.trim() || categories[0];
      const category = categories.includes(classified) ? classified : categories[0];
      res.json({ category });
    } catch (err) {
      console.error("Error classifying topic:", err);
      res.json({ category: "GTM Tech" });
    }
  });

  app.post("/api/track-company", async (req, res) => {
    try {
      const schema = z.object({ companyName: z.string().min(1).max(200) });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Company name is required", details: parsed.error.errors });
      }
      const companyName = parsed.data.companyName.trim().replace(/\s+/g, " ");
      if (!companyName) {
        return res.status(400).json({ error: "Company name cannot be blank" });
      }
      const sourceName = `Company - ${companyName}`;
      const existingSources = await storage.getSources();
      const duplicate = existingSources.find(s => s.name.toLowerCase() === sourceName.toLowerCase());
      if (duplicate) {
        return res.status(409).json({ error: `Already tracking "${companyName}"` });
      }
      const { rows: catCheck } = await pool.query("SELECT id FROM news_categories WHERE name = 'Company Tracker'");
      if (catCheck.length === 0) {
        const { rows: maxSort } = await pool.query("SELECT COALESCE(MAX(sort_order), 0) + 1 as next_sort FROM news_categories");
        await pool.query(
          "INSERT INTO news_categories (name, color_bg, color_text, sort_order) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
          ["Company Tracker", "bg-cyan-100 dark:bg-cyan-900/30", "text-cyan-700 dark:text-cyan-300", maxSort[0].next_sort]
        );
      }
      const encodedName = encodeURIComponent(companyName).replace(/%20/g, "+");
      const source = await storage.createSource({
        name: sourceName,
        url: `https://news.google.com/search?q=${encodedName}`,
        feedUrl: `https://news.google.com/rss/search?q=${encodedName}&hl=en-US&gl=US&ceid=US:en`,
        category: "Company Tracker",
        description: `Google News tracking for company "${companyName}".`,
        isActive: true,
      });
      fetchFeedArticles(source.id, source.feedUrl, source.name, source.category).catch(err => {
        console.error(`Background fetch for ${sourceName} failed:`, err.message);
      });
      res.status(201).json(source);
    } catch (err) {
      console.error("Error tracking company:", err);
      res.status(500).json({ error: "Failed to track company" });
    }
  });

  app.get("/api/competitors", async (_req, res) => {
    try {
      const { rows } = await pool.query("SELECT * FROM competitors ORDER BY name ASC");
      res.json(rows);
    } catch (err) {
      console.error("Error fetching competitors:", err);
      res.status(500).json({ error: "Failed to fetch competitors" });
    }
  });

  app.post("/api/competitors", async (req, res) => {
    try {
      const schema = z.object({
        name: z.string().min(1).max(200),
        domain: z.string().max(200).optional().nullable(),
        notes: z.string().max(500).optional().nullable(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid data", details: parsed.error.errors });
      }
      const { name, domain, notes } = parsed.data;
      const { rows: existing } = await pool.query("SELECT id FROM competitors WHERE LOWER(name) = LOWER($1)", [name.trim()]);
      if (existing.length > 0) {
        return res.status(409).json({ error: `"${name}" is already in the competitor list` });
      }
      const { rows } = await pool.query(
        "INSERT INTO competitors (name, domain, notes) VALUES ($1, $2, $3) RETURNING *",
        [name.trim(), domain?.trim() || null, notes?.trim() || null]
      );
      res.status(201).json(rows[0]);
    } catch (err) {
      console.error("Error adding competitor:", err);
      res.status(500).json({ error: "Failed to add competitor" });
    }
  });

  app.patch("/api/competitors/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      const schema = z.object({
        name: z.string().min(1).max(200).optional(),
        domain: z.string().max(200).optional().nullable(),
        notes: z.string().max(500).optional().nullable(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid data" });
      const updates: string[] = [];
      const values: any[] = [];
      let idx = 1;
      if (parsed.data.name !== undefined) { updates.push(`name = $${idx++}`); values.push(parsed.data.name.trim()); }
      if (parsed.data.domain !== undefined) { updates.push(`domain = $${idx++}`); values.push(parsed.data.domain?.trim() || null); }
      if (parsed.data.notes !== undefined) { updates.push(`notes = $${idx++}`); values.push(parsed.data.notes?.trim() || null); }
      if (updates.length === 0) return res.status(400).json({ error: "No fields to update" });
      values.push(id);
      const { rows } = await pool.query(`UPDATE competitors SET ${updates.join(", ")} WHERE id = $${idx} RETURNING *`, values);
      if (rows.length === 0) return res.status(404).json({ error: "Competitor not found" });
      res.json(rows[0]);
    } catch (err) {
      console.error("Error updating competitor:", err);
      res.status(500).json({ error: "Failed to update competitor" });
    }
  });

  app.delete("/api/competitors/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      await pool.query("DELETE FROM competitors WHERE id = $1", [id]);
      res.json({ success: true });
    } catch (err) {
      console.error("Error deleting competitor:", err);
      res.status(500).json({ error: "Failed to delete competitor" });
    }
  });

  app.get("/api/competitor-categories", async (_req, res) => {
    try {
      const { rows } = await pool.query("SELECT * FROM competitor_categories ORDER BY name");
      res.json(rows);
    } catch (err) {
      console.error("Error fetching competitor categories:", err);
      res.status(500).json({ error: "Failed to fetch categories" });
    }
  });

  app.post("/api/competitor-categories", async (req, res) => {
    try {
      const schema = z.object({ name: z.string().min(1).max(100) });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid name" });
      const { rows } = await pool.query(
        "INSERT INTO competitor_categories (name) VALUES ($1) ON CONFLICT (name) DO NOTHING RETURNING *",
        [parsed.data.name.trim()]
      );
      if (rows.length === 0) return res.status(409).json({ error: "Category already exists" });
      res.status(201).json(rows[0]);
    } catch (err) {
      console.error("Error creating competitor category:", err);
      res.status(500).json({ error: "Failed to create category" });
    }
  });

  app.patch("/api/competitor-categories/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      const schema = z.object({ name: z.string().min(1).max(100) });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid name" });
      const newName = parsed.data.name.trim();
      const { rows: catRows } = await pool.query("SELECT name FROM competitor_categories WHERE id = $1", [id]);
      if (catRows.length === 0) return res.status(404).json({ error: "Category not found" });
      const oldName = catRows[0].name;
      await pool.query("UPDATE competitor_categories SET name = $1 WHERE id = $2", [newName, id]);
      await pool.query(
        "UPDATE competitors SET notes = $1 || ' — ' || substring(notes from length($2) + 4) WHERE notes LIKE $3",
        [newName, oldName, oldName + ' — %']
      );
      await pool.query(
        "UPDATE competitors SET notes = $1 WHERE notes = $2",
        [newName, oldName]
      );
      res.json({ id, name: newName });
    } catch (err: any) {
      if (err?.code === '23505') return res.status(409).json({ error: "Category name already exists" });
      console.error("Error renaming competitor category:", err);
      res.status(500).json({ error: "Failed to rename category" });
    }
  });

  app.delete("/api/competitor-categories/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      const { rows: catRows } = await pool.query("SELECT name FROM competitor_categories WHERE id = $1", [id]);
      if (catRows.length === 0) return res.status(404).json({ error: "Category not found" });
      const catName = catRows[0].name;
      const { rows: compRows } = await pool.query(
        "SELECT COUNT(*) as cnt FROM competitors WHERE notes LIKE $1 OR notes = $2",
        [catName + ' — %', catName]
      );
      if (parseInt(compRows[0].cnt) > 0) {
        return res.status(400).json({ error: `Cannot delete "${catName}" — move or remove its ${compRows[0].cnt} competitors first.` });
      }
      await pool.query("DELETE FROM competitor_categories WHERE id = $1", [id]);
      res.json({ success: true });
    } catch (err) {
      console.error("Error deleting competitor category:", err);
      res.status(500).json({ error: "Failed to delete category" });
    }
  });

  app.post("/api/sources", async (req, res) => {
    try {
      const parsed = insertSourceSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid source data", details: parsed.error.errors });
      }
      const source = await storage.createSource(parsed.data);
      res.status(201).json(source);
    } catch (err) {
      console.error("Error creating source:", err);
      res.status(500).json({ error: "Failed to create source" });
    }
  });

  app.patch("/api/sources/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (req.body.category) {
        const { rows } = await pool.query("SELECT id FROM news_categories WHERE name = $1", [req.body.category]);
        if (rows.length === 0) {
          return res.status(400).json({ error: "Invalid category" });
        }
      }
      const updated = await storage.updateSource(id, req.body);
      if (req.body.category && updated) {
        await storage.updateArticlesCategoryBySource(id, req.body.category);
      }
      res.json(updated);
    } catch (err) {
      console.error("Error updating source:", err);
      res.status(500).json({ error: "Failed to update source" });
    }
  });

  app.delete("/api/sources/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteSource(id);
      res.status(204).send();
    } catch (err) {
      console.error("Error deleting source:", err);
      res.status(500).json({ error: "Failed to delete source" });
    }
  });

  app.get("/api/news-categories", async (_req, res) => {
    try {
      const { rows } = await pool.query("SELECT id, name, color_bg, color_text, sort_order FROM news_categories ORDER BY sort_order, name");
      res.json(rows.map(r => ({ id: r.id, name: r.name, colorBg: r.color_bg, colorText: r.color_text, sortOrder: r.sort_order })));
    } catch (err) {
      console.error("Error fetching categories:", err);
      res.status(500).json({ error: "Failed to fetch categories" });
    }
  });

  app.post("/api/news-categories", async (req, res) => {
    try {
      const { name } = req.body;
      if (!name?.trim()) return res.status(400).json({ error: "Name is required" });
      const colorOptions = [
        { bg: "bg-rose-100 dark:bg-rose-900/30", text: "text-rose-700 dark:text-rose-300" },
        { bg: "bg-amber-100 dark:bg-amber-900/30", text: "text-amber-700 dark:text-amber-300" },
        { bg: "bg-cyan-100 dark:bg-cyan-900/30", text: "text-cyan-700 dark:text-cyan-300" },
        { bg: "bg-violet-100 dark:bg-violet-900/30", text: "text-violet-700 dark:text-violet-300" },
        { bg: "bg-lime-100 dark:bg-lime-900/30", text: "text-lime-700 dark:text-lime-300" },
        { bg: "bg-pink-100 dark:bg-pink-900/30", text: "text-pink-700 dark:text-pink-300" },
        { bg: "bg-teal-100 dark:bg-teal-900/30", text: "text-teal-700 dark:text-teal-300" },
      ];
      const color = colorOptions[Math.floor(Math.random() * colorOptions.length)];
      const { rows: maxRows } = await pool.query("SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM news_categories");
      const nextOrder = maxRows[0].next_order;
      const { rows } = await pool.query(
        "INSERT INTO news_categories (name, color_bg, color_text, sort_order) VALUES ($1, $2, $3, $4) RETURNING id, name, color_bg, color_text, sort_order",
        [name.trim(), color.bg, color.text, nextOrder]
      );
      const r = rows[0];
      res.status(201).json({ id: r.id, name: r.name, colorBg: r.color_bg, colorText: r.color_text, sortOrder: r.sort_order });
    } catch (err: any) {
      if (err.code === "23505") return res.status(409).json({ error: "Category already exists" });
      console.error("Error creating category:", err);
      res.status(500).json({ error: "Failed to create category" });
    }
  });

  app.patch("/api/news-categories/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { name } = req.body;
      if (!name?.trim()) return res.status(400).json({ error: "Name is required" });
      const { rows: oldRows } = await pool.query("SELECT name FROM news_categories WHERE id = $1", [id]);
      if (oldRows.length === 0) return res.status(404).json({ error: "Category not found" });
      const oldName = oldRows[0].name;
      const { rows } = await pool.query(
        "UPDATE news_categories SET name = $1 WHERE id = $2 RETURNING id, name, color_bg, color_text, sort_order",
        [name.trim(), id]
      );
      if (oldName !== name.trim()) {
        await pool.query("UPDATE sources SET category = $1 WHERE category = $2", [name.trim(), oldName]);
        await pool.query("UPDATE articles SET category = $1 WHERE category = $2", [name.trim(), oldName]);
      }
      const r = rows[0];
      res.json({ id: r.id, name: r.name, colorBg: r.color_bg, colorText: r.color_text, sortOrder: r.sort_order });
    } catch (err: any) {
      if (err.code === "23505") return res.status(409).json({ error: "Category name already exists" });
      console.error("Error updating category:", err);
      res.status(500).json({ error: "Failed to update category" });
    }
  });

  app.delete("/api/news-categories/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { rows: catRows } = await pool.query("SELECT name FROM news_categories WHERE id = $1", [id]);
      if (catRows.length === 0) return res.status(404).json({ error: "Category not found" });
      const catName = catRows[0].name;
      const { rows: sourceRows } = await pool.query("SELECT COUNT(*) as cnt FROM sources WHERE category = $1", [catName]);
      if (parseInt(sourceRows[0].cnt) > 0) {
        return res.status(400).json({ error: `Cannot delete category with ${sourceRows[0].cnt} active source(s). Move or remove sources first.` });
      }
      await pool.query("DELETE FROM news_categories WHERE id = $1", [id]);
      res.status(204).send();
    } catch (err) {
      console.error("Error deleting category:", err);
      res.status(500).json({ error: "Failed to delete category" });
    }
  });

  app.get("/api/feed-tags/queue", async (req, res) => {
    try {
      const surfaced = await storage.getSurfacedPendingTags();
      const hiddenCount = await storage.countHiddenPendingTags();
      const names = surfaced.map((t) => t.name);
      const enrichment = names.length ? await storage.getTagEnrichment(names) : [];

      let annotations: Awaited<ReturnType<typeof annotateTags>> = [];
      const unannotated = surfaced.filter((t) => !t.aiSummary).slice(0, 30);
      if (unannotated.length > 0) {
        try {
          const headlines = await storage.getTagHeadlines(unannotated.map((t) => t.name), 3);
          const enrichByName = new Map(enrichment.map((e) => [e.name, e]));
          annotations = await annotateTags(
            unannotated.map((t) => ({
              name: t.name,
              displayName: t.displayName,
              sources: enrichByName.get(t.name)?.sources ?? [],
              headlines: headlines[t.name] ?? [],
            }))
          );
          if (annotations.length > 0) await storage.cacheTagAnnotations(annotations);
        } catch (err) {
          console.error("Tag annotation failed (queue still served):", err);
        }
      }

      res.json({
        threshold: TAG_SURFACE_THRESHOLD,
        hiddenCount,
        tags: mergeQueueTags(surfaced, enrichment, annotations),
      });
    } catch (err) {
      console.error("Error building feed-tag queue:", err);
      res.status(500).json({ error: "Failed to build tag review queue" });
    }
  });

  app.get("/api/feed-tags", async (req, res) => {
    try {
      const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
      if (search) {
        return res.json(await storage.searchFeedTags(search));
      }
      const status = req.query.status as string | undefined;
      if (status && !FEED_TAG_STATUSES.includes(status as any)) {
        return res.status(400).json({ error: "Invalid status", valid: FEED_TAG_STATUSES });
      }
      const tags = await storage.getFeedTags(status as FeedTagStatus | undefined);
      res.json(tags);
    } catch (err) {
      console.error("Error listing feed tags:", err);
      res.status(500).json({ error: "Failed to list feed tags" });
    }
  });

  app.post("/api/feed-tags/bulk", async (req, res) => {
    try {
      const parsed = z
        .object({
          items: z
            .array(z.object({ id: z.number().int(), status: z.enum(FEED_TAG_STATUSES) }))
            .min(1)
            .max(100),
        })
        .safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid bulk payload", details: parsed.error.errors });
      }
      let applied = 0;
      const failed: { id: number; error: string }[] = [];
      for (const item of parsed.data.items) {
        try {
          const updated = await storage.updateFeedTagStatus(item.id, item.status);
          if (updated) applied++;
          else failed.push({ id: item.id, error: "Tag not found" });
        } catch (err) {
          failed.push({ id: item.id, error: err instanceof Error ? err.message : String(err) });
        }
      }
      res.json({ applied, failed });
    } catch (err) {
      console.error("Error bulk-updating feed tags:", err);
      res.status(500).json({ error: "Failed to bulk-update tags" });
    }
  });

  app.post("/api/feed-tags/:id/status", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      const parsed = z.object({ status: z.enum(FEED_TAG_STATUSES) }).safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid status", details: parsed.error.errors });
      }
      const tag = await storage.updateFeedTagStatus(id, parsed.data.status);
      if (!tag) return res.status(404).json({ error: "Tag not found" });
      res.json(tag);
    } catch (err) {
      console.error("Error updating feed tag status:", err);
      res.status(500).json({ error: "Failed to update tag status" });
    }
  });

  app.post("/api/articles/:id/dismiss", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const article = await storage.dismissArticle(id);
      if (!article) {
        return res.status(404).json({ error: "Article not found" });
      }
      res.json({ dismissed: true, article });
    } catch (err) {
      console.error("Error dismissing article:", err);
      res.status(500).json({ error: "Failed to dismiss article" });
    }
  });

  app.post("/api/articles/:id/undismiss", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const article = await storage.undismissArticle(id);
      if (!article) {
        return res.status(404).json({ error: "Article not found" });
      }
      res.json({ dismissed: false, article });
    } catch (err) {
      console.error("Error undismissing article:", err);
      res.status(500).json({ error: "Failed to undismiss article" });
    }
  });

  app.get("/api/articles/dismissal-patterns", async (_req, res) => {
    try {
      const patterns = await storage.getDismissalPatterns();
      const allSources = await storage.getSources();

      const recommendations: Array<{
        sourceName: string;
        sourceId: number | null;
        dismissedCount: number;
        isActive: boolean;
      }> = [];

      const sortedSources = Object.entries(patterns.sources)
        .sort(([, a], [, b]) => b - a);

      for (const [sourceName, count] of sortedSources) {
        if (count >= 3) {
          const source = allSources.find(s => s.name === sourceName);
          if (source && source.isActive) {
            recommendations.push({
              sourceName,
              sourceId: source.id,
              dismissedCount: count,
              isActive: source.isActive,
            });
          }
        }
      }

      res.json({ patterns, recommendations });
    } catch (err) {
      console.error("Error fetching dismissal patterns:", err);
      res.status(500).json({ error: "Failed to fetch dismissal patterns" });
    }
  });

  app.get("/api/fetch-feeds/status", (_req, res) => {
    res.json({ lastFetchedAt: lastFeedFetchAt });
  });

  app.post("/api/fetch-feeds", async (_req, res) => {
    try {
      const rssResult = await fetchAllFeeds();
      const newsApiResult = await fetchNewsAPIArticles();
      const newArticles = rssResult.total + newsApiResult.total;

      setLastFeedFetchAt();

      if (newArticles > 0) {
        await updateSearchVectors().catch(err => {
          console.error("Error indexing new articles:", err);
        });
        generateDigestsForNewArticles().catch(err => {
          console.error("Error generating digests for new articles:", err);
        });
      }

      res.json({
        total: newArticles,
        errors: rssResult.errors + newsApiResult.errors,
        removed: rssResult.removed || [],
        rss: rssResult,
        newsapi: newsApiResult,
      });
    } catch (err) {
      console.error("Error fetching feeds:", err);
      res.status(500).json({ error: "Failed to fetch feeds" });
    }
  });

  app.post("/api/analyze-trends", async (req, res) => {
    try {
      const selectedModel = resolveModel(req.body?.model);
      const BATCH_SIZE = 200;
      let allArticles: Article[] = [];
      let offset = 0;
      while (true) {
        const batch = await storage.getArticles(BATCH_SIZE, offset);
        if (batch.length === 0) break;
        allArticles = allArticles.concat(batch);
        offset += batch.length;
        if (batch.length < BATCH_SIZE) break;
      }

      if (allArticles.length === 0) {
        return res.status(400).json({ error: "No articles available for analysis" });
      }

      console.log(`[trends] Analyzing ALL ${allArticles.length} articles with model ${selectedModel} in batches...`);

      const articleBatches: Article[][] = [];
      for (let i = 0; i < allArticles.length; i += BATCH_SIZE) {
        articleBatches.push(allArticles.slice(i, i + BATCH_SIZE));
      }

      const batchSummaries: string[] = [];
      const batchPromises = articleBatches.map(async (batch, batchIdx) => {
        const batchText = batch.map(a =>
          `- "${a.title}" (${a.sourceName || "Unknown"}, ${a.category || "General"}, ${a.publishedAt ? new Date(a.publishedAt).toLocaleDateString() : "recent"}): ${a.description?.substring(0, 100) || ""}`
        ).join("\n");

        const result = await chatCompletion({
          model: selectedModel,
          messages: [
            {
              role: "system",
              content: `You are a B2B MarTech/SalesTech analyst. Summarize the key themes, recurring topics, notable companies, and emerging patterns from this batch of news articles. Be specific: name companies, technologies, and trends. Output a concise summary (400-600 words) organized by theme.
${NO_DASH_RULE}`
            },
            {
              role: "user",
              content: `Summarize the key trends from these ${batch.length} articles (batch ${batchIdx + 1} of ${articleBatches.length}):\n\n${batchText}`
            }
          ],
          maxTokens: 1500,
        });

        return result;
      });

      const results = await Promise.all(batchPromises);
      results.forEach((r, i) => { if (r) batchSummaries.push(`### Batch ${i + 1} (${articleBatches[i].length} articles)\n${r}`); });

      console.log(`[trends] ${batchSummaries.length} batch summaries complete. Running final synthesis...`);

      const combinedSummaries = batchSummaries.join("\n\n");

      const analysisText = await chatCompletion({
        model: selectedModel,
        jsonMode: true,
        maxTokens: 6144,
        messages: [
          {
            role: "system",
            content: `You are an expert analyst in B2B marketing and sales technology. You have been given batch summaries that cover ALL ${allArticles.length} articles in the database. Synthesize these into a comprehensive trend analysis.

Focus on:
1. Emerging technologies and AI applications in B2B
2. Market movements, funding, partnerships, and competitive dynamics
3. Changes in buyer behavior and go-to-market strategies
4. MarTech/SalesTech stack evolution and consolidation
5. Data privacy, compliance, and regulatory trends

Respond in JSON format:
{
  "title": "Brief, punchy trend analysis title (e.g. 'AI Agents Reshape B2B GTM as Data Privacy Tightens')",
  "summary": "2-3 paragraph executive summary of the most important patterns and shifts. Be specific — cite companies, products, and article topics when relevant.",
  "keyThemes": ["theme1", "theme2", "theme3", "theme4", "theme5"],
  "insights": "Detailed analysis broken into 4-6 sections with ## markdown headers. Each section should cover a distinct trend with specific evidence. End with a '## What This Means' section with actionable takeaways for B2B marketers and sales leaders.",
  "visualData": {
    "topCompanies": [
      {"name": "Company Name", "mentions": 15, "sentiment": "positive|neutral|negative"}
    ],
    "categoryBreakdown": [
      {"category": "AI & Automation", "percentage": 35, "articleCount": 120}
    ],
    "emergingSignals": [
      {
        "name": "Signal name (e.g. 'AI SDR Agents')",
        "type": "rising|emerging|breakout",
        "description": "1-2 sentence explanation of why this is notable and where it's heading",
        "confidence": 85,
        "relatedCompanies": ["Company1", "Company2"]
      }
    ],
    "trendDirection": [
      {"topic": "Topic name", "direction": "up|down|stable", "momentum": 1-100}
    ]
  }
}

For visualData:
- topCompanies: List the 8-10 most frequently mentioned companies with approximate mention counts and overall sentiment
- categoryBreakdown: Break down the articles into 5-7 thematic categories with percentages (must sum to ~100)
- emergingSignals: Identify 4-6 topics/companies/technologies that are JUST starting to appear or gaining rapid momentum — things that could "become a thing" based on the data patterns. Use "emerging" for brand new signals, "rising" for gaining traction, "breakout" for rapid acceleration
- trendDirection: 6-8 key topics showing whether they're trending up, down, or stable with a momentum score (higher = stronger signal)
${NO_DASH_RULE}`
          },
          {
            role: "user",
            content: `Synthesize these batch summaries covering ALL ${allArticles.length} articles into a comprehensive trend analysis:\n\n${combinedSummaries}`
          }
        ],
      });

      const analysis = parseAIJson(analysisText || "{}");

      const visualDataStr = analysis.visualData ? JSON.stringify(analysis.visualData) : null;

      const saved = await storage.createTrendAnalysis({
        title: analysis.title || "B2B MarTech Trend Analysis",
        summary: analysis.summary || "Analysis unavailable",
        keyThemes: analysis.keyThemes || [],
        insights: analysis.insights || "No insights available",
        visualData: visualDataStr,
        articleIds: allArticles.map(a => a.id),
        model: selectedModel,
      });

      console.log(`[trends] Analysis complete: "${saved.title}" — based on ${allArticles.length} articles`);
      res.json(saved);
    } catch (err) {
      console.error("Error analyzing trends:", err);
      res.status(500).json({ error: "Failed to analyze trends" });
    }
  });

  app.delete("/api/trends/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid trend ID" });
      await storage.deleteTrendAnalysis(id);
      res.json({ success: true });
    } catch (err) {
      console.error("Error deleting trend:", err);
      res.status(500).json({ error: "Failed to delete trend" });
    }
  });

  app.get("/api/thought-leadership", async (req, res) => {
    try {
      if (req.query.id) {
        const item = await storage.getThoughtLeadershipById(parseInt(req.query.id as string));
        if (!item) return res.status(404).json({ error: "Not found" });
        return res.json(item);
      }

      const items = await storage.getThoughtLeadership(10);

      if (req.query.summary === "true") {
        const lightweight = items.map(item => ({
          id: item.id,
          title: item.title,
          summary: item.summary,
          articleCount: item.articleCount,
          model: item.model,
          createdAt: item.createdAt,
          opportunityCount: (() => { try { return JSON.parse(item.opportunities).length; } catch { return 0; } })(),
        }));
        return res.json(lightweight);
      }
      res.json(items);
    } catch (err) {
      console.error("Error fetching thought leadership:", err);
      res.status(500).json({ error: "Failed to fetch thought leadership" });
    }
  });

  app.post("/api/thought-leadership", async (req, res) => {
    try {
      const requestedModel = req.body?.model;
      const selectedModel = requestedModel ? resolveModel(requestedModel) : "claude-haiku-4-5-20251001";
      const [hasNew, latestDigestAt, existingTL] = await Promise.all([
        storage.hasUndigestedArticles(),
        storage.getLatestDigestCreatedAt(),
        storage.getThoughtLeadership(1),
      ]);

      const forceRegenerate = req.body?.force === true;

      if (hasNew) {
        console.log(`[thought-leadership] Digesting new articles before analysis...`);
        await generateDigestsForNewArticles();
      } else if (!forceRegenerate && existingTL.length > 0 && latestDigestAt) {
        const lastTLTime = new Date(existingTL[0].createdAt).getTime();
        const digestTime = new Date(latestDigestAt).getTime();
        const sameModel = existingTL[0].model != null && existingTL[0].model === selectedModel;
        if (lastTLTime >= digestTime && sameModel) {
          console.log(`[thought-leadership] Cache hit (model: ${selectedModel}) — returning existing analysis`);
          const cacheResponse = JSON.parse(JSON.stringify(existingTL[0]));
          cacheResponse.cached = true;
          return res.json(cacheResponse);
        }
      }

      const [digests, latestTrend, dbContext, activeTlDocs] = await Promise.all([
        storage.getArticleDigests(),
        storage.getLatestTrendAnalysis(),
        getDemandbaseContext(),
        storage.getActiveTlDocuments(),
      ]);

      if (digests.length === 0) {
        return res.status(400).json({ error: "No article digests available. Fetch articles first." });
      }

      const totalArticles = digests.reduce((sum, d) => sum + d.articleCount, 0);
      const trendContext = latestTrend
        ? `\nTRENDS: ${latestTrend.keyThemes.join(", ")}. ${latestTrend.summary.substring(0, 500)}`
        : "";

      const digestContext = digests.map(d =>
        `### ${d.category} (${d.articleCount} articles, ${new Date(d.periodStart).toLocaleDateString()} – ${new Date(d.periodEnd).toLocaleDateString()})\n${d.digest.substring(0, 2500)}`
      ).join("\n\n");

      const docContext = activeTlDocs.length > 0
        ? "\n\nUPLOADED REFERENCE DOCUMENTS:\n" + activeTlDocs.map(d =>
            `### Document: "${d.filename}"\nContext: ${d.description}\n\n${d.extractedText.substring(0, 5000)}`
          ).join("\n\n---\n\n")
        : "";

      console.log(`[thought-leadership] Synthesizing ${digests.length} digests covering ${totalArticles} articles${activeTlDocs.length > 0 ? ` + ${activeTlDocs.length} uploaded documents` : ""}...`);

      const synthesisText = await chatCompletion({
        model: selectedModel,
        messages: [
          {
            role: "system",
            content: `You are a thought leadership strategist for Demandbase, the leading Account-Based GTM platform. Audience: CMOs, CROs, VPs Marketing/Sales at enterprise B2B companies.

CONTEXT:
${dbContext.substring(0, 2000)}${trendContext}

Synthesize article digests into executive thought leadership opportunities. Each must be specific and actionable — keynote talks, LinkedIn articles, research reports, frameworks, manifestos, or contrarian takes.

Respond in JSON:
{"title":"Compelling headline","summary":"2-3 paragraph overview of landscape and why now is Demandbase's moment","opportunities":[{"title":"Provocative title","format":"keynote|linkedin_article|research_report|framework|manifesto|executive_brief","audience":"Specific executives","thesis":"Core argument in 2-3 sentences","demandbase_angle":"DB's unique perspective","talking_points":["3-5 data points"],"timeliness":"Why urgent now","competitive_differentiation":"vs 6sense, ZoomInfo etc."}]}

Generate 5-7 opportunities. Prioritize contrarian takes, frameworks, data-driven narratives, timely responses. Executive-level only.

${CITATION_RULES_INLINE}
${NO_DASH_RULE}`
          },
          {
            role: "user",
            content: `Synthesize these ${digests.length} category digests (${totalArticles} articles) into thought leadership opportunities:\n\n${digestContext}${docContext}`
          }
        ],
        jsonMode: true,
        maxTokens: 16384,
      });

      const analysis = parseAIJson(synthesisText);

      const saved = await storage.createThoughtLeadership({
        title: analysis.title || "Thought Leadership Opportunities",
        summary: analysis.summary || "Analysis unavailable",
        opportunities: JSON.stringify(analysis.opportunities || []),
        articleCount: totalArticles,
        model: selectedModel,
      });

      console.log(`[thought-leadership] Analysis complete: "${saved.title}" — ${totalArticles} articles via ${digests.length} digests`);
      res.json(saved);
    } catch (err) {
      console.error("Error generating thought leadership:", err);
      res.status(500).json({ error: "Failed to generate thought leadership analysis" });
    }
  });

  app.post("/api/digests/generate", async (_req, res) => {
    try {
      const result = await generateDigestsForNewArticles();
      res.json(result);
    } catch (err: any) {
      console.error("Error generating digests:", err);
      res.status(500).json({ error: err.message || "Failed to generate digests" });
    }
  });

  app.post("/api/digests/backfill", async (_req, res) => {
    try {
      res.json({ status: "started", message: "Backfill running in background" });
      generateDigestsForNewArticles().then(result => {
        console.log(`[digest] Backfill complete: ${result.digestsCreated} digests from ${result.articlesProcessed} articles`);
      }).catch(err => {
        console.error("[digest] Backfill failed:", err);
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to start backfill" });
    }
  });

  app.get("/api/digests", async (_req, res) => {
    try {
      const digests = await storage.getArticleDigests();
      res.json({ count: digests.length, totalArticles: digests.reduce((s, d) => s + d.articleCount, 0), digests });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to fetch digests" });
    }
  });

  app.post("/api/thought-leadership/from-idea/questions", async (req, res) => {
    try {
      const schema = z.object({
        idea: z.string().min(1),
        model: z.string().optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
      }
      const { idea, model: requestedModel } = parsed.data;
      const selectedModel = resolveModel(requestedModel);

      const dbContext = await getDemandbaseContext();

      const resultText = await chatCompletion({
        model: selectedModel,
        messages: [
          {
            role: "system",
            content: `You are a world-class thought leadership strategist for Demandbase, the leading Account-Based Go-to-Market platform.

DEMANDBASE CONTEXT:
${dbContext.substring(0, 2000)}

The user has shared a raw thought leadership idea. Your job is to ask probing, thoughtful questions that will draw out their genuine perspective, unique experiences, and contrarian viewpoints. You want to understand:
- What personal experience or observation led them to this idea
- What their actual opinion/stance is (not just the topic, but their take)
- Who they think needs to hear this and why
- What they think is broken or misunderstood about the current state
- What they'd say if they were on stage with no filter
- Any data, stories, or examples they've seen that support their thinking
- What the audience should DO differently after hearing this
${NO_DASH_RULE}

Be conversational and curious — like a great podcast host preparing for an interview. Ask questions that challenge them to go deeper, not surface-level questions they've already answered in their idea.

Respond in JSON format:
{
  "acknowledgment": "A brief 1-2 sentence reaction to their idea that shows you understand it and find it interesting. Be genuine, not generic.",
  "questions": [
    {
      "id": "q1",
      "question": "The actual question text",
      "why": "Brief note on why this matters for the final piece (shown as helper text)"
    }
  ]
}

Generate 5-8 questions. Make them specific to their idea, not generic. Each question should unlock a different dimension of their thinking. Order them from most natural/easy to most provocative/challenging.`
          },
          {
            role: "user",
            content: idea
          }
        ],
        jsonMode: true,
        maxTokens: 2048,
      });

      const result = parseAIJson(resultText);

      console.log(`[thought-leadership] Generated ${result.questions?.length || 0} questions for user idea`);
      res.json(result);
    } catch (err) {
      console.error("Error generating questions for idea:", err);
      res.status(500).json({ error: "Failed to generate questions" });
    }
  });

  app.post("/api/thought-leadership/from-idea/followup", async (req, res) => {
    try {
      const schema = z.object({
        idea: z.string().min(1),
        previousQA: z.array(z.object({
          question: z.string(),
          answer: z.string(),
        })),
        round: z.number().int().min(1).optional().default(1),
        model: z.string().optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
      }
      const { idea, previousQA, round, model: requestedModel } = parsed.data;
      const selectedModel = resolveModel(requestedModel);

      const answeredQA = previousQA.filter(qa => qa.answer.trim());
      if (answeredQA.length === 0) {
        return res.json({ ready: true, questions: [] });
      }

      if (round >= 3) {
        return res.json({ ready: true, questions: [] });
      }

      const dbContext = await getDemandbaseContext();
      const qaText = answeredQA.map(qa => `Q: ${qa.question}\nA: ${qa.answer}`).join("\n\n");

      const resultText = await chatCompletion({
        model: selectedModel,
        messages: [
          {
            role: "system",
            content: `You are a world-class thought leadership strategist for Demandbase. You've been interviewing someone about their thought leadership idea and have received their initial answers.

DEMANDBASE CONTEXT:
${dbContext.substring(0, 1500)}

Review their answers carefully. Your job is to ask 2-4 sharp follow-up questions that:
- Dig deeper into the most interesting or provocative things they said
- Challenge assumptions or ask for specific examples where they were vague
- Explore contradictions or tensions in their answers
- Ask for the "so what" — what should the audience DO with this insight
- Probe for specific stories, data, or experiences they hinted at but didn't fully share

DO NOT repeat questions they've already answered well. DO NOT ask generic questions. Every follow-up should directly reference something specific they said.

If their answers are already rich, detailed, and provide enough material to create compelling content, you may return fewer questions or signal that you're ready to proceed.
${NO_DASH_RULE}

Respond in JSON format:
{
  "ready": false,
  "reaction": "A brief 1-2 sentence reaction to their answers — what stood out, what was most interesting. Reference something specific they said.",
  "questions": [
    {
      "id": "f1",
      "question": "A follow-up question that directly references something they said",
      "why": "Why this follow-up matters for the final piece"
    }
  ]
}

If their answers are sufficiently rich and detailed, respond with:
{
  "ready": true,
  "reaction": "A brief affirming message that their input is great and you have what you need.",
  "questions": []
}

Be genuinely curious — these follow-ups should feel like a great interviewer going deeper, not a form.`
          },
          {
            role: "user",
            content: `ORIGINAL IDEA:\n${idea}\n\nTHEIR ANSWERS SO FAR:\n${qaText}`
          }
        ],
        jsonMode: true,
        maxTokens: 1500,
      });

      const result = parseAIJson(resultText);

      console.log(`[thought-leadership] Follow-up round ${round}: ${result.ready ? "ready to generate" : `${result.questions?.length || 0} follow-up questions`}`);
      res.json(result);
    } catch (err) {
      console.error("Error generating follow-up questions:", err);
      res.json({ ready: true, questions: [] });
    }
  });

  app.post("/api/thought-leadership/content-followup", async (req, res) => {
    try {
      const schema = z.object({
        contentType: z.enum(["blog", "webinar", "presentation"]),
        title: z.string().min(1),
        thesis: z.string().min(1),
        audience: z.string().optional().default("B2B executives"),
        previousQA: z.array(z.object({
          question: z.string(),
          answer: z.string(),
        })),
        round: z.number().int().min(1).optional().default(1),
        model: z.string().optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
      }
      const { contentType, title, thesis, audience, previousQA, round, model: requestedModel } = parsed.data;
      const selectedModel = resolveModel(requestedModel);

      const answeredQA = previousQA.filter(qa => qa.answer.trim());
      if (answeredQA.length === 0) {
        return res.json({ ready: true, questions: [] });
      }

      if (round >= 3) {
        return res.json({ ready: true, questions: [] });
      }

      const contentTypeLabels: Record<string, string> = {
        blog: "blog post",
        webinar: "webinar",
        presentation: "presentation deck",
      };
      const contentLabel = contentTypeLabels[contentType] || contentType;
      const qaText = answeredQA.map(qa => `Q: ${qa.question}\nA: ${qa.answer}`).join("\n\n");

      const resultText = await chatCompletion({
        model: selectedModel,
        messages: [
          {
            role: "system",
            content: `You are a senior content strategist preparing to create a ${contentLabel} for a Demandbase executive about "${title}".

You've asked initial questions and received answers. Review them carefully and generate 2-4 targeted follow-up questions that:
- Dig deeper into the most interesting or specific things they said
- Ask for concrete examples, data, or stories where they were vague
- Explore angles that will make the ${contentLabel} more compelling and unique
- Reference their actual words and push them to go further
- Help you create a ${contentLabel} that sounds like THEM, not generic content

DO NOT repeat questions they've already answered. Every follow-up must directly reference something specific from their answers.
${NO_DASH_RULE}

CONTEXT:
Topic: ${title}
Thesis: ${thesis}
Audience: ${audience}

Respond in JSON format:
{
  "ready": false,
  "reaction": "Brief 1-2 sentence reaction referencing something specific and interesting from their answers.",
  "questions": [
    {
      "id": "f1",
      "question": "Follow-up that references something specific they said",
      "why": "How this shapes the ${contentLabel}"
    }
  ]
}

If their answers are already rich enough to create an excellent ${contentLabel}, respond with:
{
  "ready": true,
  "reaction": "Brief affirming message that you have what you need.",
  "questions": []
}`
          },
          {
            role: "user",
            content: `Their answers so far:\n${qaText}`
          }
        ],
        jsonMode: true,
        maxTokens: 1500,
      });

      const result = parseAIJson(resultText);

      console.log(`[thought-leadership] Content follow-up round ${round} for ${contentType}: ${result.ready ? "ready" : `${result.questions?.length || 0} follow-ups`}`);
      res.json(result);
    } catch (err) {
      console.error("Error generating content follow-up:", err);
      res.json({ ready: true, questions: [] });
    }
  });

  app.post("/api/thought-leadership/from-idea/generate", async (req, res) => {
    try {
      const schema = z.object({
        idea: z.string().min(1),
        answers: z.array(z.object({
          questionId: z.string(),
          question: z.string(),
          answer: z.string(),
        })),
        model: z.string().optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
      }
      const { idea, answers, model: requestedModel } = parsed.data;
      const selectedModel = resolveModel(requestedModel);

      const dbContext = await getDemandbaseContext();
      const latestTrend = await storage.getLatestTrendAnalysis();
      const trendContext = latestTrend
        ? `\n\nLATEST TREND ANALYSIS:\nKey Themes: ${latestTrend.keyThemes.join(", ")}\nSummary: ${latestTrend.summary}`
        : "";

      const answersText = answers
        .map(a => `Q: ${a.question}\nA: ${a.answer}`)
        .join("\n\n");

      const resultText = await chatCompletion({
        model: selectedModel,
        messages: [
          {
            role: "system",
            content: `You are a world-class thought leadership strategist for Demandbase, the leading Account-Based Go-to-Market platform. Your audience is CMOs, CROs, VPs of Marketing, and VPs of Sales at enterprise B2B companies.

DEMANDBASE CONTEXT:
${dbContext.substring(0, 3000)}
${trendContext}

The user has shared a thought leadership idea AND answered detailed follow-up questions about it. Use BOTH their original idea AND their answers to craft a thought leadership opportunity that truly reflects their unique perspective, voice, and opinions — not generic industry talking points.

The answers they gave are the most important input. Incorporate their specific viewpoints, stories, data points, and language into the opportunity. This should sound like THEM, not like a committee.

Respond in JSON format:
{
  "title": "Provocative, specific title that captures their unique angle",
  "format": "keynote | linkedin_article | research_report | framework | manifesto | executive_brief | podcast_topic | panel_discussion",
  "audience": "Specific executive audience based on who they said needs to hear this",
  "thesis": "The core argument in 2-3 sentences, rooted in their actual opinion and perspective",
  "demandbase_angle": "How this connects to Demandbase's POV, using the specific framing they provided",
  "talking_points": ["3-5 talking points drawn directly from their answers and examples"],
  "timeliness": "Why this topic is urgent RIGHT NOW, informed by their observations",
  "competitive_differentiation": "How this positions Demandbase ahead of competitors, using their unique framing"
}

Make this feel like it came from a real executive with strong opinions, not a marketing playbook.
${NO_DASH_RULE}`
          },
          {
            role: "user",
            content: `ORIGINAL IDEA:\n${idea}\n\nFOLLOW-UP Q&A:\n${answersText}`
          }
        ],
        jsonMode: true,
        maxTokens: 2048,
      });

      const opportunity = parseAIJson(resultText);

      console.log(`[thought-leadership] Generated opportunity from idea + answers: "${opportunity.title}"`);
      res.json({ opportunity });
    } catch (err) {
      console.error("Error generating thought leadership from idea:", err);
      res.status(500).json({ error: "Failed to generate thought leadership from idea" });
    }
  });

  app.post("/api/thought-leadership/linkedin-post", async (req, res) => {
    try {
      const schema = z.object({
        title: z.string().min(1),
        thesis: z.string().min(1),
        demandbase_angle: z.string().optional().default(""),
        talking_points: z.array(z.string()).optional().default([]),
        audience: z.string().optional().default("B2B executives"),
        format: z.string().optional().default("thought leadership"),
        postCount: z.number().int().min(1).max(10).optional().default(1),
        refinement: z.string().optional().default(""),
        previousPosts: z.array(z.string()).optional().default([]),
        model: z.string().optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
      }
      const { title, thesis, demandbase_angle, talking_points, audience, format, postCount, refinement, previousPosts, model: requestedModel } = parsed.data;
      const selectedModel = resolveModel(requestedModel);

      const systemPrompt = `You are a LinkedIn ghostwriter for a senior B2B marketing/sales executive at Demandbase. Write compelling LinkedIn posts that:

- Open with a bold, attention-grabbing hook (first line is critical for the feed)
- Are written in first person, conversational but authoritative tone
- Use short paragraphs and line breaks for readability
- Include 1-2 relevant hashtags at the end (not more)
- Are between 80-150 words each — keep them punchy and scannable
- Avoid corporate jargon and buzzword salad
- Sound like a real executive sharing genuine insights, not a marketing team
- Do NOT mention Demandbase products directly — instead weave in the strategic POV naturally
- End with a question or call-to-action to drive engagement

Each post should feel like it belongs on a CMO or CRO's personal feed: provocative enough to stop the scroll, substantive enough to earn respect.

${CITATION_RULES_INLINE}
${NO_DASH_RULE}`;

      const topicContext = `Title: ${title}
Format: ${format}
Target Audience: ${audience}
Core Thesis: ${thesis}
Demandbase Angle: ${demandbase_angle || "N/A"}
Key Talking Points:
${talking_points.map((tp: string) => `- ${tp}`).join("\n")}`;

      const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
        { role: "system", content: systemPrompt },
      ];

      if (refinement && previousPosts.length > 0) {
        const originalRequest = postCount === 1
          ? `Generate a LinkedIn post based on this thought leadership opportunity:\n\n${topicContext}`
          : `Generate exactly ${postCount} distinct LinkedIn posts as a content series based on this thought leadership opportunity. Each post should explore a different angle, talking point, or perspective from the topic — do NOT repeat the same message.\n\nSeparate each post with the delimiter: ---POST---\n\n${topicContext}`;
        messages.push({ role: "user", content: originalRequest });
        messages.push({ role: "assistant", content: previousPosts.join("\n\n---POST---\n\n") });
        messages.push({
          role: "user",
          content: `The user wants changes to the post${postCount > 1 ? "s" : ""}. Here is their feedback:\n\n"${refinement}"\n\nPlease rewrite the ${postCount > 1 ? `${postCount} posts (separated by ---POST---)` : "post"} incorporating this feedback while keeping the same topic and core message.`,
        });
      } else {
        const userPrompt = postCount === 1
          ? `Generate a LinkedIn post based on this thought leadership opportunity:\n\n${topicContext}`
          : `Generate exactly ${postCount} distinct LinkedIn posts as a content series based on this thought leadership opportunity. Each post should explore a different angle, talking point, or perspective from the topic — do NOT repeat the same message.\n\nSeparate each post with the delimiter: ---POST---\n\n${topicContext}`;
        messages.push({ role: "user", content: userPrompt });
      }

      const content = await chatCompletion({
        model: selectedModel,
        messages,
        maxTokens: postCount === 1 ? 1000 : postCount * 800,
      });

      if (postCount === 1) {
        res.json({ post: content, posts: [content] });
      } else {
        const posts = content.split(/---POST---/i).map(p => p.trim()).filter(p => p.length > 0);
        res.json({ post: posts[0] || content, posts });
      }
    } catch (err) {
      console.error("Error generating LinkedIn post:", err);
      res.status(500).json({ error: "Failed to generate LinkedIn post" });
    }
  });

  const thoughtLeadershipContentSchema = z.object({
    title: z.string().min(1),
    thesis: z.string().min(1),
    demandbase_angle: z.string().optional().default(""),
    talking_points: z.array(z.string()).optional().default([]),
    audience: z.string().optional().default("B2B marketing and sales executives"),
    format: z.string().optional().default("thought leadership"),
    timeliness: z.string().optional().default("Current market trends"),
    documentName: z.string().optional().default(""),
    model: z.string().optional(),
  });

  const creatorAnswersSchema = z.array(z.object({
    question: z.string(),
    answer: z.string(),
  })).optional().default([]);

  const generatePreviewSchema = thoughtLeadershipContentSchema.extend({
    refinement: z.string().optional().default(""),
    previousContent: z.string().optional().default(""),
    designTemplate: z.string().optional(),
    creatorAnswers: creatorAnswersSchema,
  });

  const generateSlidesPreviewSchema = generatePreviewSchema.extend({
    targetAudience: z.string().optional().default(""),
    presentationStyle: z.enum(["executive-briefing", "sales-enablement", "thought-leadership", "technical-deep-dive"]).optional().default("thought-leadership"),
  });

  app.post("/api/thought-leadership/content-questions", async (req, res) => {
    try {
      const schema = z.object({
        contentType: z.enum(["blog", "webinar", "presentation"]),
        title: z.string().min(1),
        model: z.string().optional(),
        thesis: z.string().min(1),
        audience: z.string().optional().default("B2B executives"),
        demandbase_angle: z.string().optional().default(""),
        talking_points: z.array(z.string()).optional().default([]),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
      }
      const { contentType, title, thesis, audience, demandbase_angle, talking_points, model: requestedModel } = parsed.data;
      const selectedModel = resolveModel(requestedModel);

      const contentTypeLabels: Record<string, string> = {
        blog: "blog post",
        webinar: "webinar",
        presentation: "presentation deck",
      };
      const contentLabel = contentTypeLabels[contentType] || contentType;

      const contentTypeGuidance: Record<string, string> = {
        blog: `For a blog post, focus on:
- What original insight or contrarian perspective should anchor the piece
- What specific examples, data, or customer stories they can reference
- What the reader should think or do differently after reading
- What common misconceptions they want to challenge
- What their personal experience tells them about this topic`,
        webinar: `For a webinar, focus on:
- What the single biggest takeaway for attendees should be
- What interactive moments or audience engagement they envision
- What stories or live examples would make this memorable
- Who the ideal panelists or co-presenters would be and why
- What questions the audience is likely asking themselves about this topic
- What the audience should be able to DO after the webinar`,
        presentation: `For a presentation deck, focus on:
- What is the one slide that should make people pull out their phones to take a photo
- What data visualization or comparison would be most impactful
- What's the narrative arc — where should the audience start vs. where should they end
- What objections or skepticism will be in the room and how to preempt it
- What specific call-to-action should close the deck
- What makes this different from every other deck on this topic`,
      };

      const resultText = await chatCompletion({
        model: selectedModel,
        messages: [
          {
            role: "system",
            content: `You are a senior content strategist preparing to create a ${contentLabel} for a Demandbase executive.

The user has chosen a thought leadership opportunity and wants to create a ${contentLabel} from it. Before you generate the content, you need to ask probing questions to understand their genuine perspective, what makes their take unique, and what they want the audience to walk away with.

${contentTypeGuidance[contentType] || ""}

Your questions should:
- Draw out the creator's authentic voice and unique perspective
- Uncover specific stories, data points, or examples they want to include
- Clarify their opinion on controversial aspects of the topic
- Help shape the tone, depth, and angle of the final piece
- Be specific to THIS topic — not generic content creation questions

CONTEXT ON THE OPPORTUNITY:
Title: ${title}
Thesis: ${thesis}
Audience: ${audience}
Demandbase Angle: ${demandbase_angle || "N/A"}
Key Talking Points:
${talking_points.map(tp => `- ${tp}`).join("\n")}

Respond in JSON format:
{
  "acknowledgment": "A brief 1-2 sentence reaction that shows you understand the opportunity and are excited about the ${contentLabel} possibilities. Be specific to the topic.",
  "questions": [
    {
      "id": "q1",
      "question": "The question text — conversational, probing, specific to the topic",
      "why": "Brief note on how this shapes the ${contentLabel} (shown as helper text)"
    }
  ]
}

Generate 5-7 questions. Order them from most natural to most provocative. Make every question specific to this topic and content format, not generic questions.
${NO_DASH_RULE}`
          },
          {
            role: "user",
            content: `I want to create a ${contentLabel} from this opportunity: "${title}"`
          }
        ],
        jsonMode: true,
        maxTokens: 2048,
      });

      const result = parseAIJson(resultText);

      console.log(`[thought-leadership] Generated ${result.questions?.length || 0} content questions for ${contentType}: "${title}"`);
      res.json(result);
    } catch (err) {
      console.error("Error generating content questions:", err);
      res.status(500).json({ error: "Failed to generate questions" });
    }
  });

  const saveToDriveSchema = z.object({
    type: z.enum(["blog", "webinar", "presentation"]),
    documentName: z.string().min(1),
    content: z.string().min(1),
    slidesContent: z.string().optional(),
  });

  async function generateBlogContent(params: { title: string; thesis: string; demandbase_angle: string; talking_points: string[]; audience: string; timeliness: string; refinement?: string; previousContent?: string; creatorAnswers?: { question: string; answer: string }[]; model?: string }) {
    const { title, thesis, demandbase_angle, talking_points, audience, timeliness, refinement, previousContent, creatorAnswers, model: requestedModel } = params;
    const selectedModel = resolveModel(requestedModel);
    const dbContext = await getDemandbaseContext();

    const systemPrompt = `You are a senior content strategist at Demandbase writing a blog post for demandbase.com/blog/. 

DEMANDBASE CONTEXT:
${dbContext.substring(0, 2000)}

Write a comprehensive, authoritative blog post following Demandbase's blog style:

STYLE GUIDELINES (based on demandbase.com/blog/):
- Title should be clear, specific, and include actionable value (e.g., "Understanding CTV in B2B advertising: A strategic playbook for 2026")
- Open with a compelling hook that frames the industry shift or problem
- Use H2 headers to break the post into 4-6 major sections
- Include H3 subheaders within longer sections
- Mix short and medium paragraphs — never walls of text
- Use bullet points and numbered lists for scannable content
- Include data points, statistics, and industry references where possible
- Bold key phrases and important concepts
- Write in an authoritative but conversational tone — expert sharing insights, not lecturing
- Include practical advice and actionable takeaways
- End with a clear conclusion and call-to-action
- Target length: 1,500-2,500 words
- Weave in Demandbase's perspective naturally — don't hard-sell but show how Demandbase's approach (ABM, account intelligence, buying groups) relates to the topic
- Write for a B2B marketing/sales audience: CMOs, VPs of Marketing, demand gen leaders, revenue operations

FORMAT:
Use markdown formatting:
# Title
## Section headers
### Subsection headers
**Bold for emphasis**
- Bullet points for lists
1. Numbered lists for steps

Do NOT include meta descriptions, author names, or publishing dates. Just the blog content itself.

${CITATION_RULES_INLINE}
${NO_DASH_RULE}`;

    const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `Write a Demandbase blog post based on this thought leadership opportunity:

Title: ${title}
Target Audience: ${audience || "B2B marketing and sales executives"}
Core Thesis: ${thesis}
Demandbase Angle: ${demandbase_angle || "Account-based go-to-market strategy"}
Timeliness: ${timeliness || "Current market trends"}
Key Talking Points:
${(talking_points || []).map((tp: string) => `- ${tp}`).join("\n")}${creatorAnswers && creatorAnswers.length > 0 ? `

CREATOR'S PERSPECTIVE AND INPUTS (incorporate these specific viewpoints, examples, and language into the blog — this should sound like the creator, not a generic writer):
${creatorAnswers.map(a => `Q: ${a.question}\nA: ${a.answer}`).join("\n\n")}` : ""}`
      },
    ];

    if (refinement && previousContent) {
      messages.push({ role: "assistant", content: previousContent });
      messages.push({ role: "user", content: `Please revise the blog post with the following feedback:\n\n${refinement}` });
    }

    return await chatCompletion({
      model: selectedModel,
      messages,
      maxTokens: 8192,
    });
  }

  app.post("/api/thought-leadership/generate-blog", async (req, res) => {
    try {
      const parsed = generatePreviewSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
      }
      const content = await generateBlogContent(parsed.data);
      console.log(`[thought-leadership] Blog preview generated (${content.length} chars)`);
      res.json({ content });
    } catch (err) {
      console.error("Error generating blog preview:", err);
      res.status(500).json({ error: "Failed to generate blog preview" });
    }
  });

  app.post("/api/thought-leadership/create-blog", async (req, res) => {
    try {
      const parsed = thoughtLeadershipContentSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
      }
      const blogContent = await generateBlogContent(parsed.data);
      console.log(`[thought-leadership] Blog generated (${blogContent.length} chars). Creating Google Doc...`);

      const doc = await createGoogleDoc(
        parsed.data.documentName || `Blog: ${parsed.data.title}`,
        blogContent
      );

      console.log(`[thought-leadership] Blog doc created: ${doc.url}`);
      res.json({ url: doc.url, id: doc.id });
    } catch (err) {
      console.error("Error creating blog:", err);
      res.status(500).json({ error: "Failed to create blog" });
    }
  });

  type PresentationContent = {
    headline: string;
    storyArc: string;
    slideOutline: Array<{ slideNumber: number; title: string; keyPoints: string[]; speakerNotes: string }>;
    talkTrack: string;
  };

  function parsePresentationJSON(raw: string): PresentationContent {
    try {
      const parsed = JSON.parse(raw);
      return {
        headline: parsed.headline || "",
        storyArc: parsed.storyArc || "",
        slideOutline: Array.isArray(parsed.slideOutline) ? parsed.slideOutline : [],
        talkTrack: parsed.talkTrack || "",
      };
    } catch {
      // Fallback if JSON parse fails
      return { headline: "", storyArc: raw, slideOutline: [], talkTrack: raw };
    }
  }

  function slideOutlineToSlideData(slideOutline: PresentationContent["slideOutline"]) {
    return slideOutline.map(s => ({
      title: s.title,
      body: s.keyPoints.join("\n"),
      speakerNotes: s.speakerNotes,
    }));
  }

  async function generateWebinarContent(params: { title: string; thesis: string; demandbase_angle: string; talking_points: string[]; audience: string; timeliness: string; refinement?: string; previousContent?: string; creatorAnswers?: { question: string; answer: string }[]; model?: string }) {
    const { title, thesis, demandbase_angle, talking_points, audience, timeliness, refinement, previousContent, creatorAnswers, model: requestedModel } = params;
    const selectedModel = resolveModel(requestedModel);
    const dbContext = await getDemandbaseContext();

    const abstractMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
      {
        role: "system",
        content: `You are a senior content strategist at Demandbase creating a webinar abstract for a registration page.

DEMANDBASE CONTEXT:
${dbContext.substring(0, 2000)}

Write a professional webinar abstract that will drive registrations. Include:

# [Webinar Title]

## Overview
A compelling 2-3 paragraph overview that explains what attendees will learn and why it matters now.

## What You'll Learn
- 4-5 specific, valuable learning outcomes (bullet points)

## Who Should Attend
- 3-4 specific roles/personas this webinar is perfect for

## Speakers
- [Speaker Name], [Title], Demandbase — brief bio placeholder
- [Co-speaker/Guest Name], [Title], [Company] — brief bio placeholder

## Details
- Duration: 45-60 minutes (including Q&A)
- Format: Live webinar with interactive Q&A
- Level: [Beginner/Intermediate/Advanced based on audience]

## Registration CTA
A compelling 1-2 sentence call-to-action.

Write in a professional, compelling tone that conveys expertise and urgency.
${NO_DASH_RULE}
${CITATION_RULES_INLINE}`
      },
      {
        role: "user",
        content: `Create a webinar abstract for this thought leadership opportunity:

Title: ${title}
Target Audience: ${audience || "B2B marketing and sales executives"}
Core Thesis: ${thesis}
Demandbase Angle: ${demandbase_angle || "Account-based go-to-market strategy"}
Timeliness: ${timeliness || "Current market trends"}
Key Talking Points:
${(talking_points || []).map((tp: string) => `- ${tp}`).join("\n")}${creatorAnswers && creatorAnswers.length > 0 ? `

CREATOR'S PERSPECTIVE AND INPUTS (incorporate these specific viewpoints, examples, and language):
${creatorAnswers.map(a => `Q: ${a.question}\nA: ${a.answer}`).join("\n\n")}` : ""}`
      },
    ];

    const contentMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
      {
        role: "system",
        content: `You are a senior content strategist at Demandbase.

${getBrandGuidelinesContext()}

DEMANDBASE CONTEXT:
${dbContext.substring(0, 2000)}

${getPresentationSystemPrompt()}

This is a WEBINAR format: generate 15-20 slides in slideOutline. Include audience engagement moments and a Q&A framing slide in speaker notes.
${NO_DASH_RULE}`
      },
      {
        role: "user",
        content: `Create webinar content for:

Title: ${title}
Target Audience: ${audience || "B2B marketing and sales executives"}
Core Thesis: ${thesis}
Demandbase Angle: ${demandbase_angle || "Account-based go-to-market strategy"}
Timeliness: ${timeliness || "Current market trends"}
Key Talking Points:
${(talking_points || []).map((tp: string) => `- ${tp}`).join("\n")}${creatorAnswers && creatorAnswers.length > 0 ? `

CREATOR'S PERSPECTIVE AND INPUTS (weave these specific viewpoints, stories, and examples throughout):
${creatorAnswers.map(a => `Q: ${a.question}\nA: ${a.answer}`).join("\n\n")}` : ""}`
      },
    ];

    if (refinement && previousContent) {
      try {
        const prev = JSON.parse(previousContent);
        if (prev.abstract) {
          abstractMessages.push({ role: "assistant", content: prev.abstract });
          abstractMessages.push({ role: "user", content: `Please revise the webinar abstract with the following feedback:\n\n${refinement}` });
        }
        if (prev.talkTrack || prev.storyArc) {
          const prevContentStr = JSON.stringify({ headline: prev.headline, storyArc: prev.storyArc, slideOutline: prev.slideOutline, talkTrack: prev.talkTrack });
          contentMessages.push({ role: "assistant", content: prevContentStr });
          contentMessages.push({ role: "user", content: `Please revise the webinar content with the following feedback:\n\n${refinement}` });
        }
      } catch {}
    }

    const [abstractContent, contentRaw] = await Promise.all([
      chatCompletion({ model: selectedModel, messages: abstractMessages, maxTokens: 3000 }),
      chatCompletion({ model: selectedModel, messages: contentMessages, maxTokens: 12000 }),
    ]);

    const presentationContent = parsePresentationJSON(contentRaw);
    return { abstract: abstractContent, ...presentationContent };
  }

  async function getRelevantArticleContext(title: string, thesis: string, talkingPoints: string[]): Promise<string> {
    try {
      const searchTerms = [title, ...talkingPoints.slice(0, 3)].join(" ");
      const keywords = searchTerms.split(/\s+/).filter(w => w.length > 3).slice(0, 8);
      const result = await storage.getFilteredArticles({
        search: keywords.slice(0, 4).join(" "),
        limit: 15,
      });
      if (!result.articles || result.articles.length === 0) return "";

      const relevant = result.articles.filter(a => !a.dismissed).slice(0, 10);
      let context = "\n\nREAL ARTICLE EVIDENCE (use these as source material for data points and examples):\n";
      for (const a of relevant) {
        context += `\n- "${a.title}" (${a.sourceName || "unknown source"}, ${a.publishedAt ? new Date(a.publishedAt).toLocaleDateString() : "recent"})`;
        if (a.description) {
          const cleanDesc = a.description.replace(/<[^>]*>/g, '').substring(0, 200);
          context += `\n  Summary: ${cleanDesc}`;
        }
      }
      context += "\n\nIMPORTANT: Cite these real articles when making claims. Reference them by source name and date in NOTES sections. Prefer real data from these articles over generic industry statistics.";
      return context;
    } catch (err) {
      console.error("Error fetching article context for presentation:", err);
      return "";
    }
  }

  async function getRelevantKBContext(title: string, thesis: string): Promise<string> {
    try {
      const entries = await storage.getActiveKnowledgeByCategory();
      if (Object.keys(entries).length === 0) return "";

      const searchLower = (title + " " + thesis).toLowerCase();
      const allEntries = Object.values(entries).flat();
      const scored = allEntries.map(entry => {
        const titleWords = entry.title.toLowerCase().split(/\s+/);
        const contentWords = (entry.content || "").toLowerCase().substring(0, 500).split(/\s+/);
        const matchScore = [...titleWords, ...contentWords].filter(w => searchLower.includes(w) && w.length > 3).length;
        return { entry, matchScore };
      }).filter(s => s.matchScore > 0).sort((a, b) => b.matchScore - a.matchScore).slice(0, 5);

      if (scored.length === 0) return "";

      let context = "\n\nKNOWLEDGE BASE CONTEXT (use this proprietary data to strengthen claims):\n";
      for (const { entry } of scored) {
        context += `\n### ${entry.title}\n${(entry.content || "").substring(0, 400)}\n`;
      }
      context += "\nLeverage knowledge base entries for proprietary frameworks, customer examples, and product-specific details. Reference them as internal Demandbase data.";
      return context;
    } catch (err) {
      console.error("Error fetching KB context for presentation:", err);
      return "";
    }
  }

  async function generatePresentationContent(params: { title: string; thesis: string; demandbase_angle: string; talking_points: string[]; audience: string; timeliness: string; targetAudience?: string; refinement?: string; previousContent?: string; creatorAnswers?: { question: string; answer: string }[]; model?: string }): Promise<PresentationContent> {
    const { title, thesis, demandbase_angle, talking_points, audience, timeliness, targetAudience, refinement, previousContent, creatorAnswers, model: requestedModel } = params;
    const selectedModel = resolveModel(requestedModel);
    const presentationAudience = targetAudience || audience;
    const dbContext = await getDemandbaseContext();

    const [articleContext, kbContext] = await Promise.all([
      getRelevantArticleContext(title, thesis, talking_points),
      getRelevantKBContext(title, thesis),
    ]);

    const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
      {
        role: "system",
        content: `You are a senior presentation strategist at Demandbase.

${getBrandGuidelinesContext()}

DEMANDBASE CONTEXT:
${dbContext.substring(0, 2000)}
${kbContext}
${articleContext}

${getPresentationSystemPrompt()}

TARGET AUDIENCE: ${presentationAudience}
Tailor every element — story arc, slide content, and talk track — specifically to this audience's language, challenges, and priorities.

This is a PRESENTATION format: generate 10-14 slides in slideOutline. Optimize for a clear narrative arc with a strong opening hook and a concrete closing ask.
${NO_DASH_RULE}`
      },
      {
        role: "user",
        content: `Create presentation content for:

Title: ${title}
Target Audience: ${presentationAudience}
Core Thesis: ${thesis}
Demandbase Angle: ${demandbase_angle || "Account-based go-to-market strategy"}
Timeliness: ${timeliness || "Current market trends"}
Key Talking Points:
${(talking_points || []).map((tp: string) => `- ${tp}`).join("\n")}${creatorAnswers && creatorAnswers.length > 0 ? `

CREATOR'S PERSPECTIVE AND INPUTS (weave these specific viewpoints, stories, and examples throughout):
${creatorAnswers.map(a => `Q: ${a.question}\nA: ${a.answer}`).join("\n\n")}` : ""}`
      },
    ];

    if (refinement && previousContent) {
      messages.push({ role: "assistant", content: previousContent });
      messages.push({ role: "user", content: `Please revise the presentation with the following feedback:\n\n${refinement}` });
    }

    const raw = await chatCompletion({ model: selectedModel, messages, maxTokens: 12000 });
    return parsePresentationJSON(raw);
  }

  app.post("/api/thought-leadership/generate-webinar", async (req, res) => {
    try {
      const parsed = generatePreviewSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
      }
      const result = await generateWebinarContent(parsed.data);
      console.log(`[thought-leadership] Webinar generated (${result.slideOutline.length} slides)`);
      res.json(result);
    } catch (err) {
      console.error("Error generating webinar:", err);
      res.status(500).json({ error: "Failed to generate webinar" });
    }
  });

  app.post("/api/thought-leadership/generate-presentation", async (req, res) => {
    try {
      const parsed = generateSlidesPreviewSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
      }
      const result = await generatePresentationContent(parsed.data);
      console.log(`[thought-leadership] Presentation generated (${result.slideOutline.length} slides)`);
      res.json(result);
    } catch (err) {
      console.error("Error generating presentation:", err);
      res.status(500).json({ error: "Failed to generate presentation" });
    }
  });

  app.post("/api/thought-leadership/save-to-drive", async (req, res) => {
    try {
      const parsed = saveToDriveSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
      }
      const { type, documentName, content, slidesContent } = parsed.data;

      if (type === "blog") {
        const doc = await createGoogleDoc(documentName, content);
        console.log(`[thought-leadership] Blog saved to Drive: ${doc.url}`);
        res.json({ url: doc.url, id: doc.id });
      } else if (type === "webinar") {
        let slideOutline: PresentationContent["slideOutline"] = [];
        try { slideOutline = JSON.parse(slidesContent || "[]"); } catch {}
        const slidesData = slideOutlineToSlideData(slideOutline);
        const baseName = documentName;
        const [doc, slides] = await Promise.all([
          createGoogleDoc(`Webinar Abstract: ${baseName}`, content),
          createGoogleSlides(`Webinar Deck: ${baseName}`, slidesData),
        ]);
        console.log(`[thought-leadership] Webinar saved to Drive — Doc: ${doc.url}, Slides: ${slides.url}`);
        res.json({ docUrl: doc.url, docId: doc.id, slidesUrl: slides.url, slidesId: slides.id });
      } else if (type === "presentation") {
        let slideOutline: PresentationContent["slideOutline"] = [];
        try { slideOutline = JSON.parse(content); } catch {}
        const slidesData = slideOutlineToSlideData(slideOutline);
        const slides = await createGoogleSlides(documentName, slidesData);
        console.log(`[thought-leadership] Presentation saved to Drive: ${slides.url}`);
        res.json({ url: slides.url, id: slides.id });
      }
    } catch (err) {
      console.error("Error saving to Drive:", err);
      res.status(500).json({ error: "Failed to save to Google Drive" });
    }
  });

  app.post("/api/thought-leadership/create-webinar", async (req, res) => {
    try {
      const parsed = thoughtLeadershipContentSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
      }
      const result = await generateWebinarContent(parsed.data);
      const slidesData = slideOutlineToSlideData(result.slideOutline);

      console.log(`[thought-leadership] Webinar content generated. Creating Google Doc (abstract) and Slides (deck)...`);

      const baseName = parsed.data.documentName || parsed.data.title;
      const [doc, slides] = await Promise.all([
        createGoogleDoc(`Webinar Abstract: ${baseName}`, result.abstract),
        createGoogleSlides(`Webinar Deck: ${baseName}`, slidesData),
      ]);

      console.log(`[thought-leadership] Webinar created — Doc: ${doc.url}, Slides: ${slides.url}`);
      res.json({ docUrl: doc.url, docId: doc.id, slidesUrl: slides.url, slidesId: slides.id });
    } catch (err) {
      console.error("Error creating webinar:", err);
      res.status(500).json({ error: "Failed to create webinar" });
    }
  });

  const presentationSchema = thoughtLeadershipContentSchema.extend({
    targetAudience: z.string().optional().default(""),
  });

  app.post("/api/thought-leadership/create-presentation", async (req, res) => {
    try {
      const parsed = presentationSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
      }
      const presentationResult = await generatePresentationContent(parsed.data);
      const slidesData = slideOutlineToSlideData(presentationResult.slideOutline);

      console.log(`[thought-leadership] Presentation generated (${slidesData.length} slides). Creating Google Slides...`);

      const slides = await createGoogleSlides(parsed.data.documentName || `Presentation: ${parsed.data.title}`, slidesData);

      console.log(`[thought-leadership] Presentation created: ${slides.url}`);
      res.json({ url: slides.url, id: slides.id });
    } catch (err) {
      console.error("Error creating presentation:", err);
      res.status(500).json({ error: "Failed to create presentation" });
    }
  });

  app.delete("/api/thought-leadership/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      await storage.deleteThoughtLeadership(id);
      res.json({ success: true });
    } catch (err) {
      console.error("Error deleting thought leadership:", err);
      res.status(500).json({ error: "Failed to delete" });
    }
  });

  app.get("/api/tl-documents", async (_req, res) => {
    try {
      const docs = await storage.getTlDocuments();
      res.json(docs.map(d => ({ ...d, extractedText: d.extractedText.substring(0, 200) + (d.extractedText.length > 200 ? "..." : "") })));
    } catch (err) {
      console.error("Error fetching TL documents:", err);
      res.status(500).json({ error: "Failed to fetch documents" });
    }
  });

  app.post("/api/tl-documents/upload-chunked", express.json(), async (req: any, res) => {
    try {
      const { filePath, filename, size, description } = req.body;
      if (!filePath || !filename) {
        return res.status(400).json({ error: "Missing filePath or filename" });
      }
      if (!description || description.trim().length < 5) {
        return res.status(400).json({ error: "Please provide a description of what this document is (at least 5 characters)" });
      }
      if (!fs.existsSync(filePath)) {
        return res.status(400).json({ error: "Uploaded file not found. Please try uploading again." });
      }
      const fileSize = size || fs.statSync(filePath).size;
      const jobId = `tl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      await storage.createProcessingJob({
        jobId, section: "tl-documents", filename, fileSize,
        status: "extracting_text", progress: 10, progressMessage: "Extracting text...",
      });

      res.json({ success: true, jobId, filename, status: "processing" });

      (async () => {
        try {
          console.log(`[tl-documents:${jobId}] Extracting text+images from ${filename} (${(fileSize / 1024).toFixed(0)}KB)...`);
          const { text, images } = await extractTextAndImagesFromFile(filePath, filename);
          cleanupTempFile(filePath);

          let fullText = text;
          if (images.length > 0) {
            await storage.updateProcessingJob(jobId, { status: "analyzing_images", progress: 40, progressMessage: `Analyzing ${images.length} images...` } as any);
            const imageResults = await analyzeImages(images, text.substring(0, 500), (done, total) => {
              storage.updateProcessingJob(jobId, { progress: 40 + Math.round((done / total) * 30), progressMessage: `Analyzing image ${done} of ${total}...` } as any);
            });
            for (const ir of imageResults) {
              fullText += `\n\n[Slide ${ir.slideNum} - Visual Content] ${ir.description}`;
            }
          }

          if (fullText.trim().length < 50) {
            await storage.updateProcessingJob(jobId, { status: "error", error: "Could not extract enough text from this document", completedAt: new Date() } as any);
            return;
          }

          await storage.updateProcessingJob(jobId, { status: "ai_processing", progress: 80, progressMessage: "Saving document..." } as any);
          const doc = await storage.createTlDocument({
            filename,
            description: description.trim(),
            extractedText: fullText.trim(),
            isActive: true,
          });

          await storage.updateProcessingJob(jobId, {
            status: "done", progress: 100, progressMessage: "Complete",
            result: JSON.stringify({ ...doc, extractedText: doc.extractedText.substring(0, 200) + "..." }),
            completedAt: new Date(),
          } as any);
        } catch (err: any) {
          console.error(`[tl-documents:${jobId}] Background processing error:`, err);
          cleanupTempFile(filePath);
          await storage.updateProcessingJob(jobId, { status: "error", error: err.message || "Failed to process document", completedAt: new Date() } as any);
        }
      })();
    } catch (err: any) {
      console.error("Error in chunked TL document upload:", err);
      res.status(500).json({ error: err.message || "Failed to process document" });
    }
  });

  app.post("/api/tl-documents/upload", (req: any, res, next) => {
    upload.single("file")(req, res, async (err: any) => {
      if (err) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(400).json({ error: "File is too large. Maximum size is 500MB." });
        }
        return res.status(400).json({ error: err.message || "Upload failed" });
      }
      try {
        if (!req.file) return res.status(400).json({ error: "No file uploaded" });
        const description = req.body?.description;
        if (!description || description.trim().length < 5) {
          return res.status(400).json({ error: "Please provide a description of what this document is (at least 5 characters)" });
        }

        const { originalname, path: filePath, size } = req.file;
        const jobId = `tl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        await storage.createProcessingJob({
          jobId, section: "tl-documents", filename: originalname, fileSize: size,
          status: "extracting_text", progress: 10, progressMessage: "Extracting text...",
        });

        res.json({ success: true, jobId, filename: originalname, status: "processing" });

        (async () => {
          try {
            console.log(`[tl-documents:${jobId}] Extracting text+images from ${originalname} (${(size / 1024).toFixed(0)}KB)...`);
            const { text, images } = await extractTextAndImagesFromFile(filePath, originalname);
            cleanupTempFile(filePath);

            let fullText = text;
            if (images.length > 0) {
              await storage.updateProcessingJob(jobId, { status: "analyzing_images", progress: 40, progressMessage: `Analyzing ${images.length} images...` } as any);
              const imageResults = await analyzeImages(images, text.substring(0, 500), (done, total) => {
                storage.updateProcessingJob(jobId, { progress: 40 + Math.round((done / total) * 30), progressMessage: `Analyzing image ${done} of ${total}...` } as any);
              });
              for (const ir of imageResults) {
                fullText += `\n\n[Slide ${ir.slideNum} - Visual Content] ${ir.description}`;
              }
            }

            console.log(`[tl-documents:${jobId}] Text extracted: ${fullText.length} chars`);
            if (fullText.trim().length < 50) {
              await storage.updateProcessingJob(jobId, { status: "error", error: "Could not extract enough text from this document", completedAt: new Date() } as any);
              return;
            }

            await storage.updateProcessingJob(jobId, { status: "ai_processing", progress: 80, progressMessage: "Saving document..." } as any);

            const doc = await storage.createTlDocument({
              filename: originalname,
              description: description.trim(),
              extractedText: fullText.trim(),
              isActive: true,
            });

            console.log(`[tl-documents:${jobId}] Uploaded "${doc.filename}" — ${fullText.length} chars extracted`);
            await storage.updateProcessingJob(jobId, {
              status: "done", progress: 100, progressMessage: "Complete",
              result: JSON.stringify({ ...doc, extractedText: doc.extractedText.substring(0, 200) + "..." }),
              completedAt: new Date(),
            } as any);
          } catch (err: any) {
            console.error(`[tl-documents:${jobId}] Background processing error:`, err);
            cleanupTempFile(filePath);
            await storage.updateProcessingJob(jobId, { status: "error", error: err.message || "Failed to process document", completedAt: new Date() } as any);
          }
        })();
      } catch (err: any) {
        console.error("Error uploading TL document:", err);
        res.status(500).json({ error: err.message || "Failed to process document" });
      }
    });
  });

  app.get("/api/tl-documents/upload-status/:jobId", async (req, res) => {
    const job = await storage.getProcessingJob(req.params.jobId);
    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }
    if (job.status === "done") {
      return res.json({ status: "done", ...(job.result ? JSON.parse(job.result) : {}) });
    }
    if (job.status === "error") {
      return res.json({ status: "error", error: job.error });
    }
    res.json({ status: "processing", progress: job.progress, progressMessage: job.progressMessage });
  });

  app.patch("/api/tl-documents/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      const { isActive, description } = req.body;
      const updateData: Record<string, any> = {};
      if (typeof isActive === "boolean") updateData.isActive = isActive;
      if (typeof description === "string" && description.trim().length >= 5) updateData.description = description.trim();
      if (Object.keys(updateData).length === 0) return res.status(400).json({ error: "No valid fields to update" });
      const updated = await storage.updateTlDocument(id, updateData);
      if (!updated) return res.status(404).json({ error: "Document not found" });
      res.json({ ...updated, extractedText: updated.extractedText.substring(0, 200) + "..." });
    } catch (err) {
      console.error("Error updating TL document:", err);
      res.status(500).json({ error: "Failed to update document" });
    }
  });

  app.delete("/api/tl-documents/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      await storage.deleteTlDocument(id);
      res.json({ success: true });
    } catch (err) {
      console.error("Error deleting TL document:", err);
      res.status(500).json({ error: "Failed to delete document" });
    }
  });

  app.get("/api/trends", async (_req, res) => {
    try {
      const trends = await storage.getTrendAnalyses(10);
      res.json(trends);
    } catch (err) {
      console.error("Error fetching trends:", err);
      res.status(500).json({ error: "Failed to fetch trends" });
    }
  });

  app.get("/api/trends/latest", async (_req, res) => {
    try {
      const latest = await storage.getLatestTrendAnalysis();
      res.json(latest || null);
    } catch (err) {
      console.error("Error fetching latest trend:", err);
      res.status(500).json({ error: "Failed to fetch latest trend" });
    }
  });

  app.get("/api/trends/snapshots", async (_req, res) => {
    try {
      const snapshots = await storage.getTrendSnapshots(20);
      res.json(snapshots);
    } catch (err) {
      console.error("Error fetching trend snapshots:", err);
      res.status(500).json({ error: "Failed to fetch trend snapshots" });
    }
  });

  app.get("/api/trends/snapshots/latest", async (_req, res) => {
    try {
      const latest = await storage.getLatestTrendSnapshot();
      res.json(latest || null);
    } catch (err) {
      console.error("Error fetching latest snapshot:", err);
      res.status(500).json({ error: "Failed to fetch latest snapshot" });
    }
  });

  app.delete("/api/trends/snapshots/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      await storage.deleteTrendSnapshot(id);
      res.json({ success: true });
    } catch (err) {
      console.error("Error deleting snapshot:", err);
      res.status(500).json({ error: "Failed to delete snapshot" });
    }
  });

  app.get("/api/trends/watchlist", async (_req, res) => {
    try {
      const items = await storage.getTrendWatchlist();
      res.json(items);
    } catch (err) {
      console.error("Error fetching watchlist:", err);
      res.status(500).json({ error: "Failed to fetch watchlist" });
    }
  });

  app.post("/api/trends/watchlist", async (req, res) => {
    try {
      const parsed = insertTrendWatchlistSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid data", details: parsed.error.flatten() });
      }
      const item = await storage.createTrendWatchlistItem({
        ...parsed.data,
        trendName: parsed.data.trendName.trim(),
      });
      res.json(item);
    } catch (err) {
      console.error("Error creating watchlist item:", err);
      res.status(500).json({ error: "Failed to add to watchlist" });
    }
  });

  const updateWatchlistSchema = z.object({
    notes: z.string().nullable().optional(),
    isActive: z.boolean().optional(),
    category: z.string().nullable().optional(),
  });

  app.patch("/api/trends/watchlist/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      const parsed = updateWatchlistSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid data", details: parsed.error.flatten() });
      }
      const updated = await storage.updateTrendWatchlistItem(id, parsed.data);
      if (!updated) return res.status(404).json({ error: "Not found" });
      res.json(updated);
    } catch (err) {
      console.error("Error updating watchlist item:", err);
      res.status(500).json({ error: "Failed to update watchlist item" });
    }
  });

  app.delete("/api/trends/watchlist/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      await storage.deleteTrendWatchlistItem(id);
      res.json({ success: true });
    } catch (err) {
      console.error("Error deleting watchlist item:", err);
      res.status(500).json({ error: "Failed to delete watchlist item" });
    }
  });

  app.get("/api/trends/watchlist/:id/history", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      const watchlist = await storage.getTrendWatchlist();
      const item = watchlist.find(w => w.id === id);
      if (!item) return res.status(404).json({ error: "Not found" });

      const snapshots = await storage.getTrendSnapshots(50);
      const history: Array<{
        snapshotId: number;
        date: string;
        momentum: string;
        confidence: number;
        articleCount: number;
        description: string;
        days: number;
      }> = [];

      const trendNameLower = item.trendName.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
      const trendWords = trendNameLower.split(/\s+/).filter(w => w.length > 0);
      const significantWords = trendWords.filter(w => w.length > 3);
      const useExactSubstring = significantWords.length === 0;

      for (const snap of snapshots) {
        try {
          const trends = JSON.parse(snap.trends || "[]");
          const match = trends.find((t: any) => {
            if (!t.name) return false;
            const nameLower = t.name.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
            if (nameLower === trendNameLower) return true;
            if (nameLower.includes(trendNameLower) || trendNameLower.includes(nameLower)) return true;
            if (useExactSubstring) return false;
            const matchingWords = significantWords.filter(w => nameLower.includes(w));
            return matchingWords.length >= Math.ceil(significantWords.length * 0.6);
          });
          if (match) {
            history.push({
              snapshotId: snap.id,
              date: (snap.createdAt as unknown as string),
              momentum: match.momentum || "stable",
              confidence: match.confidence || 0,
              articleCount: match.articleIds?.length || 0,
              description: match.description || "",
              days: snap.days,
            });
          }
        } catch {}
      }

      res.json({ item, history });
    } catch (err) {
      console.error("Error fetching watchlist history:", err);
      res.status(500).json({ error: "Failed to fetch history" });
    }
  });

  app.post("/api/trends/generate-snapshot", async (req, res) => {
    try {
      const selectedModel = resolveModel(req.body?.model);
      const rawDays = parseInt(req.body?.days);
      const days = [7, 30, 90].includes(rawDays) ? rawDays : 30;

      const since = new Date();
      since.setDate(since.getDate() - days);
      const recentArticles = await storage.getArticlesByDateRange(since, new Date());

      if (recentArticles.length === 0) {
        return res.status(400).json({ error: "No articles available for the selected time period" });
      }

      const MAX_ARTICLES = 400;
      const articles = recentArticles.length > MAX_ARTICLES
        ? recentArticles.slice(0, MAX_ARTICLES)
        : recentArticles;

      console.log(`[snapshot] Analyzing ${articles.length} of ${recentArticles.length} articles from last ${days} days with ${selectedModel}...`);

      const articleLines = articles.map(a =>
        `[${a.id}] ${a.title} | ${a.sourceName || "Unknown"} | ${a.category || "General"} | ${a.publishedAt ? new Date(a.publishedAt).toLocaleDateString() : "recent"}`
      ).join("\n");

      const result = await chatCompletion({
        model: selectedModel,
        messages: [
          {
            role: "system",
            content: `You are an expert analyst in B2B marketing, sales technology, and go-to-market strategy. You deeply understand ABM/ABX, demand generation, revenue operations, sales enablement, customer success, MarTech/SalesTech stacks, CDPs, intent data, buying groups, pipeline acceleration, AI agents in GTM, and competitive dynamics among vendors like Demandbase, 6sense, ZoomInfo, HubSpot, Salesforce, and others.

Analyze the provided article titles and metadata to produce a comprehensive trend snapshot. You must identify REAL, SPECIFIC trends (not generic words). A trend is a directional movement or shift in the market, like "AI agents replacing manual SDR outreach sequences" or "CDPs converging with data warehouses for unified customer profiles", not single words like "AI" or "data".

Return valid JSON with this exact structure:
{
  "trends": [
    {
      "name": "Short trend name (5-10 words)",
      "description": "2-3 sentence explanation of what is happening and why it matters to B2B GTM leaders",
      "category": "one of: AI & Automation | Sales Strategy | MarTech Stack | Data & Privacy | Buyer Behavior | Revenue Operations | Competitive Landscape | Content & Personalization",
      "momentum": "rising" | "stable" | "declining",
      "confidence": 0.0-1.0,
      "articleIds": [list of article IDs that support this trend]
    }
  ],
  "emergingSignals": [
    {
      "name": "Signal name",
      "description": "Brief explanation of this weak/early signal",
      "category": "same categories as above"
    }
  ],
  "companySentiment": [
    {
      "company": "Company Name",
      "sentiment": -1.0 to 1.0,
      "label": "positive" | "negative" | "neutral" | "mixed",
      "trending": "improving" | "declining" | "stable",
      "reason": "Brief explanation of sentiment drivers"
    }
  ]
}

Guidelines:
- Identify 8-12 specific, actionable trends (not generic topics)
- Include 4-6 emerging signals (weaker patterns worth monitoring)
- Analyze sentiment for 10-15 most-mentioned companies
- Every trend must reference specific article IDs from the data
- Focus on what a B2B marketing/sales executive would act on
- Be specific: "HubSpot expanding AI agent capabilities for sales teams" not "AI in CRM"
${NO_DASH_RULE}`
          },
          {
            role: "user",
            content: `Analyze these ${articles.length} article titles from the last ${days} days (out of ${recentArticles.length} total) and produce a trend snapshot:\n\n${articleLines}`
          }
        ],
        jsonMode: true,
      });

      const parsed = parseAIJson(result);
      const trends = parsed.trends || [];
      const emergingSignals = parsed.emergingSignals || [];
      const companySentiment = parsed.companySentiment || [];

      const saved = await storage.createTrendSnapshot({
        trends: JSON.stringify(trends),
        emergingSignals: JSON.stringify(emergingSignals),
        companySentiment: JSON.stringify(companySentiment),
        articleCount: recentArticles.length,
        days,
        model: selectedModel,
      });

      res.json({
        id: saved.id,
        trends,
        emergingSignals,
        companySentiment,
        articleCount: recentArticles.length,
        days,
        model: selectedModel,
        createdAt: saved.createdAt,
      });
    } catch (err: any) {
      console.error("Error generating trend snapshot:", err);
      res.status(500).json({ error: err.message || "Failed to generate trend snapshot" });
    }
  });

  app.get("/api/chat/sessions", async (_req, res) => {
    try {
      const sessions = await storage.getChatSessions();
      res.json(sessions);
    } catch (err) {
      console.error("Error fetching chat sessions:", err);
      res.status(500).json({ error: "Failed to fetch chat sessions" });
    }
  });

  app.post("/api/chat/sessions", async (req, res) => {
    try {
      const { title, model } = req.body;
      const session = await storage.createChatSession({ title: title || "New Chat", model: model || null });
      res.json(session);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to create chat session" });
    }
  });

  app.patch("/api/chat/sessions/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { title } = req.body;
      if (!title || typeof title !== "string") {
        return res.status(400).json({ error: "Title is required" });
      }
      const updated = await storage.updateChatSession(id, { title: title.trim() });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to update chat session" });
    }
  });

  app.delete("/api/chat/sessions/:id", async (req, res) => {
    try {
      await storage.deleteChatSession(parseInt(req.params.id));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to delete chat session" });
    }
  });

  app.get("/api/chat/messages", async (req, res) => {
    try {
      const sessionId = req.query.sessionId ? parseInt(req.query.sessionId as string) : undefined;
      if (sessionId) {
        const messages = await storage.getChatMessagesBySession(sessionId);
        res.json(messages);
      } else {
        const messages = await storage.getChatMessages(100);
        res.json(messages);
      }
    } catch (err) {
      console.error("Error fetching chat messages:", err);
      res.status(500).json({ error: "Failed to fetch chat messages" });
    }
  });

  app.delete("/api/chat/messages", async (req, res) => {
    try {
      const sessionId = req.query.sessionId ? parseInt(req.query.sessionId as string) : undefined;
      if (sessionId) {
        await storage.clearChatMessagesBySession(sessionId);
      } else {
        await storage.clearChatMessages();
      }
      res.status(204).send();
    } catch (err) {
      console.error("Error clearing chat:", err);
      res.status(500).json({ error: "Failed to clear chat" });
    }
  });

  app.post("/api/chat", async (req, res) => {
    try {
      const { message, sessionId, model: requestedModel } = req.body;
      const selectedModel = resolveModel(requestedModel);
      if (!message || typeof message !== "string") {
        return res.status(400).json({ error: "Message is required" });
      }

      await storage.createChatMessage({ role: "user", content: message, sessionId: sessionId || null });

      const [stats, relevantArticles, latestTrend, latestBriefing, recentTrends, chatHistory, analystCompanyNamesRows, thoughtLeadershipEntries] = await Promise.all([
        getSearchStats(),
        searchRelevantArticles(message, 40),
        storage.getLatestTrendAnalysis(),
        storage.getLatestBriefing(),
        storage.getTrendAnalyses(3),
        sessionId ? storage.getChatMessagesBySession(sessionId) : storage.getChatMessages(20),
        pool.query("SELECT id, company_name, ticker FROM company_analyses ORDER BY created_at DESC LIMIT 50"),
        storage.getThoughtLeadership(5),
      ]);

      const articleCount = relevantArticles.length;
      const articleContext = relevantArticles.map(a =>
        `[${a.category || "General"}] "${a.title}" (${a.sourceName || "Unknown"}, ${a.publishedAt ? new Date(a.publishedAt).toLocaleDateString() : "recent"}): ${a.description?.substring(0, 400) || "No description"}`
      ).join("\n");

      let trendContext = "";
      if (latestTrend) {
        trendContext = `\n\n=== LATEST TREND ANALYSIS (generated ${new Date(latestTrend.createdAt).toLocaleDateString()}) ===
Title: ${latestTrend.title}
Key Themes: ${latestTrend.keyThemes.join(", ")}
Summary: ${latestTrend.summary}
Full Analysis:
${latestTrend.insights}
Articles Analyzed: ${latestTrend.articleIds?.length || 0}`;

        if (latestTrend.visualData) {
          try {
            const vd = JSON.parse(latestTrend.visualData);
            if (vd.emergingSignals?.length) {
              trendContext += `\n\nEmerging Signals (AI Predictions):
${vd.emergingSignals.map((s: any) => `- ${s.name} (${s.type}, ${s.confidence}% confidence): ${s.description}. Related companies: ${s.relatedCompanies?.join(", ") || "none"}`).join("\n")}`;
            }
            if (vd.topCompanies?.length) {
              trendContext += `\n\nTop Companies Mentioned:
${vd.topCompanies.map((c: any) => `- ${c.name}: ${c.mentions} mentions, sentiment: ${c.sentiment}`).join("\n")}`;
            }
            if (vd.trendDirection?.length) {
              trendContext += `\n\nTrend Momentum:
${vd.trendDirection.map((t: any) => `- ${t.topic}: ${t.direction} (momentum: ${t.momentum}/100)`).join("\n")}`;
            }
            if (vd.categoryBreakdown?.length) {
              trendContext += `\n\nCoverage by Category:
${vd.categoryBreakdown.map((c: any) => `- ${c.category}: ${c.percentage}% (${c.articleCount} articles)`).join("\n")}`;
            }
          } catch {}
        }
      }

      if (recentTrends.length > 1) {
        trendContext += `\n\n=== PREVIOUS TREND ANALYSES ===`;
        for (const t of recentTrends.slice(1)) {
          trendContext += `\n- "${t.title}" (${new Date(t.createdAt).toLocaleDateString()}): Key themes: ${t.keyThemes.join(", ")}. ${t.summary.substring(0, 300)}...`;
        }
      }

      let briefingContext = "";
      if (latestBriefing) {
        briefingContext = `\n\n=== LATEST DAILY BRIEFING (${latestBriefing.period}, generated ${new Date(latestBriefing.createdAt).toLocaleDateString()}) ===
Title: ${latestBriefing.title}
Executive Summary: ${latestBriefing.executiveSummary}
Articles Covered: ${latestBriefing.articleCount}
Sections: ${latestBriefing.sections.substring(0, 2000)}`;
      }

      const analystConversationText = [
        message,
        ...(chatHistory || []).map((m: any) => m.content || ""),
      ].join(" ").toLowerCase();

      const analystMatchedIds = analystCompanyNamesRows.rows
        .filter((row: any) => {
          const name = row.company_name.toLowerCase();
          const ticker = row.ticker ? row.ticker.toLowerCase() : "";
          return analystConversationText.includes(name) ||
            (ticker && analystConversationText.includes(ticker));
        })
        .map((row: any) => row.id);

      let companyAnalysisContext = "";
      if (analystMatchedIds.length > 0) {
        const ph = analystMatchedIds.map((_: any, i: number) => `$${i + 1}`).join(",");
        const matchedAnalyses = await pool.query(
          `SELECT company_name, ticker, financial_outlook, strategic_direction, growth_signals, risks_and_challenges, demandbase_opportunity, created_at FROM company_analyses WHERE id IN (${ph})`,
          analystMatchedIds
        );
        if (matchedAnalyses.rows.length > 0) {
          companyAnalysisContext = `\n\n=== COMPANY ANALYSES (${matchedAnalyses.rows.length} relevant companies) ===
${matchedAnalyses.rows.map((a: any) => `\n--- ${a.company_name}${a.ticker ? ` ($${a.ticker})` : ""} (analyzed ${new Date(a.created_at).toLocaleDateString()}) ---
Financial Outlook: ${a.financial_outlook.substring(0, 500)}
Strategic Direction: ${a.strategic_direction.substring(0, 400)}
Growth Signals: ${a.growth_signals.substring(0, 300)}
Risks: ${a.risks_and_challenges.substring(0, 300)}
Demandbase Opportunity: ${a.demandbase_opportunity.substring(0, 400)}`).join("\n")}`;
        }
      } else {
        const availableCompanies = analystCompanyNamesRows.rows.map((r: any) => r.company_name).join(", ");
        if (availableCompanies) {
          companyAnalysisContext = `\n\n=== COMPANY ANALYSES AVAILABLE ===
You have detailed analyses available for: ${availableCompanies}. If the user asks about any of these companies, let them know you have in-depth research available.`;
        }
      }

      let thoughtLeadershipContext = "";
      if (thoughtLeadershipEntries.length > 0) {
        thoughtLeadershipContext = `\n\n=== THOUGHT LEADERSHIP ANALYSES (${thoughtLeadershipEntries.length} recent reports) ===
${thoughtLeadershipEntries.map(tl => `\n--- "${tl.title}" (generated ${new Date(tl.createdAt).toLocaleDateString()}, based on ${tl.articleCount} articles) ---
Summary: ${tl.summary.substring(0, 600)}
Opportunities: ${tl.opportunities.substring(0, 1000)}`).join("\n")}`;
      }

      const historyMessages = chatHistory.slice(-18).map(m => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const streamMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
          {
            role: "system",
            content: `You are an expert B2B Marketing and Sales Technology analyst embedded in a news intelligence platform. You have access to multiple data sources:

1. NEWS FEED: A database of ${stats.total} total articles from MarTech/SalesTech sources. The ${articleCount} most relevant to the user's query are provided below.
2. TREND ANALYSES: AI-generated trend reports that synthesize all articles into key themes, emerging signals, company mentions, and momentum data.
3. DAILY BRIEFINGS: Executive intelligence briefings summarizing recent developments.
4. COMPANY ANALYSES: In-depth AI-generated research on specific public companies including financial outlook, strategic direction, growth signals, risks, and Demandbase opportunity/competitive assessments.
5. THOUGHT LEADERSHIP: AI-generated analyses identifying thought leadership opportunities, content angles, and strategic positioning recommendations based on current market dynamics.

You can answer questions about:
- What's happening NOW in the market (from the news feed)
- WHERE the market has been and key patterns (from trend analyses and briefings)
- WHERE the market is heading next (from emerging signals, trend momentum, and your analysis)
- Specific companies, technologies, or themes across all data sources
- Company-specific intelligence: financial health, strategy, growth signals, risks, and whether they are a Demandbase opportunity or competitor (from company analyses)
- Thought leadership opportunities: content angles, positioning strategies, and how to leverage market trends for executive visibility (from thought leadership analyses)
- The visual/chart data including top companies mentioned, emerging signals with confidence scores, trend momentum, and category breakdowns

RELEVANT ARTICLES FROM NEWS FEED:
${articleContext}
${trendContext}
${briefingContext}
${companyAnalysisContext}
${thoughtLeadershipContext}

Guidelines:
- When discussing trends, reference the trend analysis data — cite specific emerging signals, momentum scores, and company mentions
- When discussing briefings, reference the executive summary and key sections
- When discussing specific companies, reference the company analysis data if available — cite financial outlook, strategic direction, and Demandbase opportunity assessment
- When discussing thought leadership or content strategy, reference the thought leadership analyses — cite specific opportunities, content angles, and positioning recommendations
- Reference specific articles and sources when relevant to the question
- Provide actionable insights for B2B marketers and sales leaders
- When asked about predictions or "where things are going," use the emerging signals confidence scores and trend momentum data to support your analysis
- Compare current articles against trend analyses to identify acceleration or deceleration of themes
- When asked about content opportunities or executive positioning, draw from thought leadership analyses to suggest specific angles backed by market data
- Use markdown formatting for structure (headers, bold, lists) when helpful
- If asked about something not covered in any data source, say so honestly
${NO_DASH_RULE}`
          },
          ...historyMessages,
        ];

      const stream = chatStream({ model: selectedModel, messages: streamMessages, maxTokens: 2048 });

      let fullResponse = "";
      let clientDisconnected = false;

      res.on("close", () => {
        clientDisconnected = true;
      });

      for await (const content of stream) {
        if (clientDisconnected) break;
        if (content) {
          fullResponse += content;
          res.write(`data: ${JSON.stringify({ content })}\n\n`);
        }
      }

      if (fullResponse && !clientDisconnected) {
        await storage.createChatMessage({ role: "assistant", content: fullResponse, sessionId: sessionId || null });
        if (sessionId) await storage.updateChatSession(sessionId, {});
        res.write(`data: [DONE]\n\n`);
      } else if (fullResponse) {
        await storage.createChatMessage({ role: "assistant", content: fullResponse, sessionId: sessionId || null });
        if (sessionId) await storage.updateChatSession(sessionId, {});
      }
      res.end();
    } catch (err) {
      console.error("Error in chat:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to process chat" });
      } else {
        res.write(`data: ${JSON.stringify({ error: "Stream interrupted" })}\n\n`);
        res.end();
      }
    }
  });

  app.post("/api/enablement/questions", async (req, res) => {
    try {
      const schema = z.object({
        message: z.string().min(1),
        contentType: z.string().optional(),
        model: z.string().optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
      }
      const { message, contentType, model: requestedModel } = parsed.data;
      const selectedModel = resolveModel(requestedModel);

      const [dbContext, latestTrend, enablementThoughtLeadership, enablementAnalysesRows] = await Promise.all([
        getDemandbaseContext(),
        storage.getLatestTrendAnalysis(),
        storage.getThoughtLeadership(5),
        pool.query("SELECT company_name, ticker, financial_outlook, strategic_direction FROM company_analyses ORDER BY created_at DESC LIMIT 10"),
      ]);

      let trendHint = "";
      if (latestTrend) {
        trendHint = `\nRecent market trend: "${latestTrend.title}" — themes: ${(latestTrend.keyThemes || []).join(", ")}`;
      }
      let companyHint = "";
      if (enablementAnalysesRows.rows.length > 0) {
        companyHint = `\nCompanies researched: ${enablementAnalysesRows.rows.map((a: any) => a.company_name).join(", ")}`;
      }
      let thoughtLeadershipHint = "";
      if (enablementThoughtLeadership.length > 0) {
        thoughtLeadershipHint = `\nRecent thought leadership: ${enablementThoughtLeadership.map(tl => `"${tl.title}"`).join(", ")}`;
      }

      const contentTypeSpecific: Record<string, string> = {
        "battle-card": `- "What's the #1 reason deals are lost to this competitor?"
- "Which Demandbase capability is hardest to position against them?"
- "What does the prospect currently believe about this competitor vs Demandbase?"`,
        "talk-track": `- "Walk me through the meeting flow — who's in the room and what's the desired next step?"
- "What discovery questions have worked well in past conversations?"`,
        "deck": `- "Is this a standalone presentation or a leave-behind? Will someone present it or will it be read async?"
- "Any specific slides you already have in mind (like a competitive comparison or ROI summary)?"
- "How many slides feels right — a tight 5-slide punch or a comprehensive 10-15 slide deep dive?"`,
        "email-sequence": `- "What triggered this outreach — intent signal, event, content download?"
- "How aggressive should the cadence be?"
- "What's the desired CTA — meeting, demo, content download?"`,
        "roi-story": `- "What metrics does this buyer actually track — pipeline, CAC, revenue per account?"
- "Do you have a specific customer win in mind to anchor on?"`,
        "competitive-intel": `- "What's the prospect currently evaluating — a full rip-and-replace, or adding alongside their existing stack?"
- "What competitive claims have you heard that are hardest to counter?"`,
        "one-pager": `- "Will this be emailed as an attachment, handed out in person, or embedded in a follow-up?"
- "What's the one action you want the reader to take after reading this?"`,
      };

      const typeSpecificGuidance = contentType && contentTypeSpecific[contentType]
        ? `\n\nCONTENT-TYPE SPECIFIC — since they're requesting a "${contentType}", consider asking:\n${contentTypeSpecific[contentType]}`
        : "";

      const resultText = await chatCompletion({
        model: selectedModel,
        messages: [
          {
            role: "system",
            content: `You are a senior Field Enablement strategist at Demandbase conducting a creative briefing. The user just described what they need. Generate 4-6 dynamic, probing questions that will help you create exactly the right deliverable.

DEMANDBASE CONTEXT:
${dbContext.substring(0, 1500)}
${trendHint}${companyHint}${thoughtLeadershipHint}

YOUR QUESTIONS SHOULD COVER:
1. **Audience & Context** (1-2 questions): Who will see this, what's the situation, what do they currently believe?
2. **Message & Strategy** (1-2 questions): What's the core argument, what proof matters, any competitor in play?
3. **Creative Direction** (1-2 questions): Tone, length, specific sections to include or exclude?
${typeSpecificGuidance}

CRITICAL RULES:
- Tailor every question to the SPECIFIC thing they asked for — don't ask generic questions
- Reference real market data, competitors, or trends when relevant
- Be conversational — you're a creative partner, not a form
- Questions should unlock information that will directly improve the output

Respond in JSON format:
{
  "acknowledgment": "A brief 1-2 sentence reaction showing you understand what they're trying to accomplish and are excited to help.",
  "questions": [
    {
      "id": "q1",
      "question": "The actual question text — specific to their request",
      "why": "Brief note on why this matters for the final output"
    }
  ]
}

Generate 4-6 questions. Order from most natural/easy to most strategic/challenging.
${NO_DASH_RULE}`
          },
          {
            role: "user",
            content: message
          }
        ],
        jsonMode: true,
        maxTokens: 2048,
      });

      let result;
      try {
        result = parseAIJson(resultText);
      } catch {
        console.error("[enablement] Failed to parse questions JSON:", resultText?.substring(0, 200));
        result = {
          acknowledgment: "Let me help you with that.",
          questions: [
            { id: "q1", question: "Who is the target audience for this content?", why: "Helps tailor the message" },
            { id: "q2", question: "What's the key message or outcome you want?", why: "Shapes the direction" },
            { id: "q3", question: "Are there any competitors or specific challenges to address?", why: "Adds competitive context" },
            { id: "q4", question: "What tone and length do you prefer?", why: "Sets creative direction" },
          ],
        };
      }
      console.log(`[enablement] Generated ${result.questions?.length || 0} initial questions`);
      res.json(result);
    } catch (err) {
      console.error("Error generating enablement questions:", err);
      res.status(500).json({ error: "Failed to generate questions" });
    }
  });

  app.post("/api/enablement/followup", async (req, res) => {
    try {
      const schema = z.object({
        message: z.string().min(1),
        contentType: z.string().optional(),
        previousQA: z.array(z.object({
          question: z.string(),
          answer: z.string(),
        })),
        round: z.number().int().min(1).optional().default(1),
        model: z.string().optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
      }
      const { message, contentType, previousQA, round, model: requestedModel } = parsed.data;
      const selectedModel = resolveModel(requestedModel);

      const answeredQA = previousQA.filter(qa => qa.answer.trim());
      if (answeredQA.length === 0) {
        return res.json({ ready: true, questions: [] });
      }

      if (round >= 3) {
        return res.json({ ready: true, questions: [] });
      }

      const [dbContext, latestTrend, enablementThoughtLeadership] = await Promise.all([
        getDemandbaseContext(),
        storage.getLatestTrendAnalysis(),
        storage.getThoughtLeadership(3),
      ]);

      const qaText = answeredQA.map(qa => `Q: ${qa.question}\nA: ${qa.answer}`).join("\n\n");

      let trendHint = "";
      if (latestTrend) {
        trendHint = `\nRecent market trend: "${latestTrend.title}" — themes: ${(latestTrend.keyThemes || []).join(", ")}`;
      }

      const followupResultText = await chatCompletion({
        model: selectedModel,
        messages: [
          {
            role: "system",
            content: `You are a senior Field Enablement strategist at Demandbase. You've been interviewing someone about their enablement content request and received their answers.

DEMANDBASE CONTEXT:
${dbContext.substring(0, 1500)}
${trendHint}

Review their answers carefully. Your job is to ask 2-4 sharp follow-up questions that:
- Dig deeper into the most interesting or specific things they said
- Challenge assumptions or ask for specific examples where they were vague
- Explore angles they may not have considered based on what they've shared
- Ask for the "so what" — what outcome or reaction they want from the audience
- Probe for specific stories, data, or competitive situations they hinted at but didn't fully share

DO NOT repeat questions they've already answered well. DO NOT ask generic questions. Every follow-up should directly reference something specific they said.

If their answers are already rich, detailed, and provide enough material to create compelling content, signal that you're ready to proceed.

Respond in JSON format:
{
  "ready": false,
  "reaction": "A brief 1-2 sentence reaction to their answers — what stood out, what was most interesting. Reference something specific they said.",
  "questions": [
    {
      "id": "f1",
      "question": "A follow-up question that directly references something they said",
      "why": "Why this follow-up matters for the final deliverable"
    }
  ]
}

If their answers are sufficiently rich and detailed, respond with:
{
  "ready": true,
  "reaction": "A brief affirming message that their input is great and you have what you need.",
  "questions": []
}

Be genuinely curious. These follow-ups should feel like a great strategist going deeper, not a form.
${NO_DASH_RULE}`
          },
          {
            role: "user",
            content: `ORIGINAL REQUEST:\n${message}${contentType ? `\nContent type: ${contentType}` : ""}\n\nTHEIR ANSWERS SO FAR:\n${qaText}`
          }
        ],
        jsonMode: true,
        maxTokens: 1500,
      });

      let result;
      try {
        result = JSON.parse(followupResultText);
      } catch {
        console.error("[enablement] Failed to parse follow-up JSON:", followupResultText.substring(0, 200));
        result = { ready: true, reaction: "I have enough to work with — let me generate your content.", questions: [] };
      }
      console.log(`[enablement] Follow-up round ${round}: ${result.ready ? "ready to generate" : `${result.questions?.length || 0} follow-up questions`}`);
      res.json(result);
    } catch (err) {
      console.error("Error generating enablement follow-up:", err);
      res.json({ ready: true, questions: [] });
    }
  });

  app.post("/api/enablement/chat", async (req, res) => {
    try {
      const { message, contentType, conversationHistory, phase, model: requestedModel } = req.body;
      const selectedModel = resolveModel(requestedModel);
      if (!message || typeof message !== "string") {
        return res.status(400).json({ error: "Message is required" });
      }

      const isDiscovery = phase === "discovery";
      const isRefine = phase === "refine";
      const isGenerate = phase === "generate";

      const [stats, relevantArticles, dbContext, companyNamesRows, latestTrend, enablementThoughtLeadership] = await Promise.all([
        getSearchStats(),
        searchRelevantArticles(message, 50),
        getDemandbaseContext(),
        pool.query("SELECT id, company_name, ticker FROM company_analyses ORDER BY created_at DESC LIMIT 50"),
        storage.getLatestTrendAnalysis(),
        storage.getThoughtLeadership(5),
      ]);
      const articleContext = relevantArticles.map(a =>
        `[${a.category || "General"}] "${a.title}" (${a.sourceName || "Unknown"}, ${a.publishedAt ? new Date(a.publishedAt).toLocaleDateString() : "recent"}): ${a.description?.substring(0, 400) || "No description"}`
      ).join("\n");

      const fullConversationText = [
        message,
        ...(conversationHistory || []).map((m: any) => m.content || ""),
      ].join(" ").toLowerCase();

      const matchedCompanyIds = companyNamesRows.rows
        .filter((row: any) => {
          const name = row.company_name.toLowerCase();
          const ticker = row.ticker ? row.ticker.toLowerCase() : "";
          return fullConversationText.includes(name) ||
            (ticker && fullConversationText.includes(ticker));
        })
        .map((row: any) => row.id);

      let enablementCompanyContext = "";
      if (matchedCompanyIds.length > 0) {
        const placeholders = matchedCompanyIds.map((_: any, i: number) => `$${i + 1}`).join(",");
        const detailRows = await pool.query(
          `SELECT company_name, ticker, financial_outlook, strategic_direction, growth_signals, risks_and_challenges, demandbase_opportunity FROM company_analyses WHERE id IN (${placeholders})`,
          matchedCompanyIds
        );
        if (detailRows.rows.length > 0) {
          enablementCompanyContext = `\n\n## COMPANY INTELLIGENCE (from Public Company Analysis)
The following companies are relevant to this request and have been researched in depth. Use this data to create targeted, company-specific materials:
${detailRows.rows.map((a: any) => `\n### ${a.company_name}${a.ticker ? ` ($${a.ticker})` : ""}
Financial: ${a.financial_outlook.substring(0, 500)}
Strategy: ${a.strategic_direction.substring(0, 500)}
Growth: ${a.growth_signals.substring(0, 300)}
Risks: ${a.risks_and_challenges.substring(0, 300)}
DB Opportunity: ${a.demandbase_opportunity.substring(0, 500)}`).join("\n")}`;
        }
      }

      let enablementTrendContext = "";
      if (latestTrend) {
        enablementTrendContext = `\n\n## MARKET TRENDS (from latest Trend Analysis: "${latestTrend.title}")
${latestTrend.summary || ""}

Key Themes: ${(latestTrend.keyThemes || []).join(", ")}
`;
        try {
          const visualData = latestTrend.visualData ? JSON.parse(latestTrend.visualData) : null;
          if (visualData) {
            if (visualData.emergingSignals?.length) {
              enablementTrendContext += `\nEmerging Signals:\n${visualData.emergingSignals.map((s: any) => `- ${s.name} (${s.type}, confidence: ${s.confidence}%): ${s.description}${s.relatedCompanies?.length ? ` — Companies: ${s.relatedCompanies.join(", ")}` : ""}`).join("\n")}`;
            }
            if (visualData.topCompanies?.length) {
              enablementTrendContext += `\nTop Companies Mentioned: ${visualData.topCompanies.map((c: any) => `${c.name} (${c.mentions} mentions, ${c.sentiment})`).join(", ")}`;
            }
            if (visualData.trendDirection?.length) {
              enablementTrendContext += `\nTrend Momentum: ${visualData.trendDirection.map((t: any) => `${t.topic}: ${t.direction} (${t.momentum}/100)`).join(", ")}`;
            }
          }
        } catch {}
      }

      let enablementThoughtLeadershipContext = "";
      if (enablementThoughtLeadership.length > 0) {
        enablementThoughtLeadershipContext = `\n\n## THOUGHT LEADERSHIP INSIGHTS (${enablementThoughtLeadership.length} recent analyses)
Use these AI-generated thought leadership analyses to inform content strategy, identify high-impact angles, and ensure materials align with current market opportunities:
${enablementThoughtLeadership.map(tl => `\n### "${tl.title}" (${new Date(tl.createdAt).toLocaleDateString()}, based on ${tl.articleCount} articles)
Summary: ${tl.summary.substring(0, 600)}
Opportunities: ${tl.opportunities.substring(0, 1000)}`).join("\n")}`;
      }

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      let clientDisconnected = false;
      req.on("close", () => { clientDisconnected = true; });

      const brandGuidelines = getBrandGuidelinesContext();
      const isDeckRequest = contentType === "deck" || /\b(deck|presentation|slides?|pptx?|powerpoint)\b/i.test(message);
      const contentTypeHint = contentType ? `\nThe user is requesting a "${contentType}" type of content. Tailor your output format accordingly.` : "";
      const deckPrompt = isDeckRequest ? `\n\nWhen creating a deck or presentation, structure your output as slides:
- Use ## headings for each slide title (one clear, punchy title per slide)
- Use bullet points for slide content (2-4 concise bullets per slide, under 15 words each)
- Add a NOTES: line after each slide body with what the presenter should say
- Keep each slide focused on ONE message
- Aim for 10-14 slides total with a clear narrative arc: problem → insight → solution → action
- Do NOT use special layout tags or bracket labels — just clean ## titles and bullets` : "";

      const discoverySystemPrompt = `You are a senior Field Enablement strategist at Demandbase conducting a creative briefing session before creating content. You're not just gathering info — you're helping the user THINK THROUGH their request so the final output is exactly what they need.

Your job is to ask 5-7 smart, layered questions that cover BOTH the strategic context AND the creative direction. Help the user shape the deliverable. Don't be generic — tailor questions to what they asked for.

${contentType ? `The user wants to create a "${contentType}".` : ""}
${enablementTrendContext ? `\nYou have access to the latest market trend data. Use this to ask smarter, more informed questions — for example, referencing emerging signals or trending topics that could strengthen the user's content.\n${enablementTrendContext}` : ""}
${enablementThoughtLeadershipContext ? `\nYou also have access to recent thought leadership analyses with identified content opportunities. Use these to suggest high-impact angles the user might not have considered, and to ask questions that help align their content with the strongest market opportunities.\n${enablementThoughtLeadershipContext}` : ""}

YOUR QUESTIONS SHOULD COVER THREE LAYERS:

**Layer 1 — Context & Audience (2-3 questions)**
Who is this for, what's the situation, what do they already know?
- Who specifically will see this? (title, seniority, technical depth)
- What's the meeting/deal context? (first touch, competitive bake-off, renewal, board presentation)
- What does the audience currently believe or use today?

**Layer 2 — Message & Strategy (2-3 questions)**
What's the core argument, what proof matters most?
- What's the ONE thing you want them to walk away believing?
- What objections or skepticism do you expect? What have you heard in past conversations?
- Are there specific proof points, customer stories, or data that resonate with this audience?
- Is there a competitor in play? If so, what are they winning on?

**Layer 3 — Creative Direction & Structure (1-2 questions)**
How should this look and feel?
- What tone fits this audience: bold and provocative, or consultative and measured?
- Do you want this to be concise (hit hard, < 5 slides / 1 page) or comprehensive (deep dive, 10-15 slides / multi-section)?
- Any sections or topics you definitely want included — or explicitly excluded?
- Should this feel like a Demandbase-branded pitch, or more of a neutral industry POV that leads to Demandbase?

CONTENT-TYPE SPECIFIC ADDITIONS:
- Battle Card: "What's the #1 reason deals are lost to this competitor?" and "Which Demandbase capability is the hardest to position against them?"
- Talk Track: "Walk me through the meeting flow — who's in the room and what's the desired next step?"
- Deck: "Is this a standalone presentation or a leave-behind? Will someone present it or will it be read async?" and "Any specific slides you already have in mind (like a competitive comparison or ROI summary)?"
- Email Sequence: "What triggered this outreach — intent signal, event, content download?" and "How aggressive should the cadence be?"
- ROI Story: "What metrics does this buyer actually track — pipeline, CAC, revenue per account, something else?" and "Do you have a specific customer win in mind to anchor on?"
- Competitive Intel: "What's the prospect currently evaluating — a full rip-and-replace, or adding alongside their existing stack?"
- One-Pager: "Will this be emailed as an attachment, handed out in person, or embedded in a follow-up?"

FORMAT YOUR RESPONSE AS:
1. A brief, enthusiastic acknowledgment (1 sentence — show you understand what they're trying to accomplish)
2. Your questions organized with bold headers for each layer:
   **About your audience**
   1. ...
   2. ...
   **About your message**
   3. ...
   4. ...
   **About the creative approach**
   5. ...
   6. ...
3. End with: "Answer as many as you'd like — even partial answers help me create something much more targeted. Or skip straight to generation if you're in a hurry."

Be conversational and collaborative. You're a creative partner, not a form to fill out. Show the user that their answers will directly shape the output.
${NO_DASH_RULE}`;

      const refinementSystemPrompt = `You are a senior Field Enablement strategist at Demandbase. The user just answered your discovery questions. Now you need to propose a CREATIVE BRIEF — a structured outline of what you're about to build — so the user can refine it before you generate.

${contentType ? `Content type: "${contentType}"` : ""}

YOUR JOB:
1. Synthesize the user's answers into a clear creative direction
2. Propose a specific structure/outline for the deliverable
3. Ask if they want to adjust anything before you generate

FORMAT YOUR CREATIVE BRIEF AS:

**Here's what I'm planning to build for you:**

📋 **Creative Brief**
- **Audience**: [who, based on their answers]
- **Core Message**: [the #1 takeaway, in one sentence]
- **Tone**: [bold/consultative/urgent/educational]
- **Length**: [estimated size]

📐 **Proposed Structure**
[Numbered outline of sections/slides/sections with 1-line descriptions of what each will cover]

${isDeckRequest ? `For decks, propose the slide flow:
1. **Title slide** — [proposed title + opening hook]
2. **Slide 2** — [what tension/problem this opens with]
3. **Slide 3-4** — [core insight or framework]
4. **Slide 5-6** — [evidence, proof points, or customer story]
5. **Slide 7-8** — [solution/differentiators]
6. **Slide 9-10** — [how to act on this]
etc.` : ""}

💡 **Key ingredients I'll include**
- [Specific proof points, customer stories, or data you plan to weave in]
- [Competitive angles if relevant]
- [Any specific frameworks or messaging pillars you'll use]

End with: "Want me to adjust anything — add a section, change the tone, emphasize a different angle? Or say **'looks good'** and I'll generate it now."

Be specific and opinionated in your proposal. Show the user you listened to their answers and have a clear vision. Don't be vague; the more specific your outline, the more the user can refine it.
${NO_DASH_RULE}`;

      const generationSystemPrompt = `You are a senior Field Enablement strategist at Demandbase. Your job is to help Demandbase sales reps win more deals by creating compelling, data-driven field enablement materials that reflect Demandbase's actual products, positioning, and competitive advantages.

${brandGuidelines}

## DEMANDBASE KNOWLEDGE BASE (from demandbase.com)
${dbContext}

## MARKET INTELLIGENCE
You also have access to ${stats.total} industry articles. The ${relevantArticles.length} most relevant to this request are below. Use these to make your content timely and backed by real market data.

${articleContext}
${enablementTrendContext}
${enablementCompanyContext}
${enablementThoughtLeadershipContext}

## INSTRUCTIONS
When creating materials, always:
1. Lead with the buyer's pain points and market trends (backed by the news data, trend analysis, and thought leadership insights)
2. Position Demandbase as the solution using SPECIFIC product capabilities, features, and messaging from the knowledge base above
3. Use Demandbase's actual competitive differentiators — especially the B2B-native DSP, buying group intelligence, Agentbase AI agents, and unified platform positioning
4. Include real customer proof points (Adobe 3X conversions, SAP Concur +52% revenue, Thermo Fisher +50% deal size, etc.)
5. Reference real industry data and trends from the articles, trend analysis, and thought leadership insights to make the content timely and credible — use emerging signals, trend momentum, top company mentions, and identified content opportunities to strengthen your narrative
6. Follow the BRAND VOICE guidelines strictly: be Candid, Assertive, Empathetic, and Enthusiastic
7. Use Demandbase's actual messaging pillars: broken B2B buying, buying groups not just leads, AI built on 20 years of B2B data, one platform for entire GTM team, data you can trust, prove ROI
8. Use the brand's impact statements where appropriate (e.g., "GTM is broken. We unify it.")
${contentTypeHint}${deckPrompt}

${isDeckRequest ? CITATION_RULES_SLIDES : CITATION_RULES_INLINE}

IMPORTANT: The user already answered discovery questions in the conversation below. Use ALL of their answers to create highly targeted, specific content. Don't ask more questions — create the deliverable now.

${isDeckRequest ? `OUTPUT FORMAT — THIS IS A DECK/PRESENTATION:
Structure your output as clean slides using ## headings for slide titles.
- Each slide starts with ## [Slide Title]
- Under the title: 2-4 concise bullet points (under 15 words each)
- Add NOTES: [what the presenter says] after each slide's bullets
- Keep each slide focused on ONE clear message — if you have more to say, make a new slide
- Aim for 10-14 slides with a narrative arc: open with tension → build the insight → present the solution → close with a clear action
- NO layout tags, NO bracket labels, NO rigid format templates — let the content drive the structure
- For battle cards: open with the competitive opportunity, then quick wins, then objection handling, then proof points
- For ROI stories: open with the customer challenge, then results, then how they got there
- For thought leadership: open with the market shift, build the framework, close with the "so what"` : `Output format guidelines:
- Use markdown formatting (headers, bold, bullet points, numbered lists)
- For battle cards: structure with "Quick Win", "Objection Handling", "Key Differentiators", "Proof Points", "Battle Tips"
- For talk tracks: use conversational language with discovery questions
- For email sequences: include subject lines, body text, and CTAs
- For one-pagers: use clear sections with headers and concise bullet points
- For competitive intel: include strengths, weaknesses, counter-positioning, and landmines to set
- For ROI stories: include customer proof points and quantified business outcomes
- For decks/presentations: structure with ## headers for each slide, use layout tags like [STATS], [COMPARISON], [OBJECTION], keep content concise per slide
${NO_DASH_RULE}`}`;

      const systemPrompt = isDiscovery ? discoverySystemPrompt : isRefine ? refinementSystemPrompt : generationSystemPrompt;

      const chatMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
        { role: "system", content: systemPrompt },
      ];

      if (conversationHistory && Array.isArray(conversationHistory)) {
        for (const msg of conversationHistory) {
          chatMessages.push({
            role: msg.role === "assistant" ? "assistant" : "user",
            content: msg.content,
          });
        }
      }

      chatMessages.push({ role: "user", content: message });

      const stream = chatStream({
        model: selectedModel,
        messages: chatMessages,
        maxTokens: isDiscovery ? 1500 : isRefine ? 4096 : 8192,
      });

      let fullResponse = "";
      for await (const content of stream) {
        if (clientDisconnected) break;
        if (content) {
          fullResponse += content;
          res.write(`data: ${JSON.stringify({ content })}\n\n`);
        }
      }

      if (!clientDisconnected) {
        res.write(`data: [DONE]\n\n`);
      }
      res.end();
    } catch (err) {
      console.error("Error in enablement chat:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to process request" });
      } else {
        res.write(`data: ${JSON.stringify({ error: "Stream interrupted" })}\n\n`);
        res.end();
      }
    }
  });

  app.get("/api/enablement/history", async (_req, res) => {
    try {
      const items = await storage.getEnablementContent(50);
      res.json(items);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to fetch enablement history" });
    }
  });

  app.post("/api/enablement/history", async (req, res) => {
    try {
      const validated = insertEnablementContentSchema.parse(req.body);
      const item = await storage.createEnablementContent(validated);
      res.json(item);
    } catch (err: any) {
      if (err.name === "ZodError") {
        return res.status(400).json({ error: "Invalid input", details: err.errors });
      }
      res.status(500).json({ error: err.message || "Failed to save enablement content" });
    }
  });

  app.patch("/api/enablement/history/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { title } = req.body;
      if (!title || typeof title !== "string") {
        return res.status(400).json({ error: "Title is required" });
      }
      await storage.updateEnablementContent(id, { title: title.trim() });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to update enablement content" });
    }
  });

  app.delete("/api/enablement/history/:id", async (req, res) => {
    try {
      await storage.deleteEnablementContent(parseInt(req.params.id));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to delete enablement content" });
    }
  });

  app.post("/api/enablement/export", async (req, res) => {
    try {
      const { content, title, format, enablementContentId } = req.body;
      if (!content || typeof content !== "string") {
        return res.status(400).json({ error: "Content is required" });
      }

      const docTitle = title || `Demandbase - ${new Date().toLocaleDateString()}`;

      let result: { url: string; id: string };
      if (format === "slides") {
        const slidesData = parseMarkdownToSlides(content);
        result = await createGoogleSlides(docTitle, slidesData);
      } else {
        result = await createGoogleDoc(docTitle, content);
      }

      if (enablementContentId) {
        await storage.updateEnablementContent(enablementContentId, {
          driveUrl: result.url,
          driveFormat: format === "slides" ? "slides" : "document",
        });
      }

      return res.json({
        success: true,
        type: format === "slides" ? "slides" : "document",
        url: result.url,
        id: result.id,
        message: format === "slides" ? `Presentation created` : "Document created successfully",
      });
    } catch (err: any) {
      console.error("Error exporting to Google Drive:", err);
      res.status(500).json({
        error: err.message || "Failed to export to Google Drive",
      });
    }
  });

  app.post("/api/embeddings/generate", async (_req, res) => {
    try {
      const result = await updateSearchVectors();
      res.json(result);
    } catch (err) {
      console.error("Error updating search index:", err);
      res.status(500).json({ error: "Failed to update search index" });
    }
  });

  app.get("/api/embeddings/stats", async (_req, res) => {
    try {
      const stats = await getSearchStats();
      res.json(stats);
    } catch (err) {
      console.error("Error fetching search stats:", err);
      res.status(500).json({ error: "Failed to fetch search stats" });
    }
  });

  app.get("/api/newsapi/status", async (_req, res) => {
    try {
      await seedDefaultNewsapiQueries();
      const queries = await storage.getNewsapiQueries();
      res.json({
        configured: !!process.env.NEWSAPI_KEY,
        queries,
      });
    } catch (err) {
      console.error("Error fetching newsapi status:", err);
      res.status(500).json({ error: "Failed to fetch newsapi status" });
    }
  });

  app.post("/api/newsapi/queries", async (req, res) => {
    try {
      const parsed = insertNewsapiQuerySchema.parse(req.body);
      const created = await storage.createNewsapiQuery(parsed);
      res.json(created);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ error: err.errors[0]?.message || "Invalid input" });
      }
      console.error("Error creating newsapi query:", err);
      res.status(500).json({ error: "Failed to create newsapi query" });
    }
  });

  app.patch("/api/newsapi/queries/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const parsed = insertNewsapiQuerySchema.partial().parse(req.body);
      const updated = await storage.updateNewsapiQuery(id, parsed);
      if (!updated) return res.status(404).json({ error: "Query not found" });
      res.json(updated);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ error: err.errors[0]?.message || "Invalid input" });
      }
      console.error("Error updating newsapi query:", err);
      res.status(500).json({ error: "Failed to update newsapi query" });
    }
  });

  app.delete("/api/newsapi/queries/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteNewsapiQuery(id);
      res.json({ success: true });
    } catch (err) {
      console.error("Error deleting newsapi query:", err);
      res.status(500).json({ error: "Failed to delete newsapi query" });
    }
  });

  app.get("/api/briefings", async (_req, res) => {
    try {
      const list = await storage.getBriefings(10);
      res.json(list);
    } catch (err) {
      console.error("Error fetching briefings:", err);
      res.status(500).json({ error: "Failed to fetch briefings" });
    }
  });

  app.delete("/api/briefings/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid briefing ID" });
      const deleted = await storage.deleteBriefing(id);
      if (!deleted) return res.status(404).json({ error: "Briefing not found" });
      res.json({ success: true });
    } catch (err) {
      console.error("Error deleting briefing:", err);
      res.status(500).json({ error: "Failed to delete briefing" });
    }
  });

  app.get("/api/briefings/latest", async (_req, res) => {
    try {
      const latest = await storage.getLatestBriefing();
      res.json(latest || null);
    } catch (err) {
      console.error("Error fetching latest briefing:", err);
      res.status(500).json({ error: "Failed to fetch latest briefing" });
    }
  });

  // Morning Brief (push email)
  app.post("/api/brief/send-now", async (_req, res) => {
    try {
      const brief = await runManualBrief();
      res.json(brief);
    } catch (err: any) {
      console.error("Error sending manual brief:", err);
      res.status(500).json({ error: err.message || "Failed to send brief" });
    }
  });

  app.get("/api/briefs", async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 30;
      const rows = await storage.getBriefs(Number.isNaN(limit) ? 30 : limit);
      res.json(rows);
    } catch (err) {
      console.error("Error fetching briefs:", err);
      res.status(500).json({ error: "Failed to fetch briefs" });
    }
  });

  app.get("/api/briefs/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid brief ID" });
      const row = await storage.getBrief(id);
      if (!row) return res.status(404).json({ error: "Brief not found" });
      res.json(row);
    } catch (err) {
      console.error("Error fetching brief:", err);
      res.status(500).json({ error: "Failed to fetch brief" });
    }
  });

  app.post("/api/briefings/generate", async (req, res) => {
    try {
      const period = (req.body.period as string) || "week";
      const customFrom = req.body.dateFrom as string | undefined;
      const customTo = req.body.dateTo as string | undefined;
      const isCustom = period === "custom" && customFrom && customTo;
      let days: number;
      let periodLabel: string;
      let endDate: Date;
      let startDate: Date;
      if (isCustom) {
        startDate = new Date(customFrom);
        endDate = new Date(customTo);
        days = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / 86400000) + 1);
        periodLabel = "Custom Range";
      } else {
        days = period === "today" ? 1 : period === "3days" ? 3 : 7;
        periodLabel = period === "today" ? "Today" : period === "3days" ? "Last 3 Days" : "Last 7 Days";
        endDate = new Date();
        startDate = new Date();
        startDate.setDate(endDate.getDate() - (days - 1));
      }
      const fmt = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
      const dateRangeTitle = days === 1 ? fmt(endDate) : `${fmt(startDate)} - ${fmt(endDate)}`;

      const grouped = isCustom
        ? await storage.getArticlesByCategoryInRange(startDate, endDate)
        : await storage.getRecentArticlesByCategory(days);
      const totalArticles = Object.values(grouped).reduce((sum, arr) => sum + arr.length, 0);

      if (totalArticles === 0) {
        return res.status(400).json({ error: "No recent articles available for this time period" });
      }

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      let clientDisconnected = false;
      req.on("close", () => { clientDisconnected = true; });

      const categorySummaries = Object.entries(grouped).map(([cat, arts]) => {
        const top = arts.slice(0, 15);
        const lines = top.map(a =>
          `  - [${a.title}](${a.link}) (${a.sourceName || "Unknown"}, ${a.publishedAt ? new Date(a.publishedAt).toLocaleDateString() : "recent"}): ${a.description?.substring(0, 300) || "No description"}`
        ).join("\n");
        return `### ${cat} (${arts.length} articles)\n${lines}`;
      }).join("\n\n");

      const stream = anthropic.messages.stream({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 6000,
        system: `You are a senior analyst creating an executive intelligence briefing for a thought leader in B2B Marketing and Sales Technology. This person needs to stay ahead of trends, understand market dynamics, and have talking points ready.

Write a comprehensive briefing covering ${periodLabel} (${totalArticles} articles across ${Object.keys(grouped).length} categories).

Structure your response EXACTLY like this:

# Executive Briefing: ${dateRangeTitle}

## The Big Picture
Write 2-3 paragraphs that a busy executive can read in 60 seconds. What are the most important things happening right now? What should they pay attention to? What's the narrative arc across these developments?

## Key Developments by Category

For EACH category below, write a focused section with:
- A bold one-line verdict on what's happening in that space
- 2-3 specific developments with source attribution
- Why it matters for B2B marketers and sales leaders

## Market Movers & Deals
Highlight any acquisitions, funding rounds, IPO activity, stock movements, or partnership announcements. If none exist in the data, skip this section.

## Emerging Themes & Signals
Identify 3-5 cross-cutting themes or weak signals that span multiple categories. These are the "connect the dots" insights that make someone a thought leader.

## Thought Leader Talking Points
Provide 3-4 provocative, well-informed opinions or observations that would make great LinkedIn posts, keynote talking points, or boardroom commentary. Make them specific and backed by the data.

Be specific and cite sources. IMPORTANT: Every time you mention or reference an article, you MUST use the exact markdown link format [Article Title](url) from the input data so readers can click through to the original articles. Do NOT use plain text source names like [Source]; always use the full clickable link. Avoid generic filler. Write in a sharp, analytical tone.
${NO_DASH_RULE}`,
        messages: [{ role: "user", content: `Generate the executive briefing from these articles:\n\n${categorySummaries}` }],
      });

      let fullContent = "";

      for await (const event of stream) {
        if (clientDisconnected) break;
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          const text = event.delta.text;
          fullContent += text;
          res.write(`data: ${JSON.stringify({ content: text })}\n\n`);
        }
      }

      if (!clientDisconnected) {
        const saved = await storage.createBriefing({
          title: dateRangeTitle,
          period: periodLabel,
          executiveSummary: fullContent.substring(0, 500),
          sections: fullContent,
          articleCount: totalArticles,
        });

        res.write(`data: ${JSON.stringify({ done: true, briefingId: saved.id })}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
      }
    } catch (err) {
      console.error("Error generating briefing:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to generate briefing" });
      } else {
        res.write(`data: ${JSON.stringify({ error: "Failed to generate briefing" })}\n\n`);
        res.end();
      }
    }
  });

  const compareSchema = z.object({
    briefingIdA: z.number().int().positive(),
    briefingIdB: z.number().int().positive(),
  });

  app.post("/api/briefings/compare", async (req, res) => {
    try {
      const parsed = compareSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Two valid briefing IDs are required" });
      }
      const { briefingIdA, briefingIdB } = parsed.data;

      const [briefingA, briefingB] = await Promise.all([
        storage.getBriefing(briefingIdA),
        storage.getBriefing(briefingIdB),
      ]);

      if (!briefingA || !briefingB) {
        return res.status(404).json({ error: "One or both briefings not found" });
      }

      const older = new Date(briefingA.createdAt) < new Date(briefingB.createdAt) ? briefingA : briefingB;
      const newer = older.id === briefingA.id ? briefingB : briefingA;

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      let clientDisconnected = false;
      req.on("close", () => { clientDisconnected = true; });

      const stream = anthropic.messages.stream({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 5000,
        system: `You are a senior B2B MarTech analyst comparing two intelligence briefings to identify what changed. Write a sharp, executive-level change analysis.

Structure your response as:

# Change Analysis: ${older.period} → ${newer.period}

## Executive Summary of Changes
2-3 paragraphs highlighting the most significant shifts, new developments, and evolving narratives between these two periods.

## What's New
Major developments, announcements, or themes that appeared in the newer briefing but were absent from the older one.

## What's Shifted
Trends or themes present in both briefings that have evolved, intensified, or changed direction.

## What's Faded
Topics or themes that were prominent in the earlier briefing but have diminished or disappeared.

## Strategic Implications
What do these changes mean for B2B marketing and sales leaders? What should they be doing differently?

Be specific, reference actual content from both briefings, and avoid generic statements.
${NO_DASH_RULE}`,
        messages: [{ role: "user", content: `Compare these two briefings:\n\n--- EARLIER BRIEFING (${older.period}, generated ${new Date(older.createdAt).toLocaleDateString()}, ${older.articleCount} articles) ---\n${older.sections}\n\n--- LATER BRIEFING (${newer.period}, generated ${new Date(newer.createdAt).toLocaleDateString()}, ${newer.articleCount} articles) ---\n${newer.sections}` }],
      });

      let fullContent = "";
      for await (const event of stream) {
        if (clientDisconnected) break;
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          const text = event.delta.text;
          fullContent += text;
          res.write(`data: ${JSON.stringify({ content: text })}\n\n`);
        }
      }

      if (!clientDisconnected) {
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
      }
    } catch (err) {
      console.error("Error comparing briefings:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to compare briefings" });
      } else {
        res.write(`data: ${JSON.stringify({ error: "Failed to compare briefings" })}\n\n`);
        res.end();
      }
    }
  });

  const timeMachineSchema = z.object({
    startDate: z.string().refine(d => !isNaN(new Date(d).getTime()), "Invalid start date"),
    endDate: z.string().refine(d => !isNaN(new Date(d).getTime()), "Invalid end date"),
    category: z.string().optional(),
    topic: z.string().optional(),
  });

  app.post("/api/briefings/time-machine", async (req, res) => {
    try {
      const parsed = timeMachineSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Valid start and end dates are required" });
      }

      const start = new Date(parsed.data.startDate);
      const end = new Date(parsed.data.endDate);
      const category = parsed.data.category;
      const topic = parsed.data.topic;

      const allArticles = await storage.getArticlesByDateRange(start, end, category || undefined);

      let relevantArticles = allArticles;
      if (topic) {
        const topicLower = topic.toLowerCase();
        const keywords = topicLower.split(/\s+/);
        relevantArticles = allArticles.filter(a => {
          const text = `${a.title} ${a.description || ""} ${a.content || ""}`.toLowerCase();
          return keywords.some(kw => text.includes(kw));
        });
      }

      if (relevantArticles.length === 0) {
        return res.status(400).json({ error: "No articles found for this time period and filter" });
      }

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      let clientDisconnected = false;
      req.on("close", () => { clientDisconnected = true; });

      const grouped: Record<string, typeof relevantArticles> = {};
      for (const a of relevantArticles) {
        const cat = a.category || "General";
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(a);
      }

      const articleSummaries = Object.entries(grouped).map(([cat, arts]) => {
        const top = arts.slice(0, 20);
        const lines = top.map(a =>
          `  - [${a.title}](${a.link}) (${a.sourceName || "Unknown"}, ${a.publishedAt ? new Date(a.publishedAt).toLocaleDateString() : "N/A"}): ${a.description?.substring(0, 300) || "No description"}`
        ).join("\n");
        return `### ${cat} (${arts.length} articles)\n${lines}`;
      }).join("\n\n");

      const dateRange = `${start.toLocaleDateString()} to ${end.toLocaleDateString()}`;
      const topicClause = topic ? ` focused on "${topic}"` : "";
      const categoryClause = category ? ` in the ${category} category` : "";

      const stream = anthropic.messages.stream({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 6000,
        system: `You are a senior analyst creating a deep-dive retrospective for a thought leader in B2B Marketing and Sales Technology.

Analyze ${relevantArticles.length} articles from ${dateRange}${categoryClause}${topicClause}.

Structure your response as:

# Intelligence Report: ${dateRange}
${topic ? `## Focus: ${topic}\n` : ""}
## Period Overview
A comprehensive narrative of what happened during this period. What were the defining moments? What trends emerged, accelerated, or reversed?

## Timeline of Key Events
List the most significant developments chronologically, with dates and sources.

## Major Themes & Patterns
Identify 4-6 major themes with evidence from the articles. For each theme:
- What happened
- Why it matters
- How it connects to the broader B2B MarTech/SalesTech landscape

## Market & Competitive Dynamics
How did the competitive landscape shift? Any consolidation, new entrants, pivots, or strategic moves?

## Looking Back: What It Means Now
With the benefit of hindsight, what were the most consequential developments from this period? What lessons should thought leaders take away?

Be analytical, specific, and cite sources using markdown links like [Article Title](url) so readers can click through to the original articles. Write as if briefing a board of advisors.
${NO_DASH_RULE}`,
        messages: [{ role: "user", content: `Generate the retrospective analysis from these articles:\n\n${articleSummaries}` }],
      });

      let fullContent = "";
      for await (const event of stream) {
        if (clientDisconnected) break;
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          const text = event.delta.text;
          fullContent += text;
          res.write(`data: ${JSON.stringify({ content: text })}\n\n`);
        }
      }

      if (!clientDisconnected) {
        res.write(`data: ${JSON.stringify({ done: true, articleCount: relevantArticles.length })}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
      }
    } catch (err) {
      console.error("Error in time machine:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to generate time analysis" });
      } else {
        res.write(`data: ${JSON.stringify({ error: "Failed to generate analysis" })}\n\n`);
        res.end();
      }
    }
  });

  app.post("/api/seed", async (_req, res) => {
    try {
      const existingSources = await storage.getSources();
      const existingFeedUrls = new Set(existingSources.map(s => s.feedUrl));
      let addedSources = 0;
      for (const source of DEFAULT_SOURCES) {
        if (!existingFeedUrls.has(source.feedUrl)) {
          await storage.createSource(source);
          addedSources++;
        }
      }
      if (addedSources > 0 || existingSources.length === 0) {
        const result = await fetchAllFeeds();
        if (result.total > 0) {
          await updateSearchVectors().catch(err => {
            console.error("Error indexing seeded articles:", err);
          });
        }
        res.json({ seeded: true, newSources: addedSources, totalSources: existingSources.length + addedSources, ...result });
      } else {
        res.json({ seeded: false, message: "All sources already configured", totalSources: existingSources.length });
      }
    } catch (err) {
      console.error("Error seeding:", err);
      res.status(500).json({ error: "Failed to seed data" });
    }
  });

  app.get("/api/knowledge/sources", async (_req, res) => {
    try {
      const entries = await storage.getKnowledgeEntries();
      const sourceMap: Record<string, { sourceUrl: string; entryCount: number; entries: Array<{ id: number; title: string; category: string; isActive: boolean }> }> = {};
      for (const entry of entries) {
        const key = entry.sourceUrl || "__no_source__";
        if (!sourceMap[key]) {
          sourceMap[key] = { sourceUrl: entry.sourceUrl || "", entryCount: 0, entries: [] };
        }
        sourceMap[key].entryCount++;
        sourceMap[key].entries.push({ id: entry.id, title: entry.title, category: entry.category, isActive: entry.isActive });
      }
      const sources = Object.values(sourceMap)
        .filter(s => s.sourceUrl)
        .sort((a, b) => b.entryCount - a.entryCount);
      res.json(sources);
    } catch (err) {
      console.error("Error fetching knowledge sources:", err);
      res.status(500).json({ error: "Failed to fetch knowledge sources" });
    }
  });

  app.delete("/api/knowledge/sources", async (req, res) => {
    try {
      const { sourceUrl } = req.body;
      if (!sourceUrl || typeof sourceUrl !== "string") {
        return res.status(400).json({ error: "sourceUrl is required" });
      }
      const deletedCount = await storage.deleteKnowledgeEntriesBySource(sourceUrl);
      res.json({ success: true, deletedCount });
    } catch (err) {
      console.error("Error deleting knowledge source:", err);
      res.status(500).json({ error: "Failed to delete knowledge source" });
    }
  });

  app.post("/api/knowledge/url", async (req, res) => {
    try {
      const { url } = req.body;
      if (!url || typeof url !== "string") {
        return res.status(400).json({ error: "URL is required" });
      }

      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url);
      } catch {
        return res.status(400).json({ error: "Invalid URL format" });
      }

      console.log(`Fetching URL for knowledge extraction: ${url}`);
      const response = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; KnowledgeBot/1.0)" },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        return res.status(400).json({ error: `Failed to fetch URL: ${response.status} ${response.statusText}` });
      }
      const html = await response.text();
      const textContent = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
        .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
        .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&#\d+;/g, "")
        .replace(/\s+/g, " ")
        .trim();

      if (textContent.length < 100) {
        return res.status(400).json({ error: "Could not extract enough text from the URL" });
      }

      const { entries } = await processUrlToKnowledge(textContent, url);
      if (entries.length === 0) {
        return res.status(400).json({ error: "No knowledge entries could be extracted from this URL" });
      }

      const existingEntries = await storage.getKnowledgeEntries();
      const duplicates: Array<{ type: "url" | "similar"; existing: { id: number; title: string; content: string; category: string; sourceUrl: string | null }; newEntry: typeof entries[0] }> = [];

      const urlMatches = existingEntries.filter(e => e.sourceUrl === url);
      for (const existing of urlMatches) {
        const matchingNew = entries[0];
        if (matchingNew) {
          duplicates.push({ type: "url", existing: { id: existing.id, title: existing.title, content: existing.content, category: existing.category, sourceUrl: existing.sourceUrl }, newEntry: matchingNew });
        }
      }

      if (urlMatches.length === 0) {
        for (const newEntry of entries) {
          const titleLower = newEntry.title.toLowerCase();
          const titleWords = titleLower.split(/\s+/).filter(w => w.length > 3);
          for (const existing of existingEntries) {
            const existingTitleLower = existing.title.toLowerCase();
            const matchCount = titleWords.filter(w => existingTitleLower.includes(w)).length;
            if (titleWords.length > 0 && matchCount / titleWords.length > 0.6) {
              duplicates.push({ type: "similar", existing: { id: existing.id, title: existing.title, content: existing.content, category: existing.category, sourceUrl: existing.sourceUrl }, newEntry: newEntry });
              break;
            }
          }
        }
      }

      const batchId = `url_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      if (duplicates.length > 0) {
        const pendingEntries = [];
        for (const entry of entries) {
          const pending = await storage.createPendingKnowledge({
            batchId,
            category: entry.category,
            title: entry.title,
            content: entry.content,
            sourceFilename: parsedUrl.hostname,
            sourceUrl: url,
            confidence: entry.confidence,
            status: "pending",
          });
          pendingEntries.push(pending);
        }

        return res.json({
          success: true,
          hasDuplicates: true,
          batchId,
          duplicates,
          entries: pendingEntries,
          url,
        });
      }

      const pendingEntries = [];
      for (const entry of entries) {
        const pending = await storage.createPendingKnowledge({
          batchId,
          category: entry.category,
          title: entry.title,
          content: entry.content,
          sourceFilename: parsedUrl.hostname,
          sourceUrl: url,
          confidence: entry.confidence,
          status: "pending",
        });
        pendingEntries.push(pending);
      }

      console.log(`Created ${pendingEntries.length} pending entries from URL: ${url} (batch: ${batchId})`);

      res.json({
        success: true,
        hasDuplicates: false,
        batchId,
        entries: pendingEntries,
        url,
      });
    } catch (err: any) {
      console.error("Error processing URL:", err);
      res.status(500).json({ error: err.message || "Failed to process URL" });
    }
  });

  app.post("/api/knowledge/url/confirm", async (req, res) => {
    try {
      const { batchId, action, sourceUrl, duplicateEntryIds } = req.body;
      if (!batchId || !action) {
        return res.status(400).json({ error: "batchId and action are required" });
      }

      if (action === "cancel") {
        const batch = await storage.getPendingKnowledgeByBatch(batchId);
        for (const entry of batch) {
          await storage.deletePendingKnowledge(entry.id);
        }
        return res.json({ success: true, action: "cancelled" });
      }

      if (action === "merge") {
        if (sourceUrl) {
          await storage.deleteKnowledgeEntriesBySource(sourceUrl);
        }
        if (duplicateEntryIds && Array.isArray(duplicateEntryIds)) {
          for (const id of duplicateEntryIds) {
            await storage.deleteKnowledgeEntry(id);
          }
        }
      }

      res.json({ success: true, action, batchId });
    } catch (err: any) {
      console.error("Error confirming URL knowledge:", err);
      res.status(500).json({ error: err.message || "Failed to confirm" });
    }
  });

  app.get("/api/knowledge", async (_req, res) => {
    try {
      const entries = await storage.getKnowledgeEntries();
      res.json(entries);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch knowledge entries" });
    }
  });

  app.get("/api/knowledge/pending", async (_req, res) => {
    try {
      const entries = await storage.getAllPendingKnowledge();
      res.json(entries);
    } catch (err) {
      console.error("Error fetching pending knowledge:", err);
      res.status(500).json({ error: "Failed to fetch pending knowledge" });
    }
  });

  app.get("/api/knowledge/pending/batch/:batchId", async (req, res) => {
    try {
      const entries = await storage.getPendingKnowledgeByBatch(req.params.batchId);
      res.json(entries);
    } catch (err) {
      console.error("Error fetching pending batch:", err);
      res.status(500).json({ error: "Failed to fetch pending batch" });
    }
  });

  app.patch("/api/knowledge/pending/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });

      const updateSchema = z.object({
        title: z.string().min(1).optional(),
        content: z.string().min(1).optional(),
        category: z.string().min(1).optional(),
      });
      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid data", details: parsed.error.issues });
      }

      const updated = await storage.updatePendingKnowledge(id, parsed.data);
      if (!updated) return res.status(404).json({ error: "Pending entry not found" });
      res.json(updated);
    } catch (err) {
      console.error("Error updating pending knowledge:", err);
      res.status(500).json({ error: "Failed to update pending entry" });
    }
  });

  app.delete("/api/knowledge/pending/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      await storage.deletePendingKnowledge(id);
      res.json({ success: true });
    } catch (err) {
      console.error("Error deleting pending knowledge:", err);
      res.status(500).json({ error: "Failed to delete pending entry" });
    }
  });

  app.post("/api/knowledge/pending/:id/approve", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      const entry = await storage.approvePendingEntry(id);
      res.json(entry);
    } catch (err: any) {
      console.error("Error approving pending knowledge:", err);
      res.status(500).json({ error: err.message || "Failed to approve entry" });
    }
  });

  app.post("/api/knowledge/pending/batch/:batchId/approve-all", async (req, res) => {
    try {
      const entries = await storage.getPendingKnowledgeByBatch(req.params.batchId);
      const pending = entries.filter(e => e.status === "pending");
      const approved = [];
      for (const entry of pending) {
        const created = await storage.approvePendingEntry(entry.id);
        approved.push(created);
      }
      res.json({ success: true, approvedCount: approved.length, entries: approved });
    } catch (err: any) {
      console.error("Error approving batch:", err);
      res.status(500).json({ error: err.message || "Failed to approve batch" });
    }
  });

  app.post("/api/knowledge/analyze-conflicts", async (req, res) => {
    try {
      const entries = await storage.getKnowledgeEntries();
      if (entries.length === 0) {
        return res.json({ conflicts: [], suggestions: [], totalEntries: 0, issueCount: 0 });
      }

      const entrySummaries = entries.map(e => `[ID:${e.id}] Category: ${e.category} | Title: ${e.title} | Content: ${e.content.substring(0, 500)}`).join("\n\n");

      const response = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 4000,
        system: `You are a knowledge base quality analyst. Analyze the provided knowledge entries for issues that could cause AI hallucinations or bad content generation. ${NO_DASH_RULE}

Look for:
1. CONTRADICTIONS: Entries that make opposing claims about the same topic
2. OUTDATED INFO: Entries referencing specific dates, versions, or timeframes that may be stale
3. DUPLICATES: Entries that cover the same information with minor wording differences
4. VAGUE/RISKY: Entries with unsubstantiated claims, missing context, or vague language that could cause hallucinations

Each conflict MUST have exactly one matching suggestion with the same index. The suggestion at index N is the recommended action for the conflict at index N.

Return valid JSON with this exact structure:
{
  "conflicts": [
    {
      "type": "contradiction" | "outdated" | "duplicate" | "vague",
      "severity": "high" | "medium" | "low",
      "entryIds": [list of affected entry IDs],
      "description": "Clear explanation of the issue",
      "recommendation": "Suggested fix"
    }
  ],
  "suggestions": [
    {
      "type": "merge" | "update" | "delete" | "clarify",
      "entryIds": [list of affected entry IDs],
      "description": "What to do and why",
      "conflictIndex": 0
    }
  ]
}

IMPORTANT: Every conflict must have a corresponding suggestion. The "conflictIndex" field in each suggestion must match the array index (0-based) of the conflict it resolves. There should be a 1:1 mapping between conflicts and suggestions.
Respond with valid JSON only, no markdown fences.`,
        messages: [{
          role: "user",
          content: `Analyze these ${entries.length} knowledge entries for quality issues:\n\n${entrySummaries}`
        }],
      });

      const reviewBlock = response.content.find((b: any) => b.type === "text");
      const content = (reviewBlock as any)?.text || "{}";
      const parsed = parseAIJson(content);
      const conflictsData = parsed.conflicts || [];
      const suggestionsData = parsed.suggestions || [];

      const review = await storage.createKnowledgeReview({
        conflicts: JSON.stringify(conflictsData),
        suggestions: JSON.stringify(suggestionsData),
        totalEntries: entries.length,
        issueCount: conflictsData.length,
        status: "complete",
      });

      res.json({
        id: review.id,
        conflicts: conflictsData,
        suggestions: suggestionsData,
        totalEntries: entries.length,
        issueCount: conflictsData.length,
        createdAt: review.createdAt,
      });
    } catch (err: any) {
      console.error("Error analyzing knowledge conflicts:", err);
      res.status(500).json({ error: err.message || "Failed to analyze knowledge conflicts" });
    }
  });

  app.get("/api/knowledge/conflicts", async (_req, res) => {
    try {
      const review = await storage.getLatestKnowledgeReview();
      if (!review) {
        return res.json(null);
      }
      res.json({
        id: review.id,
        conflicts: JSON.parse(review.conflicts),
        suggestions: JSON.parse(review.suggestions),
        totalEntries: review.totalEntries,
        issueCount: review.issueCount,
        createdAt: review.createdAt,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to fetch knowledge conflicts" });
    }
  });

  app.post("/api/knowledge/teach", async (req, res) => {
    try {
      const schema = z.object({
        conflictIndex: z.number(),
        conflictDescription: z.string().min(1),
        userReason: z.string().min(1),
        entryIds: z.array(z.number()),
        conflictType: z.string(),
        suggestionType: z.string().optional(),
        suggestionDescription: z.string().optional(),
        conversationHistory: z.array(z.object({
          role: z.enum(["user", "assistant"]),
          text: z.string(),
        })).optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });

      const { conflictDescription, userReason, entryIds, conflictType, suggestionType, suggestionDescription, conversationHistory } = parsed.data;

      const involvedEntries = await storage.getKnowledgeEntriesByIds(entryIds);
      const entryDetails = involvedEntries.map(e => `[ID:${e.id}] Title: ${e.title}\nContent: ${e.content}`).join("\n\n");

      const systemPrompt = `You are a knowledge base editor having a conversation with the user about a flagged quality issue. ${NO_DASH_RULE}

IMPORTANT RULES:
1. If the user's reasoning is vague, incomplete, or you need more context to make a good decision, ask 1 to 2 focused clarifying questions. When asking questions, return JSON with "needsClarification": true.
2. If you have enough information to make a confident resolution, return the final resolution JSON with "needsClarification": false.
3. Be conversational and specific in your questions. Reference the actual entries by name.
4. Never ask more than 2 questions at once.
5. Maximum 3 rounds of clarification before you must produce a resolution.

When you need clarification, return:
{
  "needsClarification": true,
  "questions": ["Specific question about their reasoning or preference"]
}

When you have enough information, return:
{
  "needsClarification": false,
  "resolution": "keep" | "merge" | "update" | "delete" | "clarify",
  "explanation": "Clear explanation acknowledging the user's input across the conversation",
  "title": "New/updated title (if resolution involves content changes, otherwise original title)",
  "content": "New/updated content (if resolution involves content changes, otherwise empty string)",
  "category": "Category for the resolved entry (if merging)",
  "deleteIds": [IDs to delete if resolution is merge or delete, empty array otherwise]
}`;

      const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `FLAGGED ISSUE (${conflictType}):
${conflictDescription}

${suggestionType ? `ORIGINAL SUGGESTION (${suggestionType}): ${suggestionDescription}` : ""}

INVOLVED ENTRIES:
${entryDetails}

MY REASONING:
${userReason}`
        },
      ];

      if (conversationHistory && conversationHistory.length > 0) {
        for (const msg of conversationHistory) {
          messages.push({
            role: msg.role === "user" ? "user" : "assistant",
            content: msg.text,
          });
        }
      }

      const sysMsg = messages.find(m => m.role === "system");
      const chatMsgs = messages.filter(m => m.role !== "system");
      const response = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 3000,
        ...(sysMsg ? { system: sysMsg.content } : {}),
        messages: chatMsgs as any,
      });
      const responseBlock = response.content.find((b: any) => b.type === "text");
      const content = (responseBlock as any)?.text || "{}";
      const result = parseAIJson(content);

      if (result.needsClarification) {
        return res.json({
          needsClarification: true,
          questions: result.questions || ["Could you tell me more about your reasoning?"],
          aiMessage: (result.questions || []).join("\n\n"),
        });
      }

      res.json({
        needsClarification: false,
        resolution: result.resolution || "keep",
        explanation: result.explanation || "No explanation provided",
        title: result.title || "",
        content: result.content || "",
        category: result.category || "",
        deleteIds: result.deleteIds || [],
      });
    } catch (err: any) {
      console.error("Error processing knowledge teach:", err);
      res.status(500).json({ error: err.message || "Failed to process feedback" });
    }
  });

  app.post("/api/knowledge/consolidate", async (req, res) => {
    try {
      const { entryIds: rawIds, action, preview, title, content, category } = req.body;
      if (!Array.isArray(rawIds) || rawIds.length === 0) {
        return res.status(400).json({ error: "entryIds array is required" });
      }
      const entryIds = rawIds.map((id: any) => Number(id)).filter((id: number) => !isNaN(id) && id > 0);
      if (entryIds.length === 0) {
        return res.status(400).json({ error: "entryIds must contain valid numeric IDs" });
      }
      if (!["merge", "delete"].includes(action)) {
        return res.status(400).json({ error: "action must be 'merge' or 'delete'" });
      }

      if (action === "delete") {
        for (const id of entryIds) {
          await storage.deleteKnowledgeEntry(id);
        }
        return res.json({ success: true, deleted: entryIds.length });
      }

      const entries = await Promise.all(
        entryIds.map((id: number) => storage.getKnowledgeEntry(id))
      );
      const validEntries = entries.filter(Boolean);
      if (validEntries.length < 2) {
        return res.status(400).json({ error: "Need at least 2 valid entries to merge" });
      }

      if (preview) {
        const entrySummaries = validEntries.map((e: any) =>
          `[ID ${e.id}] Title: ${e.title}\nCategory: ${e.category}\nContent: ${e.content}`
        ).join("\n\n---\n\n");

        const merged = await chatCompletion({
          model: "claude-haiku-4-5-20251001",
          messages: [
            {
              role: "system",
              content: `You are a knowledge base editor. Consolidate the following duplicate or overlapping knowledge entries into ONE comprehensive entry. Preserve all unique facts and details. Output valid JSON with fields: "title" (string), "category" (string), "content" (string).
${NO_DASH_RULE}`
            },
            {
              role: "user",
              content: `Consolidate these ${validEntries.length} entries:\n\n${entrySummaries}`
            }
          ],
          jsonMode: true,
        });

        let parsed;
        try {
          parsed = JSON.parse(merged);
        } catch {
          return res.status(500).json({ error: "AI returned invalid JSON" });
        }

        return res.json({
          preview: true,
          title: parsed.title,
          category: parsed.category || validEntries[0]!.category,
          content: parsed.content,
        });
      }

      if (!title || !content) {
        return res.status(400).json({ error: "title and content are required for merge confirm" });
      }

      const newEntry = await storage.createKnowledgeEntry({
        title,
        category: category || validEntries[0]!.category,
        content,
        sourceUrl: validEntries[0]!.sourceUrl || null,
        isActive: true,
      });

      for (const id of entryIds) {
        await storage.deleteKnowledgeEntry(id);
      }

      res.json({ success: true, merged: entryIds.length, newEntry });
    } catch (err: any) {
      console.error("Error consolidating knowledge:", err);
      res.status(500).json({ error: err.message || "Failed to consolidate entries" });
    }
  });

  app.post("/api/knowledge/ai-rewrite", async (req, res) => {
    try {
      const { entryId: rawId, action, instruction, preview, title, content } = req.body;
      const entryId = Number(rawId);
      if (!entryId || isNaN(entryId) || entryId <= 0 || !action || !instruction) {
        return res.status(400).json({ error: "entryId (number), action, and instruction are required" });
      }
      if (!["update", "clarify"].includes(action)) {
        return res.status(400).json({ error: "action must be 'update' or 'clarify'" });
      }

      const entry = await storage.getKnowledgeEntry(entryId);
      if (!entry) {
        return res.status(404).json({ error: "Knowledge entry not found" });
      }

      if (preview) {
        const rewritten = await chatCompletion({
          model: "claude-haiku-4-5-20251001",
          messages: [
            {
              role: "system",
              content: `You are a knowledge base editor. Rewrite the provided knowledge entry according to the instruction. Preserve factual accuracy while improving the content. Output valid JSON with fields: "title" (string), "content" (string).
${NO_DASH_RULE}`
            },
            {
              role: "user",
              content: `Instruction: ${instruction}\n\nCurrent entry:\nTitle: ${entry.title}\nContent: ${entry.content}`
            }
          ],
          jsonMode: true,
        });

        let parsed;
        try {
          parsed = JSON.parse(rewritten);
        } catch {
          return res.status(500).json({ error: "AI returned invalid JSON" });
        }

        return res.json({
          preview: true,
          entryId,
          title: parsed.title || entry.title,
          content: parsed.content || entry.content,
        });
      }

      if (!title || !content) {
        return res.status(400).json({ error: "title and content are required for confirm" });
      }

      const updated = await storage.updateKnowledgeEntry(entryId, { title, content });
      res.json({ success: true, entry: updated });
    } catch (err: any) {
      console.error("Error rewriting knowledge:", err);
      res.status(500).json({ error: err.message || "Failed to rewrite entry" });
    }
  });

  app.get("/api/knowledge/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      const entry = await storage.getKnowledgeEntry(id);
      if (!entry) return res.status(404).json({ error: "Not found" });
      res.json(entry);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch knowledge entry" });
    }
  });

  app.post("/api/knowledge", async (req, res) => {
    try {
      const parsed = insertKnowledgeEntrySchema.parse(req.body);
      const entry = await storage.createKnowledgeEntry(parsed);
      res.json(entry);
    } catch (err: any) {
      if (err?.name === "ZodError") return res.status(400).json({ error: "Invalid data", details: err.errors });
      res.status(500).json({ error: "Failed to create knowledge entry" });
    }
  });

  app.patch("/api/knowledge/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      const allowed = insertKnowledgeEntrySchema.partial().parse(req.body);
      const updated = await storage.updateKnowledgeEntry(id, allowed);
      if (!updated) return res.status(404).json({ error: "Not found" });
      res.json(updated);
    } catch (err: any) {
      if (err?.name === "ZodError") return res.status(400).json({ error: "Invalid data", details: err.errors });
      res.status(500).json({ error: "Failed to update knowledge entry" });
    }
  });

  app.delete("/api/knowledge/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      await storage.deleteKnowledgeEntry(id);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to delete knowledge entry" });
    }
  });

  app.post("/api/knowledge/extract", async (_req, res) => {
    try {
      const { seedKnowledge, isExtractionRunning } = await import("./extract-knowledge");
      if (isExtractionRunning()) {
        return res.status(409).json({ error: "Extraction already in progress" });
      }
      res.json({ status: "started", message: "Knowledge extraction started in background" });
      seedKnowledge().then(count => {
        console.log(`Knowledge extraction complete: ${count} entries`);
      }).catch(err => {
        console.error("Knowledge extraction failed:", err);
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to start extraction" });
    }
  });

  app.post("/api/knowledge/upload-chunked", express.json(), async (req: any, res) => {
    try {
      const { filePath, filename, size, category: rawCat } = req.body;
      if (!filePath || !filename) {
        return res.status(400).json({ error: "Missing filePath or filename" });
      }
      if (!fs.existsSync(filePath)) {
        return res.status(400).json({ error: "Uploaded file not found. Please try uploading again." });
      }
      const category = rawCat || undefined;
      const ext = filename.toLowerCase().split(".").pop() || "";
      const isVideo = ["mp4", "mov", "avi", "webm"].includes(ext);
      const fileSize = size || fs.statSync(filePath).size;

      console.log(`[knowledge-chunked] Processing uploaded file: ${filename} (${(fileSize / 1024).toFixed(0)}KB)`);

      const jobId = `upload_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await storage.createProcessingJob({
        jobId, section: "knowledge", filename, fileSize,
        status: "extracting_text", progress: 5, progressMessage: "Extracting content...",
      });

      res.json({ success: true, jobId, filename, status: "processing" });

      (async () => {
        try {
          let fullText = "";
          let images: ExtractedImage[] = [];

          if (isVideo) {
            await storage.updateProcessingJob(jobId, { status: "extracting_images", progress: 10, progressMessage: "Extracting video frames..." } as any);
            let frames: Buffer[] = [];
            try {
              frames = await extractFramesFromVideo(filePath);
            } catch (videoErr: any) {
              cleanupTempFile(filePath);
              await storage.updateProcessingJob(jobId, { status: "error", error: `Video processing failed: ${videoErr.message}`, completedAt: new Date() } as any);
              return;
            }
            cleanupTempFile(filePath);
            if (frames.length > 0) {
              await storage.updateProcessingJob(jobId, { status: "analyzing_images", progress: 30, progressMessage: `Analyzing ${frames.length} video frames...` } as any);
              const videoFrames = frames.map((data, i) => ({ frameNum: i + 1, data, mimeType: "image/jpeg" }));
              fullText = await analyzeVideoFrames(videoFrames, filename);
            }
          } else {
            await storage.updateProcessingJob(jobId, { status: "extracting_text", progress: 10, progressMessage: "Extracting text and images..." } as any);
            const result = await extractTextAndImagesFromFile(filePath, filename);
            cleanupTempFile(filePath);
            fullText = result.text;
            images = result.images;

            if (images.length > 0) {
              await storage.updateProcessingJob(jobId, { status: "analyzing_images", progress: 30, progressMessage: `Analyzing ${images.length} images...` } as any);
              const imageResults = await analyzeImages(images, fullText.substring(0, 500), (done, total) => {
                storage.updateProcessingJob(jobId, { progress: 30 + Math.round((done / total) * 25), progressMessage: `Analyzing image ${done} of ${total}...` } as any);
              });
              for (const ir of imageResults) {
                fullText += `\n\n[Slide ${ir.slideNum} - Visual Content] ${ir.description}`;
              }
            }
          }

          if (!fullText || fullText.trim().length < 100) {
            await storage.updateProcessingJob(jobId, { status: "error", error: "Could not extract enough text from the file", completedAt: new Date() } as any);
            return;
          }

          await storage.updateProcessingJob(jobId, { status: "ai_processing", progress: 60, progressMessage: "AI extracting knowledge entries..." } as any);
          const { entries } = await processFileToKnowledge(fullText, filename, category);
          if (entries.length === 0) {
            await storage.updateProcessingJob(jobId, { status: "error", error: "No knowledge entries could be extracted from the file", completedAt: new Date() } as any);
            return;
          }

          await storage.updateProcessingJob(jobId, { progress: 85, progressMessage: "Saving entries..." } as any);
          const batchId = jobId;
          const pendingEntries = [];
          for (const entry of entries) {
            const pending = await storage.createPendingKnowledge({
              batchId,
              category: entry.category,
              title: entry.title,
              content: entry.content,
              sourceFilename: filename,
              status: "pending",
            });
            pendingEntries.push(pending);
          }

          const sourceCategory = category || entries[0]?.category || "Uploaded Documents";
          const existingSourceCheck = await storage.getSources();
          const alreadyExists = existingSourceCheck.some((s) => s.feedUrl === `upload://${filename}`);
          if (!alreadyExists) {
            await storage.createSource({
              name: filename.replace(/\.[^.]+$/, ""),
              url: `upload://${filename}`,
              feedUrl: `upload://${filename}`,
              category: sourceCategory,
              description: `Uploaded document: ${filename}`,
              isActive: true,
            });
          }

          await storage.updateProcessingJob(jobId, {
            status: "done", progress: 100, progressMessage: "Complete",
            result: JSON.stringify({ success: true, filename, batchId, entriesCount: pendingEntries.length, entries: pendingEntries }),
            completedAt: new Date(),
          } as any);
        } catch (err: any) {
          console.error(`[upload:${jobId}] Background processing error:`, err);
          cleanupTempFile(filePath);
          await storage.updateProcessingJob(jobId, { status: "error", error: err.message || "Failed to process file", completedAt: new Date() } as any);
        }
      })();
    } catch (err: any) {
      console.error("Error in chunked knowledge upload:", err);
      res.status(500).json({ error: err.message || "Failed to process file" });
    }
  });

  app.post("/api/knowledge/upload", (req: any, res, next) => {
    upload.single("file")(req, res, (err: any) => {
      if (err) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(400).json({ error: "File is too large. Maximum size is 500MB." });
        }
        return res.status(400).json({ error: err.message || "File upload failed" });
      }
      next();
    });
  }, async (req: any, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const { originalname, path: filePath, size } = req.file;
      const category = req.body?.category || undefined;
      const ext = originalname.toLowerCase().split(".").pop() || "";
      const isVideo = ["mp4", "mov", "avi", "webm"].includes(ext);

      console.log(`Processing uploaded file: ${originalname} (${(size / 1024).toFixed(0)}KB)`);

      const jobId = `upload_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      await storage.createProcessingJob({
        jobId, section: "knowledge", filename: originalname, fileSize: size,
        status: "extracting_text", progress: 5, progressMessage: "Extracting content...",
      });

      res.json({ success: true, jobId, filename: originalname, status: "processing" });

      (async () => {
        try {
          let fullText = "";
          let images: ExtractedImage[] = [];

          if (isVideo) {
            await storage.updateProcessingJob(jobId, { status: "extracting_images", progress: 10, progressMessage: "Extracting video frames..." } as any);
            let frames: Buffer[] = [];
            try {
              frames = await extractFramesFromVideo(filePath);
            } catch (videoErr: any) {
              console.error(`[upload:${jobId}] Video frame extraction failed:`, videoErr.message);
              cleanupTempFile(filePath);
              await storage.updateProcessingJob(jobId, { status: "error", error: `Video processing failed: ${videoErr.message}. Ensure the video file is valid.`, completedAt: new Date() } as any);
              return;
            }
            cleanupTempFile(filePath);
            if (frames.length > 0) {
              await storage.updateProcessingJob(jobId, { status: "analyzing_images", progress: 30, progressMessage: `Analyzing ${frames.length} video frames...` } as any);
              const videoFrames = frames.map((data, i) => ({ frameNum: i + 1, data, mimeType: "image/jpeg" }));
              fullText = await analyzeVideoFrames(videoFrames, originalname);
            }
          } else {
            await storage.updateProcessingJob(jobId, { status: "extracting_text", progress: 10, progressMessage: "Extracting text and images..." } as any);
            const result = await extractTextAndImagesFromFile(filePath, originalname);
            cleanupTempFile(filePath);
            fullText = result.text;
            images = result.images;

            if (images.length > 0) {
              await storage.updateProcessingJob(jobId, { status: "analyzing_images", progress: 30, progressMessage: `Analyzing ${images.length} images...` } as any);
              const imageResults = await analyzeImages(images, fullText.substring(0, 500), (done, total) => {
                storage.updateProcessingJob(jobId, { progress: 30 + Math.round((done / total) * 25), progressMessage: `Analyzing image ${done} of ${total}...` } as any);
              });
              for (const ir of imageResults) {
                fullText += `\n\n[Slide ${ir.slideNum} - Visual Content] ${ir.description}`;
              }
            }
          }

          console.log(`[upload:${jobId}] Content extracted: ${fullText.length} chars`);
          if (!fullText || fullText.trim().length < 100) {
            await storage.updateProcessingJob(jobId, { status: "error", error: "Could not extract enough text from the file", completedAt: new Date() } as any);
            return;
          }

          await storage.updateProcessingJob(jobId, { status: "ai_processing", progress: 60, progressMessage: "AI extracting knowledge entries..." } as any);

          console.log(`[upload:${jobId}] Starting AI knowledge extraction for ${originalname}...`);
          const { entries, rawText } = await processFileToKnowledge(fullText, originalname, category);
          if (entries.length === 0) {
            await storage.updateProcessingJob(jobId, { status: "error", error: "No knowledge entries could be extracted from the file", completedAt: new Date() } as any);
            return;
          }

          await storage.updateProcessingJob(jobId, { progress: 85, progressMessage: "Saving entries..." } as any);

          const batchId = jobId;
          const pendingEntries = [];

          for (const entry of entries) {
            const pending = await storage.createPendingKnowledge({
              batchId,
              category: entry.category,
              title: entry.title,
              content: entry.content,
              sourceFilename: originalname,
              status: "pending",
            });
            pendingEntries.push(pending);
          }

          const sourceCategory = category || entries[0]?.category || "Uploaded Documents";
          const existingSourceCheck = await storage.getSources();
          const alreadyExists = existingSourceCheck.some(
            (s) => s.feedUrl === `upload://${originalname}`
          );
          if (!alreadyExists) {
            await storage.createSource({
              name: originalname.replace(/\.[^.]+$/, ""),
              url: `upload://${originalname}`,
              feedUrl: `upload://${originalname}`,
              category: sourceCategory,
              description: `Uploaded document: ${originalname}`,
              isActive: true,
            });
          }

          console.log(`[upload:${jobId}] Completed — ${pendingEntries.length} entries extracted from ${originalname}`);
          await storage.updateProcessingJob(jobId, {
            status: "done", progress: 100, progressMessage: "Complete",
            result: JSON.stringify({ success: true, filename: originalname, batchId, entriesCount: pendingEntries.length, entries: pendingEntries }),
            completedAt: new Date(),
          } as any);
        } catch (err: any) {
          console.error(`[upload:${jobId}] Background processing error:`, err);
          cleanupTempFile(filePath);
          await storage.updateProcessingJob(jobId, { status: "error", error: err.message || "Failed to process file", completedAt: new Date() } as any);
        }
      })();
    } catch (err: any) {
      console.error("File upload error:", err);
      res.status(500).json({ error: err.message || "Failed to process uploaded file" });
    }
  });

  app.get("/api/knowledge/upload-status/:jobId", async (req, res) => {
    const job = await storage.getProcessingJob(req.params.jobId);
    if (!job) {
      const pending = await storage.getPendingKnowledgeByBatch(req.params.jobId);
      if (pending.length > 0) {
        return res.json({ status: "done", result: { success: true, batchId: req.params.jobId, entriesCount: pending.length, entries: pending } });
      }
      return res.status(404).json({ error: "Job not found" });
    }
    if (job.status === "done") {
      return res.json({ status: "done", ...(job.result ? JSON.parse(job.result) : {}) });
    }
    if (job.status === "error") {
      return res.json({ status: "error", error: job.error });
    }
    res.json({ status: "processing", progress: job.progress, progressMessage: job.progressMessage });
  });

  app.post("/api/knowledge/upload-preview", (req: any, res, next) => {
    upload.single("file")(req, res, (err: any) => {
      if (err) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(400).json({ error: "File is too large. Maximum size is 500MB." });
        }
        return res.status(400).json({ error: err.message || "File upload failed" });
      }
      next();
    });
  }, async (req: any, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const { originalname, path: filePath } = req.file;
      const category = req.body?.category || undefined;

      try {
        const text = await extractTextFromFile(filePath, originalname);
        cleanupTempFile(filePath);
        if (!text || text.trim().length < 100) {
          return res.status(400).json({ error: "Could not extract enough text from the file" });
        }

        const { entries } = await processFileToKnowledge(text, originalname, category);

        res.json({
          filename: originalname,
          extractedTextLength: text.length,
          entries,
        });
      } catch (innerErr: any) {
        cleanupTempFile(filePath);
        throw innerErr;
      }
    } catch (err: any) {
      console.error("File preview error:", err);
      res.status(500).json({ error: err.message || "Failed to preview file" });
    }
  });

  app.get("/api/company-analyses", async (_req, res) => {
    try {
      const analyses = await storage.getCompanyAnalyses();
      res.json(analyses);
    } catch (err) {
      console.error("Error fetching company analyses:", err);
      res.status(500).json({ error: "Failed to fetch company analyses" });
    }
  });

  app.get("/api/company-analyses/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      const analysis = await storage.getCompanyAnalysis(id);
      if (!analysis) return res.status(404).json({ error: "Analysis not found" });
      res.json(analysis);
    } catch (err) {
      console.error("Error fetching company analysis:", err);
      res.status(500).json({ error: "Failed to fetch company analysis" });
    }
  });

  app.delete("/api/company-analyses/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      await storage.deleteCompanyAnalysis(id);
      res.status(204).send();
    } catch (err) {
      console.error("Error deleting company analysis:", err);
      res.status(500).json({ error: "Failed to delete company analysis" });
    }
  });

  app.post("/api/company-analysis", async (req, res) => {
    try {
      const { companyWebsite, model: requestedModel } = req.body;
      const selectedModel = requestedModel ? resolveModel(requestedModel) : "claude-haiku-4-5-20251001";
      if (!companyWebsite || typeof companyWebsite !== "string") {
        return res.status(400).json({ error: "Company website is required" });
      }

      const domain = companyWebsite.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
      const companyName = domain.split(".")[0].charAt(0).toUpperCase() + domain.split(".")[0].slice(1);

      console.log(`[company-analysis] Starting analysis for ${companyName} (${domain})...`);

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const sendProgress = (step: string) => {
        res.write(`data: ${JSON.stringify({ type: "progress", step })}\n\n`);
      };

      sendProgress("Identifying company and searching for financial data...");

      let secData = "";
      try {
        const secSearchUrl = `https://efts.sec.gov/LATEST/search-index?q=%22${encodeURIComponent(companyName)}%22&dateRange=custom&startdt=${new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]}&enddt=${new Date().toISOString().split('T')[0]}&forms=10-K,10-Q,8-K`;
        const secRes = await fetch(`https://efts.sec.gov/LATEST/search-index?q=%22${encodeURIComponent(companyName)}%22&forms=10-K,10-Q,8-K&dateRange=custom&startdt=${new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]}&enddt=${new Date().toISOString().split('T')[0]}`, {
          headers: { "User-Agent": "B2BMarTechIntel/1.0 research@example.com", "Accept": "application/json" }
        });
        if (secRes.ok) {
          const secJson = await secRes.json() as any;
          if (secJson.hits?.hits?.length > 0) {
            secData = secJson.hits.hits.slice(0, 5).map((h: any) =>
              `Filing: ${h._source?.form_type || "Unknown"} - ${h._source?.file_date || ""} - ${h._source?.display_names?.join(", ") || ""}`
            ).join("\n");
          }
        }
      } catch (e) {
        console.log("[company-analysis] SEC search not available, continuing with AI analysis");
      }

      sendProgress("Gathering financial outlook, earnings data, and strategy information...");

      const { rows: competitorRows } = await pool.query("SELECT name, domain FROM competitors");
      const competitorNames = competitorRows.map(r => r.name);
      const isCompetitor = competitorRows.some(c =>
        companyName.toLowerCase().includes(c.name.toLowerCase()) ||
        (c.domain && domain.toLowerCase().includes(c.domain.toLowerCase()))
      );

      const productKnowledgeContext = await getProductKnowledgeContext();

      const analysisPrompt = `Analyze the company with website "${domain}" (likely company name: "${companyName}").

═══ ACCURACY RULES ═══
- NEVER fabricate numbers. Every revenue figure, growth rate, percentage, or financial metric MUST be real and cited with a numbered superscript reference like [1], [2], etc. that maps to the sourcesUsed array (1-indexed).
- Example: "**$X.XB revenue** [1]" or "**XX% YoY growth** [3]" — the number in brackets must match the index in the sourcesUsed array.
- If a metric is unknown, say "**Not publicly reported**" — do NOT estimate or approximate.
- Distinguish **confirmed data** (SEC filings, earnings, press releases) from **general positioning** (product descriptions, market perception).
- EVERY numeric value (percentages, dollar amounts, growth rates, multipliers, counts) MUST have a [N] citation immediately after it. No exceptions.

═══ FORMATTING RULES — CRITICAL ═══
Every section MUST use **bold** for key terms, metrics, and labels. Use markdown bullet points (- ) for lists. Use **bold labels** at the start of each bullet. Keep sections scannable — a reader should be able to skim bold text and get the key takeaways in 10 seconds.

═══ COMPETITOR CHECK ═══
Demandbase competes in ABM, B2B advertising, intent data, sales intelligence, and B2B data enrichment. Known competitors: ${competitorNames.join(", ")}.
${isCompetitor ? `⚠️ THIS COMPANY IS A DEMANDBASE COMPETITOR — the Opportunity section must be competitive intelligence, not a sales pitch.\n` : ""}

═══ SECTION INSTRUCTIONS ═══

**1. Financial Outlook**
The VERY FIRST WORD must be exactly one of: GROWING, STABLE, DECLINING, or MIXED (no prefix). Then provide:
- **Key Metrics**: Revenue, growth rate, margins, market cap — each bolded with cited source
- **Recent Performance**: Most recent quarter/year results with specific numbers
- **Guidance & Targets**: Any publicly stated financial goals or targets (e.g., "**Targeting $5B ARR by 2026** (Investor Day 2024)")
- **Trajectory**: Is the business accelerating, decelerating, or steady? Back it up with trend data
Keep it tight — prioritize numbers and cited facts over narrative. ~250-350 words.

**2. Strategic Direction**
Structure as labeled bullets, not paragraphs:
- **Core Strategy**: What is the company betting on? One-sentence thesis
- **Key Initiatives**: 3-5 specific, named initiatives (product launches, M&A, partnerships) with dates/details
- **Investment Focus**: Where are they putting money — AI, international expansion, vertical markets, etc.?
- **Strategic Shifts**: What have they pulled back from or pivoted away from?
~250-350 words.

**3. Growth Signals**
⚠️ RECENCY RULE: Only include growth signals from the LAST 12 MONTHS. Do NOT cite events, metrics, or evidence older than 12 months. If you cannot find recent signals, say "**No recent growth signals identified**" — do NOT pad with stale data.
Each signal must be SPECIFIC and SUBSTANTIVE. Bad: "They have case studies showing customer success." Good: "**Enterprise expansion**: Added 45 net-new enterprise logos in Q3 2025, up from 28 in Q3 2024 [2]."
Provide 4-6 signals, each as a bolded bullet with evidence:
- **[Signal Name]**: Specific evidence with numbers/dates/sources — must be from the last 12 months
Weak signals like "they're investing in AI" or "they have partnerships" are NOT acceptable without specifics. Each signal must answer: "What EXACTLY happened, when, and what does the number/evidence show?"
~200-300 words.

**4. Risks & Challenges**
⚠️ RECENCY RULE: Only include risks supported by evidence from the LAST 12 MONTHS. Do NOT cite events, metrics, or evidence older than 12 months. If you cannot find recent risks, say "**No recent risks identified**" — do NOT pad with stale data.
Each risk must be SPECIFIC TO THIS COMPANY with concrete evidence. Bad: "They face competitive pressure and potential customer churn." Good: "**Margin compression from AI investment**: R&D spend increased from 22% to 29% of revenue over 3 quarters (10-Q filings) while gross margins declined 3 points, suggesting their AI pivot is pressuring profitability [4]."
Provide 4-6 risks, each as a bolded bullet:
- **[Risk Name]**: Company-specific evidence explaining WHY this is a real risk for THIS company right now
Generic industry risks are NOT acceptable. Every risk must reference something specific to this company's situation.
~200-300 words.

**5. Demandbase Opportunity**
${isCompetitor ? `This is a competitor. Write a competitive intelligence brief.
⚠️ CITATION REMINDER: Every number you reference in this section MUST have a [N] citation — even if already cited earlier. No uncited numbers.
- **Product Overlap**: Where do they directly compete with Demandbase? Be specific about features/capabilities
- **Their Advantages**: Where are they stronger? What should Demandbase watch out for?
- **Demandbase Advantages**: Where does Demandbase win against them?
- **Strategic Positioning**: How should a Demandbase rep talk about this competitor in a deal?` : `DO NOT explain what Demandbase does — the reader already knows. DO NOT label this as "New Biz" or "Expand." Jump straight into the analysis.

Write this as if you are briefing a Demandbase sales rep before a prospecting call. Tie every recommendation to the company's OWN stated goals and challenges.
⚠️ CITATION REMINDER: Every number you reference in this section (revenue targets, growth rates, percentages, headcounts, deal sizes) MUST have a [N] citation — even if you already cited it in an earlier section. Re-cite it here. No uncited numbers.
- **Why They Need Demandbase**: Connect their business challenges (from sections above) to specific Demandbase capabilities. Reference THEIR goals — e.g., "Given ${companyName}'s stated goal of **$X ARR by YYYY** [N], **Demandbase One's** pipeline analytics could help them [specific outcome]."
- **Product Fit** (be specific, not generic):
  * **Demandbase One** (ABM, sales intelligence, pipeline, buying groups): Only recommend if you can tie it to a specific stated need
  * **Advertising** (B2B-native DSP, account-based ads): Only recommend if they have a B2B GTM motion that would benefit
  * **Data** (account/people records, intent, technographics): Only recommend if they have a data gap or enrichment need
  For each product recommended, write one sentence in the format: "**[Product]** can help ${companyName} [specific outcome] in support of their [specific stated goal/initiative]."
- **Potential Champions**: Which roles/titles at this company would care most? (CMO, VP Demand Gen, CRO, etc.) and WHY based on their org structure or stated priorities
- **Conversation Starters**: 2-3 specific talk-track openers that reference the company's own announcements, earnings, or initiatives`}
~300-400 words.

${secData ? `\nSEC Filing Data Found:\n${secData}\n` : ""}
${productKnowledgeContext ? `\n${productKnowledgeContext}` : ""}
Respond in this exact JSON format:
{
  "companyName": "Official company name",
  "ticker": "STOCK_TICKER or null if private",
  "financialOutlook": "markdown as described above",
  "strategicDirection": "markdown as described above",
  "growthSignals": "markdown as described above",
  "risksAndChallenges": "markdown as described above",
  "demandbaseOpportunity": "markdown as described above",
  "sourcesUsed": ["SEC 10-K FY2024 | https://www.sec.gov/cgi-bin/browse-edgar?action=...", "Q3 2024 Earnings Call | https://investor.example.com/...", "Press Release MM/YYYY | https://example.com/press/...", "etc — numbered list; [1] in text refers to sourcesUsed[0], [2] to sourcesUsed[1], etc. Each entry MUST include a URL after a pipe | separator. Use the most direct public URL you can find (SEC EDGAR, investor relations, press releases, news articles). Format: 'Description | URL'"]
}`;

      const content = await chatCompletion({
        model: selectedModel,
        messages: [
          { role: "system", content: `You are a senior B2B sales strategist and financial analyst writing for a Demandbase sales team. Your audience knows Demandbase products; never explain what Demandbase does. Respond with valid JSON only. Every section must use **bold markdown** for key metrics, labels, and takeaways. Use bullet points, not paragraphs. Prioritize cited numbers and specific evidence over narrative. Never fabricate data; say 'Not publicly reported' if unknown.
${NO_DASH_RULE}` },
          { role: "user", content: analysisPrompt },
        ],
        jsonMode: true,
        maxTokens: 8192,
      });

      sendProgress("Synthesizing analysis and generating Demandbase opportunity assessment...");

      if (!content) {
        res.write(`data: ${JSON.stringify({ type: "error", error: "No analysis generated" })}\n\n`);
        res.end();
        return;
      }

      let parsed: any;
      try {
        parsed = parseAIJson(content);
      } catch {
        res.write(`data: ${JSON.stringify({ type: "error", error: "Failed to parse analysis" })}\n\n`);
        res.end();
        return;
      }

      const safeStr = (val: unknown, fallback = ""): string =>
        typeof val === "string" && val.trim() ? val.trim() : fallback;
      const safeArr = (val: unknown): string[] =>
        Array.isArray(val) ? val.filter((s): s is string => typeof s === "string") : [];

      const validatedName = safeStr(parsed.companyName, companyName);
      const validatedOutlook = safeStr(parsed.financialOutlook, "No financial outlook data available.");
      const validatedStrategy = safeStr(parsed.strategicDirection, "No strategic direction data available.");
      const validatedGrowth = safeStr(parsed.growthSignals, "No growth signal data available.");
      const validatedRisks = safeStr(parsed.risksAndChallenges, "No risks data available.");
      const validatedOpp = safeStr(parsed.demandbaseOpportunity, "No opportunity assessment available.");
      const validatedSources = safeArr(parsed.sourcesUsed);

      const fullAnalysis = `# ${validatedName} Analysis${parsed.ticker ? ` (${parsed.ticker})` : ""}

## Financial Outlook
${validatedOutlook}

## Strategic Direction
${validatedStrategy}

## Growth Signals
${validatedGrowth}

## Risks & Challenges
${validatedRisks}

## Demandbase Opportunity Assessment
${validatedOpp}`;

      const saved = await storage.createCompanyAnalysis({
        companyName: validatedName,
        companyWebsite: domain,
        ticker: typeof parsed.ticker === "string" ? parsed.ticker : null,
        financialOutlook: validatedOutlook,
        strategicDirection: validatedStrategy,
        growthSignals: validatedGrowth,
        risksAndChallenges: validatedRisks,
        demandbaseOpportunity: validatedOpp,
        fullAnalysis,
        sourcesUsed: validatedSources,
        model: selectedModel,
      });

      console.log(`[company-analysis] Analysis complete for ${parsed.companyName}: saved as ID ${saved.id}`);

      res.write(`data: ${JSON.stringify({ type: "complete", analysis: saved })}\n\n`);
      res.end();
    } catch (err) {
      console.error("Error in company analysis:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to analyze company" });
      } else {
        res.write(`data: ${JSON.stringify({ type: "error", error: "Analysis failed" })}\n\n`);
        res.end();
      }
    }
  });

  app.post("/api/company-analysis/:id/ask", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });

      const { question, model: requestedModel } = req.body;
      const selectedModel = requestedModel ? resolveModel(requestedModel) : "claude-haiku-4-5-20251001";
      if (!question || typeof question !== "string") {
        return res.status(400).json({ error: "Question is required" });
      }

      const analysis = await storage.getCompanyAnalysis(id);
      if (!analysis) return res.status(404).json({ error: "Analysis not found" });

      const analysisContext = `
COMPANY: ${analysis.companyName}${analysis.ticker ? ` (${analysis.ticker})` : ""}
WEBSITE: ${analysis.companyWebsite}
ANALYZED: ${new Date(analysis.createdAt).toLocaleDateString()}

FINANCIAL OUTLOOK:
${analysis.financialOutlook}

STRATEGIC DIRECTION:
${analysis.strategicDirection}

GROWTH SIGNALS:
${analysis.growthSignals}

RISKS & CHALLENGES:
${analysis.risksAndChallenges}

DEMANDBASE OPPORTUNITY ASSESSMENT:
${analysis.demandbaseOpportunity}

SOURCES USED: ${(analysis.sourcesUsed || []).join(", ")}
`.trim();

      const answer = await chatCompletion({
        model: selectedModel,
        messages: [
          {
            role: "system",
            content: `You answer questions about a company analysis. You must ONLY use information that appears in the analysis data provided below. If the answer is not in the analysis data, say "This information is not available in the analysis data." NEVER make up or infer information that isn't explicitly stated in the analysis.

Be concise and direct. Reference specific sections of the analysis when answering. Use markdown formatting for readability.
${NO_DASH_RULE}

ANALYSIS DATA:
${analysisContext}`,
          },
          { role: "user", content: question },
        ],
        maxTokens: 2048,
      });

      res.json({ answer: answer || "Unable to generate an answer." });
    } catch (err: any) {
      console.error("Error answering company analysis question:", err);
      res.status(500).json({ error: err.message || "Failed to answer question" });
    }
  });

  app.get("/api/product-knowledge", async (_req, res) => {
    try {
      const entries = await storage.getProductKnowledge();
      res.json(entries);
    } catch (err) {
      console.error("Error fetching product knowledge:", err);
      res.status(500).json({ error: "Failed to fetch product knowledge" });
    }
  });

  app.post("/api/product-knowledge", async (req, res) => {
    try {
      const entry = await storage.createProductKnowledge(req.body);
      res.json(entry);
    } catch (err) {
      console.error("Error creating product knowledge:", err);
      res.status(500).json({ error: "Failed to create product knowledge" });
    }
  });

  app.put("/api/product-knowledge/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      const updated = await storage.updateProductKnowledge(id, req.body);
      if (!updated) return res.status(404).json({ error: "Not found" });
      res.json(updated);
    } catch (err) {
      console.error("Error updating product knowledge:", err);
      res.status(500).json({ error: "Failed to update product knowledge" });
    }
  });

  app.delete("/api/product-knowledge/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      await storage.deleteProductKnowledge(id);
      res.json({ success: true });
    } catch (err) {
      console.error("Error deleting product knowledge:", err);
      res.status(500).json({ error: "Failed to delete product knowledge" });
    }
  });

  app.post("/api/product-knowledge/seed", async (req, res) => {
    try {
      const existing = await storage.getProductKnowledge();
      if (existing.length > 0 && !req.body.force) {
        return res.status(400).json({ error: "Product knowledge already exists. Send force=true to overwrite." });
      }
      if (req.body.force && existing.length > 0) {
        for (const e of existing) {
          await storage.deleteFeaturesByProduct(e.id);
          await storage.deleteProductKnowledge(e.id);
        }
      }

      const seedData: Array<{ productName: string; productType: string; parentName?: string; keyCapabilities: string; idealCustomerProfile: string; problemsItSolves: string; customerOutcomes: string; talkTrack: string; sortOrder: number }> = [
        {
          productName: "Demandbase One",
          productType: "suite",
          keyCapabilities: "- Unified ABM platform suite for sales and marketing alignment\n- 360 degree account view across the entire buyer journey\n- Encompasses Marketing and Sales products in one connected platform\n- Shared account intelligence, intent data, and buying group insights\n- Single pane of glass for the entire GTM team\n- AI powered buying group identification and mapping across products",
          idealCustomerProfile: "- B2B companies with complex, multi-stakeholder sales cycles\n- Organizations with both sales and marketing teams that need alignment\n- Companies with $10M+ revenue investing in account-based strategies\n- Businesses selling to enterprise or mid-market accounts\n- Organizations looking to move beyond lead-based to account-based GTM",
          problemsItSolves: "- Sales and marketing teams operating in silos with different account views\n- Wasted spend on accounts that are not in market or a good fit\n- No visibility into which accounts are actively researching solutions\n- Inability to identify and engage the full buying group\n- Pipeline generation is inefficient because reps do not know where to focus",
          customerOutcomes: "- **Coalfire**: 40% pipeline growth\n- **WorkForce Software**: 121% increase in in-market accounts\n- **Thales**: 2X MQAs, quadrupled CTRs, re-engaged 50% of targets\n- **SAP Concur**: +52% increase in revenue, 4X funnel velocity\n- **Thermo Fisher Scientific**: +50% growth in average deal size",
          talkTrack: "\"Your sales team is spending time on accounts that are not ready to buy. Demandbase One shows you which accounts are actively researching solutions like yours, who the decision-makers are, and exactly when to engage, so your reps focus on deals that will actually close.\"",
          sortOrder: 1,
        },
        {
          productName: "Demandbase One Marketing",
          productType: "product",
          parentName: "Demandbase One",
          keyCapabilities: "- Account selection, segmentation, and scoring for marketing teams\n- Web personalization by account, industry, or buying stage\n- Journey stages and automated campaign orchestration\n- ABM campaign analytics and account engagement measurement\n- Cross-channel orchestration across email, ads, web, and events\n- Intent-based audience building for targeted programs\n- Marketing attribution tied to account-level pipeline and revenue",
          idealCustomerProfile: "- B2B marketing teams running ABM or transitioning to ABM\n- Organizations with demand gen teams needing account-level targeting\n- Companies with marketing ops teams managing multi-channel campaigns\n- Businesses wanting to prove marketing's impact on pipeline and revenue\n- Marketing leaders looking to personalize at scale across channels",
          problemsItSolves: "- Marketing campaigns target broad audiences instead of in-market accounts\n- No way to personalize web experiences for target accounts\n- Campaign orchestration is manual and disconnected across channels\n- Marketing cannot prove pipeline attribution at the account level\n- Leads are generated but not connected to account-level buying signals",
          customerOutcomes: "- **Thales**: 2X MQAs, quadrupled CTRs across targeted campaigns\n- **WorkForce Software**: 121% increase in in-market accounts reached\n- 3-5X improvement in conversion rates on personalized pages\n- 40% faster funnel progression with automated orchestration\n- Marketing can attribute pipeline and revenue to specific campaigns and accounts",
          talkTrack: "\"Your marketing team is running campaigns to broad audiences and hoping the right accounts engage. Demandbase One Marketing lets you target the accounts that are actually in-market, personalize their experience, and orchestrate campaigns across every channel, then prove the pipeline impact.\"",
          sortOrder: 2,
        },
        {
          productName: "Demandbase One Sales",
          productType: "product",
          parentName: "Demandbase One",
          keyCapabilities: "- Surface in-market accounts with real-time buying signals\n- Map complete buying groups and identify missing stakeholders\n- AI-recommended contacts based on buying group role\n- Prescriptive dashboards that prioritize which accounts to pursue\n- Automated outreach triggers based on intent and engagement signals\n- Deep integration with CRM and sales engagement tools (Salesforce, Outreach, SalesLoft)\n- Account-level insights delivered directly in seller workflows",
          idealCustomerProfile: "- B2B sales organizations with 10+ reps selling to enterprise/mid-market\n- Companies where reps struggle to prioritize which accounts to work\n- Organizations with long, complex sales cycles (3+ months)\n- Sales teams that need better prospecting intelligence beyond LinkedIn\n- RevOps teams looking to improve pipeline quality and forecast accuracy",
          problemsItSolves: "- Reps waste 60%+ of their time on accounts that will never buy\n- No visibility into whether a target account is actively researching solutions\n- Cannot identify all stakeholders in a complex buying group\n- Outbound prospecting relies on guesswork rather than buying signals\n- Sales and marketing are misaligned on which accounts matter most",
          customerOutcomes: "- Reps focus on in-market accounts, increasing meeting rates by 30-50%\n- Buying group mapping reveals 3-5 additional stakeholders per deal\n- Prescriptive dashboards reduce time spent on account research by 40%\n- Intent-based outreach generates 2-3X higher response rates\n- Pipeline quality improves as reps engage accounts with demonstrated buying signals",
          talkTrack: "\"Your reps are spending most of their day figuring out who to call instead of actually selling. Demandbase One Sales shows them exactly which accounts are in-market right now, who the decision-makers are, and what they are researching, so every outreach is relevant and timely.\"",
          sortOrder: 3,
        },
        {
          productName: "Advertising (B2B DSP)",
          productType: "product",
          keyCapabilities: "- The ONLY demand-side platform built specifically for B2B\n- People-based targeting directed at decision-makers, not just companies\n- Build segments using buying group signals, intent data, and CRM data\n- True omnichannel activation: LinkedIn, Meta, Google, CTV, display\n- B2B-specific measurement: pipeline influence, account lift, engagement\n- Spot purchase intent before prospects visit your site\n- Trillions of behavioral signals for targeting precision",
          idealCustomerProfile: "- B2B companies spending $50K+/month on digital advertising\n- Organizations frustrated with consumer ad platforms delivering irrelevant impressions\n- Companies needing to reach specific decision-makers at target accounts\n- Marketing teams that need to prove ad spend ties to pipeline, not just clicks\n- Businesses with long sales cycles where brand awareness matters at the account level",
          problemsItSolves: "- Consumer ad tech (Google, Meta) optimizes for clicks and impressions, not pipeline\n- B2B advertisers waste budget reaching the wrong people at the wrong companies\n- No way to measure whether ad spend actually influenced pipeline or revenue\n- Cannot target specific buying group members across channels\n- Advertising and sales/marketing data are completely disconnected",
          customerOutcomes: "- **Adobe**: 3X increase in visitor-to-lead conversions\n- **Ingram Micro**: +83% increase in pipeline velocity\n- **Thales**: Quadrupled CTRs across targeted campaigns\n- Customers consistently report 30-50% reduction in wasted ad spend\n- Pipeline influence attribution shows direct connection between ad exposure and deal progression",
          talkTrack: "\"Your ads are not broken, your ad tech is. Consumer platforms like Google and Meta were not built for B2B. They optimize for clicks from anyone. Demandbase B2B DSP targets the actual decision-makers at your target accounts and measures what matters: pipeline, not impressions.\"",
          sortOrder: 4,
        },
        {
          productName: "Data",
          productType: "product",
          keyCapabilities: "- Combines curated 1st-party and 3rd-party data with advanced AI\n- Account identification: turns anonymous traffic into identified accounts (1T+ monthly signals)\n- Firmographic data from 40,000+ providers\n- 150M+ verified B2B contact database\n- Technographic intelligence: technology stack data for every account\n- Intent data: proprietary buying signals showing active research behavior\n- Data enrichment and gap-filling for CRM and MAP records",
          idealCustomerProfile: "- Companies with incomplete or outdated CRM/MAP data\n- Organizations that need to identify anonymous website visitors\n- Sales teams that lack visibility into prospect tech stacks\n- Marketing teams that need better account segmentation and targeting\n- Businesses looking to understand which accounts are actively in-market",
          problemsItSolves: "- CRM data is stale, incomplete, or inaccurate, and reps waste time on bad data\n- Cannot identify who is visiting your website or what they are researching\n- No visibility into prospect technology stacks for competitive displacement\n- Missing contacts in buying groups, cannot reach all decision-makers\n- Relying on third-party intent data that is generic and not actionable",
          customerOutcomes: "- Customers report 40-60% improvement in data accuracy after enrichment\n- Anonymous traffic identification reveals 2-3X more engaged accounts than form fills alone\n- Buying group gap-filling increases average contacts per opportunity by 35%\n- Intent data enables 25-40% higher response rates on outbound campaigns\n- Technographic data drives competitive displacement motions with 2X higher win rates",
          talkTrack: "\"How confident are you in your CRM data right now? Most B2B companies have 30-40% data decay annually. Demandbase Data gives you accurate firmographic, contact, technographic, and intent data, so you know exactly who to target, what tech they use, and when they are actively looking.\"",
          sortOrder: 5,
        },
        {
          productName: "Agentbase (AI Agents)",
          productType: "product",
          keyCapabilities: "- Connected AI agents for total go-to-market alignment\n- AI agents work together, powered by unified data\n- Automates execution across the customer journey\n- Builds buying groups in seconds: identifies personas, maps contacts, fills gaps\n- AI-powered account scoring and prioritization\n- Automated signal detection and recommended actions\n- Runs on trusted, connected data ensuring team alignment",
          idealCustomerProfile: "- Forward-thinking B2B organizations investing in AI/automation\n- Companies with mature ABM programs ready for the next evolution\n- Organizations that want to reduce manual GTM processes\n- Teams looking to scale personalized engagement without adding headcount\n- Companies evaluating AI agents for sales and marketing automation",
          problemsItSolves: "- GTM teams spend too much time on manual, repetitive tasks\n- Buying group mapping is slow and incomplete without AI\n- Account scoring models are static and do not adapt to real-time signals\n- Teams cannot scale personalized engagement across thousands of accounts\n- Disconnected point solutions create fragmented AI experiences",
          customerOutcomes: "- AI-built buying groups are created in seconds vs. hours of manual research\n- Automated signal detection surfaces opportunities reps would otherwise miss\n- Connected agents ensure consistent messaging across sales and marketing touchpoints\n- Early adopters report 2-3X improvement in GTM team productivity\n- Reduction in manual data entry and research time across GTM teams",
          talkTrack: "\"The future of ABM is not more dashboards, it is AI agents that actually do the work. Agentbase builds your buying groups, scores your accounts, and recommends next actions, all connected, all using the same data, so your entire GTM team moves as one.\"",
          sortOrder: 6,
        },
        {
          productName: "Buying Groups",
          productType: "product",
          keyCapabilities: "- Maps every persona, role, and action inside a B2B buying group\n- AI agent builds buying groups in seconds\n- Identifies right personas and maps known contacts\n- Fills gaps with 150M+ contact database\n- Surfaces missing roles, highlights active engagement, identifies silent influencers\n- Prescriptive dashboards prioritize accounts by buying group completeness\n- Integrates buying group insights into ABM campaigns and sales workflows",
          idealCustomerProfile: "- B2B companies selling to buying committees of 5+ people\n- Organizations where deals stall because not all stakeholders are engaged\n- Companies with average deal sizes of $50K+ where multi-threading is critical\n- Sales teams that struggle to identify all decision-makers and influencers\n- Marketing teams running ABM who want to evolve to Buying Group Marketing (BGM)",
          problemsItSolves: "- Deals stall or are lost because key stakeholders are not identified or engaged\n- Marketing generates leads but cannot connect them to buying groups or deals\n- Sales reps only talk to one champion and miss the broader committee\n- No visibility into which roles are engaged vs. silent in a deal\n- Traditional ABM targets accounts but does not go deep enough into who is buying",
          customerOutcomes: "- Buying group completeness scores increase average deal size by 20-30%\n- Multi-threaded deals close 2X faster than single-threaded deals\n- Gap-filling identifies 3-5 additional contacts per opportunity\n- Marketing can attribute engagement to specific buying group roles\n- Win rates increase when 3+ buying group members are actively engaged",
          talkTrack: "\"Leads give you a name. Accounts give you a company. But buying groups show you who actually moves a deal forward. Demandbase maps every persona, role, and action in the buying group, so you know who is engaged, who is missing, and where to focus to close faster.\"",
          sortOrder: 7,
        },
      ];

      const featureSeedData: Record<string, Array<{ featureName: string; keyCapabilities: string; keyPersonas: string; problemsItSolves: string; customerOutcomes: string; talkTrack: string; sortOrder: number }>> = {
        "Demandbase One Marketing": [
          {
            featureName: "Web Personalization",
            keyCapabilities: "- Personalize website experiences by account, industry, or buying stage\n- Dynamic content swapping based on firmographic and intent signals\n- A/B test personalized vs. generic experiences\n- No-code visual editor for marketing teams",
            keyPersonas: "- VP/Director of Demand Generation\n- Digital Marketing Manager\n- Web Marketing Manager\n- Marketing Operations lead",
            problemsItSolves: "- Website delivers the same generic experience to every visitor\n- High-value target accounts see irrelevant content and bounce\n- No way to tailor messaging by industry, company size, or buying stage",
            customerOutcomes: "- **3-5X improvement** in conversion rates on personalized pages\n- Increased time-on-site and engagement from target accounts\n- Faster pipeline creation from high-intent website visitors",
            talkTrack: "\"Every visitor to your site gets the same experience, whether they are a Fortune 500 target account or a random visitor. Web personalization lets you show your most relevant content to the accounts that matter most, exactly when they are researching.\"",
            sortOrder: 1,
          },
          {
            featureName: "Journey Stages & Orchestration",
            keyCapabilities: "- Define custom account journey stages (Awareness, MQA, Opportunity, Customer)\n- Automated stage progression based on engagement and intent signals\n- Trigger campaigns, alerts, and sales plays based on stage transitions\n- Cross-channel orchestration across email, ads, sales, and web",
            keyPersonas: "- VP of Marketing\n- ABM/Campaign Manager\n- Marketing Operations lead\n- RevOps leader",
            problemsItSolves: "- No visibility into where accounts are in the buying journey\n- Marketing and sales cannot agree on account readiness\n- Campaigns are triggered manually instead of based on real buying signals",
            customerOutcomes: "- **40% faster** progression through the funnel with automated orchestration\n- Marketing and sales aligned on a single view of account readiness\n- Reduced manual campaign management effort",
            talkTrack: "\"Do you know which of your target accounts are in the awareness stage vs. actively evaluating? Journey stages give your entire GTM team a shared view of where every account is, and automatically trigger the right actions at the right time.\"",
            sortOrder: 2,
          },
          {
            featureName: "ABM Analytics & Attribution",
            keyCapabilities: "- Account-level engagement analytics across all channels\n- Pipeline and revenue attribution tied to marketing programs\n- Custom reporting dashboards for ABM performance\n- Funnel analytics showing account progression through stages",
            keyPersonas: "- VP of Marketing\n- Marketing Operations lead\n- CMO\n- Revenue Operations leader",
            problemsItSolves: "- Cannot prove marketing's impact on pipeline at the account level\n- Attribution models are lead-based and miss account-level engagement\n- No unified view of how campaigns influence account progression",
            customerOutcomes: "- Clear visibility into which programs drive pipeline and revenue\n- Marketing can justify budget with account-level attribution data\n- Faster optimization of campaigns based on account engagement metrics",
            talkTrack: "\"Can you tell your CEO exactly which marketing programs drove pipeline last quarter, at the account level? ABM Analytics connects your campaigns to pipeline and revenue so you can prove impact and double down on what works.\"",
            sortOrder: 3,
          },
        ],
        "Demandbase One Sales": [
          {
            featureName: "Prescriptive Sales Dashboards",
            keyCapabilities: "- AI-prioritized account lists updated in real-time\n- Combines intent signals, engagement data, and fit scores\n- Recommends specific actions for each account\n- Embeds directly into Salesforce or CRM workflow",
            keyPersonas: "- CRO / VP of Sales\n- Sales Development Manager\n- RevOps / Sales Ops lead\n- Frontline Sales Manager",
            problemsItSolves: "- Reps rely on gut feel or static lists to decide who to call\n- No real-time signal about which accounts are actively in-market\n- Managers cannot see or influence rep prioritization at scale",
            customerOutcomes: "- **30-50% increase** in meetings booked by focusing on in-market accounts\n- Reps save 5+ hours/week on research and prioritization\n- Managers gain visibility into rep account coverage and focus",
            talkTrack: "\"How do your reps decide who to call first each morning? If the answer is gut feel or alphabetical order, you are leaving pipeline on the table. Prescriptive dashboards show reps exactly which accounts are in-market right now and what action to take.\"",
            sortOrder: 1,
          },
          {
            featureName: "Buying Group Mapping for Sales",
            keyCapabilities: "- Visual buying group map showing all identified stakeholders\n- AI identifies missing roles and recommends contacts to fill gaps\n- Real-time engagement tracking per buying group member\n- Multi-threading guidance to increase deal velocity",
            keyPersonas: "- Account Executives\n- Sales Development Reps\n- Sales Managers\n- RevOps teams",
            problemsItSolves: "- Reps are single-threaded and only engaging one contact per deal\n- No visibility into who else is involved in the buying decision\n- Deals stall because key influencers or blockers are not identified",
            customerOutcomes: "- 3-5 additional stakeholders identified per opportunity\n- Multi-threaded deals close 2X faster\n- Higher win rates when 3+ buying group members are engaged",
            talkTrack: "\"Your reps are talking to one person per deal and hoping that is enough. Buying Group Mapping shows them every stakeholder involved in the decision, who is engaged, who is missing, and exactly who to reach out to next.\"",
            sortOrder: 2,
          },
        ],
        "Advertising (B2B DSP)": [
          {
            featureName: "Connected TV (CTV) for B2B",
            keyCapabilities: "- Serve video ads on streaming platforms to decision-makers at target accounts\n- Account-level targeting on CTV, not available on consumer platforms\n- Measure account engagement and pipeline influence from CTV campaigns\n- Complement display and social with premium video experiences",
            keyPersonas: "- VP of Marketing\n- Director of Digital Marketing\n- Brand Marketing Manager\n- Head of Demand Gen",
            problemsItSolves: "- B2B brands cannot reach decision-makers on streaming platforms with account-level targeting\n- TV/video advertising has zero B2B measurement, cannot tie it to pipeline\n- Consumer CTV platforms do not support account-based targeting",
            customerOutcomes: "- 2-3X higher brand recall compared to display-only campaigns\n- Measurable account lift and engagement from CTV ad exposure\n- Premium brand positioning that competitors cannot match in B2B",
            talkTrack: "\"Your buyers are watching streaming TV every night, but you cannot reach them there with B2B targeting. Demandbase CTV lets you serve video ads to decision-makers at your target accounts on platforms like Hulu and Roku, and actually measure the pipeline impact.\"",
            sortOrder: 1,
          },
        ],
        "Data": [
          {
            featureName: "Account Identification",
            keyCapabilities: "- Turns anonymous website traffic into identified accounts\n- Processes 1T+ monthly signals for identification accuracy\n- IP-based and cookie-less identification methods\n- Real-time account identification as visitors browse",
            keyPersonas: "- Marketing Operations\n- Web Analytics Manager\n- Demand Gen leaders\n- RevOps teams",
            problemsItSolves: "- 98% of website visitors leave without filling out a form\n- Cannot connect anonymous traffic to target account lists\n- Missing visibility into which accounts are actively engaging with your site",
            customerOutcomes: "- Reveals 2-3X more engaged accounts than form fills alone\n- Real-time alerts when target accounts visit key pages\n- Enables personalized follow-up for anonymous visitors from target accounts",
            talkTrack: "\"98% of your website visitors leave without ever filling out a form. Account Identification tells you which companies they work for, so your marketing and sales teams can follow up with the right message at the right time.\"",
            sortOrder: 1,
          },
          {
            featureName: "Intent Data",
            keyCapabilities: "- Proprietary buying signals showing active research behavior\n- Keyword-level intent tracking across the web\n- Competitive intent signals showing research on competitor solutions\n- Real-time intent scoring for account prioritization",
            keyPersonas: "- Demand Gen leaders\n- Sales Development managers\n- ABM/Campaign Managers\n- RevOps teams",
            problemsItSolves: "- No visibility into which accounts are researching solutions before they visit your site\n- Cannot prioritize accounts based on actual buying behavior\n- Generic third-party intent data lacks specificity and actionability",
            customerOutcomes: "- 25-40% higher response rates on intent-based outbound campaigns\n- Earlier engagement with accounts before competitors\n- Sales teams focus on accounts with demonstrated buying signals",
            talkTrack: "\"What if you could see which accounts are actively researching solutions like yours, before they ever visit your website? Intent Data surfaces those buying signals so you can engage accounts at exactly the right moment.\"",
            sortOrder: 2,
          },
        ],
      };

      const created = [];
      const parentIdMap: Record<string, number> = {};
      for (const data of seedData) {
        const parentId = data.parentName ? parentIdMap[data.parentName] : undefined;
        const { parentName, ...insertData } = data;
        const entry = await storage.createProductKnowledge({
          ...insertData,
          parentId: parentId || null,
        });
        created.push(entry);
        parentIdMap[data.productName] = entry.id;

        const features = featureSeedData[data.productName];
        if (features) {
          for (const feat of features) {
            await storage.createProductFeature({ ...feat, productId: entry.id });
          }
        }
      }

      res.json({ success: true, count: created.length, entries: created });
    } catch (err) {
      console.error("Error seeding product knowledge:", err);
      res.status(500).json({ error: "Failed to seed product knowledge" });
    }
  });

  app.get("/api/product-knowledge/:id/features", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      const features = await storage.getFeaturesByProduct(id);
      res.json(features);
    } catch (err) {
      console.error("Error fetching features:", err);
      res.status(500).json({ error: "Failed to fetch features" });
    }
  });

  app.post("/api/product-knowledge/:id/features", async (req, res) => {
    try {
      const productId = parseInt(req.params.id);
      if (isNaN(productId)) return res.status(400).json({ error: "Invalid ID" });
      const parsed = insertProductFeatureSchema.safeParse({ ...req.body, productId });
      if (!parsed.success) return res.status(400).json({ error: "Invalid data", details: parsed.error.format() });
      const feature = await storage.createProductFeature(parsed.data);
      res.json(feature);
    } catch (err) {
      console.error("Error creating feature:", err);
      res.status(500).json({ error: "Failed to create feature" });
    }
  });

  app.put("/api/product-features/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      const partialSchema = insertProductFeatureSchema.partial();
      const parsed = partialSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid data", details: parsed.error.format() });
      const updated = await storage.updateProductFeature(id, parsed.data);
      if (!updated) return res.status(404).json({ error: "Not found" });
      res.json(updated);
    } catch (err) {
      console.error("Error updating feature:", err);
      res.status(500).json({ error: "Failed to update feature" });
    }
  });

  app.delete("/api/product-features/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      await storage.deleteProductFeature(id);
      res.json({ success: true });
    } catch (err) {
      console.error("Error deleting feature:", err);
      res.status(500).json({ error: "Failed to delete feature" });
    }
  });

  const PRODUCT_OVERLAP_CATEGORIES = [
    "Platform Overview",
    "Marketing (ABX)",
    "Sales Intelligence",
    "Advertising & B2B DSP",
    "Data & Account Intelligence",
    "AI & Agentbase",
    "Buying Groups",
    "Messaging & Positioning",
  ];

  app.get("/api/product-knowledge/overlaps", async (_req, res) => {
    try {
      const products = await storage.getProductKnowledge();
      if (products.length === 0) return res.json({ overlaps: [], count: 0 });

      const allEntries = await storage.getKnowledgeEntries();
      const overlaps = allEntries.filter(e =>
        e.isActive && PRODUCT_OVERLAP_CATEGORIES.includes(e.category)
      );
      res.json({ overlaps, count: overlaps.length });
    } catch (err) {
      console.error("Error checking overlaps:", err);
      res.status(500).json({ error: "Failed to check overlaps" });
    }
  });

  app.post("/api/product-knowledge/deactivate-overlaps", async (req, res) => {
    try {
      const allEntries = await storage.getKnowledgeEntries();
      const overlaps = allEntries.filter(e =>
        e.isActive && PRODUCT_OVERLAP_CATEGORIES.includes(e.category)
      );
      let deactivated = 0;
      for (const entry of overlaps) {
        await storage.updateKnowledgeEntry(entry.id, { isActive: false });
        deactivated++;
      }
      res.json({ success: true, deactivated });
    } catch (err) {
      console.error("Error deactivating overlaps:", err);
      res.status(500).json({ error: "Failed to deactivate overlaps" });
    }
  });

  app.get("/api/slide-designs", async (_req, res) => {
    try {
      const designs = await storage.getSlideDesigns();
      res.json(designs);
    } catch (err) {
      console.error("Error fetching slide designs:", err);
      res.status(500).json({ error: "Failed to fetch slide designs" });
    }
  });

  app.get("/api/slide-designs/approved", async (_req, res) => {
    try {
      const designs = await storage.getApprovedSlideDesigns();
      res.json(designs);
    } catch (err) {
      console.error("Error fetching approved slide designs:", err);
      res.status(500).json({ error: "Failed to fetch approved slide designs" });
    }
  });

  app.patch("/api/slide-designs/:id/approve", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      const updated = await storage.updateSlideDesign(id, { isApproved: true });
      if (!updated) return res.status(404).json({ error: "Design not found" });
      res.json(updated);
    } catch (err) {
      console.error("Error approving slide design:", err);
      res.status(500).json({ error: "Failed to approve design" });
    }
  });

  app.patch("/api/slide-designs/:id/unapprove", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      const design = await storage.getSlideDesign(id);
      if (!design) return res.status(404).json({ error: "Design not found" });
      const siblings = await storage.getSlideDesignsByLayoutType(design.layoutType);
      const approvedSiblings = siblings.filter(s => s.isApproved && s.id !== id);
      if (approvedSiblings.length === 0) {
        return res.status(400).json({ error: "Cannot unapprove the only approved design for this layout type. At least one variant must remain approved." });
      }
      const updated = await storage.updateSlideDesign(id, { isApproved: false });
      res.json(updated);
    } catch (err) {
      console.error("Error unapproving slide design:", err);
      res.status(500).json({ error: "Failed to unapprove design" });
    }
  });

  app.delete("/api/slide-designs/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      const design = await storage.getSlideDesign(id);
      if (!design) return res.status(404).json({ error: "Design not found" });
      const siblings = await storage.getSlideDesignsByLayoutType(design.layoutType);
      if (siblings.length <= 1) {
        return res.status(400).json({ error: "Cannot delete the last design for this layout type." });
      }
      if (design.isApproved) {
        const approvedSiblings = siblings.filter(s => s.isApproved && s.id !== id);
        if (approvedSiblings.length === 0) {
          return res.status(400).json({ error: "Cannot delete the only approved design for this layout type. Approve another variant first." });
        }
      }
      await storage.deleteSlideDesign(id);
      res.json({ success: true });
    } catch (err) {
      console.error("Error deleting slide design:", err);
      res.status(500).json({ error: "Failed to delete design" });
    }
  });

  app.post("/api/slide-designs", async (req, res) => {
    try {
      const schema = z.object({
        layoutType: z.string(),
        variantName: z.string().min(1),
        description: z.string(),
        designNotes: z.string(),
        sampleTitle: z.string(),
        sampleBody: z.string(),
        isApproved: z.boolean().default(false),
        isDefault: z.boolean().default(false),
        sourceFile: z.string().nullable().optional(),
        designTemplate: z.string().optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
      const created = await storage.createSlideDesign(parsed.data);
      res.json(created);
    } catch (err) {
      console.error("Error creating slide design:", err);
      res.status(500).json({ error: "Failed to create design" });
    }
  });

  app.get("/api/slide-outlines", async (_req, res) => {
    try {
      const designs = await storage.getSlideDesigns();
      const layouts = designs.map(d => ({
        id: d.layoutType,
        dbId: d.id,
        name: `${d.layoutType.charAt(0).toUpperCase() + d.layoutType.slice(1)} Slide${d.variantName !== "Standard" ? ` — ${d.variantName}` : ""}`,
        variantName: d.variantName,
        description: d.description,
        sample: { title: d.sampleTitle, body: d.sampleBody, layout: d.layoutType },
        designNotes: d.designNotes,
        isApproved: d.isApproved,
        isDefault: d.isDefault,
        sourceFile: d.sourceFile,
        designTemplate: d.designTemplate || "Classic",
      }));
      res.json(layouts);
    } catch (err) {
      console.error("Error fetching slide outlines:", err);
      res.status(500).json({ error: "Failed to fetch slide outlines" });
    }
  });

  app.get("/api/slide-templates", async (_req, res) => {
    try {
      const designs = await storage.getSlideDesigns();
      const templateMap: Record<string, number> = {};
      designs.forEach(d => {
        const t = d.designTemplate || "Classic";
        templateMap[t] = (templateMap[t] || 0) + 1;
      });
      const templates = Object.entries(templateMap).map(([name, count]) => ({ name, count }));
      res.json(templates);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch slide templates" });
    }
  });

  app.post("/api/slide-outlines/feedback", async (req, res) => {
    try {
      const schema = z.object({
        dbId: z.number(),
        layoutId: z.string(),
        layoutName: z.string(),
        designNotes: z.string(),
        sampleTitle: z.string(),
        sampleBody: z.string(),
        feedback: z.string().min(1).max(2000),
        conversationHistory: z.array(z.object({
          role: z.enum(["user", "assistant"]),
          content: z.string(),
        })).optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
      }

      const { dbId, layoutId, layoutName, designNotes, sampleTitle, sampleBody, feedback, conversationHistory } = parsed.data;

      const systemPrompt = `You are a presentation design expert for Demandbase, a B2B marketing and sales technology company.

You are helping refine the design of a specific slide layout called "${layoutName}" (type: ${layoutId}).

Current design specifications:
${designNotes}

Current sample content:
- Title: ${sampleTitle}
- Body: ${sampleBody}

Brand colors:
- Midnight: #0D1846 (primary dark)
- Sky: #4CA3FF (primary blue accent)
- Sunset: #FF7C33 (secondary orange accent)
- Cloud: #F8FAFC (light background)
- Sky Tint: #DBECFF (light blue background)
- Lavender: #8B5CF6 (tertiary accent)

Fonts: Roboto Serif (headlines), Roboto (body text)

The user is providing feedback about this slide design. You MUST respond with valid JSON only (no markdown, no code fences). Use this exact structure:

{
  "explanation": "Brief explanation of what you changed and why (2-3 sentences)",
  "proposedDesignNotes": "The complete updated design notes string, incorporating the user's feedback. Keep the same format as the current design notes but with changes applied.",
  "proposedSampleTitle": "Updated sample title (can stay the same if feedback doesn't affect it)",
  "proposedSampleBody": "Updated sample body text (can stay the same if feedback doesn't affect it)"
}

Important rules:
- Always return the COMPLETE design notes, not just the changes
- Keep sample content relevant to the layout type
- For stats layout, body format is: "value | label" per line
- For comparison/objection layout, body uses "---" to separate columns
- For quote layout, first line is the quote, second line is attribution starting with "—"
- Only change what the user's feedback asks for. Keep everything else the same.
${NO_DASH_RULE}`;

      const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
        { role: "system", content: systemPrompt },
      ];

      if (conversationHistory && conversationHistory.length > 0) {
        for (const msg of conversationHistory) {
          messages.push({ role: msg.role as "user" | "assistant", content: msg.content });
        }
      }

      messages.push({ role: "user", content: feedback });

      const raw = await chatCompletion({
        model: "claude-sonnet-4-6",
        messages,
        maxTokens: 1500,
        jsonMode: true,
      });

      let proposal;
      try {
        proposal = JSON.parse(raw);
      } catch {
        return res.status(500).json({ error: "AI returned invalid JSON" });
      }

      if (!proposal.explanation || !proposal.proposedDesignNotes) {
        return res.status(500).json({ error: "AI response missing required fields" });
      }

      const finalTitle = (proposal.proposedSampleTitle || "").trim() || sampleTitle;
      const finalBody = (proposal.proposedSampleBody || "").trim() || sampleBody;
      const finalNotes = (proposal.proposedDesignNotes || "").trim() || designNotes;

      res.json({
        layoutId,
        dbId,
        explanation: proposal.explanation,
        proposedDesignNotes: finalNotes,
        proposedSampleTitle: finalTitle,
        proposedSampleBody: finalBody,
      });
    } catch (err) {
      console.error("Error processing slide feedback:", err);
      res.status(500).json({ error: "Failed to process feedback" });
    }
  });

  app.patch("/api/slide-designs/:id/apply-feedback", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });

      const schema = z.object({
        designNotes: z.string().min(1),
        sampleTitle: z.string().min(1),
        sampleBody: z.string().min(1),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
      }

      const existing = await storage.getSlideDesign(id);
      if (!existing) return res.status(404).json({ error: "Design not found" });

      const updated = await storage.updateSlideDesign(id, {
        designNotes: parsed.data.designNotes,
        sampleTitle: parsed.data.sampleTitle,
        sampleBody: parsed.data.sampleBody,
      });
      res.json(updated);
    } catch (err) {
      console.error("Error applying feedback:", err);
      res.status(500).json({ error: "Failed to apply feedback" });
    }
  });

  app.patch("/api/slide-designs/:id/rename", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });

      const schema = z.object({
        variantName: z.string().min(1).max(100),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
      }

      const existing = await storage.getSlideDesign(id);
      if (!existing) return res.status(404).json({ error: "Design not found" });

      const updated = await storage.updateSlideDesign(id, {
        variantName: parsed.data.variantName,
      });
      res.json(updated);
    } catch (err) {
      console.error("Error renaming design:", err);
      res.status(500).json({ error: "Failed to rename design" });
    }
  });

  app.post("/api/slide-designs/:id/duplicate", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });

      const schema = z.object({
        designTemplate: z.string().min(1).max(100),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
      }

      const existing = await storage.getSlideDesign(id);
      if (!existing) return res.status(404).json({ error: "Design not found" });

      const created = await storage.createSlideDesign({
        layoutType: existing.layoutType,
        variantName: existing.variantName,
        description: existing.description,
        designNotes: existing.designNotes,
        sampleTitle: existing.sampleTitle,
        sampleBody: existing.sampleBody,
        isApproved: existing.isApproved,
        isDefault: false,
        sourceFile: existing.sourceFile,
        designTemplate: parsed.data.designTemplate,
      });
      res.json(created);
    } catch (err) {
      console.error("Error duplicating design:", err);
      res.status(500).json({ error: "Failed to duplicate design" });
    }
  });

  app.patch("/api/slide-designs/:id/move", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });

      const schema = z.object({
        designTemplate: z.string().min(1).max(100),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
      }

      const existing = await storage.getSlideDesign(id);
      if (!existing) return res.status(404).json({ error: "Design not found" });

      const updated = await storage.updateSlideDesign(id, {
        designTemplate: parsed.data.designTemplate,
      });
      res.json(updated);
    } catch (err) {
      console.error("Error moving design:", err);
      res.status(500).json({ error: "Failed to move design" });
    }
  });

  app.patch("/api/slide-templates/rename", async (req, res) => {
    try {
      const schema = z.object({
        oldName: z.string().min(1).max(100),
        newName: z.string().min(1).max(100),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
      }

      const designs = await storage.getSlideDesigns();
      const matching = designs.filter(d => (d.designTemplate || "Classic") === parsed.data.oldName);
      if (matching.length === 0) {
        return res.status(404).json({ error: "Template not found" });
      }

      for (const design of matching) {
        await storage.updateSlideDesign(design.id, { designTemplate: parsed.data.newName });
      }

      res.json({ success: true, updated: matching.length });
    } catch (err) {
      console.error("Error renaming template:", err);
      res.status(500).json({ error: "Failed to rename template" });
    }
  });

  async function computeImageFingerprint(data: Buffer): Promise<string> {
    try {
      const pixels = await sharp(data)
        .resize(8, 8, { fit: "fill" })
        .grayscale()
        .raw()
        .toBuffer();
      const avg = pixels.reduce((sum, v) => sum + v, 0) / pixels.length;
      let hash = "";
      for (let i = 0; i < pixels.length; i++) {
        hash += pixels[i] >= avg ? "1" : "0";
      }
      return hash;
    } catch {
      return `fallback_${data.length}_${data[0]}_${data[Math.floor(data.length / 2)]}`;
    }
  }

  function hammingDistance(a: string, b: string): number {
    let dist = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
      if (a[i] !== b[i]) dist++;
    }
    return dist + Math.abs(a.length - b.length);
  }

  async function deduplicateSlideImages(images: ExtractedImage[]): Promise<ExtractedImage[]> {
    const perSlide = new Map<number, ExtractedImage>();
    for (const img of images) {
      if (!perSlide.has(img.slideNum) || img.data.length > (perSlide.get(img.slideNum)?.data.length || 0)) {
        perSlide.set(img.slideNum, img);
      }
    }
    const candidates = Array.from(perSlide.values()).sort((a, b) => a.slideNum - b.slideNum);
    if (candidates.length <= 1) return candidates;

    console.log(`[dedup] Computing fingerprints for ${candidates.length} slide images...`);
    const fingerprints: { img: ExtractedImage; hash: string }[] = [];
    for (const img of candidates) {
      const hash = await computeImageFingerprint(img.data);
      fingerprints.push({ img, hash });
    }

    const kept: { img: ExtractedImage; hash: string }[] = [fingerprints[0]];
    const SIMILARITY_THRESHOLD = 10;
    for (let i = 1; i < fingerprints.length; i++) {
      const fp = fingerprints[i];
      const isDuplicate = kept.some(k => hammingDistance(k.hash, fp.hash) < SIMILARITY_THRESHOLD);
      if (!isDuplicate) {
        kept.push(fp);
      }
    }

    console.log(`[dedup] ${candidates.length} slides -> ${kept.length} unique layouts`);

    return kept.map(k => k.img);
  }

  const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

  const SUPPORTED_VISION_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

  async function compressImageForVision(data: Buffer, mimeType: string): Promise<{ data: Buffer; mimeType: string }> {
    const needsConvert = !SUPPORTED_VISION_TYPES.has(mimeType);
    if (!needsConvert && data.length <= MAX_IMAGE_BYTES) return { data, mimeType };
    try {
      const meta = await sharp(data).metadata();
      const w = meta.width || 1920;
      const h = meta.height || 1080;

      let targetW = w;
      let targetH = h;
      if (w > 2048 || h > 2048) {
        const scale = 2048 / Math.max(w, h);
        targetW = Math.round(w * scale);
        targetH = Math.round(h * scale);
      }

      let compressed = await sharp(data)
        .resize(targetW, targetH, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();

      if (compressed.length > MAX_IMAGE_BYTES) {
        compressed = await sharp(data)
          .resize(Math.round(targetW * 0.7), Math.round(targetH * 0.7), { fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 60 })
          .toBuffer();
      }

      if (compressed.length > MAX_IMAGE_BYTES) {
        compressed = await sharp(data)
          .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 50 })
          .toBuffer();
      }

      if (needsConvert) {
        console.log(`[compress] Converted ${mimeType} -> image/jpeg (${(data.length / 1024).toFixed(0)}KB -> ${(compressed.length / 1024).toFixed(0)}KB)`);
      } else {
        console.log(`[compress] Image ${(data.length / 1024 / 1024).toFixed(1)}MB -> ${(compressed.length / 1024 / 1024).toFixed(1)}MB`);
      }
      return { data: compressed, mimeType: "image/jpeg" };
    } catch (err: any) {
      console.error(`[compress] Failed to compress image (${mimeType}): ${err.message}`);
      if (needsConvert) {
        return { data: Buffer.alloc(0), mimeType: "image/jpeg" };
      }
      return { data, mimeType };
    }
  }

  const SLIDE_DESIGN_ANALYSIS_INSTRUCTIONS = `You are a presentation VISUAL DESIGN analyst. Your job is to analyze slide images and recreate them as design patterns in our rendering system. Focus ENTIRELY on visual design: colors, backgrounds, imagery, shapes, accent elements, and where text blocks are positioned. The actual text content is irrelevant placeholder; only its placement, size, and styling matter.

WHAT TO ANALYZE IN EACH SLIDE:
  1. Background: solid color, gradient, or image. Identify exact colors (hex if possible).
  2. Accent elements: header bars, footer bars, side bars, divider lines. Note position, color, thickness.
  3. Decorative shapes: circles, rectangles, rounded corners, shadows, borders.
  4. Color palette: primary, secondary, accent colors. Map to Demandbase palette where close:
     Midnight=#0D1846, Sky=#4CA3FF, Sunset=#FF7C33, Cloud=#F8FAFC, SkyTint=#DBECFF, SunsetTint=#FFE4D6, Lavender=#8E6FD6, Hunter=#17575D, Cascade=#69BE28, Merlot=#882E52, Blush=#FF5162
  5. Text block positions: where does the title sit? Where does body text go? Left/center/right alignment? Font weight/size relative.
  6. Column structure: single column, two columns, three columns, grid layout.
  7. Image placement: full bleed, half page, small inset, icon row.

AVAILABLE LAYOUT TYPES (use as "existingLayoutId"):
  title, content, stats, comparison, section, statement, quote, objection, callout, closing, speakers, timeline

VARIANT KEYWORDS (put in "designNotes" to trigger the right visual style):
  title: "bold header", "minimal accent", "left accent bar", "image title layout", "sunset glass"
  content: "left accent bar", "tall accent bar", "dark header", "midnight header bar with white title", "two column lines", "four column", "three column images", "two column shapes", "three column shapes", "image content split", "numbered paragraphs", "numbered analysis", "dos donts", "bento grid", "bento large"
  stats: "stat cards", "card background", "midnight background"
  comparison: "contrast columns", "bordered columns", "colored left border"
  section: "accent bottom bar", "sky gradient section"
  statement: "midnight background", "pull-quote", "sunset gradient statement"
  quote: "midnight background", "minimal style"
  objection: "clean layout"
  callout: "sky gradient shape", "sky shape"
  closing: "warm closing", "lavender dot", "image cover closing", "image cover"
  speakers: "sky speakers"
  timeline: (standard, no keyword)

PLACEHOLDER CONTENT FORMAT (use generic placeholder text that matches the layout structure):
  stats: "85% | Close Rate\\n3.2x | Pipeline Growth\\n47% | Win Rate"
  comparison/objection: "**Column A**\\n- Point one\\n- Point two\\n---\\n**Column B**\\n- Point one\\n- Point two"
  quote: "Placeholder quote text here\\nSpeaker Name, Title"
  callout: "First callout item\\nSecond callout item\\nThird callout item"
  others: "- First bullet point\\n- Second bullet point\\n- Third bullet point"

CRITICAL: The sampleTitle and sampleBody are PLACEHOLDERS to show the layout structure, not actual content. Use short generic text like "Section Title Here" or "Key Insight Heading". The designNotes field is the most important output; it must contain the variant keywords AND detailed visual description so our renderer can recreate the design.

Never use em-dashes, en-dashes, or double-dashes. Use commas, semicolons, colons, or periods instead.

Respond ONLY with a JSON array (no markdown fences):
[
  {
    "name": "Descriptive Layout Name",
    "description": "Brief description of the visual design pattern",
    "isNew": false,
    "existingLayoutId": "content",
    "designNotes": "variant keywords + detailed color/layout description for recreation",
    "designDetails": "Full visual spec: exact colors, element positions, sizes, spacing, borders, shadows",
    "suggestedChanges": "What differs from the standard variant of this layout type",
    "sampleTitle": "Placeholder Title Text",
    "sampleBody": "Placeholder body formatted per the layout rules above",
    "slideNums": [1, 5]
  }
]`;

  function buildDeckAnalysisPrompt(extractedText: string): string {
    return `${SLIDE_DESIGN_ANALYSIS_INSTRUCTIONS}

Here is extracted text from the deck (for context on slide structure, NOT for content):
${extractedText}

Now analyze the slide images that follow. Identify each DISTINCT visual design pattern. Group slides with the same visual layout together. For each pattern, report which slides use it (slideNums).`;
  }

  function buildScreenshotAnalysisPrompt(): string {
    return `${SLIDE_DESIGN_ANALYSIS_INSTRUCTIONS}

Analyze this single slide screenshot. Identify its visual design pattern and produce exactly one entry in the JSON array. Focus on recreating the visual design: colors, backgrounds, accent elements, shapes, image placement, and text block positioning.`;
  }

  async function analyzeDeckImages(
    uniqueImages: ExtractedImage[],
    text: string,
    model: string,
    jobId: string
  ): Promise<{ designs: any[] }> {
    const MAX_IMAGES_PER_BATCH = 10;
    const batches: ExtractedImage[][] = [];
    for (let i = 0; i < uniqueImages.length; i += MAX_IMAGES_PER_BATCH) {
      batches.push(uniqueImages.slice(i, i + MAX_IMAGES_PER_BATCH));
    }

    console.log(`[deck:${jobId}] Processing ${uniqueImages.length} unique images in ${batches.length} batch(es)`);

    let allDesigns: any[] = [];

    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      const batch = batches[batchIdx];
      const visionContentParts: any[] = [
        {
          type: "text",
          text: buildDeckAnalysisPrompt(text.substring(0, batches.length === 1 ? 12000 : 6000)),
        }
      ];

      let validCount = 0;
      for (const img of batch) {
        const compressed = await compressImageForVision(img.data, img.mimeType);
        if (compressed.data.length === 0) {
          console.warn(`[deck:${jobId}] Skipping slide ${img.slideNum}: unsupported format ${img.mimeType}`);
          continue;
        }
        const base64 = compressed.data.toString("base64");
        visionContentParts.push({
          type: "image_url",
          image_url: { url: `data:${compressed.mimeType};base64,${base64}` }
        });
        visionContentParts.push({
          type: "text",
          text: `[Slide ${img.slideNum} image above]`
        });
        validCount++;
      }

      if (validCount === 0) {
        console.warn(`[deck:${jobId}] Batch ${batchIdx + 1}: no valid images, skipping`);
        continue;
      }

      console.log(`[deck:${jobId}] Batch ${batchIdx + 1}/${batches.length}: sending ${validCount} images to ${model}`);
      const aiContent = await chatCompletion({
        model,
        messages: [{ role: "user", content: visionContentParts }],
        maxTokens: 12000,
      });

      let batchDesigns: any[] = [];
      try {
        const jsonMatch = aiContent.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          batchDesigns = JSON.parse(jsonMatch[0]);
        }
      } catch (parseErr: any) {
        console.warn(`[deck:${jobId}] Batch ${batchIdx + 1} JSON parse failed: ${parseErr.message}`);
        batchDesigns = [{ name: "Analysis Result", description: aiContent, isNew: false, existingLayoutId: "content", designDetails: aiContent, suggestedChanges: "", sampleTitle: "Slide Title", sampleBody: "Content from deck analysis", slideNums: batch.map(b => b.slideNum) }];
      }

      allDesigns.push(...batchDesigns);
    }

    if (allDesigns.length === 0 && text.trim().length > 50) {
      allDesigns = [{ name: "Deck Analysis", description: "Design patterns could not be extracted automatically.", isNew: false, existingLayoutId: "content", designDetails: "", suggestedChanges: "", sampleTitle: "Analysis Result", sampleBody: "Review the design details for more information", slideNums: [] }];
    }

    const seen = new Map<string, any>();
    for (const d of allDesigns) {
      const layoutId = (d.existingLayoutId || "content").toLowerCase().trim();
      const nameNorm = (d.name || "").toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
      const key = layoutId + ":" + nameNorm;
      if (!seen.has(key)) {
        seen.set(key, d);
      } else {
        const existing = seen.get(key);
        existing.slideNums = [...(existing.slideNums || []), ...(d.slideNums || [])];
      }
    }
    const designs = Array.from(seen.values());
    console.log(`[deck] Post-AI dedup: ${allDesigns.length} -> ${designs.length} unique designs`);

    for (const d of designs) {
      if (!d.existingLayoutId) d.existingLayoutId = "content";
      if (!d.sampleTitle) d.sampleTitle = d.name || "Slide Title";
      if (!d.sampleBody) d.sampleBody = d.description || "- Sample body text";
      if (!d.designNotes) d.designNotes = d.designDetails || "";
      delete d.originalThumbnail;
    }

    return { designs };
  }

  app.post("/api/chunked-upload", (req: any, res, next) => {
    chunkUpload.single("chunk")(req, res, (err: any) => {
      if (err) {
        console.error(`[chunked-upload] Multer error: ${err.code || 'unknown'} - ${err.message}`);
        return res.status(400).json({ error: err.message || "Chunk upload failed" });
      }
      next();
    });
  }, async (req: any, res) => {
    try {
      const result = handleChunkUpload(req);
      if (!result.complete) {
        return res.json({ complete: false });
      }
      return res.json({ complete: true, filePath: result.filePath, filename: result.filename, size: result.size });
    } catch (err: any) {
      console.error(`[chunked-upload] Error:`, err.message);
      return res.status(400).json({ error: err.message });
    }
  });

  app.post("/api/slide-outlines/analyze-deck-chunked", express.json(), async (req: any, res) => {
    try {
      const { filePath, filename, size, model } = req.body;
      if (!filePath || !filename) {
        return res.status(400).json({ error: "Missing filePath or filename" });
      }
      if (!fs.existsSync(filePath)) {
        return res.status(400).json({ error: "Uploaded file not found. Please try uploading again." });
      }
      const originalname = filename;
      const selectedModel = resolveModel(model || "claude-sonnet-4-6");
      if (!originalname.toLowerCase().endsWith(".pptx")) {
        cleanupTempFile(filePath);
        return res.status(400).json({ error: "Only .pptx files are supported for slide analysis" });
      }

      const fileSize = size || fs.statSync(filePath).size;
      console.log(`[deck-chunked] Analyzing deck: ${originalname} (${(fileSize / 1024).toFixed(0)}KB) using ${selectedModel}`);

      const jobId = `deck_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await storage.createProcessingJob({
        jobId, section: "slide-outlines", filename: originalname, fileSize,
        status: "extracting_text", progress: 10, progressMessage: `Extracting slides (${selectedModel})...`,
      });

      res.json({ success: true, jobId, filename: originalname, status: "processing", model: selectedModel });

      const modelForJob = selectedModel;
      (async () => {
        try {
          console.log(`[deck:${jobId}] Extracting text+images from ${originalname}...`);
          const { text, images } = await extractTextAndImagesFromFile(filePath, originalname);
          cleanupTempFile(filePath);
          console.log(`[deck:${jobId}] Text extracted: ${text.length} chars, ${images.length} images`);

          if ((!text || text.trim().length < 50) && images.length === 0) {
            await storage.updateProcessingJob(jobId, { status: "error", error: "Could not extract enough content from the deck", completedAt: new Date() } as any);
            return;
          }

          await storage.updateProcessingJob(jobId, { status: "deduplicating", progress: 30, progressMessage: `Deduplicating ${images.length} slide images...` } as any);

          const uniqueImages = await deduplicateSlideImages(images);

          await storage.updateProcessingJob(jobId, { status: "ai_processing", progress: 40, progressMessage: `Analyzing ${uniqueImages.length} unique layouts with ${modelForJob}...` } as any);

          const { designs } = await analyzeDeckImages(uniqueImages, text, modelForJob, jobId);

          console.log(`[deck:${jobId}] Completed: ${designs.length} designs identified`);
          await storage.updateProcessingJob(jobId, {
            status: "done", progress: 100, progressMessage: "Complete",
            result: JSON.stringify({ filename: originalname, designs }),
            completedAt: new Date(),
          } as any);
        } catch (err: any) {
          console.error(`[deck:${jobId}] Processing error:`, err.message);
          await storage.updateProcessingJob(jobId, { status: "error", error: err.message, completedAt: new Date() } as any);
        }
      })();
    } catch (err: any) {
      console.error(`[deck-chunked] Error:`, err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/slide-outlines/analyze-deck", (req: any, res, next) => {
    console.log(`[deck-upload] Incoming deck upload request, content-length: ${req.headers['content-length'] || 'unknown'}`);
    upload.single("file")(req, res, (err: any) => {
      if (err) {
        console.error(`[deck-upload] Multer error: ${err.code || 'unknown'} - ${err.message}`);
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({ error: "File is too large. Maximum size is 500MB." });
        }
        return res.status(400).json({ error: err.message || "File upload failed" });
      }
      next();
    });
  }, async (req: any, res) => {
    try {
      if (!req.file) {
        console.error(`[deck-upload] No file in request after multer processing`);
        return res.status(400).json({ error: "No file uploaded" });
      }

      const { originalname, path: filePath, size } = req.file;
      const selectedModel = resolveModel(req.body?.model || "claude-sonnet-4-6");
      if (!originalname.toLowerCase().endsWith(".pptx")) {
        cleanupTempFile(filePath);
        return res.status(400).json({ error: "Only .pptx files are supported for slide analysis" });
      }

      console.log(`Analyzing deck for slide designs: ${originalname} (${(size / 1024).toFixed(0)}KB) using ${selectedModel}`);

      const jobId = `deck_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      await storage.createProcessingJob({
        jobId, section: "slide-outlines", filename: originalname, fileSize: size,
        status: "extracting_text", progress: 10, progressMessage: `Extracting slides (${selectedModel})...`,
      });

      res.json({ success: true, jobId, filename: originalname, status: "processing", model: selectedModel });

      const modelForJob = selectedModel;
      (async () => {
        try {
          console.log(`[deck:${jobId}] Extracting text+images from ${originalname}...`);
          const { text, images } = await extractTextAndImagesFromFile(filePath, originalname);
          cleanupTempFile(filePath);
          console.log(`[deck:${jobId}] Text extracted: ${text.length} chars, ${images.length} images`);

          if ((!text || text.trim().length < 50) && images.length === 0) {
            await storage.updateProcessingJob(jobId, { status: "error", error: "Could not extract enough content from the deck", completedAt: new Date() } as any);
            return;
          }

          await storage.updateProcessingJob(jobId, { status: "deduplicating", progress: 30, progressMessage: `Deduplicating ${images.length} slide images...` } as any);

          const uniqueImages = await deduplicateSlideImages(images);

          await storage.updateProcessingJob(jobId, { status: "ai_processing", progress: 40, progressMessage: `Analyzing ${uniqueImages.length} unique layouts with ${modelForJob}...` } as any);

          const { designs } = await analyzeDeckImages(uniqueImages, text, modelForJob, jobId);

          console.log(`[deck:${jobId}] Completed: ${designs.length} designs identified`);
          await storage.updateProcessingJob(jobId, {
            status: "done", progress: 100, progressMessage: "Complete",
            result: JSON.stringify({ filename: originalname, designs }),
            completedAt: new Date(),
          } as any);
        } catch (err: any) {
          console.error(`[deck:${jobId}] Background processing error:`, err);
          cleanupTempFile(filePath);
          await storage.updateProcessingJob(jobId, { status: "error", error: err.message || "Failed to analyze deck", completedAt: new Date() } as any);
        }
      })();
    } catch (err) {
      console.error("Error analyzing deck:", err);
      res.status(500).json({ error: "Failed to analyze deck" });
    }
  });

  app.get("/api/slide-outlines/analyze-deck-status/:jobId", async (req, res) => {
    const job = await storage.getProcessingJob(req.params.jobId);
    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }
    if (job.status === "done" || job.status === "completed") {
      return res.json({ status: "done", ...(job.result ? JSON.parse(job.result) : {}) });
    }
    if (job.status === "error") {
      return res.json({ status: "error", error: job.error });
    }
    res.json({ status: "processing", progress: job.progress, progressMessage: job.progressMessage });
  });

  app.post("/api/slide-outlines/analyze-screenshot", (req: any, res, next) => {
    upload.single("file")(req, res, (err: any) => {
      if (err) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(400).json({ error: "File is too large. Maximum size is 500MB." });
        }
        return res.status(400).json({ error: err.message || "File upload failed" });
      }
      next();
    });
  }, async (req: any, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const { originalname, path: filePath, size, mimetype } = req.file;
      const ext = originalname.toLowerCase().split(".").pop();
      if (!["png", "jpg", "jpeg", "webp", "gif"].includes(ext || "")) {
        cleanupTempFile(filePath);
        return res.status(400).json({ error: "Only image files (PNG, JPG, WEBP, GIF) are supported" });
      }

      const screenshotModel = resolveModel(req.body?.model || "claude-sonnet-4-6");
      console.log(`Analyzing screenshot for slide designs: ${originalname} (${(size / 1024).toFixed(0)}KB) using ${screenshotModel}`);

      const imageBuffer = fs.readFileSync(filePath);
      cleanupTempFile(filePath);
      const mediaType = mimetype || `image/${ext === "jpg" ? "jpeg" : ext}`;
      const compressed = await compressImageForVision(imageBuffer, mediaType);
      const base64Image = compressed.data.toString("base64");

      const thumbnailDataUrl = `data:${compressed.mimeType};base64,${base64Image.substring(0, 200000)}`;

      const aiContent = await chatCompletion({
        model: screenshotModel,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: buildScreenshotAnalysisPrompt() },
              { type: "image_url", image_url: { url: `data:${compressed.mimeType};base64,${base64Image}` } },
            ],
          },
        ],
        maxTokens: 3000,
      });
      let designs: any[] = [];
      try {
        const jsonMatch = aiContent.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          designs = JSON.parse(jsonMatch[0]);
        }
      } catch {
        designs = [{ name: "Screenshot Analysis", description: aiContent, isNew: false, existingLayoutId: "content", designDetails: aiContent, designNotes: "", suggestedChanges: "", sampleTitle: "Slide Title", sampleBody: "- Sample content", slideNums: [] }];
      }

      for (const d of designs) {
        if (!d.existingLayoutId) d.existingLayoutId = "content";
        if (!d.sampleTitle) d.sampleTitle = d.name || "Slide Title";
        if (!d.sampleBody) d.sampleBody = d.description || "- Sample body text";
        if (!d.designNotes) d.designNotes = d.designDetails || "";
      }

      res.json({ filename: originalname, designs });
    } catch (err) {
      console.error("Error analyzing screenshot:", err);
      res.status(500).json({ error: "Failed to analyze screenshot" });
    }
  });

  app.get("/api/analytics/article-volume", async (req, res) => {
    try {
      const days = parseInt(req.query.days as string) || 30;
      const category = req.query.category as string | undefined;
      const data = await storage.getArticleVolumeByDay(days, category);
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to fetch article volume" });
    }
  });

  app.get("/api/analytics/topic-frequency", async (req, res) => {
    try {
      const days = parseInt(req.query.days as string) || 30;
      const since = new Date(Date.now() - days * 86400000);
      const allArticles = await storage.getArticlesByDateRange(since, new Date());

      const stopWords = new Set(["the","a","an","and","or","but","in","on","at","to","for","of","is","it","by","with","as","this","that","from","are","was","be","has","have","had","will","been","not","no","their","its","all","can","more","new","our","who","how","what","when","where","than","out","also","into","over","just","about","up"]);
      const topicCounts: Record<string, { total: number; byDate: Record<string, number> }> = {};

      for (const article of allArticles) {
        const text = `${article.title || ""} ${article.description || ""}`.toLowerCase();
        const words = text.replace(/[^a-z0-9\s-]/g, "").split(/\s+/).filter(w => w.length > 3 && !stopWords.has(w));
        const date = article.publishedAt ? new Date(article.publishedAt).toISOString().split("T")[0] : "unknown";

        const bigrams: string[] = [];
        for (let i = 0; i < words.length - 1; i++) {
          if (!stopWords.has(words[i]) && !stopWords.has(words[i + 1])) {
            bigrams.push(`${words[i]} ${words[i + 1]}`);
          }
        }

        const allTerms = Array.from(new Set([...words, ...bigrams]));
        for (const term of allTerms) {
          if (!topicCounts[term]) topicCounts[term] = { total: 0, byDate: {} };
          topicCounts[term].total++;
          topicCounts[term].byDate[date] = (topicCounts[term].byDate[date] || 0) + 1;
        }
      }

      const sorted = Object.entries(topicCounts)
        .filter(([_, v]) => v.total >= 3)
        .sort((a, b) => b[1].total - a[1].total)
        .slice(0, 50)
        .map(([topic, data]) => {
          const dates = Object.keys(data.byDate).sort();
          const mid = Math.floor(dates.length / 2);
          const firstHalf = dates.slice(0, mid).reduce((s, d) => s + data.byDate[d], 0);
          const secondHalf = dates.slice(mid).reduce((s, d) => s + data.byDate[d], 0);
          const trend = secondHalf > firstHalf * 1.3 ? "rising" : secondHalf < firstHalf * 0.7 ? "declining" : "stable";

          return {
            topic,
            total: data.total,
            trend,
            byDate: data.byDate,
          };
        });

      res.json(sorted);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to fetch topic frequency" });
    }
  });

  app.get("/api/analytics/competitive-mentions", async (req, res) => {
    try {
      const days = parseInt(req.query.days as string) || 30;
      const dateFrom = req.query.dateFrom as string | undefined;
      const dateTo = req.query.dateTo as string | undefined;
      const data = await storage.getCompetitorMentions(days, dateFrom, dateTo);
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to fetch competitive mentions" });
    }
  });

  app.get("/api/analytics/demandbase-mentions", async (req, res) => {
    try {
      const days = parseInt(req.query.days as string) || 30;
      const dateFrom = req.query.dateFrom as string | undefined;
      const dateTo = req.query.dateTo as string | undefined;
      const data = await storage.getDemandbaseMentions(days, dateFrom, dateTo);
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to fetch Demandbase mentions" });
    }
  });

  app.get("/api/analytics/emerging-topics", async (req, res) => {
    try {
      const days = parseInt(req.query.days as string) || 30;
      const since = new Date(Date.now() - days * 86400000);
      const midpoint = new Date(Date.now() - (days / 2) * 86400000);

      const recentArticles = await storage.getArticlesByDateRange(midpoint, new Date());
      const olderArticles = await storage.getArticlesByDateRange(since, midpoint);

      const countTopics = (arts: typeof recentArticles) => {
        const counts: Record<string, number> = {};
        for (const a of arts) {
          const text = `${a.title || ""} ${a.description || ""}`.toLowerCase();
          const words = text.replace(/[^a-z0-9\s-]/g, "").split(/\s+/).filter(w => w.length > 4);
          for (const w of Array.from(new Set(words))) {
            counts[w] = (counts[w] || 0) + 1;
          }
        }
        return counts;
      };

      const recentCounts = countTopics(recentArticles);
      const olderCounts = countTopics(olderArticles);

      const emerging = Object.entries(recentCounts)
        .filter(([_, count]) => count >= 3)
        .map(([topic, recentCount]) => {
          const oldCount = olderCounts[topic] || 0;
          const growthRate = oldCount === 0 ? recentCount : (recentCount - oldCount) / oldCount;
          return { topic, recentCount, oldCount, growthRate };
        })
        .filter(t => t.growthRate > 0.5)
        .sort((a, b) => b.growthRate - a.growthRate)
        .slice(0, 20)
        .map(t => ({
          topic: t.topic,
          recentCount: t.recentCount,
          previousCount: t.oldCount,
          growthRate: Math.round(t.growthRate * 100),
          type: t.oldCount === 0 ? "new" as const : t.growthRate > 2 ? "breakout" as const : "rising" as const,
        }));

      res.json(emerging);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to fetch emerging topics" });
    }
  });

  app.get("/api/dashboard-views", async (_req, res) => {
    try {
      const views = await storage.getDashboardViews();
      res.json(views);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to fetch dashboard views" });
    }
  });

  app.post("/api/dashboard-views", async (req, res) => {
    try {
      const { name, config, isDefault } = req.body;
      if (!name || !config) return res.status(400).json({ error: "name and config are required" });
      const view = await storage.createDashboardView({
        name,
        config: typeof config === "string" ? config : JSON.stringify(config),
        isDefault: isDefault || false,
      });
      res.json(view);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to create dashboard view" });
    }
  });

  app.patch("/api/dashboard-views/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { name, config, isDefault } = req.body;
      const data: any = {};
      if (name !== undefined) data.name = name;
      if (config !== undefined) data.config = typeof config === "string" ? config : JSON.stringify(config);
      if (isDefault !== undefined) data.isDefault = isDefault;
      const view = await storage.updateDashboardView(id, data);
      if (!view) return res.status(404).json({ error: "View not found" });
      res.json(view);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to update dashboard view" });
    }
  });

  app.delete("/api/dashboard-views/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteDashboardView(id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to delete dashboard view" });
    }
  });

  app.get("/api/google-drive/files", async (req, res) => {
    try {
      const { q, pageToken, folderId } = req.query;
      const result = await listDriveFiles(
        q as string | undefined,
        pageToken as string | undefined,
        folderId as string | undefined
      );
      res.json(result);
    } catch (err: any) {
      console.error("Error listing Google Drive files:", err);
      res.status(500).json({ error: err.message || "Failed to list Google Drive files" });
    }
  });

  app.post("/api/google-drive/download", async (req, res) => {
    try {
      const { fileId } = req.body;
      if (!fileId) return res.status(400).json({ error: "fileId is required" });
      const { buffer, name, mimeType } = await downloadDriveFile(fileId);
      res.json({
        name,
        mimeType,
        size: buffer.length,
        data: buffer.toString("base64"),
      });
    } catch (err: any) {
      console.error("Error downloading Google Drive file:", err);
      res.status(500).json({ error: err.message || "Failed to download file from Google Drive" });
    }
  });

  // ===== RESEARCH SECTION ROUTES =====

  app.get("/api/research/competitors", async (_req, res) => {
    try {
      const result = await storage.getCompetitors();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/research/competitors", async (req, res) => {
    try {
      const { name, domain, websiteUrl, description, notes } = req.body;
      if (!name) return res.status(400).json({ error: "Name is required" });
      const competitor = await storage.createCompetitor({
        name,
        domain: domain || null,
        websiteUrl: websiteUrl || null,
        description: description || null,
        notes: notes || null,
        isActive: true,
      });
      res.json(competitor);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/research/competitors/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const competitor = await storage.updateCompetitor(id, req.body);
      if (!competitor) return res.status(404).json({ error: "Competitor not found" });
      res.json(competitor);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/research/competitors/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteCompetitor(id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/research/crawl-jobs", async (req, res) => {
    try {
      const { type, competitorId } = req.query;
      const jobs = await storage.getCrawlJobs(
        type as string | undefined,
        competitorId ? parseInt(competitorId as string) : undefined
      );
      res.json(jobs);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/research/crawl-jobs/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const job = await storage.getCrawlJob(id);
      if (!job) return res.status(404).json({ error: "Crawl job not found" });
      res.json(job);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/research/crawl", async (req, res) => {
    try {
      const { url, type, competitorId, maxPages, maxDepth } = req.body;
      if (!url || !type) return res.status(400).json({ error: "url and type are required" });
      if (!["company", "competitor"].includes(type)) {
        return res.status(400).json({ error: "type must be 'company' or 'competitor'" });
      }
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          return res.status(400).json({ error: "URL must use http or https protocol" });
        }
        const blocked = ["localhost", "127.0.0.1", "0.0.0.0", "::1", "169.254.169.254", "metadata.google.internal"];
        if (blocked.includes(parsed.hostname.toLowerCase()) || parsed.hostname.endsWith(".local") || parsed.hostname.endsWith(".internal")) {
          return res.status(400).json({ error: "URL points to a blocked host" });
        }
      } catch {
        return res.status(400).json({ error: "Invalid URL format" });
      }
      const safeMaxPages = Math.min(Math.max(parseInt(String(maxPages)) || 30, 1), 200);
      const safeMaxDepth = Math.min(Math.max(parseInt(String(maxDepth)) || 3, 1), 5);

      const job = await storage.createCrawlJob({
        rootUrl: url,
        type,
        competitorId: competitorId || null,
        status: "pending",
        maxPages: safeMaxPages,
        maxDepth: safeMaxDepth,
      });

      const pqJobId = `crawl_${job.id}_${Date.now()}`;
      await storage.createProcessingJob({
        jobId: pqJobId,
        section: "research",
        filename: new URL(url).hostname,
        fileSize: 0,
        status: "crawling",
        progress: 5,
        progressMessage: "Starting web crawl...",
      });

      const { runCrawl } = await import("./crawler");
      (async () => {
        try {
          const updateProgress = setInterval(async () => {
            try {
              const latest = await storage.getCrawlJob(job.id);
              if (!latest || latest.status !== "crawling") { clearInterval(updateProgress); return; }
              const pct = Math.min(90, Math.round((latest.pagesCrawled / latest.maxPages) * 90));
              await storage.updateProcessingJob(pqJobId, {
                progress: pct,
                progressMessage: `Crawling... ${latest.pagesCrawled}/${latest.maxPages} pages`,
              } as any);
            } catch {}
          }, 3000);

          await runCrawl({ jobId: job.id, maxPages: job.maxPages, maxDepth: job.maxDepth });
          clearInterval(updateProgress);
          await storage.updateProcessingJob(pqJobId, {
            status: "done",
            progress: 100,
            progressMessage: "Crawl complete",
            result: "Crawl finished. Ready for AI extraction.",
            completedAt: new Date(),
          } as any);
        } catch (err: any) {
          console.error(`Background crawl job ${job.id} error:`, err);
          await storage.updateProcessingJob(pqJobId, {
            status: "error",
            error: err.message || "Crawl failed",
            completedAt: new Date(),
          } as any);
        }
      })();

      res.json(job);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/research/crawl-jobs/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteCrawlJob(id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/research/crawl-jobs/:id/pages", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const status = req.query.status as string | undefined;
      const pages = await storage.getCrawlPages(id, status);
      res.json(pages);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/research/crawl-jobs/:id/entries", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const status = req.query.status as string | undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
      const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;
      const result = await storage.getCrawlEntries(id, status, limit, offset);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/research/crawl-jobs/:id/extract", async (req, res) => {
    try {
      const jobId = parseInt(req.params.id);
      const job = await storage.getCrawlJob(jobId);
      if (!job) return res.status(404).json({ error: "Crawl job not found" });
      if (job.status !== "crawled") return res.status(400).json({ error: "Job must be in 'crawled' status to extract" });

      await storage.updateCrawlJob(jobId, { status: "extracting" });

      const pqJobId = `extract_${jobId}_${Date.now()}`;
      await storage.createProcessingJob({
        jobId: pqJobId,
        section: "research",
        filename: new URL(job.rootUrl).hostname + " (AI extraction)",
        fileSize: 0,
        status: "extracting",
        progress: 5,
        progressMessage: "Starting AI extraction...",
      });

      (async () => {
        try {
          const pages = await storage.getCrawlPages(jobId, "crawled");
          const contextLabel = job.type === "company"
            ? "Demandbase (a B2B marketing and sales technology company)"
            : `a competitor in the B2B marketing/sales technology space`;

          let totalEntries = 0;
          let pagesProcessed = 0;
          const totalPages = pages.filter(p => p.textContent && p.textContent.length >= 200).length;

          for (const page of pages) {
            if (!page.textContent || page.textContent.length < 200) {
              pagesProcessed++;
              continue;
            }

            const truncatedContent = page.textContent.substring(0, 8000);

            try {
              const extractionResult = await chatCompletion({
                model: "claude-haiku-4-5-20251001",
                messages: [
                  {
                    role: "user",
                    content: `You are analyzing a web page from ${contextLabel}. Extract structured knowledge entries from this content.

Page URL: ${page.url}
Page Title: ${page.title || "Unknown"}

Page Content:
${truncatedContent}

Extract ALL meaningful knowledge entries from this page. Each entry should be a self-contained piece of knowledge. Categorize each as one of:
- "Product & Platform" (features, capabilities, integrations, technical details)
- "Strategy & Positioning" (messaging, market approach, target audience, value props)
- "Pricing & Packaging" (plans, pricing models, packaging tiers)
- "Partnerships & Integrations" (partner ecosystem, technology integrations)
- "Customer Success" (case studies, testimonials, results, ROI claims)
- "Company & Culture" (leadership, hiring, values, company news)
- "Market Trends" (industry trends, market data, research findings)

Return a JSON array of objects with fields: category, title, content
Where content is a detailed summary (2 to 4 sentences) of the specific knowledge.
If no meaningful entries can be extracted, return an empty array [].

${NO_DASH_RULE}

Return ONLY valid JSON, no markdown fences.`
                  }
                ],
                maxTokens: 4000,
              });

              let entries: Array<{ category: string; title: string; content: string }> = [];
              try {
                const cleaned = extractionResult.replace(/```json\n?|\n?```/g, "").trim();
                entries = JSON.parse(cleaned);
                if (!Array.isArray(entries)) entries = [];
              } catch {
                entries = [];
              }

              for (const entry of entries) {
                if (entry.title && entry.content && entry.category) {
                  await storage.createCrawlEntry({
                    crawlJobId: jobId,
                    pageId: page.id,
                    category: entry.category,
                    title: entry.title,
                    content: entry.content,
                    sourceUrl: page.url,
                    status: "pending",
                  });
                  totalEntries++;
                }
              }

              pagesProcessed++;
              const pct = Math.min(85, Math.round((pagesProcessed / totalPages) * 85) + 5);
              await storage.updateCrawlJob(jobId, {
                pagesExtracted: pagesProcessed,
                entriesExtracted: totalEntries,
              });
              await storage.updateProcessingJob(pqJobId, {
                progress: pct,
                progressMessage: `Extracting... ${pagesProcessed}/${totalPages} pages (${totalEntries} entries)`,
              } as any);

            } catch (pageErr: any) {
              console.error(`Error extracting page ${page.id}:`, pageErr);
              pagesProcessed++;
            }
          }

          await storage.updateProcessingJob(pqJobId, {
            progress: 90,
            progressMessage: `Comparing ${totalEntries} entries against Knowledge Base...`,
          } as any);

          const existingKb = await storage.getKnowledgeEntries();
          const kbTitlesLower = existingKb.map(e => e.title.toLowerCase());
          const kbContentSnippets = existingKb.map(e => ({
            id: e.id,
            title: e.title,
            category: e.category,
            snippet: e.content.substring(0, 150).toLowerCase(),
          }));

          const { entries: allExtracted } = await storage.getCrawlEntries(jobId, "pending", 5000, 0);
          let overlapsFound = 0;

          for (const entry of allExtracted) {
            const titleLower = entry.title.toLowerCase();
            const contentSnippet = entry.content.substring(0, 150).toLowerCase();

            const exactTitleMatch = kbTitlesLower.findIndex(t => t === titleLower);
            if (exactTitleMatch >= 0) {
              await storage.updateCrawlEntry(entry.id, {
                status: "conflict",
                conflictEntryId: existingKb[exactTitleMatch].id,
                conflictType: "duplicate",
                conflictDescription: `Exact title match with existing KB entry "${existingKb[exactTitleMatch].title}"`,
              });
              overlapsFound++;
              continue;
            }

            const similarMatch = kbContentSnippets.find(kb =>
              kb.category === entry.category && (
                kb.snippet.includes(contentSnippet.substring(0, 80)) ||
                contentSnippet.includes(kb.snippet.substring(0, 80)) ||
                titleLower.includes(kb.title.toLowerCase()) ||
                kb.title.toLowerCase().includes(titleLower)
              )
            );

            if (similarMatch) {
              await storage.updateCrawlEntry(entry.id, {
                status: "conflict",
                conflictEntryId: similarMatch.id,
                conflictType: "overlap",
                conflictDescription: `Similar content found in KB entry "${similarMatch.title}" (${similarMatch.category})`,
              });
              overlapsFound++;
            }
          }

          await storage.updateCrawlJob(jobId, {
            status: "extracted",
            pagesExtracted: pagesProcessed,
            entriesExtracted: totalEntries,
            completedAt: new Date(),
          });

          await storage.updateProcessingJob(pqJobId, {
            status: "done",
            progress: 100,
            progressMessage: "Extraction complete",
            result: `Extracted ${totalEntries} entries from ${pagesProcessed} pages. ${overlapsFound} overlaps with existing KB found.`,
            completedAt: new Date(),
          } as any);
        } catch (err: any) {
          console.error(`Extraction job ${jobId} failed:`, err);
          await storage.updateCrawlJob(jobId, {
            status: "error",
            errorMessage: err.message?.substring(0, 500) || "Extraction failed",
          });
          await storage.updateProcessingJob(pqJobId, {
            status: "error",
            error: err.message || "Extraction failed",
            completedAt: new Date(),
          } as any);
        }
      })();

      res.json({ message: "Extraction started", jobId });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/research/entries/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { status, title, content, category } = req.body;
      const entry = await storage.updateCrawlEntry(id, {
        ...(status !== undefined && { status }),
        ...(title !== undefined && { title }),
        ...(content !== undefined && { content }),
        ...(category !== undefined && { category }),
      });
      if (!entry) return res.status(404).json({ error: "Entry not found" });
      res.json(entry);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/research/entries/batch-status", async (req, res) => {
    try {
      const { ids, status } = req.body;
      if (!ids || !Array.isArray(ids) || !status) {
        return res.status(400).json({ error: "ids (array) and status are required" });
      }
      await storage.updateCrawlEntriesBatch(ids, { status });
      res.json({ success: true, count: ids.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/research/entries/:id/push-to-kb", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const entry = await storage.getCrawlEntry(id);
      if (!entry) return res.status(404).json({ error: "Entry not found" });

      const existingEntries = await storage.getKnowledgeEntries();
      let conflictFound = false;
      let conflictEntryId: number | null = null;
      let conflictDesc = "";

      for (const existing of existingEntries) {
        if (
          existing.title.toLowerCase() === entry.title.toLowerCase() ||
          (existing.category === entry.category &&
            existing.content.substring(0, 100).toLowerCase() === entry.content.substring(0, 100).toLowerCase())
        ) {
          conflictFound = true;
          conflictEntryId = existing.id;
          conflictDesc = `Existing entry "${existing.title}" in category "${existing.category}" has overlapping content.`;
          break;
        }
      }

      if (conflictFound) {
        await storage.updateCrawlEntry(id, {
          status: "conflict",
          conflictEntryId,
          conflictType: "duplicate",
          conflictDescription: conflictDesc,
        });
        return res.json({
          pushed: false,
          conflict: true,
          conflictDescription: conflictDesc,
          conflictEntryId,
        });
      }

      await storage.createKnowledgeEntry({
        category: entry.category,
        title: entry.title,
        content: entry.content,
        sourceUrl: entry.sourceUrl || "web_crawl",
        isActive: true,
      });

      await storage.updateCrawlEntry(id, { status: "pushed_to_kb" });
      res.json({ pushed: true, conflict: false });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/research/entries/push-approved", async (req, res) => {
    try {
      const { jobId } = req.body;
      if (!jobId) return res.status(400).json({ error: "jobId is required" });

      const { entries } = await storage.getCrawlEntries(jobId, "approved", 1000, 0);
      const existingKb = await storage.getKnowledgeEntries();
      const existingTitles = new Set(existingKb.map(e => e.title.toLowerCase()));

      let pushed = 0;
      let conflicts = 0;

      for (const entry of entries) {
        if (existingTitles.has(entry.title.toLowerCase())) {
          await storage.updateCrawlEntry(entry.id, {
            status: "conflict",
            conflictType: "duplicate",
            conflictDescription: `Title "${entry.title}" already exists in knowledge base.`,
          });
          conflicts++;
          continue;
        }

        await storage.createKnowledgeEntry({
          category: entry.category,
          title: entry.title,
          content: entry.content,
          sourceUrl: entry.sourceUrl || "web_crawl",
          isActive: true,
        });
        await storage.updateCrawlEntry(entry.id, { status: "pushed_to_kb" });
        existingTitles.add(entry.title.toLowerCase());
        pushed++;
      }

      res.json({ pushed, conflicts, total: entries.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return httpServer;
}
