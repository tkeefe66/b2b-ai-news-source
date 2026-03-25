import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ProcessingJob } from "@shared/schema";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Layers,
  Loader2,
  CheckCircle2,
  AlertCircle,
  FileIcon,
} from "lucide-react";

const SECTION_LABELS: Record<string, string> = {
  knowledge: "Knowledge Base",
  "tl-documents": "TL Documents",
  "slide-outlines": "Slide Outlines",
  research: "Research",
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatElapsed(createdAt: string): string {
  const elapsed = Date.now() - new Date(createdAt).getTime();
  const seconds = Math.floor(elapsed / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

export function ProcessingQueue() {
  const [open, setOpen] = useState(false);

  const { data: jobs = [] } = useQuery<ProcessingJob[]>({
    queryKey: ["/api/processing-queue"],
    refetchInterval: open ? 3000 : 10000,
  });

  const activeJobs = jobs.filter(
    (j) => j.status !== "done" && j.status !== "completed" && j.status !== "error"
  );

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          data-testid="button-processing-queue"
          className="relative"
        >
          <Layers className="h-4 w-4" />
          {activeJobs.length > 0 && (
            <Badge
              data-testid="badge-active-jobs-count"
              className="absolute -top-1 -right-1 h-4 min-w-4 px-1 text-[10px] flex items-center justify-center no-default-hover-elevate"
            >
              {activeJobs.length}
            </Badge>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent side="right" data-testid="sheet-processing-queue">
        <SheetHeader>
          <SheetTitle data-testid="text-processing-queue-title">
            Processing Queue
          </SheetTitle>
          <SheetDescription data-testid="text-processing-queue-description">
            {activeJobs.length === 0
              ? "No active jobs"
              : `${activeJobs.length} active job${activeJobs.length !== 1 ? "s" : ""}`}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 flex flex-col gap-3 overflow-y-auto max-h-[calc(100vh-10rem)]">
          {jobs.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground"
              data-testid="text-empty-queue"
            >
              <FileIcon className="h-8 w-8" />
              <p className="text-sm">No processing jobs</p>
            </div>
          ) : (
            jobs.map((job) => (
              <JobCard key={job.id} job={job} />
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function JobCard({ job }: { job: ProcessingJob }) {
  const isError = job.status === "error";
  const isDone = job.status === "done" || job.status === "completed";

  return (
    <div
      data-testid={`card-job-${job.id}`}
      className={`rounded-md border p-3 flex flex-col gap-2 ${
        isError
          ? "border-destructive/50 bg-destructive/5"
          : isDone
            ? "border-green-500/50 bg-green-500/5"
            : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p
            className="text-sm font-medium truncate"
            data-testid={`text-filename-${job.id}`}
          >
            {job.filename}
          </p>
          <p
            className="text-xs text-muted-foreground"
            data-testid={`text-section-${job.id}`}
          >
            {SECTION_LABELS[job.section] || job.section}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {isError && (
            <AlertCircle
              className="h-4 w-4 text-destructive"
              data-testid={`icon-error-${job.id}`}
            />
          )}
          {isDone && (
            <CheckCircle2
              className="h-4 w-4 text-green-500"
              data-testid={`icon-done-${job.id}`}
            />
          )}
          {!isError && !isDone && (
            <Loader2
              className="h-4 w-4 animate-spin text-muted-foreground"
              data-testid={`icon-processing-${job.id}`}
            />
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span data-testid={`text-filesize-${job.id}`}>
          {formatFileSize(job.fileSize)}
        </span>
        <span data-testid={`text-elapsed-${job.id}`}>
          {formatElapsed(job.createdAt as unknown as string)}
        </span>
      </div>

      {!isDone && !isError && (
        <Progress
          value={job.progress}
          className="h-2"
          data-testid={`progress-bar-${job.id}`}
        />
      )}

      <p
        className={`text-xs ${isError ? "text-destructive" : "text-muted-foreground"}`}
        data-testid={`text-status-${job.id}`}
      >
        {isError ? job.error : job.progressMessage}
      </p>
    </div>
  );
}
