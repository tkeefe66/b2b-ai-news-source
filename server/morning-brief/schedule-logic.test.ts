import { describe, it, expect } from "vitest";
import { zonedParts, shouldRunNow, computeWindow, nextAction } from "./schedule-logic";

const CHI = { hour: 7, timeZone: "America/Chicago" };

describe("zonedParts", () => {
  it("converts UTC to Chicago date, weekday, hour", () => {
    // Monday 2026-07-06 12:30 UTC = Monday 07:30 Chicago (CDT, UTC-5)
    const p = zonedParts(new Date("2026-07-06T12:30:00Z"), "America/Chicago");
    expect(p.dateStr).toBe("2026-07-06");
    expect(p.weekday).toBe(1);
    expect(p.hour).toBe(7);
  });

  it("rolls the date across midnight boundaries", () => {
    // 2026-07-07 03:00 UTC = Monday 2026-07-06 22:00 Chicago
    const p = zonedParts(new Date("2026-07-07T03:00:00Z"), "America/Chicago");
    expect(p.dateStr).toBe("2026-07-06");
    expect(p.weekday).toBe(1);
    expect(p.hour).toBe(22);
  });
});

describe("shouldRunNow", () => {
  it("runs on a weekday at/after the hour", () => {
    const r = shouldRunNow(new Date("2026-07-06T12:30:00Z"), CHI); // Mon 07:30
    expect(r.run).toBe(true);
    expect(r.dateStr).toBe("2026-07-06");
  });

  it("does not run before the hour", () => {
    const r = shouldRunNow(new Date("2026-07-06T11:59:00Z"), CHI); // Mon 06:59
    expect(r.run).toBe(false);
  });

  it("does not run on Saturday", () => {
    const r = shouldRunNow(new Date("2026-07-04T13:00:00Z"), CHI); // Sat 08:00
    expect(r.run).toBe(false);
  });

  it("does not run on Sunday", () => {
    const r = shouldRunNow(new Date("2026-07-05T13:00:00Z"), CHI); // Sun 08:00
    expect(r.run).toBe(false);
  });
});

describe("computeWindow", () => {
  const now = new Date("2026-07-06T12:30:00Z");

  it("defaults to 24h back when there is no previous brief", () => {
    const w = computeWindow(now, null);
    expect(w.periodEnd.getTime()).toBe(now.getTime());
    expect(w.periodStart.getTime()).toBe(now.getTime() - 24 * 3600_000);
  });

  it("starts where the previous brief ended", () => {
    const prev = new Date("2026-07-05T12:05:00Z"); // ~24.4h earlier
    const w = computeWindow(now, prev);
    expect(w.periodStart.getTime()).toBe(prev.getTime());
  });

  it("clamps to 72h for long gaps", () => {
    const prev = new Date("2026-07-01T12:05:00Z"); // ~120h earlier
    const w = computeWindow(now, prev);
    expect(w.periodStart.getTime()).toBe(now.getTime() - 72 * 3600_000);
  });
});

describe("nextAction", () => {
  it("composes when no row exists", () => {
    expect(nextAction(undefined)).toBe("compose");
  });
  it("composes again on pending or failed_compose under the attempt cap", () => {
    expect(nextAction({ status: "pending", attempts: 1 })).toBe("compose");
    expect(nextAction({ status: "failed_compose", attempts: 2 })).toBe("compose");
  });
  it("falls back once attempts are exhausted", () => {
    expect(nextAction({ status: "failed_compose", attempts: 3 })).toBe("fallback");
  });
  it("sends when composed, resends on failed_send", () => {
    expect(nextAction({ status: "composed", attempts: 1 })).toBe("send");
    expect(nextAction({ status: "failed_send", attempts: 1 })).toBe("send");
  });
  it("is done after sent or sent_fallback", () => {
    expect(nextAction({ status: "sent", attempts: 1 })).toBe("done");
    expect(nextAction({ status: "sent_fallback", attempts: 3 })).toBe("done");
  });
});
