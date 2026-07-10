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

export function HowEnablementWorks({ defaultOpen }: { defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-lg border border-border bg-card"
      data-testid="section-how-enablement-works"
    >
      <CollapsibleTrigger
        className="flex w-full items-center gap-2 px-4 py-3 text-sm font-medium hover:bg-accent/50 rounded-lg transition-colors"
        data-testid="button-how-enablement-works-toggle"
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
            <SectionLabel>The flow</SectionLabel>
            <p>
              Pick one of the seven content types above (or describe what you need in the
              box below). AI then asks a handful of clarifying questions about your
              audience, message, and creative direction — answer any of them and skip the
              rest. One answered question is enough to continue, or press Skip to generate
              immediately. There may be one short follow-up round before it writes the
              content.
            </p>
          </section>

          <section>
            <SectionLabel>Preview, refine, save</SectionLabel>
            <p>
              The finished piece appears as a preview. Refine regenerates it with your
              feedback as many times as you like, replacing the preview each time. When
              it's right, export it to Google Drive or use Save &amp; Done to name it and
              finish.
            </p>
          </section>

          <section>
            <SectionLabel>What grounds the output</SectionLabel>
            <p>
              Every piece is written against the Knowledge Base (the approved Demandbase
              point of view), Demandbase brand voice guidelines, and the articles in this
              app's news database that are most relevant to your request — plus the latest
              trend analysis and recent thought leadership. If your request names a company
              that's been researched in Public Company Analysis, that company's analysis is
              pulled in too.
            </p>
          </section>

          <section>
            <SectionLabel>Where saves go</SectionLabel>
            <p>
              Generated content is saved to the in-app history automatically (the clock
              button up top). Exports go to Google Drive — as a Google Doc, or Google
              Slides for decks — in the "Field Enablement Output" folder. Deleting an item
              from history never touches its Drive copy.
            </p>
          </section>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
