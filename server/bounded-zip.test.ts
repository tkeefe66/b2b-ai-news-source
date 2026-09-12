import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { loadBoundedZip } from "./bounded-zip";

describe("bounded Office archives", () => {
  it("rejects compressed expansion above the entry and aggregate ceilings", async () => {
    // Mutation: omit ZIP declared-size admission checks.
    const zip = new JSZip(); zip.file("word/document.xml", "x".repeat(2048));
    const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    await expect(loadBoundedZip(buffer, { maxEntryBytes: 1024 })).rejects.toThrow(/limit/);
    const two = new JSZip(); two.file("a", "x".repeat(700)); two.file("b", "x".repeat(700));
    await expect(loadBoundedZip(await two.generateAsync({ type: "nodebuffer" }), { maxTotalBytes: 1000 })).rejects.toThrow(/limit/);
  });
  it("rejects too many entries and reads valid document data", async () => {
    // Mutation: skip entry count check, or return empty data in safe reader.
    const zip = new JSZip(); zip.file("a", "hello"); zip.file("b", "world");
    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    await expect(loadBoundedZip(buffer, { maxEntries: 1 })).rejects.toThrow(/limit/);
    const reader = await loadBoundedZip(buffer);
    expect((await reader.read("a")).toString()).toBe("hello");
  });
  it("stops inflated data even when archive metadata understates its size", async () => {
    // Mutation: enforce only the central-directory size, omitting streaming byte caps.
    const zip = new JSZip(); zip.file("a", "x".repeat(2048));
    const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    buffer.writeUInt32LE(1, 22); // Local entry declared uncompressed size.
    const central = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    buffer.writeUInt32LE(1, central + 24);
    const reader = await loadBoundedZip(buffer, { maxEntryBytes: 1024 });
    await expect(reader.read("a")).rejects.toThrow(/exceeds limit/);
  });
});
