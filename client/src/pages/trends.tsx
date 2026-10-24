import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useMemo, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConfirmDestructive } from "@/components/confirm-destructive";
import { TrendingUp, RefreshCw, BarChart3, ArrowUpRight, ArrowDownRight, Minus, Building2, Sparkles, FileText, Trash2, Calendar, Save, ChevronDown, ChevronRight, ExternalLink, Eye, History, AlertTriangle, Target, Bookmark, BookmarkCheck, X, Loader2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ModelSelector, useSelectedModel, MODEL_DISPLAY } from "@/components/ModelSelector";
import { DateRangePicker } from "@/components/date-range-picker";
import type { DateRange } from "react-day-picker";
import { HowTrendsWorks } from "@/components/how-trends-works";
import type { DashboardView, Article, TrendSnapshot, TrendWatchlistItem } from "@shared/schema";

import {
  BarChart, Bar, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell, PieChart, Pie
} from "recharts";

interface CompetitiveMentionItem {
  date: string;
  competitor: string;
  count: number;
}

interface NewsCategory {
  id: number;
  name: string;
  color_bg: string;
  color_text: string;
}

interface DashboardConfig {
  dateRange: string;
  category: string;
  selectedCompetitors: string[];
  selectedTopics: string[];
}

interface TrendItem {
  name: string;
  description: string;
  category: string;
  momentum: "rising" | "stable" | "declining";
  confidence: number;
  articleIds: number[];
}

interface EmergingSignal {
  name: string;
  description: string;
  category: string;
}

interface CompanySentimentItem {
  company: string;
  sentiment: number;
  label: "positive" | "negative" | "neutral" | "mixed";
  trending: "improving" | "declining" | "stable";
  reason: string;
}

interface ParsedSnapshot {
  id: number;
  trends: TrendItem[];
  emergingSignals: EmergingSignal[];
  companySentiment: CompanySentimentItem[];
  articleCount: number;
  days: number;
  model: string | null;
  createdAt: string;
}

const DATE_RANGES = [
  { label: "7 days", value: "7" },
  { label: "30 days", value: "30" },
  { label: "90 days", value: "90" },
];

const CHART_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

const CATEGORY_COLORS: Record<string, string> = {
  "AI & Automation": "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
  "Sales Strategy": "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  "MarTech Stack": "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  "Data & Privacy": "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300",
  "Buyer Behavior": "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  "Revenue Operations": "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300",
  "Competitive Landscape": "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
  "Content & Personalization": "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300",
};

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatTimestamp(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" }) +
    " " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function formatSnapshotLabel(snap: { createdAt: string; days: number; model: string | null }): string {
  const endDate = new Date(snap.createdAt);
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - snap.days);
  const fmt = (d: Date) =>
    `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(-2)}`;
  const range = `${fmt(startDate)}-${fmt(endDate)}`;
  if (snap.model && MODEL_DISPLAY[snap.model]) {
    return `${range} - ${MODEL_DISPLAY[snap.model].label}`;
  }
  return range;
}

function safeJsonParse(str: string | null | undefined, fallback: any[] = []): any {
  try {
    return JSON.parse(str || "[]") || fallback;
  } catch {
    return fallback;
  }
}

function parseSnapshot(snap: TrendSnapshot): ParsedSnapshot {
  return {
    id: snap.id,
    trends: safeJsonParse(snap.trends),
    emergingSignals: safeJsonParse(snap.emergingSignals),
    companySentiment: safeJsonParse(snap.companySentiment),
    articleCount: snap.articleCount,
    days: snap.days,
    model: snap.model,
    createdAt: snap.createdAt as unknown as string,
  };
}

function MomentumIcon({ momentum }: { momentum: string }) {
  if (momentum === "rising") return <ArrowUpRight className="h-3.5 w-3.5 text-emerald-500" />;
  if (momentum === "declining") return <ArrowDownRight className="h-3.5 w-3.5 text-red-500" />;
  return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
}

function TrendingIcon({ trending }: { trending: string }) {
  if (trending === "improving") return <ArrowUpRight className="h-3 w-3 text-emerald-500" />;
  if (trending === "declining") return <ArrowDownRight className="h-3 w-3 text-red-500" />;
  return <Minus className="h-3 w-3 text-muted-foreground" />;
}

