// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import { PendingRegion, Skeleton, SkeletonRow, SkeletonText, Spinner } from "../src/placeholder/Skeleton";
import { skeletonWidths } from "../src/placeholder/widths";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function render(node: ReturnType<typeof createElement>): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  act(() => createRoot(host).render(node));
  return host;
}

describe("skeletonWidths", () => {
  it("is deterministic and stays in range", () => {
    expect(skeletonWidths(12, 3)).toEqual(skeletonWidths(12, 3));
    for (const w of skeletonWidths(200, 9, 40, 85)) {
      expect(w).toBeGreaterThanOrEqual(40);
      expect(w).toBeLessThanOrEqual(85);
    }
  });
  it("varies with the seed and handles an empty count", () => {
    expect(skeletonWidths(8, 1)).not.toEqual(skeletonWidths(8, 2));
    expect(skeletonWidths(0)).toEqual([]);
    expect(skeletonWidths(-3)).toEqual([]);
  });
});

describe("placeholder primitives", () => {
  it("Skeleton reserves the given box and is hidden from assistive tech", () => {
    const el = render(createElement(Skeleton, { width: 40, height: "2em" })).firstElementChild as HTMLElement;
    expect(el.getAttribute("aria-hidden")).toBe("true");
    expect(el.style.width).toBe("40px");
    expect(el.style.height).toBe("2em");
  });

  it("SkeletonText renders one bar per line, the last one shorter", () => {
    const host = render(createElement(SkeletonText, { lines: 4, seed: 2 }));
    const bars = host.querySelectorAll<HTMLElement>(".sk");
    expect(bars).toHaveLength(4);
    const w = (i: number) => parseFloat(bars[i]!.style.width);
    expect(w(3)).toBeLessThanOrEqual(60);
  });

  it("SkeletonRow keeps each cell's height and width", () => {
    const host = render(createElement(SkeletonRow, { widths: [96, 130, 112], height: 30 }));
    const row = host.firstElementChild as HTMLElement;
    const cells = [...row.children] as HTMLElement[];
    expect(cells.map((c) => c.style.width)).toEqual(["96px", "130px", "112px"]);
    expect(cells.every((c) => c.style.height === "30px")).toBe(true);
  });

  it("PendingRegion announces its label once and hides the shapes", () => {
    const host = render(
      createElement(PendingRegion, { label: "Loading rows", children: createElement(Skeleton, {}) }),
    );
    const region = host.querySelector('[role="status"]')!;
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.querySelector(".sr-only")!.textContent).toBe("Loading rows");
    expect(region.querySelector('[aria-hidden="true"] .sk')).not.toBeNull();
  });

  it("Spinner is decorative", () => {
    const el = render(createElement(Spinner, { size: "md" })).firstElementChild!;
    expect(el.getAttribute("aria-hidden")).toBe("true");
    expect(el.className).toContain("md");
  });
});

describe("placeholder styles", () => {
  const css = readFileSync("src/placeholder/placeholder.css", "utf8");
  const code = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const tokens = readFileSync("src/theme/tokens.css", "utf8");

  it("only uses skeleton tokens that tokens.css defines", () => {
    const used = new Set(code.match(/--dtk-[a-z-]*[a-z]/g));
    for (const name of used) expect(tokens, name).toContain(`${name}:`);
  });

  it("stops the shimmer under prefers-reduced-motion", () => {
    const block = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(block).toContain("animation: none");
  });

  it("animates transform only (no layout properties)", () => {
    const keyframes = css.match(/@keyframes sk-shimmer \{[^}]*\{[^}]*\}[^}]*\}/)![0];
    expect(keyframes).toContain("transform");
    expect(keyframes).not.toMatch(/width|height|margin|left|top/);
  });
});
