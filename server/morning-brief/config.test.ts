import { describe, it, expect, vi } from "vitest";
import { getBriefConfig } from "./config";

const fullEnv = {
  RESEND_API_KEY: "re_123",
  BRIEF_RECIPIENTS: "tom@example.com, sara@example.com",
  BRIEF_HOUR: "6",
  BRIEF_TZ: "America/New_York",
  APP_URL: "https://intel.example.com",
} as NodeJS.ProcessEnv;

describe("getBriefConfig", () => {
  it("parses a complete env", () => {
    const cfg = getBriefConfig(fullEnv);
    expect(cfg.enabled).toBe(true);
    expect(cfg.hour).toBe(6);
    expect(cfg.timeZone).toBe("America/New_York");
    expect(cfg.recipients).toEqual(["tom@example.com", "sara@example.com"]);
    expect(cfg.appUrl).toBe("https://intel.example.com");
  });

  it("applies defaults for hour, tz, appUrl", () => {
    const cfg = getBriefConfig({
      RESEND_API_KEY: "re_123",
      BRIEF_RECIPIENTS: "tom@example.com",
    } as NodeJS.ProcessEnv);
    expect(cfg.hour).toBe(7);
    expect(cfg.timeZone).toBe("America/Chicago");
    expect(cfg.appUrl).toBe("http://localhost:5000");
    expect(cfg.enabled).toBe(true);
  });

  it("is disabled without RESEND_API_KEY", () => {
    const cfg = getBriefConfig({ BRIEF_RECIPIENTS: "tom@example.com" } as NodeJS.ProcessEnv);
    expect(cfg.enabled).toBe(false);
    expect(cfg.disabledReason).toContain("RESEND_API_KEY");
  });

  it("is disabled without recipients", () => {
    const cfg = getBriefConfig({ RESEND_API_KEY: "re_123" } as NodeJS.ProcessEnv);
    expect(cfg.enabled).toBe(false);
    expect(cfg.disabledReason).toContain("BRIEF_RECIPIENTS");
  });

  it("ignores empty entries in the recipient list", () => {
    const cfg = getBriefConfig({
      RESEND_API_KEY: "re_123",
      BRIEF_RECIPIENTS: " tom@example.com ,, ",
    } as NodeJS.ProcessEnv);
    expect(cfg.recipients).toEqual(["tom@example.com"]);
  });

  describe("BRIEF_HOUR validation", () => {
    const withKey = (overrides: Partial<NodeJS.ProcessEnv> = {}) =>
      ({ RESEND_API_KEY: "re_123", BRIEF_RECIPIENTS: "tom@example.com", ...overrides }) as NodeJS.ProcessEnv;

    it('falls back to 7 and warns for a non-numeric BRIEF_HOUR ("abc")', () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const cfg = getBriefConfig(withKey({ BRIEF_HOUR: "abc" }));
      expect(cfg.hour).toBe(7);
      expect(warn).toHaveBeenCalledTimes(1);
      warn.mockRestore();
    });

    it('falls back to 7 and warns for an out-of-range BRIEF_HOUR ("25")', () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const cfg = getBriefConfig(withKey({ BRIEF_HOUR: "25" }));
      expect(cfg.hour).toBe(7);
      expect(warn).toHaveBeenCalledTimes(1);
      warn.mockRestore();
    });

    it('accepts the valid boundary BRIEF_HOUR "0" without warning', () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const cfg = getBriefConfig(withKey({ BRIEF_HOUR: "0" }));
      expect(cfg.hour).toBe(0);
      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });
  });
});
