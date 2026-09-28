import { colWidth } from "../kinds";

/** Columns past this count get a smaller first rows page (MAT-152). */
export const WIDE_COL_THRESHOLD = 80;
export const PAGE_DEFAULT = 500;
export const PAGE_WIDE = 100;

export function rowsPageSize(columnCount: number | null | undefined): number {
  if (columnCount != null && columnCount >= WIDE_COL_THRESHOLD) {
    return PAGE_WIDE;
  }
  return PAGE_DEFAULT;
}

export interface ColLike {
  name: string;
  kind: string;
}

export interface ColumnWindow<T extends ColLike = ColLike> {
  /** Inclusive start index into `cols`. */
  start: number;
  /** Exclusive end index into `cols`. */
  end: number;
  /** Pixel width of columns before `start` (left spacer). */
  leftPad: number;
  /** Pixel width of columns from `end` onward (right spacer). */
  rightPad: number;
  /** Slice of columns to mount in the DOM. */
  visible: T[];
}

/**
 * Horizontal window over grid columns for lazy header / cell mounting.
 * `overscan` mounts extra columns on each side so scroll feels continuous.
 */
export function columnWindow<T extends ColLike>(
  cols: T[],
  scrollLeft: number,
  viewportWidth: number,
  overscan = 4,
): ColumnWindow<T> {
  const n = cols.length;
  if (n === 0) {
    return { start: 0, end: 0, leftPad: 0, rightPad: 0, visible: [] };
  }

  const widths = cols.map((c) => colWidth(c.kind));

  // Degenerate / not-yet-measured viewport: mount a small leading window.
  const vw = viewportWidth > 0 ? viewportWidth : 800;
  const sl = Math.max(0, scrollLeft);

  let start = 0;
  let acc = 0;
  while (start < n && acc + widths[start]! < sl) {
    acc += widths[start]!;
    start += 1;
  }

  let end = start;
  let covered = 0;
  while (end < n && covered < vw) {
    covered += widths[end]!;
    end += 1;
  }

  start = Math.max(0, start - overscan);
  end = Math.min(n, end + overscan);

  let leftPad = 0;
  for (let i = 0; i < start; i++) leftPad += widths[i]!;
  let rightPad = 0;
  for (let i = end; i < n; i++) rightPad += widths[i]!;

  return {
    start,
    end,
    leftPad,
    rightPad,
    visible: cols.slice(start, end),
  };
}

/**
 * Visible column names plus a buffer — used to prefer profiling those first
 * once the engine accepts a `columns` filter (MAT-152).
 */
export function visibleColumnNames(
  cols: ColLike[],
  scrollLeft: number,
  viewportWidth: number,
  overscan = 8,
): string[] {
  return columnWindow(cols, scrollLeft, viewportWidth, overscan).visible.map(
    (c) => c.name,
  );
}
