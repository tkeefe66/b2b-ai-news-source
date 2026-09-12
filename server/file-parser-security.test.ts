import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
vi.mock("./ai-models", () => ({ chatCompletion: vi.fn() }));
vi.mock("./storage", () => ({ storage: {} }));
import { cleanupTempFile, extractTextAndImagesFromFile, handleChunkUpload } from "./file-parser";
import { uploadStore } from "./upload-store";

const files: string[] = [];
afterEach(() => { for (const file of files.splice(0)) fs.rmSync(file, { force: true }); });

describe("parser filesystem boundary", () => {
  it("refuses arbitrary text-file reads and cleanup outside upload storage", async () => {
    // Mutation: remove parser assertOwned or restore unconstrained cleanupTempFile.
    const file = path.join(os.tmpdir(), `parser-private-${Date.now()}.txt`); files.push(file);
    fs.writeFileSync(file, "private contents must never enter knowledge documents");
    await expect(extractTextAndImagesFromFile(file, "claimed.txt")).rejects.toThrow(/outside/);
    cleanupTempFile(file);
    expect(fs.readFileSync(file, "utf8")).toContain("private contents");
  });
  it("requires an authenticated owner before accepting multipart chunk data", () => {
    // Mutation: supply a default operator owner in handleChunkUpload.
    const file = uploadStore.newIncomingPath(); files.push(file); fs.writeFileSync(file, "hello");
    expect(() => handleChunkUpload({ body: { uploadId: "test_session", filename: "notes.txt", chunkIndex: "0", totalChunks: "1" }, file: { path: file } })).toThrow(/owner/);
    expect(fs.existsSync(file)).toBe(false);
  });
  it("extracts a real owned upload and safely cleans it", async () => {
    // Mutation: reject all paths as a shortcut for confinement.
    const file = uploadStore.newIncomingPath(); files.push(file); fs.writeFileSync(file, "normal document");
    await expect(extractTextAndImagesFromFile(file, "notes.txt")).resolves.toEqual({ text: "normal document", images: [] });
    cleanupTempFile(file); expect(fs.existsSync(file)).toBe(false);
  });
  it("bounds repeated malformed embedded image scans", async () => {
    // Mutation: omit fragment count limit, allowing repeated suffix scans across the full input.
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const malformed = Buffer.concat(Array.from({ length: 102 }, () => signature));
    await expect(extractTextAndImagesFromFile(malformed, "notes.pdf")).rejects.toThrow(/too many embedded image fragments/);
  });
});
