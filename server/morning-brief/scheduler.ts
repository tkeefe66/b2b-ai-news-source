import { storage } from "../storage";
import type { Brief } from "@shared/schema";
import { briefPayloadSchema } from "@shared/brief-payload";
import { getBriefConfig, type BriefConfig } from "./config";
import { shouldRunNow, computeWindow, nextAction, zonedParts } from "./schedule-logic";
import { gatherInputs, composeBrief } from "./composer";
import { renderBriefEmail, renderFallbackEmail } from "./render-email";
import { sendEmail } from "./deliver";
import { blog } from "./log";

const TICK_MS = 5 * 60 * 1000;

export interface PipelineDeps {
  compose: typeof composeBrief;
  send: typeof sendEmail;
}

function deps(partial: Partial<PipelineDeps> = {}): PipelineDeps {
  return { compose: partial.compose ?? composeBrief, send: partial.send ?? sendEmail };
}

async function sendStored(brief: Brief, cfg: BriefConfig, d: PipelineDeps): Promise<Brief> {
  try {
    let email;
    if (brief.payload) {
      const payload = briefPayloadSchema.parse(JSON.parse(brief.payload));
      email = renderBriefEmail(payload, cfg.appUrl);
    } else {
      // Fallback content: last 24h of headlines, fetched fresh
      const now = new Date();
      const articles = await storage.getArticlesByDateRange(
        new Date(now.getTime() - 24 * 3600_000),
        now,
      );
      email = renderFallbackEmail(articles, brief.briefDate, cfg.appUrl);
    }
    await d.send(email, cfg.recipients);
    const status = brief.payload ? "sent" : "sent_fallback";
    blog(`brief ${brief.id} (${brief.briefDate}) ${status}`);
    return (await storage.updateBrief(brief.id, { status, sentAt: new Date(), error: null }))!;
  } catch (err: any) {
    blog(`brief ${brief.id} send failed: ${err.message}`);
    return (await storage.updateBrief(brief.id, { status: "failed_send", error: err.message }))!;
  }
}

export async function executeAction(
  brief: Brief,
  action: "compose" | "fallback" | "send",
  cfg: BriefConfig,
  partialDeps: Partial<PipelineDeps> = {},
): Promise<Brief> {
  const d = deps(partialDeps);

  if (action === "compose") {
    await storage.updateBrief(brief.id, { attempts: brief.attempts + 1 });
    try {
      blog(`composing brief for ${brief.briefDate} (attempt ${brief.attempts + 1})`);
      const inputs = await gatherInputs(brief.briefDate, {
        periodStart: brief.periodStart!,
        periodEnd: brief.periodEnd!,
      });
      const payload = await d.compose(inputs);
      const composed = (await storage.updateBrief(brief.id, {
        payload: JSON.stringify(payload),
        status: "composed",
        error: null,
      }))!;
      return sendStored(composed, cfg, d);
    } catch (err: any) {
      blog(`compose failed for ${brief.briefDate}: ${err.message}`);
      return (await storage.updateBrief(brief.id, {
        status: "failed_compose",
        error: err.message,
      }))!;
    }
  }

  if (action === "fallback") {
    blog(`attempts exhausted for ${brief.briefDate} — sending fallback headlines`);
    return sendStored({ ...brief, payload: null }, cfg, d);
  }

  // action === "send"
  return sendStored(brief, cfg, d);
}

export async function briefTick(now: Date = new Date(), partialDeps: Partial<PipelineDeps> = {}): Promise<void> {
  const cfg = getBriefConfig();
  if (!cfg.enabled) return;

  const { run, dateStr, reason } = shouldRunNow(now, cfg);
  if (!run) return;

  const existing = await storage.getRealBriefByDate(dateStr);
  const action = nextAction(existing);
  if (action === "done") return;

  blog(`tick: ${dateStr} action=${action} (${reason})`);
  let brief = existing;
  if (!brief) {
    const prev = await storage.getLatestRealBrief();
    const window = computeWindow(now, prev?.periodEnd ?? null);
    brief = await storage.createBrief({
      briefDate: dateStr,
      manual: false,
      periodStart: window.periodStart,
      periodEnd: window.periodEnd,
      status: "pending",
      attempts: 0,
    });
  }
  await executeAction(brief, action, cfg, partialDeps);
}

export async function runManualBrief(partialDeps: Partial<PipelineDeps> = {}): Promise<Brief> {
  const cfg = getBriefConfig();
  if (!cfg.enabled) {
    throw new Error(`Morning brief is not configured: ${cfg.disabledReason}`);
  }
  const d = deps(partialDeps);
  const now = new Date();
  const { dateStr } = zonedParts(now, cfg.timeZone);
  const prev = await storage.getLatestRealBrief();
  const window = computeWindow(now, prev?.periodEnd ?? null);
  const brief = await storage.createBrief({
    briefDate: dateStr,
    manual: true,
    periodStart: window.periodStart,
    periodEnd: window.periodEnd,
    status: "pending",
    attempts: 0,
  });
  const result = await executeAction(brief, "compose", cfg, d);
  if (result.status !== "sent") {
    throw new Error(`Manual brief failed (${result.status}): ${result.error || "unknown error"}`);
  }
  return result;
}

let started = false;

export function startBriefScheduler(): void {
  if (started) return;
  started = true;
  const cfg = getBriefConfig();
  if (!cfg.enabled) {
    blog(`scheduler disabled: ${cfg.disabledReason}`);
    return;
  }
  blog(`scheduler started: weekdays ${cfg.hour}:00 ${cfg.timeZone}, ${cfg.recipients.length} recipient(s), tick every ${TICK_MS / 60000} min`);
  setInterval(() => {
    briefTick().catch(err => console.error("Morning brief tick error (non-fatal):", err));
  }, TICK_MS);
  // Also run one tick shortly after boot so a restart after 7am still sends today's brief
  setTimeout(() => {
    briefTick().catch(err => console.error("Morning brief boot tick error (non-fatal):", err));
  }, 15_000);
}
