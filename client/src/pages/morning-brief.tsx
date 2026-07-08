import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Mail, Send, TrendingUp, TrendingDown, ExternalLink, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { format, parseISO } from "date-fns";
import type { Brief } from "@shared/schema";
import { briefPayloadSchema, type BriefPayload } from "@shared/brief-payload";
import { HowBriefWorks } from "@/components/how-brief-works";

const STATUS_LABEL: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  sent: { label: "Sent", variant: "default" },
  sent_fallback: { label: "Fallback sent", variant: "secondary" },
  composed: { label: "Composed", variant: "secondary" },
  pending: { label: "Pending", variant: "outline" },
  failed_compose: { label: "Compose failed", variant: "destructive" },
  failed_send: { label: "Send failed", variant: "destructive" },
};

function parsePayload(brief: Brief): BriefPayload | null {
  if (!brief.payload) return null;
  try {
    return briefPayloadSchema.parse(JSON.parse(brief.payload));
  } catch {
    return null;
  }
}

function PayloadView({ payload }: { payload: BriefPayload }) {
  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-primary">{payload.headline}</h2>

      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Top stories</h3>
        <div className="space-y-4">
          {payload.topStories.map((s, i) => (
            <div key={i} className="border-b border-border pb-3 last:border-0">
              <a
                href={s.link}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold hover:underline inline-flex items-center gap-1"
                data-testid={`link-story-${i}`}
              >
                {s.title}
                <ExternalLink className="h-3 w-3 text-muted-foreground" />
              </a>
              <span className="text-xs text-muted-foreground ml-2">{s.sourceName}</span>
              <p className="text-sm mt-1">{s.whyItMatters}</p>
              {s.dbAngle && (
                <div className="mt-2 rounded-md bg-orange-50 dark:bg-orange-950/30 px-3 py-2">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-orange-600 dark:text-orange-400">
                    Demandbase angle{s.dbAngle.strength === "moderate" ? " (moderate)" : ""}
                  </span>
                  <p className="text-sm mt-0.5">{s.dbAngle.text}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {payload.competitorWatch.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Competitor watch</h3>
          <div className="space-y-2">
            {payload.competitorWatch.map((c, i) => (
              <p key={i} className="text-sm">
                <span className="font-semibold">{c.competitor}</span> — {c.summary}
              </p>
            ))}
          </div>
        </section>
      )}

      {payload.trendPulse.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Trend pulse</h3>
          <div className="space-y-1.5">
            {payload.trendPulse.map((t, i) => (
              <p key={i} className="text-sm flex items-center gap-1.5">
                {t.direction === "rising" ? (
                  <TrendingUp className="h-3.5 w-3.5 text-emerald-600" />
                ) : (
                  <TrendingDown className="h-3.5 w-3.5 text-red-500" />
                )}
                <span className="font-medium">{t.trend}</span>
                <span className="text-muted-foreground">— {t.note}</span>
              </p>
            ))}
          </div>
        </section>
      )}

      {payload.radar.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Radar</h3>
          <ul className="space-y-1">
            {payload.radar.map((r, i) => (
              <li key={i} className="text-sm">
                <a href={r.link} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                  {r.title}
                </a>
                <span className="text-xs text-muted-foreground ml-1.5">{r.sourceName}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export default function MorningBrief() {
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const { data: briefs, isLoading } = useQuery<Brief[]>({ queryKey: ["/api/briefs"] });

  const sendNow = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/brief/send-now");
      return res.json();
    },
    onSuccess: (brief: Brief) => {
      queryClient.invalidateQueries({ queryKey: ["/api/briefs"] });
      setSelectedId(brief.id);
      toast({ title: "Test brief sent", description: "Check your inbox." });
    },
    onError: (err: Error) => {
      toast({ title: "Send failed", description: err.message, variant: "destructive" });
    },
  });

  const selected = briefs?.find(b => b.id === selectedId) ?? briefs?.[0];
  const payload = selected ? parsePayload(selected) : null;

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Mail className="h-6 w-6" /> Morning Brief
            </h1>
            <p className="text-sm text-muted-foreground">
              Weekday email digest — archive of every send.
            </p>
          </div>
          <Button onClick={() => sendNow.mutate()} disabled={sendNow.isPending} data-testid="button-send-test">
            <Send className="h-4 w-4 mr-2" />
            {sendNow.isPending ? "Composing & sending…" : "Send test brief now"}
          </Button>
        </div>

        {!isLoading && <HowBriefWorks defaultOpen={!briefs || briefs.length === 0} />}

        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : !briefs || briefs.length === 0 ? (
          <Card className="p-8 text-center text-muted-foreground">
            <p className="font-medium">No briefs yet.</p>
            <p className="text-sm mt-1">
              The first one sends on the next weekday morning — or click "Send test brief now" to try it immediately.
            </p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-4">
            <div className="space-y-2">
              {briefs.map(b => {
                const status = STATUS_LABEL[b.status] ?? { label: b.status, variant: "outline" as const };
                return (
                  <button
                    key={b.id}
                    onClick={() => setSelectedId(b.id)}
                    className={`w-full text-left rounded-lg border p-3 transition-colors ${
                      selected?.id === b.id ? "border-primary bg-accent" : "border-border hover:bg-accent/50"
                    }`}
                    data-testid={`button-brief-${b.id}`}
                  >
                    <div className="text-sm font-medium">
                      {format(parseISO(b.briefDate), "EEE MMM d, yyyy")}
                      {b.manual && <span className="text-xs text-muted-foreground ml-1">(test)</span>}
                    </div>
                    <Badge variant={status.variant} className="mt-1">{status.label}</Badge>
                  </button>
                );
              })}
            </div>
            <Card className="p-5">
              {selected && payload ? (
                <PayloadView payload={payload} />
              ) : selected ? (
                <div className="text-sm text-muted-foreground flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 mt-0.5 text-amber-500" />
                  <div>
                    <p className="font-medium text-foreground">No composed content for this brief.</p>
                    <p className="mt-1">Status: {selected.status}{selected.error ? ` — ${selected.error}` : ""}</p>
                  </div>
                </div>
              ) : null}
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
