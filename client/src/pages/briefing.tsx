import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useRef, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileText, RefreshCw, Clock, ChevronRight, Sparkles, Calendar, GitCompareArrows, History, Search, Trash2, ChevronDown, ChevronUp, BookOpen, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ConfirmDestructive } from "@/components/confirm-destructive";
import type { Briefing } from "@shared/schema";
import { DateRangePicker } from "@/components/date-range-picker";
import type { DateRange } from "react-day-picker";
import { format } from "date-fns";
import { VoiceInputButton } from "@/components/VoiceInputButton";


function renderInline(text: string): React.ReactNode {
  const tokens: React.ReactNode[] = [];
  const regex = /\*\*(.*?)\*\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let lastIndex = 0;
  let match;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push(text.slice(lastIndex, match.index));
    }
    if (match[1] !== undefined) {
      tokens.push(<strong key={key} className="font-semibold">{match[1]}</strong>);
    } else if (match[2] && match[3]) {
      tokens.push(
        <a
          key={key}
          href={match[3]}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2"
          data-testid={`link-article-${key}`}
        >
          {match[2]}
        </a>
      );
    }
    key++;
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    tokens.push(text.slice(lastIndex));
  }
  return tokens.length > 0 ? tokens : text;
}

function BriefingRenderer({ content }: { content: string }) {
  const lines = content.split("\n");
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none">
      {lines.map((line, i) => {
        if (line.startsWith("# ")) {
          // h2, not h1: the page already has its own h1 and this is rendered content.
          return <h2 key={i} className="text-xl font-bold mt-6 mb-3 text-primary">{line.slice(2)}</h2>;
        }
        if (line.startsWith("## ")) {
          return <h2 key={i} className="text-lg font-semibold mt-5 mb-2 border-b pb-1 border-border">{line.slice(3)}</h2>;
        }
        if (line.startsWith("### ")) {
          return <h3 key={i} className="text-base font-semibold mt-4 mb-1.5 text-foreground/90">{line.slice(4)}</h3>;
        }
        if (line.startsWith("#### ")) {
          return <h4 key={i} className="text-sm font-semibold mt-3 mb-1 text-foreground/80">{line.slice(5)}</h4>;
        }
        if (line.match(/^\d+\.\s/)) {
          return (
            <div key={i} className="flex items-baseline gap-2 ml-3 mb-1.5">
              <span className="text-primary font-semibold shrink-0 min-w-[1.25rem] text-right">{line.match(/^(\d+\.)/)?.[1]}</span>
              <p className="text-sm text-foreground leading-relaxed">{renderInline(line.replace(/^\d+\.\s/, ""))}</p>
            </div>
          );
        }
        if (line.startsWith("- ") || line.startsWith("* ")) {
          return (
            <div key={i} className="flex items-baseline gap-1.5 ml-3 mb-1">
              <span className="text-primary shrink-0 translate-y-[1px]">
                <ChevronRight className="h-3 w-3" />
              </span>
              <p className="text-sm text-foreground leading-relaxed">{renderInline(line.slice(2))}</p>
            </div>
          );
        }
        if (line.trim() === "") return <div key={i} className="h-2" />;
        if (line.startsWith("> ")) {
          return (
            <blockquote key={i} className="border-l-2 border-primary/50 pl-3 py-1 my-2 text-sm text-muted-foreground italic">
              {renderInline(line.slice(2))}
            </blockquote>
          );
        }
        return <p key={i} className="text-sm text-foreground leading-relaxed mb-1.5">{renderInline(line)}</p>;
      })}
    </div>
  );
}

function useSSEStream() {
  const [content, setContent] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const { toast } = useToast();

  const stream = async (url: string, body: Record<string, unknown>, onDone?: () => void) => {
    setIsStreaming(true);
    setContent("");
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "include",
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Request failed");
      }
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      let buffer = "";
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n");
          buffer = parts.pop() || "";
          for (const line of parts) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6);
            if (data === "[DONE]") continue;
            try {
              const parsed = JSON.parse(data);
              if (parsed.error) {
                toast({ title: "Error", description: parsed.error, variant: "destructive" });
                break;
              }
              if (parsed.content) {
                accumulated += parsed.content;
                setContent(accumulated);
              }
              if (parsed.done && onDone) onDone();
            } catch {}
          }
        }
        if (buffer.startsWith("data: ")) {
          const data = buffer.slice(6);
          if (data !== "[DONE]") {
            try {
              const parsed = JSON.parse(data);
              if (parsed.content) {
                accumulated += parsed.content;
                setContent(accumulated);
              }
            } catch {}
          }
        }
      }
      setIsStreaming(false);
    } catch (err: any) {
      setIsStreaming(false);
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    }
  };

  return { content, isStreaming, stream, setContent };
}

