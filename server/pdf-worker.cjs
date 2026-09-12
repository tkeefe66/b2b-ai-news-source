"use strict";
// Standalone process entry. Receives bytes, never user-controlled filesystem paths.
process.once("message", async (message) => {
  let parser;
  try {
    if (!Buffer.isBuffer(message?.data) || message.data.length > 50 * 1024 * 1024) throw new Error("PDF input exceeds limit");
    const { PDFParse } = require("pdf-parse");
    parser = new PDFParse({ data: new Uint8Array(message.data), isEvalSupported: false, disableFontFace: true, maxImageSize: 0 });
    const info = await parser.getInfo();
    if (info.total > 500) throw new Error("PDF exceeds 500 page limit");
    const result = await parser.getText();
    if (typeof result.text !== "string" || Buffer.byteLength(result.text) > 5 * 1024 * 1024) throw new Error("PDF extracted text exceeds limit");
    await parser.destroy(); parser = undefined;
    process.send({ text: result.text }, () => process.exit(0));
  } catch (error) {
    if (parser) await parser.destroy().catch(() => {});
    process.send({ error: String(error?.message || "Invalid PDF").slice(0, 300) }, () => process.exit(1));
  }
});
