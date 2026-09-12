import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
export const MAX_CHUNK_BYTES = 6 * 1024 * 1024;
const MAX_CHUNKS = 100;
const TTL = 30 * 60 * 1000;
const EXTENSIONS = new Set([".pptx", ".pptm", ".pdf", ".docx", ".txt", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".mov", ".avi", ".webm"]);
type Uploaded = { filePath: string; filename: string; size: number; owner: string; createdAt: number };
type Session = { filename: string; total: number; size: number; chunks: Map<number, string>; owner: string; createdAt: number };
export type ChunkResult = { complete: false } | { complete: true; uploadId: string; filename: string; size: number };

export function validateUploadFilename(value: unknown): string {
  if (typeof value !== "string" || value.length > 200 || !value || /[/\\\x00-\x1f]/.test(value) || value !== path.basename(value) || !EXTENSIONS.has(path.extname(value).toLowerCase())) {
    throw new Error("Invalid upload filename or unsupported file type");
  }
  return value;
}

export class UploadStore {
  readonly root: string;
  private sessions = new Map<string, Session>();
  private ready = new Map<string, Uploaded>();
  private maxBytes: number;
  private maxSessions: number;
  constructor(root: string, limits: { maxBytes?: number; maxSessions?: number } = {}) {
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    this.root = fs.realpathSync(root);
    this.maxBytes = limits.maxBytes ?? MAX_UPLOAD_BYTES;
    this.maxSessions = limits.maxSessions ?? 8;
  }
  newIncomingPath() { return path.join(this.root, randomUUID()); }
  assertOwned(filePath: string): string {
    if (typeof filePath !== "string" || path.dirname(path.resolve(filePath)) !== this.root || !fs.lstatSync(filePath).isFile() || fs.realpathSync(filePath) !== path.resolve(filePath)) {
      throw new Error("Upload file is outside owned storage or is not a regular file");
    }
    return filePath;
  }
  cleanup(filePath: string) {
    try { fs.unlinkSync(this.assertOwned(filePath)); }
    catch (error: any) { if (error.code !== "ENOENT") console.warn("[upload] Refused or failed cleanup:", error.message); }
  }
  sweep(now = Date.now()) {
    for (const [id, session] of Array.from(this.sessions)) if (now - session.createdAt > TTL) {
      for (const p of Array.from(session.chunks.values())) this.cleanup(p);
      this.sessions.delete(id);
    }
    for (const [id, file] of Array.from(this.ready)) if (now - file.createdAt > TTL) {
      this.cleanup(file.filePath); this.ready.delete(id);
    }
    // Reclaim abandoned incoming/assembled files after a process restart too.
    for (const name of fs.readdirSync(this.root)) {
      const p = path.join(this.root, name);
      if (now - fs.lstatSync(p).mtimeMs > TTL) this.cleanup(p);
    }
  }
  acceptChunk(body: any, incomingPath: string, owner: string): ChunkResult {
    try {
      if (!owner) throw new Error("Authenticated upload owner required");
      this.assertOwned(incomingPath);
      const id = body?.uploadId;
      if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{8,100}$/.test(id)) throw new Error("Invalid upload session ID");
      const filename = validateUploadFilename(body.filename);
      if (!/^\d{1,3}$/.test(String(body.chunkIndex)) || !/^\d{1,3}$/.test(String(body.totalChunks))) throw new Error("Invalid chunk parameters");
      const index = Number(body.chunkIndex), total = Number(body.totalChunks);
      if (total < 1 || total > MAX_CHUNKS || index < 0 || index >= total) throw new Error("Chunk index or total outside upload limits");
      let session = this.sessions.get(id);
      if (!session) {
        if (this.sessions.size + this.ready.size >= this.maxSessions) throw new Error("Upload capacity reached. Finish or wait for existing uploads to expire.");
        session = { filename, total, size: 0, chunks: new Map(), owner, createdAt: Date.now() };
        this.sessions.set(id, session);
      }
      if (session.owner !== owner || session.filename !== filename || session.total !== total) throw new Error("Upload manifest or owner does not match session");
      if (session.chunks.has(index)) throw new Error("Duplicate upload chunk");
      const size = fs.statSync(incomingPath).size;
      if (size === 0 || size > MAX_CHUNK_BYTES || session.size + size > this.maxBytes) throw new Error("Upload exceeds file or chunk size limit");
      session.chunks.set(index, incomingPath); session.size += size;
      if (session.chunks.size !== total) return { complete: false };
      const assembled = this.newIncomingPath();
      const fd = fs.openSync(assembled, "wx", 0o600);
      try {
        // Read at most one bounded chunk, never the complete aggregate file.
        for (let i = 0; i < total; i++) fs.writeFileSync(fd, fs.readFileSync(this.assertOwned(session.chunks.get(i)!)));
      } catch (error) { this.cleanup(assembled); throw error; }
      finally {
        fs.closeSync(fd);
        for (const p of Array.from(session.chunks.values())) this.cleanup(p);
        this.sessions.delete(id);
      }
      const uploadId = randomUUID();
      this.ready.set(uploadId, { filePath: assembled, filename, size: session.size, owner, createdAt: Date.now() });
      return { complete: true, uploadId, filename, size: session.size };
    } catch (error) { if (incomingPath) this.cleanup(incomingPath); throw error; }
  }
  consume(uploadId: unknown, owner: string): Uploaded {
    if (typeof uploadId !== "string" || !owner) throw new Error("Valid upload ID and authenticated owner required");
    const file = this.ready.get(uploadId);
    if (!file || file.owner !== owner || Date.now() - file.createdAt > TTL) throw new Error("Upload not found, expired, already consumed, or belongs to another user");
    this.assertOwned(file.filePath);
    this.ready.delete(uploadId);
    return file;
  }
}

export const uploadStore = new UploadStore(path.join(os.tmpdir(), "app-owned-uploads"));
export const consumeUploadedFile = (uploadId: unknown, owner: string) => uploadStore.consume(uploadId, owner);
const cleanupTimer = setInterval(() => uploadStore.sweep(), 5 * 60 * 1000);
cleanupTimer.unref();
