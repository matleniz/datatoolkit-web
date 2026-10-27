/**
 * Continuous-scroll geometry and page store for a windowed frame (engine
 * `duckdb`, datatoolkit-issues#329). Pure: no React, no DOM.
 *
 * The grid never holds the frame. It knows `total`, shows the rows under the
 * viewport and keeps a bounded set of pages (`PAGE_ROWS` rows each) around it.
 */
import type { WorkspaceRow } from "../../api/types";

/** Rows per request. A page costs ~0.1-0.2 s on the engine whatever its offset. */
export const PAGE_ROWS = 100;
/** Pages kept in memory (the viewport plus the look-ahead and some history). */
export const MAX_PAGES = 24;
/** Pages fetched ahead of the viewport in the scroll direction / behind it. */
export const LOOKAHEAD_PAGES = 3;
export const LOOKBEHIND_PAGES = 1;
/** Requests in flight at once. */
export const MAX_INFLIGHT = 3;
/** A row: `--dtk-grid-row-h` (30px) + its 1px bottom border. */
export const ROW_PX = 31;
/**
 * Tallest scroll body. Browsers cap an element's height (~33M px in Chrome,
 * ~17M in Firefox): above it the scrollbar maps linearly onto the rows
 * instead of one pixel row per row.
 */
export const MAX_BODY_PX = 10_000_000;

export interface Viewport {
  /** Height of the scroll body (what the scrollbar spans). */
  bodyPx: number;
  /** First row (possibly under the top edge) and one past the last to mount. */
  first: number;
  end: number;
  /** Pixels the first row is scrolled out of the top edge. */
  offsetPx: number;
}

export function bodyHeight(total: number): number {
  return Math.min(total * ROW_PX, MAX_BODY_PX);
}

/**
 * Which rows sit under a viewport of `windowPx` at `scrollTop`.
 * Linear while the body is not capped; proportional to the scrollbar after.
 */
export function viewport(
  scrollTop: number,
  windowPx: number,
  total: number,
): Viewport {
  const bodyPx = bodyHeight(total);
  const full = total * ROW_PX;
  const travel = bodyPx - windowPx;
  let rowFloat = 0;
  if (travel > 0 && full > windowPx) {
    const frac = Math.min(1, Math.max(0, scrollTop / travel));
    rowFloat = (frac * (full - windowPx)) / ROW_PX;
  }
  const first = Math.min(Math.max(0, total - 1), Math.floor(rowFloat));
  const end = Math.min(total, first + Math.ceil(windowPx / ROW_PX) + 1);
  return { bodyPx, first, end, offsetPx: (rowFloat - first) * ROW_PX };
}

/** Pages to hold for the rows [first, end), biased towards the scroll direction. */
export function wantedPages(
  first: number,
  end: number,
  total: number,
  dir: 1 | -1,
): number[] {
  if (total <= 0 || end <= first) return [];
  const last = Math.floor((total - 1) / PAGE_ROWS);
  const p0 = Math.floor(first / PAGE_ROWS);
  const p1 = Math.min(last, Math.floor((end - 1) / PAGE_ROWS));
  const ahead = LOOKAHEAD_PAGES;
  const behind = LOOKBEHIND_PAGES;
  const lo = Math.max(0, p0 - (dir > 0 ? behind : ahead));
  const hi = Math.min(last, p1 + (dir > 0 ? ahead : behind));
  const pages: number[] = [];
  for (let p = lo; p <= hi; p++) pages.push(p);
  // Visible pages first, then by distance from them, ahead before behind.
  const rank = (p: number) => {
    if (p >= p0 && p <= p1) return 0;
    const d = p < p0 ? p0 - p : p - p1;
    const isAhead = dir > 0 ? p > p1 : p < p0;
    return d * 2 + (isAhead ? 0 : 1);
  };
  return pages.sort((a, b) => rank(a) - rank(b) || a - b);
}

/** Width of the row-number column: a 7-digit row number must fit. */
export function rowNumWidth(total: number): number {
  const digits = String(Math.max(1, total)).length;
  return Math.max(44, 24 + digits * 7);
}

/** Bounded page cache: the pages nearest the focus survive. */
export class RowPages {
  private pages = new Map<number, WorkspaceRow[]>();
  private focus = 0;

  get size(): number {
    return this.pages.size;
  }

  has(page: number): boolean {
    return this.pages.has(page);
  }

  pageIndexes(): number[] {
    return [...this.pages.keys()].sort((a, b) => a - b);
  }

  row(i: number): WorkspaceRow | undefined {
    return this.pages.get(Math.floor(i / PAGE_ROWS))?.[i % PAGE_ROWS];
  }

  setFocus(page: number): void {
    this.focus = page;
  }

  put(page: number, rows: WorkspaceRow[]): void {
    this.pages.set(page, rows);
    this.evict();
  }

  /** Rows from offset 0 (the first response), cut into pages. */
  seed(rows: WorkspaceRow[]): void {
    for (let i = 0; i < rows.length; i += PAGE_ROWS) {
      this.pages.set(i / PAGE_ROWS, rows.slice(i, i + PAGE_ROWS));
    }
    this.evict();
  }

  /** Drop the pages farthest from the focus until `MAX_PAGES` remain. */
  private evict(): void {
    while (this.pages.size > MAX_PAGES) {
      let far = -1;
      let farD = -1;
      for (const p of this.pages.keys()) {
        const d = Math.abs(p - this.focus);
        if (d > farD) {
          far = p;
          farD = d;
        }
      }
      this.pages.delete(far);
    }
  }
}
