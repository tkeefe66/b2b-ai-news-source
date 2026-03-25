/**
 * TODO: Image generation was previously handled by OpenAI DALL-E (gpt-image-1).
 * This feature needs to be redesigned with a new image generation provider.
 * Options: Stability AI, Replicate (SDXL), or another image generation API.
 *
 * Claude can analyze/describe images but cannot generate them.
 */

export async function generateImageBuffer(
  _prompt: string,
  _size: "1024x1024" | "512x512" | "256x256" = "1024x1024"
): Promise<Buffer> {
  throw new Error(
    "Image generation is not configured. TODO: redesign with a supported image generation provider (e.g. Stability AI, Replicate)."
  );
}

export async function editImages(
  _imageFiles: string[],
  _prompt: string,
  _outputPath?: string
): Promise<Buffer> {
  throw new Error(
    "Image editing is not configured. TODO: redesign with a supported image generation provider."
  );
}
