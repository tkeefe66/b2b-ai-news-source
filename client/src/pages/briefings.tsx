import { useLocation, useSearch } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Mail, FileText, BookOpen } from "lucide-react";
import MorningBrief from "@/pages/morning-brief";
import Briefing from "@/pages/briefing";
import DeepReports from "@/components/deep-reports";

const VALID_TABS = ["morning-brief", "on-demand", "deep-reports"] as const;
type HubTab = (typeof VALID_TABS)[number];

function parseTab(search: string): HubTab {
  const params = new URLSearchParams(search);
  const raw = params.get("tab");
  return (VALID_TABS as readonly string[]).includes(raw || "") ? (raw as HubTab) : "morning-brief";
}

export default function Briefings() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const activeTab = parseTab(search);

  return (
    <Tabs
      value={activeTab}
      onValueChange={(val) => setLocation(`/briefings?tab=${val}`, { replace: true })}
      className="flex flex-col h-full"
    >
      <div className="border-b p-4">
        <h1 className="text-lg font-semibold" data-testid="text-briefings-title">Briefings</h1>
        <p className="text-xs text-muted-foreground">
          The morning email digest, on-demand summaries, and deep AI reports — one place.
        </p>

        <TabsList className="mt-3">
          <TabsTrigger value="morning-brief" data-testid="tab-hub-morning-brief">
            <Mail className="h-4 w-4 mr-1.5" />
            Morning Brief
          </TabsTrigger>
          <TabsTrigger value="on-demand" data-testid="tab-hub-on-demand">
            <FileText className="h-4 w-4 mr-1.5" />
            Daily Briefing
          </TabsTrigger>
          <TabsTrigger value="deep-reports" data-testid="tab-hub-deep-reports">
            <BookOpen className="h-4 w-4 mr-1.5" />
            Deep Reports
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="morning-brief" className="flex-1 overflow-hidden mt-0">
        <MorningBrief embedded />
      </TabsContent>
      <TabsContent value="on-demand" className="flex-1 overflow-hidden mt-0">
        <Briefing embedded />
      </TabsContent>
      <TabsContent value="deep-reports" className="flex-1 overflow-auto mt-0">
        <DeepReports />
      </TabsContent>
    </Tabs>
  );
}
