import { safeFetch } from "./safe-fetch";
import { parseAIJson, modelOutputSchemas } from "./model-output";
import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { pool } from "./db";
import { fetchAllFeeds, fetchFeedArticles, DEFAULT_SOURCES } from "./rss";
import { fetchNewsAPIArticles, seedDefaultNewsapiQueries } from "./newsapi";
import { insertSourceSchema, insertKnowledgeEntrySchema, insertPendingKnowledgeSchema, insertProductFeatureSchema, insertNewsapiQuerySchema, insertTrendWatchlistSchema, FEED_TAG_STATUSES, TAG_SURFACE_THRESHOLD, type FeedTagStatus, type Article } from "@shared/schema";
import { mergeQueueTags } from "./tag-queue";
import { z } from "zod";
import { AVAILABLE_MODELS, chatCompletion, resolveModel, createAnthropicMessage } from "./ai-models";
import { report } from "./usage.js";
import { getSearchStats, updateSearchVectors } from "./embeddings";
import { getProductKnowledgeContext } from "./demandbase-context";
import { upload, chunkUpload, handleChunkUpload, consumeUploadedFile, extractTextFromFile, extractTextAndImagesFromFile, extractFramesFromVideo, processFileToKnowledge, processUrlToKnowledge, saveExtractedEntries, cleanupTempFile, type ExtractedImage } from "./file-parser";
import { analyzeImages, analyzeVideoFrames } from "./image-analyzer";
import fs from "fs";
import { runManualBrief } from "./morning-brief/scheduler";
import { listDriveFiles, downloadDriveFile } from "./google-drive";
import { ensureCompatibleFormat, speechToText } from "./replit_integrations/audio/client";

export let lastFeedFetchAt: string | null = null;
export function setLastFeedFetchAt() { lastFeedFetchAt = new Date().toISOString(); }
import express from "express";

const NO_DASH_RULE = `
WRITING STYLE RULE (STRICTLY ENFORCED): Never use a hyphen "-", double-hyphen "--", em-dash "—", or en-dash "–" to connect or bridge clauses or sentences. Do not use dashes as punctuation between thoughts. Instead, use periods, commas, semicolons, colons, or parentheses to separate ideas. Hyphens in compound words (e.g., "go-to-market", "data-driven") and as bullet point markers are fine.`;

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

  app.get("/api/sources/report", async (_req, res) => {
    try {
      res.json(await storage.getSourceReport());
    } catch (err) {
      console.error("Error building source report:", err);
      res.status(500).json({ error: "Failed to build source report" });
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
      const response = await createAnthropicMessage({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 20,
        system: `You are a B2B marketing and sales technology classifier. Given a topic, classify it into exactly one of these categories: ${categories.join(", ")}.

Choose the category that best matches the topic. If none fit well, pick the closest match.

Respond with ONLY the category name, nothing else.`,
        messages: [{ role: "user", content: topic }],
      });
      report("b2b-ai-news", "claude-haiku-4-5-20251001", response.usage);
      const classifyBlock = response.content.find((b: any) => b.type === "text");
      const classified = (classifyBlock as any)?.text?.trim() || categories[0];
      if (!categories.includes(classified)) throw new Error("AI returned an invalid category. Please retry.");
      const category = classified;
      res.json({ category });
    } catch (err) {
      console.error("Error classifying topic:", err);
      res.status(502).json({ error: "Topic classification failed. Please retry." });
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

      res.json({
        threshold: TAG_SURFACE_THRESHOLD,
        hiddenCount,
        tags: mergeQueueTags(surfaced, enrichment, []),
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

      const analysis = parseAIJson(analysisText, modelOutputSchemas.trendAnalysis);

      const visualDataStr = JSON.stringify(analysis.visualData);

      const saved = await storage.createTrendAnalysis({
        title: analysis.title,
        summary: analysis.summary,
        keyThemes: analysis.keyThemes,
        insights: analysis.insights,
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

      const parsed = parseAIJson(result, modelOutputSchemas.snapshot.refine(output => output.trends.every(trend => trend.articleIds.every(id => articles.some(article => article.id === id))), "Trend references unknown article"));
      const { trends, emergingSignals, companySentiment } = parsed;

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
      const response = await safeFetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; KnowledgeBot/1.0)" },
        timeoutMs: 15000,
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

      const response = await createAnthropicMessage({
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

      report("b2b-ai-news", "claude-haiku-4-5-20251001", response.usage);
      const reviewBlock = response.content.find((b: any) => b.type === "text");
      const content = (reviewBlock as any)?.text || "{}";
      const parsed = parseAIJson(content, modelOutputSchemas.knowledgeReview.refine(output => [...output.conflicts,...output.suggestions].every(item => item.entryIds.every(id => entries.some(entry => entry.id === id))), "Review references unknown entry"));
      const conflictsData = parsed.conflicts;
      const suggestionsData = parsed.suggestions;

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
      const response = await createAnthropicMessage({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 3000,
        ...(sysMsg ? { system: sysMsg.content } : {}),
        messages: chatMsgs as any,
      });
      report("b2b-ai-news", "claude-haiku-4-5-20251001", response.usage);
      const responseBlock = response.content.find((b: any) => b.type === "text");
      const content = (responseBlock as any)?.text || "{}";
      const result = parseAIJson(content, modelOutputSchemas.knowledgeResolution.refine(output => output.needsClarification || output.deleteIds.every(id => entryIds.includes(id)), "Resolution references unknown entry"));

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

        const parsed = parseAIJson(merged, modelOutputSchemas.consolidation);

        return res.json({
          preview: true,
          title: parsed.title,
          category: parsed.category,
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

        const parsed = parseAIJson(rewritten, modelOutputSchemas.rewrite);

        return res.json({
          preview: true,
          entryId,
          title: parsed.title,
          content: parsed.content,
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
      const { category: rawCat } = req.body;
      const { filePath, filename, size } = consumeUploadedFile(req.body.uploadId, req.auth?.email ?? req.sessionID);
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
          return res.status(400).json({ error: "File is too large. Maximum size is 50MB." });
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
          return res.status(400).json({ error: "File is too large. Maximum size is 50MB." });
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

      let parsed: z.infer<typeof modelOutputSchemas.companyAnalysis>;
      try {
        parsed = parseAIJson(content, modelOutputSchemas.companyAnalysis);
      } catch {
        res.write(`data: ${JSON.stringify({ type: "error", error: "Failed to parse analysis" })}\n\n`);
        res.end();
        return;
      }

      const validatedName = parsed.companyName;
      const validatedOutlook = parsed.financialOutlook;
      const validatedStrategy = parsed.strategicDirection;
      const validatedGrowth = parsed.growthSignals;
      const validatedRisks = parsed.risksAndChallenges;
      const validatedOpp = parsed.demandbaseOpportunity;
      const validatedSources = parsed.sourcesUsed;

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
      return res.json(result);
    } catch (err: any) {
      console.error(`[chunked-upload] Error:`, err.message);
      return res.status(400).json({ error: err.message });
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
        let updateProgress: ReturnType<typeof setInterval> | undefined;
        try {
          updateProgress = setInterval(async () => {
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
        } finally { if (updateProgress) clearInterval(updateProgress); }
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

              const entries = parseAIJson(extractionResult, modelOutputSchemas.crawlEntries);

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
              throw new Error(`Knowledge extraction failed on page ${page.id}. Previously extracted entries are retained; retry this extraction.`);
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
