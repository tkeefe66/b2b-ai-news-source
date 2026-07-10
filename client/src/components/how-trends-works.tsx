import { useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { HelpCircle, ChevronDown } from "lucide-react";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
      {children}
    </h3>
  );
}

export function HowTrendsWorks({ defaultOpen }: { defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-lg border border-border bg-card"
      data-testid="section-how-trends-works"
    >
      <CollapsibleTrigger
        className="flex w-full items-center gap-2 px-4 py-3 text-sm font-medium hover:bg-accent/50 rounded-lg transition-colors"
        data-testid="button-how-trends-works-toggle"
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
            <SectionLabel>What a trend snapshot is</SectionLabel>
            <p>
              Generate sends the titles of articles this app has already collected in the
              selected window (7, 30, or 90 days; the 400 most recent are analyzed if there
              are more) to AI, which extracts 8–12 specific B2B go-to-market trends with a
              momentum direction and confidence score, 4–6 emerging signals (weaker early
              patterns worth watching), and sentiment for the 10–15 most-mentioned
              companies. Every snapshot is saved — the History dropdown revisits older
              ones, and deleting a snapshot is permanent.
            </p>
          </section>

          <section>
            <SectionLabel>Dashboard vs. AI Reports</SectionLabel>
            <p>
              These are two separate systems. The Dashboard tab shows structured snapshots —
              trend cards and charts built from a chosen time window. The AI Reports tab
              holds long-form written analyses: AI summarizes <em>every</em> article in the
              database in batches, then synthesizes one report with themes, insights, and
              takeaways. Generating one never changes the other.
            </p>
          </section>

          <section>
            <SectionLabel>The Watchlist</SectionLabel>
            <p>
              The bookmark on any trend card adds it to the Watchlist. Each snapshot —
              past and future — is checked for that trend by name, where exact or closely
              worded matches count, so you can see its momentum and confidence change over
              time. A trend worded very differently in a later snapshot may not match. Items
              can be paused or annotated with notes.
            </p>
          </section>

          <section>
            <SectionLabel>Where Competitive Intelligence comes from</SectionLabel>
            <p>
              The chart counts, per day, how many collected articles mention each company in
              your competitor list — managed on the Sources page under Competitor Database —
              by name in the title, description, or body. Dismissed articles are excluded.
              Demandbase Intelligence works the same way for Demandbase mentions. No AI is
              involved here; these are plain text-match counts.
            </p>
          </section>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
