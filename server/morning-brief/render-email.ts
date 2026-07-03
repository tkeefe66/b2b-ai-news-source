import { format, parseISO } from "date-fns";
import type { BriefPayload } from "@shared/brief-payload";
import type { Article } from "@shared/schema";

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const MIDNIGHT = "#0D1846";
const ORANGE = "#F26B43";
const ANGLE_BG = "#FFF3EE";
const INK = "#1a2333";
const MUTED = "#5a6478";
const RULE = "#e5e8ef";

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function dayLabel(dateStr: string): string {
  return format(parseISO(dateStr), "EEE MMM d");
}

function shell(dateStr: string, bodyHtml: string, appUrl: string): string {
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f4f5f8;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f8;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background:${MIDNIGHT};padding:20px 28px;">
  <span style="font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:bold;color:#ffffff;">GTM Brief</span>
  <span style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#9fb0d8;padding-left:10px;">${esc(dayLabel(dateStr))}</span>
</td></tr>
${bodyHtml}
<tr><td style="padding:24px 28px 8px 28px;" align="center">
  <a href="${appUrl}/morning-brief" style="display:inline-block;background:${ORANGE};color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;text-decoration:none;padding:10px 22px;border-radius:6px;">Open dashboard &rarr;</a>
</td></tr>
<tr><td style="padding:8px 28px 24px 28px;" align="center">
  <span style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:${MUTED};">B2B MarTech Intel &middot; weekday mornings</span>
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function sectionHeading(label: string): string {
  return `<tr><td style="padding:22px 28px 4px 28px;">
  <span style="font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;letter-spacing:0.4px;color:${MUTED};text-transform:uppercase;">${esc(label)}</span>
</td></tr>`;
}

export function renderBriefEmail(payload: BriefPayload, appUrl: string): RenderedEmail {
  const subject = `GTM Brief · ${dayLabel(payload.date)} — ${payload.headline}`;
  const parts: string[] = [];
  const textParts: string[] = [];

  const greeting = payload.quietDay
    ? `Quiet day — ${payload.topStories.length} ${payload.topStories.length === 1 ? "story" : "stories"} worth your time.`
    : payload.headline;
  parts.push(`<tr><td style="padding:22px 28px 0 28px;">
  <span style="font-family:Georgia,serif;font-size:20px;line-height:1.35;color:${INK};font-weight:bold;">${esc(greeting)}</span>
</td></tr>`);
  textParts.push(`GTM BRIEF — ${dayLabel(payload.date)}`, greeting, "");

  parts.push(sectionHeading("Top stories"));
  textParts.push("TOP STORIES");
  for (const s of payload.topStories) {
    const angle = s.dbAngle
      ? `<div style="background:${ANGLE_BG};border-radius:6px;padding:10px 14px;margin-top:8px;">
  <span style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;letter-spacing:0.4px;color:${ORANGE};text-transform:uppercase;">Demandbase angle${s.dbAngle.strength === "moderate" ? " (moderate)" : ""}</span>
  <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:${INK};padding-top:3px;">${esc(s.dbAngle.text)}</div>
</div>`
      : "";
    parts.push(`<tr><td style="padding:12px 28px 4px 28px;border-bottom:1px solid ${RULE};">
  <a href="${esc(s.link)}" style="font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:${MIDNIGHT};text-decoration:none;">${esc(s.title)}</a>
  <span style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${MUTED};"> &middot; ${esc(s.sourceName)}</span>
  <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.55;color:${INK};padding:5px 0 12px 0;">${esc(s.whyItMatters)}</div>
  ${angle}
  <div style="height:10px;"></div>
</td></tr>`);
    textParts.push(`- ${s.title} (${s.sourceName})`, `  ${s.whyItMatters}`, `  ${s.link}`);
    if (s.dbAngle) textParts.push(`  DB ANGLE: ${s.dbAngle.text}`);
  }
  textParts.push("");

  if (payload.competitorWatch.length > 0) {
    parts.push(sectionHeading("Competitor watch"));
    textParts.push("COMPETITOR WATCH");
    for (const c of payload.competitorWatch) {
      const links = c.links
        .map(l => `<a href="${esc(l.url)}" style="color:${MIDNIGHT};font-size:12px;">${esc(l.title)}</a>`)
        .join(" &middot; ");
      parts.push(`<tr><td style="padding:10px 28px 6px 28px;">
  <span style="font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;color:${INK};">${esc(c.competitor)}</span>
  <span style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${INK};"> — ${esc(c.summary)}</span>
  <div style="font-family:Arial,Helvetica,sans-serif;padding-top:2px;">${links}</div>
</td></tr>`);
      textParts.push(`- ${c.competitor}: ${c.summary}`);
    }
    textParts.push("");
  }

  if (payload.trendPulse.length > 0) {
    parts.push(sectionHeading("Trend pulse"));
    textParts.push("TREND PULSE");
    for (const t of payload.trendPulse) {
      const arrow = t.direction === "rising" ? "&#9650;" : "&#9660;";
      parts.push(`<tr><td style="padding:8px 28px 4px 28px;">
  <span style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${INK};"><b>${arrow} ${esc(t.trend)}</b> — ${esc(t.note)}</span>
</td></tr>`);
      textParts.push(`- ${t.direction === "rising" ? "UP" : "DOWN"} ${t.trend}: ${t.note}`);
    }
    textParts.push("");
  }

  if (payload.radar.length > 0) {
    parts.push(sectionHeading("Radar"));
    textParts.push("RADAR");
    for (const r of payload.radar) {
      parts.push(`<tr><td style="padding:6px 28px 2px 28px;">
  <a href="${esc(r.link)}" style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${INK};text-decoration:underline;">${esc(r.title)}</a>
  <span style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${MUTED};"> &middot; ${esc(r.sourceName)}</span>
</td></tr>`);
      textParts.push(`- ${r.title} (${r.sourceName}) ${r.link}`);
    }
    textParts.push("");
  }

  if (payload.contentIdea) {
    parts.push(sectionHeading("Content idea"));
    parts.push(`<tr><td style="padding:8px 28px 4px 28px;">
  <span style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${INK};"><b>${esc(payload.contentIdea.title)}</b> — ${esc(payload.contentIdea.description)}</span>
  <div style="padding-top:4px;"><a href="${appUrl}${esc(payload.contentIdea.deepLink)}" style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${MIDNIGHT};font-weight:bold;">Create &rarr;</a></div>
</td></tr>`);
    textParts.push("CONTENT IDEA", `- ${payload.contentIdea.title}: ${payload.contentIdea.description}`, "");
  }

  return {
    subject,
    html: shell(payload.date, parts.join("\n"), appUrl),
    text: textParts.join("\n"),
  };
}

export function renderFallbackEmail(
  articles: Article[],
  dateStr: string,
  appUrl: string,
): RenderedEmail {
  const top = articles.filter(a => !a.dismissed).slice(0, 10);
  const subject = `GTM Brief · ${dayLabel(dateStr)} — this morning's headlines`;
  const items = top
    .map(
      a => `<tr><td style="padding:7px 28px 3px 28px;">
  <a href="${esc(a.link)}" style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${INK};text-decoration:underline;">${esc(a.title)}</a>
  <span style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${MUTED};"> &middot; ${esc(a.sourceName || "unknown")}</span>
</td></tr>`,
    )
    .join("\n");
  const body = `<tr><td style="padding:22px 28px 0 28px;">
  <span style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:${INK};">Today&#39;s brief couldn&#39;t be generated, so here are the morning&#39;s top headlines instead.</span>
</td></tr>
${sectionHeading("Headlines")}
${items}`;
  const text = [
    `GTM BRIEF — ${dayLabel(dateStr)}`,
    "Today's brief couldn't be generated; top headlines below.",
    "",
    ...top.map(a => `- ${a.title} (${a.sourceName || "unknown"}) ${a.link}`),
  ].join("\n");
  return { subject, html: shell(dateStr, body, appUrl), text };
}
