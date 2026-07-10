import multer from "multer";
import JSZip from "jszip";
import { createRequire } from "module";
import { chatCompletion } from "./ai-models";
import { storage } from "./storage";
import path from "path";
import fs from "fs";
import os from "os";
import { execFile } from "child_process";

const _require = createRequire(
  typeof __filename !== "undefined" ? __filename : process.argv[1] || "."
);
const pdfParse = _require("pdf-parse");

function stripXmlTags(xml: string): string {
  return xml
    .replace(/<a:br[^>]*\/>/gi, "\n")
    .replace(/<\/a:p>/gi, "\n")
    .replace(/<\/w:p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#\d+;/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface ExtractedImage {
  slideNum: number;
  data: Buffer;
  mimeType: string;
}

export interface PptxExtractionResult {
  text: string;
  images: ExtractedImage[];
}

const IMAGE_MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".emf": "image/x-emf",
  ".wmf": "image/x-wmf",
  ".tiff": "image/tiff",
  ".tif": "image/tiff",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
};

const MIN_IMAGE_SIZE = 10 * 1024;

async function extractTextFromPptx(buffer: Buffer): Promise<string> {
  const result = await extractTextAndImagesFromPptx(buffer);
  return result.text;
}

async function extractTextAndImagesFromPptx(buffer: Buffer): Promise<PptxExtractionResult> {
  const zip = await JSZip.loadAsync(buffer);
  const slideTexts: { num: number; text: string }[] = [];

  const slideFiles = Object.keys(zip.files)
    .filter(name => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => {
      const numA = parseInt(a.match(/slide(\d+)/i)?.[1] || "0");
      const numB = parseInt(b.match(/slide(\d+)/i)?.[1] || "0");
      return numA - numB;
    });

  const slideImageMap = new Map<string, number>();

  for (const slidePath of slideFiles) {
    const xml = await zip.files[slidePath].async("text");
    const text = stripXmlTags(xml);
    const num = parseInt(slidePath.match(/slide(\d+)/i)?.[1] || "0");
    if (text.length > 5) {
      slideTexts.push({ num, text });
    }

    const relsPath = slidePath.replace("ppt/slides/", "ppt/slides/_rels/") + ".rels";
    const relsFile = zip.files[relsPath];
    if (relsFile) {
      const relsXml = await relsFile.async("text");
      const imageRefs = relsXml.match(/Target="[^"]*?\/media\/[^"]+"/gi) || [];
      for (const ref of imageRefs) {
        const targetMatch = ref.match(/Target="([^"]+)"/i);
        if (targetMatch) {
          let target = targetMatch[1];
          if (target.startsWith("../")) {
            target = "ppt/" + target.substring(3);
          } else if (!target.startsWith("ppt/")) {
            target = "ppt/slides/" + target;
          }
          slideImageMap.set(target, num);
        }
      }
    }
  }

  const notesFiles = Object.keys(zip.files)
    .filter(name => /^ppt\/notesSlides\/notesSlide\d+\.xml$/i.test(name));

  for (const notePath of notesFiles) {
    const xml = await zip.files[notePath].async("text");
    const text = stripXmlTags(xml);
    if (text.length > 5) {
      const num = parseInt(notePath.match(/notesSlide(\d+)/i)?.[1] || "0");
      const existing = slideTexts.find(s => s.num === num);
      if (existing) {
        existing.text += `\n[Speaker Notes] ${text}`;
      }
    }
  }

  const images: ExtractedImage[] = [];
  const mediaFiles = Object.keys(zip.files)
    .filter(name => /^ppt\/media\/image\d*\.[a-z]+$/i.test(name));

  for (const mediaPath of mediaFiles) {
    const ext = path.extname(mediaPath).toLowerCase();
    const mimeType = IMAGE_MIME_TYPES[ext];
    if (!mimeType) continue;

    const data = await zip.files[mediaPath].async("nodebuffer");
    if (data.length < MIN_IMAGE_SIZE) continue;

    const slideNum = slideImageMap.get(mediaPath) || 0;
    images.push({ slideNum, data, mimeType });
  }

  images.sort((a, b) => a.slideNum - b.slideNum);

  const textResult = slideTexts.map(s => `[Slide ${s.num}]\n${s.text}`).join("\n\n");
  console.log(`[file-parser] PPTX extraction: ${slideTexts.length} slides, ${images.length} images (>= ${MIN_IMAGE_SIZE / 1024}KB)`);

  return { text: textResult, images };
}

