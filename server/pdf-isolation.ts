import { fork } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

const MAX_TEXT_BYTES = 5 * 1024 * 1024;
const RSS_LIMIT_KB = 256 * 1024;
let activeParsers = 0;

export async function parsePdfIsolated(buffer: Buffer, options: { workerPath?: string; timeoutMs?: number } = {}): Promise<string> {
  if (buffer.length > 50 * 1024 * 1024) throw new Error("PDF input exceeds 50 MB limit");
  if (activeParsers >= 2) throw new Error("PDF parser capacity reached. Try again after current documents finish.");
  activeParsers++;
  try {
    return await new Promise<string>((resolve, reject) => {
      const workerPath = options.workerPath ?? (typeof __dirname !== "undefined" ? path.join(__dirname, "pdf-worker.cjs") : path.resolve("server/pdf-worker.cjs"));
      const child = fork(workerPath, [], {
        execArgv: ["--max-old-space-size=128"], serialization: "advanced",
        stdio: ["ignore", "ignore", "ignore", "ipc"],
        // Parser requires no application credentials or inherited Node hooks.
        env: { PATH: process.env.PATH, NODE_ENV: "production" },
      });
      let failure: Error | undefined;
      let text: string | undefined;
      const stop = (error: Error) => { failure ??= error; child.kill("SIGKILL"); };
      const timer = setTimeout(() => stop(new Error("PDF parsing timed out; parser was terminated")), options.timeoutMs ?? 30000);
      // Railway/Linux: monitor total resident memory as well as Node's hard V8 heap cap.
      // Sampling is not a kernel cgroup ceiling; short allocation spikes can exceed this limit.
      const memoryTimer = setInterval(() => {
        if (process.platform !== "linux" || !child.pid) return;
        readFile(`/proc/${child.pid}/status`, "utf8").then(status => {
          const rss = Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1] ?? 0);
          if (rss > RSS_LIMIT_KB) stop(new Error("PDF parser exceeded memory limit; parser was terminated"));
        }).catch(() => {}); // Process may have exited between sampling and read.
      }, 100);
      child.on("message", (message: any) => {
        if (typeof message?.error === "string") failure = new Error(`PDF parsing failed: ${message.error}`);
        else if (typeof message?.text === "string" && Buffer.byteLength(message.text) <= MAX_TEXT_BYTES) text = message.text;
        else stop(new Error("PDF parser returned invalid or oversized output"));
      });
      child.once("error", error => { failure = error; });
      child.once("close", (code) => {
        clearTimeout(timer); clearInterval(memoryTimer);
        if (failure) reject(failure);
        else if (code !== 0 || text === undefined) reject(new Error("PDF parsing failed: parser exited before producing text (invalid document or memory limit)"));
        else resolve(text);
      });
      child.send({ data: buffer }, error => { if (error) stop(new Error("PDF parsing failed: could not send input to isolated parser")); });
    });
  } finally { activeParsers--; }
}
