import { describe, expect, it, vi } from "vitest";
vi.mock("./ai-models", () => ({chatCompletion:vi.fn()}));
import { chatCompletion } from "./ai-models";
import { analyzeImages, analyzeVideoFrames } from "./image-analyzer";
const image = {slideNum:1,data:Buffer.from("synthetic small image"),mimeType:"image/png"};
describe("image model output integrity", () => {
  it.each(["not JSON","[]",'[{"imageIndex":9,"description":"Wrong slide"}]','[{"imageIndex":0,"description":false}]'])("rejects incomplete image output %s", async output => {
    // Mutation: fallback to first image or turn a failed analysis into persisted prose.
    vi.mocked(chatCompletion).mockResolvedValue(output);
    await expect(analyzeImages([image],"Synthetic context")).rejects.toThrow();
  });
  it("preserves a complete valid image description", async () => {
    // Mutation: reject all responses instead of enforcing per-image coverage.
    vi.mocked(chatCompletion).mockResolvedValue('[{"imageIndex":0,"description":"Synthetic description"}]');
    await expect(analyzeImages([image],"Synthetic context")).resolves.toEqual([{slideNum:1,description:"Synthetic description"}]);
  });
  it("propagates video analysis failure instead of returning error text as content", async () => {
    // Mutation: catch provider rejection and return a content-shaped error string.
    vi.mocked(chatCompletion).mockRejectedValue(new Error("synthetic provider failure"));
    await expect(analyzeVideoFrames([{frameNum:1,data:image.data,mimeType:image.mimeType}],"synthetic.mp4")).rejects.toThrow();
  });
});
