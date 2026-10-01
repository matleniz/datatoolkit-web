/**
 * Chart tool draft (MAT-172): the editable chart-key params kept in
 * `AppState.chartDraft`. Lives under state/ so the reducer imports nothing
 * from bench/; the Chart dock helpers (bench/dock/chartPrefill) re-export it.
 */
export const CHART_TYPES = [
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
