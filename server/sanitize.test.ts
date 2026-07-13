import { describe, it, expect } from "vitest";
import { htmlToText } from "./sanitize";

describe("htmlToText", () => {
  it("strips tags to plain text", () => {
    expect(htmlToText("<p>Hello <b>world</b></p>")).toBe("Hello world");
  });
  it("preserves paragraph breaks as newlines", () => {
    expect(htmlToText("<p>One</p><p>Two</p>")).toBe("One\nTwo");
  });
  it("converts <br> to newline", () => {
    expect(htmlToText("line1<br/>line2")).toBe("line1\nline2");
  });
  it("removes scripts, styles, and images entirely", () => {
    expect(htmlToText('<script>alert(1)</script><img src="x.gif">text')).toBe("text");
  });
  it("decodes common HTML entities", () => {
    expect(htmlToText("<p>Fish &amp; Chips &lt;3 &quot;quoted&quot; it&#39;s&nbsp;here</p>")).toBe(
      'Fish & Chips <3 "quoted" it\'s here'
    );
  });
  it("collapses whitespace runs and newline runs to single separators", () => {
    expect(htmlToText("<p>a   b</p>\n\n\n<p>c</p>")).toBe("a b\nc");
  });
  it("returns empty string for empty/whitespace input", () => {
    expect(htmlToText("")).toBe("");
    expect(htmlToText("   ")).toBe("");
  });
});
