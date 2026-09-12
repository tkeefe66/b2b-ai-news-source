import { describe, expect, it } from "vitest";
import { assertCompletion, parseAIJson } from "./model-output";
import { modelOutputSchemas } from "./model-output";
import { z } from "zod";

describe("model output integrity", () => {
  it("rejects truncated, refused and missing completion markers", () => {
    // Mutation: accepting text without a normal provider completion marker.
    for (const reason of ["max_tokens", "refusal", undefined, "MAX_TOKENS", "SAFETY"]) {
      expect(() => assertCompletion(reason)).toThrow(/incomplete/i);
    }
    expect(() => assertCompletion("end_turn")).not.toThrow();
    expect(() => assertCompletion("STOP")).not.toThrow();
  });
  it("never repairs a truncated object or substitutes an empty result", () => {
    // Mutation: append braces or default missing content to {}.
    for (const text of [undefined, "", '{"entries":[{"title":"partial"}', "null"]) {
      expect(() => parseAIJson(text,z.object({entries:z.array(z.unknown())}))).toThrow();
    }
    expect(parseAIJson('```json\n{"entries":[]}\n```',z.object({entries:z.array(z.unknown())}))).toEqual({ entries: [] });
  });
  it("requires complete typed persisted output instead of accepting object-shaped garbage", () => {
    // Mutation: return parsed JSON without applying the requested runtime schema.
    for (const value of [{}, [], null, {trends:null,emergingSignals:[],companySentiment:[]}, {trends:[{name:17}],emergingSignals:[],companySentiment:[]}]) {
      expect(() => parseAIJson(JSON.stringify(value),modelOutputSchemas.snapshot)).toThrow();
    }
    expect(parseAIJson('{"trends":[],"emergingSignals":[],"companySentiment":[]}',modelOutputSchemas.snapshot)).toEqual({trends:[],emergingSignals:[],companySentiment:[]});
  });
  it("rejects malformed knowledge arrays atomically but preserves a valid empty extraction", () => {
    // Mutation: filter out invalid entries or substitute [] after malformed model output.
    for (const text of ['{}','null','[{"title":"incomplete"}]','[{"category":"General","title":"Valid","content":"Text","sourceUrl":null},null]','[{"category":"General","title":9,"content":"Text","sourceUrl":null}]']) {
      expect(() => parseAIJson(text,modelOutputSchemas.knowledgeEntries)).toThrow();
    }
    expect(parseAIJson('[]',modelOutputSchemas.knowledgeEntries)).toEqual([]);
  });
  it("rejects missing company narrative fields and wrongly typed sources", () => {
    // Mutation: turn absent narrative fields into persisted placeholder strings.
    expect(() => parseAIJson('{"companyName":"Example","sourcesUsed":"none"}',modelOutputSchemas.companyAnalysis)).toThrow();
  });
  it("rejects incomplete presentations, design proposals and crawl entries", () => {
    // Mutation: accept parsed objects without required content types and persist placeholders.
    for (const [schema,value] of [
      [modelOutputSchemas.presentation,{headline:"Title",storyArc:"Story",slideOutline:[],talkTrack:"Track"}],
      [modelOutputSchemas.slideDesigns,[{name:"Design",description:"Text"}]],
      [modelOutputSchemas.slideProposal,{explanation:"Reason",proposedDesignNotes:17}],
      [modelOutputSchemas.crawlEntries,[{category:"Category",title:"Title",content:null}]],
      [modelOutputSchemas.rewrite,{title:"Title"}],
      [modelOutputSchemas.consolidation,{title:"Title",content:"Content"}],
    ] as const) expect(() => parseAIJson(JSON.stringify(value),schema)).toThrow();
    expect(parseAIJson('[]',modelOutputSchemas.crawlEntries)).toEqual([]);
  });
});
