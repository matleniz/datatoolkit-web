import type {
  DockLayout,
  DockLayouts,
  DockPos,
  DockRect,
  ToolId,
} from "./dockTypes";

/**
 * Dock window grid layout (MAT-234 / MAT-206). Pure helpers shared by the
 * reducer and the react-grid-layout view: one rect per open window and dock
 * position, in grid units. Bottom and right docks keep separate layouts so
 * switching position never squashes a hand-made arrangement.
 */
export interface DockGridSpec {
  cols: number;
  /** Rows that fit the dock's visible height (row height is derived). */
  rows: number;
  /** Size of a newly opened window. */
  w: number;
  h: number;
  minW: number;
  minH: number;
}

export const DOCK_GRID: Record<DockPos, DockGridSpec> = {
  // Half the strip (datatoolkit-issues#101): two windows side by side fill
  // it; a third one makes the open windows share the width evenly (4 cols).
  bottom: { cols: 12, rows: 8, w: 6, h: 8, minW: 2, minH: 3 },
  // Narrow pane: full width, two windows per visible height.
  right: { cols: 2, rows: 12, w: 2, h: 6, minW: 1, minH: 3 },
};

/** Default window size in grid units per tool and dock position (MAT-252). */
export const TOOL_DEFAULT_SIZES: Partial<
  Record<ToolId, Partial<Record<DockPos, { w: number; h: number }>>>
> = {
  chart: {
    // Bottom dock: half the dock width (6 of 12 cols, the bottom default since
    // datatoolkit-issues#101) and full dock height (8 rows).
    bottom: { w: 6, h: 8 },
    // Right dock: full pane width (2 of 2 cols).
    right: { w: 2, h: 6 },
  },
};

/** Default size of a newly opened window for a tool at a dock position. */
export function defaultWindowSize(
  id: ToolId,
  pos: DockPos,
): { w: number; h: number } {
  const custom = TOOL_DEFAULT_SIZES[id]?.[pos];
  if (custom) return custom;
  const spec = DOCK_GRID[pos];
  return { w: spec.w, h: spec.h };
}

/** Upper bound on stored rows so a corrupt entry cannot blow up the grid. */
const MAX_ROWS = 200;

const POSITIONS: DockPos[] = ["bottom", "right"];

export function emptyDockLayouts(): DockLayouts {
  return { bottom: {}, right: {} };
}

