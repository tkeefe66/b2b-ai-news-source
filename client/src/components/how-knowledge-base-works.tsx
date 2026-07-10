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

export function HowKnowledgeBaseWorks({ defaultOpen }: { defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-lg border border-border bg-card"
      data-testid="section-how-knowledge-base-works"
    >
      <CollapsibleTrigger
        className="flex w-full items-center gap-2 px-4 py-3 text-sm font-medium hover:bg-accent/50 rounded-lg transition-colors"
        data-testid="button-how-knowledge-base-works-toggle"
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
            <SectionLabel>What this is</SectionLabel>
            <p>
              The Knowledge Base is the approved Demandbase product knowledge — the "DB
              point of view" the AI features write from. Only entries toggled active are
              fed into AI prompts, so you can deactivate an entry to keep it without using
              it. While the Knowledge Base is empty, those features fall back to a built-in
              Demandbase overview.
            </p>
          </section>

          <section>
            <SectionLabel>Which AI features read it</SectionLabel>
            <p>
              Field Enablement grounds every piece of content in these entries. Thought
              Leadership generation and the daily Morning Brief use them too. The
              structured entries on the Products tab additionally feed Public Company
              Analysis, so its Demandbase recommendations cite real capabilities.
            </p>
          </section>

          <section>
            <SectionLabel>How entries get in</SectionLabel>
            <p>
              Three ways: paste a webpage URL on the Sources tab here and AI extracts
              entries from the page; upload documents on the app's Sources page, where AI
              extracts entries the same way; or press Add Entry to write one by hand.
              Everything AI-extracted lands in a review step first — edit, approve, or
              discard each entry. Nothing extracted becomes active knowledge until you
              approve it; manual entries are active immediately.
            </p>
          </section>

          <section>
            <SectionLabel>The product hierarchy</SectionLabel>
            <p>
              The Products tab holds structured product knowledge: suites contain products,
              products can nest sub-products, and each product carries features — with
              capabilities, personas, problems solved, outcomes, and a talk track. Drag a
              card to re-nest it. If structured products start duplicating Knowledge Base
              entries, a banner offers to deactivate the overlaps so the AI isn't fed the
              same thing twice.
            </p>
          </section>

          <section>
            <SectionLabel>Reset to Defaults</SectionLabel>
            <p>
              This button on the Products tab deletes all current products, suites,
              sub-products, and features — including your edits — and regenerates the
              built-in default Demandbase product structure. It doesn't touch Knowledge
              Base entries or Sources, and it can't be undone.
            </p>
          </section>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
