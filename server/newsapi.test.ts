import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./ai-models", () => ({ chatCompletion: vi.fn().mockResolvedValue("[]") }));
vi.mock("./storage", () => ({ storage: {
  getNewsapiQueries: vi.fn().mockResolvedValue([{ id: 1 }]),
  getActiveNewsapiQueries: vi.fn().mockResolvedValue([{ query: "martech", category: "GTM Tech" }]),
  createArticle: vi.fn().mockResolvedValue({ id: 1, title: "New article", tags: null }),
  getTagVocabulary: vi.fn().mockResolvedValue(["ai"]),
} }));

import { fetchNewsAPIArticles } from "./newsapi";
import { chatCompletion } from "./ai-models";
import { storage } from "./storage";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("NewsAPI ingestion without AI tagging", () => {
  it("ingests news for the brief without making an AI call or generating tags", async () => {
    vi.stubEnv("NEWSAPI_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ articles: [{
      title: "New article", url: "https://example.com/news", description: "News context",
      publishedAt: "2026-10-24T12:00:00Z", source: { name: "Publisher" },
    }] }) }));
    await expect(fetchNewsAPIArticles()).resolves.toEqual({ total: 1, errors: 0 });
    expect(storage.createArticle).toHaveBeenCalledWith(expect.objectContaining({
      title: "New article", description: "News context", category: "GTM Tech",
    }));
    expect(vi.mocked(storage.createArticle).mock.calls[0][0]).not.toHaveProperty("tags");
    expect(chatCompletion).not.toHaveBeenCalled();
  });
});
