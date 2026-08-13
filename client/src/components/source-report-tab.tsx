import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ConfirmDestructive } from "@/components/confirm-destructive";
import { AlertTriangle, Trash2 } from "lucide-react";
import type { SourceReportRow } from "@shared/schema";
import { classifySource, dismissalRate, blockedDisplay } from "@shared/source-report";

type Filter = "all" | "silent" | "failing";
type SortKey = "name" | "count30d" | "countAll" | "lastArticleAt" | "dismissedAll" | "blockedAll";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "silent", label: "Silent" },
  { value: "failing", label: "Failing" },
];

function relativeDate(iso: string | null): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  const hours = (Date.now() - then) / 36e5;
  if (hours < 1) return "just now";
  if (hours < 24) return `${Math.floor(hours)}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function isStale(iso: string | null): boolean {
  if (!iso) return true;
  return Date.now() - new Date(iso).getTime() > 30 * 24 * 36e5;
}

function sortRows(rows: SourceReportRow[], key: SortKey, desc: boolean): SourceReportRow[] {
  const dir = desc ? -1 : 1;
  return [...rows].sort((a, b) => {
    if (key === "name") return a.name.localeCompare(b.name) * dir;
    if (key === "lastArticleAt") {
      const av = a.lastArticleAt ? new Date(a.lastArticleAt).getTime() : 0;
      const bv = b.lastArticleAt ? new Date(b.lastArticleAt).getTime() : 0;
      return (av - bv) * dir;
    }
    return ((a[key] as number) - (b[key] as number)) * dir;
  });
}

export default function SourceReportTab() {
  const [filter, setFilter] = useState<Filter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("count30d");
  const [sortDesc, setSortDesc] = useState(true);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const reportQuery = useQuery<SourceReportRow[]>({ queryKey: ["/api/sources/report"] });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/sources/report"] });
    queryClient.invalidateQueries({ queryKey: ["/api/sources"] });
  };

  const pauseMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: number; isActive: boolean }) => {
      await apiRequest("PATCH", `/api/sources/${id}`, { isActive });
    },
    onSuccess: invalidate,
    onError: () => toast({ title: "Could not update source", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/sources/${id}`);
    },
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["/api/articles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/articles/filters"] });
      toast({ title: "Source deleted" });
    },
    onError: () => toast({ title: "Could not delete source", variant: "destructive" }),
  });

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) { setSortDesc(!sortDesc); return; }
    setSortKey(key);
    setSortDesc(key !== "name");
  };

  if (reportQuery.isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    );
  }

  if (reportQuery.isError) {
    return <p className="text-sm text-destructive">Could not load the source report. Try again.</p>;
  }

  const all = reportQuery.data ?? [];
  const matches = (r: SourceReportRow) =>
    filter === "silent" ? r.count30d === 0 : r.failureDays > 0;
  const filtered = filter === "all" ? all : all.filter(matches);
  const rows = sortRows(filtered, sortKey, sortDesc);
  const silentCount = all.filter((r) => r.count30d === 0).length;

  const header = (key: SortKey, label: string, className = "") => (
    <TableHead className={className}>
      <button
        className="hover:underline"
        onClick={() => toggleSort(key)}
        data-testid={`sort-${key}`}
      >
        {label}{sortKey === key ? (sortDesc ? " ↓" : " ↑") : ""}
      </button>
    </TableHead>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {FILTERS.map((f) => (
          <Button
            key={f.value}
            size="sm"
            variant={filter === f.value ? "default" : "outline"}
            onClick={() => setFilter(f.value)}
            data-testid={`filter-${f.value}`}
          >
            {f.label}
          </Button>
        ))}
        <span className="text-xs text-muted-foreground ml-1">
          {all.length} sources · {silentCount} silent in 30d
        </span>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            {header("name", "Source")}
            {header("count30d", "30d", "text-right")}
            {header("countAll", "All", "text-right")}
            {header("lastArticleAt", "Last article")}
            {header("dismissedAll", "Dismissed", "text-right")}
            {header("blockedAll", "Blocked", "text-right")}
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id} data-testid={`report-row-${r.id}`}>
              <TableCell>
                <div className="flex items-center gap-2">
                  <span className={r.isActive ? "" : "text-muted-foreground line-through"}>{r.name}</span>
                  <Badge variant="secondary" className="text-[10px]">{r.category}</Badge>
                  {r.failureDays > 0 && (
                    <span className="flex items-center gap-1 text-xs text-destructive">
                      <AlertTriangle className="h-3 w-3" />
                      {r.failureDays}d failing
                    </span>
                  )}
                </div>
              </TableCell>
              <TableCell className="text-right tabular-nums">{r.count30d}</TableCell>
              <TableCell className="text-right tabular-nums">{r.countAll}</TableCell>
              <TableCell className={isStale(r.lastArticleAt) ? "text-muted-foreground" : ""}>
                {relativeDate(r.lastArticleAt)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {r.dismissedAll} <span className="text-muted-foreground">{dismissalRate(r)}</span>
              </TableCell>
              <TableCell className="text-right tabular-nums">{blockedDisplay(r)}</TableCell>
              <TableCell>
                <div className="flex items-center justify-end gap-2">
                  <Switch
                    checked={r.isActive}
                    onCheckedChange={(checked) => pauseMutation.mutate({ id: r.id, isActive: checked })}
                    aria-label={r.isActive ? `Pause ${r.name}` : `Resume ${r.name}`}
                  />
                  <ConfirmDestructive
                    title={`Delete "${r.name}"?`}
                    description={
                      r.countAll > 0
                        ? `This deletes the source and all ${r.countAll} of its articles. This can't be undone.`
                        : "This deletes the source. It has no articles. This can't be undone."
                    }
                    confirmLabel="Delete source"
                    onConfirm={() => deleteMutation.mutate(r.id)}
                  >
                    <Button variant="ghost" size="icon" aria-label={`Delete ${r.name}`}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </ConfirmDestructive>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {rows.length === 0 && (
        <p className="text-sm text-muted-foreground">No sources match this filter.</p>
      )}
    </div>
  );
}
