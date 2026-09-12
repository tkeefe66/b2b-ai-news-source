import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./ai-models", () => ({chatCompletion:vi.fn()}));
vi.mock("./storage", () => ({storage:{}}));
import { chatCompletion } from "./ai-models";
import { processFileToKnowledge, processUrlToKnowledge } from "./file-parser";

beforeEach(() => vi.mocked(chatCompletion).mockReset());
describe("knowledge extraction model boundary", () => {
  for (const [name,extract] of [
    ["file", () => processFileToKnowledge("Synthetic source text","sample.txt")],
    ["URL", () => processUrlToKnowledge("Synthetic source text","https://example.com/source")],
  ] as const) {
    it.each(["not JSON", "{}", "null", '[{"title":"partial"}', '[{"title":"partial"}]'])(`${name} rejects malformed output %s rather than saving fallback`, async output => {
      // Mutation: swallow parse failures or filter malformed entries into successful [].
      vi.mocked(chatCompletion).mockResolvedValue(output);
      await expect(extract()).rejects.toThrow();
    });
    it(`${name} preserves a valid empty extraction`, async () => {
      // Mutation: reject all empty arrays, conflating no findings with malformed output.
      vi.mocked(chatCompletion).mockResolvedValue("[]");
      await expect(extract()).resolves.toMatchObject({entries:[]});
    });
    it(`${name} accepts a complete typed extraction`, async () => {
      // Mutation: discard every entry instead of validating actual content.
      vi.mocked(chatCompletion).mockResolvedValue(JSON.stringify([{category:"Platform Overview",title:"Synthetic title",content:"Synthetic extracted knowledge.",sourceUrl:null}]));
      const result = await extract();
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].title).toBe("Synthetic title");
    });
  }
});
