import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("./db", () => ({ pool: { query: vi.fn() } }));
import { pool } from "./db";
import { acquireAiPermit } from "./ai-budget";

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("AI_ENABLED", "true");
  vi.stubEnv("AI_MAX_CONCURRENT", "1");
  vi.stubEnv("AI_DAILY_MAX_UNITS", "10000000");
  vi.stubEnv("AI_DAILY_MAX_CALLS", "20");
  vi.mocked(pool.query).mockResolvedValue({ rows: [{ day: "2026-09-12" }] } as never);
});
afterEach(() => vi.unstubAllEnvs());

it("fails closed on database errors and releases the reserved concurrency slot", async () => {
  // Mutation: swallowing DB rejection admits unaccounted work; omitting release wedges the worker.
  vi.mocked(pool.query).mockRejectedValueOnce(new Error("database unavailable"));
  await expect(acquireAiPermit("input", 100)).rejects.toThrow("database unavailable");
  const release = await acquireAiPermit("input", 100);
  release();
});

it("rejects oversized inputs and output caps before touching the allowance", async () => {
  // Mutation: removing size checks sends oversized requests to the provider.
  await expect(acquireAiPermit("x".repeat(1_000_001), 100)).rejects.toThrow(/too large/);
  await expect(acquireAiPermit("input", 32769)).rejects.toThrow(/too large/);
  expect(pool.query).not.toHaveBeenCalled();
});

it("reserves concurrency before awaiting the database and releases only once", async () => {
  // Mutation: late increment admits concurrent calls; double release underflows and bypasses the cap.
  let resolve!: (value: any) => void;
  vi.mocked(pool.query).mockImplementationOnce(() => new Promise(r => { resolve = r; }) as any);
  const first = acquireAiPermit("first", 100);
  await expect(acquireAiPermit("second", 100)).rejects.toThrow(/busy/);
  resolve({ rows: [{ day: "today" }] });
  const release = await first;
  release(); release();
  const next = await acquireAiPermit("third", 100);
  await expect(acquireAiPermit("fourth", 100)).rejects.toThrow(/busy/);
  next();
});

it("denies exhausted allowances and too-large reservations without leaking permits", async () => {
  // Mutation: accepting empty RETURNING admits a request the atomic budget rejected.
  vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as never);
  await expect(acquireAiPermit("input", 100)).rejects.toThrow(/Daily AI allowance reached/);
  vi.stubEnv("AI_DAILY_MAX_UNITS", "10");
  await expect(acquireAiPermit("input", 100)).rejects.toThrow(/allowance is too small/);
  vi.stubEnv("AI_DAILY_MAX_UNITS", "10000000");
  const release = await acquireAiPermit("ok", 100);
  release();
});

it("operator disable prevents any database or provider admission", async () => {
  // Mutation: ignoring the kill switch keeps spending after operator disables AI.
  vi.stubEnv("AI_ENABLED", "false");
  await expect(acquireAiPermit("input", 100)).rejects.toThrow(/disabled/);
  expect(pool.query).not.toHaveBeenCalled();
});
