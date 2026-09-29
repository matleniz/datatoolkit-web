import type { Result, ResultFigure } from "../../api/types";
import { DEFAULT_FIGURE_DISPLAY, type FigureDisplay } from "./figureDisplay";

/**
 * What an analysis window shows (MAT-235): one of the key's figures, the
 * Table view, or — when the key returned neither — its metrics.
 */
export type WindowView =
  | { kind: "figure"; index: number }
  | { kind: "table" }
  | { kind: "metrics" };

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

/** Figure opened by default: the key's `main` one, otherwise the first. */
export function defaultFigureIndex(figures: readonly ResultFigure[]): number {
  const i = figures.findIndex((f) => f.main === true);
  return i >= 0 ? i : 0;
}

/**
 * Resolve the stored choice against a (possibly new) Result. A figure is
 * found again by title; when titles follow the data (e.g. a column name)
 * and the figure list kept its length, by position; otherwise the default.
 */
export function resolveView(
  result: Pick<Result, "figures" | "tables">,
  stored: StoredView | undefined,
): WindowView {
  const figs = result.figures;
  if (stored?.kind === "table" && result.tables.length > 0) {
    return { kind: "table" };
  }
  if (stored?.kind === "figure" && figs.length > 0) {
    const byTitle = figs.findIndex((f) => f.title === stored.title);
    if (byTitle >= 0) return { kind: "figure", index: byTitle };
    if (stored.count === figs.length && stored.index < figs.length) {
      return { kind: "figure", index: stored.index };
    }
  }
  if (figs.length > 0) return { kind: "figure", index: defaultFigureIndex(figs) };
  if (result.tables.length > 0) return { kind: "table" };
  return { kind: "metrics" };
}

export function storedViewFor(
  result: Pick<Result, "figures">,
  view: WindowView,
): StoredView | undefined {
  if (view.kind === "table") return { kind: "table" };
  if (view.kind !== "figure") return undefined;
  const f = result.figures[view.index];
  if (!f) return undefined;
  return {
    kind: "figure",
    title: f.title,
    index: view.index,
    count: result.figures.length,
  };
}

export function displayOf(state: ToolViewState | undefined): FigureDisplay {
  return { ...DEFAULT_FIGURE_DISPLAY, ...(state?.display ?? {}) };
}