const periodLabels: Record<string, string> = {
  "Today": "1 Day",
  "today": "1 Day",
  "Last 3 Days": "3 Days",
  "3days": "3 Days",
  "Last 7 Days": "7 Days",
  "week": "7 Days",
};

function formatDate(dateStr: string | Date): string {
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
}

function BriefingCard({
  briefing,
  isSelected,
  isLatest,
  onSelect,
  onDelete,
}: {
  briefing: Briefing;
  isSelected: boolean;
  isLatest: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const summaryPreview = briefing.executiveSummary
    ? briefing.executiveSummary.slice(0, 120) + (briefing.executiveSummary.length > 120 ? "..." : "")
    : briefing.sections.slice(0, 120) + "...";

  return (
    <Card
      className={`p-3 cursor-pointer transition-all duration-200 hover:shadow-sm ${
        isSelected
          ? "border-primary bg-primary/5 ring-1 ring-primary/20"
          : "border-card-border hover:border-primary/30"
      }`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      data-testid={`card-briefing-${briefing.id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1 flex-wrap">
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
              {periodLabels[briefing.period] || briefing.period}
            </Badge>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              {briefing.articleCount} articles
            </Badge>
            {isLatest && (
              <Badge className="text-[10px] px-1.5 py-0 bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
                Latest
              </Badge>
            )}
          </div>
          <p className="text-xs font-medium truncate" data-testid={`text-briefing-title-${briefing.id}`}>
            {briefing.title}
          </p>
          <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">
            {summaryPreview}
          </p>
          <p className="text-[10px] text-muted-foreground mt-1.5 flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Generated {formatDate(briefing.createdAt)}
          </p>
        </div>
        <ConfirmDestructive
          title={`Delete "${briefing.title}"?`}
          description="This permanently deletes the briefing and its executive summary. This can't be undone."
          onConfirm={onDelete}
        >
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
            aria-label={`Delete briefing "${briefing.title}"`}
            data-testid={`button-delete-briefing-${briefing.id}`}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </ConfirmDestructive>
      </div>
    </Card>
  );
}

function BriefingsTab() {
  const { toast } = useToast();
  const [period, setPeriod] = useState("week");
  const [customDateRange, setCustomDateRange] = useState<DateRange | undefined>();
  const { content: streamingContent, isStreaming, stream, setContent } = useSSEStream();
  const [selectedBriefing, setSelectedBriefing] = useState<Briefing | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const briefingsQuery = useQuery<Briefing[]>({ queryKey: ["/api/briefings"] });
  const latestQuery = useQuery<Briefing | null>({ queryKey: ["/api/briefings/latest"] });

  const allBriefings = briefingsQuery.data || [];
  const latest = latestQuery.data;

  useEffect(() => {
    if (latest && !selectedBriefing && !isStreaming) {
      setSelectedBriefing(latest);
    }
  }, [latest]);

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/briefings/${id}`);
    },
    onSuccess: (_data, deletedId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/briefings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/briefings/latest"] });
      if (selectedBriefing?.id === deletedId) {
        setSelectedBriefing(null);
      }
      toast({ title: "Briefing deleted", description: "The briefing has been removed." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete briefing.", variant: "destructive" });
    },
  });

  const generateBriefing = () => {
    setSelectedBriefing(null);
    setSidebarOpen(false);
    const body: Record<string, string> = { period };
    if (period === "custom" && customDateRange?.from && customDateRange?.to) {
      body.dateFrom = format(customDateRange.from, "yyyy-MM-dd");
      body.dateTo = format(customDateRange.to, "yyyy-MM-dd");
    }
    stream("/api/briefings/generate", body, () => {
      briefingsQuery.refetch();
      latestQuery.refetch();
      toast({ title: "Briefing generated", description: "Your executive briefing is ready." });
    });
  };

  const displayContent = isStreaming ? streamingContent : selectedBriefing?.sections || "";
  const showEmpty = !displayContent && !isStreaming && !briefingsQuery.isLoading;

  return (
    <div className="flex flex-col md:flex-row h-full">
      {/* Desktop sidebar */}
      <div className="hidden md:flex w-72 border-r flex-col shrink-0 overflow-hidden">
        <div className="p-3 border-b space-y-2">
          <div className="flex items-center gap-2">
            <Select value={period} onValueChange={(val) => {
              setPeriod(val);
              if (val !== "custom") setCustomDateRange(undefined);
            }}>
              <SelectTrigger className="flex-1 h-8 text-xs" data-testid="select-period-trigger">
                <Calendar className="h-3 w-3 mr-1 text-muted-foreground" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="today" data-testid="select-period-today">Today</SelectItem>
                <SelectItem value="3days" data-testid="select-period-3days">Last 3 Days</SelectItem>
                <SelectItem value="week" data-testid="select-period-week">Last 7 Days</SelectItem>
                <SelectItem value="custom" data-testid="select-period-custom">Custom Range</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {period === "custom" && (
            <DateRangePicker
              dateRange={customDateRange}
              onDateRangeChange={setCustomDateRange}
            />
          )}
          <Button onClick={generateBriefing} disabled={isStreaming || (period === "custom" && (!customDateRange?.from || !customDateRange?.to))} size="sm" className="w-full" data-testid="button-generate-briefing">
            {isStreaming ? <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1.5" />}
            {isStreaming ? "Generating..." : "Generate Briefing"}
          </Button>
        </div>
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <p className="text-xs font-medium text-muted-foreground">
            Saved Briefings ({allBriefings.length})
          </p>
        </div>
        <div className="flex-1 overflow-auto p-2 space-y-2">
          {briefingsQuery.isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => (
                <Skeleton key={i} className="h-20 w-full rounded-lg" />
              ))}
            </div>
          ) : allBriefings.length === 0 ? (
            <div className="text-center py-8">
              <BookOpen className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">No saved briefings yet</p>
            </div>
          ) : (
            allBriefings.map((b, idx) => (
              <BriefingCard
                key={b.id}
                briefing={b}
                isSelected={selectedBriefing?.id === b.id}
                isLatest={idx === 0}
                onSelect={() => {
                  setSelectedBriefing(b);
                  setContent("");
                }}
                onDelete={() => deleteMutation.mutate(b.id)}
              />
            ))
          )}
        </div>
      </div>

      {/* Mobile: compact top bar + collapsible briefings list */}
      <div className="md:hidden border-b">
        <div className="flex items-center gap-2 p-2">
          <Select value={period} onValueChange={(val) => {
            setPeriod(val);
            if (val !== "custom") setCustomDateRange(undefined);
          }}>
            <SelectTrigger className="h-8 text-xs w-28" data-testid="select-period-trigger-mobile">
              <Calendar className="h-3 w-3 mr-1 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today" data-testid="select-period-today-m">Today</SelectItem>
              <SelectItem value="3days" data-testid="select-period-3days-m">Last 3 Days</SelectItem>
              <SelectItem value="week" data-testid="select-period-week-m">Last 7 Days</SelectItem>
              <SelectItem value="custom" data-testid="select-period-custom-m">Custom Range</SelectItem>
            </SelectContent>
          </Select>
          {period === "custom" && (
            <DateRangePicker
              dateRange={customDateRange}
              onDateRangeChange={setCustomDateRange}
            />
          )}
          <Button onClick={generateBriefing} disabled={isStreaming || (period === "custom" && (!customDateRange?.from || !customDateRange?.to))} size="sm" className="h-8 text-xs" data-testid="button-generate-briefing-mobile">
            {isStreaming ? <RefreshCw className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1" />}
            {isStreaming ? "..." : "Generate"}
          </Button>
          <div className="flex-1" />
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs gap-1"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            data-testid="button-toggle-sidebar"
          >
            {sidebarOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {allBriefings.length} saved
          </Button>
        </div>
        {sidebarOpen && (
          <div className="max-h-[35vh] overflow-auto border-t p-2 space-y-2 bg-muted/30">
            {briefingsQuery.isLoading ? (
              <div className="space-y-2">
                {[1, 2].map(i => (
                  <Skeleton key={i} className="h-16 w-full rounded-lg" />
                ))}
              </div>
            ) : allBriefings.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">No saved briefings yet</p>
            ) : (
              allBriefings.map((b, idx) => (
                <BriefingCard
                  key={b.id}
                  briefing={b}
                  isSelected={selectedBriefing?.id === b.id}
                  isLatest={idx === 0}
                  onSelect={() => {
                    setSelectedBriefing(b);
                    setContent("");
                    setSidebarOpen(false);
                  }}
                  onDelete={() => deleteMutation.mutate(b.id)}
                />
              ))
            )}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto min-h-0">
        {briefingsQuery.isLoading ? (
          <div className="p-6 space-y-4 max-w-4xl mx-auto">
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-6 w-1/2 mt-4" />
            <Skeleton className="h-4 w-full" />
          </div>
        ) : showEmpty ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 mb-4">
              <FileText className="h-8 w-8 text-primary" />
            </div>
            <h2 className="text-base font-semibold mb-1" data-testid="text-empty-state">No Briefings Yet</h2>
            <p className="text-sm text-muted-foreground mb-6 max-w-md">
              Generate an executive briefing to get an AI-powered summary of all the latest news across your categories.
            </p>
            <Button onClick={generateBriefing} data-testid="button-generate-first">
              <Sparkles className="h-4 w-4 mr-2" />
              Generate Your First Briefing
            </Button>
          </div>
        ) : (
          <div className="p-4 md:p-6 overflow-auto">
            <div className="max-w-4xl mx-auto">
              {isStreaming && (
                <div className="flex items-center gap-2 mb-4 text-xs text-muted-foreground" role="status" data-testid="text-generating-status">
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  <span>Analyzing articles and generating your briefing...</span>
                </div>
              )}
              <Card className="p-4 md:p-6 lg:p-8" aria-live="polite" data-testid="card-briefing-content">
                <BriefingRenderer content={displayContent} />
                {isStreaming && <span className="inline-block w-2 h-4 bg-foreground/50 animate-pulse ml-0.5 mt-2" />}
              </Card>
              {selectedBriefing && !isStreaming && (
                <p className="text-xs text-muted-foreground mt-3 text-center" data-testid="text-briefing-meta">
                  Generated {formatDate(selectedBriefing.createdAt)} · Based on {selectedBriefing.articleCount} articles
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CompareTab() {
  const briefingsQuery = useQuery<Briefing[]>({ queryKey: ["/api/briefings"] });
  const briefings = briefingsQuery.data || [];
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const { content, isStreaming, stream } = useSSEStream();
  const [panelOpen, setPanelOpen] = useState(true);

  const toggleSelect = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < 2) {
        next.add(id);
      }
      return next;
    });
  };

  const runComparison = () => {
    const ids = Array.from(selected);
    if (ids.length !== 2) return;
    stream("/api/briefings/compare", { briefingIdA: ids[0], briefingIdB: ids[1] });
  };

  if (briefings.length < 2) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 mb-4">
          <GitCompareArrows className="h-8 w-8 text-primary" />
        </div>
        <h2 className="text-base font-semibold mb-1" data-testid="text-compare-empty">Need More Briefings</h2>
        <p className="text-sm text-muted-foreground max-w-md">
          Generate at least two briefings to compare them. Go to the Briefings tab to create more.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col md:flex-row h-full">
      {/* Desktop sidebar */}
      <div className="hidden md:block w-64 border-r p-3 overflow-auto shrink-0">
        <p className="text-xs font-medium text-muted-foreground mb-1">Select two briefings to compare</p>
        <p className="text-xs text-muted-foreground mb-3">{selected.size}/2 selected</p>
        <div className="space-y-2 mb-4">
          {briefings.map((b) => (
            <label
              key={b.id}
              className={`flex items-start gap-3 rounded-md border px-3 py-2.5 cursor-pointer transition-colors ${
                selected.has(b.id) ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30"
              } ${!selected.has(b.id) && selected.size >= 2 ? "opacity-40 cursor-not-allowed" : ""}`}
              data-testid={`checkbox-briefing-${b.id}`}
            >
              <Checkbox
                checked={selected.has(b.id)}
                onCheckedChange={() => toggleSelect(b.id)}
                disabled={!selected.has(b.id) && selected.size >= 2}
                className="mt-0.5"
              />
              <div className="text-xs">
                <p className="font-medium">{b.period}</p>
                <p className="text-muted-foreground">
                  {b.articleCount} articles · {formatDate(b.createdAt)}
                </p>
              </div>
            </label>
          ))}
        </div>
        <Button
          onClick={runComparison}
          disabled={selected.size !== 2 || isStreaming}
          className="w-full"
          size="sm"
          data-testid="button-compare"
        >
          {isStreaming ? <RefreshCw className="h-4 w-4 mr-1.5 animate-spin" /> : <GitCompareArrows className="h-4 w-4 mr-1.5" />}
          {isStreaming ? "Comparing..." : "Compare Briefings"}
        </Button>
      </div>

      {/* Mobile: compact top bar + collapsible selection */}
      <div className="md:hidden border-b">
        <div className="flex items-center gap-2 p-2">
          <Button
            onClick={() => { runComparison(); setPanelOpen(false); }}
            disabled={selected.size !== 2 || isStreaming}
            size="sm"
            className="h-8 text-xs"
            data-testid="button-compare-mobile"
          >
            {isStreaming ? <RefreshCw className="h-3.5 w-3.5 mr-1 animate-spin" /> : <GitCompareArrows className="h-3.5 w-3.5 mr-1" />}
            {isStreaming ? "..." : "Compare"}
          </Button>
          <span className="text-xs text-muted-foreground">{selected.size}/2</span>
          <div className="flex-1" />
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs gap-1"
            onClick={() => setPanelOpen(!panelOpen)}
            data-testid="button-toggle-compare-panel"
          >
            {panelOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            Select
          </Button>
        </div>
        {panelOpen && (
          <div className="max-h-[35vh] overflow-auto border-t p-2 space-y-2 bg-muted/30">
            {briefings.map((b) => (
              <label
                key={b.id}
                className={`flex items-start gap-3 rounded-md border px-3 py-2 cursor-pointer transition-colors bg-background ${
                  selected.has(b.id) ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30"
                } ${!selected.has(b.id) && selected.size >= 2 ? "opacity-40 cursor-not-allowed" : ""}`}
                data-testid={`checkbox-briefing-m-${b.id}`}
              >
                <Checkbox
                  checked={selected.has(b.id)}
                  onCheckedChange={() => toggleSelect(b.id)}
                  disabled={!selected.has(b.id) && selected.size >= 2}
                  className="mt-0.5"
                />
                <div className="text-xs">
                  <p className="font-medium">{b.period}</p>
                  <p className="text-muted-foreground">
                    {b.articleCount} articles · {formatDate(b.createdAt)}
                  </p>
                </div>
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto min-h-0">
        <div className="p-4 md:p-6 max-w-4xl mx-auto">
          {!content && !isStreaming && (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <GitCompareArrows className="h-10 w-10 text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground" data-testid="text-compare-prompt">
                Select two briefings and click Compare to see what changed between them
              </p>
            </div>
          )}
          {(content || isStreaming) && (
            <>
              {isStreaming && (
                <div className="flex items-center gap-2 mb-4 text-xs text-muted-foreground" role="status" data-testid="text-comparing-status">
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  <span>Analyzing differences between briefings...</span>
                </div>
              )}
              <Card className="p-4 md:p-6 lg:p-8" aria-live="polite" data-testid="card-compare-content">
                <BriefingRenderer content={content} />
                {isStreaming && <span className="inline-block w-2 h-4 bg-foreground/50 animate-pulse ml-0.5 mt-2" />}
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function TimeMachineTab() {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [category, setCategory] = useState("all");
  const [topic, setTopic] = useState("");
  const { content, isStreaming, stream } = useSSEStream();
  const [tmPanelOpen, setTmPanelOpen] = useState(false);

  const categoriesQuery = useQuery<{ categories: string[] }>({
    queryKey: ["/api/articles/filters"],
  });
  const categories = categoriesQuery.data?.categories || [];

  const runAnalysis = () => {
    if (!startDate || !endDate) return;
    setTmPanelOpen(false);
    stream("/api/briefings/time-machine", {
      startDate,
      endDate,
      category: category === "all" ? undefined : category,
      topic: topic.trim() || undefined,
    });
  };

  const configForm = (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor="tm-start" className="text-[11px]">Start Date</Label>
        <Input
          id="tm-start"
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className="h-8 text-xs"
          data-testid="input-start-date"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="tm-end" className="text-[11px]">End Date</Label>
        <Input
          id="tm-end"
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          className="h-8 text-xs"
          data-testid="input-end-date"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-[11px]">Category (optional)</Label>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="h-8 text-xs" data-testid="select-tm-category">
            <SelectValue placeholder="All Categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" data-testid="select-tm-cat-all">All Categories</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c} value={c} data-testid={`select-tm-cat-${c}`}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="tm-topic" className="text-[11px]">Topic / Keywords (optional)</Label>
        <div className="flex items-center gap-1">
          <Input
            id="tm-topic"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g. LLM vendors, AI agents"
            className="h-8 text-xs"
            data-testid="input-topic"
          />
          <VoiceInputButton onTranscript={(text) => setTopic((prev) => prev ? prev + " " + text : text)} />
        </div>
      </div>
      <Button
        onClick={runAnalysis}
        disabled={!startDate || !endDate || isStreaming}
        className="w-full"
        size="sm"
        data-testid="button-analyze-period"
      >
        {isStreaming ? <RefreshCw className="h-4 w-4 mr-1.5 animate-spin" /> : <Search className="h-4 w-4 mr-1.5" />}
        {isStreaming ? "Analyzing..." : "Analyze Period"}
      </Button>
    </div>
  );

  return (
    <div className="flex flex-col md:flex-row h-full">
      {/* Desktop sidebar */}
      <div className="hidden md:block w-60 border-r p-3 overflow-auto shrink-0">
        <p className="text-xs font-medium text-muted-foreground mb-2">Configure your analysis</p>
        {configForm}
      </div>

      {/* Mobile: compact top bar + collapsible config */}
      <div className="md:hidden border-b">
        <div className="flex items-center gap-2 p-2">
          <Button
            onClick={runAnalysis}
            disabled={!startDate || !endDate || isStreaming}
            size="sm"
            className="h-8 text-xs"
            data-testid="button-analyze-period-mobile"
          >
            {isStreaming ? <RefreshCw className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Search className="h-3.5 w-3.5 mr-1" />}
            {isStreaming ? "..." : "Analyze"}
          </Button>
          <div className="flex-1" />
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs gap-1"
            onClick={() => setTmPanelOpen(!tmPanelOpen)}
            data-testid="button-toggle-tm-panel"
          >
            {tmPanelOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            Options
          </Button>
        </div>
        {tmPanelOpen && (
          <div className="border-t p-3 bg-muted/30">
            {configForm}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto min-h-0">
        <div className="p-4 md:p-6 max-w-4xl mx-auto">
          {!content && !isStreaming && (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <History className="h-10 w-10 text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground mb-2" data-testid="text-tm-prompt">
                Set a date range and optionally filter by category or topic to generate a retrospective analysis
              </p>
              <p className="text-xs text-muted-foreground max-w-sm">
                Example: What changed in the AI space for LLM vendors from March 2023 to December 2024?
              </p>
            </div>
          )}
          {(content || isStreaming) && (
            <>
              {isStreaming && (
                <div className="flex items-center gap-2 mb-4 text-xs text-muted-foreground" role="status" data-testid="text-tm-analyzing">
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  <span>Analyzing articles across the selected time period...</span>
                </div>
              )}
              <Card className="p-4 md:p-6 lg:p-8" aria-live="polite" data-testid="card-tm-content">
                <BriefingRenderer content={content} />
                {isStreaming && <span className="inline-block w-2 h-4 bg-foreground/50 animate-pulse ml-0.5 mt-2" />}
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function BriefingPage() {
  return (
    <div className="flex flex-col h-full">
      <div className="border-b p-4">
        <h1 className="text-lg font-semibold" data-testid="text-briefing-title">Daily Briefing</h1>
        <p className="text-xs text-muted-foreground">
          Your intelligence center — AI-generated briefings, comparisons, and historical analysis
        </p>
      </div>

      <Tabs defaultValue="briefings" className="flex-1 flex flex-col overflow-hidden">
        <div className="border-b px-4">
          <TabsList className="h-10">
            <TabsTrigger value="briefings" className="text-xs gap-1.5" data-testid="tab-briefings">
              <FileText className="h-3.5 w-3.5" />
              Briefings
            </TabsTrigger>
            <TabsTrigger value="compare" className="text-xs gap-1.5" data-testid="tab-compare">
              <GitCompareArrows className="h-3.5 w-3.5" />
              Compare
            </TabsTrigger>
            <TabsTrigger value="timemachine" className="text-xs gap-1.5" data-testid="tab-timemachine">
              <History className="h-3.5 w-3.5" />
              Time Machine
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="briefings" className="flex-1 overflow-hidden mt-0">
          <BriefingsTab />
        </TabsContent>
        <TabsContent value="compare" className="flex-1 overflow-hidden mt-0">
          <CompareTab />
        </TabsContent>
        <TabsContent value="timemachine" className="flex-1 overflow-hidden mt-0">
          <TimeMachineTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
