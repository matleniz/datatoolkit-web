// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { renderMarkdown } from "../src/bench/agent/panel/markdown";

/**
 * XSS payloads through the agent markdown renderer (datatoolkit-issues#325).
 * Each payload calls `__xss()` if it ever runs. Besides the structural
 * checks, the rendered HTML is inserted into the document and every element
 * is poked with the events the payloads listen to. Inline handlers run in
 * jsdom's own window (vitest exposes the instance as `jsdom`), not in the
 * test's global, so `__xss` is defined there.
 */

const jsdomWindow = (globalThis as unknown as { jsdom: { window: { __xss?: () => void } } }).jsdom
  .window;

const SCRIPT = [
  "<script>__xss()</script>",
  "<SCRIPT>__xss()</SCRIPT>",
  "before <script>__xss()</script> after",
  "**<script>__xss()</script>**",
  "| a |\n|---|\n| <script>__xss()</script> |",
  "> <script>__xss()</script>",
  "<iframe srcdoc=\"<script>__xss()</script>\"></iframe>",
];

const ONERROR = [
  '<img src=x onerror="__xss()">',
  "<img src=x onerror=__xss()>",
  "<IMG SRC=x OnError=__xss()>",
  "<svg onload=__xss()>",
  "<details open ontoggle=__xss()>",
  "<math><mtext><img src onerror=__xss()></mtext></math>",
  "| <img src=x onerror=__xss()> |\n|---|\n| x |",
  "- [x] <input onfocus=__xss() autofocus>",
  '[a](https://example.com "t\\" onerror=\\"__xss()")',
  '[a](https://example.com/" onerror="__xss())',
];

const JAVASCRIPT = [
  "[x](javascript:__xss())",
  "[x](JaVaScRiPt:__xss())",
  "[x](&#106;avascript:__xss())",
  "[x](&#x6A;avascript:__xss())",
  "[x]( javascript:__xss())",
  "[x][r]\n\n[r]: javascript:__xss()",
  "<javascript:__xss()>",
  "[![a](x)](javascript:__xss())",
  "<a href=\"javascript:__xss()\">k</a>",
  "**<a href=javascript:__xss()>b</a>**",
  "[x](vbscript:__xss())",
  "[x](data:text/html,<script>__xss()</script>)",
];

const ALL = [...SCRIPT, ...ONERROR, ...JAVASCRIPT];

let mounted: HTMLElement | null = null;

function mount(md: string): HTMLElement {
  mounted = document.createElement("div");
  mounted.innerHTML = renderMarkdown(md);
  document.body.appendChild(mounted);
  return mounted;
}

afterEach(() => {
  mounted?.remove();
  mounted = null;
});

const EVENTS = ["error", "load", "click", "focus", "toggle", "mouseover"];

describe("agent markdown XSS (#325)", () => {
  it.each(SCRIPT)("drops <script>: %s", (md) => {
    const root = mount(md);
    expect(root.querySelector("script, iframe")).toBeNull();
    expect(renderMarkdown(md)).not.toMatch(/<(script|iframe)/i);
  });

  it.each(ONERROR)("drops on*= handlers: %s", (md) => {
    const root = mount(md);
    expect(root.querySelector("img, svg, math, details")).toBeNull();
    for (const el of root.querySelectorAll("*")) {
      const handlers = el.getAttributeNames().filter((n) => n.startsWith("on"));
      expect(handlers).toEqual([]);
    }
  });

  it.each(JAVASCRIPT)("drops non-http(s) hrefs: %s", (md) => {
    const root = mount(md);
    for (const a of root.querySelectorAll("a")) {
      expect(a.getAttribute("href")).toMatch(/^https?:\/\//i);
    }
    expect(root.querySelector("[href^='javascript' i], [href^='vbscript' i], [href^='data' i]")).toBeNull();
  });

  it.each(ALL)("nothing runs once inserted and poked: %s", (md) => {
    let ran = 0;
    jsdomWindow.__xss = () => {
      ran += 1;
    };
    const root = mount(md);
    for (const el of root.querySelectorAll("*")) {
      for (const type of EVENTS) el.dispatchEvent(new Event(type));
    }
    delete jsdomWindow.__xss;
    expect(ran).toBe(0);
  });

  it("the execution check does see a handler that runs", () => {
    let ran = 0;
    jsdomWindow.__xss = () => {
      ran += 1;
    };
    const root = mount("x");
    root.innerHTML = '<b onclick="__xss()">b</b>';
    root.querySelector("b")!.dispatchEvent(new Event("click"));
    delete jsdomWindow.__xss;
    expect(ran).toBe(1);
  });

  it("keeps the payload readable as text", () => {
    expect(mount("<script>__xss()</script>").textContent).toContain("<script>__xss()</script>");
    expect(mount("[x](javascript:__xss())").textContent).toContain("x");
  });
});
