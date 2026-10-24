import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { fork } from "node:child_process";
vi.mock("node:child_process", async importOriginal => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, fork: vi.fn(actual.fork) };
});
import { parsePdfIsolated } from "./pdf-isolation";

afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

describe("isolated PDF parsing", () => {
  it("kills a stalled worker on timeout and waits for its exit", async () => {
    // Mutation: reject on timeout without terminating the actual parser process.
    // Control lifecycle events: a loaded builder may kill a real worker before
    // it starts, so a PID file cannot reliably prove timeout behavior.
    vi.useFakeTimers();
    const child = Object.assign(new EventEmitter(), { kill: vi.fn(), send: vi.fn() });
    vi.mocked(fork).mockReturnValueOnce(child as unknown as ReturnType<typeof fork>);
    const result = parsePdfIsolated(Buffer.from("test"), { timeoutMs: 300 });
    const rejection = expect(result).rejects.toThrow(/timed out/);
    let settled = false;
    void result.then(() => { settled = true; }, () => { settled = true; });
    await vi.advanceTimersByTimeAsync(299);
    expect(child.kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    expect(settled).toBe(false);
    child.emit("close", null);
    await rejection;
  });
  it("extracts text using the installed PDF parser API", async () => {
    // Mutation: use the old callable pdf-parse API or load an absent production worker path.
    const content = "BT /F1 12 Tf 50 100 Td (Verified document text) Tj ET";
    const objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    ];
    let pdf = "%PDF-1.4\n"; const offsets = [0];
    objects.forEach((object, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; });
    const xref = Buffer.byteLength(pdf);
    pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    await expect(parsePdfIsolated(Buffer.from(pdf))).resolves.toContain("Verified document text");
  });
  it("rejects malformed PDFs with a parser failure", async () => {
    // Mutation: convert parsing failures to successful empty text.
    await expect(parsePdfIsolated(Buffer.from("invalid PDF"))).rejects.toThrow(/PDF parsing failed/);
  });
});