async function extractTextFromDocx(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const docFile = zip.files["word/document.xml"];
  if (!docFile) throw new Error("Invalid .docx file: missing word/document.xml");
  const xml = await docFile.async("text");
  return stripXmlTags(xml);
}

const uploadDir = path.join(os.tmpdir(), "app-uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const chunkedDir = path.join(os.tmpdir(), "app-chunked-uploads");
if (!fs.existsSync(chunkedDir)) fs.mkdirSync(chunkedDir, { recursive: true });

export const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (_req, file, cb) => {
      const uniqueName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${file.originalname}`;
      cb(null, uniqueName);
    },
  }),
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = [".pptx", ".pptm", ".pdf", ".ppt", ".docx", ".txt", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".mov", ".avi", ".webm"];
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${ext}. Supported: ${allowed.join(", ")}`));
    }
  },
});

export const chunkUpload = multer({
  storage: multer.diskStorage({
    destination: chunkedDir,
    filename: (_req, _file, cb) => {
      cb(null, `chunk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
    },
  }),
  limits: { fileSize: 6 * 1024 * 1024 },
});

const activeChunkedUploads = new Map<string, { totalChunks: number; receivedChunks: Set<number>; filename: string; createdAt: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [uploadId, info] of Array.from(activeChunkedUploads.entries())) {
    if (now - info.createdAt > 30 * 60 * 1000) {
      activeChunkedUploads.delete(uploadId);
      for (let i = 0; i < info.totalChunks; i++) {
        const chunkPath = path.join(chunkedDir, `${uploadId}_${i}`);
        if (fs.existsSync(chunkPath)) fs.unlinkSync(chunkPath);
      }
    }
  }
}, 5 * 60 * 1000);

export function handleChunkUpload(req: any): { complete: false } | { complete: true; filePath: string; filename: string; size: number } {
  const { uploadId, chunkIndex, totalChunks, filename } = req.body;
  const idx = parseInt(chunkIndex, 10);
  const total = parseInt(totalChunks, 10);

  if (!uploadId || isNaN(idx) || isNaN(total) || !filename) {
    throw new Error("Missing chunked upload parameters");
  }

  if (!activeChunkedUploads.has(uploadId)) {
    activeChunkedUploads.set(uploadId, { totalChunks: total, receivedChunks: new Set(), filename, createdAt: Date.now() });
  }

  const info = activeChunkedUploads.get(uploadId)!;
  const chunkDest = path.join(chunkedDir, `${uploadId}_${idx}`);
  if (req.file) {
    fs.renameSync(req.file.path, chunkDest);
  }
  info.receivedChunks.add(idx);

  if (info.receivedChunks.size < total) {
    return { complete: false };
  }

  const assembledPath = path.join(uploadDir, `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${filename}`);
  let totalSize = 0;
  for (let i = 0; i < total; i++) {
    const cp = path.join(chunkedDir, `${uploadId}_${i}`);
    const data = fs.readFileSync(cp);
    fs.appendFileSync(assembledPath, data);
    totalSize += data.length;
    fs.unlinkSync(cp);
  }
  activeChunkedUploads.delete(uploadId);

  return { complete: true, filePath: assembledPath, filename, size: totalSize };
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

export interface FileExtractionResult {
  text: string;
  images: ExtractedImage[];
}

async function extractImagesFromPdf(buffer: Buffer): Promise<ExtractedImage[]> {
  const images: ExtractedImage[] = [];
  try {
    let offset = 0;
    const pngSignature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    const jpegStart = Buffer.from([0xFF, 0xD8, 0xFF]);
    const jpegEnd = Buffer.from([0xFF, 0xD9]);

    while (offset < buffer.length - 8) {
      const pngIdx = buffer.indexOf(pngSignature, offset);
      const jpegIdx = buffer.indexOf(jpegStart, offset);

      if (pngIdx === -1 && jpegIdx === -1) break;

      if (pngIdx !== -1 && (jpegIdx === -1 || pngIdx < jpegIdx)) {
        const iendSignature = Buffer.from([0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82]);
        const endIdx = buffer.indexOf(iendSignature, pngIdx + 8);
        if (endIdx !== -1) {
          const imgData = buffer.subarray(pngIdx, endIdx + 8);
          if (imgData.length >= MIN_IMAGE_SIZE) {
            images.push({ slideNum: images.length + 1, data: Buffer.from(imgData), mimeType: "image/png" });
          }
          offset = endIdx + 8;
        } else {
          offset = pngIdx + 8;
        }
      } else if (jpegIdx !== -1) {
        const endIdx = buffer.indexOf(jpegEnd, jpegIdx + 3);
        if (endIdx !== -1) {
          const imgData = buffer.subarray(jpegIdx, endIdx + 2);
          if (imgData.length >= MIN_IMAGE_SIZE) {
            images.push({ slideNum: images.length + 1, data: Buffer.from(imgData), mimeType: "image/jpeg" });
          }
          offset = endIdx + 2;
        } else {
          offset = jpegIdx + 3;
        }
      }
    }
    console.log(`[file-parser] PDF image extraction: found ${images.length} images (>= ${MIN_IMAGE_SIZE / 1024}KB)`);
  } catch (err) {
    console.error("[file-parser] PDF image extraction error:", err);
  }
  return images;
}

export async function extractTextFromFile(input: Buffer | string, filename: string): Promise<string> {
  const result = await extractTextAndImagesFromFile(input, filename);
  return result.text;
}

export async function extractTextAndImagesFromFile(input: Buffer | string, filename: string): Promise<FileExtractionResult> {
  const buffer = typeof input === "string" ? fs.readFileSync(input) : input;
  const ext = path.extname(filename).toLowerCase();
  const sizeMB = buffer.length / (1024 * 1024);
  const timeoutMs = Math.max(120000, Math.round(sizeMB * 10000));
  console.log(`[file-parser] Extracting text+images from ${filename} (${sizeMB.toFixed(1)}MB, timeout ${(timeoutMs/1000).toFixed(0)}s)`);

  if (ext === ".pptx" || ext === ".pptm") {
    return withTimeout(extractTextAndImagesFromPptx(buffer), timeoutMs, "PPTX extraction");
  }

  if (ext === ".pdf") {
    const [data, images] = await Promise.all([
      withTimeout(pdfParse(buffer), timeoutMs, "PDF text extraction") as Promise<{ text: string }>,
      extractImagesFromPdf(buffer),
    ]);
    return { text: data.text, images };
  }

  if (ext === ".txt") {
    return { text: buffer.toString("utf-8"), images: [] };
  }

  if (ext === ".docx") {
    const text = await withTimeout(extractTextFromDocx(buffer), timeoutMs, "DOCX extraction");
    return { text, images: [] };
  }

  if ([".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext)) {
    const mimeType = IMAGE_MIME_TYPES[ext] || `image/${ext.substring(1)}`;
    return { text: "", images: [{ slideNum: 1, data: buffer, mimeType }] };
  }

  throw new Error(`Unsupported file type for extraction: ${ext}`);
}

export async function extractFramesFromVideo(filePath: string, frameCount: number = 8): Promise<Buffer[]> {
  const duration = await new Promise<number>((resolve, reject) => {
    execFile("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      filePath,
    ], (err, stdout) => {
      if (err) return reject(err);
      const dur = parseFloat(stdout.trim());
      if (isNaN(dur) || dur <= 0) return reject(new Error("Could not determine video duration"));
      resolve(dur);
    });
  });

  const actualFrameCount = Math.min(frameCount, Math.max(1, Math.floor(duration)));
  const interval = duration / (actualFrameCount + 1);
  const frames: Buffer[] = [];
  const tmpDir = path.join(os.tmpdir(), `frames_${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    for (let i = 1; i <= actualFrameCount; i++) {
      const timestamp = interval * i;
      const outputPath = path.join(tmpDir, `frame_${i}.jpg`);
      await new Promise<void>((resolve, reject) => {
        execFile("ffmpeg", [
          "-ss", timestamp.toFixed(2),
          "-i", filePath,
          "-vframes", "1",
          "-q:v", "3",
          "-vf", "scale='min(1280,iw)':'min(720,ih)':force_original_aspect_ratio=decrease",
          "-y",
          outputPath,
        ], (err) => {
          if (err) return reject(err);
          resolve();
        });
      });
      if (fs.existsSync(outputPath)) {
        frames.push(fs.readFileSync(outputPath));
      }
    }
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_e) {}
  }

  console.log(`[file-parser] Extracted ${frames.length} frames from video (duration: ${duration.toFixed(1)}s)`);
  return frames;
}

export function cleanupTempFile(filePath: string) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (e) {
  }
}

const VALID_CATEGORIES = [
  "Platform Overview", "Marketing (ABX)", "Sales Intelligence",
  "Advertising & B2B DSP", "Data & Account Intelligence", "AI & Agentbase",
  "Buying Groups", "Customer Case Studies", "Competitive Intelligence",
  "Messaging & Positioning", "Integrations & Ecosystem", "Support & Documentation",
  "Product Updates", "Company & Leadership", "Privacy & Security",
];

export async function processFileToKnowledge(
  text: string,
  filename: string,
  userCategory?: string
): Promise<{ entries: Array<{ category: string; title: string; content: string; sourceUrl: string | null }>, rawText: string }> {
  const truncatedText = text.substring(0, 40000);

  const categoryList = VALID_CATEGORIES.map(c => `- ${c}`).join("\n");

  const systemPrompt = `You are a knowledge extraction specialist for Demandbase, a B2B marketing and sales technology company.
Extract distinct knowledge entries from this document. Each entry should be a self-contained piece of information.

Valid categories:
${categoryList}

${userCategory ? `The user suggests this category: "${userCategory}". Use it if appropriate, otherwise choose the best category from the list.` : "Choose the most appropriate category for each entry."}

Respond with a JSON array of objects:
[
  {
    "category": "Category Name",
    "title": "Brief descriptive title",
    "content": "The full knowledge content extracted from the document. Include details, statistics, and context.",
    "sourceUrl": null
  }
]

Rules:
- Each entry should be substantial (at least 2-3 sentences)
- Do not invent information - only extract what is in the document
- Group related information into single entries
- Use clear, descriptive titles
- Aim for 3-15 entries depending on document length
- NEVER use em-dashes, en-dashes, or double-dashes to bridge clauses. Use commas, semicolons, colons, or periods instead.`;

  const response = await chatCompletion({
    model: "claude-sonnet-4-6",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Extract knowledge entries from this document (${filename}):\n\n${truncatedText}` },
    ],
    maxTokens: 4000,
  });

  let entries: Array<{ category: string; title: string; content: string; sourceUrl: string | null }> = [];
  try {
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      entries = JSON.parse(jsonMatch[0]);
    }
  } catch (parseErr) {
    console.error("Failed to parse knowledge entries:", parseErr);
    entries = [{
      category: userCategory || "Platform Overview",
      title: filename.replace(/\.[^.]+$/, ""),
      content: truncatedText.substring(0, 2000),
      sourceUrl: null,
    }];
  }

  entries = entries.filter(e => e.title && e.content && e.category);
  entries = entries.map(e => ({
    ...e,
    category: VALID_CATEGORIES.includes(e.category) ? e.category : (userCategory || "Platform Overview"),
  }));

  return { entries, rawText: text };
}

export async function processUrlToKnowledge(
  text: string,
  url: string,
  userCategory?: string
): Promise<{ entries: Array<{ category: string; title: string; content: string; sourceUrl: string | null; confidence?: number }> }> {
  const truncatedText = text.substring(0, 40000);

  const categoryList = VALID_CATEGORIES.map(c => `- ${c}`).join("\n");

  const systemPrompt = `You are a knowledge extraction specialist for Demandbase.
Extract distinct knowledge entries from this web page content.

Valid categories:
${categoryList}

${userCategory ? `Suggested category: "${userCategory}".` : "Choose the best category."}

Respond with a JSON array:
[
  {
    "category": "Category Name",
    "title": "Brief title",
    "content": "Full extracted knowledge content",
    "sourceUrl": "${url}"
  }
]

Rules:
- Substantial entries (2-3+ sentences)
- Only extract what's in the content
- 3-15 entries based on content length
- NEVER use em-dashes, en-dashes, or double-dashes to bridge clauses.`;

  const response = await chatCompletion({
    model: "claude-sonnet-4-6",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Extract knowledge from this page (${url}):\n\n${truncatedText}` },
    ],
    maxTokens: 4000,
  });

  let entries: Array<{ category: string; title: string; content: string; sourceUrl: string | null; confidence?: number }> = [];
  try {
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      entries = JSON.parse(jsonMatch[0]);
    }
  } catch (parseErr) {
    console.error("Failed to parse URL knowledge entries:", parseErr);
  }

  entries = entries.filter(e => e.title && e.content && e.category);
  entries = entries.map(e => ({
    ...e,
    sourceUrl: url,
    category: VALID_CATEGORIES.includes(e.category) ? e.category : (userCategory || "Platform Overview"),
  }));

  return { entries };
}

export async function saveExtractedEntries(
  entries: Array<{ category: string; title: string; content: string; sourceUrl: string | null }>,
  sourceFilename: string,
  batchId: string
) {
  const pendingEntries = [];
  for (const entry of entries) {
    const pending = await storage.createPendingKnowledge({
      batchId,
      category: entry.category,
      title: entry.title,
      content: entry.content,
      sourceFilename,
      status: "pending",
    });
    pendingEntries.push(pending);
  }
  return pendingEntries;
}
