import { useState, useCallback, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { KnowledgeEntry, PendingKnowledge, ProductKnowledge, ProductFeature } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { VoiceInputButton } from "@/components/VoiceInputButton";
import { ConfirmDestructive } from "@/components/confirm-destructive";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChevronDown,
  ChevronRight,
  Edit,
  Trash2,
  Plus,
  Eye,
  EyeOff,
  Search,
  Database,
  ExternalLink,
  BookOpen,
  Globe,
  Link,
  Loader2,
  Check,
  X,
  CheckCheck,
  AlertTriangle,
  ArrowRightLeft,
  Package,
  Save,
  Sparkles,
  RotateCcw,
  Layers,
  CornerDownRight,
  GripVertical,
  ArrowRight,
  Copy,
} from "lucide-react";
import {
  DndContext,
  DragOverlay,
  useDraggable,
  useDroppable,
  PointerSensor,
  useSensor,
  useSensors,
  pointerWithin,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";

const CATEGORIES = [
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

type KnowledgeSource = {
  sourceUrl: string;
  entryCount: number;
  entries: Array<{ id: number; title: string; category: string; isActive: boolean }>;
};

type DuplicateMatch = {
  type: "url" | "similar";
  existing: { id: number; title: string; content: string; category: string; sourceUrl: string | null };
  newEntry: { title: string; content: string; category: string; confidence: number };
};

type UrlResponse = {
  success: boolean;
  hasDuplicates: boolean;
  batchId: string;
  duplicates?: DuplicateMatch[];
  entries: PendingKnowledge[];
  url: string;
};

function getConfidenceColor(confidence: number): string {
  if (confidence >= 90) return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400";
  if (confidence >= 70) return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400";
  return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400";
}

function getConfidenceLabel(confidence: number): string {
  if (confidence >= 90) return "High";
  if (confidence >= 70) return "Medium";
  return "Low";
}

function SourcesTab() {
  const { toast } = useToast();
  const [isAddUrlOpen, setIsAddUrlOpen] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set());
  const [deleteSourceTarget, setDeleteSourceTarget] = useState<KnowledgeSource | null>(null);
  const [urlResponse, setUrlResponse] = useState<UrlResponse | null>(null);
  const [urlPhase, setUrlPhase] = useState<"input" | "loading" | "duplicates" | "review" | "done">("input");
  const [reviewEntries, setReviewEntries] = useState<PendingKnowledge[]>([]);
  const [editingPendingId, setEditingPendingId] = useState<number | null>(null);
  const [editingPendingData, setEditingPendingData] = useState<{ title: string; content: string; category: string }>({ title: "", content: "", category: "" });
  const [approvedCount, setApprovedCount] = useState(0);

  const { data: sources = [], isLoading } = useQuery<KnowledgeSource[]>({
    queryKey: ["/api/knowledge/sources"],
  });

  const deleteSourceMutation = useMutation({
    mutationFn: async (sourceUrl: string) => {
      const res = await apiRequest("DELETE", "/api/knowledge/sources", { sourceUrl });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/knowledge/sources"] });
      queryClient.invalidateQueries({ queryKey: ["/api/knowledge"] });
      setDeleteSourceTarget(null);
      toast({ title: `Removed source and ${data.deletedCount} entries` });
    },
    onError: () => {
      toast({ title: "Couldn't remove source", description: "The server didn't respond. Try again.", variant: "destructive" });
    },
  });

  const fetchUrlMutation = useMutation({
    mutationFn: async (url: string) => {
      const res = await apiRequest("POST", "/api/knowledge/url", { url });
      return res.json() as Promise<UrlResponse>;
    },
    onSuccess: (data) => {
      setUrlResponse(data);
      if (data.hasDuplicates) {
        setUrlPhase("duplicates");
        setReviewEntries(data.entries);
      } else {
        setUrlPhase("review");
        setReviewEntries(data.entries);
      }
    },
    onError: (err: any) => {
      setUrlPhase("input");
      toast({ title: "Error", description: err.message || "Failed to process URL", variant: "destructive" });
    },
  });

  const confirmUrlMutation = useMutation({
    mutationFn: async ({ batchId, action, sourceUrl, duplicateEntryIds }: { batchId: string; action: string; sourceUrl?: string; duplicateEntryIds?: number[] }) => {
      const res = await apiRequest("POST", "/api/knowledge/url/confirm", { batchId, action, sourceUrl, duplicateEntryIds });
      return res.json();
    },
    onSuccess: (_, variables) => {
      if (variables.action === "cancel") {
        resetUrlDialog();
        toast({ title: "Cancelled" });
      } else {
        setUrlPhase("review");
      }
    },
    onError: () => {
      toast({ title: "Couldn't resolve duplicates", description: "The server didn't respond. Try again.", variant: "destructive" });
    },
  });

  const approvePendingMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/knowledge/pending/${id}/approve`);
      return res.json();
    },
    onSuccess: () => {
      setApprovedCount(prev => prev + 1);
      queryClient.invalidateQueries({ queryKey: ["/api/knowledge"] });
      queryClient.invalidateQueries({ queryKey: ["/api/knowledge/sources"] });
    },
    onError: () => {
      toast({ title: "Couldn't approve entry", description: "The server didn't respond. Try again.", variant: "destructive" });
    },
  });

  const deletePendingMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/knowledge/pending/${id}`);
    },
    onError: () => {
      toast({ title: "Couldn't discard entry", description: "The server didn't respond. Try again.", variant: "destructive" });
    },
  });

  const updatePendingMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: { title?: string; content?: string; category?: string } }) => {
      const res = await apiRequest("PATCH", `/api/knowledge/pending/${id}`, data);
      return res.json();
    },
    onSuccess: (updated) => {
      setReviewEntries(prev => prev.map(e => e.id === updated.id ? updated : e));
      setEditingPendingId(null);
      toast({ title: "Entry updated" });
    },
    onError: () => {
      toast({ title: "Couldn't update entry", description: "The server didn't respond. Try again.", variant: "destructive" });
    },
  });

  const approveAllMutation = useMutation({
    mutationFn: async (batchId: string) => {
      const res = await apiRequest("POST", `/api/knowledge/pending/batch/${batchId}/approve-all`);
      return res.json();
    },
    onSuccess: (data) => {
      setApprovedCount(data.approvedCount || reviewEntries.length);
      setReviewEntries([]);
      setUrlPhase("done");
      queryClient.invalidateQueries({ queryKey: ["/api/knowledge"] });
      queryClient.invalidateQueries({ queryKey: ["/api/knowledge/sources"] });
    },
    onError: () => {
      toast({ title: "Couldn't approve entries", description: "The server didn't respond. Try again.", variant: "destructive" });
    },
  });

  const resetUrlDialog = () => {
    setIsAddUrlOpen(false);
    setUrlInput("");
    setUrlPhase("input");
    setUrlResponse(null);
    setReviewEntries([]);
    setEditingPendingId(null);
    setApprovedCount(0);
  };

  const handleSubmitUrl = () => {
    if (!urlInput.trim()) return;
    setUrlPhase("loading");
    fetchUrlMutation.mutate(urlInput.trim());
  };

  const handleApproveEntry = async (entry: PendingKnowledge) => {
    try {
      await approvePendingMutation.mutateAsync(entry.id);
    } catch {
      return; // onError already surfaced a toast
    }
    setReviewEntries(prev => prev.filter(e => e.id !== entry.id));
    if (reviewEntries.length <= 1) {
      setUrlPhase("done");
    }
  };

  const handleDeleteEntry = async (entry: PendingKnowledge) => {
    try {
      await deletePendingMutation.mutateAsync(entry.id);
    } catch {
      return; // onError already surfaced a toast
    }
    setReviewEntries(prev => prev.filter(e => e.id !== entry.id));
    if (reviewEntries.length <= 1) {
      setUrlPhase("done");
    }
  };

  const startEditPending = (entry: PendingKnowledge) => {
    setEditingPendingId(entry.id);
    setEditingPendingData({ title: entry.title, content: entry.content, category: entry.category });
  };

  const saveEditPending = () => {
    if (editingPendingId) {
      updatePendingMutation.mutate({ id: editingPendingId, data: editingPendingData });
    }
  };

  const toggleSourceExpand = (url: string) => {
    setExpandedSources(prev => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url); else next.add(url);
      return next;
    });
  };

  const truncateUrl = (url: string, max = 60) => {
    if (url.length <= max) return url;
    return url.substring(0, max) + "...";
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold" data-testid="text-sources-heading">Knowledge Sources</h2>
          <p className="text-sm text-muted-foreground">{sources.length} sources, ranked by number of entries</p>
        </div>
        <Button onClick={() => setIsAddUrlOpen(true)} data-testid="button-add-url-source">
          <Globe className="h-4 w-4 mr-2" />
          Add URL Source
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />)}
        </div>
      ) : sources.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Link className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No sources yet</h3>
            <p className="text-muted-foreground mb-4">Add a URL to extract knowledge entries from web pages.</p>
            <Button onClick={() => setIsAddUrlOpen(true)}>
              <Globe className="h-4 w-4 mr-2" />
              Add First Source
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {sources.map((source, idx) => {
            const isExpanded = expandedSources.has(source.sourceUrl);
            return (
              <Card key={source.sourceUrl} data-testid={`card-source-${idx}`}>
                <div className="flex items-center justify-between px-4 py-3">
                  <div
                    className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer"
                    onClick={() => toggleSourceExpand(source.sourceUrl)}
                    role="button"
                    tabIndex={0}
                    aria-expanded={isExpanded}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget) return;
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggleSourceExpand(source.sourceUrl);
                      }
                    }}
                  >
                    {isExpanded ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                    <div className="min-w-0 flex-1">
                      <a
                        href={source.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-medium hover:text-primary inline-flex items-center gap-1"
                        onClick={(e) => e.stopPropagation()}
                        data-testid={`link-source-${idx}`}
                      >
                        <ExternalLink className="h-3 w-3 shrink-0" />
                        <span className="truncate">{truncateUrl(source.sourceUrl)}</span>
                      </a>
                    </div>
                    <Badge variant="secondary" className="text-xs shrink-0">
                      {source.entryCount} {source.entryCount === 1 ? "entry" : "entries"}
                    </Badge>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive shrink-0 ml-2"
                    onClick={() => setDeleteSourceTarget(source)}
                    aria-label="Remove source and its entries"
                    data-testid={`button-delete-source-${idx}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                {isExpanded && (
                  <div className="px-4 pb-3 pt-0 border-t">
                    <div className="space-y-1 mt-2">
                      {source.entries.map(entry => (
                        <div key={entry.id} className={`flex items-center gap-2 text-sm py-1 ${!entry.isActive ? "opacity-50" : ""}`}>
                          <Badge variant="outline" className="text-[10px] shrink-0">{entry.category}</Badge>
                          <span className="truncate">{entry.title}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <AlertDialog open={!!deleteSourceTarget} onOpenChange={(open) => !open && setDeleteSourceTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Source</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove this source and all {deleteSourceTarget?.entryCount} knowledge {deleteSourceTarget?.entryCount === 1 ? "entry" : "entries"} associated with it. The AI agent will no longer have access to this information.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteSourceTarget && deleteSourceMutation.mutate(deleteSourceTarget.sourceUrl)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete-source"
            >
              {deleteSourceMutation.isPending ? "Removing..." : "Remove Source & Entries"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={isAddUrlOpen} onOpenChange={(open) => { if (!open) resetUrlDialog(); }}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          {urlPhase === "input" && (
            <>
              <DialogHeader>
                <DialogTitle>Add URL Source</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <p className="text-sm text-muted-foreground">
                  Paste a webpage URL and the AI will extract knowledge entries from its content.
                </p>
                <Input
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  placeholder="https://www.demandbase.com/..."
                  onKeyDown={(e) => e.key === "Enter" && handleSubmitUrl()}
                  aria-label="Webpage URL to extract knowledge from"
                  data-testid="input-url-source"
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={resetUrlDialog}>Cancel</Button>
                <Button
                  onClick={handleSubmitUrl}
                  disabled={!urlInput.trim()}
                  data-testid="button-submit-url"
                >
                  Extract Knowledge
                </Button>
              </DialogFooter>
            </>
          )}

          {urlPhase === "loading" && (
            <div className="py-12 text-center">
              <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary mb-4" />
              <h3 className="text-lg font-medium mb-2">Analyzing Page Content</h3>
              <p className="text-sm text-muted-foreground">Fetching the page, extracting text, and identifying knowledge entries...</p>
            </div>
          )}

          {urlPhase === "duplicates" && urlResponse && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-amber-500" />
                  Duplicate Content Detected
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <p className="text-sm text-muted-foreground">
                  We found existing entries that overlap with the content from this URL. Review and choose how to proceed.
                </p>
                {urlResponse.duplicates?.map((dup, idx) => (
                  <Card key={idx} className="border-amber-200 dark:border-amber-800">
                    <CardContent className="p-4 space-y-3">
                      <Badge variant="outline" className="text-xs">
                        {dup.type === "url" ? "Same URL" : "Similar Content"}
                      </Badge>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-1">EXISTING ENTRY</p>
                          <p className="text-sm font-medium">{dup.existing.title}</p>
                          <Badge variant="outline" className="text-[10px] mt-1">{dup.existing.category}</Badge>
                          <p className="text-xs text-muted-foreground mt-2 line-clamp-4">{dup.existing.content}</p>
                        </div>
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-1">NEW ENTRY</p>
                          <p className="text-sm font-medium">{dup.newEntry.title}</p>
                          <Badge variant="outline" className="text-[10px] mt-1">{dup.newEntry.category}</Badge>
                          <p className="text-xs text-muted-foreground mt-2 line-clamp-4">{dup.newEntry.content}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
              <DialogFooter className="flex-col sm:flex-row gap-2">
                <Button
                  variant="outline"
                  onClick={() => confirmUrlMutation.mutate({ batchId: urlResponse.batchId, action: "cancel" })}
                  disabled={confirmUrlMutation.isPending}
                  data-testid="button-cancel-duplicates"
                >
                  Cancel
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setUrlPhase("review");
                  }}
                  data-testid="button-keep-both"
                >
                  Keep Both
                </Button>
                <Button
                  onClick={() => {
                    const dupIds = urlResponse.duplicates?.map(d => d.existing.id) || [];
                    confirmUrlMutation.mutate({ batchId: urlResponse.batchId, action: "merge", sourceUrl: urlResponse.url, duplicateEntryIds: dupIds });
                  }}
                  disabled={confirmUrlMutation.isPending}
                  data-testid="button-merge-replace"
                >
                  <ArrowRightLeft className="h-4 w-4 mr-2" />
                  {confirmUrlMutation.isPending ? "Merging..." : "Replace Old with New"}
                </Button>
              </DialogFooter>
            </>
          )}

          {urlPhase === "review" && (
            <>
              <DialogHeader>
                <DialogTitle>Review Extracted Entries</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 py-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    {reviewEntries.length} {reviewEntries.length === 1 ? "entry" : "entries"} extracted — review, edit, then approve or delete each one.
                  </p>
                  {reviewEntries.length > 1 && urlResponse && (
                    <Button
                      size="sm"
                      onClick={() => approveAllMutation.mutate(urlResponse.batchId)}
                      disabled={approveAllMutation.isPending}
                      data-testid="button-approve-all"
                    >
                      <CheckCheck className="h-4 w-4 mr-1" />
                      {approveAllMutation.isPending ? "Approving..." : "Approve All"}
                    </Button>
                  )}
                </div>

                {reviewEntries.map((entry) => (
                  <Card key={entry.id} className="border" data-testid={`card-review-entry-${entry.id}`}>
                    <CardContent className="p-4">
                      {editingPendingId === entry.id ? (
                        <div className="space-y-3">
                          <Select
                            value={editingPendingData.category}
                            onValueChange={(v) => setEditingPendingData(prev => ({ ...prev, category: v }))}
                          >
                            <SelectTrigger className="w-full" data-testid={`select-pending-category-${entry.id}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {CATEGORIES.map(cat => <SelectItem key={cat} value={cat}>{cat}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <div className="flex items-center gap-1">
                            <Input
                              value={editingPendingData.title}
                              onChange={(e) => setEditingPendingData(prev => ({ ...prev, title: e.target.value }))}
                              data-testid={`input-pending-title-${entry.id}`}
                            />
                            <VoiceInputButton onTranscript={(text) => setEditingPendingData(prev => ({ ...prev, title: prev.title ? prev.title + " " + text : text }))} />
                          </div>
                          <div className="relative">
                            <Textarea
                              value={editingPendingData.content}
                              onChange={(e) => setEditingPendingData(prev => ({ ...prev, content: e.target.value }))}
                              rows={6}
                              data-testid={`textarea-pending-content-${entry.id}`}
                            />
                            <div className="absolute top-1.5 right-1.5">
                              <VoiceInputButton onTranscript={(text) => setEditingPendingData(prev => ({ ...prev, content: prev.content ? prev.content + " " + text : text }))} />
                            </div>
                          </div>
                          <div className="flex gap-2 justify-end">
                            <Button variant="outline" size="sm" onClick={() => setEditingPendingId(null)}>Cancel</Button>
                            <Button size="sm" onClick={saveEditPending} disabled={updatePendingMutation.isPending}>
                              {updatePendingMutation.isPending ? "Saving..." : "Save"}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div>
                          <div className="flex items-start justify-between gap-3 mb-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                {entry.confidence !== null && entry.confidence !== undefined && (
                                  <Badge className={`text-[10px] ${getConfidenceColor(entry.confidence)}`}>
                                    {getConfidenceLabel(entry.confidence)} ({entry.confidence}%)
                                  </Badge>
                                )}
                                <Badge variant="outline" className="text-[10px]">{entry.category}</Badge>
                              </div>
                              <h4 className="font-medium text-sm">{entry.title}</h4>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => startEditPending(entry)}
                                title="Edit"
                                aria-label="Edit extracted entry"
                                data-testid={`button-edit-pending-${entry.id}`}
                              >
                                <Edit className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-green-600"
                                onClick={() => handleApproveEntry(entry)}
                                disabled={approvePendingMutation.isPending}
                                title="Approve"
                                aria-label="Approve extracted entry"
                                data-testid={`button-approve-pending-${entry.id}`}
                              >
                                <Check className="h-3.5 w-3.5" />
                              </Button>
                              <ConfirmDestructive
                                title={`Discard "${entry.title}"?`}
                                description="This permanently deletes the extracted entry before it reaches the knowledge base. This can't be undone."
                                confirmLabel="Discard"
                                onConfirm={() => handleDeleteEntry(entry)}
                              >
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-destructive"
                                  disabled={deletePendingMutation.isPending}
                                  title="Delete"
                                  aria-label="Discard extracted entry"
                                  data-testid={`button-delete-pending-${entry.id}`}
                                >
                                  <X className="h-3.5 w-3.5" />
                                </Button>
                              </ConfirmDestructive>
                            </div>
                          </div>
                          <p className="text-sm text-muted-foreground whitespace-pre-wrap line-clamp-4">{entry.content}</p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}

                {reviewEntries.length === 0 && (
                  <div className="text-center py-8">
                    <Check className="h-12 w-12 mx-auto text-green-500 mb-3" />
                    <p className="font-medium">All entries reviewed</p>
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={resetUrlDialog}>
                  {reviewEntries.length === 0 ? "Done" : "Close"}
                </Button>
              </DialogFooter>
            </>
          )}

          {urlPhase === "done" && (
            <div className="py-8 text-center">
              <Check className="h-12 w-12 mx-auto text-green-500 mb-3" />
              <h3 className="text-lg font-medium mb-2">Source Added Successfully</h3>
              <p className="text-sm text-muted-foreground mb-4">
                {approvedCount} {approvedCount === 1 ? "entry" : "entries"} approved and added to the knowledge base.
              </p>
              <Button onClick={resetUrlDialog} data-testid="button-done-url">Done</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function KnowledgeBaseTab() {
  const { toast } = useToast();
  const [searchFilter, setSearchFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [editingEntry, setEditingEntry] = useState<KnowledgeEntry | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<KnowledgeEntry | null>(null);
  const [newEntry, setNewEntry] = useState({ category: "", title: "", content: "", sourceUrl: "" });

  const { data: entries = [], isLoading } = useQuery<KnowledgeEntry[]>({
    queryKey: ["/api/knowledge"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof newEntry) => {
      const res = await apiRequest("POST", "/api/knowledge", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/knowledge"] });
      setIsCreateOpen(false);
      setNewEntry({ category: "", title: "", content: "", sourceUrl: "" });
      toast({ title: "Entry created" });
    },
    onError: () => {
      toast({ title: "Couldn't create entry", description: "The server didn't respond. Try again.", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<KnowledgeEntry> }) => {
      const res = await apiRequest("PATCH", `/api/knowledge/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/knowledge"] });
      setEditingEntry(null);
      toast({ title: "Entry updated" });
    },
    onError: () => {
      toast({ title: "Couldn't update entry", description: "The server didn't respond. Try again.", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/knowledge/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/knowledge"] });
      setDeleteTarget(null);
      toast({ title: "Entry deleted" });
    },
    onError: () => {
      toast({ title: "Couldn't delete entry", description: "The server didn't respond. Try again.", variant: "destructive" });
    },
  });

  const toggleActive = (entry: KnowledgeEntry) => {
    updateMutation.mutate({ id: entry.id, data: { isActive: !entry.isActive } });
  };

  const filtered = entries.filter((e) => {
    if (categoryFilter !== "all" && e.category !== categoryFilter) return false;
    if (searchFilter) {
      const q = searchFilter.toLowerCase();
      return e.title.toLowerCase().includes(q) || e.content.toLowerCase().includes(q) || e.category.toLowerCase().includes(q);
    }
    return true;
  });

  const grouped: Record<string, KnowledgeEntry[]> = {};
  for (const entry of filtered) {
    if (!grouped[entry.category]) grouped[entry.category] = [];
    grouped[entry.category].push(entry);
  }

  const toggleCategory = (cat: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  };

  const expandAll = () => setExpandedCategories(new Set(Object.keys(grouped)));
  const collapseAll = () => setExpandedCategories(new Set());
  const usedCategories = [...new Set(entries.map((e) => e.category))];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div />
        <Button onClick={() => setIsCreateOpen(true)} data-testid="button-add-entry">
          <Plus className="h-4 w-4 mr-2" />
          Add Entry
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search knowledge base..."
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            className="pl-10"
            aria-label="Search knowledge base"
            data-testid="input-search-knowledge"
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-full sm:w-56" data-testid="select-category-filter">
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {usedCategories.sort().map((cat) => (
              <SelectItem key={cat} value={cat}>{cat}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={expandAll} data-testid="button-expand-all">Expand All</Button>
          <Button variant="outline" size="sm" onClick={collapseAll} data-testid="button-collapse-all">Collapse All</Button>
        </div>
      </div>

      <div className="flex gap-4 text-sm text-muted-foreground">
        <span data-testid="text-total-entries">{entries.length} total entries</span>
        <span>{Object.keys(grouped).length} categories</span>
        <span>{entries.filter((e) => e.isActive).length} active</span>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => <div key={i} className="h-24 bg-muted animate-pulse rounded-lg" />)}
        </div>
      ) : Object.keys(grouped).length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <BookOpen className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No knowledge entries yet</h3>
            <p className="text-muted-foreground mb-4">Add Demandbase product information, competitive intel, and messaging to power the AI agent.</p>
            <Button onClick={() => setIsCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add First Entry
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([category, catEntries]) => {
            const isExpanded = expandedCategories.has(category);
            const activeCount = catEntries.filter((e) => e.isActive).length;
            return (
              <Card key={category} data-testid={`card-category-${category.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>
                <CardHeader
                  className="cursor-pointer py-3 px-4"
                  onClick={() => toggleCategory(category)}
                  role="button"
                  tabIndex={0}
                  aria-expanded={isExpanded}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggleCategory(category);
                    }
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      <CardTitle className="text-base">{category}</CardTitle>
                      <Badge variant="secondary" className="text-xs">{catEntries.length}</Badge>
                      {activeCount < catEntries.length && (
                        <Badge variant="outline" className="text-xs text-muted-foreground">{catEntries.length - activeCount} disabled</Badge>
                      )}
                    </div>
                  </div>
                </CardHeader>
                {isExpanded && (
                  <CardContent className="pt-0 px-4 pb-4 space-y-2">
                    {catEntries.map((entry) => (
                      <div key={entry.id} className={`border rounded-lg p-4 ${!entry.isActive ? "opacity-50" : ""}`} data-testid={`entry-${entry.id}`}>
                        <div className="flex items-start justify-between gap-3 mb-2">
                          <div className="flex-1 min-w-0">
                            <h4 className="font-medium text-sm">{entry.title}</h4>
                            {entry.sourceUrl && (
                              <a href={entry.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-1 mt-0.5">
                                <ExternalLink className="h-3 w-3" />
                                Source
                              </a>
                            )}
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => toggleActive(entry)} title={entry.isActive ? "Disable" : "Enable"} aria-label={entry.isActive ? "Disable entry" : "Enable entry"} data-testid={`button-toggle-${entry.id}`}>
                              {entry.isActive ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditingEntry(entry)} aria-label="Edit entry" data-testid={`button-edit-${entry.id}`}>
                              <Edit className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setDeleteTarget(entry)} aria-label="Delete entry" data-testid={`button-delete-${entry.id}`}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                        <div className="text-sm text-muted-foreground whitespace-pre-wrap line-clamp-4">{entry.content}</div>
                      </div>
                    ))}
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Knowledge Entry</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Category</label>
              <Select value={newEntry.category} onValueChange={(v) => setNewEntry({ ...newEntry, category: v })}>
                <SelectTrigger data-testid="select-new-category"><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((cat) => <SelectItem key={cat} value={cat}>{cat}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Title</label>
              <div className="flex items-center gap-1">
                <Input value={newEntry.title} onChange={(e) => setNewEntry({ ...newEntry, title: e.target.value })} placeholder="e.g., B2B DSP Differentiators" aria-label="Entry title" data-testid="input-new-title" />
                <VoiceInputButton onTranscript={(text) => setNewEntry((prev) => ({ ...prev, title: prev.title ? prev.title + " " + text : text }))} />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Content</label>
              <div className="relative">
                <Textarea value={newEntry.content} onChange={(e) => setNewEntry({ ...newEntry, content: e.target.value })} placeholder="Enter the knowledge content..." rows={10} aria-label="Entry content" data-testid="input-new-content" />
                <div className="absolute top-1.5 right-1.5">
                  <VoiceInputButton onTranscript={(text) => setNewEntry((prev) => ({ ...prev, content: prev.content ? prev.content + " " + text : text }))} />
                </div>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Source URL (optional)</label>
              <Input value={newEntry.sourceUrl} onChange={(e) => setNewEntry({ ...newEntry, sourceUrl: e.target.value })} placeholder="https://www.demandbase.com/..." aria-label="Source URL" data-testid="input-new-source-url" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
            <Button onClick={() => createMutation.mutate(newEntry)} disabled={!newEntry.category || !newEntry.title || !newEntry.content || createMutation.isPending} data-testid="button-save-new">
              {createMutation.isPending ? "Saving..." : "Save Entry"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingEntry} onOpenChange={(open) => !open && setEditingEntry(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Knowledge Entry</DialogTitle>
          </DialogHeader>
          {editingEntry && (
            <div className="space-y-4 py-2">
              <div>
                <label className="text-sm font-medium mb-1.5 block">Category</label>
                <Select value={editingEntry.category} onValueChange={(v) => setEditingEntry({ ...editingEntry, category: v })}>
                  <SelectTrigger data-testid="select-edit-category"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((cat) => <SelectItem key={cat} value={cat}>{cat}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Title</label>
                <div className="flex items-center gap-1">
                  <Input value={editingEntry.title} onChange={(e) => setEditingEntry({ ...editingEntry, title: e.target.value })} data-testid="input-edit-title" />
                  <VoiceInputButton onTranscript={(text) => setEditingEntry((prev) => prev ? { ...prev, title: prev.title ? prev.title + " " + text : text } : prev)} />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Content</label>
                <div className="relative">
                  <Textarea value={editingEntry.content} onChange={(e) => setEditingEntry({ ...editingEntry, content: e.target.value })} rows={12} data-testid="input-edit-content" />
                  <div className="absolute top-1.5 right-1.5">
                    <VoiceInputButton onTranscript={(text) => setEditingEntry((prev) => prev ? { ...prev, content: prev.content ? prev.content + " " + text : text } : prev)} />
                  </div>
                </div>
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Source URL (optional)</label>
                <Input value={editingEntry.sourceUrl || ""} onChange={(e) => setEditingEntry({ ...editingEntry, sourceUrl: e.target.value })} data-testid="input-edit-source-url" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingEntry(null)}>Cancel</Button>
            <Button
              onClick={() => editingEntry && updateMutation.mutate({ id: editingEntry.id, data: { category: editingEntry.category, title: editingEntry.title, content: editingEntry.content, sourceUrl: editingEntry.sourceUrl } })}
              disabled={updateMutation.isPending}
              data-testid="button-save-edit"
            >
              {updateMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Entry</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deleteTarget?.title}"? This will remove it from the knowledge base and the AI agent will no longer use this information.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

const PRODUCT_FIELDS: { key: keyof ProductKnowledge; label: string; placeholder: string }[] = [
  { key: "keyCapabilities", label: "Key Capabilities", placeholder: "List the core features and capabilities of this product..." },
  { key: "idealCustomerProfile", label: "Key Personas", placeholder: "Who are the key buyers and champions for this product (titles, roles)..." },
  { key: "problemsItSolves", label: "Problems It Solves", placeholder: "What specific pain points does this product address..." },
  { key: "customerOutcomes", label: "Customer Outcomes & Metrics", placeholder: "Include specific results customers have achieved (e.g., 40% pipeline growth)..." },
  { key: "talkTrack", label: "Recommended Talk Track", placeholder: "A go-to opener or positioning statement a rep can use..." },
];

const FEATURE_FIELDS: { key: string; label: string; placeholder: string }[] = [
  { key: "keyCapabilities", label: "Key Capabilities", placeholder: "Core capabilities of this feature..." },
  { key: "keyPersonas", label: "Key Personas", placeholder: "Who are the key buyers and champions for this feature..." },
  { key: "problemsItSolves", label: "Problems It Solves", placeholder: "What pain points does this feature address..." },
  { key: "customerOutcomes", label: "Customer Outcomes & Metrics", placeholder: "Specific results customers have achieved..." },
  { key: "talkTrack", label: "Recommended Talk Track", placeholder: "A go-to opener for this specific feature..." },
];

function FeatureCard({ feature, onUpdate, onDelete, onToggle, allProducts, onMoveFeature, onDuplicateFeature }: {
  feature: ProductFeature;
  onUpdate: (id: number, data: Partial<ProductFeature>) => void;
  onDelete: (id: number) => void;
  onToggle: (id: number, isActive: boolean) => void;
  allProducts?: ProductKnowledge[];
  onMoveFeature?: (featureId: number, targetProductId: number) => void;
  onDuplicateFeature?: (feature: ProductFeature, targetProductId: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [showMoveMenu, setShowMoveMenu] = useState(false);
  const [showDuplicateMenu, setShowDuplicateMenu] = useState(false);
  const moveMenuRef = useRef<HTMLDivElement>(null);
  const duplicateMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showMoveMenu && !showDuplicateMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (showMoveMenu && moveMenuRef.current && !moveMenuRef.current.contains(e.target as Node)) {
        setShowMoveMenu(false);
      }
      if (showDuplicateMenu && duplicateMenuRef.current && !duplicateMenuRef.current.contains(e.target as Node)) {
        setShowDuplicateMenu(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setShowMoveMenu(false); setShowDuplicateMenu(false); }
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [showMoveMenu, showDuplicateMenu]);

  const startEditing = () => {
    setDraft({
      featureName: feature.featureName,
      keyCapabilities: feature.keyCapabilities,
      keyPersonas: feature.keyPersonas,
      problemsItSolves: feature.problemsItSolves,
      customerOutcomes: feature.customerOutcomes,
      talkTrack: feature.talkTrack,
    });
    setEditing(true);
    setExpanded(true);
  };

  const saveEdits = () => {
    onUpdate(feature.id, draft);
    setEditing(false);
  };

  const moveTargets = allProducts?.filter(p => p.id !== feature.productId && p.productType !== "suite") || [];
  const duplicateTargets = allProducts?.filter(p => p.productType !== "suite") || [];

  return (
    <div className={`border rounded-lg ${!feature.isActive ? "opacity-60" : ""}`} data-testid={`card-feature-${feature.id}`}>
      <div className="flex items-center justify-between p-3">
        <button
          className="flex items-center gap-2 text-left flex-1"
          onClick={() => setExpanded(!expanded)}
          data-testid={`button-toggle-feature-${feature.id}`}
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
          {editing ? (
            <Input
              value={draft.featureName || ""}
              onChange={(e) => setDraft({ ...draft, featureName: e.target.value })}
              onClick={(e) => e.stopPropagation()}
              className="text-sm font-medium h-7"
              aria-label="Feature name"
              data-testid={`input-feature-name-${feature.id}`}
            />
          ) : (
            <span className="text-sm font-medium">{feature.featureName}</span>
          )}
        </button>
        <div className="flex items-center gap-0.5 shrink-0">
          {editing ? (
            <>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={saveEdits} aria-label="Save feature changes" data-testid={`button-save-feature-${feature.id}`}>
                <Save className="h-3 w-3 text-green-600" />
              </Button>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { setEditing(false); setDraft({}); }} aria-label="Cancel feature editing" data-testid={`button-cancel-feature-${feature.id}`}>
                <X className="h-3 w-3 text-red-500" />
              </Button>
            </>
          ) : (
            <>
              {onMoveFeature && moveTargets.length > 0 && (
                <div className="relative" ref={moveMenuRef}>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { setShowMoveMenu(!showMoveMenu); setShowDuplicateMenu(false); }} aria-label="Move feature to another product" data-testid={`button-move-feature-${feature.id}`}>
                    <ArrowRight className="h-3 w-3" />
                  </Button>
                  {showMoveMenu && (
                    <div className="absolute right-0 top-7 z-50 bg-popover border rounded-md shadow-lg py-1 min-w-[200px] max-h-[200px] overflow-y-auto" data-testid={`menu-move-feature-${feature.id}`}>
                      <div className="px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase">Move to product</div>
                      {moveTargets.map(p => (
                        <button
                          key={p.id}
                          className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent transition-colors flex items-center gap-2"
                          onClick={() => { onMoveFeature(feature.id, p.id); setShowMoveMenu(false); }}
                          data-testid={`move-feature-${feature.id}-to-${p.id}`}
                        >
                          {p.parentId ? <CornerDownRight className="h-3 w-3 text-blue-500" /> : <Package className="h-3 w-3 text-muted-foreground" />}
                          {p.productName}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {onDuplicateFeature && duplicateTargets.length > 0 && (
                <div className="relative" ref={duplicateMenuRef}>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { setShowDuplicateMenu(!showDuplicateMenu); setShowMoveMenu(false); }} aria-label="Duplicate feature to another product" data-testid={`button-duplicate-feature-${feature.id}`}>
                    <Copy className="h-3 w-3" />
                  </Button>
                  {showDuplicateMenu && (
                    <div className="absolute right-0 top-7 z-50 bg-popover border rounded-md shadow-lg py-1 min-w-[200px] max-h-[200px] overflow-y-auto" data-testid={`menu-duplicate-feature-${feature.id}`}>
                      <div className="px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase">Duplicate to product</div>
                      {duplicateTargets.map(p => (
                        <button
                          key={p.id}
                          className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent transition-colors flex items-center gap-2"
                          onClick={() => { onDuplicateFeature(feature, p.id); setShowDuplicateMenu(false); }}
                          data-testid={`duplicate-feature-${feature.id}-to-${p.id}`}
                        >
                          {p.parentId ? <CornerDownRight className="h-3 w-3 text-blue-500" /> : <Package className="h-3 w-3 text-muted-foreground" />}
                          {p.productName}
                          {p.id === feature.productId && <span className="text-[10px] text-muted-foreground ml-auto">(same)</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onToggle(feature.id, !feature.isActive)} aria-label={feature.isActive ? "Disable feature" : "Enable feature"}>
                {feature.isActive ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
              </Button>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={startEditing} aria-label="Edit feature">
                <Edit className="h-3 w-3" />
              </Button>
              <ConfirmDestructive
                title={`Delete "${feature.featureName}"?`}
                description="This permanently deletes the feature and its capabilities, personas, and talk track. This can't be undone."
                onConfirm={() => onDelete(feature.id)}
              >
                <Button variant="ghost" size="icon" className="h-6 w-6" aria-label={`Delete feature "${feature.featureName}"`}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </ConfirmDestructive>
            </>
          )}
        </div>
      </div>
      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t pt-3">
          {FEATURE_FIELDS.map((field) => (
            <div key={field.key} className="space-y-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{field.label}</label>
              {editing ? (
                <Textarea
                  value={draft[field.key] || ""}
                  onChange={(e) => setDraft({ ...draft, [field.key]: e.target.value })}
                  placeholder={field.placeholder}
                  className="min-h-[80px] text-xs"
                  aria-label={field.label}
                  data-testid={`textarea-feature-${field.key}-${feature.id}`}
                />
              ) : (
                <div className="text-xs whitespace-pre-wrap bg-muted/20 rounded p-2 border" data-testid={`text-feature-${field.key}-${feature.id}`}>
                  {(feature as any)[field.key] || <span className="text-muted-foreground italic">Not set</span>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ProductCard({ product, onUpdate, onDelete, onToggle, isChild, allProducts, isDragOverlay, onAddSubProduct }: {
  product: ProductKnowledge;
  onUpdate: (id: number, data: Partial<ProductKnowledge>) => void;
  onDelete: (id: number) => void;
  onToggle: (id: number, isActive: boolean) => void;
  isChild?: boolean;
  allProducts?: ProductKnowledge[];
  isDragOverlay?: boolean;
  onAddSubProduct?: (parentId: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [featuresExpanded, setFeaturesExpanded] = useState(false);
  const [addingFeature, setAddingFeature] = useState(false);
  const [newFeatureName, setNewFeatureName] = useState("");
  const { toast } = useToast();

  const isSuite = product.productType === "suite";

  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: `product-${product.id}`,
    data: { type: "product", product },
    disabled: isDragOverlay || isSuite,
  });

  const { data: features = [] } = useQuery<ProductFeature[]>({
    queryKey: ["/api/product-knowledge", product.id, "features"],
    queryFn: async () => {
      const res = await fetch(`/api/product-knowledge/${product.id}/features`);
      return res.json();
    },
    enabled: expanded,
  });

  const updateFeatureMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<ProductFeature> }) => {
      const res = await apiRequest("PUT", `/api/product-features/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/product-knowledge", product.id, "features"] });
      toast({ title: "Feature updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to update feature", description: err.message, variant: "destructive" });
    },
  });

  const deleteFeatureMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/product-features/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/product-knowledge", product.id, "features"] });
      toast({ title: "Feature deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to delete feature", description: err.message, variant: "destructive" });
    },
  });

  const addFeatureMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("POST", `/api/product-knowledge/${product.id}/features`, {
        featureName: name,
        keyCapabilities: "",
        keyPersonas: "",
        problemsItSolves: "",
        customerOutcomes: "",
        talkTrack: "",
        sortOrder: features.length,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/product-knowledge", product.id, "features"] });
      setNewFeatureName("");
      setAddingFeature(false);
      toast({ title: "Feature added" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to add feature", description: err.message, variant: "destructive" });
    },
  });

  const moveFeatureMutation = useMutation({
    mutationFn: async ({ featureId, targetProductId }: { featureId: number; targetProductId: number }) => {
      const res = await apiRequest("PUT", `/api/product-features/${featureId}`, { productId: targetProductId });
      return res.json();
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/product-knowledge", product.id, "features"] });
      queryClient.invalidateQueries({ queryKey: ["/api/product-knowledge", vars.targetProductId, "features"] });
      const targetName = allProducts?.find(p => p.id === vars.targetProductId)?.productName || "another product";
      toast({ title: "Feature moved", description: `Moved to ${targetName}` });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to move feature", description: err.message, variant: "destructive" });
    },
  });

  const duplicateFeatureMutation = useMutation({
    mutationFn: async ({ feature: feat, targetProductId }: { feature: ProductFeature; targetProductId: number }) => {
      const res = await apiRequest("POST", `/api/product-knowledge/${targetProductId}/features`, {
        featureName: feat.featureName + (targetProductId === feat.productId ? " (Copy)" : ""),
        keyCapabilities: feat.keyCapabilities,
        keyPersonas: feat.keyPersonas,
        problemsItSolves: feat.problemsItSolves,
        customerOutcomes: feat.customerOutcomes,
        talkTrack: feat.talkTrack,
        sortOrder: 999,
      });
      return res.json();
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/product-knowledge", vars.targetProductId, "features"] });
      if (vars.targetProductId === product.id) {
        queryClient.invalidateQueries({ queryKey: ["/api/product-knowledge", product.id, "features"] });
      }
      const targetName = allProducts?.find(p => p.id === vars.targetProductId)?.productName || "another product";
      toast({ title: "Feature duplicated", description: `Copied to ${targetName}` });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to duplicate feature", description: err.message, variant: "destructive" });
    },
  });

  const startEditing = () => {
    setDraft({
      productName: product.productName,
      keyCapabilities: product.keyCapabilities,
      idealCustomerProfile: product.idealCustomerProfile,
      problemsItSolves: product.problemsItSolves,
      customerOutcomes: product.customerOutcomes,
      talkTrack: product.talkTrack,
    });
    setEditing(true);
    setExpanded(true);
  };

  const saveEdits = () => {
    onUpdate(product.id, draft);
    setEditing(false);
  };

  const cancelEdits = () => {
    setEditing(false);
    setDraft({});
  };

  const ProductIcon = isSuite ? Layers : (isChild ? CornerDownRight : Package);
  const iconColor = isSuite ? "text-amber-500" : (isChild ? "text-blue-500" : "text-primary");

  return (
    <Card
      ref={setDragRef}
      className={`${!product.isActive ? "opacity-60" : ""} ${isChild ? "border-l-2 border-l-blue-200 dark:border-l-blue-800" : ""} ${isDragging ? "opacity-30" : ""} transition-all`}
      data-testid={`card-product-${product.id}`}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          {!isDragOverlay && !editing && !isSuite && (
            <button
              className="shrink-0 cursor-grab active:cursor-grabbing p-1 -ml-1 mr-1 text-muted-foreground hover:text-foreground touch-none"
              {...listeners}
              {...attributes}
              aria-label={`Drag to move ${product.productName}`}
              data-testid={`drag-handle-product-${product.id}`}
            >
              <GripVertical className="h-4 w-4" />
            </button>
          )}
          <button
            className="flex items-center gap-2 text-left flex-1"
            onClick={() => setExpanded(!expanded)}
            data-testid={`button-toggle-product-${product.id}`}
          >
            {expanded ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
            <ProductIcon className={`h-5 w-5 ${iconColor} shrink-0`} />
            {editing ? (
              <Input
                value={draft.productName || ""}
                onChange={(e) => setDraft({ ...draft, productName: e.target.value })}
                onClick={(e) => e.stopPropagation()}
                className="text-lg font-semibold h-8"
                aria-label="Product name"
                data-testid={`input-product-name-${product.id}`}
              />
            ) : (
              <div>
                <div className="flex items-center gap-2">
                  <CardTitle className="text-lg">{product.productName}</CardTitle>
                  {isSuite && <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-amber-300 text-amber-600 dark:border-amber-600 dark:text-amber-400">Suite</Badge>}
                  {isChild && <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-blue-300 text-blue-600 dark:border-blue-600 dark:text-blue-400">Sub-product</Badge>}
                </div>
                {features.length > 0 && !expanded && (
                  <span className="text-xs text-muted-foreground">{features.length} feature{features.length !== 1 ? "s" : ""}</span>
                )}
              </div>
            )}
          </button>
          <div className="flex items-center gap-1 shrink-0">
            {editing ? (
              <>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={saveEdits} aria-label="Save product changes" data-testid={`button-save-product-${product.id}`}>
                  <Save className="h-3.5 w-3.5 text-green-600" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={cancelEdits} aria-label="Cancel product editing" data-testid={`button-cancel-product-${product.id}`}>
                  <X className="h-3.5 w-3.5 text-red-500" />
                </Button>
              </>
            ) : (
              <>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onToggle(product.id, !product.isActive)} aria-label={product.isActive ? "Disable product" : "Enable product"} data-testid={`button-toggle-active-product-${product.id}`}>
                  {product.isActive ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={startEditing} aria-label="Edit product" data-testid={`button-edit-product-${product.id}`}>
                  <Edit className="h-3.5 w-3.5" />
                </Button>
                <ConfirmDestructive
                  title={`Delete "${product.productName}"?`}
                  description={
                    isSuite
                      ? `This permanently deletes the "${product.productName}" suite and its product knowledge. This can't be undone.`
                      : `This permanently deletes "${product.productName}" and its features and talk tracks. This can't be undone.`
                  }
                  onConfirm={() => onDelete(product.id)}
                >
                  <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Delete ${isSuite ? "suite" : "product"} "${product.productName}"`} data-testid={`button-delete-product-${product.id}`}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </ConfirmDestructive>
              </>
            )}
          </div>
        </div>
      </CardHeader>
      {expanded && (
        <CardContent className="pt-0 space-y-4">
          {PRODUCT_FIELDS.map((field) => (
            <div key={field.key} className="space-y-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{field.label}</label>
              {editing ? (
                <Textarea
                  value={draft[field.key] || ""}
                  onChange={(e) => setDraft({ ...draft, [field.key]: e.target.value })}
                  placeholder={field.placeholder}
                  className="min-h-[100px] text-sm"
                  aria-label={field.label}
                  data-testid={`textarea-${field.key}-${product.id}`}
                />
              ) : (
                <div className="text-sm whitespace-pre-wrap bg-muted/30 rounded-md p-3 border" data-testid={`text-${field.key}-${product.id}`}>
                  {(product[field.key] as string) || <span className="text-muted-foreground italic">Not set</span>}
                </div>
              )}
            </div>
          ))}

          {onAddSubProduct && (
            <div className="border-t pt-4">
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => onAddSubProduct(product.id)}
                data-testid={`button-add-subproduct-${product.id}`}
              >
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                Add Sub-Product
              </Button>
            </div>
          )}

          <div className="border-t pt-4">
            <button
              className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setFeaturesExpanded(!featuresExpanded)}
              data-testid={`button-toggle-features-${product.id}`}
            >
              {featuresExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              <Sparkles className="h-3.5 w-3.5" />
              Features ({features.length})
            </button>

            {featuresExpanded && (
              <div className="mt-3 space-y-2">
                {features.map((feature) => (
                  <FeatureCard
                    key={feature.id}
                    feature={feature}
                    onUpdate={(id, data) => updateFeatureMutation.mutate({ id, data })}
                    onDelete={(id) => deleteFeatureMutation.mutate(id)}
                    onToggle={(id, isActive) => updateFeatureMutation.mutate({ id, data: { isActive } })}
                    allProducts={allProducts}
                    onMoveFeature={(featureId, targetProductId) => moveFeatureMutation.mutate({ featureId, targetProductId })}
                    onDuplicateFeature={(feat, targetProductId) => duplicateFeatureMutation.mutate({ feature: feat, targetProductId })}
                  />
                ))}
                {addingFeature ? (
                  <div className="flex items-center gap-2 p-2 border rounded-lg bg-muted/20">
                    <Input
                      value={newFeatureName}
                      onChange={(e) => setNewFeatureName(e.target.value)}
                      placeholder="Feature name..."
                      className="text-sm h-8 flex-1"
                      aria-label="New feature name"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && newFeatureName.trim()) addFeatureMutation.mutate(newFeatureName.trim());
                        if (e.key === "Escape") { setAddingFeature(false); setNewFeatureName(""); }
                      }}
                      data-testid={`input-new-feature-${product.id}`}
                    />
                    <Button
                      size="sm"
                      className="h-8"
                      onClick={() => newFeatureName.trim() && addFeatureMutation.mutate(newFeatureName.trim())}
                      disabled={!newFeatureName.trim() || addFeatureMutation.isPending}
                      data-testid={`button-confirm-feature-${product.id}`}
                    >
                      Add
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8" onClick={() => { setAddingFeature(false); setNewFeatureName(""); }} aria-label="Cancel adding feature">
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => setAddingFeature(true)}
                    data-testid={`button-add-feature-${product.id}`}
                  >
                    <Plus className="h-3.5 w-3.5 mr-1.5" />
                    Add Feature
                  </Button>
                )}
              </div>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function ProductsTab() {
  const { toast } = useToast();

  const { data: products = [], isLoading } = useQuery<ProductKnowledge[]>({
    queryKey: ["/api/product-knowledge"],
  });

  const { data: overlapsData } = useQuery<{ overlaps: KnowledgeEntry[]; count: number }>({
    queryKey: ["/api/product-knowledge/overlaps"],
    queryFn: async () => {
      const res = await fetch("/api/product-knowledge/overlaps");
      return res.json();
    },
    enabled: products.length > 0,
  });

  const deactivateOverlapsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/product-knowledge/deactivate-overlaps");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/product-knowledge/overlaps"] });
      queryClient.invalidateQueries({ queryKey: ["/api/knowledge"] });
      toast({ title: "Overlaps resolved", description: `${data.deactivated} knowledge base entries deactivated.` });
    },
    onError: () => {
      toast({ title: "Couldn't deactivate overlaps", description: "The server didn't respond. Try again.", variant: "destructive" });
    },
  });

  const seedMutation = useMutation({
    mutationFn: async (force: boolean) => {
      const res = await apiRequest("POST", "/api/product-knowledge/seed", { force });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/product-knowledge"] });
      toast({ title: "Products generated", description: `${data.count} product entries created from Demandbase knowledge.` });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to generate", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<ProductKnowledge> }) => {
      const res = await apiRequest("PUT", `/api/product-knowledge/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/product-knowledge"] });
      toast({ title: "Product updated" });
    },
    onError: () => {
      toast({ title: "Couldn't update product", description: "The server didn't respond. Try again.", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/product-knowledge/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/product-knowledge"] });
      toast({ title: "Product deleted" });
    },
    onError: () => {
      toast({ title: "Couldn't delete product", description: "The server didn't respond. Try again.", variant: "destructive" });
    },
  });

  const createProductMutation = useMutation({
    mutationFn: async (data: { productName: string; parentId?: number | null; productType?: string }) => {
      const res = await apiRequest("POST", "/api/product-knowledge", {
        productName: data.productName.trim(),
        parentId: data.parentId || null,
        productType: data.productType || "product",
        keyCapabilities: "",
        idealCustomerProfile: "",
        problemsItSolves: "",
        customerOutcomes: "",
        talkTrack: "",
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/product-knowledge"] });
      setAddProductDialog({ open: false, parentId: null, name: "" });
      toast({ title: "Product created" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to create product", description: err.message, variant: "destructive" });
    },
  });

  const [addProductDialog, setAddProductDialog] = useState<{ open: boolean; parentId: number | null; name: string }>({ open: false, parentId: null, name: "" });

  const [activeDragProduct, setActiveDragProduct] = useState<ProductKnowledge | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const { active } = event;
    if (active.data.current?.type === "product") {
      setActiveDragProduct(active.data.current.product);
    }
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveDragProduct(null);
    const { active, over } = event;
    if (!over || !active.data.current) return;

    const draggedProduct = active.data.current.product as ProductKnowledge;
    const overData = over.data.current;

    if (overData?.type === "suite") {
      const targetSuiteId = overData.suiteId as number;
      if (draggedProduct.parentId === targetSuiteId) return;
      if (draggedProduct.id === targetSuiteId) return;
      if (draggedProduct.productType === "suite") return;
      updateMutation.mutate(
        { id: draggedProduct.id, data: { parentId: targetSuiteId, productType: "product" } as any },
        {
          onSuccess: () => toast({ title: "Product moved", description: `${draggedProduct.productName} added to suite` }),
          onError: () => toast({ title: "Move failed", description: "Could not move product", variant: "destructive" }),
        }
      );
    } else if (overData?.type === "product-drop") {
      const targetProductId = overData.productId as number;
      if (draggedProduct.id === targetProductId) return;
      if (draggedProduct.parentId === targetProductId) return;
      if (draggedProduct.productType === "suite") return;
      const isDescendant = (parentId: number, childId: number): boolean => {
        const children = products.filter(p => p.parentId === childId);
        for (const c of children) {
          if (c.id === parentId) return true;
          if (isDescendant(parentId, c.id)) return true;
        }
        return false;
      };
      if (isDescendant(targetProductId, draggedProduct.id)) {
        toast({ title: "Cannot nest here", description: "This would create a circular hierarchy", variant: "destructive" });
        return;
      }
      updateMutation.mutate(
        { id: draggedProduct.id, data: { parentId: targetProductId } as any },
        {
          onSuccess: () => {
            const targetName = products.find(p => p.id === targetProductId)?.productName || "product";
            toast({ title: "Product nested", description: `${draggedProduct.productName} is now a sub-product of ${targetName}` });
          },
          onError: () => toast({ title: "Move failed", description: "Could not move product", variant: "destructive" }),
        }
      );
    } else if (overData?.type === "standalone-zone") {
      if (!draggedProduct.parentId) return;
      updateMutation.mutate(
        { id: draggedProduct.id, data: { parentId: null } as any },
        {
          onSuccess: () => toast({ title: "Product moved", description: `${draggedProduct.productName} is now a standalone product` }),
          onError: () => toast({ title: "Move failed", description: "Could not move product", variant: "destructive" }),
        }
      );
    }
  }, [updateMutation, toast, products]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center space-y-4">
          <Package className="h-12 w-12 mx-auto text-muted-foreground/30" />
          <div>
            <h3 className="font-medium text-muted-foreground">No product knowledge yet</h3>
            <p className="text-sm text-muted-foreground/70 mt-1">
              Auto-generate structured product entries from Demandbase's knowledge base, then review and refine each one.
            </p>
          </div>
          <Button
            onClick={() => seedMutation.mutate(false)}
            disabled={seedMutation.isPending}
            data-testid="button-seed-products"
          >
            {seedMutation.isPending ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Generating...</>
            ) : (
              <><Sparkles className="h-4 w-4 mr-2" />Auto-Generate Product Knowledge</>
            )}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const suites = products.filter(p => p.productType === "suite");
  const suiteIds = new Set(suites.map(s => s.id));
  const allParentIds = new Set(products.filter(p => p.parentId).map(p => p.parentId!));
  const childrenByParent: Record<number, ProductKnowledge[]> = {};
  const allChildIds = new Set<number>();
  products.forEach(p => {
    if (p.parentId) {
      if (!childrenByParent[p.parentId]) childrenByParent[p.parentId] = [];
      childrenByParent[p.parentId].push(p);
      allChildIds.add(p.id);
    }
  });
  const childProducts = products.filter(p => p.parentId && suiteIds.has(p.parentId));
  const standaloneProducts = products.filter(p => p.productType !== "suite" && !p.parentId && !allChildIds.has(p.id));

  return (
    <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="space-y-4">
        {overlapsData && overlapsData.count > 0 && (
          <div className="flex items-start gap-3 p-4 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30" data-testid="banner-overlaps">
            <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                {overlapsData.count} Knowledge Base {overlapsData.count === 1 ? "entry" : "entries"} may overlap with Product Knowledge
              </p>
              <p className="text-xs text-amber-700/80 dark:text-amber-400/70 mt-0.5">
                Product-related categories in the Knowledge Base are now covered by structured Product entries. Deactivating them avoids duplicate context in AI prompts.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 border-amber-300 text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:text-amber-300 dark:hover:bg-amber-900/50"
              onClick={() => deactivateOverlapsMutation.mutate()}
              disabled={deactivateOverlapsMutation.isPending}
              data-testid="button-deactivate-overlaps"
            >
              {deactivateOverlapsMutation.isPending ? (
                <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Deactivating...</>
              ) : (
                <><EyeOff className="h-3.5 w-3.5 mr-1.5" />Deactivate Overlaps</>
              )}
            </Button>
          </div>
        )}
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {products.length} product{products.length !== 1 ? "s" : ""} ({suites.length} suite{suites.length !== 1 ? "s" : ""}, {childProducts.length} sub-product{childProducts.length !== 1 ? "s" : ""}) {" "} {products.filter(p => p.isActive).length} active
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAddProductDialog({ open: true, parentId: null, name: "" })}
              data-testid="button-add-product"
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Add Product
            </Button>
            <ConfirmDestructive
              title="Reset products to defaults?"
              description="This regenerates the default product structure from Demandbase knowledge and overwrites your current products, suites, sub-products, and edits. This can't be undone."
              confirmLabel="Reset"
              onConfirm={() => seedMutation.mutate(true)}
            >
              <Button
                variant="outline"
                size="sm"
                disabled={seedMutation.isPending}
                data-testid="button-reset-products"
              >
                {seedMutation.isPending ? (
                  <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Resetting...</>
                ) : (
                  <><RotateCcw className="h-3.5 w-3.5 mr-1.5" />Reset to Defaults</>
                )}
              </Button>
            </ConfirmDestructive>
          </div>
        </div>
        {activeDragProduct && (
          <div className="text-xs text-muted-foreground flex items-center gap-2 px-2 py-1.5 bg-muted/50 rounded-md border border-dashed">
            <GripVertical className="h-3.5 w-3.5" />
            Drop on a suite or product to nest as sub-product, or on "Standalone Products" to make independent
          </div>
        )}
        {suites.map(suite => (
          <SuiteDropZone key={suite.id} suiteId={suite.id} isActive={!!activeDragProduct && activeDragProduct.productType !== "suite" && activeDragProduct.id !== suite.id}>
            <ProductCard
              product={suite}
              onUpdate={(id, data) => updateMutation.mutate({ id, data })}
              onDelete={(id) => deleteMutation.mutate(id)}
              onToggle={(id, isActive) => updateMutation.mutate({ id, data: { isActive } })}
              allProducts={products}
              onAddSubProduct={(parentId) => setAddProductDialog({ open: true, parentId, name: "" })}
            />
            {childrenByParent[suite.id]?.map(child => (
              <div key={child.id} className="ml-6">
                <ProductDropZone productId={child.id} isActive={!!activeDragProduct && activeDragProduct.id !== child.id && activeDragProduct.productType !== "suite"}>
                  <ProductCard
                    product={child}
                    onUpdate={(id, data) => updateMutation.mutate({ id, data })}
                    onDelete={(id) => deleteMutation.mutate(id)}
                    onToggle={(id, isActive) => updateMutation.mutate({ id, data: { isActive } })}
                    isChild
                    allProducts={products}
                    onAddSubProduct={(parentId) => setAddProductDialog({ open: true, parentId, name: "" })}
                  />
                </ProductDropZone>
              </div>
            ))}
          </SuiteDropZone>
        ))}
        <StandaloneDropZone isActive={!!activeDragProduct}>
          {standaloneProducts.map(product => (
            <div key={product.id}>
              <ProductDropZone productId={product.id} isActive={!!activeDragProduct && activeDragProduct.id !== product.id && activeDragProduct.productType !== "suite"}>
                <ProductCard
                  product={product}
                  onUpdate={(id, data) => updateMutation.mutate({ id, data })}
                  onDelete={(id) => deleteMutation.mutate(id)}
                  onToggle={(id, isActive) => updateMutation.mutate({ id, data: { isActive } })}
                  allProducts={products}
                  onAddSubProduct={(parentId) => setAddProductDialog({ open: true, parentId, name: "" })}
                />
              </ProductDropZone>
              {childrenByParent[product.id]?.map(child => (
                <div key={child.id} className="ml-6 mt-2">
                  <ProductDropZone productId={child.id} isActive={!!activeDragProduct && activeDragProduct.id !== child.id && activeDragProduct.productType !== "suite"}>
                    <ProductCard
                      product={child}
                      onUpdate={(id, data) => updateMutation.mutate({ id, data })}
                      onDelete={(id) => deleteMutation.mutate(id)}
                      onToggle={(id, isActive) => updateMutation.mutate({ id, data: { isActive } })}
                      isChild
                      allProducts={products}
                      onAddSubProduct={(parentId) => setAddProductDialog({ open: true, parentId, name: "" })}
                    />
                  </ProductDropZone>
                </div>
              ))}
            </div>
          ))}
        </StandaloneDropZone>
      </div>
      <DragOverlay>
        {activeDragProduct && (
          <div className="opacity-90 shadow-lg max-w-md">
            <Card className="border-primary">
              <CardHeader className="py-2 px-3">
                <div className="flex items-center gap-2">
                  <GripVertical className="h-4 w-4 text-muted-foreground" />
                  {activeDragProduct.productType === "suite" ? (
                    <Layers className="h-4 w-4 text-amber-500" />
                  ) : (
                    <Package className="h-4 w-4 text-primary" />
                  )}
                  <span className="text-sm font-medium">{activeDragProduct.productName}</span>
                </div>
              </CardHeader>
            </Card>
          </div>
        )}
      </DragOverlay>

      <Dialog open={addProductDialog.open} onOpenChange={(open) => { if (!open) setAddProductDialog({ open: false, parentId: null, name: "" }); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {addProductDialog.parentId
                ? `Add Sub-Product to ${products.find(p => p.id === addProductDialog.parentId)?.productName || "Product"}`
                : "Add Product"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Input
              value={addProductDialog.name}
              onChange={(e) => setAddProductDialog({ ...addProductDialog, name: e.target.value })}
              placeholder="Product name..."
              aria-label="Product name"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && addProductDialog.name.trim()) {
                  createProductMutation.mutate({
                    productName: addProductDialog.name,
                    parentId: addProductDialog.parentId,
                  });
                }
              }}
              data-testid="input-new-product-name"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAddProductDialog({ open: false, parentId: null, name: "" })}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (addProductDialog.name.trim()) {
                  createProductMutation.mutate({
                    productName: addProductDialog.name,
                    parentId: addProductDialog.parentId,
                  });
                }
              }}
              disabled={!addProductDialog.name.trim() || createProductMutation.isPending}
              data-testid="button-confirm-new-product"
            >
              {createProductMutation.isPending ? (
                <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Creating...</>
              ) : (
                <><Plus className="h-3.5 w-3.5 mr-1.5" />Create</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DndContext>
  );
}

function SuiteDropZone({ suiteId, children, isActive }: { suiteId: number; children: React.ReactNode; isActive: boolean }) {
  const { isOver, setNodeRef } = useDroppable({
    id: `suite-drop-${suiteId}`,
    data: { type: "suite", suiteId },
  });

  return (
    <div
      ref={setNodeRef}
      className={`space-y-2 ${isActive ? "p-2 -m-2 rounded-lg border-2 border-dashed transition-colors " + (isOver ? "border-amber-400 bg-amber-50/30 dark:bg-amber-950/20" : "border-transparent") : ""}`}
      data-testid={`suite-drop-zone-${suiteId}`}
    >
      {children}
    </div>
  );
}

function StandaloneDropZone({ children, isActive }: { children: React.ReactNode; isActive: boolean }) {
  const { isOver, setNodeRef } = useDroppable({
    id: "standalone-zone",
    data: { type: "standalone-zone" },
  });

  return (
    <div
      ref={setNodeRef}
      className={`space-y-4 ${isActive ? "p-3 -m-3 rounded-lg border-2 border-dashed transition-colors " + (isOver ? "border-primary bg-primary/5" : "border-muted-foreground/20") : ""}`}
      data-testid="standalone-drop-zone"
    >
      {isActive && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Package className="h-3.5 w-3.5" />
          Standalone Products
        </div>
      )}
      {children}
    </div>
  );
}

function ProductDropZone({ productId, children, isActive }: { productId: number; children: React.ReactNode; isActive: boolean }) {
  const { isOver, setNodeRef } = useDroppable({
    id: `product-drop-${productId}`,
    data: { type: "product-drop", productId },
  });

  return (
    <div
      ref={setNodeRef}
      className={isActive && isOver ? "ring-2 ring-blue-400 rounded-lg" : ""}
      data-testid={`product-drop-zone-${productId}`}
    >
      {children}
    </div>
  );
}

export default function DbPov() {
  const [activeTab, setActiveTab] = useState<"knowledge" | "sources" | "products">("knowledge");

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-lg font-semibold flex items-center gap-2" data-testid="text-dbpov-title">
            <Database className="h-6 w-6 text-primary" />
            DB Point of View
          </h1>
          <p className="text-muted-foreground mt-1">
            Demandbase knowledge base — edit, add, or remove entries to keep the AI agent accurate
          </p>
        </div>

        <div className="flex gap-1 border-b" data-testid="tabs-dbpov">
          <button
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "knowledge" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            onClick={() => setActiveTab("knowledge")}
            data-testid="tab-knowledge-base"
          >
            <BookOpen className="h-4 w-4 inline mr-2" />
            Knowledge Base
          </button>
          <button
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "products" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            onClick={() => setActiveTab("products")}
            data-testid="tab-products"
          >
            <Package className="h-4 w-4 inline mr-2" />
            Products
          </button>
          <button
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "sources" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            onClick={() => setActiveTab("sources")}
            data-testid="tab-sources"
          >
            <Globe className="h-4 w-4 inline mr-2" />
            Sources
          </button>
        </div>

        {activeTab === "knowledge" && <KnowledgeBaseTab />}
        {activeTab === "products" && <ProductsTab />}
        {activeTab === "sources" && <SourcesTab />}
      </div>
    </div>
  );
}
