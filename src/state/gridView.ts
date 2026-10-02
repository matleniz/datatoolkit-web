/**
 * View-only grid filter / sort (datatoolkit-issues#81). Lives in Studio state,
 * is sent to `/workspace/rows` and never touches the workspace, the pipeline
 * or the data identity. A filter has exactly the `filter_rows` params shape,
 * so "make it a step" is a verbatim copy.
 */
export type FilterOp =
  | "eq"
  | "ne"
  | "gt"
  | "ge"
  | "lt"
  | "le"
  | "isin"
  | "notin"
  | "isna"
  | "notna";

export interface GridCondition {
  column: string;
  op: FilterOp;
  value?: unknown;
}

export interface GridFilter {
  conditions: GridCondition[];
  combine: "and" | "or";
}

export interface GridSortKey {
  column: string;
  desc: boolean;
}

export interface GridView {
  filter: GridFilter | null;
  sort: GridSortKey[];
}

export const EMPTY_GRID_VIEW: GridView = { filter: null, sort: [] };

export const FILTER_OPS: { op: FilterOp; label: string }[] = [
  { op: "eq", label: "=" },
  { op: "ne", label: "≠" },
  { op: "gt", label: ">" },
  { op: "ge", label: "≥" },
  { op: "lt", label: "<" },
  { op: "le", label: "≤" },
  { op: "isin", label: "is one of" },
  { op: "notin", label: "is not one of" },
  { op: "isna", label: "is missing" },
  { op: "notna", label: "is not missing" },
];

export function isGridViewActive(v: GridView): boolean {
  return v.filter !== null || v.sort.length > 0;
}

/** Stable key for effect deps / request dedupe. */
export function gridViewKey(v: GridView): string {
  return isGridViewActive(v) ? JSON.stringify(v) : "";
}

/** Engine request fields (`filter`, `sort`); empty when there is no view. */
export function gridViewBody(v: GridView): {
  filter?: GridFilter;
  sort?: GridSortKey[];
} {
  const body: { filter?: GridFilter; sort?: GridSortKey[] } = {};
  if (v.filter) body.filter = v.filter;
  if (v.sort.length > 0) body.sort = v.sort;
  return body;
}

const NO_VALUE_OPS: FilterOp[] = ["isna", "notna"];
const LIST_OPS: FilterOp[] = ["isin", "notin"];

export function opNeedsValue(op: FilterOp): boolean {
  return !NO_VALUE_OPS.includes(op);
}

export function opIsList(op: FilterOp): boolean {
  return LIST_OPS.includes(op);
}

function scalar(text: string, numeric: boolean): string | number | null {
  const t = text.trim();
  if (!numeric) return t;
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * Typed condition from the dialog's raw text: numbers for numeric columns,
 * comma-separated list for isin / notin. Null while the value is incomplete.
 */
export function buildCondition(
  column: string,
  op: FilterOp,
  raw: string,
  numeric: boolean,
): GridCondition | null {
  if (!opNeedsValue(op)) return { column, op };
  if (opIsList(op)) {
    const parts = raw.split(",").map((p) => scalar(p, numeric));
    if (parts.length === 0 || parts.some((p) => p === null || p === "")) {
      return null;
    }
    return { column, op, value: parts };
  }
  const v = scalar(raw, numeric);
  return v === null || v === "" ? null : { column, op, value: v };
}

/** Add a condition to the view's filter (AND by default). */
export function addCondition(v: GridView, c: GridCondition): GridView {
  const filter: GridFilter = v.filter
    ? { ...v.filter, conditions: [...v.filter.conditions, c] }
    : { conditions: [c], combine: "and" };
  return { ...v, filter };
}

export function removeCondition(v: GridView, index: number): GridView {
  if (!v.filter) return v;
  const conditions = v.filter.conditions.filter((_, i) => i !== index);
  return {
    ...v,
    filter: conditions.length ? { ...v.filter, conditions } : null,
  };
}

/** Sort by one column (replaces the sort); same direction again clears it. */
export function toggleSort(
  v: GridView,
  column: string,
  desc: boolean,
): GridView {
  const cur = v.sort.length === 1 ? v.sort[0] : null;
  if (cur && cur.column === column && cur.desc === desc) {
    return { ...v, sort: [] };
  }
  return { ...v, sort: [{ column, desc }] };
}

export function conditionText(c: GridCondition): string {
  const label = FILTER_OPS.find((o) => o.op === c.op)?.label ?? c.op;
  if (!opNeedsValue(c.op)) return `${c.column} ${label}`;
  const val = Array.isArray(c.value)
    ? `[${c.value.map(String).join(", ")}]`
    : String(c.value);
  return `${c.column} ${label} ${val}`;
}
