import { beforeEach, expect, it, vi } from "vitest";
vi.mock("./storage", () => ({ storage: { getCrawlJob: vi.fn(), updateCrawlJob: vi.fn(), createCrawlPage: vi.fn() } }));
vi.mock("./safe-fetch", () => ({ safeFetch: vi.fn() }));
import { safeFetch } from "./safe-fetch";
import { storage } from "./storage";
import { runCrawl } from "./crawler";

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(storage.getCrawlJob).mockResolvedValue({ rootUrl: "https://example.com" } as any);
});

it("fails a crawl with no successfully fetched pages instead of reporting complete", async () => {
  // Mutation: counting visited requests as successful pages reports an outage as complete.
  vi.mocked(safeFetch).mockRejectedValue(new Error("upstream unavailable"));
  await expect(runCrawl({ jobId: 1, maxPages: 1, maxDepth: 0 })).rejects.toThrow(/no pages/i);
  expect(storage.updateCrawlJob).toHaveBeenLastCalledWith(1, expect.objectContaining({ status: "error" }));
});

it("does not swallow a page persistence failure as a fetch error", async () => {
  // Mutation: including persistence in the recoverable fetch catch hides failed inserts.
  vi.mocked(safeFetch).mockResolvedValue(new Response("<p>content</p>", { headers: { "content-type": "text/html" } }));
  vi.mocked(storage.createCrawlPage).mockRejectedValueOnce(new Error("insert failed")).mockResolvedValue({} as any);
  await expect(runCrawl({ jobId: 1, maxPages: 1, maxDepth: 0 })).rejects.toThrow("insert failed");
});

it("propagates fatal persistence errors after marking the crawl failed", async () => {
  // Mutation: swallowing the outer error lets callers mark failed crawls complete.
  vi.mocked(storage.getCrawlJob).mockResolvedValue({ rootUrl: "https://example.com" } as any);
  vi.mocked(storage.updateCrawlJob).mockRejectedValueOnce(new Error("database unavailable")).mockResolvedValue(undefined);
  await expect(runCrawl({ jobId: 1, maxPages: 1, maxDepth: 0 })).rejects.toThrow("database unavailable");
  expect(storage.updateCrawlJob).toHaveBeenLastCalledWith(1, expect.objectContaining({ status: "error" }));
});
