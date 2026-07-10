import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useEffect, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ExternalLink, Search, Clock, User, RefreshCw, Zap, Newspaper, X, Filter, ThumbsDown, AlertTriangle, Ban, XCircle, Building2, RefreshCcw } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Article } from "@shared/schema";
import { DateRangePicker } from "@/components/date-range-picker";
import type { DateRange } from "react-day-picker";
import { format } from "date-fns";

function formatTimeAgo(date: string | Date | null): string {
  if (!date) return "Recently";
  const now = new Date();
  const then = new Date(date);
  const diffMs = now.getTime() - then.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return then.toLocaleDateString();
}

const categoryColors: Record<string, string> = {
  "GTM Tech": "bg-blue-50 text-blue-700 ring-1 ring-blue-600/10 dark:bg-blue-500/10 dark:text-blue-400 dark:ring-blue-400/20",
  "AI": "bg-violet-50 text-violet-700 ring-1 ring-violet-600/10 dark:bg-violet-500/10 dark:text-violet-400 dark:ring-violet-400/20",
  "B2B Mktg & Sales": "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/10 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-400/20",
  "Technology": "bg-amber-50 text-amber-700 ring-1 ring-amber-600/10 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-400/20",
  "CRM & Enterprise": "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-600/10 dark:bg-indigo-500/10 dark:text-indigo-400 dark:ring-indigo-400/20",
  "Data & Analytics": "bg-cyan-50 text-cyan-700 ring-1 ring-cyan-600/10 dark:bg-cyan-500/10 dark:text-cyan-400 dark:ring-cyan-400/20",
  "Industry Analysts": "bg-slate-50 text-slate-700 ring-1 ring-slate-600/10 dark:bg-slate-500/10 dark:text-slate-400 dark:ring-slate-400/20",
  "Deals & Markets": "bg-teal-50 text-teal-700 ring-1 ring-teal-600/10 dark:bg-teal-500/10 dark:text-teal-400 dark:ring-teal-400/20",
  "Company Tracker": "bg-sky-50 text-sky-700 ring-1 ring-sky-600/10 dark:bg-sky-500/10 dark:text-sky-400 dark:ring-sky-400/20",
};

