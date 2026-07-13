import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import type { FeedTag, FeedTagStatus } from "@shared/schema";

interface QueueTag {
  id: number;
  name: string;
  displayName: string;
  articleCount: number;
  sources: string[];
  count30d: number;
  countPrev30d: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  aiSummary: string | null;
  aiSuggestion: string | null;
}

interface QueueResponse {
  threshold: number;
  hiddenCount: number;
  tags: QueueTag[];
}

type View = "queue" | FeedTagStatus | "all";
type SuggestionVerb = "approve" | "reject" | "block";

const SUGGESTION_TO_STATUS: Record<SuggestionVerb, FeedTagStatus> = {
  approve: "approved",
  reject: "rejected",
  block: "blocked",
};

const VIEWS: { value: View; label: string }[] = [
  { value: "queue", label: "Review queue" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "blocked", label: "Blocked" },
  { value: "all", label: "All" },
];

function trendLabel(t: QueueTag): string {
  const dir = t.count30d > t.countPrev30d ? "↑ rising" : t.count30d < t.countPrev30d ? "↓ falling" : "steady";
  return `${t.count30d} article${t.count30d === 1 ? "" : "s"} in 30d · ${dir}`;
}

export default function FeedTagsTab() {
  const [view, setView] = useState<View>("queue");
  const [search, setSearch] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/feed-tags"] });
    queryClient.invalidateQueries({ queryKey: ["/api/feed-tags/queue"] });
    queryClient.invalidateQueries({ queryKey: ["/api/articles/filters"] });
    queryClient.invalidateQueries({ queryKey: ["/api/articles"] });
  };

  const queueQuery = useQuery<QueueResponse>({
    queryKey: ["/api/feed-tags/queue"],
    queryFn: async () => {
      const res = await fetch("/api/feed-tags/queue", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load review queue");
      return res.json();
    },
    enabled: view === "queue" && !search,
  });

  const listQuery = useQuery<FeedTag[]>({
    queryKey: ["/api/feed-tags", view, search],
    queryFn: async () => {
      const qs = search
        ? `?search=${encodeURIComponent(search)}`
        : view === "all" || view === "queue"
          ? ""
          : `?status=${view}`;
      const res = await fetch(`/api/feed-tags${qs}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load tags");
      return res.json();
    },
    enabled: Boolean(search) || (view !== "queue" && !search),
  });

  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: FeedTagStatus }) => {
      await apiRequest("POST", `/api/feed-tags/${id}/status`, { status });
    },
    onSuccess: (_d, { status }) => {
      invalidateAll();
      toast({ title: `Tag ${status}` });
    },
    onError: () => toast({ title: "Failed to update tag", variant: "destructive" }),
  });

  const bulkMutation = useMutation({
    mutationFn: async (items: { id: number; status: FeedTagStatus }[]) => {
      const res = await apiRequest("POST", "/api/feed-tags/bulk", { items });
      return res.json() as Promise<{ applied: number; failed: { id: number; error: string }[] }>;
    },
    onSuccess: (result) => {
      invalidateAll();
      toast({
        title:
          result.failed.length > 0
            ? `${result.applied} applied, ${result.failed.length} failed`
            : `${result.applied} suggestions applied`,
        variant: result.failed.length > 0 ? "destructive" : undefined,
      });
    },
    onError: () => toast({ title: "Bulk apply failed", variant: "destructive" }),
  });

  const queue = queueQuery.data;
  const annotated = (queue?.tags ?? []).filter(
    (t): t is QueueTag & { aiSuggestion: SuggestionVerb } =>
      t.aiSuggestion === "approve" || t.aiSuggestion === "reject" || t.aiSuggestion === "block"
  );

  const actionButton = (t: QueueTag, action: SuggestionVerb) => {
    const suggested = t.aiSuggestion === action;
    return (
      <Button
        size="sm"
        variant={suggested ? (action === "block" ? "destructive" : "default") : "outline"}
        disabled={statusMutation.isPending || bulkMutation.isPending}
        onClick={() => statusMutation.mutate({ id: t.id, status: SUGGESTION_TO_STATUS[action] })}
        data-testid={`button-${action}-tag-${t.name}`}
      >
        {action.charAt(0).toUpperCase() + action.slice(1)}
        {suggested ? " ✓" : ""}
      </Button>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex gap-1 flex-wrap">
          {VIEWS.map((v) => (
            <Button
              key={v.value}
              size="sm"
              variant={view === v.value && !search ? "default" : "outline"}
              onClick={() => {
                setView(v.value);
                setSearch("");
              }}
              data-testid={`button-tag-view-${v.value}`}
            >
              {v.label}
              {v.value === "queue" && queue && queue.tags.length > 0 ? ` (${queue.tags.length})` : ""}
            </Button>
          ))}
        </div>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search all tags…"
          className="h-8 w-56"
          data-testid="input-tag-search"
        />
      </div>

      {search ? (
        <TagRows tags={listQuery.data ?? []} loading={listQuery.isLoading} onAction={(id, status) => statusMutation.mutate({ id, status })} busy={statusMutation.isPending} />
      ) : view === "queue" ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-sm text-muted-foreground" data-testid="text-hidden-tags">
              {queueQuery.isError
                ? ""
                : queue
                  ? `${queue.hiddenCount} low-volume tags auto-hidden — they surface after ${queue.threshold} articles.`
                  : "Loading review queue…"}
            </p>
            {annotated.length > 0 && (
              <Button
                size="sm"
                disabled={bulkMutation.isPending}
                onClick={() =>
                  bulkMutation.mutate(
                    annotated.map((t) => ({ id: t.id, status: SUGGESTION_TO_STATUS[t.aiSuggestion] }))
                  )
                }
                data-testid="button-accept-all-suggestions"
              >
                Accept all suggestions ({annotated.length})
              </Button>
            )}
          </div>

          {queueQuery.isError ? (
            <p className="text-sm text-destructive" data-testid="text-queue-error">
              Couldn't load the review queue.{" "}
              <button className="underline" onClick={() => queueQuery.refetch()} data-testid="button-queue-retry">
                Retry
              </button>
            </p>
          ) : queueQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading review queue…</p>
          ) : (queue?.tags.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-queue-empty">
              Nothing needs review — new tags surface automatically once they prove out.
            </p>
          ) : (
            <div className="space-y-2">
              {queue!.tags.map((t) => (
                <div key={t.id} className="rounded-md border p-3 space-y-1.5" data-testid={`card-tag-${t.name}`}>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{t.displayName}</span>
                      {t.aiSuggestion && <Badge variant="outline">suggested: {t.aiSuggestion}</Badge>}
                    </div>
                    <div className="flex gap-1">
                      {actionButton(t, "approve")}
                      {actionButton(t, "reject")}
                      {actionButton(t, "block")}
                    </div>
                  </div>
                  {t.aiSummary && <p className="text-sm italic text-muted-foreground">{t.aiSummary}</p>}
                  <p className="text-xs text-muted-foreground">
                    {t.sources.length > 0 ? `from ${t.sources.join(", ")} · ` : ""}
                    {trendLabel(t)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <TagRows tags={listQuery.data ?? []} loading={listQuery.isLoading} onAction={(id, status) => statusMutation.mutate({ id, status })} busy={statusMutation.isPending} />
      )}
    </div>
  );
}

function TagRows({
  tags,
  loading,
  onAction,
  busy,
}: {
  tags: FeedTag[];
  loading: boolean;
  onAction: (id: number, status: FeedTagStatus) => void;
  busy: boolean;
}) {
  if (loading) return <p className="text-sm text-muted-foreground">Loading tags…</p>;
  if (tags.length === 0)
    return (
      <p className="text-sm text-muted-foreground" data-testid="text-no-tags">
        No matching tags.
      </p>
    );
  return (
    <div className="divide-y rounded-md border">
      {tags.map((tag) => (
        <div key={tag.id} className="flex items-center justify-between gap-3 p-3 flex-wrap" data-testid={`row-tag-${tag.name}`}>
          <div className="flex items-center gap-3 min-w-0">
            <span className="font-medium truncate">{tag.displayName}</span>
            <Badge variant="outline">{tag.status}</Badge>
            <span className="text-xs text-muted-foreground whitespace-nowrap">seen {tag.articleCount}×</span>
          </div>
          <div className="flex gap-1">
            {(["approve", "reject", "block"] as const)
              .filter((a) => {
                const target = a === "approve" ? "approved" : a === "reject" ? "rejected" : "blocked";
                return tag.status !== target;
              })
              .map((a) => (
                <Button
                  key={a}
                  size="sm"
                  variant={a === "block" ? "destructive" : "outline"}
                  disabled={busy}
                  onClick={() => onAction(tag.id, (a === "approve" ? "approved" : a === "reject" ? "rejected" : "blocked") as FeedTagStatus)}
                  data-testid={`button-${a}-tag-${tag.name}`}
                >
                  {a.charAt(0).toUpperCase() + a.slice(1)}
                </Button>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}
