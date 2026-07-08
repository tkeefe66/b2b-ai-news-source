import { useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { HelpCircle, ChevronDown } from "lucide-react";

const STATUS_MEANINGS: Array<{ label: string; variant: "default" | "secondary" | "destructive" | "outline"; meaning: string }> = [
  { label: "Sent", variant: "default", meaning: "The composed brief was emailed successfully." },
  { label: "Fallback sent", variant: "secondary", meaning: "AI composition failed three times, so a plain top-headlines email went out instead." },
  { label: "Composed", variant: "secondary", meaning: "The brief is written and stored; the email is about to send (or retry)." },
  { label: "Pending", variant: "outline", meaning: "The day's row is claimed and composition is in progress." },
  { label: "Compose failed", variant: "destructive", meaning: "An AI attempt failed; the scheduler retries on the next 5-minute tick (up to 3 tries)." },
  { label: "Send failed", variant: "destructive", meaning: "The brief is composed but email delivery failed; sending retries without re-composing." },
];

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
      {children}
    </h3>
  );
}

export function HowBriefWorks({ defaultOpen }: { defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-lg border border-border bg-card"
      data-testid="section-how-it-works"
    >
      <CollapsibleTrigger
        className="flex w-full items-center gap-2 px-4 py-3 text-sm font-medium hover:bg-accent/50 rounded-lg transition-colors"
        data-testid="button-how-it-works-toggle"
      >
        <HelpCircle className="h-4 w-4 text-muted-foreground" />
        How it works
        <ChevronDown
          className={`h-4 w-4 ml-auto text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="px-4 pb-4 pt-1 space-y-5 text-sm leading-relaxed">
          <section>
            <SectionLabel>The schedule</SectionLabel>
            <p>
              One email every weekday at 7:00 AM Central — Monday's brief covers the whole
              weekend. A scheduler checks every 5 minutes whether today's brief is owed, so
              even a restart or outage can't skip a morning: if AI composition fails three
              times, a plain headlines email sends instead. A weekday never passes silently.
            </p>
          </section>

          <section>
            <SectionLabel>Where the content comes from</SectionLabel>
            <p>
              Each morning the composer gathers the last 24 hours of articles already
              collected by this app (anything you dismissed is excluded), the movement
              between the two latest trend snapshots, and mentions of companies in your
              Sources competitor database. One Claude pass turns that into 3–5 top stories
              with a "why it matters" line, a Demandbase angle <em>only when genuine</em>,
              competitor watch, trend pulse, and a radar list of one-line headlines — sized
              to be fully read in about three minutes.
            </p>
          </section>

          <section>
            <SectionLabel>What the badges mean</SectionLabel>
            <ul className="space-y-1.5">
              {STATUS_MEANINGS.map(s => (
                <li key={s.label} className="flex items-start gap-2">
                  <Badge variant={s.variant} className="mt-0.5 shrink-0">{s.label}</Badge>
                  <span className="text-muted-foreground">{s.meaning}</span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <SectionLabel>Testing &amp; settings</SectionLabel>
            <p>
              "Send test brief now" composes and emails a brief immediately. Test sends are
              tracked separately and never block or replace the real daily send. Recipients,
              send hour, and timezone are configured on the Railway service via{" "}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">BRIEF_RECIPIENTS</code>,{" "}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">BRIEF_HOUR</code>, and{" "}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">BRIEF_TZ</code>; email
              delivery goes through Resend. The email and this archive render the same
              stored brief, so what you see here is exactly what was sent.
            </p>
          </section>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
