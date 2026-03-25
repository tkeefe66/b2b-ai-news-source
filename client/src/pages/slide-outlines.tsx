import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { VoiceInputButton } from "@/components/VoiceInputButton";
import { GoogleDrivePickerButton } from "@/components/google-drive-picker";
import { useSelectedModel } from "@/components/ModelSelector";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Loader2,
  MessageSquare,
  Send,
  Upload,
  ChevronDown,
  ChevronUp,
  FileUp,
  Sparkles,
  Check,
  X,
  LayoutTemplate,
  Eye,
  AlertCircle,
  ShieldCheck,
  ShieldOff,
  Trash2,
  Pencil,
  ImageIcon,
  Copy,
  ArrowRightLeft,
  Brain,
  RefreshCw,
} from "lucide-react";

interface SlideLayout {
  id: string;
  dbId: number;
  name: string;
  variantName: string;
  description: string;
  sample: { title: string; body: string; layout: string };
  designNotes: string;
  isApproved: boolean;
  isDefault: boolean;
  sourceFile: string | null;
  designTemplate: string;
}

interface DeckDesign {
  name: string;
  description: string;
  isNew: boolean;
  existingLayoutId: string | null;
  designDetails: string;
  designNotes?: string;
  suggestedChanges: string;
  sampleTitle?: string;
  sampleBody?: string;
  slideNums?: number[];
}

const layoutColors: Record<string, string> = {
  section: "bg-[#0D1846] text-white",
  subsection: "bg-white text-[#0D1846] dark:bg-slate-900 dark:text-white",
  statement: "bg-white text-[#0D1846] dark:bg-slate-900 dark:text-white",
  stats: "bg-[#F8FAFC] text-[#0D1846] dark:bg-slate-900 dark:text-white",
  comparison: "bg-[#F8FAFC] text-[#0D1846] dark:bg-slate-900 dark:text-white",
  callout: "bg-[#F8FAFC] text-[#0D1846] dark:bg-slate-900 dark:text-white",
  quote: "bg-[#DBECFF] text-[#0D1846] dark:bg-sky-950/40 dark:text-white",
  content: "bg-white text-[#0D1846] dark:bg-slate-900 dark:text-white",
  objection: "bg-[#F8FAFC] text-[#0D1846] dark:bg-slate-900 dark:text-white",
  closing: "bg-[#0D1846] text-white",
  title: "bg-white text-[#0D1846] dark:bg-slate-900 dark:text-white",
  speakers: "bg-white text-[#0D1846] dark:bg-slate-900 dark:text-white",
  timeline: "bg-white text-[#0D1846] dark:bg-slate-900 dark:text-white",
};

function detectVariant(designNotes: string): string {
  const n = designNotes.toLowerCase();
  if (n.includes("two column lines")) return "twocollines";
  if (n.includes("four column")) return "fourcol";
  if (n.includes("three column images")) return "threecolimg";
  if (n.includes("two column shapes")) return "twocolshapes";
  if (n.includes("three column shapes")) return "threecolshapes";
  if (n.includes("image content split")) return "imagesplit";
  if (n.includes("image title layout")) return "imagetitle";
  if (n.includes("sky speakers")) return "skyspeakers";
  if (n.includes("sunset glass")) return "sunsetglass";
  if (n.includes("numbered tips")) return "tips";
  if (n.includes("sky gradient section") || n.includes("sky gradient") && n.includes("section")) return "skygradient";
  if (n.includes("subsection breadcrumb") || n.includes("breadcrumb")) return "breadcrumb";
  if (n.includes("sunset gradient statement") || n.includes("sunset gradient") && n.includes("statement")) return "sunsetgrad";
  if (n.includes("sky gradient shape") || n.includes("sky shape")) return "skyshape";
  if (n.includes("numbered paragraphs") || n.includes("numbered analysis")) return "numberedparagraphs";
  if (n.includes("dos donts") || n.includes("dos don")) return "dosdonts";
  if (n.includes("bento grid")) return "bentogrid";
  if (n.includes("bento large")) return "bentolarge";
  if (n.includes("image cover closing") || n.includes("image cover")) return "imagecover";
  if (n.includes("timeline")) return "timeline";
  if (n.includes("speakers")) return "speakers";
  if (n.includes("bold header") || n.includes("full-width midnight header")) return "bold";
  if (n.includes("minimal accent") || n.includes("thin accent line")) return "minimal";
  if (n.includes("left accent bar") || n.includes("tall accent bar")) return "accent";
  if (n.includes("dark header") || n.includes("midnight header bar with white title")) return "darkheader";
  if (n.includes("midnight background") && !n.includes("section number") && !n.includes("headline:")) return "dark";
  if (n.includes("stat cards") || n.includes("card background")) return "cards";
  if (n.includes("contrast columns")) return "contrast";
  if (n.includes("bordered columns") || n.includes("colored left border")) return "bordered";
  if (n.includes("accent bottom bar") || n.includes("sunset bottom bar")) return "accentbar";
  if (n.includes("pull-quote") || n.includes("pull quote")) return "pullquote";
  if (n.includes("clean layout") || (n.includes("no header") && n.includes("no footer"))) return "clean";
  if (n.includes("warm closing") || n.includes("lavender dot")) return "warm";
  if (n.includes("minimal style") || n.includes("minimal:")) return "minimal";
  return "standard";
}

const C = {
  MIDNIGHT: "#0D1846",
  SKY: "#4CA3FF",
  SUNSET: "#FF7C33",
  WHITE: "#FFFFFF",
  CLOUD: "#F8FAFC",
  SKY_TINT: "#DBECFF",
  SUNSET_TINT: "#FFE4D6",
  LAVENDER: "#8E6FD6",
  LAVENDER_TINT: "#EDE8F5",
  HUNTER: "#17575D",
  HUNTER_TINT: "#E0F0F1",
  CASCADE: "#69BE28",
  MERLOT: "#882E52",
  BLUSH: "#FF5162",
};