function TrendCard({ trend, onDrillDown, isWatched, onWatch }: {
  trend: TrendItem;
  onDrillDown: () => void;
  isWatched?: boolean;
  onWatch?: (trend: TrendItem) => void;
}) {
  const catColor = CATEGORY_COLORS[trend.category] || "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
  const confidencePct = Math.round(trend.confidence * 100);
  const idSuffix = trend.name.slice(0, 20).replace(/\s+/g, "-").toLowerCase();

  return (
    <Card className={`p-4 hover:shadow-md transition-shadow ${isWatched ? "ring-1 ring-amber-300 dark:ring-amber-700" : ""}`} data-testid={`card-trend-${trend.name.slice(0, 20)}`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5">
          <MomentumIcon momentum={trend.momentum} />
          <span className="text-xs font-medium capitalize text-muted-foreground">
            {trend.momentum}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Badge className={`text-[10px] px-1.5 py-0 ${catColor}`}>
            {trend.category}
          </Badge>
          {onWatch && (
            <Button
              variant="ghost"
              size="sm"
              className={`px-1.5 ${isWatched ? "text-amber-500" : "text-muted-foreground"}`}
              onClick={() => onWatch(trend)}
              aria-label={isWatched ? "Remove trend from watchlist" : "Add trend to watchlist"}
              data-testid={`button-watch-trend-${trend.name.slice(0, 20)}`}
            >
              {isWatched ? <BookmarkCheck className="h-3.5 w-3.5" /> : <Bookmark className="h-3.5 w-3.5" />}
            </Button>
          )}
        </div>
      </div>
      <h4 className="text-sm font-semibold text-foreground leading-tight mb-1.5">
        {trend.name}
      </h4>
      <p className="text-xs text-muted-foreground leading-relaxed mb-3">
        {trend.description}
      </p>
      <div className="flex items-center justify-between gap-1 flex-wrap">
        <div className="flex items-center gap-2">
          <div
            className="h-1.5 w-16 bg-muted rounded-full overflow-hidden"
            role="progressbar"
            aria-valuenow={confidencePct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Confidence"
          >
            <div
              className="h-full bg-primary rounded-full transition-all"
              style={{ width: `${confidencePct}%` }}
            />
          </div>
          <span className="text-[10px] text-muted-foreground">{confidencePct}%</span>
        </div>
        <div className="flex items-center gap-1">
          {trend.articleIds && trend.articleIds.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-[10px] px-2"
              onClick={onDrillDown}
              data-testid={`button-drilldown-${trend.name.slice(0, 20)}`}
            >
              <FileText className="h-3 w-3 mr-1" />
              {trend.articleIds.length} articles
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

function ArticleDrilldownDialog({
  open,
  onClose,
  articleIds,
  trendName,
}: {
  open: boolean;
  onClose: () => void;
  articleIds: number[];
  trendName: string;
}) {
  const articlesQuery = useQuery<{ articles: Article[] }>({
    queryKey: ["/api/articles/by-ids", articleIds],
    queryFn: async () => {
      const res = await fetch("/api/articles/by-ids", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: articleIds }),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch articles");
      return res.json();
    },
    enabled: open && articleIds.length > 0,
  });

  const matchedArticles = articlesQuery.data?.articles || [];

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <FileText className="h-4 w-4" />
            Supporting Articles
          </DialogTitle>
          <p className="text-xs text-muted-foreground mt-1">{trendName}</p>
        </DialogHeader>
        <div className="flex-1 overflow-auto space-y-2">
          {articlesQuery.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : matchedArticles.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No matching articles found.
            </p>
          ) : (
            matchedArticles.map((article) => (
              <Card key={article.id} className="p-3" data-testid={`card-drill-article-${article.id}`}>
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-medium text-foreground leading-tight line-clamp-2">
                      {article.title}
                    </h4>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {article.category && (
                        <Badge variant="secondary" className="text-[10px]">
                          {article.category}
                        </Badge>
                      )}
                      {article.sourceName && (
                        <span className="text-[10px] text-muted-foreground">
                          {article.sourceName}
                        </span>
                      )}
                      {article.publishedAt && (
                        <span className="text-[10px] text-muted-foreground">
                          {new Date(article.publishedAt).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                  {article.link && (
                    <a href={article.link} target="_blank" rel="noopener noreferrer" data-testid={`link-article-${article.id}`}>
                      <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Open article in new tab">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Button>
                    </a>
                  )}
                </div>
              </Card>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CompanySentimentChart({ data }: { data: CompanySentimentItem[] }) {
  if (!data || data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-32 text-center">
        <Building2 className="h-8 w-8 text-muted-foreground/40 mb-2" />
        <p className="text-sm text-muted-foreground">No company sentiment data available</p>
      </div>
    );
  }

  const sorted = [...data].sort((a, b) => b.sentiment - a.sentiment);
  const chartData = sorted.map(c => ({
    company: c.company,
    sentiment: parseFloat(c.sentiment.toFixed(2)),
    label: c.label,
    trending: c.trending,
    reason: c.reason,
  }));

  return (
    <div className="space-y-3">
      <div className="h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} layout="vertical" margin={{ left: 10, right: 30 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" horizontal={false} />
            <XAxis
              type="number"
              domain={[-1, 1]}
              tick={{ fontSize: 10 }}
              tickFormatter={(v) => v.toFixed(1)}
            />
            <YAxis
              dataKey="company"
              type="category"
              tick={{ fontSize: 10 }}
              width={100}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.[0]) return null;
                const d = payload[0].payload;
                return (
                  <div className="rounded-md bg-background border border-border p-2 shadow-md text-xs max-w-[250px]">
                    <p className="font-semibold">{d.company}</p>
                    <p className="text-muted-foreground mt-0.5">Sentiment: {d.sentiment > 0 ? "+" : ""}{d.sentiment}</p>
                    <p className="text-muted-foreground">Trending: {d.trending}</p>
                    <p className="text-muted-foreground mt-1">{d.reason}</p>
                  </div>
                );
              }}
            />
            <Bar dataKey="sentiment" radius={[0, 4, 4, 0]}>
              {chartData.map((entry, i) => (
                <Cell
                  key={i}
                  fill={entry.sentiment >= 0 ? "hsl(142, 71%, 45%)" : "hsl(0, 72%, 51%)"}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap gap-2">
        {sorted.map((c) => (
          <div key={c.company} className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <TrendingIcon trending={c.trending} />
            <span>{c.company}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CompetitiveIntelChart({
  data,
  selectedCompetitors,
  onToggleCompetitor,
}: {
  data: CompetitiveMentionItem[];
  selectedCompetitors: string[];
  onToggleCompetitor: (c: string) => void;
}) {
  const allCompetitors = useMemo(
    () => Array.from(new Set(data.map((d) => d.competitor))),
    [data]
  );

  const active = selectedCompetitors.length > 0
    ? selectedCompetitors
    : allCompetitors.slice(0, 5);

  const chartData = useMemo(() => {
    const filtered = data.filter((d) => active.includes(d.competitor));
    const byDate: Record<string, Record<string, number>> = {};

    for (const item of filtered) {
      if (!byDate[item.date]) byDate[item.date] = {};
      byDate[item.date][item.competitor] = item.count;
    }

    return Object.keys(byDate)
      .sort()
      .map((date) => ({
        date,
        dateLabel: formatDate(date),
        ...byDate[date],
      }));
  }, [data, active]);

  if (allCompetitors.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-center">
        <Building2 className="h-8 w-8 text-muted-foreground/40 mb-2" />
        <p className="text-sm text-muted-foreground">
          No competitors configured. Add competitors in the Sources page.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {allCompetitors.map((comp) => (
          <Badge
            key={comp}
            variant={active.includes(comp) ? "default" : "secondary"}
            className="cursor-pointer"
            role="button"
            tabIndex={0}
            aria-pressed={active.includes(comp)}
            onClick={() => onToggleCompetitor(comp)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onToggleCompetitor(comp);
              }
            }}
            data-testid={`badge-competitor-${comp}`}
          >
            {comp}
          </Badge>
        ))}
      </div>

      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
            <XAxis dataKey="dateLabel" tick={{ fontSize: 10 }} />
            <YAxis
              tick={{ fontSize: 10 }}
              label={{ value: "Mentions", angle: -90, position: "insideLeft", style: { fontSize: 11, fill: "hsl(var(--muted-foreground))" } }}
            />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                return (
                  <div className="rounded-md bg-background border border-border p-2 shadow-md text-xs">
                    <p className="font-semibold mb-1">{label}</p>
                    {payload.map((p: any) => (
                      <div key={p.dataKey} className="flex items-center gap-2">
                        <div className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
                        <span>{p.dataKey}: {p.value} mentions</span>
                      </div>
                    ))}
                  </div>
                );
              }}
            />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            {active.map((comp, i) => (
              <Line
                key={comp}
                type="monotone"
                dataKey={comp}
                stroke={CHART_COLORS[i % CHART_COLORS.length]}
                strokeWidth={2}
                dot={{ r: 2 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

interface DemandbaseMentionsData {
  byDate: Array<{ date: string; count: number }>;
  byCategory: Array<{ category: string; count: number }>;
  total: number;
  topArticles: Article[];
}

const DB_CATEGORY_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

function DemandbaseIntelChart({ data }: { data: DemandbaseMentionsData }) {
  const chartData = useMemo(() =>
    data.byDate.map(d => ({ ...d, dateLabel: formatDate(d.date) })),
    [data.byDate]
  );

  if (data.total === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-center">
        <Building2 className="h-8 w-8 text-muted-foreground/40 mb-2" />
        <p className="text-sm text-muted-foreground">
          No Demandbase mentions found in this time period.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-lg border border-border p-3 text-center">
          <p className="text-2xl font-bold text-primary" data-testid="text-db-total-mentions">{data.total}</p>
          <p className="text-xs text-muted-foreground">Total Mentions</p>
        </div>
        <div className="rounded-lg border border-border p-3 text-center">
          <p className="text-2xl font-bold text-foreground" data-testid="text-db-days-active">{data.byDate.length}</p>
          <p className="text-xs text-muted-foreground">Days with Coverage</p>
        </div>
        <div className="rounded-lg border border-border p-3 text-center">
          <p className="text-2xl font-bold text-foreground" data-testid="text-db-avg-per-day">
            {data.byDate.length > 0 ? (data.total / data.byDate.length).toFixed(1) : "0"}
          </p>
          <p className="text-xs text-muted-foreground">Avg. per Day</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2">
          <p className="text-xs font-medium text-muted-foreground mb-2">Mentions Over Time</p>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
                <XAxis dataKey="dateLabel" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    return (
                      <div className="rounded-md bg-background border border-border p-2 shadow-md text-xs">
                        <p className="font-semibold mb-1">{label}</p>
                        <p>{payload[0].value} mentions</p>
                      </div>
                    );
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="count"
                  stroke="hsl(217, 91%, 60%)"
                  fill="hsl(217, 91%, 60%)"
                  fillOpacity={0.15}
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2">By Category</p>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data.byCategory}
                  dataKey="count"
                  nameKey="category"
                  cx="50%"
                  cy="50%"
                  outerRadius={70}
                  innerRadius={40}
                  paddingAngle={2}
                >
                  {data.byCategory.map((_, i) => (
                    <Cell key={i} fill={DB_CATEGORY_COLORS[i % DB_CATEGORY_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload;
                    return (
                      <div className="rounded-md bg-background border border-border p-2 shadow-md text-xs">
                        <p className="font-semibold">{d.category}</p>
                        <p>{d.count} articles</p>
                      </div>
                    );
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-1 mt-1">
            {data.byCategory.slice(0, 5).map((c, i) => (
              <div key={c.category} className="flex items-center gap-1.5 text-[10px]">
                <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: DB_CATEGORY_COLORS[i % DB_CATEGORY_COLORS.length] }} />
                <span className="text-muted-foreground truncate">{c.category}</span>
                <span className="ml-auto font-medium">{c.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {data.topArticles.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2">Recent Articles Mentioning Demandbase</p>
          <div className="space-y-1.5">
            {data.topArticles.slice(0, 5).map(article => (
              <a
                key={article.id}
                href={article.link}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start gap-2 p-2 rounded-md border border-border hover:bg-muted/50 transition-colors group"
                data-testid={`link-db-article-${article.id}`}
              >
                <ExternalLink className="h-3 w-3 mt-0.5 text-muted-foreground shrink-0 group-hover:text-primary" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground line-clamp-1">{article.title}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {article.sourceName && (
                      <span className="text-[10px] text-muted-foreground">{article.sourceName}</span>
                    )}
                    {article.publishedAt && (
                      <span className="text-[10px] text-muted-foreground">{formatDate(typeof article.publishedAt === "string" ? article.publishedAt : new Date(article.publishedAt).toISOString())}</span>
                    )}
                  </div>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SaveViewDialog({
  open,
  onClose,
  onSave,
  currentConfig,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (name: string) => void;
  currentConfig: DashboardConfig;
}) {
  const [name, setName] = useState("");

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Save Dashboard View</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            placeholder="View name..."
            aria-label="View name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            data-testid="input-view-name"
          />
          <p className="text-xs text-muted-foreground">
            Saves current filters: {currentConfig.dateRange}d range
            {currentConfig.category !== "all" && `, ${currentConfig.category}`}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => {
                if (name.trim()) {
                  onSave(name.trim());
                  setName("");
                }
              }}
              disabled={!name.trim()}
              data-testid="button-confirm-save-view"
            >
              <Save className="h-3.5 w-3.5 mr-1.5" />
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface WatchlistHistoryEntry {
  snapshotId: number;
  date: string;
  momentum: string;
  confidence: number;
  articleCount: number;
  description: string;
  days: number;
}

function WatchlistItemCard({ item, onRemove, onUpdate }: {
  item: TrendWatchlistItem;
  onRemove: (id: number) => void;
  onUpdate: (id: number, data: Partial<TrendWatchlistItem>) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notes, setNotes] = useState(item.notes || "");
  const catColor = CATEGORY_COLORS[item.category || ""] || "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";

  const historyQuery = useQuery<{ item: TrendWatchlistItem; history: WatchlistHistoryEntry[] }>({
    queryKey: [`/api/trends/watchlist/${item.id}/history`],
    enabled: expanded,
  });

  const history = historyQuery.data?.history || [];
  const latestEntry = history[0];

  return (
    <Card className="p-4" data-testid={`card-watchlist-${item.id}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <BookmarkCheck className="h-4 w-4 text-amber-500 flex-shrink-0" />
            <h4 className="text-sm font-semibold truncate">{item.trendName}</h4>
            {item.category && <Badge className={`text-[10px] px-1.5 py-0 ${catColor}`}>{item.category}</Badge>}
            {!item.isActive && <Badge variant="outline" className="text-[10px]">Paused</Badge>}
          </div>
          {latestEntry && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <MomentumIcon momentum={latestEntry.momentum as any} />
              <span className="capitalize">{latestEntry.momentum}</span>
              <span>|</span>
              <span>{Math.round(latestEntry.confidence * 100)}% confidence</span>
              <span>|</span>
              <span>{latestEntry.articleCount} articles</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setExpanded(!expanded)}
            aria-label={expanded ? "Collapse watched trend" : "Expand watched trend"}
            data-testid={`button-expand-watchlist-${item.id}`}
          >
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </Button>
          <ConfirmDestructive
            title={`Stop watching "${item.trendName}"?`}
            description="The trend is removed from your watchlist along with your notes and its tracked history view. This can't be undone."
            confirmLabel="Remove"
            onConfirm={() => onRemove(item.id)}
          >
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-destructive"
              aria-label="Remove from watchlist"
              data-testid={`button-remove-watchlist-${item.id}`}
            >
              <X className="h-4 w-4" />
            </Button>
          </ConfirmDestructive>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 space-y-3 border-t pt-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              Tracking since {new Date(item.createdAt!).toLocaleDateString()}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-[10px] ml-auto"
              onClick={() => onUpdate(item.id, { isActive: !item.isActive })}
              data-testid={`button-toggle-active-${item.id}`}
            >
              {item.isActive ? "Pause Tracking" : "Resume Tracking"}
            </Button>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium">Notes</span>
              {!editingNotes && (
                <Button variant="ghost" size="sm" className="h-5 text-[10px] px-1" onClick={() => setEditingNotes(true)}>
                  Edit
                </Button>
              )}
            </div>
            {editingNotes ? (
              <div className="flex gap-2">
                <Input
                  className="flex-1 text-xs h-7"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Add notes about why you're tracking this trend..."
                  aria-label="Watchlist notes"
                  data-testid={`input-notes-${item.id}`}
                />
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => { onUpdate(item.id, { notes }); setEditingNotes(false); }}
                  data-testid={`button-save-notes-${item.id}`}
                >
                  Save
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">{item.notes || "No notes yet"}</p>
            )}
          </div>

          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <History className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-medium">Snapshot History</span>
            </div>
            {historyQuery.isLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                <Loader2 className="h-3 w-3 animate-spin" />
                Loading history...
              </div>
            ) : historyQuery.isError ? (
              <p className="text-xs text-destructive py-2">
                Failed to load history. Try collapsing and expanding again.
              </p>
            ) : history.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">
                No matching snapshots found yet. Generate more snapshots to see how this trend evolves.
              </p>
            ) : (
              <div className="space-y-2">
                {history.map((entry, i) => (
                  <div key={entry.snapshotId} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs py-1.5 px-2 rounded bg-muted/50">
                    <span className="text-muted-foreground w-20 flex-shrink-0">
                      {new Date(entry.date).toLocaleDateString()}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <MomentumIcon momentum={entry.momentum as any} />
                      <span className="capitalize">{entry.momentum}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <div
                        className="h-1.5 w-10 bg-muted rounded-full overflow-hidden"
                        role="progressbar"
                        aria-valuenow={Math.round(entry.confidence * 100)}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label="Confidence"
                      >
                        <div className="h-full bg-primary rounded-full" style={{ width: `${Math.round(entry.confidence * 100)}%` }} />
                      </div>
                      <span className="text-muted-foreground">{Math.round(entry.confidence * 100)}%</span>
                    </div>
                    <span className="text-muted-foreground whitespace-nowrap">{entry.articleCount} articles</span>
                    <Badge variant="outline" className="text-[10px] ml-auto">{entry.days}d</Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

function WatchlistTab({ watchlist, isLoading, onRemove, onUpdate }: {
  watchlist: TrendWatchlistItem[];
  isLoading: boolean;
  onRemove: (id: number) => void;
  onUpdate: (id: number, data: Partial<TrendWatchlistItem>) => void;
}) {
  if (isLoading) {
    return (
      <div className="space-y-3 max-w-3xl mx-auto">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} className="p-4">
            <Skeleton className="h-5 w-2/3 mb-2" />
            <Skeleton className="h-4 w-1/2" />
          </Card>
        ))}
      </div>
    );
  }

  if (watchlist.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center px-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30 mb-4">
          <Bookmark className="h-8 w-8 text-amber-500" />
        </div>
        <h2 className="text-base font-semibold mb-1" data-testid="text-empty-watchlist">
          No Watched Trends
        </h2>
        <p className="text-sm text-muted-foreground max-w-md">
          Click the bookmark icon on any trend in the Dashboard tab to start tracking it.
          You'll see how its momentum and confidence change across snapshots over time.
        </p>
      </div>
    );
  }

  const active = watchlist.filter(w => w.isActive);
  const paused = watchlist.filter(w => !w.isActive);

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <div className="flex items-center gap-2 mb-2">
        <Eye className="h-4 w-4 text-amber-500" />
        <span className="text-sm font-medium">Tracking {active.length} trend{active.length !== 1 ? "s" : ""}</span>
        {paused.length > 0 && (
          <span className="text-xs text-muted-foreground">({paused.length} paused)</span>
        )}
      </div>

      {active.map(item => (
        <WatchlistItemCard key={item.id} item={item} onRemove={onRemove} onUpdate={onUpdate} />
      ))}
      {paused.length > 0 && (
        <>
          <div className="text-xs text-muted-foreground font-medium uppercase tracking-wider pt-2">
            Paused
          </div>
          {paused.map(item => (
            <WatchlistItemCard key={item.id} item={item} onRemove={onRemove} onUpdate={onUpdate} />
          ))}
        </>
      )}
    </div>
  );
}

export default function Trends() {
  const { toast } = useToast();
  const [selectedModel, setSelectedModel] = useSelectedModel("selectedModel-trends");
  const [activeTab, setActiveTab] = useState<"dashboard" | "watchlist">("dashboard");
  const [dateRange, setDateRange] = useState("30");
  const [customDateRange, setCustomDateRange] = useState<DateRange | undefined>();
  const [category, setCategory] = useState("all");
  const [selectedCompetitors, setSelectedCompetitors] = useState<string[]>([]);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [activeViewId, setActiveViewId] = useState<number | null>(null);
  const [snapshotDays, setSnapshotDays] = useState("30");
  const [trendsExpanded, setTrendsExpanded] = useState(true);
  const [signalsExpanded, setSignalsExpanded] = useState(true);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<number | null>(null);
  const [drilldownTrend, setDrilldownTrend] = useState<TrendItem | null>(null);
  const [categoryFilter, setCategoryFilter] = useState("all");

  const categoriesQuery = useQuery<NewsCategory[]>({
    queryKey: ["/api/news-categories"],
  });

  const competitiveQueryUrl = useMemo(() => {
    const params = new URLSearchParams({ days: dateRange });
    if (dateRange === "custom" && customDateRange?.from && customDateRange?.to) {
      params.set("dateFrom", customDateRange.from.toISOString().split("T")[0]);
      params.set("dateTo", customDateRange.to.toISOString().split("T")[0]);
    }
    return `/api/analytics/competitive-mentions?${params.toString()}`;
  }, [dateRange, customDateRange]);

  const competitiveQuery = useQuery<CompetitiveMentionItem[]>({
    queryKey: [competitiveQueryUrl],
  });

  const demandbaseQueryUrl = useMemo(() => {
    const params = new URLSearchParams({ days: dateRange });
    if (dateRange === "custom" && customDateRange?.from && customDateRange?.to) {
      params.set("dateFrom", customDateRange.from.toISOString().split("T")[0]);
      params.set("dateTo", customDateRange.to.toISOString().split("T")[0]);
    }
    return `/api/analytics/demandbase-mentions?${params.toString()}`;
  }, [dateRange, customDateRange]);

  const demandbaseQuery = useQuery<DemandbaseMentionsData>({
    queryKey: [demandbaseQueryUrl],
  });

  const viewsQuery = useQuery<DashboardView[]>({
    queryKey: ["/api/dashboard-views"],
  });

  const snapshotsQuery = useQuery<TrendSnapshot[]>({
    queryKey: ["/api/trends/snapshots"],
  });

  const watchlistQuery = useQuery<TrendWatchlistItem[]>({
    queryKey: ["/api/trends/watchlist"],
  });

  const watchedNames = useMemo(() => {
    return new Set((watchlistQuery.data || []).map(w => w.trendName.toLowerCase()));
  }, [watchlistQuery.data]);

  const addToWatchlistMutation = useMutation({
    mutationFn: async (data: { trendName: string; category: string; firstSeenSnapshotId?: number }) => {
      const res = await apiRequest("POST", "/api/trends/watchlist", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trends/watchlist"] });
      toast({ title: "Added to watchlist", description: "This trend will be tracked across future snapshots." });
    },
    onError: () => {
      toast({ title: "Failed to add", variant: "destructive" });
    },
  });

  const removeFromWatchlistMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/trends/watchlist/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trends/watchlist"] });
      toast({ title: "Removed from watchlist" });
    },
    onError: () => {
      toast({ title: "Couldn't remove from watchlist", description: "The removal failed. Try again.", variant: "destructive" });
    },
  });

  const updateWatchlistMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<TrendWatchlistItem> }) => {
      const res = await apiRequest("PATCH", `/api/trends/watchlist/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trends/watchlist"] });
    },
    onError: () => {
      toast({ title: "Couldn't update watchlist item", description: "The update failed. Try again.", variant: "destructive" });
    },
  });

  const parsedSnapshots = useMemo(() => {
    if (!snapshotsQuery.data) return [];
    return snapshotsQuery.data.map(parseSnapshot);
  }, [snapshotsQuery.data]);

  const activeSnapshot = useMemo(() => {
    if (selectedSnapshotId !== null) {
      return parsedSnapshots.find(s => s.id === selectedSnapshotId) || parsedSnapshots[0] || null;
    }
    return parsedSnapshots[0] || null;
  }, [parsedSnapshots, selectedSnapshotId]);

  const handleWatchTrend = useCallback((trend: TrendItem) => {
    const existing = (watchlistQuery.data || []).find(w => w.trendName.toLowerCase() === trend.name.toLowerCase());
    if (existing) {
      removeFromWatchlistMutation.mutate(existing.id);
    } else {
      addToWatchlistMutation.mutate({
        trendName: trend.name,
        category: trend.category,
        firstSeenSnapshotId: activeSnapshot?.id,
      });
    }
  }, [watchlistQuery.data, activeSnapshot, addToWatchlistMutation, removeFromWatchlistMutation]);

  const filteredTrends = useMemo(() => {
    if (!activeSnapshot) return [];
    if (categoryFilter === "all") return activeSnapshot.trends;
    return activeSnapshot.trends.filter(t => t.category === categoryFilter);
  }, [activeSnapshot, categoryFilter]);

  const availableCategories = useMemo(() => {
    if (!activeSnapshot) return [];
    return Array.from(new Set(activeSnapshot.trends.map(t => t.category))).sort();
  }, [activeSnapshot]);

  const generateSnapshotMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/trends/generate-snapshot", {
        model: selectedModel,
        days: parseInt(snapshotDays),
      });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/trends/snapshots"] });
      toast({
        title: "Trend snapshot generated",
        description: `Analyzed ${data.articleCount} articles from the last ${data.days} days.`,
      });
    },
    onError: (err: any) => {
      toast({
        title: "Snapshot generation failed",
        description: err.message || "Could not generate trend snapshot.",
        variant: "destructive",
      });
    },
  });

  const deleteSnapshotMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/trends/snapshots/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trends/snapshots"] });
      setSelectedSnapshotId(null);
      toast({ title: "Snapshot deleted" });
    },
    onError: () => {
      toast({ title: "Delete failed", variant: "destructive" });
    },
  });

  const saveViewMutation = useMutation({
    mutationFn: async (name: string) => {
      const config: DashboardConfig = { dateRange, category, selectedCompetitors, selectedTopics: [] };
      const res = await apiRequest("POST", "/api/dashboard-views", {
        name,
        config: JSON.stringify(config),
        isDefault: false,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard-views"] });
      setSaveDialogOpen(false);
      toast({ title: "View saved" });
    },
    onError: () => {
      toast({ title: "Failed to save view", variant: "destructive" });
    },
  });

  const deleteViewMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/dashboard-views/${id}`);
      return id;
    },
    onSuccess: (id: number) => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard-views"] });
      setActiveViewId(prev => (prev === id ? null : prev));
      toast({ title: "View deleted" });
    },
    onError: () => {
      toast({ title: "Couldn't delete view", description: "The delete failed. Try again.", variant: "destructive" });
    },
  });

  const loadView = useCallback((view: DashboardView) => {
    try {
      const config: DashboardConfig = JSON.parse(view.config);
      if (config.dateRange) setDateRange(config.dateRange);
      if (config.category) setCategory(config.category);
      if (config.selectedCompetitors) setSelectedCompetitors(config.selectedCompetitors);
      setActiveViewId(view.id);
      toast({ title: `Loaded "${view.name}"` });
    } catch {
      toast({ title: "Failed to load view config", variant: "destructive" });
    }
  }, [toast]);

  const handleToggleCompetitor = useCallback((comp: string) => {
    setSelectedCompetitors((prev) =>
      prev.includes(comp) ? prev.filter((c) => c !== comp) : [...prev, comp]
    );
  }, []);

  const categories = categoriesQuery.data || [];
  const views = viewsQuery.data || [];

  return (
    <div className="flex flex-col h-full">
      <div className="border-b p-4">
        <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
          <div>
            <h1 className="text-lg font-semibold flex items-center gap-2" data-testid="text-trends-title">
              <TrendingUp className="h-5 w-5 text-primary" />
              Trends & Analytics
            </h1>
            <p className="text-xs text-muted-foreground">
              AI-powered trend snapshots and competitive intelligence
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <ModelSelector value={selectedModel} onChange={setSelectedModel} compact />
          </div>
        </div>

        <Tabs
          value={activeTab}
          onValueChange={(val) => setActiveTab(val as "dashboard" | "watchlist")}
        >
          <TabsList>
            <TabsTrigger value="dashboard" data-testid="button-tab-dashboard">
              <BarChart3 className="h-4 w-4 mr-1.5" />
              Dashboard
            </TabsTrigger>
            <TabsTrigger value="watchlist" data-testid="button-tab-watchlist">
              <Bookmark className="h-4 w-4 mr-1.5" />
              Watchlist {(watchlistQuery.data?.length || 0) > 0 ? `(${watchlistQuery.data?.length})` : ""}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {!snapshotsQuery.isLoading && (
          <div className="max-w-5xl mx-auto mb-4">
            <HowTrendsWorks defaultOpen={(snapshotsQuery.data?.length || 0) === 0} />
          </div>
        )}
        {activeTab === "watchlist" ? (
          <WatchlistTab
            watchlist={watchlistQuery.data || []}
            isLoading={watchlistQuery.isLoading}
            onRemove={(id) => removeFromWatchlistMutation.mutate(id)}
            onUpdate={(id, data) => updateWatchlistMutation.mutate({ id, data })}
          />
        ) : (
          <div className="space-y-4 max-w-5xl mx-auto">
            <Card className="p-4">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <Sparkles className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium">Generate Trend Snapshot</span>
                  <Select value={snapshotDays} onValueChange={setSnapshotDays}>
                    <SelectTrigger className="w-28" data-testid="select-snapshot-days">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DATE_RANGES.map((r) => (
                        <SelectItem key={r.value} value={r.value}>
                          {r.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    onClick={() => generateSnapshotMutation.mutate()}
                    disabled={generateSnapshotMutation.isPending}
                    size="sm"
                    data-testid="button-generate-snapshot"
                  >
                    <RefreshCw className={`h-4 w-4 mr-1.5 ${generateSnapshotMutation.isPending ? "animate-spin" : ""}`} />
                    {generateSnapshotMutation.isPending ? "Analyzing..." : "Generate"}
                  </Button>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {availableCategories.length > 0 && (
                    <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                      <SelectTrigger className="w-48" data-testid="select-trend-category">
                        <SelectValue placeholder="Filter by category" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Categories</SelectItem>
                        {availableCategories.map((cat) => (
                          <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>
            </Card>

            {generateSnapshotMutation.isPending && (
              <Card className="p-6">
                <div className="flex flex-col items-center justify-center text-center">
                  <RefreshCw className="h-8 w-8 text-primary animate-spin mb-3" />
                  <h3 className="text-sm font-semibold mb-1">Analyzing articles...</h3>
                  <p className="text-xs text-muted-foreground">
                    This may take 30-60 seconds depending on the number of articles.
                  </p>
                </div>
              </Card>
            )}

            {!generateSnapshotMutation.isPending && activeSnapshot && (
              <>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setTrendsExpanded(prev => !prev)}
                      aria-label={trendsExpanded ? "Collapse market trends" : "Expand market trends"}
                      data-testid="button-collapse-trends"
                    >
                      {trendsExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </Button>
                    <h3 className="text-sm font-semibold flex items-center gap-1.5">
                      <Target className="h-4 w-4 text-primary" />
                      Market Trends
                    </h3>
                    <Badge variant="secondary" className="text-[10px]">
                      {activeSnapshot.articleCount} articles / {activeSnapshot.days}d
                    </Badge>
                    {activeSnapshot.model && MODEL_DISPLAY[activeSnapshot.model] && (
                      <span className={`text-[10px] font-medium ${MODEL_DISPLAY[activeSnapshot.model].color}`}>
                        {MODEL_DISPLAY[activeSnapshot.model].label}
                      </span>
                    )}
                    <span className="text-[10px] text-muted-foreground">
                      {formatTimestamp(activeSnapshot.createdAt)}
                    </span>
                  </div>
                  {trendsExpanded && (
                    <div className="flex items-center gap-1">
                      {parsedSnapshots.length > 1 && (
                        <Select
                          value={selectedSnapshotId?.toString() || activeSnapshot.id.toString()}
                          onValueChange={(val) => setSelectedSnapshotId(parseInt(val))}
                        >
                          <SelectTrigger className="w-64" data-testid="select-snapshot-history">
                            <History className="h-3.5 w-3.5 mr-1.5 shrink-0" />
                            <SelectValue placeholder="History" />
                          </SelectTrigger>
                          <SelectContent>
                            {parsedSnapshots.map((snap) => (
                              <SelectItem key={snap.id} value={snap.id.toString()}>
                                <span className="text-xs">{formatSnapshotLabel(snap)}</span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                      <ConfirmDestructive
                        title={`Delete snapshot from ${formatTimestamp(activeSnapshot.createdAt)}?`}
                        description="This trend snapshot — its trends, emerging signals, and company sentiment — is permanently deleted, and watched trends lose this point in their history. This can't be undone."
                        onConfirm={() => deleteSnapshotMutation.mutate(activeSnapshot.id)}
                      >
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          aria-label="Delete snapshot"
                          data-testid="button-delete-snapshot"
                        >
                          <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                      </ConfirmDestructive>
                    </div>
                  )}
                </div>

                {trendsExpanded && (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {filteredTrends.map((trend, i) => (
                      <TrendCard
                        key={i}
                        trend={trend}
                        onDrillDown={() => setDrilldownTrend(trend)}
                        isWatched={watchedNames.has(trend.name.toLowerCase())}
                        onWatch={handleWatchTrend}
                      />
                    ))}
                  </div>
                )}

                {activeSnapshot.emergingSignals.length > 0 && (
                  <Card className="p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setSignalsExpanded(prev => !prev)}
                        aria-label={signalsExpanded ? "Collapse emerging signals" : "Expand emerging signals"}
                        data-testid="button-collapse-signals"
                      >
                        {signalsExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </Button>
                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                      <h3 className="text-sm font-semibold">Emerging Signals</h3>
                      <Badge variant="secondary" className="text-[10px]">Early Detection</Badge>
                    </div>
                    {signalsExpanded && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                        {activeSnapshot.emergingSignals.map((signal, i) => {
                          const catColor = CATEGORY_COLORS[signal.category] || "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
                          return (
                            <div key={i} className="rounded-lg border border-border p-3" data-testid={`card-signal-${i}`}>
                              <div className="flex items-start gap-2">
                                <Sparkles className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
                                <div className="flex-1 min-w-0">
                                  <h4 className="text-xs font-semibold text-foreground leading-tight mb-1">
                                    {signal.name}
                                  </h4>
                                  <p className="text-xs text-muted-foreground leading-relaxed">
                                    {signal.description}
                                  </p>
                                  <div className="flex items-center justify-between gap-2 mt-1.5">
                                    <Badge className={`text-[10px] px-1 py-0 ${catColor}`}>
                                      {signal.category}
                                    </Badge>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </Card>
                )}

                <Card className="p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Building2 className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-semibold">Company Sentiment</h3>
                    <Badge variant="secondary" className="text-[10px]">Coverage Analysis</Badge>
                  </div>
                  <CompanySentimentChart data={activeSnapshot.companySentiment} />
                </Card>
              </>
            )}

            {!generateSnapshotMutation.isPending && !activeSnapshot && (
              <Card className="p-8">
                <div className="flex flex-col items-center justify-center text-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 mb-4">
                    <Sparkles className="h-8 w-8 text-primary" />
                  </div>
                  <h2 className="text-base font-semibold mb-1" data-testid="text-no-snapshots">
                    No Trend Snapshots Yet
                  </h2>
                  <p className="text-sm text-muted-foreground mb-6 max-w-md">
                    Generate an AI-powered trend snapshot to see meaningful B2B marketing and sales technology trends, company sentiment, and emerging signals.
                  </p>
                  <Button
                    onClick={() => generateSnapshotMutation.mutate()}
                    disabled={generateSnapshotMutation.isPending}
                    data-testid="button-generate-snapshot-empty"
                  >
                    <Sparkles className="h-4 w-4 mr-1.5" />
                    Generate First Snapshot
                  </Button>
                </div>
              </Card>
            )}

            <Card className="p-4">
              <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-semibold" data-testid="text-competitive-heading">
                    Competitive Intelligence
                  </h3>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                  <Select value={dateRange} onValueChange={(val) => {
                    setDateRange(val);
                    if (val !== "custom") setCustomDateRange(undefined);
                  }}>
                    <SelectTrigger className="w-28" data-testid="select-date-range">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[...DATE_RANGES, { label: "6 months", value: "180" }, { label: "1 year", value: "365" }].map((r) => (
                        <SelectItem key={r.value} value={r.value}>
                          {r.label}
                        </SelectItem>
                      ))}
                      <SelectItem value="custom">Custom Range</SelectItem>
                    </SelectContent>
                  </Select>
                  {dateRange === "custom" && (
                    <DateRangePicker
                      dateRange={customDateRange}
                      onDateRangeChange={(range) => setCustomDateRange(range ? { from: range.from, to: range.to } : undefined)}
                    />
                  )}

                  {views.length > 0 && (
                    <Select
                      value={activeViewId !== null ? activeViewId.toString() : ""}
                      onValueChange={(val) => {
                        const view = views.find((v) => v.id.toString() === val);
                        if (view) loadView(view);
                      }}
                    >
                      <SelectTrigger className="w-36" data-testid="select-saved-view">
                        <Eye className="h-3.5 w-3.5 mr-1.5 shrink-0" />
                        <SelectValue placeholder="Saved Views" />
                      </SelectTrigger>
                      <SelectContent>
                        {views.map((view) => (
                          <SelectItem key={view.id} value={view.id.toString()}>
                            {view.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSaveDialogOpen(true)}
                    data-testid="button-save-view"
                  >
                    <Save className="h-3.5 w-3.5 mr-1.5" />
                    Save
                  </Button>

                  {views.length > 0 && (() => {
                    const activeView = views.find((v) => v.id === activeViewId);
                    return (
                      <ConfirmDestructive
                        title={`Delete view "${activeView?.name ?? ""}"?`}
                        description="This saved dashboard view and its filter configuration are permanently deleted. This can't be undone."
                        onConfirm={() => {
                          if (activeView) deleteViewMutation.mutate(activeView.id);
                        }}
                      >
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          disabled={!activeView || deleteViewMutation.isPending}
                          aria-label="Delete current view"
                          title={activeView ? `Delete view "${activeView.name}"` : "Select a saved view to delete it"}
                          data-testid="button-delete-view"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </ConfirmDestructive>
                    );
                  })()}
                </div>
              </div>
              {competitiveQuery.isLoading ? (
                <Skeleton className="h-64 w-full" />
              ) : (
                <CompetitiveIntelChart
                  data={competitiveQuery.data || []}
                  selectedCompetitors={selectedCompetitors}
                  onToggleCompetitor={handleToggleCompetitor}
                />
              )}
            </Card>

            <Card className="p-4" data-testid="card-demandbase-intel">
              <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-blue-500" />
                  <h3 className="text-sm font-semibold">Demandbase Intelligence</h3>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                  <Select value={dateRange} onValueChange={(val) => {
                    setDateRange(val);
                    if (val !== "custom") setCustomDateRange(undefined);
                  }}>
                    <SelectTrigger className="w-28" data-testid="select-db-date-range">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[...DATE_RANGES, { label: "6 months", value: "180" }, { label: "1 year", value: "365" }].map((r) => (
                        <SelectItem key={r.value} value={r.value}>
                          {r.label}
                        </SelectItem>
                      ))}
                      <SelectItem value="custom">Custom Range</SelectItem>
                    </SelectContent>
                  </Select>
                  {dateRange === "custom" && (
                    <DateRangePicker
                      dateRange={customDateRange}
                      onDateRangeChange={(range) => setCustomDateRange(range ? { from: range.from, to: range.to } : undefined)}
                    />
                  )}
                </div>
              </div>
              {demandbaseQuery.isLoading ? (
                <Skeleton className="h-64 w-full" />
              ) : (
                <DemandbaseIntelChart
                  data={demandbaseQuery.data || { byDate: [], byCategory: [], total: 0, topArticles: [] }}
                />
              )}
            </Card>
          </div>
        )}
      </div>

      {drilldownTrend && (
        <ArticleDrilldownDialog
          open={!!drilldownTrend}
          onClose={() => setDrilldownTrend(null)}
          articleIds={drilldownTrend.articleIds}
          trendName={drilldownTrend.name}
        />
      )}

      <SaveViewDialog
        open={saveDialogOpen}
        onClose={() => setSaveDialogOpen(false)}
        onSave={(name) => saveViewMutation.mutate(name)}
        currentConfig={{ dateRange, category, selectedCompetitors, selectedTopics: [] }}
      />
    </div>
  );
}
