import { describe, expect, it } from "vitest";

import type { WorkspaceRow } from "../src/api/types";
import {
  bodyHeight,
  LOOKAHEAD_PAGES,
  MAX_BODY_PX,
  MAX_PAGES,
  PAGE_ROWS,
  ROW_PX,
  RowPages,
  rowNumWidth,
  viewport,
  wantedPages,
} from "../src/bench/grid/rowWindow";

const rows = (from: number, n: number): WorkspaceRow[] =>
  Array.from({ length: n }, (_, i) => ({ _rid: from + i }));

describe("viewport", () => {
  it("is linear while the body fits", () => {
    const v = viewport(31 * 1000 + 10, 620, 100_000);
    expect(v.bodyPx).toBe(100_000 * ROW_PX);
    expect(v.first).toBe(1000);
    expect(v.offsetPx).toBeCloseTo(10);
    expect(v.end).toBe(1000 + 20 + 1);
  });

  it("caps the body and maps the scrollbar proportionally", () => {
    const total = 4_000_000;
    expect(bodyHeight(total)).toBe(MAX_BODY_PX);
    const win = 600;
    expect(viewport(0, win, total).first).toBe(0);
    const mid = viewport((MAX_BODY_PX - win) / 2, win, total);
    expect(Math.abs(mid.first - 2_000_000)).toBeLessThan(25);
    const last = viewport(MAX_BODY_PX - win, win, total);
    // The last row ends exactly at the bottom edge.
    expect(last.end).toBe(total);
    expect(last.first * ROW_PX + last.offsetPx + win).toBeCloseTo(total * ROW_PX);
  });

  it("clamps a scrollTop past the end and an empty or short frame", () => {
    expect(viewport(1e12, 600, 5000).end).toBe(5000);
    expect(viewport(0, 600, 0)).toMatchObject({ first: 0, end: 0 });
    const short = viewport(500, 600, 5);
    expect(short).toMatchObject({ first: 0, end: 5, offsetPx: 0 });
  });
});

describe("wantedPages", () => {
  it("lists the visible pages first, then the look-ahead in the scroll direction", () => {
    const down = wantedPages(1000, 1030, 4_000_000, 1);
    expect(down[0]).toBe(10);
    expect(down).toContain(10 + LOOKAHEAD_PAGES);
    expect(down).toContain(9);
    expect(down).not.toContain(10 - 2);
    const up = wantedPages(1000, 1030, 4_000_000, -1);
    expect(up).toContain(10 - LOOKAHEAD_PAGES);
    expect(up).not.toContain(10 + 2);
  });

  it("spans visible pages and stays inside the table", () => {
    expect(wantedPages(90, 130, 150, 1).slice(0, 2).sort()).toEqual([0, 1]);
    const all = wantedPages(0, 250, 250, -1);
    expect(Math.max(...all)).toBe(2);
    expect(Math.min(...all)).toBe(0);
    expect(wantedPages(0, 0, 0, 1)).toEqual([]);
  });
});

describe("RowPages", () => {
  it("seeds the first response into pages and reads rows by index", () => {
    const p = new RowPages();
    p.seed(rows(0, 250));
    expect(p.pageIndexes()).toEqual([0, 1, 2]);
    expect(p.row(0)?._rid).toBe(0);
    expect(p.row(249)?._rid).toBe(249);
    expect(p.row(250)).toBeUndefined();
  });

  it("evicts the pages farthest from the focus", () => {
    const p = new RowPages();
    p.seed(rows(0, PAGE_ROWS));
    p.setFocus(500);
    for (let i = 500; i < 500 + MAX_PAGES; i++) p.put(i, rows(i * PAGE_ROWS, PAGE_ROWS));
    expect(p.size).toBe(MAX_PAGES);
    expect(p.has(0)).toBe(false);
    expect(p.has(500)).toBe(true);
    p.setFocus(0);
    p.put(0, rows(0, PAGE_ROWS));
    expect(p.has(0)).toBe(true);
    expect(p.size).toBe(MAX_PAGES);
  });
});

describe("rowNumWidth", () => {
  it("is at least 44px and grows with the digits", () => {
    expect(rowNumWidth(5)).toBe(44);
    expect(rowNumWidth(4_000_000)).toBeGreaterThan(44);
    expect(rowNumWidth(4_000_000)).toBeGreaterThanOrEqual(7 * 7);
  });
});
