import type { ColumnKind } from "../../api/types";
import { isNumericKind } from "../kinds";

const CHART_TYPES = [
  "histogram",
  "box",
  "violin",
  "bar",
  "count",
  "scatter",
  "line",
  "heatmap",
  "density_heatmap",
  "pie",
  "scatter_matrix",
] as const;

export type ChartType = (typeof CHART_TYPES)[number];

export const CHART_AGGS = ["count", "mean", "sum", "median"] as const;
export type ChartAgg = (typeof CHART_AGGS)[number];

/** Editable chart-key params (everything except `source`). */
export interface ChartDraft {
  chart: ChartType;
  x: string | null;
  y: string | null;
  color: string | null;
  facet_row: string | null;
  facet_col: string | null;
  size: string | null;
  columns: string[];
  agg: ChartAgg | null;
  trendline: boolean;
  log_x: boolean;
  log_y: boolean;
  bins: number;
  sample_size: number | null;
}

export const DEFAULT_CHART_DRAFT: ChartDraft = {
  chart: "histogram",
  x: null,
  y: null,
  color: null,
  facet_row: null,
  facet_col: null,
  size: null,
  columns: [],
  agg: null,
  trendline: false,
  log_x: false,
  log_y: false,
  bins: 30,
  sample_size: 10_000,
};

export interface PrefillCol {
  name: string;
  kind: ColumnKind | string;
}

/**
 * Prefill heuristics (MAT-172):
 * - 1 column → histogram (numeric) / count (categorical)
 * - 2 numeric → scatter
 * - categorical + numeric → box
 */
export function chartPrefillFromSelection(cols: PrefillCol[]): ChartDraft {
  const base = { ...DEFAULT_CHART_DRAFT };
  if (cols.length === 0) return base;

  if (cols.length === 1) {
    const c = cols[0]!;
    if (isNumericKind(c.kind) && c.kind === "number") {
      return { ...base, chart: "histogram", x: c.name };
    }
    return { ...base, chart: "count", x: c.name };
  }

  const a = cols[0]!;
  const b = cols[1]!;
  const color = cols[2]?.name ?? null;
  const aNum = isNumericKind(a.kind);
  const bNum = isNumericKind(b.kind);

  if (aNum && bNum) {
    return {
      ...base,
      chart: "scatter",
      x: a.name,
      y: b.name,
      color,
    };
  }
  if (!aNum && bNum) {
    return {
      ...base,
      chart: "box",
      x: a.name,
      y: b.name,
      color,
    };
  }
  if (aNum && !bNum) {
    return {
      ...base,
      chart: "box",
      x: b.name,
      y: a.name,
      color,
    };
  }
  return {
    ...base,
    chart: "count",
    x: a.name,
    color: b.name,
  };
}

/** Scatter-matrix cap: beyond this a matrix of panels is unreadable. */
const WINDOW_MATRIX_MAX = 6;

/**
 * "Open in Chart" from an analysis window (MAT-235): the columns the window
 * ran on, plus its split. A split becomes the colour of the single-column
 * chart; three or more numeric columns open a scatter matrix; otherwise the
 * selection heuristics above.
 */
export function chartPrefillForWindow(
  cols: PrefillCol[],
  splitBy: string | null,
): ChartDraft {
  if (splitBy && cols.length > 0) {
    const first = cols.find((c) => c.name !== splitBy);
    if (first) {
      return { ...chartPrefillFromSelection([first]), color: splitBy };
    }
  }
  if (cols.length >= 3 && cols.every((c) => isNumericKind(c.kind))) {
    return {
      ...DEFAULT_CHART_DRAFT,
      chart: "scatter_matrix",
      columns: cols.slice(0, WINDOW_MATRIX_MAX).map((c) => c.name),
    };
  }
  return chartPrefillFromSelection(cols);
}

/** Params object for run_key / ChartSpec (no `source`). */
export function chartDraftToParams(
  draft: ChartDraft,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    chart: draft.chart,
    trendline: draft.trendline,
    log_x: draft.log_x,
    log_y: draft.log_y,
    bins: draft.bins,
  };
  if (draft.x != null) out.x = draft.x;
  else out.x = null;
  if (draft.y != null) out.y = draft.y;
  else out.y = null;
  if (draft.color != null) out.color = draft.color;
  else out.color = null;
  if (draft.facet_row != null) out.facet_row = draft.facet_row;
  else out.facet_row = null;
  if (draft.facet_col != null) out.facet_col = draft.facet_col;
  else out.facet_col = null;
  if (draft.size != null) out.size = draft.size;
  else out.size = null;
  if (draft.columns.length > 0) out.columns = draft.columns;
  if (draft.agg != null) out.agg = draft.agg;
  else out.agg = null;
  if (draft.sample_size != null) out.sample_size = draft.sample_size;
  else out.sample_size = null;
  return out;
}

export function chartParamsToDraft(
  params: Record<string, unknown>,
): ChartDraft {
  const chart = CHART_TYPES.includes(params.chart as ChartType)
    ? (params.chart as ChartType)
    : "histogram";
  const agg =
    params.agg != null && CHART_AGGS.includes(params.agg as ChartAgg)
      ? (params.agg as ChartAgg)
      : null;
  return {
    chart,
    x: typeof params.x === "string" ? params.x : null,
    y: typeof params.y === "string" ? params.y : null,
    color: typeof params.color === "string" ? params.color : null,
    facet_row: typeof params.facet_row === "string" ? params.facet_row : null,
    facet_col: typeof params.facet_col === "string" ? params.facet_col : null,
    size: typeof params.size === "string" ? params.size : null,
    columns: Array.isArray(params.columns)
      ? params.columns.filter((c): c is string => typeof c === "string")
      : [],
    agg,
    trendline: Boolean(params.trendline),
    log_x: Boolean(params.log_x),
    log_y: Boolean(params.log_y),
    bins:
      typeof params.bins === "number" && params.bins >= 2
        ? Math.min(200, Math.floor(params.bins))
        : 30,
    sample_size:
      params.sample_size === null
        ? null
        : typeof params.sample_size === "number" && params.sample_size >= 1
          ? Math.floor(params.sample_size)
          : 10_000,
  };
}

export function defaultChartName(draft: ChartDraft): string {
  if (draft.chart === "scatter_matrix") return "scatter matrix";
  if (draft.x && draft.y) return `${draft.chart}: ${draft.y} vs ${draft.x}`;
  if (draft.x) return `${draft.chart}: ${draft.x}`;
  return draft.chart;
}
