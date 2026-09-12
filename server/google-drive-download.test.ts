import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Readable } from "node:stream";
const api = vi.hoisted(() => ({ get: vi.fn(), export: vi.fn() }));
vi.mock("googleapis", () => ({ google: { auth: { OAuth2: class { setCredentials() {} } }, drive: () => ({ files: api }) } }));
import { downloadDriveFile } from "./google-drive";

beforeEach(() => {
  vi.stubEnv("GOOGLE_CLIENT_ID", "test"); vi.stubEnv("GOOGLE_CLIENT_SECRET", "test"); vi.stubEnv("GOOGLE_REFRESH_TOKEN", "test");
  api.get.mockReset(); api.export.mockReset();
});
afterEach(() => vi.unstubAllEnvs());
describe("Drive download integration", () => {
  it.each([
    ["application/vnd.google-apps.document", "example.docx"],
    ["application/vnd.google-apps.presentation", "example.pptx"],
    ["application/pdf", "example"],
  ])("streams %s with an abortable request", async (mimeType, name) => {
    // Mutation: leave exports or ordinary downloads on unbounded arraybuffer response mode.
    api.get.mockResolvedValueOnce({ data: { name: "example", mimeType, size: "5" } });
    api.get.mockResolvedValueOnce({ data: Readable.from([Buffer.from("hello")]) });
    api.export.mockResolvedValue({ data: Readable.from([Buffer.from("hello")]) });
    await expect(downloadDriveFile("file_id")).resolves.toMatchObject({ buffer: Buffer.from("hello"), name });
    const options = (mimeType === "application/pdf" ? api.get.mock.calls[1] : api.export.mock.calls[0])[1];
    expect(options).toMatchObject({ responseType: "stream", timeout: 30000, retry: false });
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });
  it("rejects oversized metadata before downloading bytes", async () => {
    // Mutation: ignore metadata size and request the large body.
    api.get.mockResolvedValueOnce({ data: { name: "large", mimeType: "application/pdf", size: String(51 * 1024 * 1024) } });
    await expect(downloadDriveFile("file_id")).rejects.toThrow(/50 MB/);
    expect(api.get).toHaveBeenCalledTimes(1);
  });
  it("does not expose provider error details", async () => {
    // Mutation: propagate raw credential-bearing SDK error messages to the route.
    api.get.mockRejectedValue(new Error("request failed with synthetic-secret-data"));
    await expect(downloadDriveFile("file_id")).rejects.toThrow(/^Google Drive download failed\./);
  });
});
