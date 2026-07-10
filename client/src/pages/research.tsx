import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Search, Globe, Play, Loader2, CheckCircle2, XCircle,
  AlertTriangle, ArrowRight, Plus, Trash2, ExternalLink,
  FileText, Building2, ChevronDown, ChevronRight, RotateCcw,
  Sparkles, Upload, Eye, Check, X, RefreshCw
} from "lucide-react";
import type { CrawlJob, CrawlEntry, Competitor } from "@shared/schema";
import { ConfirmDestructive } from "@/components/confirm-destructive";

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, { color: string; icon: any }> = {
    pending: { color: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20", icon: Loader2 },
    crawling: { color: "bg-blue-500/10 text-blue-600 border-blue-500/20", icon: Loader2 },
    crawled: { color: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20", icon: CheckCircle2 },
    extracting: { color: "bg-violet-500/10 text-violet-600 border-violet-500/20", icon: Sparkles },
    extracted: { color: "bg-green-500/10 text-green-600 border-green-500/20", icon: CheckCircle2 },
    error: { color: "bg-red-500/10 text-red-600 border-red-500/20", icon: XCircle },
    approved: { color: "bg-green-500/10 text-green-600 border-green-500/20", icon: Check },
    rejected: { color: "bg-red-500/10 text-red-600 border-red-500/20", icon: X },
    pushed_to_kb: { color: "bg-blue-500/10 text-blue-600 border-blue-500/20", icon: Upload },
    conflict: { color: "bg-orange-500/10 text-orange-600 border-orange-500/20", icon: AlertTriangle },
  };
  const v = variants[status] || variants.pending;
  const Icon = v.icon;
  const spinning = status === "crawling" || status === "extracting" || status === "pending";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${v.color}`} data-testid={`badge-status-${status}`}>
      <Icon className={`h-3 w-3 ${spinning ? "animate-spin" : ""}`} />
      {status.replace(/_/g, " ")}
    </span>
  );
}

function CompanyIntelTab() {
  const { toast } = useToast();
  const [crawlUrl, setCrawlUrl] = useState("https://www.demandbase.com");
  const [maxPages, setMaxPages] = useState(30);
  const [maxDepth, setMaxDepth] = useState(3);

  const jobsQuery = useQuery<CrawlJob[]>({
    queryKey: ["/api/research/crawl-jobs", "company"],
    queryFn: async () => {
      const res = await fetch("/api/research/crawl-jobs?type=company");
      return res.json();
    },
    refetchInterval: 5000,
  });

  const crawlMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/research/crawl", {
        url: crawlUrl,
        type: "company",
        maxPages,
        maxDepth,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/research/crawl-jobs", "company"] });
      toast({ title: "Crawl started", description: "Crawling Demandbase website in the background." });
    },
    onError: (err: any) => {
      toast({ title: "Crawl failed", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2" data-testid="text-company-intel-title">
            <Globe className="h-4 w-4 text-blue-500" />
            Demandbase Website Crawler
          </CardTitle>
          <CardDescription className="text-xs">
            Crawl the Demandbase website to extract product info, positioning, and competitive intelligence.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <label className="text-xs font-medium text-muted-foreground mb-1 block">URL</label>
              <Input
                value={crawlUrl}
                onChange={(e) => setCrawlUrl(e.target.value)}
                placeholder="https://www.demandbase.com"
                aria-label="Crawl URL"
                className="h-9 text-sm"
                data-testid="input-crawl-url"
              />
            </div>
            <div className="w-24">
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Max Pages</label>
              <Input
                type="number"
                value={maxPages}
                onChange={(e) => setMaxPages(parseInt(e.target.value) || 30)}
                className="h-9 text-sm"
                data-testid="input-max-pages"
              />
            </div>
            <div className="w-24">
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Depth</label>
              <Input
                type="number"
                value={maxDepth}
                onChange={(e) => setMaxDepth(parseInt(e.target.value) || 3)}
                className="h-9 text-sm"
                data-testid="input-max-depth"
              />
            </div>
            <Button
              onClick={() => crawlMutation.mutate()}
              disabled={crawlMutation.isPending || !crawlUrl}
              className="h-9"
              data-testid="button-start-crawl"
            >
              {crawlMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <Play className="h-4 w-4 mr-1" />
              )}
              Start Crawl
            </Button>
          </div>
        </CardContent>
      </Card>

      <CrawlJobsList jobs={jobsQuery.data || []} isLoading={jobsQuery.isLoading} />
    </div>
  );
}

function CompetitorResearchTab() {
  const { toast } = useToast();
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newName, setNewName] = useState("");
  const [newWebsite, setNewWebsite] = useState("");
  const [newDescription, setNewDescription] = useState("");

  const competitorsQuery = useQuery<Competitor[]>({
    queryKey: ["/api/research/competitors"],
  });

  const jobsQuery = useQuery<CrawlJob[]>({
    queryKey: ["/api/research/crawl-jobs", "competitor"],
    queryFn: async () => {
      const res = await fetch("/api/research/crawl-jobs?type=competitor");
      return res.json();
    },
    refetchInterval: 5000,
  });

  const addCompetitorMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/research/competitors", {
        name: newName,
        websiteUrl: newWebsite,
        description: newDescription,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/research/competitors"] });
      setShowAddDialog(false);
      setNewName("");
      setNewWebsite("");
      setNewDescription("");
      toast({ title: "Competitor added" });
    },
    onError: () => {
      toast({ title: "Couldn't add competitor", description: "Check the name and website URL, then try again.", variant: "destructive" });
    },
  });

  const deleteCompetitorMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/research/competitors/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/research/competitors"] });
      toast({ title: "Competitor removed" });
    },
    onError: () => {
      toast({ title: "Couldn't remove competitor", description: "The delete failed. Refresh and try again.", variant: "destructive" });
    },
  });

  const crawlCompetitorMutation = useMutation({
    mutationFn: async ({ url, competitorId }: { url: string; competitorId: number }) => {
      const res = await apiRequest("POST", "/api/research/crawl", {
        url,
        type: "competitor",
        competitorId,
        maxPages: 30,
        maxDepth: 2,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/research/crawl-jobs", "competitor"] });
      toast({ title: "Competitor crawl started" });
    },
    onError: () => {
      toast({ title: "Couldn't start competitor crawl", description: "The crawl request failed. Verify the website URL and try again.", variant: "destructive" });
    },
  });

  const competitors = competitorsQuery.data || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold" data-testid="text-competitors-title">Tracked Competitors</h3>
          <p className="text-xs text-muted-foreground">Track competitors and crawl their websites for intelligence.</p>
        </div>
        <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
          <DialogTrigger asChild>
            <Button size="sm" data-testid="button-add-competitor">
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add Competitor
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Competitor</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Company Name</label>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. 6sense" aria-label="Competitor name" data-testid="input-competitor-name" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Website URL</label>
                <Input value={newWebsite} onChange={(e) => setNewWebsite(e.target.value)} placeholder="https://www.6sense.com" aria-label="Competitor website URL" data-testid="input-competitor-website" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Description (optional)</label>
                <Textarea value={newDescription} onChange={(e) => setNewDescription(e.target.value)} placeholder="Brief description..." aria-label="Competitor description" rows={2} data-testid="input-competitor-description" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowAddDialog(false)}>Cancel</Button>
              <Button onClick={() => addCompetitorMutation.mutate()} disabled={!newName || addCompetitorMutation.isPending} data-testid="button-save-competitor">
                {addCompetitorMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {competitors.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-10">
            <Building2 className="h-8 w-8 text-muted-foreground/50 mb-2" />
            <p className="text-sm text-muted-foreground mb-1">No competitors tracked yet</p>
            <p className="text-xs text-muted-foreground">Add competitors to start crawling their websites for intelligence.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {competitors.map((comp) => {
            const compJobs = (jobsQuery.data || []).filter(j => j.competitorId === comp.id);
            const latestJob = compJobs[0];
            return (
              <Card key={comp.id} data-testid={`card-competitor-${comp.id}`}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="text-sm font-semibold" data-testid={`text-competitor-name-${comp.id}`}>{comp.name}</h4>
                        {comp.websiteUrl && (
                          <a href={comp.websiteUrl} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground" aria-label={`Open ${comp.name} website`}>
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                      {comp.description && (
                        <p className="text-xs text-muted-foreground line-clamp-1">{comp.description}</p>
                      )}
                      {latestJob && (
                        <div className="flex items-center gap-2 mt-2">
                          <StatusBadge status={latestJob.status} />
                          <span className="text-xs text-muted-foreground">
                            {latestJob.pagesCrawled} pages crawled, {latestJob.entriesExtracted} entries
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 ml-3">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => {
                          if (comp.websiteUrl) {
                            crawlCompetitorMutation.mutate({ url: comp.websiteUrl, competitorId: comp.id });
                          }
                        }}
                        disabled={!comp.websiteUrl || crawlCompetitorMutation.isPending}
                        data-testid={`button-crawl-competitor-${comp.id}`}
                      >
                        <Search className="h-3 w-3 mr-1" />
                        Crawl
                      </Button>
                      <ConfirmDestructive
                        title={`Remove "${comp.name}"?`}
                        description="This competitor and its tracking configuration are permanently removed. Past crawl jobs remain in crawl history. This can't be undone."
                        confirmLabel="Remove"
                        onConfirm={() => deleteCompetitorMutation.mutate(comp.id)}
                      >
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                          aria-label={`Delete competitor ${comp.name}`}
                          data-testid={`button-delete-competitor-${comp.id}`}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </ConfirmDestructive>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Separator />

      <CrawlJobsList jobs={jobsQuery.data || []} isLoading={jobsQuery.isLoading} />
    </div>
  );
}

function CrawlJobsList({ jobs, isLoading }: { jobs: CrawlJob[]; isLoading: boolean }) {
  const [expandedJob, setExpandedJob] = useState<number | null>(null);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (jobs.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-8">
          <FileText className="h-7 w-7 text-muted-foreground/50 mb-2" />
          <p className="text-sm text-muted-foreground">No crawl jobs yet</p>
          <p className="text-xs text-muted-foreground">Start a crawl to begin extracting intelligence.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold" data-testid="text-crawl-history">Crawl History</h3>
      {jobs.map((job) => (
        <Card key={job.id} data-testid={`card-crawl-job-${job.id}`}>
          <CardContent className="p-3">
            <div
              className="flex items-center justify-between cursor-pointer"
              role="button"
              tabIndex={0}
              aria-expanded={expandedJob === job.id}
              onClick={() => setExpandedJob(expandedJob === job.id ? null : job.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setExpandedJob(expandedJob === job.id ? null : job.id);
                }
              }}
              data-testid={`button-expand-job-${job.id}`}
            >
              <div className="flex items-center gap-3 min-w-0 flex-1">
                {expandedJob === job.id ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate" data-testid={`text-job-url-${job.id}`}>{job.rootUrl}</p>
                  <p className="text-xs text-muted-foreground">
                    {job.pagesCrawled}/{job.maxPages} pages | {job.entriesExtracted} entries | {new Date(job.createdAt).toLocaleString()}
                  </p>
                </div>
              </div>
              <StatusBadge status={job.status} />
            </div>
            {expandedJob === job.id && (
              <CrawlJobDetail jobId={job.id} jobStatus={job.status} />
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function CrawlJobDetail({ jobId, jobStatus }: { jobId: number; jobStatus: string }) {
  const { toast } = useToast();
  const [selectedEntries, setSelectedEntries] = useState<Set<number>>(new Set());
  const [expandedResearchEntries, setExpandedResearchEntries] = useState<Set<number>>(new Set());
  const [statusFilter, setStatusFilter] = useState<string>("");

  const entriesQuery = useQuery<{ entries: CrawlEntry[]; total: number }>({
    queryKey: ["/api/research/crawl-jobs", jobId, "entries", statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      params.set("limit", "100");
      const res = await fetch(`/api/research/crawl-jobs/${jobId}/entries?${params}`);
      return res.json();
    },
    refetchInterval: jobStatus === "extracting" ? 3000 : false,
  });

  const extractMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/research/crawl-jobs/${jobId}/extract`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/research/crawl-jobs"] });
      toast({ title: "AI Extraction started", description: "Extracting knowledge entries from crawled pages." });
    },
    onError: (err: any) => {
      toast({ title: "Extraction failed", description: err.message, variant: "destructive" });
    },
  });

  const batchStatusMutation = useMutation({
    mutationFn: async ({ ids, status }: { ids: number[]; status: string }) => {
      const res = await apiRequest("POST", "/api/research/entries/batch-status", { ids, status });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/research/crawl-jobs", jobId, "entries"] });
      setSelectedEntries(new Set());
      toast({ title: "Entries updated" });
    },
    onError: (_err, vars) => {
      toast({
        title: vars.status === "approved" ? "Couldn't approve entries" : "Couldn't reject entries",
        description: "The status update failed. Try again.",
        variant: "destructive",
      });
    },
  });

  const pushApprovedMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/research/entries/push-approved", { jobId });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/research/crawl-jobs", jobId, "entries"] });
      toast({
        title: "Pushed to Knowledge Base",
        description: `${data.pushed} entries pushed, ${data.conflicts} conflicts detected.`,
      });
    },
    onError: () => {
      toast({ title: "Couldn't push entries to Knowledge Base", description: "The push failed. Try again.", variant: "destructive" });
    },
  });

  const pushSingleMutation = useMutation({
    mutationFn: async (entryId: number) => {
      const res = await apiRequest("POST", `/api/research/entries/${entryId}/push-to-kb`);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/research/crawl-jobs", jobId, "entries"] });
      if (data.conflict) {
        toast({ title: "Conflict detected", description: data.conflictDescription, variant: "destructive" });
      } else {
        toast({ title: "Pushed to Knowledge Base" });
      }
    },
    onError: () => {
      toast({ title: "Couldn't push entry to Knowledge Base", description: "The push failed. Try again.", variant: "destructive" });
    },
  });

  const deleteJobMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/research/crawl-jobs/${jobId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/research/crawl-jobs"] });
      toast({ title: "Crawl job deleted" });
    },
    onError: () => {
      toast({ title: "Couldn't delete crawl job", description: "The delete failed. Refresh and try again.", variant: "destructive" });
    },
  });

  const entries = entriesQuery.data?.entries || [];
  const total = entriesQuery.data?.total || 0;
  const allSelected = entries.length > 0 && selectedEntries.size === entries.length;

  const groupedEntries = entries.reduce((acc, entry) => {
    if (!acc[entry.category]) acc[entry.category] = [];
    acc[entry.category].push(entry);
    return acc;
  }, {} as Record<string, CrawlEntry[]>);

  const toggleEntry = (id: number) => {
    const next = new Set(selectedEntries);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedEntries(next);
  };

  const toggleAll = () => {
    if (allSelected) {
      setSelectedEntries(new Set());
    } else {
      setSelectedEntries(new Set(entries.map(e => e.id)));
    }
  };

  return (
    <div className="mt-3 pt-3 border-t space-y-3" data-testid={`detail-job-${jobId}`}>
      <div className="flex items-center gap-2 flex-wrap">
        {jobStatus === "crawled" && (
          <Button
            size="sm"
            onClick={() => extractMutation.mutate()}
            disabled={extractMutation.isPending}
            className="h-7 text-xs"
            data-testid={`button-extract-${jobId}`}
          >
            {extractMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Sparkles className="h-3 w-3 mr-1" />}
            AI Extract Entries
          </Button>
        )}
        {(jobStatus === "extracted" || entries.length > 0) && (
          <>
            <div className="flex items-center gap-1 border rounded-md px-1">
              {["", "pending", "approved", "rejected", "pushed_to_kb", "conflict"].map((s) => (
                <Button
                  key={s}
                  variant={statusFilter === s ? "secondary" : "ghost"}
                  size="sm"
                  className="h-6 text-xs px-2"
                  onClick={() => setStatusFilter(s)}
                  data-testid={`button-filter-${s || "all"}`}
                >
                  {s === "" ? "All" : s.replace(/_/g, " ")}
                </Button>
              ))}
            </div>
            <div className="flex-1" />
            {selectedEntries.size > 0 && (
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => batchStatusMutation.mutate({ ids: Array.from(selectedEntries), status: "approved" })}
                  data-testid="button-batch-approve"
                >
                  <Check className="h-3 w-3 mr-1" />
                  Approve ({selectedEntries.size})
                </Button>
                <ConfirmDestructive
                  title={`Reject ${selectedEntries.size} ${selectedEntries.size === 1 ? "entry" : "entries"}?`}
                  description="Rejected entries are excluded from the Knowledge Base push. There is no bulk un-reject."
                  confirmLabel="Reject"
                  onConfirm={() => batchStatusMutation.mutate({ ids: Array.from(selectedEntries), status: "rejected" })}
                >
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    data-testid="button-batch-reject"
                  >
                    <X className="h-3 w-3 mr-1" />
                    Reject ({selectedEntries.size})
                  </Button>
                </ConfirmDestructive>
              </div>
            )}
            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={() => pushApprovedMutation.mutate()}
              disabled={pushApprovedMutation.isPending}
              data-testid="button-push-approved"
            >
              {pushApprovedMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Upload className="h-3 w-3 mr-1" />}
              Push Approved to KB
            </Button>
          </>
        )}
        <ConfirmDestructive
          title="Delete this crawl job?"
          description="The crawl job and all of its extracted entries are permanently deleted, including any not yet pushed to the Knowledge Base. This can't be undone."
          onConfirm={() => deleteJobMutation.mutate()}
        >
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs text-destructive hover:text-destructive"
            data-testid={`button-delete-job-${jobId}`}
          >
            <Trash2 className="h-3 w-3 mr-1" />
            Delete Job
          </Button>
        </ConfirmDestructive>
      </div>

      {entriesQuery.isLoading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : entries.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-4">
          {jobStatus === "crawled" ? "Click 'AI Extract Entries' to extract knowledge from crawled pages." :
           jobStatus === "extracting" ? "Extraction in progress..." :
           "No entries found for this filter."}
        </p>
      ) : (
        <ScrollArea className="max-h-[500px]">
          <div className="space-y-4">
            <div className="flex items-center gap-2 sticky top-0 bg-card z-10 pb-2">
              <Checkbox
                checked={allSelected}
                onCheckedChange={toggleAll}
                data-testid="checkbox-select-all"
              />
              <span className="text-xs text-muted-foreground">{total} entries total</span>
            </div>
            {Object.entries(groupedEntries).map(([category, catEntries]) => (
              <div key={category}>
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="outline" className="text-xs" data-testid={`badge-category-${category}`}>
                    {category}
                  </Badge>
                  <span className="text-xs text-muted-foreground">({catEntries.length})</span>
                </div>
                <div className="space-y-1.5 pl-1">
                  {catEntries.map((entry) => (
                    <div
                      key={entry.id}
                      className="flex items-start gap-2 p-2 rounded-md border bg-card hover:bg-accent/30 transition-colors"
                      data-testid={`card-entry-${entry.id}`}
                    >
                      <Checkbox
                        checked={selectedEntries.has(entry.id)}
                        onCheckedChange={() => toggleEntry(entry.id)}
                        className="mt-0.5"
                        data-testid={`checkbox-entry-${entry.id}`}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-sm font-medium" data-testid={`text-entry-title-${entry.id}`}>{entry.title}</span>
                          <StatusBadge status={entry.status} />
                        </div>
                        <p className={`text-xs text-muted-foreground ${expandedResearchEntries.has(entry.id) ? "" : "line-clamp-2"}`} data-testid={`text-entry-content-${entry.id}`}>
                          {entry.content}
                        </p>
                        <button
                          className="text-[10px] text-blue-500 hover:text-blue-600 font-medium"
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedResearchEntries(prev => {
                              const next = new Set(prev);
                              if (next.has(entry.id)) next.delete(entry.id);
                              else next.add(entry.id);
                              return next;
                            });
                          }}
                          data-testid={`button-expand-entry-${entry.id}`}
                        >
                          {expandedResearchEntries.has(entry.id) ? "Show less" : "Read full entry"}
                        </button>
                        {entry.sourceUrl && (
                          <a
                            href={entry.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[10px] text-blue-500 hover:underline mt-0.5 inline-flex items-center gap-0.5"
                          >
                            <ExternalLink className="h-2.5 w-2.5" />
                            Source
                          </a>
                        )}
                        {entry.conflictDescription && (
                          <div className="mt-1 p-1.5 rounded bg-orange-500/5 border border-orange-500/20">
                            <p className="text-xs text-orange-600 flex items-center gap-1">
                              <AlertTriangle className="h-3 w-3" />
                              {entry.conflictDescription}
                            </p>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-0.5 flex-shrink-0">
                        {entry.status === "pending" && (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0 text-green-600 hover:text-green-700"
                              onClick={() => batchStatusMutation.mutate({ ids: [entry.id], status: "approved" })}
                              aria-label="Approve entry"
                              data-testid={`button-approve-${entry.id}`}
                            >
                              <Check className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0 text-red-500 hover:text-red-600"
                              onClick={() => batchStatusMutation.mutate({ ids: [entry.id], status: "rejected" })}
                              aria-label="Reject entry"
                              data-testid={`button-reject-${entry.id}`}
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        )}
                        {entry.status === "approved" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-xs text-blue-600 hover:text-blue-700"
                            onClick={() => pushSingleMutation.mutate(entry.id)}
                            disabled={pushSingleMutation.isPending}
                            data-testid={`button-push-${entry.id}`}
                          >
                            <ArrowRight className="h-3 w-3 mr-0.5" />
                            Push
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

export default function ResearchPage() {
  return (
    <div className="h-full overflow-auto">
      <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-6">
        <div>
          <h1 className="text-lg font-semibold tracking-tight" data-testid="text-research-title">Research</h1>
          <p className="text-xs text-muted-foreground">
            Crawl websites to extract competitive intelligence and product knowledge.
          </p>
        </div>

        <Tabs defaultValue="company" className="w-full">
          <TabsList className="grid w-full grid-cols-2 max-w-md" data-testid="tabs-research">
            <TabsTrigger value="company" data-testid="tab-company-intel">
              <Globe className="h-3.5 w-3.5 mr-1.5" />
              Company Intel
            </TabsTrigger>
            <TabsTrigger value="competitor" data-testid="tab-competitor-research">
              <Building2 className="h-3.5 w-3.5 mr-1.5" />
              Competitor Research
            </TabsTrigger>
          </TabsList>
          <TabsContent value="company" className="mt-4">
            <CompanyIntelTab />
          </TabsContent>
          <TabsContent value="competitor" className="mt-4">
            <CompetitorResearchTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
