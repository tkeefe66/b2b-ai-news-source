import multer from "multer";
import { loadBoundedZip } from "./bounded-zip";
import { uploadStore, MAX_UPLOAD_BYTES, MAX_CHUNK_BYTES, validateUploadFilename } from "./upload-store";
export { consumeUploadedFile } from "./upload-store";
import { parsePdfIsolated } from "./pdf-isolation";
import { chatCompletion } from "./ai-models";
import { parseAIJson, modelOutputSchemas } from "./model-output";
import { storage } from "./storage";
import path from "path";
import fs from "fs";
import os from "os";
import { execFile } from "child_process";

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
  const zip = await loadBoundedZip(buffer);
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
    const xml = (await zip.read(slidePath)).toString("utf8");
    const text = stripXmlTags(xml);
    const num = parseInt(slidePath.match(/slide(\d+)/i)?.[1] || "0");
    if (text.length > 5) {
      slideTexts.push({ num, text });
    }

    const relsPath = slidePath.replace("ppt/slides/", "ppt/slides/_rels/") + ".rels";
    const relsFile = zip.files[relsPath];
    if (relsFile) {
      const relsXml = (await zip.read(relsPath)).toString("utf8");
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
    const xml = (await zip.read(notePath)).toString("utf8");
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

    const data = await zip.read(mediaPath);
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
  const zip = await loadBoundedZip(buffer);
  const docFile = zip.files["word/document.xml"];
  if (!docFile) throw new Error("Invalid .docx file: missing word/document.xml");
  const xml = (await zip.read("word/document.xml")).toString("utf8");
  return stripXmlTags(xml);
}

export const upload = multer({
  storage: multer.diskStorage({
    destination: uploadStore.root,
    filename: (_req, _file, cb) => cb(null, path.basename(uploadStore.newIncomingPath())),
  }),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 10, fieldSize: 16384, parts: 11 },
  fileFilter: (_req, file, cb) => {
    try { validateUploadFilename(file.originalname); cb(null, true); }
    catch (error: any) { cb(error); }
  },
});

export const chunkUpload = multer({
  storage: multer.diskStorage({
    destination: uploadStore.root,
    filename: (_req, _file, cb) => cb(null, path.basename(uploadStore.newIncomingPath())),
  }),
  limits: { fileSize: MAX_CHUNK_BYTES, files: 1, fields: 4, fieldSize: 1024, parts: 5 },
});

export function handleChunkUpload(req: any) {
  return uploadStore.acceptChunk(req.body, req.file?.path, req.auth?.email ?? req.sessionID);
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
    let examined = 0;
    let imageBytes = 0;
    const pngSignature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    const jpegStart = Buffer.from([0xFF, 0xD8, 0xFF]);
    const jpegEnd = Buffer.from([0xFF, 0xD9]);

    while (offset < buffer.length - 8) {
      if (++examined > 100) throw new Error("PDF has too many embedded image fragments");
      const pngIdx = buffer.indexOf(pngSignature, offset);
      const jpegIdx = buffer.indexOf(jpegStart, offset);

      if (pngIdx === -1 && jpegIdx === -1) break;

      if (pngIdx !== -1 && (jpegIdx === -1 || pngIdx < jpegIdx)) {
        const iendSignature = Buffer.from([0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82]);
        const endIdx = buffer.indexOf(iendSignature, pngIdx + 8);
        if (endIdx !== -1) {
          const imgData = buffer.subarray(pngIdx, endIdx + 8);
          if (imgData.length >= MIN_IMAGE_SIZE) {
            imageBytes += imgData.length;
            if (imageBytes > 12 * 1024 * 1024) throw new Error("PDF embedded images exceed 12 MB limit");
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
            imageBytes += imgData.length;
            if (imageBytes > 12 * 1024 * 1024) throw new Error("PDF embedded images exceed 12 MB limit");
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
    throw err;
  }
  return images;
}

export async function extractTextFromFile(input: Buffer | string, filename: string): Promise<string> {
  const result = await extractTextAndImagesFromFile(input, filename);
  return result.text;
}

export async function extractTextAndImagesFromFile(input: Buffer | string, filename: string): Promise<FileExtractionResult> {
  if (typeof input === "string") {
    uploadStore.assertOwned(input);
    if (fs.statSync(input).size > MAX_UPLOAD_BYTES) throw new Error("File exceeds upload size limit");
  }
  const buffer = typeof input === "string" ? fs.readFileSync(input) : input;
  if (buffer.length > MAX_UPLOAD_BYTES) throw new Error("File exceeds upload size limit");
  const ext = path.extname(filename).toLowerCase();
  const sizeMB = buffer.length / (1024 * 1024);
  const timeoutMs = Math.max(120000, Math.round(sizeMB * 10000));
  console.log(`[file-parser] Extracting text+images from ${filename} (${sizeMB.toFixed(1)}MB, timeout ${(timeoutMs/1000).toFixed(0)}s)`);

  if (ext === ".pptx" || ext === ".pptm") {
    return withTimeout(extractTextAndImagesFromPptx(buffer), timeoutMs, "PPTX extraction");
  }

  if (ext === ".pdf") {
    const [data, images] = await Promise.all([
      parsePdfIsolated(buffer),
      extractImagesFromPdf(buffer),
    ]);
    return { text: data, images };
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
  uploadStore.assertOwned(filePath);
  if (fs.statSync(filePath).size > MAX_UPLOAD_BYTES) throw new Error("Video exceeds upload size limit");
  const duration = await new Promise<number>((resolve, reject) => {
    execFile("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      filePath,
    ], { timeout: 30000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
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
        ], { timeout: 30000, maxBuffer: 1024 * 1024 }, (err) => {
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
  uploadStore.cleanup(filePath);
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

  const entries = parseAIJson(response, modelOutputSchemas.knowledgeEntries).map(e => ({
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

  const entries = parseAIJson(response, modelOutputSchemas.knowledgeEntries).map(e => ({
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
