import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Brief } from "@shared/schema";

vi.mock("../storage", () => ({
  storage: {
    updateBrief: vi.fn(),
    getArticlesByDateRange: vi.fn().mockResolvedValue([]),
    getCompetitors: vi.fn().mockResolvedValue([]),
    getTrendSnapshots: vi.fn().mockResolvedValue([]),
    getRealBriefByDate: vi.fn(),
    getLatestRealBrief: vi.fn(),
    createBrief: vi.fn(),
  },
}));
vi.mock("../demandbase-context", () => ({
  getDemandbaseContext: vi.fn().mockResolvedValue("ctx"),
}));
// ai-models instantiates SDK clients at module load; mock so tests never need API keys
vi.mock("../ai-models", () => ({ chatCompletion: vi.fn() }));
// briefTick reads config internally (not via injected deps) — mock it so the
// re-entrancy test has a deterministic, always-enabled, always-due schedule.
vi.mock("./config", () => ({
  getBriefConfig: vi.fn(() => ({
    enabled: true,
    hour: 0,
    timeZone: "UTC",
    recipients: ["tom@example.com"],
    appUrl: "https://app.example.com",
  })),
}));

import { executeAction, briefTick } from "./scheduler";
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

  it("send action with a corrupt stored payload → failed_compose (not failed_send), send never called", async () => {
    const send = vi.fn();
    await executeAction(
      row({ status: "failed_send", payload: '{"corrupt": true}' }),
      "send",
      cfg,
      { send },
    );
    expect(send).not.toHaveBeenCalled();
    const last = vi.mocked(storage.updateBrief).mock.calls.at(-1)![1] as any;
    expect(last.status).toBe("failed_compose");
    expect(last.error).toContain("render failed");
    expect(last.payload).toBeNull();
  });

  it("send action with a calendar-invalid model-echoed date renders via brief.briefDate and still sends", async () => {
    const send = vi.fn().mockResolvedValue({ id: "em_4" });
    const payloadWithBadDate = { ...validPayload, date: "2026-13-40" };
    await executeAction(
      row({ status: "failed_send", payload: JSON.stringify(payloadWithBadDate), briefDate: "2026-07-02" }),
      "send",
      cfg,
      { send },
    );
    expect(send).toHaveBeenCalledTimes(1);
    const last = vi.mocked(storage.updateBrief).mock.calls.at(-1)![1] as any;
    expect(last.status).toBe("sent");
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

describe("briefTick re-entrancy guard", () => {
  it("a tick still in flight blocks a concurrent tick from double-composing/double-sending", async () => {
    let resolveCompose!: (value: typeof validPayload) => void;
    const composePromise = new Promise<typeof validPayload>(resolve => {
      resolveCompose = resolve;
    });
    const compose = vi.fn().mockReturnValue(composePromise);
    const send = vi.fn().mockResolvedValue({ id: "em_5" });

    // No existing row for the date → briefTick creates one and composes.
    vi.mocked(storage.getRealBriefByDate).mockResolvedValue(undefined);
    vi.mocked(storage.getLatestRealBrief).mockResolvedValue(undefined);
    vi.mocked(storage.createBrief).mockResolvedValue(row({ id: 55, status: "pending", attempts: 0 }));

    // Monday (weekday) so shouldRunNow's weekend check doesn't short-circuit.
    const now = new Date("2024-01-01T12:00:00Z");

    const first = briefTick(now, { compose, send });
    const second = briefTick(now, { compose, send }); // fired while `first` is still awaiting compose

    resolveCompose(validPayload);
    await Promise.all([first, second]);

    expect(compose).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