function overlaps(a: DockRect, b: DockRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** First top-left slot (row-major) where a `w`×`h` rect fits without overlap. */
export function findSpot(
  layout: DockLayout,
  cols: number,
  w: number,
  h: number,
): { x: number; y: number } {
  const rects = Object.values(layout).filter((r): r is DockRect => !!r);
  const width = Math.min(w, cols);
  const maxY = rects.reduce((m, r) => Math.max(m, r.y + r.h), 0);
  for (let y = 0; y <= maxY; y++) {
    for (let x = 0; x + width <= cols; x++) {
      const cand = { x, y, w: width, h };
      if (!rects.some((r) => overlaps(r, cand))) return { x, y };
    }
  }
  return { x: 0, y: maxY };
}

/**
 * First top-left slot within the dock's visible rows where a `w`×`h` rect
 * fits without overlap. Returns null if no visible slot exists.
 */
export function findVisibleSpot(
  layout: DockLayout,
  cols: number,
  rows: number,
  w: number,
  h: number,
): { x: number; y: number } | null {
  const rects = Object.values(layout).filter((r): r is DockRect => !!r);
  const width = Math.min(w, cols);
  const height = Math.min(h, rows);
  for (let y = 0; y + height <= rows; y++) {
    for (let x = 0; x + width <= cols; x++) {
      const cand = { x, y, w: width, h: height };
      if (!rects.some((r) => overlaps(r, cand))) return { x, y };
    }
  }
  return null;
}

function clampRect(rect: DockRect, spec: DockGridSpec): DockRect {
  const w = Math.max(spec.minW, Math.min(spec.cols, Math.round(rect.w)));
  const h = Math.max(spec.minH, Math.min(MAX_ROWS, Math.round(rect.h)));
  const x = Math.max(0, Math.min(spec.cols - w, Math.round(rect.x)));
  const y = Math.max(0, Math.min(MAX_ROWS, Math.round(rect.y)));
  return { x, y, w, h };
}

/** Step 2 of the sizing strategy: narrow the window until a visible slot fits. */
function placeReduced(
  out: DockLayout,
  id: ToolId,
  size: { w: number; h: number },
  pos: DockPos,
  spec: DockGridSpec,
): boolean {
  const minW = pos === "bottom" ? Math.max(spec.minW, 4) : spec.minW;
  for (let w = size.w - 1; w >= minW; w--) {
    const spot = findVisibleSpot(out, spec.cols, spec.rows, w, size.h);
    if (spot) {
      out[id] = { x: spot.x, y: spot.y, w, h: size.h };
      return true;
    }
  }
  return false;
}

/** Split `total` units into `n` near-equal parts (the first `total % n` get one extra). */
const evenSplit = (total: number, n: number): number[] =>
  Array.from({ length: n }, (_, i) => Math.floor(total / n) + (i < total % n ? 1 : 0));

/** Step 3: lay all open windows out evenly along the dock's long axis. */
function redistribute(
  out: DockLayout,
  pos: DockPos,
  spec: DockGridSpec,
  tools: readonly ToolId[],
): boolean {
  if (tools.length === 0 || (pos !== "bottom" && pos !== "right")) return false;
  const horizontal = pos === "bottom";
  const total = horizontal ? spec.cols : spec.rows;
  if (Math.floor(total / tools.length) < (horizontal ? spec.minW : spec.minH)) {
    return false;
  }
  let cur = 0;
  evenSplit(total, tools.length).forEach((len, i) => {
    out[tools[i]!] = horizontal
      ? { x: cur, y: 0, w: len, h: spec.rows }
      : { x: 0, y: cur, w: spec.cols, h: len };
    cur += len;
  });
  return true;
}

function placeNewWindow(
  out: DockLayout,
  id: ToolId,
  pos: DockPos,
  spec: DockGridSpec,
  tools: readonly ToolId[],
): void {
  const size = defaultWindowSize(id, pos);

  // 1. Try tool's default size in visible dock area.
  const spot = findVisibleSpot(out, spec.cols, spec.rows, size.w, size.h);
  if (spot) {
    out[id] = { x: spot.x, y: spot.y, w: size.w, h: size.h };
    return;
  }
  // 2. Reduce width to the available visible free space.
  if (placeReduced(out, id, size, pos, spec)) return;
  // 3. Reduce/rearrange open windows so everything fits visible without scroll.
  if (redistribute(out, pos, spec, tools)) return;
  // Fallback: place top-right in minimum width.
  out[id] = {
    x: Math.max(0, spec.cols - spec.minW),
    y: 0,
    w: spec.minW,
    h: Math.min(size.h, spec.rows),
  };
}

/**
 * Keep exactly the open `tools` in every position's layout: drop closed
 * windows, give new ones their default size or fit them in the visible dock
 * area without scroll.
 *
 * Sizing strategy for new windows (MAT-252):
 * 1. Try the tool's default size in any free visible slot (y + h <= rows).
 * 2. If no visible slot accommodates it, reduce width to the free visible
 *    space (minimum 4 columns in bottom dock).
 * 3. Otherwise, redistribute / rearrange open windows evenly across visible
 *    space so every window remains visible on screen without scroll, with a
 *    fallback to the top-right corner at minimum width.
 */
export function syncDockLayouts(
  layouts: DockLayouts,
  tools: readonly ToolId[],
): DockLayouts {
  const next = emptyDockLayouts();
  for (const pos of POSITIONS) {
    const spec = DOCK_GRID[pos];
    const out: DockLayout = {};
    for (const id of tools) {
      const r = layouts[pos][id];
      if (r) out[id] = clampRect(r, spec);
    }
    for (const id of tools) {
      if (!out[id]) placeNewWindow(out, id, pos, spec, tools);
    }
    next[pos] = out;
  }
  return next;
}

/** Store the grid's layout (after a drag / resize) for one dock position. */
export function applyGridLayout(
  layouts: DockLayouts,
  pos: DockPos,
  items: readonly ({ i: string } & DockRect)[],
  tools: readonly ToolId[],
): DockLayouts {
  const spec = DOCK_GRID[pos];
  const out: DockLayout = { ...layouts[pos] };
  for (const item of items) {
    const id = item.i as ToolId;
    if (!tools.includes(id)) continue;
    out[id] = clampRect(item, spec);
  }
  return syncDockLayouts({ ...layouts, [pos]: out }, tools);
}

/** react-grid-layout items for the open windows at `pos`. */
export function toGridItems(
  layouts: DockLayouts,
  pos: DockPos,
  tools: readonly ToolId[],
): ({ i: ToolId; minW: number; minH: number } & DockRect)[] {
  const spec = DOCK_GRID[pos];
  const synced = syncDockLayouts(layouts, tools)[pos];
  return tools.map((id) => ({
    i: id,
    ...synced[id]!,
    minW: spec.minW,
    minH: spec.minH,
  }));
}

function isRect(value: unknown): value is DockRect {
  if (typeof value !== "object" || value === null) return false;
  const o = value as Record<string, unknown>;
  return (["x", "y", "w", "h"] as const).every(
    (k) => typeof o[k] === "number" && Number.isFinite(o[k]),
  );
}

/** Parse a stored layouts blob, keeping only well-formed rects of known tools. */
export function sanitizeDockLayouts(
  raw: unknown,
  knownTools: readonly ToolId[],
): DockLayouts {
  const next = emptyDockLayouts();
  if (typeof raw !== "object" || raw === null) return next;
  const o = raw as Record<string, unknown>;
  for (const pos of POSITIONS) {
    const layout = o[pos];
    if (typeof layout !== "object" || layout === null) continue;
    for (const [id, rect] of Object.entries(layout)) {
      if (!knownTools.includes(id as ToolId) || !isRect(rect)) continue;
      next[pos][id as ToolId] = clampRect(rect, DOCK_GRID[pos]);
    }
  }
  return next;
}

/**
 * Pixel row height so `spec.rows` rows exactly fill `height` (the grid
 * area's visible height) with `margin` px between rows and no padding.
 * S / M / L therefore scale every window with the dock.
 */
export function dockRowHeight(
  height: number,
  pos: DockPos,
  margin: number,
): number {
  const rows = DOCK_GRID[pos].rows;
  const usable = height - margin * (rows - 1);
  return Math.max(24, Math.floor(usable / rows));
}
