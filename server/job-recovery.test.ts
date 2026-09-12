import { afterEach, expect, it, vi } from "vitest";
vi.mock("./storage", () => ({ storage: {} }));
import { recoverInterruptedJobs, scheduleInterruptedJobRecovery } from "./job-recovery";

afterEach(() => vi.useRealTimers());

it("defers recovery until handoff grace and retries failures with the original startup cutoff", async () => {
  // Mutation: immediate recovery races the old deployment; a fresh cutoff fails newly accepted jobs.
  vi.useFakeTimers();
  const cutoff = new Date("2026-09-12T00:00:00Z");
  const recover = vi.fn().mockRejectedValueOnce(new Error("DB reconnecting")).mockResolvedValue({ processing: 0, crawls: 0 });
  const cancel = scheduleInterruptedJobRecovery(cutoff, { recover });
  expect(recover).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(29_999);
  expect(recover).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(recover).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(recover).toHaveBeenCalledTimes(2);
  expect(recover.mock.calls.every(call => call[0] === cutoff)).toBe(true);
  await vi.advanceTimersByTimeAsync(300_000);
  expect(recover).toHaveBeenCalledTimes(2);
  cancel();
});

it("bounds database recovery retries instead of scheduling indefinitely", async () => {
  // Mutation: unbounded retries hide a permanent schema/configuration failure.
  vi.useFakeTimers();
  const recover = vi.fn().mockRejectedValue(new Error("schema unavailable"));
  scheduleInterruptedJobRecovery(new Date(), { recover });
  await vi.advanceTimersByTimeAsync(600_000);
  expect(recover).toHaveBeenCalledTimes(5);
});

it("fails interrupted work but preserves terminal results and newly created work", async () => {
  // Mutation: dropping status/cutoff guards corrupts finished jobs or new work.
  const start = new Date("2026-09-12T00:00:00Z");
  const rows = [
    { jobId: "old", status: "extracting_text", createdAt: start },
    { jobId: "done", status: "done", createdAt: start },
    { jobId: "error", status: "error", createdAt: start },
    { jobId: "new", status: "uploading", createdAt: new Date(start.getTime() + 1) },
  ];
  const crawls = [
    { id: 1, status: "crawling", createdAt: start },
    { id: 2, status: "crawled", createdAt: start },
    { id: 3, status: "extracted", createdAt: start },
  ];
  const store = {
    getActiveProcessingJobs: vi.fn(async () => rows),
    getCrawlJobs: vi.fn(async () => crawls),
    updateProcessingJob: vi.fn(async (id, update) => Object.assign(rows.find(r => r.jobId === id)!, update)),
    updateCrawlJob: vi.fn(async (id, update) => Object.assign(crawls.find(r => r.id === id)!, update)),
  };
  expect(await recoverInterruptedJobs(start, store as any)).toEqual({ processing: 1, crawls: 1 });
  expect(rows.map(r => r.status)).toEqual(["error", "done", "error", "uploading"]);
  expect(crawls.map(r => r.status)).toEqual(["error", "crawled", "extracted"]);
  expect(store.updateProcessingJob).toHaveBeenCalledWith("old", expect.objectContaining({ error: expect.stringMatching(/restart.*upload.*again/i), completedAt: expect.any(Date) }));
  expect(await recoverInterruptedJobs(start, store as any)).toEqual({ processing: 0, crawls: 0 });
});
