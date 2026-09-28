import { describe, expect, it } from "vitest";

import {
  columnWindow,
  rowsPageSize,
  visibleColumnNames,
  WIDE_COL_THRESHOLD,
} from "../src/bench/grid/columnWindow";

function cols(n: number, kind = "number") {
  return Array.from({ length: n }, (_, i) => ({
    name: `c${i}`,
    kind,
  }));
}

describe("columnWindow", () => {
  it("returns empty for no columns", () => {
    expect(columnWindow([], 0, 800)).toEqual({
      start: 0,
      end: 0,
      leftPad: 0,
      rightPad: 0,
      visible: [],
    });
  });

  it("windows a wide header so only viewport columns mount", () => {
    // number kind → 130px; 800px viewport ≈ 6 cols + overscan 4 each side
    const all = cols(320);
    const w = columnWindow(all, 0, 800, 4);
    expect(w.start).toBe(0);
    expect(w.visible.length).toBeLessThan(30);
    expect(w.visible.length).toBeGreaterThan(5);
    expect(w.leftPad).toBe(0);
    expect(w.rightPad).toBeGreaterThan(0);
    expect(w.start + w.visible.length).toBe(w.end);
  });

  it("shifts the window when scrolled", () => {
    const all = cols(200);
    const w0 = columnWindow(all, 0, 800, 2);
    const w1 = columnWindow(all, 130 * 40, 800, 2);
    expect(w1.start).toBeGreaterThan(w0.start);
    expect(w1.leftPad).toBeGreaterThan(0);
  });

  it("visibleColumnNames lists names in the window", () => {
    const names = visibleColumnNames(cols(100), 0, 400, 1);
    expect(names[0]).toBe("c0");
    expect(names.length).toBeLessThan(20);
  });
});

describe("rowsPageSize", () => {
  it("shrinks the first page for wide frames", () => {
    expect(rowsPageSize(10)).toBe(500);
    expect(rowsPageSize(WIDE_COL_THRESHOLD)).toBe(100);
    expect(rowsPageSize(520)).toBe(100);
    expect(rowsPageSize(null)).toBe(500);
  });
});
