/**
 * Per-window view choices of the analysis dock (MAT-235), kept in
 * `AppState.toolViews`. Types only; the logic stays in bench/dock
 * (figureDisplay, windowView), which re-exports them.
 */
export type BarSort = "none" | "desc" | "asc";

export interface FigureDisplay {
  /** Keep the N largest categories (after sort); null = all. */
  topN: number | null;
  sort: BarSort;
  /** Values as % of the total instead of counts. */
  percent: boolean;
  /** Log scale on the value axis. */
  log: boolean;
  /** Text labels on marks and layout annotations. */
  annotations: boolean;
}

/** The user's choice, remembered per window (reducer `toolViews`). */
export type StoredView =
  | { kind: "figure"; title: string; index: number; count: number }
  | { kind: "table" };

export interface ToolViewState {
  view?: StoredView;
  display?: Partial<FigureDisplay>;
  /** Details drawer open. */
  details?: boolean;
  /** Parameters panel expanded (collapsed by default: the figure first). */
  params?: boolean;
}
