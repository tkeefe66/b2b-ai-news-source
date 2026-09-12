import { storage } from "./storage";

type RecoveryStore = Pick<typeof storage, "getActiveProcessingJobs" | "getCrawlJobs" | "updateProcessingJob" | "updateCrawlJob">;

export function scheduleInterruptedJobRecovery(startedAt: Date, options: { recover?: typeof recoverInterruptedJobs } = {}): () => void {
  // Start this once readiness succeeds. The grace period accommodates Railway's
  // zero-overlap/zero-drain handoff; it is not a distributed ownership lease.
  const recover = options.recover ?? recoverInterruptedJobs;
  let attempts = 0;
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout>;
  const schedule = () => {
    timer = setTimeout(async () => {
      if (cancelled) return;
      attempts++;
      try {
        await recover(startedAt);
      } catch (error) {
        console.error(`Interrupted job recovery failed (attempt ${attempts}/5).`, error);
        if (!cancelled && attempts < 5) schedule();
        else if (!cancelled) console.error("Interrupted job recovery stopped after five failures. Check database/schema availability and restart the service to retry.");
      }
    }, 30_000);
    timer.unref();
  };
  schedule();
  return () => { cancelled = true; clearTimeout(timer); };
}

export async function recoverInterruptedJobs(startedAt: Date, store: RecoveryStore = storage) {
  // Run after deployment handoff, preserving the original startup cutoff so new
  // jobs remain untouched. Multiple active workers require SQL ownership leases.
  const result = { processing: 0, crawls: 0 };
  for (const job of await store.getActiveProcessingJobs()) {
    if (["done", "error"].includes(job.status) || job.createdAt > startedAt) continue;
    await store.updateProcessingJob(job.jobId, {
      status: "error",
      progressMessage: "Interrupted by server restart",
      error: "Processing stopped during a server restart. Upload the file again, or restart the crawl.",
      completedAt: new Date(),
    } as any);
    result.processing++;
  }
  for (const job of await store.getCrawlJobs()) {
    if (!["pending", "crawling", "extracting"].includes(job.status) || job.createdAt > startedAt) continue;
    await store.updateCrawlJob(job.id, {
      status: "error",
      errorMessage: "Crawl interrupted by a server restart. Start the crawl or extraction again.",
      completedAt: new Date(),
    });
    result.crawls++;
  }
  console.log("Interrupted job recovery complete", result);
  return result;
}
