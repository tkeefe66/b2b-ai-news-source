import JSZip from "jszip";

type Limits = { maxEntryBytes?: number; maxTotalBytes?: number; maxEntries?: number };

export async function loadBoundedZip(buffer: Buffer, limits: Limits = {}) {
  const maxEntry = limits.maxEntryBytes ?? 12 * 1024 * 1024;
  const maxTotal = limits.maxTotalBytes ?? 80 * 1024 * 1024;
  const maxEntries = limits.maxEntries ?? 1000;
  const zip = await JSZip.loadAsync(buffer);
  const files = Object.values(zip.files).filter(file => !file.dir);
  if (files.length > maxEntries) throw new Error("Archive entry count exceeds limit");
  let declaredTotal = 0;
  for (const file of files) {
    // JSZip exposes sizes on the compressed object. Treat absent/invalid metadata as unsafe.
    const size = (file as any)._data?.uncompressedSize;
    if (!Number.isSafeInteger(size) || size < 0 || size > maxEntry) throw new Error("Archive expanded entry size exceeds limit");
    declaredTotal += size;
    if (declaredTotal > maxTotal) throw new Error("Archive expanded total size exceeds limit");
  }
  let actualTotal = 0;
  return {
    files: zip.files,
    async read(name: string): Promise<Buffer> {
      const file = zip.files[name];
      if (!file || file.dir) throw new Error("Archive entry not found");
      const stream = file.nodeStream() as import("node:stream").Readable;
      const chunks: Buffer[] = [];
      let size = 0;
      return new Promise<Buffer>((resolve, reject) => {
        stream.on("data", (chunk: Buffer) => {
          const bytes = Buffer.from(chunk); size += bytes.length; actualTotal += bytes.length;
          if (size > maxEntry || actualTotal > maxTotal) {
            stream.pause(); stream.destroy();
            reject(new Error("Archive expanded data exceeds limit"));
            return;
          }
          chunks.push(bytes);
        });
        stream.on("error", reject);
        stream.on("end", () => resolve(Buffer.concat(chunks, size)));
      });
    },
  };
}
