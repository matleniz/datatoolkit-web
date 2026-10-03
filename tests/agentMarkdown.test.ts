// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { renderMarkdown } from "../src/bench/agent/panel/markdown";

function dom(md: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = renderMarkdown(md);
  return root;
}

describe("agent markdown (#112)", () => {
  it("renders paragraphs, emphasis, headings and quotes", () => {
    const root = dom("# T\n\nsome **bold** and _it_\n\n> quoted");
    expect(root.querySelector("h1")?.textContent).toBe("T");
    expect(root.querySelector("strong")?.textContent).toBe("bold");
    expect(root.querySelector("em")?.textContent).toBe("it");
    expect(root.querySelector("blockquote")?.textContent).toContain("quoted");
  });

  it("renders GFM tables", () => {
    const root = dom("| a | b |\n|---|---|\n| 1 | 2 |");
    expect(root.querySelectorAll("th")).toHaveLength(2);
    expect(root.querySelector("td")?.textContent).toBe("1");
  });

  it("renders nested ordered and unordered lists", () => {
    const root = dom("1. one\n2. two\n   - nested\n");
    expect(root.querySelector("ol > li")?.textContent).toContain("one");
    expect(root.querySelector("ol ul li")?.textContent).toBe("nested");
  });

  it("renders inline code and fenced code, also an unclosed fence", () => {
    expect(dom("use `median`").querySelector("p code")?.textContent).toBe("median");
    expect(dom("```python\nx = 1\n```").querySelector("pre code")?.textContent).toBe("x = 1\n");
    expect(dom("```\nx = <b>1").querySelector("pre code")?.textContent?.trim()).toBe("x = <b>1");
  });

  it("keeps http(s) links with safe attributes", () => {
    const a = dom("[docs](https://example.com/a)").querySelector("a")!;
    expect(a.getAttribute("href")).toBe("https://example.com/a");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("drops non-http links to their text", () => {
    for (const href of ["javascript:alert(1)", "data:text/html,x", "/relative", "mailto:a@b.c"]) {
      const root = dom(`[click](${href})`);
      expect(root.querySelector("a")).toBeNull();
      expect(root.textContent).toContain("click");
    }
  });

  it("neutralises hostile column names", () => {
    const hostile = [
      "<script>alert(1)</script>",
      '<img src=x onerror="alert(1)">',
      "<a href=\"javascript:alert(1)\" onclick=\"x()\">k</a>",
      "| <img src=x onerror=alert(1)> |\n|---|\n| <svg onload=alert(1)> |",
    ];
    for (const md of hostile) {
      const html = renderMarkdown(md);
      const root = dom(md);
      expect(root.querySelector("script, img, svg, iframe")).toBeNull();
      expect(root.querySelector("[onerror], [onclick], [onload]")).toBeNull();
      expect(html).not.toMatch(/<(script|img|svg)/i);
    }
  });

  it("does not load images: alt text instead", () => {
    const root = dom("![chart of age](https://evil.example/p.png)");
    expect(root.querySelector("img")).toBeNull();
    expect(root.textContent).toContain("chart of age");
  });
});
