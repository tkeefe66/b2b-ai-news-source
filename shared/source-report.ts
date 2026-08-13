import type { SourceReportRow } from "./schema";

export type SourceClass = "failing" | "silent" | "producing";

// Failing wins over silent: a feed that errors is a different problem from one that
// fetches cleanly and simply has nothing to say, and it needs a different fix.
export function classifySource(row: SourceReportRow): SourceClass {
  if (row.failureDays > 0) return "failing";
  if (row.count30d === 0) return "silent";
  return "producing";
}

export function dismissalRate(row: SourceReportRow): string {
  if (row.countAll === 0) return "—";
  return `${Math.round((row.dismissedAll / row.countAll) * 100)}%`;
}

// A zero blocked count is only meaningful once a fetch has actually run since the
// instrumentation shipped — before that, zero means "unobserved", not "clean".
export function blockedDisplay(row: SourceReportRow): string {
  if (row.blockedAll === 0 && row.lastFetchedAt === null) return "—";
  return String(row.blockedAll);
}
