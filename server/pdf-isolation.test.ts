import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parsePdfIsolated } from "./pdf-isolation";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

describe("isolated PDF parsing", () => {
  it("kills a stalled worker on timeout and waits for its exit", async () => {
    // Mutation: reject on timeout without terminating the actual parser process.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-worker-test-")); dirs.push(dir);
    const pidFile = path.join(dir, "pid"); const worker = path.join(dir, "stall.cjs");
    fs.writeFileSync(worker, `require('fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));process.on('message',()=>setTimeout(()=>process.exit(0),1500));`);
    const started = Date.now();
    await expect(parsePdfIsolated(Buffer.from("test"), { workerPath: worker, timeoutMs: 300 })).rejects.toThrow(/timed out/);
    expect(Date.now() - started).toBeLessThan(1200);
    const pid = Number(fs.readFileSync(pidFile, "utf8"));
    expect(() => process.kill(pid, 0)).toThrow();
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