function SlideCanvas({ sample, layoutId, designNotes }: { sample: SlideLayout["sample"]; layoutId: string; designNotes?: string }) {
  const layout = layoutId;
  const bodyLines = sample.body.split("\n").filter(Boolean);
  const v = detectVariant(designNotes || "");

  const W = 960;
  const H = 600;

  const isDark = (layout === "section" && v !== "skygradient") || (layout === "closing") ||
    (layout === "statement" && v === "dark") || (layout === "stats" && v === "dark") ||
    (layout === "quote" && v === "dark");
  const isSkyBg = (layout === "quote" && v === "standard");
  const isSunsetTintBg = (layout === "title" && v === "sunsetglass");
  const bgColor = isDark ? C.MIDNIGHT : isSkyBg ? C.SKY_TINT : isSunsetTintBg ? C.SUNSET_TINT : C.WHITE;
  const textColor = isDark ? C.WHITE : C.MIDNIGHT;

  const centered: React.CSSProperties = { display: "flex", flexDirection: "column", justifyContent: "center", height: "100%", boxSizing: "border-box" };
  const serif = "'Roboto Serif', Georgia, serif";

  return (
    <div style={{ width: W, height: H, background: bgColor, position: "relative", fontFamily: "Roboto, sans-serif", color: textColor, overflow: "hidden" }}>

      {layout === "title" && v === "standard" && (
        <>
          <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 34, background: C.MIDNIGHT }} />
          <div style={{ ...centered, paddingLeft: 77, paddingRight: 80 }}>
            <div style={{ fontFamily: serif, fontSize: 36, fontWeight: 700, color: C.MIDNIGHT, lineHeight: 1.2 }}>{sample.title}</div>
            <div style={{ fontSize: 16, color: C.MIDNIGHT, marginTop: 24, opacity: 0.7 }}>{bodyLines.join(" ")}</div>
          </div>
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 6, background: C.SKY }} />
        </>
      )}
      {layout === "title" && v === "bold" && (
        <>
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 100, background: C.MIDNIGHT }} />
          <div style={{ position: "absolute", top: 100, left: 0, right: 0, height: 4, background: C.SUNSET }} />
          <div style={{ ...centered, padding: "0 80px", paddingTop: 40 }}>
            <div style={{ fontFamily: serif, fontSize: 38, fontWeight: 700, color: C.MIDNIGHT, lineHeight: 1.2 }}>{sample.title}</div>
            <div style={{ fontSize: 16, color: C.MIDNIGHT, marginTop: 20, opacity: 0.6 }}>{bodyLines.join(" ")}</div>
          </div>
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 6, background: C.SUNSET }} />
        </>
      )}
      {layout === "title" && v === "minimal" && (
        <>
          <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 6, background: C.LAVENDER }} />
          <div style={{ ...centered, paddingLeft: 48, paddingRight: 80 }}>
            <div style={{ fontFamily: serif, fontSize: 36, fontWeight: 700, color: C.MIDNIGHT, lineHeight: 1.2 }}>{sample.title}</div>
            <div style={{ width: 80, height: 3, background: C.LAVENDER, marginTop: 20 }} />
            <div style={{ fontSize: 16, color: C.MIDNIGHT, marginTop: 16, opacity: 0.6 }}>{bodyLines.join(" ")}</div>
          </div>
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 6, background: C.HUNTER }} />
        </>
      )}

      {layout === "content" && v === "standard" && (
        <>
          <div style={{ position: "absolute", top: 38, left: 67, right: 67 }}>
            <div style={{ fontFamily: serif, fontSize: 24, fontWeight: 700, color: C.MIDNIGHT }}>{sample.title}</div>
            <div style={{ width: 60, height: 3, background: C.SKY, marginTop: 12 }} />
          </div>
          <div style={{ position: "absolute", top: 115, left: 67, right: 67, bottom: 38, display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {bodyLines.map((line, j) => (
                <div key={j} style={{ display: "flex", alignItems: "flex-start", gap: 12, fontSize: 14, lineHeight: 1.6 }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: C.SKY, marginTop: 8, flexShrink: 0 }} />
                  <span>{line.replace(/^- /, "")}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
      {layout === "content" && v === "accent" && (
        <>
          <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 8, background: C.SKY }} />
          <div style={{ position: "absolute", top: 38, left: 48, right: 67 }}>
            <div style={{ fontFamily: serif, fontSize: 24, fontWeight: 700, color: C.MIDNIGHT }}>{sample.title}</div>
          </div>
          <div style={{ position: "absolute", top: 105, left: 48, right: 67, bottom: 38, display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {bodyLines.map((line, j) => (
                <div key={j} style={{ display: "flex", alignItems: "flex-start", gap: 12, fontSize: 14, lineHeight: 1.6 }}>
                  <div style={{ width: 4, height: 4, borderRadius: "50%", background: C.SUNSET, marginTop: 9, flexShrink: 0 }} />
                  <span>{line.replace(/^- /, "")}</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 4, background: C.SKY }} />
        </>
      )}
      {layout === "content" && v === "darkheader" && (
        <>
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 90, background: C.MIDNIGHT, display: "flex", alignItems: "center", paddingLeft: 48 }}>
            <div style={{ fontFamily: serif, fontSize: 22, fontWeight: 700, color: C.WHITE }}>{sample.title}</div>
          </div>
          <div style={{ position: "absolute", top: 90, left: 0, right: 0, height: 3, background: C.SUNSET }} />
          <div style={{ position: "absolute", top: 115, left: 67, right: 67, bottom: 38, display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {bodyLines.map((line, j) => (
                <div key={j} style={{ display: "flex", alignItems: "flex-start", gap: 12, fontSize: 14, lineHeight: 1.6 }}>
                  <div style={{ width: 20, height: 3, background: C.SUNSET, marginTop: 10, flexShrink: 0 }} />
                  <span>{line.replace(/^- /, "")}</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 28, background: C.MIDNIGHT }} />
        </>
      )}

      {layout === "stats" && v === "standard" && (
        <>
          <div style={{ position: "absolute", top: 38, left: 67, right: 67 }}>
            <div style={{ fontFamily: serif, fontSize: 24, fontWeight: 700, color: C.MIDNIGHT }}>{sample.title}</div>
          </div>
          <div style={{ position: "absolute", top: 120, left: 67, right: 67, bottom: 60, display: "flex", justifyContent: "space-around", alignItems: "center" }}>
            {bodyLines.slice(0, 3).map((line, j) => {
              const parts = line.split("|");
              const colors = [C.SKY, C.SUNSET, C.LAVENDER];
              return (
                <div key={j} style={{ textAlign: "center", flex: 1, padding: "0 10px" }}>
                  <div style={{ fontSize: 54, fontWeight: 700, color: C.MIDNIGHT, lineHeight: 1 }}>{parts[0]?.trim()}</div>
                  <div style={{ width: "60%", height: 3, background: colors[j], margin: "14px auto" }} />
                  <div style={{ fontSize: 14, color: C.MIDNIGHT, opacity: 0.7, lineHeight: 1.4 }}>{parts[1]?.trim()}</div>
                </div>
              );
            })}
          </div>
        </>
      )}
      {layout === "stats" && v === "dark" && (
        <>
          <div style={{ position: "absolute", top: 38, left: 67, right: 67 }}>
            <div style={{ fontFamily: serif, fontSize: 24, fontWeight: 700, color: C.WHITE }}>{sample.title}</div>
          </div>
          <div style={{ position: "absolute", top: 120, left: 67, right: 67, bottom: 60, display: "flex", justifyContent: "space-around", alignItems: "center" }}>
            {bodyLines.slice(0, 3).map((line, j) => {
              const parts = line.split("|");
              const colors = [C.SKY, C.SUNSET, C.CASCADE];
              return (
                <div key={j} style={{ textAlign: "center", flex: 1, padding: "0 10px" }}>
                  <div style={{ fontSize: 54, fontWeight: 700, color: colors[j], lineHeight: 1 }}>{parts[0]?.trim()}</div>
                  <div style={{ width: "50%", height: 3, background: colors[j], margin: "14px auto", opacity: 0.5 }} />
                  <div style={{ fontSize: 14, color: C.WHITE, opacity: 0.7, lineHeight: 1.4 }}>{parts[1]?.trim()}</div>
                </div>
              );
            })}
          </div>
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 4, background: C.SUNSET }} />
        </>
      )}
      {layout === "stats" && v === "cards" && (
        <>
          <div style={{ position: "absolute", top: 38, left: 67, right: 67 }}>
            <div style={{ fontFamily: serif, fontSize: 24, fontWeight: 700, color: C.MIDNIGHT }}>{sample.title}</div>
          </div>
          <div style={{ position: "absolute", top: 120, left: 48, right: 48, bottom: 40, display: "flex", gap: 20, alignItems: "center" }}>
            {bodyLines.slice(0, 3).map((line, j) => {
              const parts = line.split("|");
              const bgs = [C.SKY_TINT, C.SUNSET_TINT, C.LAVENDER_TINT];
              const accents = [C.SKY, C.SUNSET, C.LAVENDER];
              return (
                <div key={j} style={{ flex: 1, background: bgs[j], borderRadius: 8, padding: "32px 20px", textAlign: "center", position: "relative", overflow: "hidden" }}>
                  <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 4, background: accents[j] }} />
                  <div style={{ fontSize: 48, fontWeight: 700, color: C.MIDNIGHT, lineHeight: 1 }}>{parts[0]?.trim()}</div>
                  <div style={{ fontSize: 13, color: C.MIDNIGHT, opacity: 0.7, marginTop: 12, lineHeight: 1.4 }}>{parts[1]?.trim()}</div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {layout === "comparison" && v === "standard" && (() => {
        const halves = sample.body.split("---");
        return (
          <>
            <div style={{ position: "absolute", top: 38, left: 67, right: 67 }}>
              <div style={{ fontFamily: serif, fontSize: 24, fontWeight: 700, color: C.MIDNIGHT }}>{sample.title}</div>
            </div>
            <div style={{ position: "absolute", top: 115, left: 48, right: 48, bottom: 38, display: "flex", gap: 20 }}>
              {halves.slice(0, 2).map((half, j) => {
                const lines = half.split("\n").filter(Boolean);
                const header = lines[0]?.replace(/\*\*/g, "").trim() || "";
                const body = lines.slice(1);
                return (
                  <div key={j} style={{ flex: 1, background: C.SKY_TINT, borderRadius: 4, padding: "24px 28px", display: "flex", flexDirection: "column" }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: C.MIDNIGHT, marginBottom: 16, paddingBottom: 12, borderBottom: "2px solid rgba(76,163,255,0.3)" }}>{header}</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1, justifyContent: "center" }}>
                      {body.map((line, k) => (
                        <div key={k} style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 13, lineHeight: 1.5, color: C.MIDNIGHT }}>
                          <div style={{ width: 5, height: 5, borderRadius: "50%", background: C.SKY, marginTop: 6, flexShrink: 0 }} />
                          <span>{line.replace(/\*\*/g, "").replace(/^- /, "")}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        );
      })()}
      {layout === "comparison" && v === "contrast" && (() => {
        const halves = sample.body.split("---");
        const colBgs = [C.SUNSET_TINT, C.SKY_TINT];
        const colAccents = [C.SUNSET, C.SKY];
        return (
          <>
            <div style={{ position: "absolute", top: 38, left: 67, right: 67 }}>
              <div style={{ fontFamily: serif, fontSize: 24, fontWeight: 700, color: C.MIDNIGHT }}>{sample.title}</div>
            </div>
            <div style={{ position: "absolute", top: 115, left: 48, right: 48, bottom: 38, display: "flex", gap: 20 }}>
              {halves.slice(0, 2).map((half, j) => {
                const lines = half.split("\n").filter(Boolean);
                const header = lines[0]?.replace(/\*\*/g, "").trim() || "";
                const body = lines.slice(1);
                return (
                  <div key={j} style={{ flex: 1, background: colBgs[j], borderRadius: 4, padding: "24px 28px", position: "relative", overflow: "hidden", display: "flex", flexDirection: "column" }}>
                    <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 4, background: colAccents[j] }} />
                    <div style={{ fontSize: 16, fontWeight: 700, color: C.MIDNIGHT, marginBottom: 14, marginTop: 4 }}>{header}</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1, justifyContent: "center" }}>
                      {body.map((line, k) => (
                        <div key={k} style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 13, lineHeight: 1.5, color: C.MIDNIGHT }}>
                          <div style={{ width: 16, height: 3, background: colAccents[j], marginTop: 8, flexShrink: 0, opacity: 0.6 }} />
                          <span>{line.replace(/\*\*/g, "").replace(/^- /, "")}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        );
      })()}
      {layout === "comparison" && v === "bordered" && (() => {
        const halves = sample.body.split("---");
        const borderColors = [C.MERLOT, C.HUNTER];
        return (
          <>
            <div style={{ position: "absolute", top: 38, left: 67, right: 67 }}>
              <div style={{ fontFamily: serif, fontSize: 24, fontWeight: 700, color: C.MIDNIGHT }}>{sample.title}</div>
            </div>
            <div style={{ position: "absolute", top: 115, left: 48, right: 48, bottom: 38, display: "flex", gap: 24 }}>
              {halves.slice(0, 2).map((half, j) => {
                const lines = half.split("\n").filter(Boolean);
                const header = lines[0]?.replace(/\*\*/g, "").trim() || "";
                const body = lines.slice(1);
                return (
                  <div key={j} style={{ flex: 1, background: C.WHITE, borderRadius: 4, padding: "24px 28px", position: "relative", borderLeft: `5px solid ${borderColors[j]}`, display: "flex", flexDirection: "column", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: borderColors[j], marginBottom: 14 }}>{header}</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1, justifyContent: "center" }}>
                      {body.map((line, k) => (
                        <div key={k} style={{ fontSize: 13, lineHeight: 1.5, color: C.MIDNIGHT, paddingLeft: 12 }}>
                          {line.replace(/\*\*/g, "").replace(/^- /, "• ")}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        );
      })()}

      {layout === "objection" && v === "standard" && (() => {
        const halves = sample.body.split("---");
        return (
          <>
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 100, background: C.MIDNIGHT, display: "flex", alignItems: "center", paddingLeft: 48 }}>
              <div style={{ fontFamily: serif, fontSize: 22, fontWeight: 700, color: C.WHITE }}>{sample.title}</div>
            </div>
            <div style={{ position: "absolute", top: 120, left: 48, right: 48, bottom: 56, display: "flex", gap: 20 }}>
              {halves.slice(0, 2).map((half, j) => {
                const lines = half.split("\n").filter(Boolean);
                const accentColor = j === 0 ? C.SUNSET : C.SKY;
                return (
                  <div key={j} style={{ flex: 1, background: C.CLOUD, borderRadius: 4, position: "relative", paddingLeft: 30, paddingTop: 20, paddingRight: 20 }}>
                    <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 6, background: accentColor, borderRadius: "4px 0 0 4px" }} />
                    {lines.map((line, k) => (
                      <div key={k} style={{ fontSize: line.startsWith("**") ? 14 : 11, fontWeight: line.startsWith("**") ? 700 : 400, color: line.startsWith("**") ? accentColor : C.MIDNIGHT, marginBottom: line.startsWith("**") ? 10 : 5, lineHeight: 1.5 }}>
                        {line.replace(/\*\*/g, "").replace(/^- /, "• ")}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
            <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 32, background: C.MIDNIGHT }} />
            <div style={{ position: "absolute", bottom: 32, left: 0, right: 0, height: 2, background: C.SUNSET }} />
          </>
        );
      })()}
      {layout === "objection" && v === "clean" && (() => {
        const halves = sample.body.split("---");
        const topColors = [C.SUNSET, C.SKY];
        return (
          <>
            <div style={{ position: "absolute", top: 38, left: 67, right: 67 }}>
              <div style={{ fontFamily: serif, fontSize: 24, fontWeight: 700, color: C.MIDNIGHT }}>{sample.title}</div>
            </div>
            <div style={{ position: "absolute", top: 110, left: 48, right: 48, bottom: 38, display: "flex", gap: 24 }}>
              {halves.slice(0, 2).map((half, j) => {
                const lines = half.split("\n").filter(Boolean);
                return (
                  <div key={j} style={{ flex: 1, background: j === 0 ? C.SUNSET_TINT : C.SKY_TINT, borderRadius: 6, position: "relative", overflow: "hidden", padding: "28px 24px", paddingTop: 32 }}>
                    <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 5, background: topColors[j] }} />
                    {lines.map((line, k) => (
                      <div key={k} style={{ fontSize: line.startsWith("**") ? 15 : 12, fontWeight: line.startsWith("**") ? 700 : 400, color: C.MIDNIGHT, marginBottom: line.startsWith("**") ? 12 : 6, lineHeight: 1.5 }}>
                        {line.replace(/\*\*/g, "").replace(/^- /, "• ")}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </>
        );
      })()}

      {layout === "section" && v === "standard" && (
        <div style={{ ...centered, paddingLeft: 67, paddingRight: 80 }}>
          <div style={{ fontFamily: serif, fontSize: 48, fontWeight: 700, color: C.SKY }}>01</div>
          <div style={{ fontFamily: serif, fontSize: 36, fontWeight: 700, color: C.WHITE, marginTop: 16 }}>{sample.title}</div>
          <div style={{ fontSize: 16, color: C.CLOUD, opacity: 0.7, marginTop: 12 }}>{bodyLines.join(" ")}</div>
        </div>
      )}
      {layout === "section" && v === "accentbar" && (
        <>
          <div style={{ ...centered, paddingLeft: 67, paddingRight: 80 }}>
            <div style={{ fontFamily: serif, fontSize: 48, fontWeight: 700, color: C.SUNSET }}>01</div>
            <div style={{ fontFamily: serif, fontSize: 36, fontWeight: 700, color: C.WHITE, marginTop: 16 }}>{sample.title}</div>
            <div style={{ fontSize: 16, color: C.CLOUD, opacity: 0.7, marginTop: 12 }}>{bodyLines.join(" ")}</div>
          </div>
          <div style={{ position: "absolute", bottom: 6, left: 0, right: 0, height: 2, background: C.SKY }} />
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 6, background: C.SUNSET }} />
        </>
      )}

      {layout === "statement" && v === "standard" && (
        <div style={{ ...centered, padding: "0 67px" }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.MIDNIGHT, textTransform: "uppercase" as const, letterSpacing: 2, marginBottom: 16, opacity: 0.5 }}>{sample.title}</div>
          <div style={{ fontFamily: serif, fontSize: 32, color: C.MIDNIGHT, lineHeight: 1.5 }}>{bodyLines.join(" ")}</div>
        </div>
      )}
      {layout === "statement" && v === "dark" && (
        <>
          <div style={{ ...centered, padding: "0 80px", alignItems: "center", textAlign: "center" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.SKY, textTransform: "uppercase" as const, letterSpacing: 3, marginBottom: 20 }}>{sample.title}</div>
            <div style={{ fontFamily: serif, fontSize: 32, color: C.WHITE, lineHeight: 1.5 }}>{bodyLines.join(" ")}</div>
            <div style={{ width: 80, height: 3, background: C.SUNSET, marginTop: 28 }} />
          </div>
        </>
      )}
      {layout === "statement" && v === "pullquote" && (
        <>
          <div style={{ position: "absolute", left: 48, top: 0, bottom: 0, width: 8, background: C.SKY }} />
          <div style={{ ...centered, paddingLeft: 80, paddingRight: 80 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.SKY, textTransform: "uppercase" as const, letterSpacing: 2, marginBottom: 16 }}>{sample.title}</div>
            <div style={{ fontFamily: serif, fontSize: 30, color: C.MIDNIGHT, lineHeight: 1.5 }}>{bodyLines.join(" ")}</div>
          </div>
        </>
      )}

      {layout === "quote" && v === "standard" && (
        <div style={{ ...centered, padding: "0 86px" }}>
          <div style={{ fontFamily: serif, fontSize: 72, color: C.MIDNIGHT, lineHeight: 0.8, opacity: 0.3 }}>{"\u201C"}</div>
          <div style={{ fontFamily: serif, fontSize: 24, fontStyle: "italic" as const, color: C.MIDNIGHT, marginTop: 12, lineHeight: 1.5 }}>{bodyLines[0]?.replace(/"/g, "")}</div>
          {bodyLines[1] && <div style={{ fontSize: 14, fontWeight: 700, color: C.MIDNIGHT, marginTop: 28 }}>{bodyLines[1].replace(/^— /, "— ")}</div>}
        </div>
      )}
      {layout === "quote" && v === "dark" && (
        <>
          <div style={{ ...centered, padding: "0 86px" }}>
            <div style={{ fontFamily: serif, fontSize: 72, color: C.SUNSET, lineHeight: 0.8, opacity: 0.6 }}>{"\u201C"}</div>
            <div style={{ fontFamily: serif, fontSize: 24, fontStyle: "italic" as const, color: C.WHITE, marginTop: 12, lineHeight: 1.5 }}>{bodyLines[0]?.replace(/"/g, "")}</div>
            {bodyLines[1] && <div style={{ fontSize: 14, fontWeight: 700, color: C.SKY, marginTop: 28 }}>{bodyLines[1].replace(/^— /, "— ")}</div>}
          </div>
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 4, background: C.SUNSET }} />
        </>
      )}
      {layout === "quote" && v === "minimal" && (
        <div style={{ ...centered, padding: "0 86px" }}>
          <div style={{ fontFamily: serif, fontSize: 80, color: C.SKY, lineHeight: 0.8, opacity: 0.25 }}>{"\u201C"}</div>
          <div style={{ fontFamily: serif, fontSize: 24, fontStyle: "italic" as const, color: C.MIDNIGHT, marginTop: 8, lineHeight: 1.5 }}>{bodyLines[0]?.replace(/"/g, "")}</div>
          <div style={{ width: 40, height: 3, background: C.LAVENDER, marginTop: 24 }} />
          {bodyLines[1] && <div style={{ fontSize: 14, fontWeight: 700, color: C.MIDNIGHT, marginTop: 16, opacity: 0.7 }}>{bodyLines[1].replace(/^— /, "— ")}</div>}
        </div>
      )}

      {layout === "callout" && v === "standard" && (() => {
        const items = bodyLines.filter(l => !l.startsWith("- "));
        const colors = [C.SKY, C.SUNSET, C.LAVENDER, C.SKY, C.SUNSET];
        return (
          <>
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 100, background: C.MIDNIGHT, display: "flex", alignItems: "center", paddingLeft: 48 }}>
              <div style={{ fontFamily: serif, fontSize: 22, fontWeight: 700, color: C.WHITE }}>{sample.title}</div>
            </div>
            <div style={{ position: "absolute", top: 120, left: 48, right: 48, bottom: 56, display: "flex", flexDirection: "column", justifyContent: "center" }}>
              {items.map((line, j) => {
                const detail = bodyLines[bodyLines.indexOf(line) + 1];
                return (
                  <div key={j}>
                    <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "12px 0" }}>
                      <div style={{ width: 38, height: 38, borderRadius: "50%", background: colors[j] || C.SKY, color: C.WHITE, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: serif, fontSize: 16, fontWeight: 700, flexShrink: 0 }}>{j + 1}</div>
                      <div>
                        <div style={{ fontFamily: serif, fontSize: 14, fontWeight: 700, color: C.MIDNIGHT }}>{line}</div>
                        {detail?.startsWith("- ") && <div style={{ fontSize: 12, color: C.MIDNIGHT, opacity: 0.7, marginTop: 2, lineHeight: 1.4 }}>{detail.replace(/^- /, "")}</div>}
                      </div>
                    </div>
                    {j < items.length - 1 && <div style={{ height: 1, background: C.CLOUD, marginLeft: 54 }} />}
                  </div>
                );
              })}
            </div>
            <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 32, background: C.MIDNIGHT }} />
            <div style={{ position: "absolute", bottom: 32, left: 0, right: 0, height: 2, background: C.SUNSET }} />
          </>
        );
      })()}
      {layout === "callout" && v === "clean" && (() => {
        const items = bodyLines.filter(l => !l.startsWith("- "));
        const bgs = [C.SKY_TINT, C.SUNSET_TINT, C.LAVENDER_TINT, C.HUNTER_TINT, C.SKY_TINT];
        const accents = [C.SKY, C.SUNSET, C.LAVENDER, C.HUNTER, C.SKY];
        return (
          <>
            <div style={{ position: "absolute", top: 38, left: 67, right: 67 }}>
              <div style={{ fontFamily: serif, fontSize: 24, fontWeight: 700, color: C.MIDNIGHT }}>{sample.title}</div>
            </div>
            <div style={{ position: "absolute", top: 110, left: 48, right: 48, bottom: 38, display: "flex", flexDirection: "column", justifyContent: "center", gap: 10 }}>
              {items.map((line, j) => {
                const detail = bodyLines[bodyLines.indexOf(line) + 1];
                return (
                  <div key={j} style={{ display: "flex", alignItems: "center", gap: 14, background: bgs[j], borderRadius: 6, padding: "10px 16px", position: "relative", overflow: "hidden" }}>
                    <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: accents[j] }} />
                    <div style={{ width: 30, height: 30, borderRadius: "50%", background: accents[j], color: C.WHITE, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: serif, fontSize: 14, fontWeight: 700, flexShrink: 0 }}>{j + 1}</div>
                    <div>
                      <div style={{ fontFamily: serif, fontSize: 13, fontWeight: 700, color: C.MIDNIGHT }}>{line}</div>
                      {detail?.startsWith("- ") && <div style={{ fontSize: 11, color: C.MIDNIGHT, opacity: 0.6, marginTop: 1, lineHeight: 1.3 }}>{detail.replace(/^- /, "")}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        );
      })()}

      {layout === "closing" && v === "standard" && (
        <>
          <div style={{ ...centered, alignItems: "center", textAlign: "center" }}>
            <div style={{ fontFamily: serif, fontSize: 44, fontWeight: 700, color: C.WHITE }}>{sample.title}</div>
            <div style={{ width: 154, height: 4, background: C.SUNSET, margin: "20px auto" }} />
            <div style={{ fontSize: 16, color: C.SKY, marginTop: 8 }}>{bodyLines.join(" · ")}</div>
          </div>
          <div style={{ position: "absolute", bottom: 70, left: "50%", transform: "translateX(-50%)" }}>
            <div style={{ width: 29, height: 29, borderRadius: "50%", background: C.SUNSET }} />
          </div>
          <div style={{ position: "absolute", bottom: 0, left: 0, width: "50%", height: 6, background: C.SKY }} />
          <div style={{ position: "absolute", bottom: 0, left: "50%", width: "50%", height: 6, background: C.SUNSET }} />
        </>
      )}
      {layout === "closing" && v === "warm" && (
        <>
          <div style={{ ...centered, alignItems: "center", textAlign: "center" }}>
            <div style={{ fontFamily: serif, fontSize: 44, fontWeight: 700, color: C.WHITE }}>{sample.title}</div>
            <div style={{ width: 120, height: 3, background: C.SKY, margin: "24px auto" }} />
            <div style={{ fontSize: 16, color: C.SUNSET, marginTop: 8 }}>{bodyLines.join(" · ")}</div>
          </div>
          <div style={{ position: "absolute", bottom: 60, left: "50%", transform: "translateX(-50%)" }}>
            <div style={{ width: 24, height: 24, borderRadius: "50%", background: C.LAVENDER }} />
          </div>
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 6, background: C.SUNSET }} />
        </>
      )}
      {layout === "closing" && v === "imagecover" && (
        <>
          <div style={{ position: "absolute", top: 20, right: 20, width: 380, bottom: 20, borderRadius: 14, overflow: "hidden" }}>
            <img src="/slide-images/image6.png" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </div>
          <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: 540, display: "flex", flexDirection: "column", justifyContent: "center", paddingLeft: 50 }}>
            <div style={{ fontFamily: serif, fontSize: 44, fontWeight: 700, color: C.WHITE, lineHeight: 1.2 }}>{sample.title}</div>
            <div style={{ fontSize: 14, color: C.SKY, marginTop: 20 }}>{bodyLines.join(" ")}</div>
          </div>
          <div style={{ position: "absolute", bottom: 24, left: 50 }}>
            <img src="/slide-images/image28.png" style={{ height: 20, opacity: 0.6 }} />
          </div>
        </>
      )}

      {layout === "title" && v === "imagetitle" && (
        <>
          <div style={{ position: "absolute", right: 20, top: 20, bottom: 20, width: 380, borderRadius: 14, overflow: "hidden" }}>
            <img src="/slide-images/image6.png" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </div>
          <div style={{ position: "absolute", top: 28, left: 48 }}>
            <img src="/slide-images/image1.png" style={{ height: 18, opacity: 0.5 }} />
          </div>
          <div style={{ ...centered, paddingLeft: 48, paddingRight: 430 }}>
            <div style={{ fontFamily: serif, fontSize: 34, fontWeight: 700, color: C.MIDNIGHT, lineHeight: 1.2 }}>{sample.title}</div>
            <div style={{ fontSize: 15, color: C.MIDNIGHT, marginTop: 20, opacity: 0.6 }}>{bodyLines.join(" ")}</div>
          </div>
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 6, background: C.SKY }} />
        </>
      )}
      {layout === "title" && v === "skyspeakers" && (() => {
        const parts = sample.body.split("---");
        const subtitle = parts[0]?.trim() || "";
        const speakerLines = (parts[1] || "").split("\n").filter(Boolean);
        const speakerHeadshots = ["/slide-images/image18.png", "/slide-images/image10.png"];
        return (
          <>
            <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 540, overflow: "hidden" }}>
              <img src="/slide-images/image19.png" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            </div>
            <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 440, background: C.SKY_TINT }}>
              <div style={{ position: "absolute", top: 24, left: 36 }}>
                <img src="/slide-images/image1.png" style={{ height: 16, opacity: 0.4 }} />
              </div>
              <div style={{ padding: "80px 48px" }}>
                <div style={{ fontFamily: serif, fontSize: 32, fontWeight: 700, color: C.MIDNIGHT, lineHeight: 1.2 }}>{sample.title}</div>
                <div style={{ fontSize: 14, color: C.MIDNIGHT, marginTop: 16, opacity: 0.6 }}>{subtitle}</div>
              </div>
            </div>
            <div style={{ position: "absolute", bottom: 30, left: 30, display: "flex", gap: 20 }}>
              {speakerLines.map((sp, j) => {
                const [name, role] = sp.split("|").map(s => s.trim());
                return (
                  <div key={j} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 40, height: 40, borderRadius: "50%", overflow: "hidden", border: "2px solid " + C.WHITE }}>
                      <img src={speakerHeadshots[j] || speakerHeadshots[0]} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    </div>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: C.MIDNIGHT }}>{name}</div>
                      <div style={{ fontSize: 9, color: C.MIDNIGHT, opacity: 0.6 }}>{role}</div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 4, background: C.MIDNIGHT }} />
          </>
        );
      })()}
      {layout === "title" && v === "sunsetglass" && (() => {
        const parts = sample.body.split("---");
        const subtitle = parts[0]?.trim() || "";
        const speakerLines = (parts[1] || "").split("\n").filter(Boolean);
        const speakerHeadshots = ["/slide-images/image18.png", "/slide-images/image10.png"];
        return (
          <>
            <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
              <img src="/slide-images/image87.png" style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.25 }} />
            </div>
            <div style={{ position: "absolute", left: 40, top: 60, right: 40, bottom: 100, borderRadius: 16, background: "rgba(255,255,255,0.65)", backdropFilter: "blur(8px)", boxShadow: "0 4px 24px rgba(0,0,0,0.06)", border: "1px solid rgba(255,255,255,0.5)" }}>
              <div style={{ padding: "48px 52px", display: "flex", flexDirection: "column", justifyContent: "center", height: "100%" }}>
                <div style={{ fontFamily: serif, fontSize: 30, fontWeight: 700, color: C.MIDNIGHT, lineHeight: 1.2 }}>{sample.title}</div>
                <div style={{ fontSize: 14, color: C.MIDNIGHT, marginTop: 16, opacity: 0.7 }}>{subtitle}</div>
              </div>
            </div>
            <div style={{ position: "absolute", bottom: 24, left: 40, display: "flex", gap: 20 }}>
              {speakerLines.map((sp, j) => {
                const [name, role] = sp.split("|").map(s => s.trim());
                return (
                  <div key={j} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 40, height: 40, borderRadius: "50%", overflow: "hidden", border: "2px solid " + C.WHITE, boxShadow: "0 2px 8px rgba(0,0,0,0.1)" }}>
                      <img src={speakerHeadshots[j] || speakerHeadshots[0]} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    </div>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: C.MIDNIGHT }}>{name}</div>
                      <div style={{ fontSize: 9, color: C.MIDNIGHT, opacity: 0.6 }}>{role}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        );
      })()}

      {layout === "content" && v === "twocollines" && (() => {
        const halves = sample.body.split("---");
        return (
          <>
            <div style={{ position: "absolute", top: 38, left: 67, right: 67 }}>
              <div style={{ fontFamily: serif, fontSize: 24, fontWeight: 700, color: C.MIDNIGHT }}>{sample.title}</div>
              <div style={{ width: 60, height: 3, background: C.SKY, marginTop: 12 }} />
            </div>
            <div style={{ position: "absolute", top: 115, left: 48, right: 48, bottom: 38, display: "flex" }}>
              {halves.slice(0, 2).map((half, j) => {
                const lines = half.split("\n").filter(Boolean);
                const header = lines[0]?.replace(/\*\*/g, "").trim() || "";
                const body = lines.slice(1);
                return (
                  <div key={j} style={{ flex: 1, padding: "0 24px", borderRight: j === 0 ? "1px solid " + C.SKY : "none", display: "flex", flexDirection: "column" }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: C.MIDNIGHT, marginBottom: 14 }}>{header}</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1, justifyContent: "center" }}>
                      {body.map((line, k) => (
                        <div key={k} style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 13, lineHeight: 1.5 }}>
                          <div style={{ width: 5, height: 5, borderRadius: "50%", background: C.SKY, marginTop: 6, flexShrink: 0 }} />
                          <span>{line.replace(/^- /, "")}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        );
      })()}
      {layout === "content" && v === "fourcol" && (() => {
        const cols = sample.body.split("===");
        return (
          <>
            <div style={{ position: "absolute", top: 38, left: 67, right: 67 }}>
              <div style={{ fontFamily: serif, fontSize: 24, fontWeight: 700, color: C.MIDNIGHT }}>{sample.title}</div>
              <div style={{ width: 60, height: 3, background: C.SKY, marginTop: 12 }} />
            </div>
            <div style={{ position: "absolute", top: 115, left: 32, right: 32, bottom: 38, display: "flex", alignItems: "center" }}>
              {cols.slice(0, 4).map((col, j) => {
                const lines = col.split("\n").filter(Boolean);
                const header = lines[0]?.trim() || "";
                const headerParts = header.split("|");
                const label = headerParts[0]?.trim() || "";
                const title = headerParts[1]?.trim() || header;
                const body = lines.slice(1);
                return (
                  <div key={j} style={{ flex: 1, padding: "0 16px", borderRight: j < 3 ? "1px solid rgba(76,163,255,0.3)" : "none", display: "flex", flexDirection: "column", alignSelf: "stretch", justifyContent: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                      <div style={{ width: 28, height: 28, borderRadius: "50%", background: C.SKY, color: C.WHITE, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: serif, fontSize: 13, fontWeight: 700 }}>{label}</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: C.MIDNIGHT }}>{title}</div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {body.map((line, k) => (
                        <div key={k} style={{ fontSize: 11, lineHeight: 1.5, color: C.MIDNIGHT, opacity: 0.8 }}>{line.replace(/^- /, "")}</div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        );
      })()}
      {layout === "content" && v === "threecolimg" && (() => {
        const cols = sample.body.split("===");
        const colImages = ["/slide-images/image24.png", "/slide-images/image36.png", "/slide-images/image23.png"];
        return (
          <>
            <div style={{ position: "absolute", top: 38, left: 67, right: 67 }}>
              <div style={{ fontFamily: serif, fontSize: 24, fontWeight: 700, color: C.MIDNIGHT }}>{sample.title}</div>
            </div>
            <div style={{ position: "absolute", top: 100, left: 48, right: 48, bottom: 38, display: "flex", gap: 16, alignItems: "center" }}>
              {cols.slice(0, 3).map((col, j) => {
                const lines = col.split("\n").filter(Boolean);
                const header = lines[0]?.trim() || "";
                const body = lines.slice(1);
                return (
                  <div key={j} style={{ flex: 1, display: "flex", flexDirection: "column", borderRight: j < 2 ? "1px solid rgba(76,163,255,0.2)" : "none", paddingRight: j < 2 ? 16 : 0, alignSelf: "stretch", justifyContent: "center" }}>
                    <div style={{ width: 100, height: 100, borderRadius: 12, overflow: "hidden", marginBottom: 14, background: C.SKY_TINT, flexShrink: 0 }}>
                      <img src={colImages[j]} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: C.MIDNIGHT, marginBottom: 8 }}>{header}</div>
                    {body.map((line, k) => (
                      <div key={k} style={{ fontSize: 12, lineHeight: 1.5, color: C.MIDNIGHT, opacity: 0.7 }}>{line.replace(/^- /, "")}</div>
                    ))}
                  </div>
                );
              })}
            </div>
          </>
        );
      })()}
      {layout === "content" && v === "twocolshapes" && (() => {
        const halves = sample.body.split("---");
        return (
          <>
            <div style={{ position: "absolute", top: 38, left: 67, right: 67 }}>
              <div style={{ fontFamily: serif, fontSize: 24, fontWeight: 700, color: C.MIDNIGHT }}>{sample.title}</div>
            </div>
            <div style={{ position: "absolute", top: 110, left: 48, right: 48, bottom: 38, display: "flex", gap: 20, alignItems: "center" }}>
              {halves.slice(0, 2).map((half, j) => {
                const lines = half.split("\n").filter(Boolean);
                const headerLine = lines[0]?.trim() || "";
                const headerParts = headerLine.split("|");
                const num = headerParts[0]?.trim() || String(j + 1);
                const title = headerParts[1]?.trim() || headerLine;
                const body = lines.slice(1);
                return (
                  <div key={j} style={{ flex: 1, background: C.SKY_TINT, borderRadius: 12, padding: "28px 24px", position: "relative", alignSelf: "stretch", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                    <div style={{ fontFamily: serif, fontSize: 28, fontWeight: 700, color: C.SKY, marginBottom: 8 }}>{num}</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: C.MIDNIGHT, marginBottom: 12 }}>{title}</div>
                    {body.map((line, k) => (
                      <div key={k} style={{ fontSize: 12, lineHeight: 1.6, color: C.MIDNIGHT, opacity: 0.75 }}>{line.replace(/^- /, "")}</div>
                    ))}
                  </div>
                );
              })}
            </div>
          </>
        );
      })()}
      {layout === "content" && v === "threecolshapes" && (() => {
        const cols = sample.body.split("===");
        return (
          <>
            <div style={{ position: "absolute", top: 38, left: 67, right: 67 }}>
              <div style={{ fontFamily: serif, fontSize: 24, fontWeight: 700, color: C.MIDNIGHT }}>{sample.title}</div>
            </div>
            <div style={{ position: "absolute", top: 110, left: 48, right: 48, bottom: 38, display: "flex", gap: 16, alignItems: "center" }}>
              {cols.slice(0, 3).map((col, j) => {
                const lines = col.split("\n").filter(Boolean);
                const headerLine = lines[0]?.trim() || "";
                const headerParts = headerLine.split("|");
                const num = headerParts[0]?.trim() || String(j + 1);
                const title = headerParts[1]?.trim() || headerLine;
                const body = lines.slice(1);
                return (
                  <div key={j} style={{ flex: 1, background: C.SKY_TINT, borderRadius: 12, padding: "22px 18px", position: "relative", alignSelf: "stretch", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                    <div style={{ fontFamily: serif, fontSize: 24, fontWeight: 700, color: C.SKY, marginBottom: 6 }}>{num}</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: C.MIDNIGHT, marginBottom: 10 }}>{title}</div>
                    {body.map((line, k) => (
                      <div key={k} style={{ fontSize: 11, lineHeight: 1.6, color: C.MIDNIGHT, opacity: 0.75 }}>{line.replace(/^- /, "")}</div>
                    ))}
                  </div>
                );
              })}
            </div>
          </>
        );
      })()}
      {layout === "content" && v === "imagesplit" && (
        <>
          <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 440, overflow: "hidden" }}>
            <img src="/slide-images/image39.jpg" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </div>
          <div style={{ position: "absolute", top: 0, left: 460, right: 48, bottom: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <div style={{ fontFamily: serif, fontSize: 22, fontWeight: 700, color: C.MIDNIGHT }}>{sample.title}</div>
            <div style={{ fontSize: 13, color: C.MIDNIGHT, opacity: 0.5, marginTop: 8, marginBottom: 20 }}>{bodyLines[0]?.replace(/^Subtitle: /, "")}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {bodyLines.slice(1).map((line, j) => (
                <div key={j} style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 13, lineHeight: 1.5 }}>
                  <div style={{ width: 5, height: 5, borderRadius: "50%", background: C.SKY, marginTop: 7, flexShrink: 0 }} />
                  <span>{line.replace(/^- /, "")}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {layout === "content" && v === "numberedparagraphs" && (() => {
        const cols = sample.body.split("===");
        return (
          <>
            <div style={{ position: "absolute", top: 18, left: 24, right: 24, bottom: 18, background: "#B8CAD9", borderRadius: 12, overflow: "hidden" }}>
              <div style={{ position: "absolute", top: 22, left: 28, right: 28, height: 1, background: C.MIDNIGHT, opacity: 0.18 }} />
              <div style={{ position: "absolute", top: 38, left: 36 }}>
                <div style={{ fontFamily: serif, fontSize: 24, fontWeight: 400, color: C.MIDNIGHT, letterSpacing: -0.3 }}>{sample.title}</div>
              </div>
              <div style={{ position: "absolute", top: 90, left: 28, right: 28, bottom: 80, background: "#CFDBE8", borderRadius: 8, padding: "28px 12px", display: "flex" }}>
                {cols.slice(0, 3).map((col, j) => {
                  const lines = col.split("\n").filter(Boolean);
                  const numLine = lines[0]?.trim() || String(j + 1);
                  const headerParts = numLine.split("|");
                  const num = (headerParts[0]?.trim() || String(j + 1)) + ".";
                  const heading = headerParts[1]?.trim() || lines[0]?.trim() || "";
                  const body = headerParts[1] ? lines.slice(1) : lines.slice(1);
                  return (
                    <div key={j} style={{ flex: 1, padding: "0 22px", display: "flex", flexDirection: "column", justifyContent: "flex-start" }}>
                      <div style={{ fontFamily: serif, fontSize: 36, fontWeight: 400, color: C.MIDNIGHT, lineHeight: 1, marginBottom: 6 }}>{num}</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: C.MIDNIGHT, lineHeight: 1.35, marginBottom: 14 }}>{heading}</div>
                      <div style={{ width: 40, height: 2, background: C.MIDNIGHT, opacity: 0.55, marginBottom: 14 }} />
                      <div style={{ fontSize: 10, lineHeight: 1.6, color: C.MIDNIGHT, opacity: 0.7 }}>
                        {body.map((line, k) => (
                          <span key={k}>{line.replace(/^- /, "")}{k < body.length - 1 ? " " : ""}</span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ position: "absolute", bottom: 20, left: 36 }}>
                <div style={{ fontFamily: serif, fontWeight: 700, fontSize: 26, color: C.MIDNIGHT, opacity: 0.65 }}>D</div>
              </div>
            </div>
          </>
        );
      })()}

      {layout === "callout" && v === "tips" && (() => {
        const items: { num: string; title: string; desc: string }[] = [];
        for (let i = 0; i < bodyLines.length; i++) {
          const line = bodyLines[i];
          const match = line.match(/^#(\d+)\s+(.+)/);
          if (match) {
            const desc = bodyLines[i + 1]?.startsWith("- ") ? bodyLines[i + 1].replace(/^- /, "") : "";
            items.push({ num: "#" + match[1], title: match[2], desc });
          }
        }
        return (
          <>
            <div style={{ position: "absolute", top: 38, left: 67, right: 67 }}>
              <div style={{ fontFamily: serif, fontSize: 24, fontWeight: 700, color: C.MIDNIGHT }}>{sample.title}</div>
            </div>
            <div style={{ position: "absolute", top: 110, left: 48, right: 48, bottom: 38, display: "flex", flexDirection: "column", justifyContent: "center", gap: 24 }}>
              {items.map((item, j) => (
                <div key={j} style={{ display: "flex", alignItems: "flex-start", gap: 20 }}>
                  <div style={{ fontFamily: serif, fontSize: 36, fontWeight: 700, color: C.SKY, lineHeight: 1, minWidth: 60 }}>{item.num}</div>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: C.MIDNIGHT, marginBottom: 4 }}>{item.title}</div>
                    <div style={{ fontSize: 13, color: C.MIDNIGHT, opacity: 0.7, lineHeight: 1.5 }}>{item.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </>
        );
      })()}

      {layout === "speakers" && (() => {
        const speakers = sample.body.split("===");
        const headshots = ["/slide-images/image7.png", "/slide-images/image8.png", "/slide-images/image13.png", "/slide-images/image18.png"];
        return (
          <>
            <div style={{ position: "absolute", bottom: 20, right: 30 }}>
              <img src="/slide-images/image1.png" style={{ height: 16, opacity: 0.3 }} />
            </div>
            <div style={{ position: "absolute", top: 38, left: 67, right: 67 }}>
              <div style={{ fontFamily: serif, fontSize: 24, fontWeight: 700, color: C.MIDNIGHT }}>{sample.title}</div>
              <div style={{ width: 60, height: 3, background: C.SKY, marginTop: 12 }} />
            </div>
            <div style={{ position: "absolute", top: 110, left: 48, right: 48, bottom: 38, display: "flex", justifyContent: "center", alignItems: "center", gap: 48 }}>
              {speakers.slice(0, 4).map((sp, j) => {
                const lines = sp.split("\n").filter(Boolean);
                const name = lines[0]?.trim() || "";
                const role = lines[1]?.trim() || "";
                const company = lines[2]?.trim() || "";
                return (
                  <div key={j} style={{ textAlign: "center", width: 180 }}>
                    <div style={{ width: 100, height: 100, borderRadius: "50%", overflow: "hidden", margin: "0 auto 16px", background: C.SKY_TINT }}>
                      <img src={headshots[j] || headshots[0]} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: C.MIDNIGHT }}>{name}</div>
                    <div style={{ fontSize: 11, color: C.MIDNIGHT, opacity: 0.7, marginTop: 4 }}>{role}</div>
                    <div style={{ fontSize: 11, color: C.SKY, marginTop: 2 }}>{company}</div>
                  </div>
                );
              })}
            </div>
          </>
        );
      })()}

      {layout === "section" && v === "skygradient" && (
        <div style={{ width: "100%", height: "100%", background: "linear-gradient(135deg, " + C.SKY + " 0%, " + C.MIDNIGHT + " 100%)", position: "relative" }}>
          <div style={{ ...centered, paddingLeft: 67, paddingRight: 80 }}>
            <div style={{ fontFamily: serif, fontSize: 48, fontWeight: 700, color: C.WHITE, opacity: 0.3 }}>01</div>
            <div style={{ fontFamily: serif, fontSize: 36, fontWeight: 700, color: C.WHITE, marginTop: 16 }}>{sample.title}</div>
            <div style={{ fontSize: 16, color: C.WHITE, opacity: 0.7, marginTop: 12 }}>{bodyLines.join(" ")}</div>
          </div>
        </div>
      )}

      {layout === "subsection" && (() => {
        const parts = sample.body.split("---");
        const subtitle = parts[0]?.trim() || "";
        const breadcrumbs = (parts[1] || "").split("|").map(s => s.trim()).filter(Boolean);
        return (
          <>
            <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 6, background: "linear-gradient(to bottom, " + C.SKY + ", " + C.MIDNIGHT + ")" }} />
            <div style={{ position: "absolute", top: 36, left: 48, display: "flex", gap: 10, alignItems: "center" }}>
              {breadcrumbs.map((num, j) => (
                <div key={j} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 38, height: 38, borderRadius: 10, background: j === 0 ? C.SKY : C.CLOUD, color: j === 0 ? C.WHITE : C.MIDNIGHT, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 700, fontFamily: serif, boxShadow: j === 0 ? "0 2px 8px rgba(76,163,255,0.3)" : "none" }}>{num}</div>
                  {j < breadcrumbs.length - 1 && <div style={{ width: 16, height: 2, background: C.CLOUD }} />}
                </div>
              ))}
            </div>
            <div style={{ ...centered, paddingLeft: 48, paddingRight: 80, paddingTop: 50 }}>
              <div style={{ fontFamily: serif, fontSize: 30, fontWeight: 700, color: C.MIDNIGHT, lineHeight: 1.2 }}>{sample.title}</div>
              <div style={{ fontSize: 15, color: C.MIDNIGHT, opacity: 0.6, marginTop: 14 }}>{subtitle}</div>
            </div>
          </>
        );
      })()}

      {layout === "statement" && v === "sunsetgrad" && (
        <div style={{ width: "100%", height: "100%", background: "linear-gradient(135deg, " + C.SUNSET_TINT + " 0%, " + C.WHITE + " 60%, " + C.WHITE + " 100%)", position: "relative" }}>
          <div style={{ ...centered, padding: "0 80px", alignItems: "center", textAlign: "center" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.MIDNIGHT, textTransform: "uppercase" as const, letterSpacing: 3, marginBottom: 24, opacity: 0.5 }}>{sample.title}</div>
            <div style={{ fontFamily: serif, fontSize: 30, color: C.MIDNIGHT, lineHeight: 1.5 }}>{bodyLines.join(" ")}</div>
          </div>
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 4, background: C.SUNSET }} />
        </div>
      )}
      {layout === "statement" && v === "skyshape" && (
        <div style={{ width: "100%", height: "100%", background: "linear-gradient(135deg, " + C.SKY_TINT + " 0%, " + C.WHITE + " 70%)", position: "relative" }}>
          <div style={{ position: "absolute", right: 30, top: 30, width: 200, height: 200, borderRadius: 20, overflow: "hidden", opacity: 0.12 }}>
            <img src="/slide-images/image21.png" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </div>
          <div style={{ position: "absolute", right: -20, bottom: -20, width: 180, height: 180, borderRadius: "50%", background: C.SKY, opacity: 0.06 }} />
          <div style={{ ...centered, padding: "0 80px" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.SKY, textTransform: "uppercase" as const, letterSpacing: 3, marginBottom: 16 }}>{sample.title}</div>
            <div style={{ fontFamily: serif, fontSize: 50, fontWeight: 700, color: C.MIDNIGHT, lineHeight: 1.1 }}>{bodyLines[0]?.split(" ")[0]}</div>
            <div style={{ fontFamily: serif, fontSize: 22, color: C.MIDNIGHT, lineHeight: 1.5, marginTop: 12, opacity: 0.8 }}>{bodyLines.join(" ").replace(/^\S+\s*/, "")}</div>
          </div>
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 4, background: C.SKY }} />
        </div>
      )}

      {layout === "comparison" && v === "dosdonts" && (() => {
        const halves = sample.body.split("---");
        const colBgs = [C.SKY_TINT, C.SUNSET_TINT];
        const colAccents = [C.SKY, C.SUNSET];
        const icons = ["\u2713", "\u2717"];
        return (
          <>
            <div style={{ position: "absolute", top: 38, left: 67, right: 67 }}>
              <div style={{ fontFamily: serif, fontSize: 24, fontWeight: 700, color: C.MIDNIGHT }}>{sample.title}</div>
            </div>
            <div style={{ position: "absolute", top: 110, left: 48, right: 48, bottom: 38, display: "flex", gap: 20, alignItems: "center" }}>
              {halves.slice(0, 2).map((half, j) => {
                const lines = half.split("\n").filter(Boolean);
                const header = lines[0]?.replace(/\*\*/g, "").trim() || "";
                const body = lines.slice(1);
                return (
                  <div key={j} style={{ flex: 1, background: colBgs[j], borderRadius: 12, padding: "24px 24px", position: "relative", overflow: "hidden", alignSelf: "stretch", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: colAccents[j], marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 24, height: 24, borderRadius: "50%", background: colAccents[j], display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, color: C.WHITE, fontWeight: 700 }}>{icons[j]}</div>
                      {header}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {body.map((line, k) => (
                        <div key={k} style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 12, lineHeight: 1.5, color: C.MIDNIGHT }}>
                          <div style={{ fontSize: 11, color: colAccents[j], marginTop: 2, flexShrink: 0, fontWeight: 700 }}>{icons[j]}</div>
                          <span>{line.replace(/\*\*/g, "").replace(/^- /, "")}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        );
      })()}

      {layout === "stats" && v === "bentogrid" && (() => {
        const items = bodyLines.slice(0, 4).map(line => {
          const parts = line.split("|");
          return { num: parts[0]?.trim() || "", label: parts[1]?.trim() || "" };
        });
        return (
          <>
            <div style={{ position: "absolute", top: 30, left: 67, right: 67 }}>
              <div style={{ fontFamily: serif, fontSize: 22, fontWeight: 700, color: C.MIDNIGHT }}>{sample.title}</div>
            </div>
            <div style={{ position: "absolute", top: 90, left: 48, right: 48, bottom: 38, display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr", gap: 14 }}>
              {items.map((item, j) => {
                const bgs = [C.SKY_TINT, C.CLOUD, C.CLOUD, C.SUNSET_TINT];
                const accents = [C.SKY, C.MIDNIGHT, C.MIDNIGHT, C.SUNSET];
                return (
                  <div key={j} style={{ background: bgs[j], borderRadius: 12, padding: "24px 28px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                    <div style={{ fontSize: 48, fontWeight: 700, color: accents[j], lineHeight: 1 }}>{item.num}</div>
                    <div style={{ fontSize: 13, color: C.MIDNIGHT, opacity: 0.7, marginTop: 10 }}>{item.label}</div>
                  </div>
                );
              })}
            </div>
          </>
        );
      })()}
      {layout === "stats" && v === "bentolarge" && (() => {
        const items = bodyLines.slice(0, 4).map(line => {
          const parts = line.split("|");
          return { num: parts[0]?.trim() || "", label: parts[1]?.trim() || "" };
        });
        return (
          <>
            <div style={{ position: "absolute", top: 30, left: 67, right: 67 }}>
              <div style={{ fontFamily: serif, fontSize: 22, fontWeight: 700, color: C.MIDNIGHT }}>{sample.title}</div>
            </div>
            <div style={{ position: "absolute", top: 80, left: 30, right: 30, bottom: 30, display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr", gap: 16 }}>
              {items.map((item, j) => {
                const bgs = [C.SKY_TINT, C.CLOUD, C.SUNSET_TINT, C.CLOUD];
                return (
                  <div key={j} style={{ background: bgs[j], borderRadius: 16, padding: "28px 28px", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", textAlign: "center" }}>
                    <div style={{ fontSize: 46, fontWeight: 700, color: C.MIDNIGHT, lineHeight: 1 }}>{item.num}</div>
                    <div style={{ fontSize: 14, color: C.MIDNIGHT, opacity: 0.6, marginTop: 12 }}>{item.label}</div>
                  </div>
                );
              })}
            </div>
          </>
        );
      })()}

      {layout === "timeline" && (() => {
        const phases = sample.body.split("===");
        const nodeColors = [C.SKY, C.SUNSET, C.LAVENDER, C.CASCADE];
        return (
          <>
            <div style={{ position: "absolute", top: 30, left: 67, right: 67 }}>
              <div style={{ fontFamily: serif, fontSize: 22, fontWeight: 700, color: C.MIDNIGHT }}>{sample.title}</div>
              <div style={{ width: 50, height: 3, background: C.SKY, marginTop: 10 }} />
            </div>
            <div style={{ position: "absolute", top: 100, left: 48, right: 48, bottom: 30, display: "flex", flexDirection: "column" }}>
              <div style={{ position: "relative", height: 90, display: "flex", alignItems: "center" }}>
                <div style={{ position: "absolute", left: 60, right: 60, height: 3, background: "linear-gradient(90deg, " + C.SKY + ", " + C.CASCADE + ")", top: "50%", borderRadius: 2 }} />
                <div style={{ display: "flex", justifyContent: "space-around", width: "100%", position: "relative" }}>
                  {phases.slice(0, 4).map((phase, j) => {
                    const lines = phase.split("\n").filter(Boolean);
                    const headerLine = lines[0]?.trim() || "";
                    const headerParts = headerLine.split("|");
                    const label = headerParts[0]?.trim() || "Phase " + (j + 1);
                    const month = headerParts[1]?.trim() || "";
                    return (
                      <div key={j} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: C.WHITE, background: nodeColors[j], borderRadius: 12, padding: "4px 12px", whiteSpace: "nowrap" }}>{label}</div>
                        <div style={{ width: 16, height: 16, borderRadius: "50%", background: nodeColors[j], border: "3px solid " + C.WHITE, boxShadow: "0 0 0 2px " + nodeColors[j] + ", 0 2px 6px rgba(0,0,0,0.1)" }} />
                        <div style={{ fontSize: 10, color: C.MIDNIGHT, opacity: 0.6, fontWeight: 600 }}>{month}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div style={{ display: "flex", gap: 14, flex: 1, marginTop: 10 }}>
                {phases.slice(0, 4).map((phase, j) => {
                  const lines = phase.split("\n").filter(Boolean);
                  const desc = lines.slice(1).join(" ").trim();
                  return (
                    <div key={j} style={{ flex: 1, background: C.CLOUD, borderRadius: 10, padding: "16px 14px", fontSize: 11, lineHeight: 1.6, color: C.MIDNIGHT, borderTop: "3px solid " + nodeColors[j], boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                      {desc}
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        );
      })()}
    </div>
  );
}

function SlidePreview({ sample, layoutId, designNotes }: { sample: SlideLayout["sample"]; layoutId: string; designNotes?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);

  const updateScale = useCallback(() => {
    if (containerRef.current) {
      const containerWidth = containerRef.current.offsetWidth;
      setScale(containerWidth / 960);
    }
  }, []);

  useEffect(() => {
    updateScale();
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
  }, [updateScale]);

  return (
    <div ref={containerRef} className="w-full overflow-hidden rounded-md" style={{ position: "relative", height: 600 * scale }}>
      <div
        style={{
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          width: 960,
          height: 600,
          position: "absolute",
          top: 0,
          left: 0,
        }}
      >
        <SlideCanvas sample={sample} layoutId={layoutId} designNotes={designNotes} />
      </div>
    </div>
  );
}

function LayoutCard({ layout, onRefresh, allTemplates }: { layout: SlideLayout; onRefresh: () => void; allTemplates: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [feedbackHistory, setFeedbackHistory] = useState<{ role: string; content: string }[]>([]);
  const [proposal, setProposal] = useState<{
    explanation: string;
    proposedDesignNotes: string;
    proposedSampleTitle: string;
    proposedSampleBody: string;
  } | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(layout.variantName);
  const [showMoveMenu, setShowMoveMenu] = useState(false);
  const moveMenuRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (!showMoveMenu) return;
    const handler = (e: MouseEvent) => {
      if (moveMenuRef.current && !moveMenuRef.current.contains(e.target as Node)) {
        setShowMoveMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showMoveMenu]);

  const otherTemplates = allTemplates.filter(t => t !== layout.designTemplate);

  const duplicateMutation = useMutation({
    mutationFn: async (targetTemplate: string) => {
      const res = await apiRequest("POST", `/api/slide-designs/${layout.dbId}/duplicate`, {
        designTemplate: targetTemplate,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to duplicate");
      }
      return res.json();
    },
    onSuccess: (_, targetTemplate) => {
      queryClient.invalidateQueries({ queryKey: ["/api/slide-outlines"] });
      queryClient.invalidateQueries({ queryKey: ["/api/slide-templates"] });
      toast({ title: "Design duplicated", description: `Copied to "${targetTemplate}" template.` });
      setShowMoveMenu(false);
    },
    onError: (err: any) => {
      toast({ title: "Duplicate failed", description: err.message, variant: "destructive" });
    },
  });

  const moveMutation = useMutation({
    mutationFn: async (targetTemplate: string) => {
      const res = await apiRequest("PATCH", `/api/slide-designs/${layout.dbId}/move`, {
        designTemplate: targetTemplate,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to move");
      }
      return res.json();
    },
    onSuccess: (_, targetTemplate) => {
      queryClient.invalidateQueries({ queryKey: ["/api/slide-outlines"] });
      queryClient.invalidateQueries({ queryKey: ["/api/slide-templates"] });
      toast({ title: "Design moved", description: `Moved to "${targetTemplate}" template.` });
      setShowMoveMenu(false);
    },
    onError: (err: any) => {
      toast({ title: "Move failed", description: err.message, variant: "destructive" });
    },
  });

  const feedbackMutation = useMutation({
    mutationFn: async (text: string) => {
      const res = await apiRequest("POST", "/api/slide-outlines/feedback", {
        dbId: layout.dbId,
        layoutId: layout.id,
        layoutName: layout.name,
        designNotes: proposal ? proposal.proposedDesignNotes : layout.designNotes,
        sampleTitle: proposal ? proposal.proposedSampleTitle : layout.sample.title,
        sampleBody: proposal ? proposal.proposedSampleBody : layout.sample.body,
        feedback: text,
        conversationHistory: feedbackHistory,
      });
      return res.json();
    },
    onSuccess: (data) => {
      setFeedbackHistory(prev => [
        ...prev,
        { role: "user", content: feedback },
        { role: "assistant", content: data.explanation },
      ]);
      setProposal({
        explanation: data.explanation,
        proposedDesignNotes: data.proposedDesignNotes,
        proposedSampleTitle: data.proposedSampleTitle,
        proposedSampleBody: data.proposedSampleBody,
      });
      setFeedback("");
    },
    onError: () => {
      toast({ title: "Failed to process feedback", variant: "destructive" });
    },
  });

  const applyMutation = useMutation({
    mutationFn: async () => {
      if (!proposal) throw new Error("No proposal to apply");
      const res = await apiRequest("PATCH", `/api/slide-designs/${layout.dbId}/apply-feedback`, {
        designNotes: proposal.proposedDesignNotes,
        sampleTitle: proposal.proposedSampleTitle,
        sampleBody: proposal.proposedSampleBody,
      });
      if (!res.ok) throw new Error("Failed to apply");
      return res.json();
    },
    onSuccess: () => {
      setProposal(null);
      setFeedbackHistory([]);
      queryClient.invalidateQueries({ queryKey: ["/api/slide-outlines"] });
      toast({ title: "Design updated", description: "The proposed changes have been applied." });
    },
    onError: () => {
      toast({ title: "Failed to apply changes", variant: "destructive" });
    },
  });

  const approveMutation = useMutation({
    mutationFn: async () => {
      const endpoint = layout.isApproved
        ? `/api/slide-designs/${layout.dbId}/unapprove`
        : `/api/slide-designs/${layout.dbId}/approve`;
      const res = await apiRequest("PATCH", endpoint);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to update");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/slide-outlines"] });
      toast({
        title: layout.isApproved ? "Design unapproved" : "Design approved",
        description: `"${layout.name}" is now ${layout.isApproved ? "inactive" : "active"} for presentations.`,
      });
    },
    onError: (err: any) => {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", `/api/slide-designs/${layout.dbId}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to delete");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/slide-outlines"] });
      toast({ title: "Design deleted", description: `"${layout.name}" has been removed.` });
    },
    onError: (err: any) => {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    },
  });

  const renameMutation = useMutation({
    mutationFn: async (newName: string) => {
      const res = await apiRequest("PATCH", `/api/slide-designs/${layout.dbId}/rename`, {
        variantName: newName,
      });
      if (!res.ok) throw new Error("Failed to rename");
      return res.json();
    },
    onSuccess: () => {
      setIsRenaming(false);
      queryClient.invalidateQueries({ queryKey: ["/api/slide-outlines"] });
      toast({ title: "Design renamed" });
    },
    onError: () => {
      toast({ title: "Rename failed", variant: "destructive" });
    },
  });

  const handleSubmitFeedback = () => {
    if (!feedback.trim()) return;
    feedbackMutation.mutate(feedback.trim());
  };

  return (
    <Card className={`overflow-hidden border-card-border ${!layout.isApproved ? "opacity-60" : ""}`} data-testid={`card-layout-${layout.dbId}`}>
      <div
        className="group flex items-center gap-3 p-4 cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
        data-testid={`button-expand-${layout.dbId}`}
      >
        <div className="w-32 shrink-0">
          <SlidePreview sample={layout.sample} layoutId={layout.id} designNotes={layout.designNotes} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            {isRenaming ? (
              <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                <Input
                  value={renameValue}
                  onChange={e => setRenameValue(e.target.value)}
                  className="h-6 text-sm w-40 px-1.5"
                  autoFocus
                  data-testid={`input-rename-${layout.dbId}`}
                  onKeyDown={e => {
                    if (e.key === "Enter" && renameValue.trim()) {
                      renameMutation.mutate(renameValue.trim());
                    } else if (e.key === "Escape") {
                      setIsRenaming(false);
                      setRenameValue(layout.variantName);
                    }
                  }}
                />
                <VoiceInputButton onTranscript={(text) => setRenameValue((prev) => prev ? prev + " " + text : text)} />
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => renameValue.trim() && renameMutation.mutate(renameValue.trim())} disabled={renameMutation.isPending} data-testid={`button-confirm-rename-${layout.dbId}`}>
                  {renameMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                </Button>
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => { setIsRenaming(false); setRenameValue(layout.variantName); }} data-testid={`button-cancel-rename-${layout.dbId}`}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-1">
                <h3 className="text-sm font-semibold" data-testid={`text-layout-name-${layout.dbId}`}>{layout.name}</h3>
                <button
                  className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-muted transition-opacity"
                  onClick={e => { e.stopPropagation(); setIsRenaming(true); }}
                  data-testid={`button-rename-${layout.dbId}`}
                >
                  <Pencil className="h-3 w-3 text-muted-foreground" />
                </button>
              </div>
            )}
            <Badge variant="outline" className="text-[10px]">{layout.id}</Badge>
            {layout.isApproved ? (
              <Badge className="text-[10px] bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" data-testid={`badge-approved-${layout.dbId}`}>
                <ShieldCheck className="h-2.5 w-2.5 mr-0.5" />
                Approved
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-[10px] text-muted-foreground" data-testid={`badge-unapproved-${layout.dbId}`}>
                <ShieldOff className="h-2.5 w-2.5 mr-0.5" />
                Not Approved
              </Badge>
            )}
            {!layout.isDefault && layout.sourceFile && (
              <Badge variant="outline" className="text-[10px] text-violet-600 dark:text-violet-400">
                From: {layout.sourceFile}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{layout.description}</p>
        </div>
        <div className="shrink-0 flex items-center gap-1">
          <Button
            size="sm"
            variant={layout.isApproved ? "outline" : "default"}
            className={`h-7 text-[10px] px-2 ${layout.isApproved ? "" : "bg-emerald-600 hover:bg-emerald-700 text-white"}`}
            onClick={e => { e.stopPropagation(); approveMutation.mutate(); }}
            disabled={approveMutation.isPending}
            data-testid={`button-toggle-approve-${layout.dbId}`}
          >
            {approveMutation.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : layout.isApproved ? (
              <><ShieldOff className="h-3 w-3 mr-0.5" />Unapprove</>
            ) : (
              <><ShieldCheck className="h-3 w-3 mr-0.5" />Approve</>
            )}
          </Button>
          {otherTemplates.length > 0 && (
            <div className="relative" ref={moveMenuRef} onClick={e => e.stopPropagation()}>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-[10px] px-1.5"
                onClick={() => setShowMoveMenu(!showMoveMenu)}
                data-testid={`button-move-menu-${layout.dbId}`}
              >
                <ArrowRightLeft className="h-3 w-3" />
              </Button>
              {showMoveMenu && (
                <div className="absolute right-0 top-8 z-50 bg-popover border border-border rounded-lg shadow-lg p-2 min-w-[200px]">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-2 pb-1.5">Move or Duplicate</p>
                  {otherTemplates.map(t => (
                    <div key={t} className="flex items-center gap-1 mb-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-[11px] flex-1 justify-start"
                        onClick={() => moveMutation.mutate(t)}
                        disabled={moveMutation.isPending || duplicateMutation.isPending}
                        data-testid={`button-move-to-${t.toLowerCase().replace(/\s+/g, "-")}-${layout.dbId}`}
                      >
                        <ArrowRightLeft className="h-3 w-3 mr-1.5 shrink-0" />
                        Move to {t}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-[11px] flex-1 justify-start"
                        onClick={() => duplicateMutation.mutate(t)}
                        disabled={moveMutation.isPending || duplicateMutation.isPending}
                        data-testid={`button-duplicate-to-${t.toLowerCase().replace(/\s+/g, "-")}-${layout.dbId}`}
                      >
                        <Copy className="h-3 w-3 mr-1.5 shrink-0" />
                        Copy to {t}
                      </Button>
                    </div>
                  ))}
                  <div className="border-t border-border mt-1 pt-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-[11px] w-full justify-start text-muted-foreground"
                      onClick={() => setShowMoveMenu(false)}
                    >
                      <X className="h-3 w-3 mr-1.5" />
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-[10px] px-1.5 text-destructive hover:text-destructive"
            onClick={e => { e.stopPropagation(); if (confirm(`Delete "${layout.variantName || layout.name}"? This cannot be undone.`)) deleteMutation.mutate(); }}
            disabled={deleteMutation.isPending}
            data-testid={`button-delete-design-${layout.dbId}`}
          >
            {deleteMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
          </Button>
          {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border px-4 pb-4" data-testid={`section-details-${layout.dbId}`}>
          <div className="pt-4">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
              <Eye className="h-3 w-3" />
              {proposal ? "Current Design" : "Preview"}
            </h4>
            <div className="border border-border rounded-lg overflow-hidden">
              <SlidePreview sample={layout.sample} layoutId={layout.id} designNotes={layout.designNotes} />
            </div>
          </div>

          {proposal && (
            <div className="pt-4">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                  <Eye className="h-3 w-3" />
                  Proposed Design
                </h4>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={() => applyMutation.mutate()}
                    disabled={applyMutation.isPending}
                    data-testid={`button-accept-proposal-${layout.dbId}`}
                  >
                    {applyMutation.isPending ? (
                      <Loader2 className="h-3 w-3 animate-spin mr-1" />
                    ) : (
                      <Check className="h-3 w-3 mr-1" />
                    )}
                    Accept
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => {
                      setProposal(null);
                      setFeedbackHistory([]);
                      toast({ title: "Proposal rejected", description: "The proposed changes were discarded." });
                    }}
                    data-testid={`button-reject-proposal-${layout.dbId}`}
                  >
                    <X className="h-3 w-3 mr-1" />
                    Reject
                  </Button>
                </div>
              </div>
              <div className="border-2 border-amber-400/50 rounded-lg overflow-hidden">
                <SlidePreview
                  sample={{ title: proposal.proposedSampleTitle, body: proposal.proposedSampleBody, layout: layout.id }}
                  layoutId={layout.id}
                  designNotes={proposal.proposedDesignNotes}
                />
              </div>
              <div className="mt-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md p-2.5">
                <p className="text-xs text-amber-800 dark:text-amber-200 leading-relaxed">{proposal.explanation}</p>
              </div>
              <div className="mt-2">
                <h5 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Proposed Design Specs</h5>
                <p className="text-xs text-muted-foreground leading-relaxed bg-muted/30 rounded-md p-2.5">{proposal.proposedDesignNotes}</p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4">
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Design Specs</h4>
              <p className="text-xs text-muted-foreground leading-relaxed bg-muted/30 rounded-md p-2.5">{layout.designNotes}</p>
              {layout.variantName !== "Standard" && (
                <div className="mt-2 text-xs text-muted-foreground">
                  <span className="font-medium">Variant:</span> {layout.variantName}
                  {layout.isDefault ? " (Default)" : " (Custom)"}
                </div>
              )}
            </div>

            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                <MessageSquare className="h-3 w-3" />
                Design Feedback
              </h4>

              <div className="border border-border rounded-lg overflow-hidden">
                <div className="max-h-40 overflow-y-auto p-3 space-y-2 bg-muted/10" data-testid={`feedback-history-${layout.dbId}`}>
                  {feedbackHistory.length === 0 && !proposal && (
                    <p className="text-xs text-muted-foreground text-center py-3">
                      Share feedback to refine this slide design. The AI will propose changes you can preview before applying.
                    </p>
                  )}
                  {feedbackHistory.map((msg, i) => (
                    <div key={i} className={`text-xs ${msg.role === "user" ? "text-right" : ""}`}>
                      <div className={`inline-block rounded-lg px-3 py-2 max-w-[90%] text-left ${msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                        {msg.content}
                      </div>
                    </div>
                  ))}
                  {feedbackMutation.isPending && (
                    <div className="text-xs text-center py-2">
                      <Loader2 className="h-4 w-4 animate-spin inline mr-1" />
                      <span className="text-muted-foreground">Generating proposed design...</span>
                    </div>
                  )}
                </div>

                <div className="flex gap-2 p-2.5 border-t border-border bg-background">
                  <div className="flex-1 relative">
                    <Textarea
                      value={feedback}
                      onChange={e => setFeedback(e.target.value)}
                      placeholder={proposal ? "Refine further, e.g. 'Actually make the title even bigger'..." : "e.g. Make the title larger, change the accent color..."}
                      className="text-xs min-h-[60px] resize-none"
                      data-testid={`input-feedback-${layout.dbId}`}
                      onKeyDown={e => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          handleSubmitFeedback();
                        }
                      }}
                    />
                    <div className="absolute top-1.5 right-1.5">
                      <VoiceInputButton onTranscript={(text) => setFeedback((prev) => prev ? prev + " " + text : text)} />
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={handleSubmitFeedback}
                    disabled={!feedback.trim() || feedbackMutation.isPending}
                    className="self-end"
                    data-testid={`button-send-feedback-${layout.dbId}`}
                  >
                    {feedbackMutation.isPending ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Send className="h-3 w-3" />
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

const VISION_MODELS = [
  { id: "gpt-4o", name: "GPT-4o", provider: "openai", description: "Best visual understanding" },
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", provider: "anthropic", description: "Strong design analysis" },
  { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", provider: "gemini", description: "Fast visual processing" },
  { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", provider: "anthropic", description: "Quick and capable" },
  { id: "gpt-4.1-mini", name: "GPT-4.1 Mini", provider: "openai", description: "Lightweight vision" },
];

const PROVIDER_COLORS: Record<string, string> = {
  openai: "text-emerald-600 dark:text-emerald-400",
  gemini: "text-blue-600 dark:text-blue-400",
  anthropic: "text-amber-600 dark:text-amber-400",
};

const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  gemini: "Google",
  anthropic: "Anthropic",
};

function VisionModelSelector({ value, onChange }: { value: string; onChange: (model: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        className="h-7 w-auto min-w-[140px] gap-1 border-muted-foreground/20 bg-muted/50 text-xs"
        data-testid="select-vision-model"
      >
        <Brain className="h-3 w-3 shrink-0 text-muted-foreground" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {VISION_MODELS.map(m => (
          <SelectItem key={m.id} value={m.id} data-testid={`select-model-option-${m.id}`}>
            <div className="flex items-center gap-2">
              <span className={`text-[10px] font-medium ${PROVIDER_COLORS[m.provider] || ""}`}>
                {PROVIDER_LABELS[m.provider] || m.provider}
              </span>
              <span className="text-xs">{m.name}</span>
              <span className="text-muted-foreground text-[10px] ml-1">{m.description}</span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function DeckUploadSection() {
  const [dragOver, setDragOver] = useState(false);
  const [screenshotDragOver, setScreenshotDragOver] = useState(false);
  const [analyzedDesigns, setAnalyzedDesigns] = useState<{ filename: string; designs: DeckDesign[] } | null>(null);
  const [designFeedback, setDesignFeedback] = useState<Record<string, string>>({});
  const [savingDesign, setSavingDesign] = useState<string | null>(null);
  const [refiningDesign, setRefiningDesign] = useState<string | null>(null);
  const [feedbackApplied, setFeedbackApplied] = useState<Record<string, boolean>>({});
  const [seenJobIds, setSeenJobIds] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem("slide-outlines-seen-jobs");
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });
  const [dismissedDesignKeys, setDismissedDesignKeys] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem("slide-outlines-dismissed-designs");
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });
  const [visionModel, setVisionModel] = useSelectedModel("slide-vision-model", "gpt-4o");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const screenshotInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const { data: queueJobs = [] } = useQuery<any[]>({
    queryKey: ["/api/processing-queue"],
    refetchInterval: 5000,
  });

  const [fetchingJobResult, setFetchingJobResult] = useState<string | null>(null);
  const [loadingReload, setLoadingReload] = useState(false);
  const autoLoadAttempted = useRef(false);

  const loadJobResult = useCallback(async (jobId: string, showToast = true): Promise<boolean> => {
    try {
      console.log(`[slide-outlines] Fetching full result for job ${jobId}...`);
      const res = await fetch(`/api/processing-queue/${jobId}`);
      if (!res.ok) {
        console.error(`[slide-outlines] Failed to fetch job ${jobId}: ${res.status}`);
        return false;
      }
      const fullJob = await res.json();
      console.log(`[slide-outlines] Job ${jobId} result type: ${typeof fullJob.result}, length: ${fullJob.result?.length || 0}`);
      if (!fullJob.result || fullJob.result === "HAS_RESULT") {
        console.error(`[slide-outlines] Job ${jobId} has no parseable result (got: ${fullJob.result})`);
        return false;
      }
      const parsed = JSON.parse(fullJob.result);
      console.log(`[slide-outlines] Parsed ${parsed.designs?.length || 0} designs from job ${jobId}`);
      if (parsed.designs && parsed.designs.length > 0) {
        setAnalyzedDesigns({ ...parsed, designs: parsed.designs });
        if (showToast) {
          toast({ title: "Deck analyzed", description: `Found ${parsed.designs.length} design pattern${parsed.designs.length !== 1 ? "s" : ""} in "${parsed.filename}". Review and approve below.` });
        }
        return true;
      } else {
        if (showToast) {
          toast({ title: "Analysis complete", description: `No new design patterns detected in "${parsed.filename}". The deck may use standard layouts already in the system.` });
        }
        return false;
      }
    } catch (err) {
      console.error(`[slide-outlines] Error loading job ${jobId}:`, err);
      return false;
    }
  }, [toast]);

  useEffect(() => {
    const doneSlideJobs = queueJobs.filter(
      (j: any) => j.section === "slide-outlines" && (j.status === "done" || j.status === "completed") && j.result === "HAS_RESULT"
    );

    if (doneSlideJobs.length > 0 && !analyzedDesigns && !fetchingJobResult && !autoLoadAttempted.current) {
      autoLoadAttempted.current = true;
      const latest = doneSlideJobs[doneSlideJobs.length - 1];
      const isNewJob = !seenJobIds.has(latest.jobId);
      console.log(`[slide-outlines] Auto-loading latest done job ${latest.jobId} (new: ${isNewJob})`);
      setFetchingJobResult(latest.jobId);
      loadJobResult(latest.jobId, isNewJob).finally(() => {
        setSeenJobIds(prev => {
          const next = new Set(prev);
          doneSlideJobs.forEach((j: any) => next.add(j.jobId));
          try { localStorage.setItem("slide-outlines-seen-jobs", JSON.stringify([...next])); } catch {}
          return next;
        });
        setFetchingJobResult(null);
      });
      return;
    }

    const newDoneJobs = doneSlideJobs.filter((j: any) => !seenJobIds.has(j.jobId));
    if (newDoneJobs.length > 0 && !fetchingJobResult) {
      const latest = newDoneJobs[newDoneJobs.length - 1];
      console.log(`[slide-outlines] New completed job detected: ${latest.jobId}`);
      setFetchingJobResult(latest.jobId);
      loadJobResult(latest.jobId).finally(() => {
        setSeenJobIds(prev => {
          const next = new Set(prev);
          newDoneJobs.forEach((j: any) => next.add(j.jobId));
          try { localStorage.setItem("slide-outlines-seen-jobs", JSON.stringify([...next])); } catch {}
          return next;
        });
        setFetchingJobResult(null);
      });
    }
  }, [queueJobs, analyzedDesigns]);

  const CHUNK_SIZE = 4 * 1024 * 1024;

  const analyzeMutation = useMutation({
    mutationFn: async (file: File) => {
      const useChunked = file.size > CHUNK_SIZE;

      if (!useChunked) {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("model", visionModel);
        const res = await fetch("/api/slide-outlines/analyze-deck", {
          method: "POST",
          body: formData,
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `Upload failed (${res.status})`);
        }
        return res.json();
      }

      const uploadId = `up_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const chunk = file.slice(start, end);

        const formData = new FormData();
        formData.append("chunk", chunk, `chunk_${i}`);
        formData.append("uploadId", uploadId);
        formData.append("chunkIndex", String(i));
        formData.append("totalChunks", String(totalChunks));
        formData.append("filename", file.name);

        let res: Response;
        try {
          res = await fetch("/api/chunked-upload", { method: "POST", body: formData });
        } catch (networkErr: any) {
          throw new Error(`Network error uploading chunk ${i + 1}/${totalChunks}. Check your connection and try again.`);
        }
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `Chunk upload failed (${res.status})`);
        }

        const chunkResult = await res.json();
        if (chunkResult.complete) {
          const analyzeRes = await fetch("/api/slide-outlines/analyze-deck-chunked", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              filePath: chunkResult.filePath,
              filename: chunkResult.filename,
              size: chunkResult.size,
              model: visionModel,
            }),
          });
          if (!analyzeRes.ok) {
            const data = await analyzeRes.json().catch(() => ({}));
            throw new Error(data.error || `Analysis failed (${analyzeRes.status})`);
          }
          return analyzeRes.json();
        }
      }
      throw new Error("Upload completed but file assembly failed. Please try again.");
    },
    onSuccess: (data) => {
      if (data.status === "processing" && data.jobId) {
        queryClient.invalidateQueries({ queryKey: ["/api/processing-queue"] });
        toast({ title: "Deck queued for analysis", description: `"${data.filename}" sent to processing queue. You can keep working while it analyzes.` });
      } else if (data.designs) {
        setAnalyzedDesigns(data);
        const count = data.designs?.length || 0;
        toast({ title: "Deck analyzed", description: `Found ${count} design pattern${count !== 1 ? "s" : ""} in "${data.filename}".` });
      }
    },
    onError: (err: any) => {
      toast({ title: "Upload failed", description: err.message || "Try again", variant: "destructive" });
    },
  });

  const screenshotMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("model", visionModel);
      const res = await fetch("/api/slide-outlines/analyze-screenshot", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Upload failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      setAnalyzedDesigns(data);
      toast({ title: "Screenshot analyzed", description: `Identified ${data.designs.length} design pattern from ${data.filename}` });
    },
    onError: (err: any) => {
      toast({ title: "Screenshot analysis failed", description: err.message || "Try again", variant: "destructive" });
    },
  });

  const handleFile = (file: File) => {
    if (!file.name.toLowerCase().endsWith(".pptx")) {
      toast({ title: "Invalid file", description: "Please upload a .pptx file", variant: "destructive" });
      return;
    }
    analyzeMutation.mutate(file);
  };

  const handleScreenshot = (file: File) => {
    const ext = file.name.toLowerCase().split(".").pop() || "";
    if (!["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) {
      toast({ title: "Invalid file", description: "Please upload an image (PNG, JPG, WEBP, GIF)", variant: "destructive" });
      return;
    }
    screenshotMutation.mutate(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleScreenshotDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setScreenshotDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleScreenshot(file);
  };

  const designKey = (design: DeckDesign) => `${design.name}::${design.existingLayoutId || "new"}`;

  const handleApproveDesign = async (design: DeckDesign, index: number) => {
    const key = designKey(design);
    setSavingDesign(key);
    try {
      const layoutType = design.existingLayoutId || design.name.toLowerCase().replace(/\s+/g, "-").substring(0, 20);
      const variantName = design.isNew ? "Standard" : `Variant from ${analyzedDesigns?.filename || "deck"}`;

      const rawFilename = analyzedDesigns?.filename || "";
      const templateName = rawFilename
        ? rawFilename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().substring(0, 60) || "Uploaded Deck"
        : "Uploaded Deck";

      const res = await apiRequest("POST", "/api/slide-designs", {
        layoutType: design.existingLayoutId || layoutType,
        variantName,
        description: design.description,
        designNotes: design.designNotes || design.designDetails || design.description,
        sampleTitle: design.sampleTitle || design.name,
        sampleBody: design.sampleBody || design.suggestedChanges || design.description,
        isApproved: true,
        isDefault: false,
        sourceFile: analyzedDesigns?.filename || null,
        designTemplate: templateName,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save");
      }

      queryClient.invalidateQueries({ queryKey: ["/api/slide-outlines"] });
      setDismissedDesignKeys(prev => {
        const next = new Set(prev);
        next.add(key);
        try { localStorage.setItem("slide-outlines-dismissed-designs", JSON.stringify([...next])); } catch {}
        return next;
      });
      setAnalyzedDesigns(prev => prev ? { ...prev, designs: prev.designs.filter((_, idx) => idx !== index) } : null);
      toast({ title: "Design saved and approved", description: `"${design.name}" added to "${templateName}" template.` });
    } catch (err: any) {
      toast({ title: "Save failed", description: err.message || "Try again", variant: "destructive" });
    } finally {
      setSavingDesign(null);
    }
  };

  const handleRefineDesign = async (design: DeckDesign, index: number) => {
    const key = designKey(design);
    const feedback = designFeedback[key]?.trim();
    if (!feedback) return;

    setRefiningDesign(key);
    try {
      const res = await apiRequest("POST", "/api/slide-outlines/feedback", {
        dbId: 0,
        layoutId: design.existingLayoutId || design.name.toLowerCase().replace(/\s+/g, "-").substring(0, 20),
        layoutName: design.name,
        designNotes: design.designNotes || design.designDetails || design.description,
        sampleTitle: design.sampleTitle || design.name,
        sampleBody: design.sampleBody || design.suggestedChanges || design.description || "Sample body text",
        feedback,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Refinement failed");
      }

      const result = await res.json();

      setAnalyzedDesigns(prev => {
        if (!prev) return prev;
        const updated = [...prev.designs];
        updated[index] = {
          ...updated[index],
          designNotes: result.proposedDesignNotes,
          designDetails: result.proposedDesignNotes,
          sampleTitle: result.proposedSampleTitle,
          sampleBody: result.proposedSampleBody,
        };
        return { ...prev, designs: updated };
      });

      setFeedbackApplied(prev => ({ ...prev, [key]: true }));
      toast({ title: "Design refined", description: result.explanation || "Preview updated with your feedback. Review and approve when ready." });
    } catch (err: any) {
      toast({ title: "Refinement failed", description: err.message || "Try again", variant: "destructive" });
    } finally {
      setRefiningDesign(null);
    }
  };

  return (
    <Card className="p-4 border-card-border" data-testid="card-deck-upload">
      <div className="flex items-start gap-3 mb-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-violet-100 dark:bg-violet-900/30">
          <Upload className="h-4.5 w-4.5 text-violet-600 dark:text-violet-400" />
        </div>
        <div>
          <h3 className="text-sm font-semibold mb-0.5">Analyze Designs from Files</h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Upload a .pptx deck or a slide screenshot to have AI identify design patterns. Approved designs will be saved and available for presentations.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-2">
        <VisionModelSelector value={visionModel} onChange={setVisionModel} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div
          className={`border-2 border-dashed rounded-lg p-5 text-center transition-colors cursor-pointer ${
            dragOver ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/40"
          }`}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          data-testid="dropzone-deck-upload"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pptx"
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
              e.target.value = "";
            }}
            data-testid="input-deck-file"
          />
          {analyzeMutation.isPending ? (
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="h-7 w-7 animate-spin text-violet-500" />
              <p className="text-xs text-muted-foreground">Uploading...</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <FileUp className="h-7 w-7 text-muted-foreground" />
              <p className="text-xs text-muted-foreground font-medium">Upload Deck</p>
              <p className="text-[10px] text-muted-foreground/70">.pptx files</p>
            </div>
          )}
        </div>

        <div
          className={`border-2 border-dashed rounded-lg p-5 text-center transition-colors cursor-pointer ${
            screenshotDragOver ? "border-sky-500 bg-sky-50 dark:bg-sky-950/20" : "border-border hover:border-muted-foreground/40"
          }`}
          onDragOver={e => { e.preventDefault(); setScreenshotDragOver(true); }}
          onDragLeave={() => setScreenshotDragOver(false)}
          onDrop={handleScreenshotDrop}
          onClick={() => screenshotInputRef.current?.click()}
          data-testid="dropzone-screenshot-upload"
        >
          <input
            ref={screenshotInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0];
              if (file) handleScreenshot(file);
              e.target.value = "";
            }}
            data-testid="input-screenshot-file"
          />
          {screenshotMutation.isPending ? (
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="h-7 w-7 animate-spin text-sky-500" />
              <p className="text-xs text-muted-foreground">Analyzing screenshot...</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <ImageIcon className="h-7 w-7 text-muted-foreground" />
              <p className="text-xs text-muted-foreground font-medium">Upload Screenshot</p>
              <p className="text-[10px] text-muted-foreground/70">PNG, JPG, WEBP</p>
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3 mt-3">
        <div className="flex-1 h-px bg-border" />
        <span className="text-xs text-muted-foreground">or import from</span>
        <div className="flex-1 h-px bg-border" />
      </div>
      <GoogleDrivePickerButton onFileSelected={(file) => handleFile(file)} className="mt-2" />

      {!analyzedDesigns && !analyzeMutation.isPending && (
        <Button
          variant="outline"
          size="sm"
          className="mt-3 w-full text-xs"
          data-testid="button-reload-last-analysis"
          disabled={loadingReload}
          onClick={async () => {
            setLoadingReload(true);
            try {
              const allRes = await fetch("/api/processing-queue/all");
              const allJobs = await allRes.json();
              const latestDone = allJobs.find((j: any) => j.section === "slide-outlines" && j.status === "done" && j.result);
              if (latestDone) {
                const loaded = await loadJobResult(latestDone.jobId);
                if (!loaded) {
                  toast({ title: "No designs found", description: "The last analysis did not produce any designs.", variant: "destructive" });
                }
              } else {
                toast({ title: "No analysis found", description: "No completed deck analyses found. Upload a deck to start.", variant: "destructive" });
              }
            } catch (err) {
              console.error("[slide-outlines] Reload failed:", err);
              toast({ title: "Failed to load", description: "Could not reload last analysis.", variant: "destructive" });
            } finally {
              setLoadingReload(false);
            }
          }}
        >
          {loadingReload ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}
          {loadingReload ? "Loading..." : "Reload Last Analysis"}
        </Button>
      )}

      {analyzedDesigns && analyzedDesigns.designs.length > 0 && (
        <div className="mt-4 space-y-3" data-testid="section-analyzed-designs">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-violet-500" />
            <h4 className="text-sm font-semibold">
              Designs Found in "{analyzedDesigns.filename}"
            </h4>
            <Badge variant="secondary" className="text-[10px]">{analyzedDesigns.designs.length}</Badge>
          </div>

          {analyzedDesigns.designs.map((design, i) => (
            <Card key={i} className="p-3 border-card-border" data-testid={`card-analyzed-design-${i}`}>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-semibold">{design.name}</span>
                {design.isNew ? (
                  <Badge className="text-[10px] bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">New Layout</Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px]">
                    Variant of: {design.existingLayoutId || "existing"}
                  </Badge>
                )}
                {design.slideNums && design.slideNums.length > 0 && (
                  <span className="text-[10px] text-muted-foreground ml-auto">
                    Slide{design.slideNums.length !== 1 ? "s" : ""} {design.slideNums.join(", ")}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed mb-3">{design.description}</p>

              <div className="flex flex-col gap-3 mb-3">
                <div className="flex gap-3">
                  <div className="shrink-0">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1">System Template Match</span>
                    <div className="border border-border rounded-md overflow-hidden shadow-sm" style={{ width: 240, height: 150 }} data-testid={`preview-slide-${i}`}>
                      <div style={{ transform: "scale(0.25)", transformOrigin: "top left", width: 960, height: 600 }}>
                        <SlideCanvas
                          sample={{
                            title: design.sampleTitle || design.name,
                            body: design.sampleBody || design.suggestedChanges || design.description || "Sample body text",
                            layout: design.existingLayoutId || "content",
                          }}
                          layoutId={design.existingLayoutId || "content"}
                          designNotes={design.designNotes || design.designDetails}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="flex-1 min-w-0 space-y-2">
                    <div>
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Design Details</span>
                      <div className="text-xs text-muted-foreground bg-muted/30 rounded-md p-2 mt-1 leading-relaxed whitespace-pre-wrap max-h-[140px] overflow-y-auto">
                        {design.designDetails || "No details available"}
                      </div>
                    </div>
                    {design.suggestedChanges && (
                      <div>
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-violet-600 dark:text-violet-400">Differences from Standard</span>
                        <div className="text-xs bg-violet-50 dark:bg-violet-950/20 text-violet-700 dark:text-violet-300 rounded-md p-2 mt-1 leading-relaxed max-h-[80px] overflow-y-auto">
                          {design.suggestedChanges}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {(() => {
                const dk = designKey(design);
                const fb = designFeedback[dk] || "";
                const applied = feedbackApplied[dk];
                return (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <Input
                        value={fb}
                        onChange={e => {
                          setDesignFeedback(prev => ({ ...prev, [dk]: e.target.value }));
                          if (applied) {
                            setFeedbackApplied(prev => ({ ...prev, [dk]: false }));
                          }
                        }}
                        placeholder="Add feedback on this design..."
                        className="text-xs"
                        data-testid={`input-design-feedback-${i}`}
                      />
                      <VoiceInputButton onTranscript={(text) => {
                        setDesignFeedback(prev => ({ ...prev, [dk]: (prev[dk] || "") ? prev[dk] + " " + text : text }));
                        if (applied) {
                          setFeedbackApplied(prev => ({ ...prev, [dk]: false }));
                        }
                      }} />
                      {fb.trim() && !applied && (
                        <Button
                          size="sm"
                          className="shrink-0 text-xs bg-violet-600 hover:bg-violet-700 text-white"
                          data-testid={`button-refine-design-${i}`}
                          disabled={refiningDesign === dk}
                          onClick={() => handleRefineDesign(design, i)}
                        >
                          {refiningDesign === dk ? (
                            <Loader2 className="h-3 w-3 animate-spin mr-1" />
                          ) : (
                            <RefreshCw className="h-3 w-3 mr-1" />
                          )}
                          Apply Feedback
                        </Button>
                      )}
                    </div>
                    {applied && (
                      <div className="flex items-center gap-1.5 text-[10px] text-emerald-600 dark:text-emerald-400" data-testid={`text-feedback-applied-${i}`}>
                        <Check className="h-3 w-3" />
                        Feedback applied. Preview updated. Review the changes and approve when ready.
                      </div>
                    )}
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="shrink-0 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                        data-testid={`button-approve-design-${i}`}
                        disabled={savingDesign === dk || (fb.trim() !== "" && !applied)}
                        onClick={() => handleApproveDesign(design, i)}
                      >
                        {savingDesign === dk ? (
                          <Loader2 className="h-3 w-3 animate-spin mr-1" />
                        ) : (
                          <Check className="h-3 w-3 mr-1" />
                        )}
                        Save & Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="shrink-0 text-xs text-destructive"
                        data-testid={`button-reject-design-${i}`}
                        onClick={() => {
                          const dk = designKey(design);
                          setDismissedDesignKeys(prev => {
                            const next = new Set(prev);
                            next.add(dk);
                            try { localStorage.setItem("slide-outlines-dismissed-designs", JSON.stringify([...next])); } catch {}
                            return next;
                          });
                          setAnalyzedDesigns(prev => prev ? { ...prev, designs: prev.designs.filter((_, idx) => idx !== i) } : null);
                          toast({ title: "Design dismissed", description: `"${design.name}" has been dismissed.` });
                        }}
                      >
                        <X className="h-3 w-3 mr-1" />
                        Dismiss
                      </Button>
                    </div>
                  </div>
                );
              })()}
            </Card>
          ))}
        </div>
      )}
    </Card>
  );
}

function TemplateSection({ templateName, designs, refetch, defaultExpanded, allTemplates }: {
  templateName: string;
  designs: SlideLayout[];
  refetch: () => void;
  defaultExpanded: boolean;
  allTemplates: string[];
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(templateName);
  const { toast } = useToast();

  const renameMutation = useMutation({
    mutationFn: async (newName: string) => {
      const res = await apiRequest("PATCH", "/api/slide-templates/rename", {
        oldName: templateName,
        newName,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to rename template");
      }
      return res.json();
    },
    onSuccess: () => {
      setIsRenaming(false);
      queryClient.invalidateQueries({ queryKey: ["/api/slide-outlines"] });
      queryClient.invalidateQueries({ queryKey: ["/api/slide-templates"] });
      toast({ title: "Template renamed", description: `Renamed to "${renameValue}".` });
    },
    onError: (err: any) => {
      toast({ title: "Rename failed", description: err.message, variant: "destructive" });
    },
  });

  const presentationOrder = ["title", "section", "subsection", "content", "stats", "comparison", "statement", "quote", "objection", "callout", "speakers", "timeline", "closing"];
  const layoutTypes = [...new Set(designs.map(l => l.id))].sort((a, b) => {
    const ai = presentationOrder.indexOf(a);
    const bi = presentationOrder.indexOf(b);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  const approvedInTemplate = designs.filter(d => d.isApproved).length;

  return (
    <div className="border border-border rounded-lg overflow-hidden" data-testid={`section-template-${templateName.toLowerCase().replace(/\s+/g, "-")}`}>
      <div
        className="w-full flex items-center justify-between px-4 py-3 bg-muted/40 hover:bg-muted/60 transition-colors cursor-pointer"
        onClick={() => { if (!isRenaming) setExpanded(!expanded); }}
        data-testid={`button-toggle-template-${templateName.toLowerCase().replace(/\s+/g, "-")}`}
      >
        <div className="flex items-center gap-3">
          {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronUp className="h-4 w-4 text-muted-foreground rotate-90" />}
          {isRenaming ? (
            <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
              <Input
                value={renameValue}
                onChange={e => setRenameValue(e.target.value)}
                className="h-7 text-sm w-48 px-2"
                autoFocus
                data-testid={`input-rename-template-${templateName.toLowerCase().replace(/\s+/g, "-")}`}
                onKeyDown={e => {
                  if (e.key === "Enter" && renameValue.trim() && renameValue !== templateName) {
                    renameMutation.mutate(renameValue.trim());
                  } else if (e.key === "Escape") {
                    setIsRenaming(false);
                    setRenameValue(templateName);
                  }
                }}
              />
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                onClick={() => renameValue.trim() && renameValue !== templateName && renameMutation.mutate(renameValue.trim())}
                disabled={renameMutation.isPending || !renameValue.trim() || renameValue === templateName}
                data-testid={`button-confirm-rename-template-${templateName.toLowerCase().replace(/\s+/g, "-")}`}
              >
                {renameMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                onClick={() => { setIsRenaming(false); setRenameValue(templateName); }}
                data-testid={`button-cancel-rename-template-${templateName.toLowerCase().replace(/\s+/g, "-")}`}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          ) : (
            <div className="group/template flex items-center gap-1.5">
              <span className="font-semibold text-sm">{templateName}</span>
              <button
                className="p-0.5 rounded opacity-0 group-hover/template:opacity-100 hover:bg-muted transition-opacity"
                onClick={e => { e.stopPropagation(); setIsRenaming(true); }}
                data-testid={`button-rename-template-${templateName.toLowerCase().replace(/\s+/g, "-")}`}
              >
                <Pencil className="h-3 w-3 text-muted-foreground" />
              </button>
            </div>
          )}
          <Badge variant="secondary" className="text-[10px]">{designs.length} designs</Badge>
          <Badge className="text-[10px] bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
            <ShieldCheck className="h-2.5 w-2.5 mr-0.5" />
            {approvedInTemplate} approved
          </Badge>
        </div>
        <span className="text-xs text-muted-foreground">{layoutTypes.length} layout types</span>
      </div>

      {expanded && (
        <div className="p-4 space-y-4">
          {layoutTypes.map(type => {
            const typeDesigns = designs.filter(l => l.id === type);
            return (
              <div key={type}>
                <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5 mb-2">
                  <LayoutTemplate className="h-3.5 w-3.5" />
                  {type} ({typeDesigns.length} variant{typeDesigns.length !== 1 ? "s" : ""})
                </h2>
                <div className="space-y-2">
                  {typeDesigns.map(layout => (
                    <LayoutCard key={layout.dbId} layout={layout} onRefresh={refetch} allTemplates={allTemplates} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function SlideOutlines() {
  const { data: layouts, isLoading, refetch } = useQuery<SlideLayout[]>({
    queryKey: ["/api/slide-outlines"],
  });

  const approvedCount = layouts?.filter(l => l.isApproved).length || 0;
  const totalCount = layouts?.length || 0;

  const templateNames = layouts
    ? [...new Set(layouts.map(l => l.designTemplate))].sort((a, b) => {
        if (a === "Classic") return -1;
        if (b === "Classic") return 1;
        return a.localeCompare(b);
      })
    : [];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2" data-testid="text-page-title">
              <LayoutTemplate className="h-5 w-5" />
              Slide Outlines
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Review and manage presentation slide designs. Only approved designs are used when generating presentations.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge className="text-xs bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" data-testid="text-approved-count">
              <ShieldCheck className="h-3 w-3 mr-1" />
              {approvedCount} approved
            </Badge>
            <Badge variant="secondary" className="text-xs" data-testid="text-layout-count">
              {totalCount} total
            </Badge>
          </div>
        </div>

        <DeckUploadSection />

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : layouts && layouts.length > 0 ? (
          <div className="space-y-4">
            {templateNames.map((template, idx) => (
              <TemplateSection
                key={template}
                templateName={template}
                designs={layouts.filter(l => l.designTemplate === template)}
                refetch={refetch}
                defaultExpanded={idx === 0}
                allTemplates={templateNames}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <AlertCircle className="h-8 w-8 text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">No slide layouts found.</p>
          </div>
        )}
      </div>
    </div>
  );
}
