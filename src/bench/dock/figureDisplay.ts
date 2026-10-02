/**
 * Front-only display controls for engine Plotly figures (MAT-235).
 *
 * Every transform here is presentational: it reorders, filters, rescales or
 * restyles what the key returned — it never computes new data (that is the
 * engine's job, hub AGENTS.md). Figures are plain Plotly JSON; numeric arrays
 * may arrive base64-encoded (`{dtype, bdata, shape}`, plotly.py ≥ 6).
 */

import type { BarSort, FigureDisplay } from "../../state/toolViews";

export type { BarSort, FigureDisplay };

type Json = Record<string, unknown>;

export const DEFAULT_FIGURE_DISPLAY: FigureDisplay = {
  topN: null,
  sort: "none",
  percent: false,
  log: false,
  annotations: true,
};

/** Which display controls make sense for a figure. */
export interface FigureCaps {
  /** Categorical bar figure: top-N and sort apply. */
  sortable: boolean;
  /** Count-valued bars / histograms: count vs % applies. */
  percent: boolean;
  /** A numeric value axis exists: log scale applies. */
  log: boolean;
  /** Labels or annotations exist that can be hidden. */
  annotations: boolean;
}

const TYPED: Record<
  string,
  {
    new (buf: ArrayBuffer, offset: number, length: number): ArrayLike<number>;
    BYTES_PER_ELEMENT: number;
  }
> = {
  f8: Float64Array,
  f4: Float32Array,
  i4: Int32Array,
  i2: Int16Array,
  i1: Int8Array,
  u4: Uint32Array,
  u2: Uint16Array,
  u1: Uint8Array,
  u1c: Uint8ClampedArray,
};

