import { EventEmitter } from "node:events";
import { describe, it, expect, vi } from "vitest";
import { requestAudit, createAdmissionControl, createAnalyticsReadControl } from "./http-security";

describe("analytics read limits", () => {
  const response = () => Object.assign(new EventEmitter(), { status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn() });
  it("rejects invalid or excessive ranges before analytics work starts", () => {
    // Mutation: accepting oversized ranges allows full-archive CPU and memory amplification.
    const gate = createAnalyticsReadControl();
    for (const query of [{ days: "366" }, { days: "30junk" }, { days: ["30", "365"] }, { dateFrom: "2024-01-01", dateTo: "2026-01-01" }, { dateFrom: "2026-02-30", dateTo: "2026-03-01" }, { dateFrom: "2026-02-02" }]) {
      const res = response(), next = vi.fn();
      gate({ method: "GET", query, auth: { sub: "actor" } } as any, res as any, next);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(next).not.toHaveBeenCalled();
    }
  });
  it("allows the maximum range and isolates rate budgets by authenticated actor", () => {
    // Mutation: shared actor bucket blocks a second user; >= instead of > blocks the limit itself.
    const gate = createAnalyticsReadControl(2);
    const next = vi.fn();
    const call = (sub: string, query: object = { days: "365" }) => {
      const res = response();
      gate({ method: "GET", query, auth: { sub } } as any, res as any, next);
      return res;
    };
    call("one"); call("one");
    expect(call("one").status).toHaveBeenCalledWith(429);
    call("two", { dateFrom: "2025-01-01", dateTo: "2026-01-01" });
    expect(next).toHaveBeenCalledTimes(3);
  });
});

describe("HTTP security controls", () => {
  it("does not launch a handler after disconnect during capacity check", async () => {
    // Mutation: continue after the await even though close released the slot.
    let finish!: (value: number) => void;
    const gate = createAdmissionControl(() => new Promise<number>(resolve => { finish = resolve; }));
    const res = Object.assign(new EventEmitter(), { status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn() });
    const next = vi.fn();
    const request = gate({ method: "POST" } as any, res as any, next);
    res.emit("close"); finish(0); await request;
    expect(next).not.toHaveBeenCalled();
  });
  it("logs metadata without serializing private response bodies", () => {
    // Mutation: wrapping res.json and logging its body leaks the sentinel.
    const output = vi.fn();
    const res = Object.assign(new EventEmitter(), { statusCode: 200, json: vi.fn(), setHeader: vi.fn() });
    const req = { method: "GET", path: "/api/knowledge", route: { path: "/api/knowledge" } };
    requestAudit(output)(req as any, res as any, () => {});
    res.json({ secret: "PRIVATE-SENTINEL", base64: "PRIVATE-BASE64" });
    res.emit("finish");
    expect(output.mock.calls.flat().join(" ")).toContain("200");
    expect(output.mock.calls.flat().join(" ")).not.toMatch(/PRIVATE|base64|secret/);
  });
  it("reserves capacity before concurrent database admission checks", async () => {
    // Mutation: incrementing only after await allows every request through.
    let finish!: (value: number) => void;
    const check = vi.fn(() => new Promise<number>(resolve => { finish = resolve; }));
    const gate = createAdmissionControl(check, 1);
    const response = () => Object.assign(new EventEmitter(), { status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn() });
    const first = response(), second = response();
    const next = vi.fn();
    const active = gate({ method: "POST" } as any, first as any, next);
    await gate({ method: "POST" } as any, second as any, next);
    expect(second.status).toHaveBeenCalledWith(429);
    finish(0); await active;
    expect(next).toHaveBeenCalledTimes(1);
    first.emit("finish");
  });
});
