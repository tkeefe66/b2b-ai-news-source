import sanitizeHtml from "sanitize-html";

const BLOCK_BOUNDARY = /<\/(?:p|div|h[1-6]|li|blockquote|tr|section|article)>|<br\s*\/?>/gi;

export function htmlToText(html: string): string {
  const withBreaks = html.replace(BLOCK_BOUNDARY, (m) => `${m}\n`);
  const stripped = sanitizeHtml(withBreaks, { allowedTags: [], allowedAttributes: {} });
  return stripped
    .replace(/ /g, " ") // replace non-breaking space character with regular space
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, "&") // decode ampersand LAST to avoid double-decoding
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}