function isObj(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Plain array for a Plotly data array (plain or base64 typed). 2-D typed
 * arrays (`shape: "r, c"`) come back as rows. Null when not decodable.
 */
export function decodeArray(v: unknown): unknown[] | null {
  if (Array.isArray(v)) return v;
  if (!isObj(v) || typeof v.bdata !== "string" || typeof v.dtype !== "string") {
    return null;
  }
  const Ctor = TYPED[v.dtype];
  if (!Ctor) return null;
  let bin: string;
  try {
    bin = atob(v.bdata);
  } catch {
    return null;
  }
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const flat = Array.from(
    new Ctor(bytes.buffer, 0, Math.floor(bytes.length / Ctor.BYTES_PER_ELEMENT)),
  );
  const shape =
    typeof v.shape === "string"
      ? v.shape.split(",").map((s) => Number(s.trim()))
      : Array.isArray(v.shape)
        ? v.shape.map(Number)
        : null;
  if (shape && shape.length === 2 && shape[1]! > 0) {
    const cols = shape[1]!;
    const rows: number[][] = [];
    for (let i = 0; i < flat.length; i += cols) rows.push(flat.slice(i, i + cols));
    return rows;
  }
  return flat;
}

function traces(plotly: Json): Json[] {
  return Array.isArray(plotly.data) ? (plotly.data as unknown[]).filter(isObj) : [];
}

function layoutOf(plotly: Json): Json {
  return isObj(plotly.layout) ? plotly.layout : {};
}

const isHorizontal = (t: Json) => t.orientation === "h";

/** Category and value arrays of a bar trace (null when not decodable). */
function barArrays(t: Json): { cats: unknown[]; vals: unknown[] } | null {
  const cats = decodeArray(isHorizontal(t) ? t.y : t.x);
  const vals = decodeArray(isHorizontal(t) ? t.x : t.y);
  if (!cats || !vals || cats.length !== vals.length) return null;
  return { cats, vals };
}

function numbers(vals: unknown[]): number[] | null {
  const out: number[] = [];
  for (const v of vals) {
    if (v === null) continue;
    if (typeof v !== "number" || !Number.isFinite(v)) return null;
    out.push(v);
  }
  return out;
}

const isCount = (n: number) => n >= 0 && Number.isInteger(n);

function hasText(t: Json): boolean {
  const tt = t.texttemplate;
  if (typeof tt === "string" && tt !== "") return true;
  const text = decodeArray(t.text) ?? (typeof t.text === "string" ? [t.text] : null);
  return !!text && text.some((x) => x !== null && x !== "");
}

export function figureCaps(plotly: Json): FigureCaps {
  const ts = traces(plotly);
  const layout = layoutOf(plotly);
  const annotations =
    (Array.isArray(layout.annotations) && layout.annotations.length > 0) ||
    ts.some(hasText);
  if (ts.length === 0) {
    return { sortable: false, percent: false, log: false, annotations };
  }
  const allBars = ts.every((t) => t.type === "bar");
  const allHist = ts.every((t) => t.type === "histogram");
  if (allBars) {
    const arrays = ts.map(barArrays);
    const ok = arrays.every((a) => a !== null);
    const cats = ok ? arrays.flatMap((a) => a!.cats) : [];
    const vals = ok ? arrays.map((a) => numbers(a!.vals)) : [];
    const numeric = ok && vals.every((v) => v !== null);
    const sortable =
      numeric &&
      new Set(cats).size >= 2 &&
      cats.every((c) => typeof c === "string");
    const percent =
      numeric && vals.every((v) => v!.every(isCount)) && vals.some((v) => v!.length > 0);
    return { sortable, percent, log: numeric, annotations };
  }
  if (allHist) {
    return { sortable: false, percent: true, log: true, annotations };
  }
  const scatterLike = ts.every(
    (t) => t.type === "scatter" || t.type === "scattergl" || t.type === "box" || t.type === "violin",
  );
  return { sortable: false, percent: false, log: scatterLike, annotations };
}

/** Per-point keys filtered alongside the category axis (when arrays). */
const POINT_KEYS = ["text", "hovertext", "customdata", "ids", "width", "base"];

function keepPoints(t: Json, keep: number[], n: number): void {
  const pick = (v: unknown) => {
    const arr = decodeArray(v);
    return arr && arr.length === n ? keep.map((i) => arr[i]) : v;
  };
  const catKey = isHorizontal(t) ? "y" : "x";
  const valKey = isHorizontal(t) ? "x" : "y";
  t[catKey] = pick(t[catKey]);
  t[valKey] = pick(t[valKey]);
  for (const k of POINT_KEYS) if (k in t) t[k] = pick(t[k]);
  if (isObj(t.marker)) {
    const marker = { ...t.marker };
    for (const k of ["color", "opacity", "size"]) {
      if (k in marker) marker[k] = pick(marker[k]);
    }
    t.marker = marker;
  }
}

/** Layout keys of every x (or y) axis the figure declares, plus the base one. */
function axisKeys(layout: Json, letter: "x" | "y"): string[] {
  const re = new RegExp(`^${letter}axis\\d*$`);
  const keys = Object.keys(layout).filter((k) => re.test(k));
  return keys.includes(`${letter}axis`) ? keys : [`${letter}axis`, ...keys];
}

function patchAxes(layout: Json, letter: "x" | "y", patch: Json): void {
  for (const k of axisKeys(layout, letter)) {
    layout[k] = { ...(isObj(layout[k]) ? layout[k] : {}), ...patch };
  }
}

function sortAndTrim(plotly: Json, d: FigureDisplay): void {
  const ts = traces(plotly);
  const totals = new Map<string, number>();
  for (const t of ts) {
    const a = barArrays(t)!;
    a.cats.forEach((c, i) => {
      const v = a.vals[i];
      totals.set(String(c), (totals.get(String(c)) ?? 0) + (typeof v === "number" ? v : 0));
    });
  }
  let order = [...totals.keys()];
  if (d.sort !== "none") {
    const sign = d.sort === "desc" ? -1 : 1;
    order = order
      .map((c, i) => ({ c, i, v: totals.get(c)! }))
      .sort((a, b) => sign * (a.v - b.v) || a.i - b.i)
      .map((x) => x.c);
  }
  if (d.topN !== null && d.topN > 0) order = order.slice(0, d.topN);
  const kept = new Set(order);
  const horizontal = ts.some(isHorizontal);
  for (const t of ts) {
    const a = barArrays(t)!;
    const idx = a.cats
      .map((c, i) => ({ c: String(c), i }))
      .filter((x) => kept.has(x.c))
      .sort((x, y) => order.indexOf(x.c) - order.indexOf(y.c))
      .map((x) => x.i);
    keepPoints(t, idx, a.cats.length);
  }
  // Horizontal bars draw the first category at the bottom: largest on top.
  patchAxes(layoutOf(plotly), horizontal ? "y" : "x", {
    categoryorder: "array",
    categoryarray: horizontal ? [...order].reverse() : order,
  });
}

function toPercent(plotly: Json): string {
  const ts = traces(plotly);
  if (ts.every((t) => t.type === "histogram")) {
    for (const t of ts) t.histnorm = "percent";
    return ts.some(isHorizontal) ? "x" : "y";
  }
  let total = 0;
  for (const t of ts) {
    for (const v of barArrays(t)!.vals) if (typeof v === "number") total += v;
  }
  for (const t of ts) {
    const valKey = isHorizontal(t) ? "x" : "y";
    const vals = decodeArray(t[valKey])!;
    t[valKey] = vals.map((v) =>
      typeof v === "number" && total > 0 ? (v / total) * 100 : v,
    );
  }
  return ts.some(isHorizontal) ? "x" : "y";
}

function valueAxis(plotly: Json): "x" | "y" {
  return traces(plotly).some(
    (t) => (t.type === "bar" || t.type === "histogram") && isHorizontal(t),
  )
    ? "x"
    : "y";
}

function hideLabels(plotly: Json): void {
  const layout = layoutOf(plotly);
  if (Array.isArray(layout.annotations)) layout.annotations = [];
  for (const t of traces(plotly)) {
    delete t.texttemplate;
    delete t.text;
    if (t.type === "bar") t.textposition = "none";
  }
}

/**
 * Apply the window's display settings to a figure (always returns a copy:
 * Plotly mutates what it is given, cached Results must stay pristine).
 * Settings a figure does not support are ignored.
 */
export function applyDisplay(
  plotly: Json,
  display: FigureDisplay,
  caps: FigureCaps = figureCaps(plotly),
): Json {
  const out = JSON.parse(JSON.stringify(plotly)) as Json;
  out.layout = { ...layoutOf(out) };
  if (caps.sortable && (display.sort !== "none" || display.topN !== null)) {
    sortAndTrim(out, display);
  }
  if (caps.percent && display.percent) {
    const axis = toPercent(out);
    patchAxes(layoutOf(out), axis === "x" ? "x" : "y", {
      title: { text: "% of total" },
    });
  }
  if (caps.log && display.log) {
    patchAxes(layoutOf(out), valueAxis(out), { type: "log" });
  }
  if (caps.annotations && !display.annotations) hideLabels(out);
  return out;
}

/** Minimal shape of a Plotly click-event point. */
export interface PlotPoint {
  x?: unknown;
  y?: unknown;
  data?: { type?: string; orientation?: string };
}

/**
 * Dataset columns a clicked point stands for (MAT-235 click-through): the
 * category of a bar whose axis holds column names, or both axes of a heatmap
 * cell (a column pair, e.g. correlation). Empty when the point is not a column.
 */
export function clickedColumns(point: PlotPoint, columns: readonly string[]): string[] {
  const known = new Set(columns);
  const type = point.data?.type;
  let cands: unknown[] = [];
  if (type === "bar") {
    cands = [point.data?.orientation === "h" ? point.y : point.x];
  } else if (type === "heatmap") {
    cands = [point.x, point.y];
  }
  const out: string[] = [];
  for (const c of cands) {
    if (typeof c === "string" && known.has(c) && !out.includes(c)) out.push(c);
  }
  return out;
}

/** True when some bar / heatmap axis of the figure names dataset columns. */
export function figureHasColumnAxis(plotly: Json, columns: readonly string[]): boolean {
  const known = new Set(columns);
  return traces(plotly).some((t) => {
    if (t.type === "bar") {
      const cats = decodeArray(isHorizontal(t) ? t.y : t.x);
      return !!cats && cats.some((c) => typeof c === "string" && known.has(c));
    }
    if (t.type === "heatmap") {
      const xs = decodeArray(t.x) ?? [];
      const ys = decodeArray(t.y) ?? [];
      return [...xs, ...ys].some((c) => typeof c === "string" && known.has(c));
    }
    return false;
  });
}

/**
 * Layout tweaks so labels and legend never collide with the plot or the
 * Plotly mode bar: automargin on both axes, and a horizontal legend above
 * the plot on the left (the mode bar lives top-right). Pure presentation.
 */
export function dockFigureLayout(raw: Json, traceCount: number): Json {
  const axis = (k: string) => ({
    ...((raw[k] as Json | undefined) ?? {}),
    automargin: true,
  });
  const hasLegend = raw.showlegend !== false && (raw.showlegend === true || traceCount > 1);
  const out: Json = { ...raw, xaxis: axis("xaxis"), yaxis: axis("yaxis") };
  if (hasLegend) {
    out.legend = {
      ...((raw.legend as Json | undefined) ?? {}),
      orientation: "h",
      x: 0,
      xanchor: "left",
      y: 1.02,
      yanchor: "bottom",
    };
  }
  return out;
}
