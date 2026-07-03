import type { Brief } from "@shared/schema";

const WEEKDAY_NUM: Record<string, number> = {
  Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
};

export function zonedParts(
  now: Date,
  timeZone: string,
): { dateStr: string; weekday: number; hour: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(now)) {
    if (p.type !== "literal") parts[p.type] = p.value;
  }
  return {
    dateStr: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: WEEKDAY_NUM[parts.weekday],
    // Some ICU versions emit "24" for midnight with hour12: false
    hour: parseInt(parts.hour, 10) % 24,
  };
}

export function shouldRunNow(
  now: Date,
  cfg: { hour: number; timeZone: string },
): { run: boolean; dateStr: string; reason: string } {
  const p = zonedParts(now, cfg.timeZone);
  if (p.weekday >= 6) {
    return { run: false, dateStr: p.dateStr, reason: "weekend" };
  }
  if (p.hour < cfg.hour) {
    return { run: false, dateStr: p.dateStr, reason: `before ${cfg.hour}:00 ${cfg.timeZone}` };
  }
  return { run: true, dateStr: p.dateStr, reason: "due" };
}

const HOUR_MS = 3600_000;

export function computeWindow(
  now: Date,
  prevPeriodEnd: Date | null,
): { periodStart: Date; periodEnd: Date } {
  const floor = now.getTime() - 72 * HOUR_MS;
  const start = prevPeriodEnd
    ? Math.max(prevPeriodEnd.getTime(), floor)
    : now.getTime() - 24 * HOUR_MS;
  return { periodStart: new Date(start), periodEnd: now };
}

export function nextAction(
  existing: Pick<Brief, "status" | "attempts"> | undefined,
  maxAttempts = 3,
): "compose" | "fallback" | "send" | "done" {
  if (!existing) return "compose";
  switch (existing.status) {
    case "pending":
    case "failed_compose":
      return existing.attempts < maxAttempts ? "compose" : "fallback";
    case "composed":
    case "failed_send":
      return "send";
    case "sent":
    case "sent_fallback":
      return "done";
    default:
      return "done";
  }
}
