import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { FeedTag, FeedTagStatus } from "@shared/schema";

const STATUS_FILTERS: { value: FeedTagStatus | "all"; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "blocked", label: "Blocked" },
  { value: "all", label: "All" },
];

const STATUS_BADGE_VARIANT: Record<FeedTagStatus, "default" | "secondary" | "outline" | "destructive"> = {
  pending: "outline",
  approved: "default",
  rejected: "secondary",
  blocked: "destructive",
};

export default function FeedTagsTab() {
  const [statusFilter, setStatusFilter] = useState<FeedTagStatus | "all">("pending");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const tagsQuery = useQuery<FeedTag[]>({
    queryKey: ["/api/feed-tags", statusFilter],
    queryFn: async () => {
      const qs = statusFilter === "all" ? "" : `?status=${statusFilter}`;
      const res = await fetch(`/api/feed-tags${qs}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load tags");
      return res.json();
    },
  });

  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: FeedTagStatus }) => {
      await apiRequest("POST", `/api/feed-tags/${id}/status`, { status });
    },
    onSuccess: (_data, { status }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/feed-tags"] });
      queryClient.invalidateQueries({ queryKey: ["/api/articles/filters"] });
      queryClient.invalidateQueries({ queryKey: ["/api/articles"] });
      toast({ title: `Tag ${status}` });
    },
    onError: () => {
      toast({ title: "Failed to update tag", variant: "destructive" });
    },
  });

  const tags = tagsQuery.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-sm text-muted-foreground">
          Tags found in feeds. Approved tags appear as filters on the news feed. Blocked tags stop
          matching articles from being ingested at all.
        </p>
        <div className="flex gap-1">
          {STATUS_FILTERS.map((f) => (
            <Button
              key={f.value}
              size="sm"
              variant={statusFilter === f.value ? "default" : "outline"}
              onClick={() => setStatusFilter(f.value)}
              data-testid={`button-tag-filter-${f.value}`}
            >
              {f.label}
            </Button>
          ))}
        </div>
      </div>

      {tagsQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading tags…</p>
      ) : tags.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="text-no-tags">
          No {statusFilter === "all" ? "" : statusFilter + " "}tags yet. Tags appear here as feeds
          are fetched.
        </p>
      ) : (
        <div className="divide-y rounded-md border">
          {tags.map((tag) => (
            <div
              key={tag.id}
              className="flex items-center justify-between gap-3 p-3 flex-wrap"
              data-testid={`row-tag-${tag.name}`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="font-medium truncate">{tag.displayName}</span>
                <Badge variant={STATUS_BADGE_VARIANT[tag.status as FeedTagStatus]}>
                  {tag.status}
                </Badge>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  seen {tag.articleCount}×
                </span>
              </div>
              <div className="flex gap-1">
                {tag.status !== "approved" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={statusMutation.isPending}
                    onClick={() => statusMutation.mutate({ id: tag.id, status: "approved" })}
                    data-testid={`button-approve-tag-${tag.name}`}
                  >
                    Approve
                  </Button>
                )}
                {tag.status !== "rejected" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={statusMutation.isPending}
                    onClick={() => statusMutation.mutate({ id: tag.id, status: "rejected" })}
                    data-testid={`button-reject-tag-${tag.name}`}
                  >
                    Reject
                  </Button>
                )}
                {tag.status !== "blocked" && (
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={statusMutation.isPending}
                    onClick={() => statusMutation.mutate({ id: tag.id, status: "blocked" })}
                    data-testid={`button-block-tag-${tag.name}`}
                  >
                    Block
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
