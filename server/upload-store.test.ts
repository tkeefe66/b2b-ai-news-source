import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { UploadStore } from "./upload-store";

describe("upload confinement", () => {
  let dir: string;
  let store: UploadStore;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "upload-test-")); store = new UploadStore(path.join(dir, "owned"), { maxBytes: 12, maxSessions: 2 }); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
  const body = (overrides = {}) => ({ uploadId: "client_session_123", chunkIndex: "0", totalChunks: "1", filename: "notes.txt", ...overrides });
  function chunk(content = "hello") { const p = store.newIncomingPath(); fs.writeFileSync(p, content); return p; }

  it("rejects traversal without moving or deleting outside files", () => {
    // Mutation: omit upload ID validation or cleanup confinement.
    const outside = path.join(dir, "keep.txt"); fs.writeFileSync(outside, "keep");
    expect(() => store.acceptChunk(body({ uploadId: "../../outside" }), chunk(), "alice")).toThrow();
    store.cleanup(outside);
    expect(fs.readFileSync(outside, "utf8")).toBe("keep");
    expect(() => store.consume(outside, "alice")).toThrow();
  });
  it("consumes a server-issued upload once, using stored metadata", () => {
    // Mutation: return a file path as the public token or omit consume deletion.
    const result = store.acceptChunk(body(), chunk(), "alice");
    expect(result.complete).toBe(true);
    if (!result.complete) throw new Error("not complete");
    expect(result).not.toHaveProperty("filePath");
    const uploaded = store.consume(result.uploadId, "alice");
    expect(uploaded.filename).toBe("notes.txt");
    expect(fs.readFileSync(uploaded.filePath, "utf8")).toBe("hello");
    expect(() => store.consume(result.uploadId, "alice")).toThrow();
  });
  it("rejects changed manifest, duplicate chunks, invalid indices and aggregate overflow", () => {
    // Mutation: trust current request total or count duplicates or skip cumulative bytes.
    store.acceptChunk(body({ totalChunks: "2" }), chunk("1234567"), "alice");
    expect(() => store.acceptChunk(body({ totalChunks: "1" }), chunk(), "alice")).toThrow();
    expect(() => store.acceptChunk(body({ totalChunks: "2" }), chunk(), "alice")).toThrow();
    expect(() => store.acceptChunk(body({ totalChunks: "2", chunkIndex: "2" }), chunk(), "alice")).toThrow();
    expect(() => store.acceptChunk(body({ totalChunks: "2", chunkIndex: "1" }), chunk("123456"), "alice")).toThrow();
    expect(() => store.acceptChunk(body({ totalChunks: "-1" }), chunk(), "alice")).toThrow();
    expect(() => store.acceptChunk(body({ chunkIndex: "0junk" }), chunk(), "alice")).toThrow();
  });
  it("binds sessions and tokens to an owner", () => {
    // Mutation: ignore owner in session lookup or token consumption.
    store.acceptChunk(body({ totalChunks: "2" }), chunk(), "alice");
    expect(() => store.acceptChunk(body({ totalChunks: "2", chunkIndex: "1" }), chunk(), "bob"), "alice").toThrow();
    const r = store.acceptChunk(body({ totalChunks: "2", chunkIndex: "1" }), chunk(), "alice");
    if (!r.complete) throw new Error("not complete");
    expect(() => store.consume(r.uploadId, "bob")).toThrow();
    expect(store.consume(r.uploadId, "alice").size).toBe(10);
  });
  it("rejects symlink reads and deletes only owned regular files", () => {
    // Mutation: replace lstat/realpath confinement with existsSync.
    const outside = path.join(dir, "keep.txt"); fs.writeFileSync(outside, "secret");
    const link = store.newIncomingPath(); fs.symlinkSync(outside, link);
    expect(() => store.acceptChunk(body(), link, "alice")).toThrow();
    store.cleanup(link);
    expect(fs.readFileSync(outside, "utf8")).toBe("secret");
  });
  it("limits concurrent sessions and reclaims expired uploads", () => {
    // Mutation: omit session limit or expiry cleanup.
    store.acceptChunk(body({ uploadId: "session_a", totalChunks: "2" }), chunk(), "alice");
    store.acceptChunk(body({ uploadId: "session_b", totalChunks: "2" }), chunk(), "alice");
    expect(() => store.acceptChunk(body({ uploadId: "session_c", totalChunks: "2" }), chunk(), "alice")).toThrow();
    store.sweep(Date.now() + 31 * 60 * 1000);
    expect(store.acceptChunk(body({ uploadId: "session_c" }), chunk(), "alice").complete).toBe(true);
  });
});