function ArticleCard({ article, onDismiss }: { article: Article; onDismiss: (id: number) => void }) {
  const catClass = categoryColors[article.category || ""] || "bg-muted text-muted-foreground";

  return (
    <div className="group relative">
      <a
        href={article.link}
        target="_blank"
        rel="noopener noreferrer"
        className="block"
        data-testid={`link-article-${article.id}`}
      >
        <Card className="p-3.5 md:p-4 cursor-pointer transition-all duration-200 border-border/50 hover:border-border hover:shadow-sm dark:hover:border-border">
          <div className="flex flex-col gap-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  {article.category && (
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold ${catClass}`} data-testid={`badge-category-${article.id}`}>
                      {article.category}
                    </span>
                  )}
                  {article.sourceName && (
                    <span className="text-[11px] text-muted-foreground font-medium" data-testid={`text-source-${article.id}`}>
                      {article.sourceName}
                    </span>
                  )}
                </div>
                <h3 className="text-[13px] font-semibold leading-snug line-clamp-2 tracking-tight" data-testid={`text-title-${article.id}`}>
                  {article.title}
                </h3>
              </div>
              <ExternalLink className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0 mt-1 group-hover:text-muted-foreground transition-colors" />
            </div>
            {article.description && (
              <p className="text-xs text-muted-foreground/80 line-clamp-2 leading-relaxed" data-testid={`text-desc-${article.id}`}>
                {article.description.replace(/<[^>]*>/g, '').substring(0, 200)}
              </p>
            )}
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {formatTimeAgo(article.publishedAt)}
              </span>
              {article.author && (
                <span className="inline-flex items-center gap-1">
                  <User className="h-3 w-3" />
                  <span className="truncate max-w-[120px]">{article.author}</span>
                </span>
              )}
            </div>
          </div>
        </Card>
      </a>
      <button
        className="absolute bottom-2.5 right-2.5 p-1.5 rounded-lg bg-background/90 backdrop-blur-sm border border-border/40 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100 transition-all duration-200 hover:bg-destructive/10 hover:border-destructive/30 hover:text-destructive z-10"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onDismiss(article.id);
        }}
        aria-label="Not relevant — dismiss this article"
        title="Not relevant"
        data-testid={`button-dismiss-${article.id}`}
      >
        <ThumbsDown className="h-3 w-3" />
      </button>
    </div>
  );
}

function ArticleSkeleton() {
  return (
    <Card className="p-4 border-card-border">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Skeleton className="h-5 w-16 rounded" />
          <Skeleton className="h-4 w-24" />
        </div>
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-full" />
        <div className="flex items-center gap-3">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-20" />
        </div>
      </div>
    </Card>
  );
}

export default function NewsFeed() {
  const [activeTab, setActiveTab] = useState<"news" | "company">("news");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedSource, setSelectedSource] = useState<string>("all");
  const [selectedDateRange, setSelectedDateRange] = useState<string>("all");
  const [customDateRange, setCustomDateRange] = useState<DateRange | undefined>();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const feedStatusQuery = useQuery<{ lastFetchedAt: string | null }>({
    queryKey: ["/api/fetch-feeds/status"],
    staleTime: 30000,
    refetchInterval: 60000,
  });

  const refreshMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/fetch-feeds");
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/articles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/articles/filters"] });
      queryClient.invalidateQueries({ queryKey: ["/api/fetch-feeds/status"] });
      if (data.total > 0) {
        toast({ title: "Feeds refreshed", description: `${data.total} new article${data.total === 1 ? "" : "s"} found.` });
      } else {
        toast({ title: "Feeds up to date", description: "No new articles found." });
      }
    },
    onError: () => {
      toast({ title: "Refresh failed", description: "Could not refresh feeds. Try again.", variant: "destructive" });
    },
  });

  const filtersQuery = useQuery<{ categories: string[]; sources: string[]; sourcesByCategory: Record<string, string[]> }>({
    queryKey: ["/api/articles/filters"],
    staleTime: 300000,
  });

  const tabCategories = useMemo(() => {
    if (!filtersQuery.data) return [];
    if (activeTab === "company") return ["Company Tracker"];
    return filtersQuery.data.categories.filter(c => c !== "Company Tracker");
  }, [filtersQuery.data, activeTab]);

  const tabSources = useMemo(() => {
    if (!filtersQuery.data) return [];
    if (activeTab === "company") return filtersQuery.data.sourcesByCategory["Company Tracker"] || [];
    return filtersQuery.data.sources.filter(s => !(filtersQuery.data!.sourcesByCategory["Company Tracker"] || []).includes(s));
  }, [filtersQuery.data, activeTab]);

  const filteredSources = useMemo(() => {
    if (selectedCategory === "all") return tabSources;
    return filtersQuery.data?.sourcesByCategory[selectedCategory] || [];
  }, [filtersQuery.data, selectedCategory, tabSources]);

  const effectiveSearch = debouncedQuery.length > 2 ? debouncedQuery : "";

  const hasActiveFilters = effectiveSearch.length > 0 ||
    selectedCategory !== "all" ||
    selectedSource !== "all" ||
    selectedDateRange !== "all";

  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    if (effectiveSearch) params.set("q", effectiveSearch);
    if (activeTab === "company") {
      params.set("category", selectedCategory !== "all" ? selectedCategory : "Company Tracker");
    } else {
      if (selectedCategory !== "all") params.set("category", selectedCategory);
      params.set("excludeCategory", "Company Tracker");
    }
    if (selectedSource !== "all") params.set("source", selectedSource);
    if (selectedDateRange === "custom" && customDateRange?.from && customDateRange?.to) {
      params.set("dateRange", "custom");
      params.set("dateFrom", format(customDateRange.from, "yyyy-MM-dd"));
      params.set("dateTo", format(customDateRange.to, "yyyy-MM-dd"));
    } else if (selectedDateRange !== "all") {
      params.set("dateRange", selectedDateRange);
    }
    params.set("limit", "50");
    return params.toString();
  }, [effectiveSearch, selectedCategory, selectedSource, selectedDateRange, customDateRange, activeTab]);

  const articlesQuery = useQuery<{ articles: Article[]; total: number }>({
    queryKey: ["/api/articles", queryParams],
    queryFn: async () => {
      const res = await fetch(`/api/articles?${queryParams}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch articles");
      return res.json();
    },
    staleTime: 60000,
  });

  const seedMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/seed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/articles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sources"] });
      queryClient.invalidateQueries({ queryKey: ["/api/articles/filters"] });
      toast({ title: "Data loaded", description: "News sources and articles have been fetched." });
    },
    onError: () => {
      toast({ title: "Couldn't load news sources", description: "Seeding failed. Check your connection and try again.", variant: "destructive" });
    },
  });

  const [dismissedIds, setDismissedIds] = useState<Set<number>>(() => {
    try {
      const stored = sessionStorage.getItem("ignored-recommendations");
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch {
      return new Set();
    }
  });

  const patternsQuery = useQuery<{
    patterns: { sources: Record<string, number>; categories: Record<string, number>; total: number };
    recommendations: Array<{ sourceName: string; sourceId: number | null; dismissedCount: number; isActive: boolean }>;
  }>({
    queryKey: ["/api/articles/dismissal-patterns"],
    staleTime: 60000,
  });

  const dismissMutation = useMutation({
    mutationFn: async (articleId: number) => {
      await apiRequest("POST", `/api/articles/${articleId}/dismiss`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/articles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/articles/dismissal-patterns"] });
      toast({ title: "Article dismissed", description: "This article has been removed from your feed." });
    },
    onError: () => {
      toast({ title: "Failed to dismiss", variant: "destructive" });
    },
  });

  const disableSourceMutation = useMutation({
    mutationFn: async (sourceId: number) => {
      await apiRequest("PATCH", `/api/sources/${sourceId}`, { isActive: false });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/articles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/articles/dismissal-patterns"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sources"] });
      toast({ title: "Source disabled", description: "This source will no longer fetch new articles." });
    },
    onError: () => {
      toast({ title: "Failed to disable source", variant: "destructive" });
    },
  });

  const activeFilterCount = [
    selectedCategory !== "all",
    selectedSource !== "all",
    selectedDateRange !== "all",
  ].filter(Boolean).length;

  const clearFilters = () => {
    setSearchQuery("");
    setDebouncedQuery("");
    setSelectedCategory("all");
    setSelectedSource("all");
    setSelectedDateRange("all");
    setCustomDateRange(undefined);
  };

  const articles = articlesQuery.data?.articles || [];
  const totalCount = articlesQuery.data?.total || 0;
  const isLoading = articlesQuery.isLoading;
  const isEmpty = !isLoading && articles.length === 0 && !hasActiveFilters;

  const handleTabSwitch = (tab: "news" | "company") => {
    setActiveTab(tab);
    setSelectedCategory("all");
    setSelectedSource("all");
    setSearchQuery("");
    setDebouncedQuery("");
  };

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-border/60 p-3 md:p-4 space-y-2.5 md:space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <h1 className="text-lg font-semibold tracking-tight" data-testid="text-page-title">News Feed</h1>
            <Badge variant="secondary" className="shrink-0 text-[10px] md:text-xs font-semibold rounded-full px-2.5" data-testid="badge-article-count">
              {hasActiveFilters ? `${totalCount} results` : `${totalCount}`}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            {feedStatusQuery.data?.lastFetchedAt && (
              <span className="text-[10px] text-muted-foreground hidden md:inline font-medium" data-testid="text-last-updated">
                Updated {formatTimeAgo(feedStatusQuery.data.lastFetchedAt)}
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2.5 text-xs rounded-lg border-border/50"
              onClick={() => refreshMutation.mutate()}
              disabled={refreshMutation.isPending}
              data-testid="button-refresh-feeds"
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
              {refreshMutation.isPending ? "Refreshing..." : "Refresh"}
            </Button>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={(val) => handleTabSwitch(val as "news" | "company")} className="w-fit">
          <TabsList className="h-8 md:h-9" data-testid="tabs-feed-view">
            <TabsTrigger value="news" className="text-xs font-medium" data-testid="button-tab-news">
              <Newspaper className="h-3.5 w-3.5 mr-1" />
              News
            </TabsTrigger>
            <TabsTrigger value="company" className="text-xs font-medium" data-testid="button-tab-company">
              <Building2 className="h-3.5 w-3.5 mr-1" />
              Company Tracking
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50" />
            <Input
              type="search"
              placeholder={activeTab === "company" ? "Search company articles..." : "Search articles..."}
              aria-label={activeTab === "company" ? "Search company articles" : "Search articles"}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-8 text-sm rounded-lg border-border/50 bg-muted/30 focus:bg-background transition-colors"
              data-testid="input-search"
            />
          </div>
          <Button
            variant={filtersOpen || hasActiveFilters ? "secondary" : "outline"}
            size="sm"
            className="h-8 px-2.5 md:hidden shrink-0 text-xs"
            onClick={() => setFiltersOpen(!filtersOpen)}
            data-testid="button-toggle-filters"
          >
            <Filter className="h-3.5 w-3.5 mr-1" />
            Filters
            {activeFilterCount > 0 && (
              <span className="ml-1 text-[10px] bg-primary text-primary-foreground rounded-full w-4 h-4 flex items-center justify-center">{activeFilterCount}</span>
            )}
          </Button>
        </div>
        <div className={`${filtersOpen ? "flex" : "hidden"} md:flex items-center gap-2 flex-wrap`}>
          <div className="hidden md:flex items-center gap-1 text-xs text-muted-foreground">
            <Filter className="h-3.5 w-3.5" />
            <span>Filters:</span>
          </div>
          {activeTab === "news" && (
            <Select value={selectedCategory} onValueChange={(val) => { setSelectedCategory(val); setSelectedSource("all"); }}>
              <SelectTrigger className="h-8 w-auto min-w-[130px] text-xs" data-testid="select-filter-category">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {tabCategories.map((cat) => (
                  <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {activeTab === "company" ? (
            <Select value={selectedSource} onValueChange={setSelectedSource}>
              <SelectTrigger className="h-8 w-auto min-w-[130px] text-xs" data-testid="select-filter-company">
                <SelectValue placeholder="Company" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Companies</SelectItem>
                {filteredSources.map((src) => (
                  <SelectItem key={src} value={src}>{src.replace(/^Company - /, "")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Select value={selectedSource} onValueChange={setSelectedSource}>
              <SelectTrigger className="h-8 w-auto min-w-[130px] text-xs" data-testid="select-filter-source">
                <SelectValue placeholder="Source" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sources</SelectItem>
                {filteredSources.map((src) => (
                  <SelectItem key={src} value={src}>{src}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select value={selectedDateRange} onValueChange={(val) => {
            setSelectedDateRange(val);
            if (val !== "custom") setCustomDateRange(undefined);
          }}>
            <SelectTrigger className="h-8 w-auto min-w-[100px] text-xs" data-testid="select-filter-date">
              <SelectValue placeholder="Date" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Time</SelectItem>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="week">Past Week</SelectItem>
              <SelectItem value="month">Past Month</SelectItem>
              <SelectItem value="custom">Custom Range</SelectItem>
            </SelectContent>
          </Select>
          {selectedDateRange === "custom" && (
            <DateRangePicker
              dateRange={customDateRange}
              onDateRangeChange={setCustomDateRange}
            />
          )}
          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs"
              onClick={clearFilters}
              data-testid="button-clear-filters"
            >
              <X className="h-3.5 w-3.5 mr-1" />
              Clear{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
            </Button>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-auto p-3 md:p-4">
        {patternsQuery.data?.recommendations && patternsQuery.data.recommendations.filter(r => !dismissedIds.has(r.sourceId!)).length > 0 && (
          <div className="mb-4 space-y-2" data-testid="section-recommendations">
            {patternsQuery.data.recommendations.filter(r => !dismissedIds.has(r.sourceId!)).map((rec) => (
              <div
                key={rec.sourceId}
                className="flex items-center gap-3 p-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30"
                data-testid={`recommendation-${rec.sourceId}`}
              >
                <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-amber-900 dark:text-amber-200" data-testid={`text-rec-source-${rec.sourceId}`}>
                    "{rec.sourceName}" has {rec.dismissedCount} dismissed articles
                  </p>
                  <p className="text-xs text-amber-700 dark:text-amber-400/70" data-testid={`text-rec-detail-${rec.sourceId}`}>
                    This source may be producing irrelevant content. Disable it to stop fetching new articles.
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs"
                    onClick={() => rec.sourceId && disableSourceMutation.mutate(rec.sourceId)}
                    disabled={disableSourceMutation.isPending}
                    data-testid={`button-disable-source-${rec.sourceId}`}
                  >
                    <Ban className="h-3 w-3 mr-1" />
                    Disable
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs"
                    onClick={() => {
                      const newSet = new Set([...dismissedIds, rec.sourceId!]);
                      setDismissedIds(newSet);
                      try { sessionStorage.setItem("ignored-recommendations", JSON.stringify([...newSet])); } catch {}
                    }}
                    data-testid={`button-ignore-rec-${rec.sourceId}`}
                  >
                    Ignore
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
              <Newspaper className="h-8 w-8 text-muted-foreground" />
            </div>
            <h2 className="text-base font-semibold mb-1" data-testid="text-empty-state">No articles yet</h2>
            <p className="text-sm text-muted-foreground mb-4 max-w-sm">
              Load news from your configured B2B MarTech sources to get started.
            </p>
            <Button
              onClick={() => seedMutation.mutate()}
              disabled={seedMutation.isPending}
              data-testid="button-load-news"
            >
              <Zap className="mr-2 h-4 w-4" />
              {seedMutation.isPending ? "Loading..." : "Load News Sources"}
            </Button>
          </div>
        ) : isLoading ? (
          <div className="grid gap-2 md:gap-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <ArticleSkeleton key={i} />
            ))}
          </div>
        ) : (
          <div className="grid gap-2 md:gap-3">
            {articles.map((article) => (
              <ArticleCard key={article.id} article={article} onDismiss={(id) => dismissMutation.mutate(id)} />
            ))}
            {hasActiveFilters && articles.length === 0 && (
              <div className="text-center py-8">
                <p className="text-sm text-muted-foreground" data-testid="text-no-results">
                  No articles match your filters
                </p>
                <Button
                  variant="link"
                  size="sm"
                  className="mt-2"
                  onClick={clearFilters}
                  data-testid="button-clear-filters-empty"
                >
                  Clear all filters
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
