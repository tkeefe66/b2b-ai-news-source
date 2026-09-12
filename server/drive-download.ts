import type { Readable } from "node:stream";

export const DRIVE_MAX_BYTES = 50 * 1024 * 1024;

export async function readDriveStream(stream: Readable, signal: AbortSignal, maxBytes = DRIVE_MAX_BYTES): Promise<Buffer> {
  const abort = () => stream.destroy(new Error("Google Drive download timed out. Try a smaller file or retry."));
  signal.addEventListener("abort", abort, { once: true });
  const chunks: Buffer[] = []; let size = 0;
  try {
    if (signal.aborted) abort();
    for await (const data of stream) {
      const chunk = Buffer.from(data); size += chunk.length;
      if (size > maxBytes) throw new Error("Google Drive file exceeds the 50 MB size limit.");
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, size);
  } finally {
    signal.removeEventListener("abort", abort);
    stream.destroy();
  }
}
