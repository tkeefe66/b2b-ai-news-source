import { describe, it, expect, vi } from "vitest";

vi.mock("./ai-models", () => ({
  chatCompletion: vi.fn(),
}));

import { buildAnnotationPrompt, parseAnnotationResponse, annotateTags } from "./tag-annotator";
import { chatCompletion } from "./ai-models";

const INPUT = [
  {
    name: "m&a",
    displayName: "M&A",
    sources: ["VentureBeat AI", "TechCrunch"],
    headlines: ["Paramount explores merger", "Warner Bros deal talk"],
  },
];

describe("buildAnnotationPrompt", () => {
  it("includes every tag name, its sources, and its headlines", () => {
    const prompt = buildAnnotationPrompt(INPUT);
    expect(prompt).toContain('"m&a"');
    expect(prompt).toContain("VentureBeat AI");
    expect(prompt).toContain("Paramount explores merger");
  });
  it("instructs the model on the three suggestion values", () => {
    const prompt = buildAnnotationPrompt(INPUT);
    expect(prompt).toContain("approve");
    expect(prompt).toContain("reject");
    expect(prompt).toContain("block");
  });
});

describe("parseAnnotationResponse", () => {
  const expected = ["m&a", "cars"];
  it("parses a valid response", () => {
    const raw = JSON.stringify([
      { name: "m&a", summary: "Media acquisition coverage", suggestion: "approve" },
      { name: "cars", summary: "One-off automotive tag", suggestion: "reject" },
    ]);
    expect(parseAnnotationResponse(raw, expected)).toHaveLength(2);
  });
  it("strips markdown code fences", () => {
    const raw = '```json\n[{"name":"m&a","summary":"S","suggestion":"approve"}]\n```';
    expect(parseAnnotationResponse(raw, expected)).toEqual([
      { name: "m&a", summary: "S", suggestion: "approve" },
    ]);
  });
  it("drops entries with unknown names, bad suggestions, or missing fields", () => {
    const raw = JSON.stringify([
      { name: "hacked", summary: "S", suggestion: "approve" },
      { name: "m&a", summary: "S", suggestion: "promote" },
      { name: "cars", suggestion: "reject" },
    ]);
    expect(parseAnnotationResponse(raw, expected)).toEqual([]);
  });
  it("clamps summaries to 160 chars", () => {
    const raw = JSON.stringify([{ name: "m&a", summary: "x".repeat(300), suggestion: "approve" }]);
    expect(parseAnnotationResponse(raw, expected)[0].summary).toHaveLength(160);
  });
  it("returns [] on non-JSON garbage", () => {
    expect(parseAnnotationResponse("the model rambled", expected)).toEqual([]);
  });
});

describe("annotateTags", () => {
  it("calls chatCompletion with the annotation model and parses the result", async () => {
    vi.mocked(chatCompletion).mockResolvedValue(
      JSON.stringify([{ name: "m&a", summary: "Media deals", suggestion: "approve" }])
    );
    const result = await annotateTags(INPUT);
    expect(result).toEqual([{ name: "m&a", summary: "Media deals", suggestion: "approve" }]);
    expect(vi.mocked(chatCompletion).mock.calls[0][0]).toMatchObject({
      model: "claude-haiku-4-5-20251001",
    });
  });
  it("returns [] for empty input without calling the model", async () => {
    vi.mocked(chatCompletion).mockClear();
    expect(await annotateTags([])).toEqual([]);
    expect(chatCompletion).not.toHaveBeenCalled();
  });
});
