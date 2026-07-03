import { describe, it, expect } from "vitest";
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
});
