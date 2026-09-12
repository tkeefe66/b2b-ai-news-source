import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";

export function createAnalyticsReadControl(maximumPerMinute = 60): RequestHandler {
  const buckets = new Map<string, { since: number; count: number }>();
  const day = (value: unknown): number | null => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const stamp = Date.parse(`${value}T00:00:00Z`);
    return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === value ? stamp : null;
  };
  // Mount only at /api/analytics after authentication; feed reads/polling remain unaffected.
  return (req, res, next) => {
    if (!["GET", "HEAD"].includes(req.method)) return next();
    const actor = req.auth?.sub;
    if (!actor) { res.status(401).json({ error: "Sign in to view analytics." }); return; }
    const now = Date.now();
    for (const [key, bucket] of Array.from(buckets)) if (now - bucket.since >= 60_000) buckets.delete(key);
    const bucket = buckets.get(actor) ?? { since: now, count: 0 };
    bucket.count++;
    buckets.set(actor, bucket);
    if (bucket.count > maximumPerMinute) {
      res.setHeader("Retry-After", "60");
      res.status(429).json({ error: "Too many analytics requests. Retry in a minute." }); return;
    }
    const { days, dateFrom, dateTo } = req.query;
    if (days !== undefined && (typeof days !== "string" || !/^\d+$/.test(days) || Number(days) < 1 || Number(days) > 365)) {
      res.status(400).json({ error: "Choose an analytics period from 1 to 365 days." }); return;
    }
    if (dateFrom !== undefined || dateTo !== undefined) {
      const from = day(dateFrom), to = day(dateTo);
      if (from === null || to === null || to < from || to - from > 365 * 86400000) {
        res.status(400).json({ error: "Provide valid start and end dates (YYYY-MM-DD), at most 365 days apart." }); return;
      }
    }
    next();
  };
}

export const securityHeaders: RequestHandler = (_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Content-Security-Policy", "frame-ancestors 'none'; base-uri 'self'; object-src 'none'");
  if (process.env.NODE_ENV === "production") res.setHeader("Strict-Transport-Security", "max-age=31536000");
  res.setHeader("Cache-Control", "no-store");
  next();
};

export function requestAudit(write: (line: string) => void): RequestHandler {
  return (req, res, next) => {
    const started = Date.now();
    const id = randomUUID();
    res.setHeader("X-Request-ID", id);
    res.once("finish", () => {
      // Route templates only: URLs, query strings and all bodies may be private.
      write(JSON.stringify({ id, method: req.method, route: req.route?.path ?? "unmatched", status: res.statusCode, durationMs: Date.now() - started }));
    });
    next();
  };
}

export function createAdmissionControl(activeJobs: () => Promise<number>, maximum = 8): RequestHandler {
  let pending = 0;
  let windowStart = Date.now();
  let attempts = 0;
  // One trusted workspace, one replica. Daily AI reservations are separately atomic in SQL.
  return async (req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    if (Date.now() - windowStart >= 60_000) { windowStart = Date.now(); attempts = 0; }
    if (++attempts > 120 || pending >= maximum) {
      res.setHeader("Retry-After", "60");
      res.status(429).json({ error: "Workspace is busy. Please retry in a minute." });
      return;
    }
    pending++;
    let released = false;
    let handedOff = false;
    const release = () => { if (!released) { released = true; pending--; } };
    res.once("finish", release);
    res.once("close", () => {
      if (!handedOff) release();
      else { const timer = setTimeout(release, 120_000); timer.unref(); }
    });
    try {
      // Chunk assembly does not start a processing job, but still consumes a request slot.
      const running = req.method === "POST" ? await activeJobs() : 0;
      if (released || req.destroyed || res.destroyed) { release(); return; }
      if (running + pending > maximum) {
        release();
        res.setHeader("Retry-After", "30");
        res.status(429).json({ error: "Too many documents are processing. Wait for a job to finish." });
        return;
      }
      handedOff = true;
      next();
    } catch {
      release();
      res.status(503).json({ error: "Could not check processing capacity. Please retry shortly." });
    }
  };
}
