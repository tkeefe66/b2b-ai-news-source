import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({ create: vi.fn(), defaultTimeout: 0 }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    constructor(options: { timeout: number }) { sdk.defaultTimeout = options.timeout; }
    messages = { create: sdk.create };
  },
}));
vi.mock("@google/genai", () => ({ GoogleGenAI: class {} }));
vi.mock("./ai-budget", () => ({ acquireAiPermit: vi.fn() }));
vi.mock("./usage.js", () => ({ report: vi.fn() }));
vi.mock("./storage", () => ({ storage: {} }));
vi.mock("./demandbase-context", () => ({ getDemandbaseContext: vi.fn() }));
// Composer imports ai-models; explicitly load the real wrapper under mocked SDKs.
vi.mock("./ai-models", async importOriginal => importOriginal());

import { acquireAiPermit } from "./ai-budget";
import { chatCompletion } from "./ai-models";
import { composeBrief, type ComposerInputs } from "./morning-brief/composer";

const payload = {
  date: "2026-09-17", headline: "A complete brief",
  periodStart: "2026-09-16T12:00:00Z", periodEnd: "2026-09-17T12:00:00Z",
  topStories: [{ title: "Story", whyItMatters: "Matters", sourceName: "Example", link: "https://example.com/1", articleId: 1 }],
  competitorWatch: [], trendPulse: [], radar: [], quietDay: true,
};
const inputs: ComposerInputs = {
  dateStr: payload.date,
  window: { periodStart: new Date(payload.periodStart), periodEnd: new Date(payload.periodEnd) },
  articles: [], competitorCandidates: [], latestSnapshot: null, previousSnapshot: null, dbContext: "",
};
const request = { model: "claude-sonnet-4-6", messages: [{ role: "user" as const, content: "Compose" }] };
const release = vi.fn();

// Synthetic provider latency reproduces the observed 120-second production cutoff.
// Emulate BOTH the SDK timeout and the wrapper's signal so either missed override fails.
function respondAfter(delay: number, text = JSON.stringify(payload)) {
  return (_input: unknown, options: { signal: AbortSignal; timeout?: number }) => new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(responseTimer);
      clearTimeout(sdkTimer);
      options.signal.removeEventListener("abort", aborted);
    };
    const aborted = () => { cleanup(); reject(new Error("Request was aborted.")); };
    const responseTimer = setTimeout(() => {
      cleanup();
      resolve({ stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 100 }, content: [{ type: "text", text }] });
    }, delay);
    const sdkTimer = setTimeout(() => {
      cleanup();
      reject(Object.assign(new Error("Request timed out."), { name: "APIConnectionTimeoutError" }));
    }, options.timeout ?? sdk.defaultTimeout);
    options.signal.addEventListener("abort", aborted, { once: true });
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  sdk.create.mockReset();
  vi.mocked(acquireAiPermit).mockResolvedValue(release);
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe("morning brief AI deadline", () => {
  it("finishes a brief when the provider takes longer than two minutes", async () => {
    // Mutation: dropping the composer timeout or either wrapper/SDK override aborts this valid brief.
    sdk.create.mockImplementation(respondAfter(150_000));
    const outcome = composeBrief(inputs).then(value => ({ value }), error => ({ error }));
    await vi.advanceTimersByTimeAsync(150_000);
    expect(await outcome).toEqual({ value: payload });
    expect(release).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("also allows a slow schema repair to complete", async () => {
    // Mutation: omitting the repair-pass timeout lets first-pass success hide the same regression.
    sdk.create.mockImplementationOnce(respondAfter(10, "{}"))
      .mockImplementationOnce(respondAfter(150_000));
    const outcome = composeBrief(inputs).then(value => ({ value }), error => ({ error }));
    await vi.advanceTimersByTimeAsync(150_010);
    expect(await outcome).toEqual({ value: payload });
    expect(release).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts a stuck brief after four minutes with an actionable error", async () => {
    // Mutation: removing the upper deadline leaves the permit occupied and the scheduler stuck.
    sdk.create.mockImplementation(respondAfter(600_000));
    const outcome = composeBrief(inputs).catch(error => error);
    await vi.advanceTimersByTimeAsync(240_000);
    expect(await outcome).toMatchObject({ message: expect.stringContaining("timed out after 240 seconds") });
    expect(release).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the two-minute deadline for callers without an override", async () => {
    // Mutation: globally extending the default allows interactive requests to occupy slots too long.
    sdk.create.mockImplementation(respondAfter(150_000));
    const outcome = chatCompletion(request).catch(error => error);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(await outcome).toMatchObject({ message: expect.stringContaining("timed out after 120 seconds") });
    expect(release).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([0, -1, NaN, Infinity, 300_001])("rejects invalid timeout %s before reserving budget", async timeoutMs => {
    // Mutation: unvalidated overrides can remove the finite deadline or reserve budget for invalid calls.
    sdk.create.mockResolvedValue({ stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] });
    await expect(chatCompletion({ ...request, timeoutMs })).rejects.toThrow(/timeout/i);
    expect(acquireAiPermit).not.toHaveBeenCalled();
  });

  it("preserves provider failures and releases the permit immediately", async () => {
    // Mutation: mislabeling all provider errors as timeouts hides auth/rate-limit failures; skipping finally leaks slots.
    const failure = Object.assign(new Error("Rate limit reached"), { status: 429 });
    sdk.create.mockRejectedValueOnce(failure);
    await expect(composeBrief(inputs)).rejects.toBe(failure);
    expect(release).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
