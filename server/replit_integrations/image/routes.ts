import type { Express, Request, Response } from "express";
import { generateImageBuffer } from "./client";

/**
 * TODO: Image generation is not currently configured.
 * The /api/generate-image endpoint will return a 501 until a new
 * image generation provider is set up. See server/replit_integrations/image/client.ts
 */
export function registerImageRoutes(app: Express): void {
  app.post("/api/generate-image", async (req: Request, res: Response) => {
    try {
      const { prompt, size = "1024x1024" } = req.body;
      if (!prompt) {
        return res.status(400).json({ error: "Prompt is required" });
      }
      const imageBuffer = await generateImageBuffer(prompt, size);
      res.json({ b64_json: imageBuffer.toString("base64") });
    } catch (error: any) {
      console.error("Error generating image:", error);
      res.status(501).json({
        error: "Image generation is not configured.",
        message: "TODO: Set up a supported image generation provider (e.g. Stability AI, Replicate).",
      });
    }
  });
}
