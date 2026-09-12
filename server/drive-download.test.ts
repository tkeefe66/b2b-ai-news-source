import { describe, expect, it, vi } from "vitest";
import { Readable } from "node:stream";
import { readDriveStream } from "./drive-download";

describe("Drive stream limits", () => {
  it("stops and destroys a stream exceeding the cumulative byte ceiling", async () => {
    // Mutation: check each chunk instead of cumulative bytes, or omit stream destruction.
    const stream = Readable.from([Buffer.from("1234"), Buffer.from("5678")]);
    await expect(readDriveStream(stream, new AbortController().signal, 7)).rejects.toThrow(/size limit/);
    expect(stream.destroyed).toBe(true);
  });
  it("aborts a stalled stream at the deadline", async () => {
    // Mutation: only check signal while processing chunks, so stalled reads never terminate.
    const controller = new AbortController(); const stream = new Readable({ read() {} });
    const result = readDriveStream(stream, controller.signal);
    controller.abort();
    await expect(result).rejects.toThrow(/timed out/);
    expect(stream.destroyed).toBe(true);
  });
  it("accepts exact limit and returns file bytes unchanged", async () => {
    // Mutation: use >= rather than > at the byte boundary.
    await expect(readDriveStream(Readable.from([Buffer.from("hello")]), new AbortController().signal, 5)).resolves.toEqual(Buffer.from("hello"));
  });
});
