import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ExternalLink, Globe, Clock, Rss, BookOpen, Plus, Newspaper, CheckCircle, AlertCircle, Brain, Loader2, Search, X, Trash2, RefreshCw, Upload, FileText, Edit, FolderPlus, Settings, GripVertical, Building2, Shield, ChevronDown, ChevronRight, Check, Pencil, Eye, AlertTriangle, Filter, ShieldAlert, Sparkles, MessageSquare, CheckCircle2, CornerDownRight } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Source, PendingKnowledge, KnowledgeEntry } from "@shared/schema";

// KnowledgeEntry rows never carry `sourceFilename` (that field lives only on
// PendingKnowledge in shared/schema.ts). Some call sites optionally read it
// off entries anyway; this type reflects that optional/absent shape without
// widening KnowledgeEntry itself.
type KnowledgeEntryWithFilename = KnowledgeEntry & { sourceFilename?: string };
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useState, useMemo, useCallback } from "react";
import { VoiceInputButton } from "@/components/VoiceInputButton";
import { GoogleDrivePickerButton } from "@/components/google-drive-picker";
import { ConfirmDestructive } from "@/components/confirm-destructive";

type NewsCategory = { id: number; name: string; colorBg: string; colorText: string; sortOrder: number };

function formatDate(date: string | Date | null): string {
  if (!date) return "Never";
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const categoryIcons: Record<string, string> = {
  "GTM Tech": "bg-blue-100 dark:bg-blue-900/30",
  "AI": "bg-purple-100 dark:bg-purple-900/30",
  "B2B Mktg & Sales": "bg-green-100 dark:bg-green-900/30",
  "Technology": "bg-orange-100 dark:bg-orange-900/30",
  "CRM & Enterprise": "bg-indigo-100 dark:bg-indigo-900/30",
  "Data & Analytics": "bg-sky-100 dark:bg-sky-900/30",
  "Industry Analysts": "bg-slate-100 dark:bg-slate-900/30",
  "Deals & Markets": "bg-emerald-100 dark:bg-emerald-900/30",
};


function SourceCard({ source }: { source: Source }) {
  const { toast } = useToast();
  const toggleMutation = useMutation({
    mutationFn: async (active: boolean) => {
      await apiRequest("PATCH", `/api/sources/${source.id}`, { isActive: active });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sources"] });
    },
    onError: () => {
      toast({ title: "Update failed", variant: "destructive" });
    },
  });

  const bgClass = categoryIcons[source.category] || "bg-muted";
  const isUploadedDoc = source.feedUrl?.startsWith("upload://");

  return (
    <Card className="p-4 border-card-border" data-testid={`card-source-${source.id}`}>
      <div className="flex items-start gap-4">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${bgClass}`}>
          {isUploadedDoc ? (
            <FileText className="h-5 w-5 text-foreground/70" />
          ) : (
            <Rss className="h-5 w-5 text-foreground/70" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="text-sm font-semibold" data-testid={`text-source-name-${source.id}`}>
                  {source.name}
                </h3>
                <Badge variant="secondary" className="text-[10px]">{source.category}</Badge>
                {isUploadedDoc && (
                  <Badge variant="outline" className="text-[10px]">Uploaded</Badge>
                )}
              </div>
              {source.description && (
                <p className="text-xs text-muted-foreground line-clamp-2 mb-2 leading-relaxed">
                  {source.description}
                </p>
              )}
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                {isUploadedDoc ? (
                  <span className="inline-flex items-center gap-1" data-testid={`text-source-file-${source.id}`}>
                    <FileText className="h-3 w-3" />
                    <span className="truncate max-w-[180px]">{source.feedUrl.replace("upload://", "")}</span>
                  </span>
                ) : (
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                    data-testid={`link-source-url-${source.id}`}
                  >
                    <Globe className="h-3 w-3" />
                    <span className="truncate max-w-[180px]">{source.url.replace(/^https?:\/\//, '').replace(/\/$/, '')}</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {isUploadedDoc ? `Added: ${formatDate(source.createdAt)}` : `Last fetched: ${formatDate(source.lastFetchedAt)}`}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs text-muted-foreground">
                {source.isActive ? "Active" : "Paused"}
              </span>
              <Switch
                checked={source.isActive}
                onCheckedChange={(checked) => toggleMutation.mutate(checked)}
                data-testid={`switch-source-active-${source.id}`}
              />
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

function AddSourceDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [feedUrl, setFeedUrl] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const { toast } = useToast();
  const categoriesQuery = useQuery<NewsCategory[]>({ queryKey: ["/api/news-categories"] });
  const dynamicCategories = categoriesQuery.data || [];

  const createMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/sources", {
        name, url, feedUrl, category, description: description || null, isActive: true,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sources"] });
      setOpen(false);
      setName(""); setUrl(""); setFeedUrl(""); setCategory(""); setDescription("");
      toast({ title: "Source added", description: `${name} has been added to your sources.` });
    },
    onError: () => {
      toast({ title: "Failed to add source", variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button data-testid="button-add-source">
          <Plus className="mr-2 h-4 w-4" />
          Add Source
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add News Source</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="source-name">Name</Label>
            <div className="flex items-center gap-1">
              <Input id="source-name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. MarTech.org" data-testid="input-source-name" />
              <VoiceInputButton onTranscript={(text) => setName((prev) => prev ? prev + " " + text : text)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="source-url">Website URL</Label>
            <Input id="source-url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://example.com" data-testid="input-source-url" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="source-feed">RSS Feed URL</Label>
            <Input id="source-feed" value={feedUrl} onChange={e => setFeedUrl(e.target.value)} placeholder="https://example.com/feed/" data-testid="input-source-feed" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="source-category">Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger data-testid="select-source-category">
                <SelectValue placeholder="Select a category" />
              </SelectTrigger>
              <SelectContent>
                {dynamicCategories.map(cat => (
                  <SelectItem key={cat.id} value={cat.name}>{cat.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="source-desc">Description (optional)</Label>
            <div className="relative">
              <Textarea
                id="source-desc"
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Brief description of this source..."
                className="resize-none"
                data-testid="input-source-description"
              />
              <div className="absolute top-1.5 right-1.5">
                <VoiceInputButton onTranscript={(text) => setDescription((prev) => prev ? prev + " " + text : text)} />
              </div>
            </div>
          </div>
          <Button
            className="w-full"
            onClick={() => createMutation.mutate()}
            disabled={!name || !url || !feedUrl || !category || createMutation.isPending}
            data-testid="button-save-source"
          >
            {createMutation.isPending ? "Adding..." : "Add Source"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type NewsapiQueryItem = { id: number; query: string; category: string; isActive: boolean; createdAt: string };

function NewsAPIStatusCard() {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [newQuery, setNewQuery] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const statusQuery = useQuery<{ configured: boolean; queries: NewsapiQueryItem[] }>({
    queryKey: ["/api/newsapi/status"],
  });

  const addMutation = useMutation({
    mutationFn: async (data: { query: string; category: string }) => {
      const res = await apiRequest("POST", "/api/newsapi/queries", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/newsapi/status"] });
      setNewQuery("");
      setNewCategory("");
      setShowAdd(false);
      toast({ title: "Query added" });
    },
    onError: () => {
      toast({ title: "Failed to add query", variant: "destructive" });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: number; isActive: boolean }) => {
      await apiRequest("PATCH", `/api/newsapi/queries/${id}`, { isActive });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/newsapi/status"] });
    },
    onError: () => {
      toast({ title: "Failed to update query", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/newsapi/queries/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/newsapi/status"] });
      toast({ title: "Query removed" });
    },
    onError: () => {
      toast({ title: "Failed to remove query", variant: "destructive" });
    },
  });

  const status = statusQuery.data;
  if (!status) return null;

  const queries = status.queries || [];
  const activeCount = queries.filter(q => q.isActive).length;
  const filteredQueries = searchTerm
    ? queries.filter(q => q.query.toLowerCase().includes(searchTerm.toLowerCase()) || q.category.toLowerCase().includes(searchTerm.toLowerCase()))
    : queries;

  const groupedByCategory = filteredQueries.reduce<Record<string, NewsapiQueryItem[]>>((acc, q) => {
    if (!acc[q.category]) acc[q.category] = [];
    acc[q.category].push(q);
    return acc;
  }, {});

  const CATEGORY_OPTIONS = ["GTM Tech", "AI", "B2B Mktg & Sales", "CRM & Enterprise", "Data & Analytics", "Deals & Markets", "Industry Analysts", "Technology"];

  return (
    <Card className={`p-4 border-card-border ${status.configured ? "border-green-200 dark:border-green-800" : "border-amber-200 dark:border-amber-800"}`} data-testid="card-newsapi-status">
      <div className="flex items-start gap-4">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${status.configured ? "bg-green-100 dark:bg-green-900/30" : "bg-amber-100 dark:bg-amber-900/30"}`}>
          <Newspaper className="h-5 w-5 text-foreground/70" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-semibold">NewsAPI Integration</h3>
            {status.configured ? (
              <Badge variant="secondary" className="text-[10px] bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
                <CheckCircle className="h-3 w-3 mr-1" />
                Connected
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-[10px] bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                <AlertCircle className="h-3 w-3 mr-1" />
                Not Configured
              </Badge>
            )}
            <Badge variant="secondary" className="text-[10px]">
              {activeCount} / {queries.length} active
            </Badge>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 ml-auto"
              onClick={() => setExpanded(!expanded)}
              aria-label={expanded ? "Collapse NewsAPI queries" : "Expand NewsAPI queries"}
              data-testid="button-toggle-newsapi"
            >
              {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {status.configured
              ? `Fetching from ${activeCount} topic queries across thousands of news sources via NewsAPI.org.`
              : "Add a NEWSAPI_KEY secret to enable article fetching from thousands of additional news sources via NewsAPI.org (free tier: 100 requests/day)."}
          </p>

          {expanded && (
            <div className="mt-3 space-y-2">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                  <Input
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    placeholder="Search queries..."
                    aria-label="Search NewsAPI queries"
                    className="text-xs h-7 pl-7"
                    data-testid="input-newsapi-search"
                  />
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => setShowAdd(!showAdd)}
                  data-testid="button-newsapi-add"
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Add
                </Button>
              </div>

              {showAdd && (
                <div className="p-2.5 rounded-lg border bg-muted/30 space-y-2" data-testid="form-newsapi-add">
                  <Input
                    value={newQuery}
                    onChange={e => setNewQuery(e.target.value)}
                    placeholder="Search query (e.g. account-based marketing)"
                    aria-label="New NewsAPI query"
                    className="text-xs h-7"
                    data-testid="input-newsapi-new-query"
                    onKeyDown={e => {
                      if (e.key === "Enter" && newQuery.trim() && newCategory) {
                        addMutation.mutate({ query: newQuery.trim(), category: newCategory });
                      }
                    }}
                  />
                  <div className="flex gap-2">
                    <Select value={newCategory} onValueChange={setNewCategory}>
                      <SelectTrigger className="text-xs h-7 flex-1" data-testid="select-newsapi-category">
                        <SelectValue placeholder="Category" />
                      </SelectTrigger>
                      <SelectContent>
                        {CATEGORY_OPTIONS.map(cat => (
                          <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      variant="default"
                      className="h-7 text-xs"
                      disabled={!newQuery.trim() || !newCategory || addMutation.isPending}
                      onClick={() => addMutation.mutate({ query: newQuery.trim(), category: newCategory })}
                      data-testid="button-newsapi-save"
                    >
                      {addMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      onClick={() => { setShowAdd(false); setNewQuery(""); setNewCategory(""); }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {Object.entries(groupedByCategory).map(([category, items]) => (
                  <div key={category}>
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{category}</span>
                      <span className="text-[10px] text-muted-foreground">({items.length})</span>
                    </div>
                    <div className="space-y-0.5">
                      {items.map(q => (
                        <div
                          key={q.id}
                          className="flex items-center gap-2 py-1 px-2 rounded hover:bg-muted/50 group"
                          data-testid={`newsapi-query-${q.id}`}
                        >
                          <span className={`text-xs flex-1 truncate ${q.isActive ? "" : "text-muted-foreground line-through"}`}>
                            {q.query}
                          </span>
                          <Switch
                            checked={q.isActive}
                            onCheckedChange={(checked) => toggleMutation.mutate({ id: q.id, isActive: checked })}
                            className="scale-75"
                            data-testid={`switch-newsapi-${q.id}`}
                          />
                          <ConfirmDestructive
                            title={`Remove query "${q.query}"?`}
                            description="This NewsAPI topic query is permanently removed and will stop fetching new articles. This can't be undone."
                            confirmLabel="Remove"
                            onConfirm={() => deleteMutation.mutate(q.id)}
                          >
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-5 w-5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100 transition-opacity text-destructive"
                              aria-label={`Delete query ${q.query}`}
                              data-testid={`button-delete-newsapi-${q.id}`}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </ConfirmDestructive>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                {filteredQueries.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-2">
                    {searchTerm ? "No queries match your search." : "No queries configured."}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function EmbeddingStatusCard() {
  const { toast } = useToast();
  const statsQuery = useQuery<{ total: number; indexed: number; pending: number }>({
    queryKey: ["/api/embeddings/stats"],
  });

  const embedMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/embeddings/generate");
      return res.json();
    },
    onSuccess: (data: { updated: number }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/embeddings/stats"] });
      toast({
        title: "Search index updated",
        description: `Indexed ${data.updated} articles for AI search.`,
      });
    },
    onError: () => {
      toast({
        title: "Embedding failed",
        description: "Could not generate article embeddings. Try again later.",
        variant: "destructive",
      });
    },
  });

  const stats = statsQuery.data;
  if (!stats) return null;

  const allEmbedded = stats.pending === 0;
  const percentage = stats.total > 0 ? Math.round((stats.indexed / stats.total) * 100) : 0;

  return (
    <Card className={`p-4 border-card-border ${allEmbedded ? "border-green-200 dark:border-green-800" : "border-blue-200 dark:border-blue-800"}`} data-testid="card-embedding-status">
      <div className="flex items-start gap-4">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${allEmbedded ? "bg-green-100 dark:bg-green-900/30" : "bg-blue-100 dark:bg-blue-900/30"}`}>
          <Brain className="h-5 w-5 text-foreground/70" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-semibold">AI Knowledge Base</h3>
            {allEmbedded ? (
              <Badge variant="secondary" className="text-[10px] bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
                <CheckCircle className="h-3 w-3 mr-1" />
                {stats.indexed} articles indexed
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-[10px] bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
                {stats.indexed}/{stats.total} indexed
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed mb-2">
            {allEmbedded
              ? `All ${stats.total} articles are indexed for full-text search. The AI Analyst finds the most relevant articles for any question.`
              : `${stats.pending} articles need indexing. Index them so the AI Analyst can search all ${stats.total} articles.`}
          </p>
          {!allEmbedded && (
            <div className="space-y-2">
              <div className="w-full bg-muted rounded-full h-1.5">
                <div className="bg-blue-500 h-1.5 rounded-full transition-all" style={{ width: `${percentage}%` }} />
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => embedMutation.mutate()}
                disabled={embedMutation.isPending}
                data-testid="button-generate-embeddings"
              >
                {embedMutation.isPending ? (
                  <>
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    Indexing articles...
                  </>
                ) : (
                  <>
                    <Brain className="h-3 w-3 mr-1" />
                    Index {stats.pending} articles
                  </>
                )}
              </Button>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function TopicTracker({ sources }: { sources: Source[] }) {
  const [topic, setTopic] = useState("");
  const { toast } = useToast();
  const [pendingRefresh, setPendingRefresh] = useState(false);
  const [showCatManager, setShowCatManager] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [editingCat, setEditingCat] = useState<{ id: number; name: string } | null>(null);
  const [editCatName, setEditCatName] = useState("");

  const categoriesQuery = useQuery<NewsCategory[]>({ queryKey: ["/api/news-categories"] });
  const categories = categoriesQuery.data || [];

  const catBgMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of categories) map[c.name] = c.colorBg;
    return map;
  }, [categories]);

  const catTextMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of categories) map[c.name] = c.colorText;
    return map;
  }, [categories]);

  const googleNewsSources = sources.filter(s =>
    s.feedUrl.includes("news.google.com/rss/search") && !s.name.startsWith("Company - ")
  );

  const refreshFeedsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/fetch-feeds");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/articles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/articles/filters"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sources"] });
      setPendingRefresh(false);
      toast({ title: "Feeds refreshed", description: `Fetched ${data.total} new articles.` });
    },
    onError: () => {
      toast({ title: "Refresh failed", description: "Could not fetch latest news. Try again later.", variant: "destructive" });
    },
  });

  const addTopicMutation = useMutation({
    mutationFn: async () => {
      const trimmed = topic.trim();
      const classifyRes = await apiRequest("POST", "/api/classify-topic", { topic: trimmed });
      const { category } = await classifyRes.json();
      const encodedTopic = encodeURIComponent(trimmed).replace(/%20/g, "+");
      await apiRequest("POST", "/api/sources", {
        name: `Google News - ${trimmed}`,
        url: `https://news.google.com/search?q=${encodedTopic}`,
        feedUrl: `https://news.google.com/rss/search?q=${encodedTopic}&hl=en-US&gl=US&ceid=US:en`,
        category,
        description: `Google News tracking for "${trimmed}".`,
        isActive: true,
      });
      return { trimmed, category };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/sources"] });
      queryClient.invalidateQueries({ queryKey: ["/api/articles/filters"] });
      setPendingRefresh(true);
      toast({ title: "Topic added", description: `Now tracking "${data.trimmed}" in ${data.category}. Refresh feeds to pull in articles.` });
      setTopic("");
    },
    onError: () => {
      toast({ title: "Failed to add topic", variant: "destructive" });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/sources/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sources"] });
      toast({ title: "Topic removed" });
    },
    onError: () => {
      toast({ title: "Failed to remove topic", variant: "destructive" });
    },
  });

  const createCatMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("POST", "/api/news-categories", { name });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/news-categories"] });
      setNewCatName("");
      toast({ title: "Category created", description: `"${data.name}" added.` });
    },
    onError: (err: any) => {
      toast({ title: "Failed to create category", description: err?.message || "Try a different name.", variant: "destructive" });
    },
  });

  const renameCatMutation = useMutation({
    mutationFn: async ({ id, name }: { id: number; name: string }) => {
      const res = await apiRequest("PATCH", `/api/news-categories/${id}`, { name });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/news-categories"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sources"] });
      queryClient.invalidateQueries({ queryKey: ["/api/articles/filters"] });
      setEditingCat(null);
      setEditCatName("");
      toast({ title: "Category renamed" });
    },
    onError: (err: any) => {
      toast({ title: "Rename failed", description: err?.message || "Try a different name.", variant: "destructive" });
    },
  });

  const deleteCatMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/news-categories/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/news-categories"] });
      toast({ title: "Category deleted" });
    },
    onError: (err: any) => {
      toast({ title: "Cannot delete category", description: err?.message || "Remove sources first.", variant: "destructive" });
    },
  });

  const [selectedTopicId, setSelectedTopicId] = useState<number | null>(null);

  const changeCategoryMutation = useMutation({
    mutationFn: async ({ id, category }: { id: number; category: string }) => {
      await apiRequest("PATCH", `/api/sources/${id}`, { category });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sources"] });
      queryClient.invalidateQueries({ queryKey: ["/api/articles/filters"] });
      setPendingRefresh(true);
      setSelectedTopicId(null);
      toast({ title: "Topic moved", description: "Category updated. Refresh feeds to update articles." });
    },
    onError: () => {
      toast({ title: "Failed to move topic", variant: "destructive" });
    },
  });

  const handleTopicClick = useCallback((sourceId: number) => {
    if (changeCategoryMutation.isPending) return;
    setSelectedTopicId(prev => prev === sourceId ? null : sourceId);
  }, [changeCategoryMutation.isPending]);

  const handleCategoryClick = useCallback((targetCategory: string) => {
    if (selectedTopicId === null || changeCategoryMutation.isPending) return;
    const source = googleNewsSources.find(s => s.id === selectedTopicId);
    if (!source) {
      setSelectedTopicId(null);
      return;
    }
    if (source.category === targetCategory) {
      setSelectedTopicId(null);
      return;
    }
    changeCategoryMutation.mutate({ id: selectedTopicId, category: targetCategory });
  }, [selectedTopicId, googleNewsSources, changeCategoryMutation]);

  const extractTopic = (source: Source): string => {
    if (!source.name) return source.feedUrl || "Unknown";
    const prefix = "Google News - ";
    if (source.name.startsWith(prefix)) {
      return source.name.slice(prefix.length);
    }
    try {
      const url = new URL(source.feedUrl);
      const q = url.searchParams.get("q") || "";
      return decodeURIComponent(q.replace(/\+/g, " "));
    } catch {
      return source.name;
    }
  };

  const categoryOrder = useMemo(() => categories.map(c => c.name), [categories]);

  const groupedTopics = useMemo(() => {
    const groups: Record<string, typeof googleNewsSources> = {};
    for (const source of googleNewsSources) {
      const cat = source.category;
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(source);
    }
    const isSelecting = selectedTopicId !== null;
    const allCategories = isSelecting ? categoryOrder : categoryOrder.filter(cat => groups[cat]?.length);
    return allCategories
      .map(cat => ({ category: cat, sources: groups[cat] || [] }))
      .concat(
        Object.entries(groups)
          .filter(([cat]) => !categoryOrder.includes(cat))
          .map(([cat, srcs]) => ({ category: cat, sources: srcs }))
      );
  }, [googleNewsSources, selectedTopicId, categoryOrder]);

  return (
    <Card className="p-4 border-card-border border-purple-200 dark:border-purple-800" data-testid="card-topic-tracker">
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-purple-100 dark:bg-purple-900/30">
          <Search className="h-5 w-5 text-foreground/70" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-semibold">Topic Tracking</h3>
            <Badge variant="secondary" className="text-[10px] bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300">
              {googleNewsSources.length} topics across {groupedTopics.length} categories
            </Badge>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 ml-auto"
              onClick={() => setShowCatManager(!showCatManager)}
              aria-label="Manage categories"
              data-testid="button-manage-categories"
            >
              <Settings className="h-3.5 w-3.5" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed mb-3">
            Track any topic via Google News. AI auto-classifies into the right category.
          </p>

          {showCatManager && (
            <div className="mb-3 p-3 rounded-lg border bg-muted/30 space-y-2" data-testid="category-manager">
              <div className="flex items-center gap-2 mb-2">
                <FolderPlus className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-medium">Manage Categories</span>
              </div>
              <div className="flex gap-2 mb-2">
                <Input
                  value={newCatName}
                  onChange={e => setNewCatName(e.target.value)}
                  placeholder="New category name..."
                  aria-label="New category name"
                  className="text-xs h-7"
                  data-testid="input-new-category"
                  onKeyDown={e => {
                    if (e.key === "Enter" && newCatName.trim()) createCatMutation.mutate(newCatName.trim());
                  }}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => createCatMutation.mutate(newCatName.trim())}
                  disabled={!newCatName.trim() || createCatMutation.isPending}
                  data-testid="button-create-category"
                >
                  {createCatMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Add"}
                </Button>
              </div>
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {categories.map(cat => (
                  <div key={cat.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50 transition-colors" data-testid={`category-row-${cat.id}`}>
                    <div className={`h-2.5 w-2.5 rounded-full shrink-0 ${cat.colorBg}`} />
                    {editingCat?.id === cat.id ? (
                      <>
                        <Input
                          value={editCatName}
                          onChange={e => setEditCatName(e.target.value)}
                          className="text-xs h-6 flex-1"
                          aria-label="Rename category"
                          data-testid={`input-rename-category-${cat.id}`}
                          autoFocus
                          onKeyDown={e => {
                            if (e.key === "Enter" && editCatName.trim()) renameCatMutation.mutate({ id: cat.id, name: editCatName.trim() });
                            if (e.key === "Escape") { setEditingCat(null); setEditCatName(""); }
                          }}
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-xs text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-900/20"
                          onClick={() => renameCatMutation.mutate({ id: cat.id, name: editCatName.trim() })}
                          disabled={!editCatName.trim() || renameCatMutation.isPending}
                          data-testid={`button-save-rename-${cat.id}`}
                        >
                          {renameCatMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <><CheckCircle className="h-3 w-3 mr-1" />Save</>}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-xs"
                          onClick={() => { setEditingCat(null); setEditCatName(""); }}
                          data-testid={`button-cancel-rename-${cat.id}`}
                        >
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <>
                        <span className={`text-xs flex-1 font-medium ${cat.colorText}`}>{cat.name}</span>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
                          onClick={() => { setEditingCat(cat); setEditCatName(cat.name); }}
                          data-testid={`button-rename-category-${cat.id}`}
                        >
                          <Edit className="h-3 w-3 mr-1" />
                          Edit
                        </Button>
                        <ConfirmDestructive
                          title={`Delete category "${cat.name}"?`}
                          description="The category is permanently removed from topic tracking. Categories that still contain sources can't be deleted. This can't be undone."
                          onConfirm={() => deleteCatMutation.mutate(cat.id)}
                        >
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2 text-xs text-muted-foreground hover:text-destructive"
                            disabled={deleteCatMutation.isPending}
                            data-testid={`button-delete-category-${cat.id}`}
                          >
                            <Trash2 className="h-3 w-3 mr-1" />
                            Delete
                          </Button>
                        </ConfirmDestructive>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-2 mb-3">
            <Input
              value={topic}
              onChange={e => setTopic(e.target.value)}
              placeholder="e.g. Demandbase ABM, HubSpot CRM..."
              aria-label="Topic to track"
              className="text-sm"
              data-testid="input-topic"
              onKeyDown={e => {
                if (e.key === "Enter" && topic.trim()) addTopicMutation.mutate();
              }}
            />
            <VoiceInputButton onTranscript={(text) => setTopic((prev) => prev ? prev + " " + text : text)} />
            <Button
              size="sm"
              onClick={() => addTopicMutation.mutate()}
              disabled={!topic.trim() || addTopicMutation.isPending}
              aria-label="Add topic"
              data-testid="button-add-topic"
            >
              {addTopicMutation.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Plus className="h-3 w-3" />
              )}
            </Button>
          </div>

          {pendingRefresh && (
            <div className="flex items-center gap-2 mb-3 p-2.5 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30" data-testid="banner-pending-refresh">
              <RefreshCw className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
              <span className="text-xs text-blue-800 dark:text-blue-300 flex-1">
                Topics changed. Refresh feeds to pull in new articles.
              </span>
              <Button
                size="sm"
                variant="outline"
                className="text-xs"
                onClick={() => refreshFeedsMutation.mutate()}
                disabled={refreshFeedsMutation.isPending}
                data-testid="button-refresh-after-change"
              >
                {refreshFeedsMutation.isPending ? (
                  <>
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    Refreshing...
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-3 w-3 mr-1" />
                    Refresh Now
                  </>
                )}
              </Button>
            </div>
          )}

          {selectedTopicId !== null && (
            <div className="mb-2 p-2 rounded-lg bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 flex items-center gap-2">
              {changeCategoryMutation.isPending ? (
                <span className="text-xs text-purple-700 dark:text-purple-300 font-medium flex items-center gap-1.5">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Moving topic...
                </span>
              ) : (
                <>
                  <span className="text-xs text-purple-700 dark:text-purple-300 font-medium">
                    Click a category below to move the selected topic, or click the topic again to cancel.
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-5 px-1.5 text-xs text-muted-foreground"
                    onClick={() => setSelectedTopicId(null)}
                    data-testid="button-cancel-move"
                  >
                    <X className="h-3 w-3 mr-0.5" />
                    Cancel
                  </Button>
                </>
              )}
            </div>
          )}

          {groupedTopics.length > 0 && (
            <div className="space-y-1">
              {groupedTopics.map(({ category, sources: catSources }) => {
                const isSelecting = selectedTopicId !== null;
                const selectedSource = isSelecting ? googleNewsSources.find(s => s.id === selectedTopicId) : null;
                const isSourceCategory = selectedSource?.category === category;
                const isDropTarget = isSelecting && !isSourceCategory;
                return (
                  <div
                    key={category}
                    data-testid={`topic-group-${category}`}
                    onClick={() => isDropTarget ? handleCategoryClick(category) : undefined}
                    className={`rounded-lg p-2 -mx-2 transition-all duration-150 ${
                      isDropTarget
                        ? "bg-muted/30 ring-1 ring-dashed ring-purple-300 dark:ring-purple-700 cursor-pointer hover:bg-purple-100/60 dark:hover:bg-purple-900/20 hover:ring-2 hover:ring-purple-400 dark:hover:ring-purple-600"
                        : ""
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <div className={`h-2 w-2 rounded-full ${catBgMap[category] || "bg-gray-200"}`} />
                      <span className={`text-xs font-medium ${catTextMap[category] || "text-muted-foreground"}`}>
                        {category}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        ({catSources.length})
                      </span>
                      {isDropTarget && (
                        <span className="text-xs font-medium text-purple-600 dark:text-purple-400">Click to move here</span>
                      )}
                    </div>
                    <div className={`flex flex-wrap gap-1.5 pl-4 ${isSelecting ? "min-h-[36px]" : "min-h-[28px]"}`}>
                      {catSources.map(source => (
                        <div
                          key={source.id}
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isDropTarget && selectedTopicId !== null && selectedTopicId !== source.id) {
                              handleCategoryClick(category);
                            } else {
                              handleTopicClick(source.id);
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              e.stopPropagation();
                              if (isDropTarget && selectedTopicId !== null && selectedTopicId !== source.id) {
                                handleCategoryClick(category);
                              } else {
                                handleTopicClick(source.id);
                              }
                            }
                          }}
                          className={`group flex items-center gap-0.5 rounded-md pl-1 pr-2 py-1 text-xs cursor-pointer select-none transition-all ${
                            catBgMap[category] || "bg-muted/60"
                          } ${selectedTopicId === source.id ? "ring-2 ring-purple-500 dark:ring-purple-400 shadow-md scale-105" : ""} ${
                            !source.isActive ? "opacity-60" : ""
                          } hover:ring-1 hover:ring-purple-300 dark:hover:ring-purple-700`}
                          data-testid={`topic-tag-${source.id}`}
                        >
                          <GripVertical className="h-3 w-3 text-muted-foreground/50 shrink-0" />
                          <span className={source.isActive ? "text-foreground/80" : "text-muted-foreground line-through"}>
                            {extractTopic(source)}
                          </span>
                          {!isSelecting && (
                            <ConfirmDestructive
                              title={`Stop tracking "${extractTopic(source)}"?`}
                              description="The Google News source for this topic is permanently deleted and no new articles will be fetched for it. This can't be undone."
                              confirmLabel="Remove"
                              onConfirm={() => removeMutation.mutate(source.id)}
                            >
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-3.5 w-3.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                                disabled={removeMutation.isPending}
                                aria-label={`Remove topic ${extractTopic(source)}`}
                                data-testid={`button-remove-topic-${source.id}`}
                              >
                                <X className="h-2.5 w-2.5" />
                              </Button>
                            </ConfirmDestructive>
                          )}
                        </div>
                      ))}
                      {catSources.length === 0 && isSelecting && (
                        <div className={`flex items-center justify-center w-full rounded-md border border-dashed py-1.5 ${
                          isDropTarget ? "border-purple-400 bg-purple-50/50 dark:border-purple-600 dark:bg-purple-900/20" : "border-border/50"
                        }`}>
                          <span className={`text-xs italic ${isDropTarget ? "text-purple-600 dark:text-purple-400" : "text-muted-foreground"}`}>
                            Click to move here
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

type Competitor = { id: number; name: string; domain: string | null; notes: string | null; created_at: string };

function CompetitorManager() {
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [expanded, setExpanded] = useState(false);
  const { toast } = useToast();

  const competitorsQuery = useQuery<Competitor[]>({ queryKey: ["/api/competitors"] });
  const competitors = competitorsQuery.data || [];

  const sortedCompetitors = useMemo(() =>
    [...competitors].sort((a, b) => a.name.localeCompare(b.name)),
    [competitors]
  );

  const addMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/competitors", {
        name: name.trim(),
        domain: domain.trim() || null,
      });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/competitors"] });
      toast({ title: "Competitor added", description: `"${data.name}" added to the list.` });
      setName("");
      setDomain("");
    },
    onError: (err: any) => {
      const msg = err?.message || "";
      toast({ title: "Failed to add competitor", description: msg.includes("already") ? msg : "Try again.", variant: "destructive" });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/competitors/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/competitors"] });
      toast({ title: "Competitor removed" });
    },
    onError: () => {
      toast({ title: "Failed to remove competitor", variant: "destructive" });
    },
  });

  return (
    <Card className="p-4 border-card-border border-red-200 dark:border-red-800" data-testid="card-competitor-manager">
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-red-100 dark:bg-red-900/30">
          <Shield className="h-5 w-5 text-foreground/70" />
        </div>
        <div className="flex-1 min-w-0">
          <div
            className="flex items-center gap-2 mb-1 cursor-pointer select-none"
            role="button"
            tabIndex={0}
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setExpanded(!expanded);
              }
            }}
          >
            <h3 className="text-sm font-semibold">Competitor Database</h3>
            <Badge variant="secondary" className="text-[10px] bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300">
              {competitors.length} competitors
            </Badge>
            <div className="ml-auto">
              {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
            </div>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed mb-3">
            Companies that compete with Demandbase. Used by Public Company Analysis to flag competitors and generate competitive intelligence.
          </p>

          {expanded && (
            <>
              <div className="flex gap-2 mb-3">
                <Input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Competitor name..."
                  aria-label="Competitor name"
                  className="text-sm flex-1"
                  data-testid="input-competitor-name"
                  onKeyDown={e => {
                    if (e.key === "Enter" && name.trim()) addMutation.mutate();
                  }}
                />
                <VoiceInputButton onTranscript={(text) => setName((prev) => prev ? prev + " " + text : text)} />
                <Input
                  value={domain}
                  onChange={e => setDomain(e.target.value)}
                  placeholder="domain.com (optional)"
                  aria-label="Competitor domain"
                  className="text-sm w-36"
                  data-testid="input-competitor-domain"
                  onKeyDown={e => {
                    if (e.key === "Enter" && name.trim()) addMutation.mutate();
                  }}
                />
                <VoiceInputButton onTranscript={(text) => setDomain((prev) => prev ? prev + " " + text : text)} />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => addMutation.mutate()}
                  disabled={!name.trim() || addMutation.isPending}
                  data-testid="button-add-competitor"
                >
                  {addMutation.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <>
                      <Plus className="h-3 w-3 mr-1" />
                      Add
                    </>
                  )}
                </Button>
              </div>

              {competitorsQuery.isLoading ? (
                <div className="flex items-center gap-2 py-4 justify-center text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Loading competitors...
                </div>
              ) : sortedCompetitors.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {sortedCompetitors.map(comp => (
                    <div
                      key={comp.id}
                      className="group flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800"
                      title={comp.notes || undefined}
                      data-testid={`competitor-tag-${comp.id}`}
                    >
                      <Shield className="h-3 w-3 text-red-500 dark:text-red-400 shrink-0" />
                      <span className="text-foreground/80">{comp.name}</span>
                      <ConfirmDestructive
                        title={`Remove competitor "${comp.name}"?`}
                        description="This competitor is permanently removed from the database, and Public Company Analysis will stop flagging it. This can't be undone."
                        confirmLabel="Remove"
                        onConfirm={() => removeMutation.mutate(comp.id)}
                      >
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-4 w-4 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                          disabled={removeMutation.isPending}
                          aria-label={`Remove competitor ${comp.name}`}
                          data-testid={`button-remove-competitor-${comp.id}`}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </ConfirmDestructive>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center justify-center rounded-lg border border-dashed border-red-200 dark:border-red-800 py-3">
                  <span className="text-xs text-muted-foreground italic">No competitors defined. Add one above.</span>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

function CompanyTracker({ sources }: { sources: Source[] }) {
  const [companyName, setCompanyName] = useState("");
  const { toast } = useToast();

  const trackedCompanies = sources.filter(s => s.name.startsWith("Company - "));

  const addCompanyMutation = useMutation({
    mutationFn: async () => {
      const trimmed = companyName.trim();
      const res = await apiRequest("POST", "/api/track-company", { companyName: trimmed });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/sources"] });
      queryClient.invalidateQueries({ queryKey: ["/api/articles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/articles/filters"] });
      const name = data.name?.replace("Company - ", "") || companyName.trim();
      toast({ title: "Company tracked", description: `Now tracking "${name}". Articles will appear shortly.` });
      setCompanyName("");
    },
    onError: (err: any) => {
      const msg = err?.message || "Failed to track company";
      toast({ title: "Failed to track company", description: msg.includes("Already tracking") ? msg : "Try again later.", variant: "destructive" });
    },
  });

  const removeCompanyMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/sources/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sources"] });
      queryClient.invalidateQueries({ queryKey: ["/api/articles/filters"] });
      toast({ title: "Company removed" });
    },
    onError: () => {
      toast({ title: "Failed to remove company", variant: "destructive" });
    },
  });

  return (
    <Card className="p-4 border-card-border border-cyan-200 dark:border-cyan-800" data-testid="card-company-tracker">
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-cyan-100 dark:bg-cyan-900/30">
          <Building2 className="h-5 w-5 text-foreground/70" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-semibold">Company Tracker</h3>
            <Badge variant="secondary" className="text-[10px] bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300">
              {trackedCompanies.length} {trackedCompanies.length === 1 ? "company" : "companies"}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed mb-3">
            Track specific companies. Automatically creates a news feed and pulls in the latest articles.
          </p>

          <div className="flex gap-2 mb-3">
            <Input
              value={companyName}
              onChange={e => setCompanyName(e.target.value)}
              placeholder="e.g. Salesforce, HubSpot, Snowflake..."
              aria-label="Company name to track"
              className="text-sm"
              data-testid="input-company-name"
              onKeyDown={e => {
                if (e.key === "Enter" && companyName.trim()) addCompanyMutation.mutate();
              }}
            />
            <VoiceInputButton onTranscript={(text) => setCompanyName((prev) => prev ? prev + " " + text : text)} />
            <Button
              size="sm"
              onClick={() => addCompanyMutation.mutate()}
              disabled={!companyName.trim() || addCompanyMutation.isPending}
              data-testid="button-track-company"
            >
              {addCompanyMutation.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <>
                  <Plus className="h-3 w-3 mr-1" />
                  Track
                </>
              )}
            </Button>
          </div>

          {trackedCompanies.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {trackedCompanies.map(source => (
                <div
                  key={source.id}
                  className="group flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs bg-cyan-50 dark:bg-cyan-900/20 border border-cyan-200 dark:border-cyan-800"
                  data-testid={`company-tag-${source.id}`}
                >
                  <Building2 className="h-3 w-3 text-cyan-600 dark:text-cyan-400 shrink-0" />
                  <span className="text-foreground/80">{source.name.replace("Company - ", "")}</span>
                  <ConfirmDestructive
                    title={`Stop tracking "${source.name.replace("Company - ", "")}"?`}
                    description="The company's news feed source is permanently deleted and new articles for it will stop appearing. This can't be undone."
                    confirmLabel="Remove"
                    onConfirm={() => removeCompanyMutation.mutate(source.id)}
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-4 w-4 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                      disabled={removeCompanyMutation.isPending}
                      aria-label={`Stop tracking ${source.name.replace("Company - ", "")}`}
                      data-testid={`button-remove-company-${source.id}`}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </ConfirmDestructive>
                </div>
              ))}
            </div>
          )}

          {trackedCompanies.length === 0 && (
            <div className="flex items-center justify-center rounded-lg border border-dashed border-cyan-200 dark:border-cyan-800 py-3">
              <span className="text-xs text-muted-foreground italic">No companies tracked yet. Add one above.</span>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

const KNOWLEDGE_CATEGORIES = [
  "Platform Overview",
  "Marketing (ABX)",
  "Sales Intelligence",
  "Advertising & B2B DSP",
  "Data & Account Intelligence",
  "AI & Agentbase",
  "Buying Groups",
  "Customer Case Studies",
  "Competitive Intelligence",
  "Messaging & Positioning",
  "Integrations & Ecosystem",
  "Custom",
];

function PendingEntryCard({ entry, onUpdate, onDelete, onApprove }: {
  entry: PendingKnowledge;
  onUpdate: (id: number, data: { title?: string; content?: string; category?: string }) => void;
  onDelete: (id: number) => void;
  onApprove: (id: number) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [editTitle, setEditTitle] = useState(entry.title);
  const [editContent, setEditContent] = useState(entry.content);
  const [editCategory, setEditCategory] = useState(entry.category);

  const handleSave = () => {
    onUpdate(entry.id, { title: editTitle, content: editContent, category: editCategory });
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditTitle(entry.title);
    setEditContent(entry.content);
    setEditCategory(entry.category);
    setIsEditing(false);
  };

  if (entry.status === "approved") {
    return (
      <div className="px-3 py-2 text-sm flex items-center gap-2 bg-green-50 dark:bg-green-900/10" data-testid={`pending-entry-approved-${entry.id}`}>
        <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400 shrink-0" />
        <Badge variant="secondary" className="text-xs shrink-0">{entry.category}</Badge>
        <span className="truncate text-muted-foreground">{entry.title}</span>
        <span className="text-xs text-green-600 dark:text-green-400 ml-auto shrink-0">Approved</span>
      </div>
    );
  }

  return (
    <div className="px-3 py-2.5 space-y-2" data-testid={`pending-entry-${entry.id}`}>
      <div className="flex items-start gap-2">
        {isEditing ? (
          <div className="flex-1 space-y-2">
            <Select value={editCategory} onValueChange={setEditCategory}>
              <SelectTrigger className="h-7 text-xs w-48" data-testid={`select-category-${entry.id}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KNOWLEDGE_CATEGORIES.map((cat) => (
                  <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-1">
              <Input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="h-8 text-sm font-medium"
                aria-label="Entry title"
                data-testid={`input-title-${entry.id}`}
              />
              <VoiceInputButton onTranscript={(text) => setEditTitle((prev) => prev ? prev + " " + text : text)} />
            </div>
            <div className="relative">
              <Textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="text-xs min-h-[120px]"
                aria-label="Entry content"
                data-testid={`textarea-content-${entry.id}`}
              />
              <div className="absolute top-1.5 right-1.5">
                <VoiceInputButton onTranscript={(text) => setEditContent((prev) => prev ? prev + " " + text : text)} />
              </div>
            </div>
            <div className="flex gap-1.5 justify-end">
              <Button variant="ghost" size="sm" onClick={handleCancel} className="h-7 text-xs" data-testid={`button-cancel-edit-${entry.id}`}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleSave} className="h-7 text-xs" data-testid={`button-save-edit-${entry.id}`}>
                Save Changes
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <Badge variant="secondary" className="text-xs shrink-0">{entry.category}</Badge>
                <span className="text-sm font-medium truncate">{entry.title}</span>
              </div>
              {isExpanded ? (
                <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap leading-relaxed">{entry.content}</p>
              ) : (
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2 leading-relaxed">{entry.content}</p>
              )}
              <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="text-xs text-primary hover:underline mt-0.5"
                data-testid={`button-expand-${entry.id}`}
              >
                {isExpanded ? "Show less" : "Show more"}
              </button>
            </div>
            <div className="flex items-center gap-0.5 shrink-0">
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setIsEditing(true)} aria-label="Edit entry" data-testid={`button-edit-${entry.id}`}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-900/20" onClick={() => onApprove(entry.id)} aria-label="Approve entry" data-testid={`button-approve-${entry.id}`}>
                <Check className="h-3.5 w-3.5" />
              </Button>
              <ConfirmDestructive
                title={`Delete entry "${entry.title}"?`}
                description="This extracted entry is discarded and won't be added to the knowledge base. This can't be undone."
                onConfirm={() => onDelete(entry.id)}
              >
                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" aria-label="Delete entry" data-testid={`button-delete-${entry.id}`}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </ConfirmDestructive>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function KnowledgeReviewDialog({ entries: initialEntries, batchId, filename, open, onOpenChange }: {
  entries: PendingKnowledge[];
  batchId: string;
  filename: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const [entries, setEntries] = useState<PendingKnowledge[]>(initialEntries);
  const [isApprovingAll, setIsApprovingAll] = useState(false);
  const [allDone, setAllDone] = useState(false);
  const [approvedCount, setApprovedCount] = useState(0);

  const pendingEntries = entries.filter(e => e.status === "pending");

  const handleUpdate = async (id: number, data: { title?: string; content?: string; category?: string }) => {
    try {
      const res = await fetch(`/api/knowledge/pending/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Update failed");
      const updated = await res.json();
      setEntries(prev => prev.map(e => e.id === id ? updated : e));
      toast({ title: "Entry updated" });
    } catch {
      toast({ title: "Failed to update entry", variant: "destructive" });
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await fetch(`/api/knowledge/pending/${id}`, { method: "DELETE" });
      setEntries(prev => prev.filter(e => e.id !== id));
      queryClient.invalidateQueries({ queryKey: ["/api/knowledge/pending"] });
      toast({ title: "Entry removed" });
    } catch {
      toast({ title: "Failed to remove entry", variant: "destructive" });
    }
  };

  const handleApprove = async (id: number) => {
    try {
      const res = await fetch(`/api/knowledge/pending/${id}/approve`, { method: "POST" });
      if (!res.ok) throw new Error("Approve failed");
      setEntries(prev => prev.map(e => e.id === id ? { ...e, status: "approved" } : e));
      setApprovedCount(prev => prev + 1);
      queryClient.invalidateQueries({ queryKey: ["/api/knowledge"] });
      queryClient.invalidateQueries({ queryKey: ["/api/knowledge/pending"] });
      toast({ title: "Entry approved and added to knowledge base" });
    } catch {
      toast({ title: "Failed to approve entry", variant: "destructive" });
    }
  };

  const handleApproveAll = async () => {
    setIsApprovingAll(true);
    try {
      const res = await fetch(`/api/knowledge/pending/batch/${batchId}/approve-all`, { method: "POST" });
      if (!res.ok) throw new Error("Approve all failed");
      const data = await res.json();
      setEntries(prev => prev.map(e => e.status === "pending" ? { ...e, status: "approved" } : e));
      setApprovedCount(data.approvedCount);
      setAllDone(true);
      queryClient.invalidateQueries({ queryKey: ["/api/knowledge"] });
      queryClient.invalidateQueries({ queryKey: ["/api/knowledge/pending"] });
      toast({ title: "All entries approved", description: `${data.approvedCount} entries added to the knowledge base.` });
    } catch {
      toast({ title: "Failed to approve entries", variant: "destructive" });
    } finally {
      setIsApprovingAll(false);
    }
  };

  const handleClose = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/knowledge"] });
    queryClient.invalidateQueries({ queryKey: ["/api/knowledge/pending"] });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5" />
            Review Extracted Knowledge
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            From {filename} — review, edit, or delete entries before approving them into the knowledge base.
          </p>
        </DialogHeader>

        {allDone ? (
          <div className="py-8 text-center space-y-3">
            <CheckCircle className="h-12 w-12 mx-auto text-green-600 dark:text-green-400" />
            <div>
              <p className="font-semibold text-lg">{approvedCount} entries approved</p>
              <p className="text-sm text-muted-foreground mt-1">
                Knowledge has been added to the DB POV knowledge base and is now available for the AI Analyst and Field Enablement agent.
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between px-1">
              <p className="text-sm text-muted-foreground">
                {pendingEntries.length} pending / {entries.length} total entries
              </p>
              {pendingEntries.length > 0 && (
                <Button
                  size="sm"
                  onClick={handleApproveAll}
                  disabled={isApprovingAll}
                  data-testid="button-approve-all"
                >
                  {isApprovingAll ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <CheckCircle className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  Approve All ({pendingEntries.length})
                </Button>
              )}
            </div>

            <div className="border rounded-lg divide-y overflow-y-auto flex-1 min-h-0 max-h-[50vh]">
              {entries.map((entry) => (
                <PendingEntryCard
                  key={entry.id}
                  entry={entry}
                  onUpdate={handleUpdate}
                  onDelete={handleDelete}
                  onApprove={handleApprove}
                />
              ))}
              {entries.length === 0 && (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  All entries have been removed.
                </div>
              )}
            </div>
          </>
        )}

        <DialogFooter>
          {allDone ? (
            <Button onClick={handleClose} data-testid="button-review-done">Done</Button>
          ) : (
            <Button variant="outline" onClick={handleClose}>Close</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type ConflictItem = {
  type: "contradiction" | "outdated" | "duplicate" | "vague";
  severity: "high" | "medium" | "low";
  description: string;
  recommendation?: string;
  entryIds: number[];
  entryTitles?: string[];
};

type SuggestionItem = {
  type: "merge" | "update" | "delete" | "clarify";
  description: string;
  entryIds: number[];
  conflictIndex?: number;
};

type TeachResolution = {
  resolution: "keep" | "merge" | "update" | "delete" | "clarify";
  explanation: string;
  title: string;
  content: string;
  category: string;
  deleteIds: number[];
};

type ConflictReviewResponse = {
  id: number;
  conflicts: ConflictItem[];
  suggestions: SuggestionItem[];
  totalEntries: number;
  issueCount: number;
  createdAt: string;
};

function KnowledgeBaseSection() {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [expandedEntries, setExpandedEntries] = useState<Set<number>>(new Set());
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"active" | "all">("active");
  const [showConflictsPanel, setShowConflictsPanel] = useState(false);

  const knowledgeQuery = useQuery<KnowledgeEntry[]>({
    queryKey: ["/api/knowledge"],
  });

  const conflictsQuery = useQuery<ConflictReviewResponse | null>({
    queryKey: ["/api/knowledge/conflicts"],
  });

  const analyzeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/knowledge/analyze-conflicts");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/knowledge/conflicts"] });
      toast({ title: "Quality review complete", description: "Check the results below." });
      setShowConflictsPanel(true);
    },
    onError: () => {
      toast({ title: "Review failed", description: "Could not analyze knowledge quality.", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/knowledge/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/knowledge"] });
      queryClient.invalidateQueries({ queryKey: ["/api/knowledge/conflicts"] });
      toast({ title: "Entry deleted" });
      setDeleteId(null);
    },
    onError: () => {
      toast({ title: "Couldn't delete entry", description: "The delete failed. Refresh and try again.", variant: "destructive" });
    },
  });

  const [applyingIdx, setApplyingIdx] = useState<number | null>(null);
  const [editPreview, setEditPreview] = useState<{
    idx: number;
    suggestion: SuggestionItem;
    title: string;
    content: string;
    category?: string;
  } | null>(null);
  const [teachingIdx, setTeachingIdx] = useState<number | null>(null);
  const [teachReason, setTeachReason] = useState("");
  const [teachResolution, setTeachResolution] = useState<{ idx: number; data: TeachResolution } | null>(null);
  const [resolvedConflicts, setResolvedConflicts] = useState<Set<number>>(new Set());
  const [expandedEntryIds, setExpandedEntryIds] = useState<Set<number>>(new Set());
  const [teachConversation, setTeachConversation] = useState<{ role: "user" | "assistant"; text: string }[]>([]);
  const [teachFollowUp, setTeachFollowUp] = useState("");

  const previewMutation = useMutation({
    mutationFn: async ({ suggestion, idx }: { suggestion: SuggestionItem; idx: number }) => {
      if (suggestion.type === "merge") {
        const res = await apiRequest("POST", "/api/knowledge/consolidate", {
          entryIds: suggestion.entryIds,
          action: "merge",
          preview: true,
        });
        return { ...(await res.json()), idx, suggestion };
      } else {
        const entryId = suggestion.entryIds[0];
        const res = await apiRequest("POST", "/api/knowledge/ai-rewrite", {
          entryId,
          action: suggestion.type,
          instruction: suggestion.description,
          preview: true,
        });
        return { ...(await res.json()), idx, suggestion };
      }
    },
    onSuccess: (data) => {
      setEditPreview({
        idx: data.idx,
        suggestion: data.suggestion,
        title: data.title,
        content: data.content,
        category: data.category,
      });
      setApplyingIdx(null);
    },
    onError: () => {
      toast({ title: "Preview failed", description: "Could not generate AI recommendation.", variant: "destructive" });
      setApplyingIdx(null);
    },
  });

  const confirmMutation = useMutation({
    mutationFn: async () => {
      if (!editPreview) throw new Error("No preview");
      const { suggestion, title, content, category } = editPreview;
      if (suggestion.type === "merge") {
        const res = await apiRequest("POST", "/api/knowledge/consolidate", {
          entryIds: suggestion.entryIds,
          action: "merge",
          title,
          content,
          category,
        });
        return res.json();
      } else {
        const entryId = suggestion.entryIds[0];
        const res = await apiRequest("POST", "/api/knowledge/ai-rewrite", {
          entryId,
          action: suggestion.type,
          instruction: suggestion.description,
          title,
          content,
        });
        return res.json();
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/knowledge"] });
      queryClient.invalidateQueries({ queryKey: ["/api/knowledge/conflicts"] });
      const actionType = editPreview?.suggestion.type;
      const labels: Record<string, string> = { merge: "Entries consolidated", update: "Entry updated", clarify: "Entry clarified" };
      toast({ title: labels[actionType || ""] || "Applied", description: "Knowledge base has been updated." });
      setEditPreview(null);
    },
    onError: () => {
      toast({ title: "Action failed", description: "Could not apply changes.", variant: "destructive" });
    },
  });

  const deleteSuggestionMutation = useMutation({
    mutationFn: async (suggestion: SuggestionItem) => {
      const res = await apiRequest("POST", "/api/knowledge/consolidate", {
        entryIds: suggestion.entryIds,
        action: "delete",
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/knowledge"] });
      queryClient.invalidateQueries({ queryKey: ["/api/knowledge/conflicts"] });
      toast({ title: "Entries deleted", description: "Knowledge base has been updated." });
      setApplyingIdx(null);
    },
    onError: () => {
      toast({ title: "Delete failed", variant: "destructive" });
      setApplyingIdx(null);
    },
  });

  const teachMutation = useMutation({
    mutationFn: async ({ conflictIdx, conflict, suggestion, followUpText, initialReason, priorConversation }: {
      conflictIdx: number;
      conflict: ConflictItem;
      suggestion?: SuggestionItem;
      followUpText?: string;
      initialReason: string;
      priorConversation: { role: "user" | "assistant"; text: string }[];
    }) => {
      const currentConversation = [...priorConversation];
      if (followUpText) {
        currentConversation.push({ role: "user", text: followUpText });
      }
      const res = await apiRequest("POST", "/api/knowledge/teach", {
        conflictIndex: conflictIdx,
        conflictDescription: conflict.description,
        userReason: initialReason,
        entryIds: conflict.entryIds,
        conflictType: conflict.type,
        suggestionType: suggestion?.type,
        suggestionDescription: suggestion?.description,
        conversationHistory: currentConversation.length > 0 ? currentConversation : undefined,
      });
      const data = await res.json();
      return { idx: conflictIdx, data, currentConversation };
    },
    onSuccess: (result) => {
      if (teachingIdx !== result.idx) return;
      if (result.data.needsClarification) {
        const updatedConversation = [...result.currentConversation];
        updatedConversation.push({ role: "assistant" as const, text: result.data.questions?.join("\n\n") || result.data.aiMessage || "Could you tell me more?" });
        setTeachConversation(updatedConversation);
        setTeachFollowUp("");
      } else {
        setTeachResolution({ idx: result.idx, data: result.data as TeachResolution });
        setTeachingIdx(null);
        setTeachReason("");
        setTeachConversation([]);
        setTeachFollowUp("");
      }
    },
    onError: () => {
      toast({ title: "Could not process feedback", variant: "destructive" });
    },
  });

  const applyTeachMutation = useMutation({
    mutationFn: async ({ resolution, conflict, conflictIdx }: { resolution: TeachResolution; conflict: ConflictItem; conflictIdx: number }) => {
      if (resolution.resolution === "keep") {
        return { kept: true, conflictIdx };
      }
      if (resolution.resolution === "delete") {
        const idsToDelete = resolution.deleteIds.length > 0
          ? resolution.deleteIds.filter(id => conflict.entryIds.includes(id))
          : conflict.entryIds;
        for (const id of idsToDelete) {
          await apiRequest("DELETE", `/api/knowledge/${id}`);
        }
        return { deleted: true, conflictIdx };
      }
      if (resolution.resolution === "merge") {
        const res = await apiRequest("POST", "/api/knowledge/consolidate", {
          entryIds: conflict.entryIds,
          action: "merge",
          title: resolution.title,
          content: resolution.content,
          category: resolution.category,
        });
        return { ...(await res.json()), conflictIdx };
      }
      const action = resolution.resolution === "update" || resolution.resolution === "clarify" ? resolution.resolution : "update";
      const entryId = conflict.entryIds[0];
      if (entryId) {
        const res = await apiRequest("POST", "/api/knowledge/ai-rewrite", {
          entryId,
          action,
          instruction: resolution.explanation,
          title: resolution.title,
          content: resolution.content,
        });
        return { ...(await res.json()), conflictIdx };
      }
      return { conflictIdx };
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/knowledge"] });
      queryClient.invalidateQueries({ queryKey: ["/api/knowledge/conflicts"] });
      const resType = variables.resolution.resolution;
      const labels: Record<string, string> = {
        keep: "Issue dismissed",
        merge: "Entries consolidated",
        update: "Entry updated",
        delete: "Entries deleted",
        clarify: "Entry clarified",
      };
      toast({ title: labels[resType] || "Applied", description: "Knowledge base has been updated." });
      setResolvedConflicts(prev => new Set(prev).add(variables.conflictIdx));
      setTeachResolution(null);
    },
    onError: () => {
      toast({ title: "Action failed", variant: "destructive" });
    },
  });

  const entries = knowledgeQuery.data || [];
  if (entries.length === 0) return null;

  const review = conflictsQuery.data;
  const conflicts: ConflictItem[] = review?.conflicts || [];
  const suggestions: SuggestionItem[] = review?.suggestions || [];

  const getSuggestionForConflict = (conflictIdx: number): SuggestionItem | undefined => {
    const byIndex = suggestions.find(s => s.conflictIndex === conflictIdx);
    if (byIndex) return byIndex;
    if (conflictIdx < suggestions.length) return suggestions[conflictIdx];
    return undefined;
  };

  const flaggedEntryIds = new Set<number>();
  conflicts.forEach(c => c.entryIds?.forEach(id => flaggedEntryIds.add(id)));

  const filteredEntries = entries.filter(entry => {
    if (statusFilter === "active" && !entry.isActive) return false;
    if (categoryFilter !== "all" && entry.category !== categoryFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return entry.title.toLowerCase().includes(q) || entry.content.toLowerCase().includes(q);
    }
    return true;
  });

  const grouped = filteredEntries.reduce((acc, entry) => {
    if (!acc[entry.category]) acc[entry.category] = [];
    acc[entry.category].push(entry);
    return acc;
  }, {} as Record<string, KnowledgeEntry[]>);

  const allCategories = Array.from(new Set(entries.map(e => e.category))).sort();
  const categoryCounts = entries.reduce((acc, e) => {
    acc[e.category] = (acc[e.category] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const toggleEntry = (id: number) => {
    setExpandedEntries(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const getConflictsForEntry = (entryId: number) => {
    return conflicts.filter(c => c.entryIds?.includes(entryId));
  };

  const severityColor = (severity: string) => {
    if (severity === "high") return "text-red-600 dark:text-red-400";
    if (severity === "medium") return "text-amber-600 dark:text-amber-400";
    return "text-yellow-600 dark:text-yellow-400";
  };

  const typeLabel = (type: string) => {
    if (type === "contradiction") return "Conflict";
    if (type === "outdated") return "Outdated";
    if (type === "duplicate") return "Duplicate";
    if (type === "vague") return "Low Quality";
    return type;
  };

  const typeBadgeVariant = (type: string) => {
    if (type === "contradiction") return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300";
    if (type === "outdated") return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300";
    if (type === "duplicate") return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300";
    return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300";
  };

  return (
    <>
      <Card className="p-4 border-card-border" data-testid="card-knowledge-base">
        <div
          className="flex items-center gap-3 cursor-pointer select-none"
          role="button"
          tabIndex={0}
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setExpanded(!expanded);
            }
          }}
          data-testid="button-toggle-knowledge-base"
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-emerald-100 dark:bg-emerald-900/30">
            <BookOpen className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-semibold">Knowledge Base</h3>
              <Badge variant="secondary" className="text-[10px]">
                {entries.length} entries
              </Badge>
              {conflicts.length > 0 && (
                <Badge variant="secondary" className="text-[10px] bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                  <AlertTriangle className="h-3 w-3 mr-0.5" />
                  {conflicts.length} issues
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Approved knowledge from uploaded documents, used by the AI Analyst
            </p>
          </div>
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
          )}
        </div>

        {expanded && (
          <div className="mt-3 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative flex-1 min-w-[180px]">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search knowledge entries..."
                  aria-label="Search knowledge entries"
                  className="text-xs pl-8"
                  data-testid="input-knowledge-search"
                />
                {searchQuery && (
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2"
                    aria-label="Clear search"
                    onClick={(e) => { e.stopPropagation(); setSearchQuery(""); }}
                  >
                    <X className="h-3 w-3 text-muted-foreground" />
                  </button>
                )}
              </div>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-[180px] text-xs" data-testid="select-knowledge-category-filter">
                  <Filter className="h-3 w-3 mr-1.5 text-muted-foreground" />
                  <SelectValue placeholder="All Categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {allCategories.map(cat => (
                    <SelectItem key={cat} value={cat}>{cat} ({categoryCounts[cat]})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as "active" | "all")}>
                <SelectTrigger className="w-[120px] text-xs" data-testid="select-knowledge-status-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active Only</SelectItem>
                  <SelectItem value="all">All Entries</SelectItem>
                </SelectContent>
              </Select>
              <Button
                size="sm"
                variant="outline"
                onClick={(e) => { e.stopPropagation(); analyzeMutation.mutate(); }}
                disabled={analyzeMutation.isPending}
                data-testid="button-review-quality"
              >
                {analyzeMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                )}
                Review Quality
              </Button>
            </div>

            {allCategories.length > 1 && (
              <div className="flex gap-2 flex-wrap">
                {allCategories.map(cat => {
                  const count = categoryCounts[cat] || 0;
                  const isSelected = categoryFilter === cat;
                  const catConflicts = conflicts.filter(c => 
                    c.entryIds?.some(id => entries.find(e => e.id === id && e.category === cat))
                  );
                  return (
                    <button
                      key={cat}
                      onClick={(e) => {
                        e.stopPropagation();
                        setCategoryFilter(isSelected ? "all" : cat);
                      }}
                      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs border transition-colors ${
                        isSelected
                          ? "border-emerald-400 bg-emerald-50 dark:border-emerald-600 dark:bg-emerald-900/20"
                          : "border-border bg-muted/30 hover:bg-muted/60"
                      }`}
                      data-testid={`button-category-filter-${cat}`}
                    >
                      <span className="font-medium">{cat}</span>
                      <Badge variant="secondary" className="text-[9px] px-1 py-0">{count}</Badge>
                      {catConflicts.length > 0 && (
                        <AlertTriangle className="h-3 w-3 text-amber-500" />
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {conflicts.length > 0 && (
              <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/10 p-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <ShieldAlert className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                    <span className="text-xs font-semibold">Quality Review Results</span>
                    <Badge variant="secondary" className="text-[10px] bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                      {conflicts.length} issues found
                    </Badge>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 text-xs"
                    onClick={(e) => { e.stopPropagation(); setShowConflictsPanel(!showConflictsPanel); }}
                    data-testid="button-toggle-conflicts"
                  >
                    {showConflictsPanel ? "Hide Details" : "Show Details"}
                    {showConflictsPanel ? <ChevronDown className="h-3 w-3 ml-1" /> : <ChevronRight className="h-3 w-3 ml-1" />}
                  </Button>
                </div>

                {showConflictsPanel && (
                  <div className="space-y-3 mt-2">
                    {conflicts.map((conflict, idx) => {
                      const involvedEntries = conflict.entryIds
                        ?.map(id => entries.find(e => e.id === id))
                        .filter(Boolean) as KnowledgeEntryWithFilename[] || [];
                      const suggestion = getSuggestionForConflict(idx);
                      const isResolved = resolvedConflicts.has(idx);
                      const isTeaching = teachingIdx === idx;
                      const hasTeachResolution = teachResolution?.idx === idx;
                      const isGenerating = applyingIdx === idx && previewMutation.isPending;
                      const isDeleting = applyingIdx === idx && deleteSuggestionMutation.isPending;
                      const hasPreview = editPreview?.idx === idx;
                      const actionLabel = suggestion ? (suggestion.type === "merge" ? "Merge" : suggestion.type === "delete" ? "Delete" : suggestion.type === "update" ? "Update" : "Clarify") : "";
                      const ActionIcon = suggestion ? (suggestion.type === "merge" ? FolderPlus : suggestion.type === "delete" ? Trash2 : Edit) : Edit;

                      if (isResolved) {
                        return (
                          <div key={idx} className="rounded-md border border-emerald-200 dark:border-emerald-800 bg-emerald-50/30 dark:bg-emerald-900/10 p-3" data-testid={`conflict-item-${idx}`}>
                            <div className="flex items-center gap-2">
                              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                              <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">Resolved</span>
                              <Badge variant="secondary" className={`text-[10px] ${typeBadgeVariant(conflict.type)}`}>
                                {typeLabel(conflict.type)}
                              </Badge>
                            </div>
                            <p className="text-[11px] text-muted-foreground mt-1 line-clamp-1">{conflict.description}</p>
                          </div>
                        );
                      }

                      return (
                        <div
                          key={idx}
                          className="rounded-md border border-border bg-background p-3 space-y-2"
                          data-testid={`conflict-item-${idx}`}
                        >
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant="secondary" className={`text-[10px] ${typeBadgeVariant(conflict.type)}`}>
                              {typeLabel(conflict.type)}
                            </Badge>
                            <Badge variant="outline" className="text-[10px]">
                              {conflict.severity} severity
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground leading-relaxed">{conflict.description}</p>

                          {involvedEntries.length > 0 && (
                            <div className="space-y-2 mt-1">
                              {involvedEntries.map((entry) => (
                                <div
                                  key={entry.id}
                                  className="rounded border border-border/60 bg-muted/20 p-2.5"
                                  data-testid={`conflict-entry-${entry.id}`}
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-1.5 mb-1">
                                        <Badge variant="outline" className="text-[9px] shrink-0">#{entry.id}</Badge>
                                        <span className="text-xs font-semibold text-foreground truncate">{entry.title}</span>
                                      </div>
                                      <p className={`text-[11px] text-muted-foreground leading-relaxed ${expandedEntryIds.has(entry.id) ? "" : "line-clamp-4"}`}>{entry.content}</p>
                                      <button
                                        className="text-xs text-blue-500 hover:text-blue-600 mt-0.5 font-medium"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setExpandedEntryIds(prev => {
                                            const next = new Set(prev);
                                            if (next.has(entry.id)) next.delete(entry.id);
                                            else next.add(entry.id);
                                            return next;
                                          });
                                        }}
                                        data-testid={`button-toggle-entry-${entry.id}`}
                                      >
                                        {expandedEntryIds.has(entry.id) ? "Show less" : "Read full entry"}
                                      </button>
                                      {entry.sourceFilename && (
                                        <p className="text-xs text-muted-foreground mt-1">Source: {entry.sourceFilename}</p>
                                      )}
                                    </div>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 text-xs text-destructive shrink-0"
                                      onClick={(e) => { e.stopPropagation(); setDeleteId(entry.id); }}
                                      data-testid={`button-conflict-delete-${entry.id}`}
                                    >
                                      <Trash2 className="h-3 w-3 mr-1" />
                                      Delete
                                    </Button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          {suggestion ? (
                            <div className="rounded-md border border-sky-200 dark:border-sky-800 bg-sky-50/40 dark:bg-sky-900/10 p-2.5 mt-2" data-testid={`suggestion-item-${idx}`}>
                              <div className="flex items-start gap-2">
                                <CornerDownRight className="h-3 w-3 mt-0.5 text-sky-500 shrink-0" />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1.5 mb-1">
                                    <span className="text-[10px] font-semibold text-sky-700 dark:text-sky-400 uppercase tracking-wide">Suggestion</span>
                                    <Badge variant="outline" className="text-[9px]">{suggestion.type}</Badge>
                                  </div>
                                  <span className="text-xs text-muted-foreground leading-relaxed">{suggestion.description}</span>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 mt-2 flex-wrap">
                                {suggestion.type === "delete" ? (
                                  <ConfirmDestructive
                                    title={`Delete ${suggestion.entryIds.length} flagged ${suggestion.entryIds.length === 1 ? "entry" : "entries"}?`}
                                    description="The knowledge entries named in this suggestion are permanently removed from the knowledge base. This can't be undone."
                                    onConfirm={() => {
                                      setApplyingIdx(idx);
                                      deleteSuggestionMutation.mutate(suggestion);
                                    }}
                                  >
                                    <Button
                                      size="sm"
                                      variant="destructive"
                                      className="h-7 text-xs gap-1"
                                      disabled={isDeleting}
                                      data-testid={`button-apply-suggestion-${idx}`}
                                    >
                                      {isDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                                      {isDeleting ? "Deleting..." : "Delete"}
                                    </Button>
                                  </ConfirmDestructive>
                                ) : (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-xs gap-1"
                                    disabled={isGenerating || hasPreview}
                                    onClick={() => {
                                      setApplyingIdx(idx);
                                      previewMutation.mutate({ suggestion, idx });
                                    }}
                                    data-testid={`button-generate-suggestion-${idx}`}
                                  >
                                    {isGenerating ? <Loader2 className="h-3 w-3 animate-spin" /> : <ActionIcon className="h-3 w-3" />}
                                    {isGenerating ? "Generating..." : `Generate ${actionLabel}`}
                                  </Button>
                                )}
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 text-xs gap-1 text-muted-foreground"
                                  onClick={() => {
                                    setTeachingIdx(isTeaching ? null : idx);
                                    setTeachReason("");
                                    setTeachResolution(null);
                                    setTeachConversation([]);
                                    setTeachFollowUp("");
                                  }}
                                  data-testid={`button-teach-${idx}`}
                                >
                                  <MessageSquare className="h-3 w-3" />
                                  {isTeaching ? "Cancel" : "I disagree"}
                                </Button>
                              </div>

                              {hasPreview && editPreview && (
                                <div className="border-t border-border mt-2 pt-2 space-y-2" data-testid={`preview-edit-${idx}`}>
                                  <div className="space-y-1">
                                    <Label className="text-xs text-muted-foreground">Title</Label>
                                    <Input
                                      value={editPreview.title}
                                      onChange={(e) => setEditPreview({ ...editPreview, title: e.target.value })}
                                      className="h-8 text-xs"
                                      data-testid={`input-preview-title-${idx}`}
                                    />
                                  </div>
                                  <div className="space-y-1">
                                    <Label className="text-xs text-muted-foreground">Content</Label>
                                    <Textarea
                                      value={editPreview.content}
                                      onChange={(e) => setEditPreview({ ...editPreview, content: e.target.value })}
                                      rows={6}
                                      className="text-xs resize-y"
                                      data-testid={`textarea-preview-content-${idx}`}
                                    />
                                  </div>
                                  <div className="flex items-center gap-2 justify-end">
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 text-xs"
                                      onClick={() => setEditPreview(null)}
                                      data-testid={`button-cancel-preview-${idx}`}
                                    >
                                      Cancel
                                    </Button>
                                    <Button
                                      size="sm"
                                      className="h-7 text-xs gap-1"
                                      disabled={confirmMutation.isPending}
                                      onClick={() => confirmMutation.mutate()}
                                      data-testid={`button-apply-preview-${idx}`}
                                    >
                                      {confirmMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                                      {confirmMutation.isPending ? "Applying..." : `Apply ${actionLabel}`}
                                    </Button>
                                  </div>
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 mt-2">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-xs gap-1 text-muted-foreground"
                                onClick={() => {
                                  setTeachingIdx(isTeaching ? null : idx);
                                  setTeachReason("");
                                  setTeachResolution(null);
                                  setTeachConversation([]);
                                  setTeachFollowUp("");
                                }}
                                data-testid={`button-teach-${idx}`}
                              >
                                <MessageSquare className="h-3 w-3" />
                                {isTeaching ? "Cancel" : "I disagree"}
                              </Button>
                            </div>
                          )}

                          {isTeaching && (
                            <div className="rounded-md border border-violet-200 dark:border-violet-800 bg-violet-50/40 dark:bg-violet-900/10 p-2.5 mt-2 space-y-2" data-testid={`teach-panel-${idx}`}>
                              <div className="flex items-center gap-1.5">
                                <MessageSquare className="h-3 w-3 text-violet-500" />
                                <span className="text-[10px] font-semibold text-violet-700 dark:text-violet-400 uppercase tracking-wide">
                                  {teachConversation.length > 0 ? "Conversation" : "Provide Your Reasoning"}
                                </span>
                              </div>

                              {teachConversation.length === 0 ? (
                                <>
                                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                                    {conflict.type === "duplicate"
                                      ? "Explain why these entries should remain separate, or how you'd prefer to handle them."
                                      : "Explain why you disagree with this finding, or describe how you'd prefer to resolve it."}
                                  </p>
                                  <Textarea
                                    placeholder={
                                      conflict.type === "duplicate"
                                        ? "e.g., These entries serve different audiences: one is for sales teams, the other for marketing..."
                                        : "e.g., This information is still current because..."
                                    }
                                    value={teachReason}
                                    onChange={(e) => setTeachReason(e.target.value)}
                                    rows={3}
                                    className="text-xs resize-y"
                                    aria-label="Your reasoning"
                                    data-testid={`textarea-teach-reason-${idx}`}
                                  />
                                  <div className="flex justify-end">
                                    <Button
                                      size="sm"
                                      className="h-7 text-xs gap-1"
                                      disabled={!teachReason.trim() || teachMutation.isPending}
                                      onClick={() => {
                                        const initial = [{ role: "user" as const, text: teachReason }];
                                        setTeachConversation(initial);
                                        teachMutation.mutate({ conflictIdx: idx, conflict, suggestion, initialReason: teachReason, priorConversation: initial });
                                      }}
                                      data-testid={`button-submit-teach-${idx}`}
                                    >
                                      {teachMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                                      {teachMutation.isPending ? "Thinking..." : "Submit"}
                                    </Button>
                                  </div>
                                </>
                              ) : (
                                <>
                                  <div className="space-y-2 max-h-60 overflow-y-auto" data-testid={`teach-conversation-${idx}`}>
                                    {teachConversation.map((msg, mi) => (
                                      <div
                                        key={mi}
                                        className={`rounded p-2 text-xs leading-relaxed ${
                                          msg.role === "user"
                                            ? "bg-violet-100/60 dark:bg-violet-900/20 ml-4"
                                            : "bg-white dark:bg-slate-800 border border-border/60 mr-4"
                                        }`}
                                      >
                                        <span className="text-[9px] font-semibold uppercase tracking-wide block mb-0.5 text-muted-foreground">
                                          {msg.role === "user" ? "You" : "AI"}
                                        </span>
                                        <span className="whitespace-pre-wrap">{msg.text}</span>
                                      </div>
                                    ))}
                                    {teachMutation.isPending && (
                                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground p-2">
                                        <Loader2 className="h-3 w-3 animate-spin" />
                                        Thinking...
                                      </div>
                                    )}
                                  </div>
                                  {!teachMutation.isPending && (
                                    <div className="flex gap-2">
                                      <Textarea
                                        placeholder="Type your response..."
                                        aria-label="Follow-up response"
                                        value={teachFollowUp}
                                        onChange={(e) => setTeachFollowUp(e.target.value)}
                                        rows={2}
                                        className="text-xs resize-y flex-1"
                                        data-testid={`textarea-teach-followup-${idx}`}
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter" && !e.shiftKey && teachFollowUp.trim()) {
                                            e.preventDefault();
                                            const newConvo = [...teachConversation, { role: "user" as const, text: teachFollowUp }];
                                            setTeachConversation(newConvo);
                                            teachMutation.mutate({ conflictIdx: idx, conflict, suggestion, followUpText: teachFollowUp, initialReason: teachReason, priorConversation: teachConversation });
                                          }
                                        }}
                                      />
                                      <Button
                                        size="sm"
                                        className="h-auto text-xs gap-1 self-end"
                                        disabled={!teachFollowUp.trim()}
                                        onClick={() => {
                                          const newConvo = [...teachConversation, { role: "user" as const, text: teachFollowUp }];
                                          setTeachConversation(newConvo);
                                          teachMutation.mutate({ conflictIdx: idx, conflict, suggestion, followUpText: teachFollowUp, initialReason: teachReason, priorConversation: teachConversation });
                                        }}
                                        data-testid={`button-send-followup-${idx}`}
                                      >
                                        <Sparkles className="h-3 w-3" />
                                        Send
                                      </Button>
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                          )}

                          {hasTeachResolution && teachResolution && (
                            <div className="rounded-md border border-emerald-200 dark:border-emerald-800 bg-emerald-50/40 dark:bg-emerald-900/10 p-2.5 mt-2 space-y-2" data-testid={`teach-resolution-${idx}`}>
                              <div className="flex items-center gap-1.5">
                                <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                                <span className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wide">AI Resolution</span>
                                <Badge variant="outline" className="text-[9px]">{teachResolution.data.resolution}</Badge>
                              </div>
                              <p className="text-xs text-muted-foreground leading-relaxed">{teachResolution.data.explanation}</p>
                              {teachResolution.data.resolution !== "keep" && teachResolution.data.title && (
                                <div className="rounded border border-border/60 bg-muted/20 p-2 space-y-1">
                                  <p className="text-xs text-muted-foreground font-medium">Proposed Changes:</p>
                                  <p className="text-xs font-medium">{teachResolution.data.title}</p>
                                  <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-4">{teachResolution.data.content}</p>
                                </div>
                              )}
                              <div className="flex items-center gap-2 justify-end">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 text-xs"
                                  onClick={() => setTeachResolution(null)}
                                  data-testid={`button-dismiss-resolution-${idx}`}
                                >
                                  Dismiss
                                </Button>
                                <Button
                                  size="sm"
                                  className="h-7 text-xs gap-1"
                                  disabled={applyTeachMutation.isPending}
                                  onClick={() => applyTeachMutation.mutate({ resolution: teachResolution.data, conflict, conflictIdx: idx })}
                                  data-testid={`button-accept-resolution-${idx}`}
                                >
                                  {applyTeachMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                                  {applyTeachMutation.isPending ? "Applying..." : `Accept ${teachResolution.data.resolution === "keep" ? "& Dismiss" : "Resolution"}`}
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {filteredEntries.length === 0 ? (
              <div className="flex items-center justify-center rounded-md border border-dashed py-6">
                <span className="text-xs text-muted-foreground italic">
                  {searchQuery || categoryFilter !== "all" ? "No entries match your filters." : "No knowledge entries."}
                </span>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground mb-1">
                Showing {filteredEntries.length} of {entries.length} entries
              </div>
            )}

            {Object.entries(grouped).map(([category, catEntries]) => (
              <div key={category}>
                <div className="flex items-center gap-2 mb-1.5">
                  <Badge variant="outline" className="text-[10px]">{category}</Badge>
                  <span className="text-xs text-muted-foreground">{catEntries.length} entries</span>
                </div>
                <div className="space-y-1">
                  {catEntries.map((entry) => {
                    const entryConflicts = getConflictsForEntry(entry.id);
                    const isFlagged = entryConflicts.length > 0;
                    return (
                      <div
                        key={entry.id}
                        className={`rounded-md border px-3 py-2 ${
                          isFlagged
                            ? "border-amber-300 dark:border-amber-700 bg-amber-50/30 dark:bg-amber-900/10"
                            : "border-border bg-muted/30"
                        }`}
                        data-testid={`knowledge-entry-${entry.id}`}
                      >
                        <div className="flex items-start gap-2">
                          <button
                            type="button"
                            className="mt-0.5 shrink-0"
                            aria-label={expandedEntries.has(entry.id) ? "Collapse entry" : "Expand entry"}
                            onClick={() => toggleEntry(entry.id)}
                            data-testid={`button-expand-entry-${entry.id}`}
                          >
                            {expandedEntries.has(entry.id) ? (
                              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                            )}
                          </button>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <p className="text-xs font-medium leading-snug">{entry.title}</p>
                              {isFlagged && entryConflicts.map((c, ci) => (
                                <Badge key={ci} variant="secondary" className={`text-[9px] ${typeBadgeVariant(c.type)}`}>
                                  <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />
                                  {typeLabel(c.type)}
                                </Badge>
                              ))}
                              {!entry.isActive && (
                                <Badge variant="outline" className="text-[9px]">Inactive</Badge>
                              )}
                            </div>
                            {expandedEntries.has(entry.id) && (
                              <p className="text-xs text-muted-foreground mt-1 leading-relaxed whitespace-pre-wrap">
                                {entry.content}
                              </p>
                            )}
                            {expandedEntries.has(entry.id) && entry.sourceUrl && (
                              <p className="text-xs text-muted-foreground mt-1 italic">
                                Source: {entry.sourceUrl}
                              </p>
                            )}
                            {expandedEntries.has(entry.id) && isFlagged && (
                              <div className="mt-2 space-y-1">
                                {entryConflicts.map((c, ci) => (
                                  <div key={ci} className="flex items-start gap-1.5 text-xs">
                                    <AlertTriangle className={`h-3 w-3 mt-0.5 shrink-0 ${severityColor(c.severity)}`} />
                                    <span className="text-muted-foreground leading-relaxed">{c.description}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="shrink-0 text-muted-foreground hover:text-destructive"
                            aria-label="Delete knowledge entry"
                            onClick={(e) => { e.stopPropagation(); setDeleteId(entry.id); }}
                            data-testid={`button-delete-entry-${entry.id}`}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Dialog open={deleteId !== null} onOpenChange={(open) => { if (!open) setDeleteId(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Delete Knowledge Entry</DialogTitle>
          </DialogHeader>
          {(() => {
            const entryToDelete = deleteId ? (entries.find(e => e.id === deleteId) as KnowledgeEntryWithFilename | undefined) : null;
            return (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  This will permanently remove this entry from the knowledge base. The AI Analyst will no longer reference it.
                </p>
                {entryToDelete && (
                  <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 space-y-1.5" data-testid="delete-entry-preview">
                    <div className="flex items-center gap-1.5">
                      <Badge variant="outline" className="text-[9px]">#{entryToDelete.id}</Badge>
                      <span className="text-xs font-semibold">{entryToDelete.title}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-3">{entryToDelete.content}</p>
                    <div className="flex flex-col gap-0.5">
                      <p className="text-xs text-muted-foreground">Category: {entryToDelete.category}</p>
                      {(entryToDelete.sourceFilename || entryToDelete.sourceUrl) && (
                        <p className="text-xs text-muted-foreground truncate">
                          Source: {entryToDelete.sourceFilename || entryToDelete.sourceUrl}
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)} data-testid="button-cancel-delete">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function PendingKnowledgeBanner() {
  const { toast } = useToast();
  const pendingQuery = useQuery<PendingKnowledge[]>({
    queryKey: ["/api/knowledge/pending"],
  });

  const pending = pendingQuery.data || [];

  const [reviewBatchId, setReviewBatchId] = useState<string | null>(null);
  const [reviewEntries, setReviewEntries] = useState<PendingKnowledge[]>([]);
  const [reviewFilename, setReviewFilename] = useState("");

  if (pending.length === 0) return null;

  const batches = pending.reduce((acc, entry) => {
    if (!acc[entry.batchId]) {
      acc[entry.batchId] = { filename: entry.sourceFilename, entries: [] };
    }
    acc[entry.batchId].entries.push(entry);
    return acc;
  }, {} as Record<string, { filename: string; entries: PendingKnowledge[] }>);

  const handleOpenReview = (batchId: string, filename: string, entries: PendingKnowledge[]) => {
    setReviewBatchId(batchId);
    setReviewEntries(entries);
    setReviewFilename(filename);
  };

  return (
    <>
      <Card className="p-4 border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/10" data-testid="card-pending-knowledge">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-amber-100 dark:bg-amber-900/30">
            <AlertCircle className="h-4.5 w-4.5 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-sm font-semibold">Pending Knowledge Review</h3>
              <Badge variant="secondary" className="text-[10px] bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                {pending.length} entries
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mb-2">
              Uploaded documents have extracted knowledge awaiting your approval.
            </p>
            <div className="space-y-1.5">
              {Object.entries(batches).map(([batchId, batch]) => (
                <div key={batchId} className="flex items-center gap-2">
                  <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs font-medium truncate">{batch.filename}</span>
                  <Badge variant="outline" className="text-[10px]">{batch.entries.length} entries</Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-xs ml-auto"
                    onClick={() => handleOpenReview(batchId, batch.filename, batch.entries)}
                    data-testid={`button-review-batch-${batchId}`}
                  >
                    <Eye className="h-3 w-3 mr-1" />
                    Review
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Card>

      {reviewBatchId && (
        <KnowledgeReviewDialog
          entries={reviewEntries}
          batchId={reviewBatchId}
          filename={reviewFilename}
          open={!!reviewBatchId}
          onOpenChange={(open) => { if (!open) setReviewBatchId(null); }}
        />
      )}
    </>
  );
}

function UploadDeckCard() {
  const { toast } = useToast();
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadCategory, setUploadCategory] = useState("");
  const [uploadStatus, setUploadStatus] = useState<"idle" | "uploading" | "processing" | "review" | "error">("idle");
  const [uploadError, setUploadError] = useState("");
  const [pendingEntries, setPendingEntries] = useState<PendingKnowledge[]>([]);
  const [batchId, setBatchId] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadProgressMessage, setUploadProgressMessage] = useState("");

  const resetUpload = () => {
    setUploadFile(null);
    setUploadCategory("");
    setUploadStatus("idle");
    setUploadError("");
    setPendingEntries([]);
    setBatchId("");
    setUploadProgress(0);
    setUploadProgressMessage("");
  };

  const CHUNK_SIZE = 4 * 1024 * 1024;

  const handleUpload = async () => {
    if (!uploadFile) return;

    setUploadStatus("uploading");
    setUploadError("");

    try {
      let data: any;
      const useChunked = uploadFile.size > CHUNK_SIZE;

      if (!useChunked) {
        const formData = new FormData();
        formData.append("file", uploadFile);
        if (uploadCategory && uploadCategory !== "auto") formData.append("category", uploadCategory);

        const response = await fetch("/api/knowledge/upload", {
          method: "POST",
          body: formData,
        });

        data = await response.json();

        if (!response.ok) {
          setUploadStatus("error");
          setUploadError(data.error || "Upload failed");
          return;
        }
      } else {
        const uploadId = `up_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const totalChunks = Math.ceil(uploadFile.size / CHUNK_SIZE);

        for (let i = 0; i < totalChunks; i++) {
          const start = i * CHUNK_SIZE;
          const end = Math.min(start + CHUNK_SIZE, uploadFile.size);
          const chunk = uploadFile.slice(start, end);

          const formData = new FormData();
          formData.append("chunk", chunk, `chunk_${i}`);
          formData.append("uploadId", uploadId);
          formData.append("chunkIndex", String(i));
          formData.append("totalChunks", String(totalChunks));
          formData.append("filename", uploadFile.name);

          const res = await fetch("/api/chunked-upload", { method: "POST", body: formData });
          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            setUploadStatus("error");
            setUploadError(errData.error || "Chunk upload failed");
            return;
          }

          const chunkResult = await res.json();
          if (chunkResult.complete) {
            const analyzeRes = await fetch("/api/knowledge/upload-chunked", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                filePath: chunkResult.filePath,
                filename: chunkResult.filename,
                size: chunkResult.size,
                category: uploadCategory && uploadCategory !== "auto" ? uploadCategory : undefined,
              }),
            });
            if (!analyzeRes.ok) {
              const errData = await analyzeRes.json().catch(() => ({}));
              setUploadStatus("error");
              setUploadError(errData.error || "Processing failed");
              return;
            }
            data = await analyzeRes.json();
          }
        }

        if (!data) {
          setUploadStatus("error");
          setUploadError("Upload completed but file assembly failed. Please try again.");
          return;
        }
      }

      if (data.status === "processing" && data.jobId) {
        setUploadStatus("processing");
        setUploadProgress(data.progress || 0);
        setUploadProgressMessage(data.progressMessage || "Processing file...");
        const pollForResult = async (jobId: string, attempts = 0): Promise<void> => {
          if (attempts > 200) {
            setUploadStatus("error");
            setUploadError("Processing is taking too long. The file may be too large. Try a smaller document or try again later.");
            return;
          }
          await new Promise(r => setTimeout(r, 3000));
          try {
            const pollRes = await fetch(`/api/knowledge/upload-status/${jobId}`);
            if (pollRes.status === 404 && attempts > 10) {
              setUploadStatus("error");
              setUploadError("Processing job was lost. Please try uploading again.");
              return;
            }
            if (pollRes.status === 404) return pollForResult(jobId, attempts + 1);
            const pollData = await pollRes.json();
            if (pollData.progress !== undefined) setUploadProgress(pollData.progress);
            if (pollData.progressMessage) setUploadProgressMessage(pollData.progressMessage);
            if (pollData.status === "done") {
              setPendingEntries(pollData.entries || pollData.result?.entries || []);
              setBatchId(pollData.batchId || pollData.result?.batchId || jobId);
              setUploadStatus("review");
              queryClient.invalidateQueries({ queryKey: ["/api/knowledge/pending"] });
              toast({ title: "Knowledge extracted", description: `${pollData.entriesCount || pollData.result?.entriesCount || 0} entries ready for review.` });
              return;
            }
            if (pollData.status === "error") {
              setUploadStatus("error");
              setUploadError(pollData.error || "Processing failed");
              return;
            }
            return pollForResult(jobId, attempts + 1);
          } catch {
            return pollForResult(jobId, attempts + 1);
          }
        };
        await pollForResult(data.jobId);
      } else {
        setPendingEntries(data.entries);
        setBatchId(data.batchId);
        setUploadStatus("review");
        queryClient.invalidateQueries({ queryKey: ["/api/knowledge/pending"] });
        toast({ title: "Knowledge extracted", description: `${data.entriesCount} entries ready for review.` });
      }
    } catch (err: any) {
      setUploadStatus("error");
      setUploadError(err.message || "Upload failed");
    }
  };

  return (
    <>
      <Card className="p-4 border-card-border border-teal-200 dark:border-teal-800" data-testid="card-upload-deck">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-teal-100 dark:bg-teal-900/30">
            <Upload className="h-5 w-5 text-foreground/70" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-sm font-semibold">Document Upload</h3>
              <Badge variant="secondary" className="text-[10px] bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300">
                Knowledge Source
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed mb-2">
              Upload slide decks, PDFs, or documents. AI extracts knowledge entries for your review before adding to the knowledge base.
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => { resetUpload(); setIsUploadOpen(true); }}
              data-testid="button-upload-file"
            >
              <Upload className="h-3 w-3 mr-1" />
              Upload Document
            </Button>
          </div>
        </div>
      </Card>

      <Dialog open={isUploadOpen} onOpenChange={(open) => { if (!open && uploadStatus !== "uploading" && uploadStatus !== "processing") { setIsUploadOpen(false); } }}>
        <DialogContent className={uploadStatus === "review" ? "max-w-2xl max-h-[85vh] flex flex-col" : "max-w-lg"}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {uploadStatus === "review" ? (
                <>
                  <Eye className="h-5 w-5" />
                  Review Extracted Knowledge
                </>
              ) : (
                <>
                  <Upload className="h-5 w-5" />
                  Upload Document
                </>
              )}
            </DialogTitle>
            {uploadStatus === "review" && (
              <p className="text-xs text-muted-foreground">
                From {uploadFile?.name} — review, edit, or delete entries before approving them into the knowledge base.
              </p>
            )}
          </DialogHeader>

          {uploadStatus === "idle" && (
            <div className="space-y-4 py-2">
              <div
                className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors"
                role="button"
                tabIndex={0}
                onClick={() => document.getElementById("file-upload-input")?.click()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    document.getElementById("file-upload-input")?.click();
                  }
                }}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const file = e.dataTransfer.files[0];
                  if (file) setUploadFile(file);
                }}
                data-testid="upload-drop-zone"
              >
                {uploadFile ? (
                  <div className="flex items-center justify-center gap-3">
                    <FileText className="h-8 w-8 text-primary" />
                    <div className="text-left">
                      <p className="font-medium text-sm">{uploadFile.name}</p>
                      <p className="text-xs text-muted-foreground">{(uploadFile.size / 1024).toFixed(0)} KB</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 ml-2"
                      aria-label="Clear selected file"
                      onClick={(e) => { e.stopPropagation(); setUploadFile(null); }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <>
                    <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                    <p className="text-sm font-medium">Drop a file here or click to browse</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Supports PPTX, PDF, DOCX, TXT (max 50MB)
                    </p>
                  </>
                )}
                <input
                  id="file-upload-input"
                  type="file"
                  className="hidden"
                  accept=".pptx,.pptm,.pdf,.ppt,.docx,.txt"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) setUploadFile(file);
                    e.target.value = "";
                  }}
                  data-testid="input-file-upload"
                />
              </div>
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-border" />
                <span className="text-xs text-muted-foreground">or import from</span>
                <div className="flex-1 h-px bg-border" />
              </div>
              <GoogleDrivePickerButton onFileSelected={(file) => setUploadFile(file)} />

              <div>
                <label className="text-sm font-medium mb-1.5 block">Category hint (optional)</label>
                <Select value={uploadCategory} onValueChange={setUploadCategory}>
                  <SelectTrigger data-testid="select-upload-category">
                    <SelectValue placeholder="Auto-detect from content" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto-detect from content</SelectItem>
                    {KNOWLEDGE_CATEGORIES.map((cat) => (
                      <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  AI will categorize entries automatically. Choose a category to bias the classification.
                </p>
              </div>
            </div>
          )}

          {(uploadStatus === "uploading" || uploadStatus === "processing") && (
            <div className="py-8 space-y-4">
              <div className="flex items-center justify-center gap-3">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <div>
                  <p className="font-medium text-sm" data-testid="text-upload-status">
                    {uploadStatus === "uploading" ? "Uploading file..." : (uploadProgressMessage || "AI is extracting knowledge...")}
                  </p>
                  <p className="text-xs text-muted-foreground" data-testid="text-upload-detail">
                    {uploadStatus === "processing"
                      ? `${uploadProgress}% complete`
                      : "Sending file to server"}
                  </p>
                </div>
              </div>
              <Progress value={uploadStatus === "uploading" ? 30 : uploadProgress} className="h-1.5" data-testid="progress-upload" />
            </div>
          )}

          {uploadStatus === "review" && (
            <KnowledgeReviewInline
              entries={pendingEntries}
              batchId={batchId}
              onDone={() => { setIsUploadOpen(false); resetUpload(); }}
            />
          )}

          {uploadStatus === "error" && (
            <div className="py-6 text-center space-y-3">
              <div className="text-destructive">
                <X className="h-8 w-8 mx-auto mb-2" />
                <p className="font-medium text-sm">Upload failed</p>
                <p className="text-xs text-muted-foreground mt-1">{uploadError}</p>
              </div>
            </div>
          )}

          {uploadStatus !== "review" && (
            <DialogFooter>
              {uploadStatus === "idle" && (
                <>
                  <Button variant="outline" onClick={() => setIsUploadOpen(false)}>Cancel</Button>
                  <Button
                    onClick={handleUpload}
                    disabled={!uploadFile}
                    data-testid="button-start-upload"
                  >
                    <Upload className="h-4 w-4 mr-2" />
                    Upload & Extract
                  </Button>
                </>
              )}
              {uploadStatus === "error" && (
                <>
                  <Button variant="outline" onClick={() => setIsUploadOpen(false)}>Close</Button>
                  <Button onClick={() => { resetUpload(); }}>Try Again</Button>
                </>
              )}
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function KnowledgeReviewInline({ entries: initialEntries, batchId, onDone }: {
  entries: PendingKnowledge[];
  batchId: string;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [entries, setEntries] = useState<PendingKnowledge[]>(initialEntries);
  const [isApprovingAll, setIsApprovingAll] = useState(false);
  const [allDone, setAllDone] = useState(false);
  const [approvedCount, setApprovedCount] = useState(0);

  const pendingEntries = entries.filter(e => e.status === "pending");

  const handleUpdate = async (id: number, data: { title?: string; content?: string; category?: string }) => {
    try {
      const res = await fetch(`/api/knowledge/pending/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Update failed");
      const updated = await res.json();
      setEntries(prev => prev.map(e => e.id === id ? updated : e));
      toast({ title: "Entry updated" });
    } catch {
      toast({ title: "Failed to update entry", variant: "destructive" });
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await fetch(`/api/knowledge/pending/${id}`, { method: "DELETE" });
      setEntries(prev => prev.filter(e => e.id !== id));
      queryClient.invalidateQueries({ queryKey: ["/api/knowledge/pending"] });
      toast({ title: "Entry removed" });
    } catch {
      toast({ title: "Failed to remove entry", variant: "destructive" });
    }
  };

  const handleApprove = async (id: number) => {
    try {
      const res = await fetch(`/api/knowledge/pending/${id}/approve`, { method: "POST" });
      if (!res.ok) throw new Error("Approve failed");
      setEntries(prev => prev.map(e => e.id === id ? { ...e, status: "approved" } : e));
      setApprovedCount(prev => prev + 1);
      queryClient.invalidateQueries({ queryKey: ["/api/knowledge"] });
      queryClient.invalidateQueries({ queryKey: ["/api/knowledge/pending"] });
      toast({ title: "Entry approved" });
    } catch {
      toast({ title: "Failed to approve entry", variant: "destructive" });
    }
  };

  const handleApproveAll = async () => {
    setIsApprovingAll(true);
    try {
      const res = await fetch(`/api/knowledge/pending/batch/${batchId}/approve-all`, { method: "POST" });
      if (!res.ok) throw new Error("Approve all failed");
      const data = await res.json();
      setEntries(prev => prev.map(e => e.status === "pending" ? { ...e, status: "approved" } : e));
      setApprovedCount(data.approvedCount);
      setAllDone(true);
      queryClient.invalidateQueries({ queryKey: ["/api/knowledge"] });
      queryClient.invalidateQueries({ queryKey: ["/api/knowledge/pending"] });
      toast({ title: "All entries approved", description: `${data.approvedCount} entries added to the knowledge base.` });
    } catch {
      toast({ title: "Failed to approve entries", variant: "destructive" });
    } finally {
      setIsApprovingAll(false);
    }
  };

  if (allDone) {
    return (
      <>
        <div className="py-8 text-center space-y-3">
          <CheckCircle className="h-12 w-12 mx-auto text-green-600 dark:text-green-400" />
          <div>
            <p className="font-semibold text-lg">{approvedCount} entries approved</p>
            <p className="text-sm text-muted-foreground mt-1">
              Knowledge added to the DB POV knowledge base.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { queryClient.invalidateQueries({ queryKey: ["/api/knowledge/pending"] }); setAllDone(false); setEntries([]); }}>
            Upload Another
          </Button>
          <Button onClick={() => { queryClient.invalidateQueries({ queryKey: ["/api/knowledge/pending"] }); onDone(); }} data-testid="button-review-done">
            Done
          </Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between px-1">
        <p className="text-sm text-muted-foreground">
          {pendingEntries.length} pending / {entries.length} total
        </p>
        {pendingEntries.length > 0 && (
          <Button
            size="sm"
            onClick={handleApproveAll}
            disabled={isApprovingAll}
            data-testid="button-approve-all-inline"
          >
            {isApprovingAll ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <CheckCircle className="h-3.5 w-3.5 mr-1.5" />
            )}
            Approve All ({pendingEntries.length})
          </Button>
        )}
      </div>

      <div className="border rounded-lg divide-y overflow-y-auto flex-1 min-h-0 max-h-[50vh]">
        {entries.map((entry) => (
          <PendingEntryCard
            key={entry.id}
            entry={entry}
            onUpdate={handleUpdate}
            onDelete={handleDelete}
            onApprove={handleApprove}
          />
        ))}
        {entries.length === 0 && (
          <div className="py-8 text-center text-sm text-muted-foreground">
            All entries have been removed.
          </div>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={() => { queryClient.invalidateQueries({ queryKey: ["/api/knowledge/pending"] }); onDone(); }}>
          Review Later
        </Button>
      </DialogFooter>
    </>
  );
}

function CollapsibleSourceSection({ title, icon, sources, testId }: { title: string; icon: React.ReactNode; sources: Source[]; testId: string }) {
  const [expanded, setExpanded] = useState(false);

  if (sources.length === 0) return null;

  return (
    <Card className="p-3 border-card-border" data-testid={testId}>
      <button
        className="flex items-center gap-3 w-full text-left"
        onClick={() => setExpanded(!expanded)}
        data-testid={`button-toggle-${testId}`}
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted">
          {icon}
        </div>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          <Badge variant="secondary" className="text-[10px]">{sources.length}</Badge>
        </div>
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
      </button>
      {expanded && (
        <div className="mt-3 space-y-2">
          {sources.map((source) => (
            <SourceCard key={source.id} source={source} />
          ))}
        </div>
      )}
    </Card>
  );
}

export default function Sources() {
  const [activeTab, setActiveTab] = useState<"sources" | "uploaded">("sources");
  const sourcesQuery = useQuery<Source[]>({
    queryKey: ["/api/sources"],
  });

  const sources = sourcesQuery.data || [];
  const pendingQuery = useQuery<PendingKnowledge[]>({
    queryKey: ["/api/knowledge/pending"],
  });
  const knowledgeQuery = useQuery<KnowledgeEntry[]>({
    queryKey: ["/api/knowledge"],
  });
  const pendingCount = pendingQuery.data?.length || 0;
  const knowledgeCount = knowledgeQuery.data?.length || 0;
  const uploadedDocsCount = sources.filter(s => s.feedUrl.startsWith("upload://")).length;
  const uploadedBadgeCount = pendingCount + knowledgeCount + uploadedDocsCount;

  return (
    <div className="flex flex-col h-full">
      <div className="border-b p-4 pb-0">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <h1 className="text-lg font-semibold" data-testid="text-sources-title">Sources</h1>
            <p className="text-xs text-muted-foreground">
              Manage RSS feeds, API integrations, and uploaded documents
            </p>
          </div>
          <div
            className={`flex items-center gap-2 ${activeTab === "sources" ? "" : "invisible"}`}
            aria-hidden={activeTab !== "sources"}
          >
            {sources.length > 0 && (
              <Badge variant="secondary" data-testid="badge-source-count">
                {sources.filter(s => s.isActive).length} active / {sources.length} total
              </Badge>
            )}
            <AddSourceDialog />
          </div>
        </div>
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "sources" | "uploaded")}>
          <TabsList className="mb-3">
            <TabsTrigger value="sources" data-testid="tab-sources">
              Sources
            </TabsTrigger>
            <TabsTrigger value="uploaded" className="gap-1.5" data-testid="tab-uploaded-sources">
              <Upload className="h-3.5 w-3.5" />
              Uploaded Sources
              {uploadedBadgeCount > 0 && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 ml-0.5">
                  {uploadedBadgeCount}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <div className="flex-1 overflow-auto p-4">
        {activeTab === "sources" ? (
          <>
            {sourcesQuery.isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Card key={i} className="p-4 border-card-border">
                    <div className="flex items-start gap-4">
                      <Skeleton className="h-10 w-10 rounded-md" />
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-2">
                          <Skeleton className="h-4 w-32" />
                          <Skeleton className="h-4 w-16 rounded" />
                        </div>
                        <Skeleton className="h-3 w-full" />
                        <div className="flex gap-4">
                          <Skeleton className="h-3 w-40" />
                          <Skeleton className="h-3 w-28" />
                        </div>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            ) : sources.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center px-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
                  <BookOpen className="h-8 w-8 text-muted-foreground" />
                </div>
                <h2 className="text-base font-semibold mb-1" data-testid="text-no-sources">No sources configured</h2>
                <p className="text-sm text-muted-foreground mb-4 max-w-sm">
                  Add RSS feed sources to start aggregating B2B MarTech news. Go to the News Feed page to load default sources.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <CompanyTracker sources={sources} />
                <CompetitorManager />
                <TopicTracker sources={sources} />
                <EmbeddingStatusCard />
                <NewsAPIStatusCard />
                <CollapsibleSourceSection
                  title="RSS Feeds"
                  icon={<Rss className="h-4 w-4 text-foreground/70" />}
                  sources={sources.filter(s => !s.feedUrl.includes("news.google.com/rss/search") && !s.name.startsWith("Company - ") && !s.feedUrl.startsWith("upload://"))}
                  testId="section-rss-feeds"
                />
              </div>
            )}
          </>
        ) : (
          <div className="space-y-3">
            <UploadDeckCard />
            <PendingKnowledgeBanner />
            <KnowledgeBaseSection />
            <CollapsibleSourceSection
              title="Uploaded Documents"
              icon={<FileText className="h-4 w-4 text-foreground/70" />}
              sources={sources.filter(s => s.feedUrl.startsWith("upload://"))}
              testId="section-uploaded-docs"
            />
          </div>
        )}
      </div>
    </div>
  );
}
