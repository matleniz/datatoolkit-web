import { isNumericKind } from "../kinds";
import {
  chartPrefillFromSelection,
  type ChartDraft,
  type ChartType,
  type PrefillCol,
} from "./chartPrefill";

/**
 * Chart-type picker logic (MAT-240): one tile per family, greyed out when the
 * columns in play cannot feed it (Tableau "Show Me"), the recommended tile
 * highlighted (Excel "Recommended charts"), and a click re-maps x / y so the
 * new type runs straight away. Pure — the tiles live in ChartTypePicker.tsx.
 */

export type ChartTileId =
  | "histogram"
  | "box"
  | "violin"
  | "bar"
  | "scatter"
  | "line"
  | "heatmap"
  | "pie"
  | "scatter_matrix";

export interface ChartTile {
  id: ChartTileId;
  label: string;
  /** Engine chart types this tile stands for (first = the one a click sets). */
  types: readonly ChartType[];
}

export const CHART_TILES: readonly ChartTile[] = [
  { id: "histogram", label: "Histogram", types: ["histogram"] },
  { id: "box", label: "Box", types: ["box"] },
  { id: "violin", label: "Violin", types: ["violin"] },
  { id: "bar", label: "Bar", types: ["bar", "count"] },
  { id: "scatter", label: "Scatter", types: ["scatter"] },
  { id: "line", label: "Line", types: ["line"] },
  { id: "heatmap", label: "Heatmap", types: ["density_heatmap", "heatmap"] },
  { id: "pie", label: "Pie", types: ["pie"] },
  { id: "scatter_matrix", label: "Matrix", types: ["scatter_matrix"] },
];

/** A numeric column with at most this many values also reads as categories. */
const FEW_VALUES = 20;
/** Scatter-matrix cap, same as the engine default. */
const MATRIX_MAX = 6;

export interface PickerCol extends PrefillCol {
  /** Distinct values (profile), when known. */
  distinct?: number;
}

function isCategorical(c: PickerCol): boolean {
  if (c.kind === "identifier") return false;
  if (!isNumericKind(c.kind)) return c.kind !== "date";
  return (
    c.kind === "binary" ||
    c.kind === "bool" ||
    (c.distinct != null && c.distinct <= FEW_VALUES)
  );
}

export function tileOf(chart: ChartType): ChartTileId {
  return CHART_TILES.find((t) => t.types.includes(chart))?.id ?? "histogram";
}

/**
 * Why `tile` cannot be drawn from `cols` (the hover text on a greyed tile),
 * or null when it fits.
 */
export function tileBlocker(tile: ChartTileId, cols: PickerCol[]): string | null {
  const numeric = cols.filter((c) => isNumericKind(c.kind)).length;
  switch (tile) {
    case "histogram":
    case "box":
    case "violin":
      return numeric >= 1 ? null : "needs 1 numeric column";
    case "scatter":
    case "heatmap":
      return numeric >= 2 ? null : "needs 2 numeric columns";
    case "scatter_matrix":
      return numeric >= 3 ? null : "needs 3 numeric columns";
    case "pie":
      return cols.some(isCategorical)
        ? null
        : `needs a column with at most ${FEW_VALUES} values`;
    case "bar":
    case "line":
      return cols.length >= 1 ? null : "needs 1 column";
  }
}

/** The tile to highlight for `cols` (same heuristics as the prefill). */
export function recommendedTile(cols: PickerCol[]): ChartTileId | null {
  if (cols.length === 0) return null;
  if (cols.length >= 3 && cols.every((c) => isNumericKind(c.kind))) {
    return "scatter_matrix";
  }
  return tileOf(chartPrefillFromSelection(cols).chart);
}

/**
 * The columns a tile is judged on: the grid selection when there is one
 * (plus what the draft already plots), else every column of the dataset.
 */
export function pickerPool(
  draft: ChartDraft,
  selection: string[],
  all: PickerCol[],
): PickerCol[] {
  const byName = new Map(all.map((c) => [c.name, c]));
  const names =
    selection.length > 0
      ? [...selection, draft.x, draft.y, ...draft.columns]
      : all.map((c) => c.name);
  const seen = new Set<string>();
  const out: PickerCol[] = [];
  for (const n of names) {
    if (!n || seen.has(n)) continue;
    const c = byName.get(n);
    if (!c) continue;
    seen.add(n);
    out.push(c);
  }
  return out;
}

/**
 * Switch the draft to `tile`, re-assigning x / y from what it already plots
 * then from `pool`, so the new type has what the engine requires. Colour,
 * facets and the "More" knobs are kept.
 */
export function applyTile(
  draft: ChartDraft,
  tile: ChartTileId,
  pool: PickerCol[],
): ChartDraft {
  const byName = new Map(pool.map((c) => [c.name, c]));
  const order: PickerCol[] = [];
  const push = (c: PickerCol | undefined) => {
    if (c && c.name !== draft.color && !order.includes(c)) order.push(c);
  };
  for (const n of [draft.x, draft.y, ...draft.columns]) {
    if (n) push(byName.get(n));
  }
  pool.forEach(push);

  const nums = order.filter((c) => isNumericKind(c.kind));
  const cats = order.filter(isCategorical);
  const firstNum = nums[0]?.name ?? null;
  const base: ChartDraft = { ...draft, columns: [] };

  switch (tile) {
    case "histogram":
      return { ...base, chart: "histogram", x: firstNum, y: null };
    case "box":
    case "violin": {
      const y = firstNum;
      const x = cats.find((c) => c.name !== y)?.name ?? null;
      // Engine needs x: a lone numeric column draws one horizontal box.
      return x
        ? { ...base, chart: tile, x, y }
        : { ...base, chart: tile, x: y, y: null };
    }
    case "scatter":
    case "heatmap":
      return {
        ...base,
        chart: tile === "scatter" ? "scatter" : "density_heatmap",
        x: nums[0]?.name ?? null,
        y: nums[1]?.name ?? null,
      };
    case "bar": {
      const x = (cats[0] ?? order[0])?.name ?? null;
      const y = nums.find((c) => c.name !== x)?.name ?? null;
      return { ...base, chart: y ? "bar" : "count", x, y };
    }
    case "line": {
      const x =
        order.find((c) => c.kind === "date")?.name ?? order[0]?.name ?? null;
      const y = nums.find((c) => c.name !== x)?.name ?? null;
      return { ...base, chart: "line", x, y };
    }
    case "pie":
      return { ...base, chart: "pie", x: cats[0]?.name ?? null, y: null };
    case "scatter_matrix":
      return {
        ...base,
        chart: "scatter_matrix",
        x: null,
        y: null,
        columns: nums.slice(0, MATRIX_MAX).map((c) => c.name),
      };
  }
}
