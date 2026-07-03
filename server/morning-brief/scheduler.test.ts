import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Brief } from "@shared/schema";

vi.mock("../storage", () => ({
  storage: {
    updateBrief: vi.fn(),
    getArticlesByDateRange: vi.fn().mockResolvedValue([]),
    getCompetitors: vi.fn().mockResolvedValue([]),
    getTrendSnapshots: vi.fn().mockResolvedValue([]),
  },
}));
vi.mock("../demandbase-context", () => ({
  getDemandbaseContext: vi.fn().mockResolvedValue("ctx"),
}));
// ai-models instantiates SDK clients at module load; mock so tests never need API keys
vi.mock("../ai-models", () => ({ chatCompletion: vi.fn() }));

import { executeAction } from "./scheduler";
import { storage } from "../storage";

const cfg = {
  enabled: true, hour: 7, timeZone: "America/Chicago",
  recipients: ["tom@example.com"], appUrl: "https://app.example.com",
};

const validPayload = {
  date: "2026-07-02", headline: "H",
  periodStart: "2026-07-01T12:00:00.000Z", periodEnd: "2026-07-02T12:00:00.000Z",
  topStories: [{ title: "T", whyItMatters: "W", sourceName: "S", link: "https://e.com/1", articleId: 1 }],
  competitorWatch: [], trendPulse: [], radar: [], quietDay: true,
};

function row(overrides: Partial<Brief> = {}): Brief {
  return {
    id: 10, briefDate: "2026-07-02", manual: false,
    periodStart: new Date("2026-07-01T12:00:00Z"), periodEnd: new Date("2026-07-02T12:00:00Z"),
    payload: null, status: "pending", attempts: 0, error: null, sentAt: null,
    createdAt: new Date(), ...overrides,
  } as Brief;
}

beforeEach(() => {
  // The storage mock is module-level and shared across every `it` below; without
  // clearing, `.mock.calls` accumulates across tests and `.find()`/`.at(-1)` lookups
  // in later tests can match calls left over from earlier ones. Vitest does not clear
  // mocks between tests by default (no clearMocks/restoreMocks in vitest.config.ts).
  vi.clearAllMocks();
  vi.mocked(storage.updateBrief).mockImplementation(async (_id, data) => row(data as any));
});

describe("executeAction", () => {
  it("compose success → composed → sent", async () => {
    const compose = vi.fn().mockResolvedValue(validPayload);
    const send = vi.fn().mockResolvedValue({ id: "em_1" });
    await executeAction(row(), "compose", cfg, { compose, send });
    const statuses = vi.mocked(storage.updateBrief).mock.calls.map(c => (c[1] as any).status).filter(Boolean);
    expect(statuses).toContain("composed");
    expect(statuses[statuses.length - 1]).toBe("sent");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("compose failure → failed_compose with attempts incremented and error stored", async () => {
    const compose = vi.fn().mockRejectedValue(new Error("claude down"));
    const send = vi.fn();
    await executeAction(row({ attempts: 1 }), "compose", cfg, { compose, send });
    const last = vi.mocked(storage.updateBrief).mock.calls.at(-1)![1] as any;
    expect(last.status).toBe("failed_compose");
    expect(last.error).toContain("claude down");
    const attemptsUpdate = vi.mocked(storage.updateBrief).mock.calls.find(c => (c[1] as any).attempts !== undefined)![1] as any;
    expect(attemptsUpdate.attempts).toBe(2);
    expect(send).not.toHaveBeenCalled();
  });

  it("send action re-renders the stored payload without recomposing", async () => {
    const compose = vi.fn();
    const send = vi.fn().mockResolvedValue({ id: "em_2" });
    await executeAction(row({ status: "failed_send", payload: JSON.stringify(validPayload) }), "send", cfg, { compose, send });
    expect(compose).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
    const last = vi.mocked(storage.updateBrief).mock.calls.at(-1)![1] as any;
    expect(last.status).toBe("sent");
  });

  it("send failure → failed_send with error stored", async () => {
    const send = vi.fn().mockRejectedValue(new Error("resend 500"));
    await executeAction(row({ status: "composed", payload: JSON.stringify(validPayload) }), "send", cfg, { send });
    const last = vi.mocked(storage.updateBrief).mock.calls.at(-1)![1] as any;
    expect(last.status).toBe("failed_send");
    expect(last.error).toContain("resend 500");
  });

  it("fallback → sends headline email → sent_fallback", async () => {
    const send = vi.fn().mockResolvedValue({ id: "em_3" });
    await executeAction(row({ status: "failed_compose", attempts: 3 }), "fallback", cfg, { send });
    expect(send).toHaveBeenCalledTimes(1);
    const sentEmail = send.mock.calls[0][0];
    expect(sentEmail.subject).toContain("headlines");
    const last = vi.mocked(storage.updateBrief).mock.calls.at(-1)![1] as any;
    expect(last.status).toBe("sent_fallback");
  });
});
