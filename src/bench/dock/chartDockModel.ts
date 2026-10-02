import type { ChartDraft } from "./chartPrefill";

/** Which optional controls the chart type exposes. */
export interface ChartVisibility {
  isMatrix: boolean;
  showAgg: boolean;
  showTrend: boolean;
  showBins: boolean;
  showSize: boolean;
}

const AGG_CHARTS = ["bar", "count", "line", "histogram", "pie"];
const BIN_CHARTS = ["histogram", "density_heatmap", "heatmap"];

export function chartVisibility(draft: ChartDraft): ChartVisibility {
  return {
    isMatrix: draft.chart === "scatter_matrix",
    showAgg: AGG_CHARTS.includes(draft.chart),
    showTrend: draft.chart === "scatter",
    showBins: BIN_CHARTS.includes(draft.chart),
    showSize: draft.chart === "scatter",
  };
}

/** Number of non-default options folded under "More". */
export function moreOptionCount(draft: ChartDraft, vis: ChartVisibility): number {
  return [
    draft.facet_row,
    draft.facet_col,
    vis.showSize ? draft.size : null,
    vis.showAgg ? draft.agg : null,
    vis.showTrend && draft.trendline ? "t" : null,
    draft.log_x ? "lx" : null,
    draft.log_y ? "ly" : null,
  ].filter(Boolean).length;
}

/**
 * Field the chart type needs before the engine can draw it, as a hint
 * ("Pick X"), or null when the draft is runnable. Mirrors the engine's
 * "chart '<type>' requires x" checks so no request is sent that would 422.
 */
export function missingChartField(draft: ChartDraft): string | null {
  switch (draft.chart) {
    case "scatter":
    case "heatmap":
    case "density_heatmap":
      if (!draft.x) return "Pick X";
      return draft.y ? null : "Pick Y";
    case "scatter_matrix":
      return null; // no columns = the engine's first numeric ones
    default:
      return draft.x ? null : "Pick X";
  }
}
