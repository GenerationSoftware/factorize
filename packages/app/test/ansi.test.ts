import { describe, expect, it } from "vitest";
import { ansiToHtml } from "../src/ansi";

describe("ansiToHtml", () => {
  it("renders standard, bright, indexed, and true-color SGR colors", () => {
    const html = ansiToHtml("\u001b[31mred\u001b[44m on blue\u001b[0m plain \u001b[92mbright\u001b[38;5;208m indexed\u001b[38;2;1;2;3m rgb");
    expect(html).toContain('color:#ef4444');
    expect(html).toContain('background-color:#3b82f6');
    expect(html).toContain('color:#4ade80');
    expect(html).toContain('color:rgb(255,135,0)');
    expect(html).toContain('color:rgb(1,2,3)');
    expect(html).toContain(" plain ");
  });

  it("handles resets, bold, and dim independently", () => {
    const html = ansiToHtml("\u001b[1;2mboth\u001b[22mnormal\u001b[31mred\u001b[39mdefault");
    expect(html).toContain("font-weight:700;opacity:.65");
    expect(html).not.toMatch(/>normal<\/span>/);
    expect(html).toContain('color:#ef4444');
    expect(html).toContain("default");
  });

  it("escapes HTML and strips malformed, partial, and unsupported control sequences", () => {
    const html = ansiToHtml('<script>alert("x")</script>\u001b[999mtext\u001b[31');
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(html).toContain("text");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("\u001b");
    expect(html).not.toContain("[999m");
  });

  it("leaves plain text unchanged apart from required HTML escaping", () => {
    expect(ansiToHtml("plain\n  output & more")).toBe("plain\n  output &amp; more");
  });
});
