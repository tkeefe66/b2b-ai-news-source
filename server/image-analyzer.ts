import { chatCompletion } from "./ai-models";
import type { ExtractedImage } from "./file-parser";
import sharp from "sharp";

export interface ImageAnalysisResult {
  slideNum: number;
  description: string;
}

const MAX_IMAGE_SIZE_BYTES = 4 * 1024 * 1024;
const BATCH_SIZE = 4;

async function resizeIfNeeded(imageData: Buffer, mimeType: string): Promise<{ data: string; mimeType: string }> {
  if (imageData.length <= MAX_IMAGE_SIZE_BYTES) {
    return { data: imageData.toString("base64"), mimeType };
  }

  try {
    const meta = await sharp(imageData).metadata();
    const w = meta.width || 1920;
    const h = meta.height || 1080;

    let targetW = w;
    let targetH = h;
    if (w > 2048 || h > 2048) {
      const scale = 2048 / Math.max(w, h);
      targetW = Math.round(w * scale);
      targetH = Math.round(h * scale);
    }

    let compressed = await sharp(imageData)
      .resize(targetW, targetH, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();

    if (compressed.length > MAX_IMAGE_SIZE_BYTES) {
      compressed = await sharp(imageData)
        .resize(Math.round(targetW * 0.7), Math.round(targetH * 0.7), { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 60 })
        .toBuffer();
    }

    if (compressed.length > MAX_IMAGE_SIZE_BYTES) {
      compressed = await sharp(imageData)
        .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 50 })
        .toBuffer();
    }

    console.log(`[image-analyzer] Compressed ${(imageData.length / 1024 / 1024).toFixed(1)}MB -> ${(compressed.length / 1024 / 1024).toFixed(1)}MB`);
    return { data: compressed.toString("base64"), mimeType: "image/jpeg" };
  } catch (err: any) {
    console.error(`[image-analyzer] Compression failed: ${err.message}, sending original`);
    return { data: imageData.toString("base64"), mimeType };
  }
}

export async function analyzeImages(
  images: ExtractedImage[],
  context: string,
  onProgress?: (analyzed: number, total: number) => void
): Promise<ImageAnalysisResult[]> {
  if (images.length === 0) return [];

  const results: ImageAnalysisResult[] = [];
  const batches: ExtractedImage[][] = [];

  for (let i = 0; i < images.length; i += BATCH_SIZE) {
    batches.push(images.slice(i, i + BATCH_SIZE));
  }

  console.log(`[image-analyzer] Analyzing ${images.length} images in ${batches.length} batches`);

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batch = batches[batchIdx];
    const contentParts: any[] = [
      {
        type: "text",
        text: `Analyze the following ${batch.length} image(s) from a presentation or document. For each image, provide a detailed description covering:\n\n1. What the image shows (chart, screenshot, diagram, photo, logo, etc.)\n2. Any visible text, labels, or data points\n3. Key information that would be useful for competitive intelligence or business context\n4. Design elements (colors, layout, style)\n\nDocument context: ${context.substring(0, 500)}\n\nRespond with a JSON array:\n[\n  {\n    "imageIndex": 0,\n    "description": "Detailed description of what this image shows and contains"\n  }\n]\n\nIMPORTANT: Never use em-dashes, en-dashes, or double-dashes to bridge clauses. Use commas, semicolons, colons, or periods instead.`
      }
    ];

    for (let i = 0; i < batch.length; i++) {
      const img = batch[i];
      const { data, mimeType } = await resizeIfNeeded(img.data, img.mimeType);
      contentParts.push({
        type: "image_url",
        image_url: {
          url: `data:${mimeType};base64,${data}`
        }
      });
      contentParts.push({
        type: "text",
        text: `[Image ${i}: from slide ${img.slideNum}, ${Math.round(img.data.length / 1024)}KB]`
      });
    }

    try {
      const response = await chatCompletion({
        model: "claude-sonnet-4-6",
        messages: [
          {
            role: "user",
            content: contentParts
          }
        ],
        maxTokens: 2000,
      });

      let parsed: Array<{ imageIndex: number; description: string }> = [];
      try {
        const jsonMatch = response.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
        }
      } catch {
        parsed = [{ imageIndex: 0, description: response.substring(0, 500) }];
      }

      for (const item of parsed) {
        const img = batch[item.imageIndex] || batch[0];
        results.push({
          slideNum: img.slideNum,
          description: item.description,
        });
      }
    } catch (err: any) {
      console.error(`[image-analyzer] Batch ${batchIdx + 1} error:`, err.message);
      for (const img of batch) {
        results.push({
          slideNum: img.slideNum,
          description: `[Image analysis failed: ${err.message}]`,
        });
      }
    }

    if (onProgress) {
      onProgress(Math.min((batchIdx + 1) * BATCH_SIZE, images.length), images.length);
    }
  }

  return results;
}

export async function analyzeVideoFrames(
  frames: Array<{ frameNum: number; data: Buffer; mimeType: string }>,
  filename: string,
  onProgress?: (analyzed: number, total: number) => void
): Promise<string> {
  if (frames.length === 0) return "";

  const contentParts: any[] = [
    {
      type: "text",
      text: `Analyze these ${frames.length} keyframes extracted from the video "${filename}". Describe the visual content, any text visible, charts, diagrams, demonstrations, or key information shown. Provide a comprehensive summary that captures all the important visual information from the video.\n\nIMPORTANT: Never use em-dashes, en-dashes, or double-dashes to bridge clauses.`
    }
  ];

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const compressed = await resizeIfNeeded(frame.data, frame.mimeType);
    contentParts.push({
      type: "image_url",
      image_url: {
        url: `data:${compressed.mimeType};base64,${compressed.data}`
      }
    });
    contentParts.push({
      type: "text",
      text: `[Frame ${i + 1} of ${frames.length}]`
    });
  }

  try {
    const response = await chatCompletion({
      model: "claude-sonnet-4-6",
      messages: [
        {
          role: "user",
          content: contentParts
        }
      ],
      maxTokens: 3000,
    });

    if (onProgress) onProgress(frames.length, frames.length);
    return response;
  } catch (err: any) {
    console.error(`[image-analyzer] Video frame analysis error:`, err.message);
    return `[Video frame analysis failed: ${err.message}]`;
  }
}
