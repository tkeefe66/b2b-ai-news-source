import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import MarkdownRenderer from "@/components/MarkdownRenderer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDestructive } from "@/components/confirm-destructive";
import {
  RefreshCw, Zap, Trash2, ChevronDown, ChevronRight, BookOpen, Clock,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { getTimeAgo } from "@/lib/time";
import { ModelSelector, useSelectedModel, MODEL_DISPLAY } from "@/components/ModelSelector";
import type { TrendAnalysis } from "@shared/schema";

function OldTrendsSection({
  trends,
  onDelete,
}: {
  trends: TrendAnalysis[];
  onDelete: (id: number) => void;
}) {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  if (trends.length === 0) return null;

  return (
    <div className="space-y-3">
      {trends.map((trend) => {
        const expanded = expandedId === trend.id;
        const date = new Date(trend.createdAt);
        const timeAgo = getTimeAgo(date);

        return (
          <Card key={trend.id} className="p-4" data-testid={`card-trend-${trend.id}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {timeAgo}
                  </span>
                  {trend.model && MODEL_DISPLAY[trend.model] && (
                    <span className={`text-[10px] font-medium ${MODEL_DISPLAY[trend.model].color}`} data-testid={`text-trend-model-${trend.id}`}>
                      {MODEL_DISPLAY[trend.model].label}
                    </span>
                  )}
                </div>
                <h3
                  className="text-sm font-semibold text-foreground leading-tight"
                  data-testid={`text-trend-title-${trend.id}`}
                >
                  {trend.title}
                </h3>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <ConfirmDestructive
                  title={`Delete "${trend.title}"?`}
                  description="This AI report is permanently deleted. This can't be undone."
                  onConfirm={() => onDelete(trend.id)}
                >
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Delete report"
                    data-testid={`button-delete-trend-${trend.id}`}
                  >
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </ConfirmDestructive>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setExpandedId(expanded ? null : trend.id)}
                  aria-label={expanded ? "Collapse report" : "Expand report"}
                  data-testid={`button-toggle-trend-${trend.id}`}
                >
                  {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            {expanded && (
              <div className="mt-3 space-y-3">
                <div className="flex flex-wrap gap-1.5">
                  {trend.keyThemes.map((theme, i) => (
                    <Badge key={i} variant="secondary" className="text-xs" data-testid={`badge-theme-${trend.id}-${i}`}>
                      <Zap className="h-3 w-3 mr-1" />
                      {theme}
                    </Badge>
                  ))}
                </div>
                <div className="rounded-md bg-muted/30 p-3" data-testid={`text-trend-summary-${trend.id}`}>
                  <MarkdownRenderer content={trend.summary} />
                </div>
                <div data-testid={`text-trend-insights-${trend.id}`}>
                  <MarkdownRenderer content={trend.insights} />
                </div>
                {trend.articleIds && trend.articleIds.length > 0 && (
                  <p className="text-xs text-muted-foreground pt-2 border-t border-border">
                    Based on {trend.articleIds.length.toLocaleString()} articles
                  </p>
                )}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

export default function DeepReports() {
  const { toast } = useToast();
  const [selectedModel, setSelectedModel] = useSelectedModel("selectedModel-deep-reports");

  const trendsQuery = useQuery<TrendAnalysis[]>({
    queryKey: ["/api/trends"],
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/analyze-trends", { model: selectedModel });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/trends"] });
      const count = data?.articleIds?.length || 0;
      toast({ title: "Trend analysis generated", description: `Analyzed ${count.toLocaleString()} articles.` });
    },
    onError: () => {
      toast({ title: "Analysis failed", description: "Could not generate trend analysis.", variant: "destructive" });
    },
  });

  const deleteTrendMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/trends/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trends"] });
      toast({ title: "Report deleted" });
    },
    onError: () => {
      toast({ title: "Delete failed", variant: "destructive" });
    },
  });

  const trends = trendsQuery.data || [];

  return (
    <div className="p-4">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-end gap-2 mb-3 flex-wrap">
          <ModelSelector value={selectedModel} onChange={setSelectedModel} compact />
          <Button
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending}
            size="sm"
            data-testid="button-generate-trends"
          >
            <RefreshCw className={`h-4 w-4 mr-1.5 ${generateMutation.isPending ? "animate-spin" : ""}`} />
            {generateMutation.isPending ? "Analyzing..." : "Generate AI Report"}
          </Button>
        </div>
        {trendsQuery.isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i} className="p-4">
                <Skeleton className="h-5 w-2/3 mb-3" />
                <div className="flex gap-2 mb-3 flex-wrap">
                  <Skeleton className="h-5 w-20 rounded-full" />
                  <Skeleton className="h-5 w-24 rounded-full" />
                </div>
                <Skeleton className="h-4 w-full mb-2" />
                <Skeleton className="h-4 w-4/5" />
              </Card>
            ))}
          </div>
        ) : trends.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center px-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 mb-4">
              <BookOpen className="h-8 w-8 text-primary" />
            </div>
            <h2 className="text-base font-semibold mb-1" data-testid="text-no-trends">
              No AI Trend Reports Yet
            </h2>
            <p className="text-sm text-muted-foreground mb-6 max-w-md">
              Click "Generate AI Report" to have AI review your news articles and produce a detailed analysis report.
            </p>
            <Button
              onClick={() => generateMutation.mutate()}
              disabled={generateMutation.isPending}
              data-testid="button-generate-trends-empty"
            >
              <RefreshCw className={`h-4 w-4 mr-1.5 ${generateMutation.isPending ? "animate-spin" : ""}`} />
              {generateMutation.isPending ? "Analyzing..." : "Generate First Report"}
            </Button>
          </div>
        ) : (
          <OldTrendsSection
            trends={trends}
            onDelete={(id) => deleteTrendMutation.mutate(id)}
          />
        )}
      </div>
    </div>
  );
}
