import type { ColumnProfile, JsonSchema, WorkspaceRow } from "../../api/types";
import { isOutlierValue } from "../alerts";
import { fmtStat, round3 } from "../left/stats";
import type { ToolId } from "../../state/reducer";

/** Tools that can widen past the grid selection via an explicit toggle. */
export const SCOPEABLE_TOOLS = new Set<ToolId>([
  "outliers",
  "missing",
  "target",
  "corr",
  "feature_selection",
]);

export function schemaHasColumns(schema: JsonSchema): boolean {
  return Boolean(schema.properties && "columns" in schema.properties);
}

/**
 * Columns to pass to an engine key that declares `columns`.
 * `null` means "all" (omit / empty — engine default).
 */
export function engineColumnsParam(
  selCols: string[],
  scopeAll: boolean,
): string[] | null {
  if (scopeAll || selCols.length === 0) return null;
  return selCols.slice();
}

export function isNumericKind(kind: string): boolean {
  return kind === "number" || kind === "binary" || kind === "bool";
}

/** Numeric columns from the current selection that exist in profiles. */
export function selectedNumericColumns(
  selCols: string[],
  profiles: ColumnProfile[],
): string[] {
  const byName = new Map(profiles.map((p) => [p.name, p]));
  return selCols.filter((c) => {
    const p = byName.get(c);
    return p != null && p.kind === "number";
  });
}

export function outliersBoundLabel(
  col: string,
  profile: ColumnProfile | undefined,
): string {
  const fences = profile?.iqr_bounds
    ? ` · fences ${fmtStat(round3(profile.iqr_bounds.lo))} / ${fmtStat(round3(profile.iqr_bounds.hi))}`
    : "";
  return `bound to ${col}${fences}`;
}

export interface OutlierRow {
  rid: number;
  value: number;
}

/** IQR outlier cells for one column (sentinels excluded), matching the prototype. */
export function listOutlierRows(
  rows: WorkspaceRow[],
  col: string,
  profile: ColumnProfile | undefined,
): OutlierRow[] {
  const out: OutlierRow[] = [];
  for (const r of rows) {
    const v = r[col];
    if (isOutlierValue(profile, v, "number") && typeof v === "number") {
      out.push({ rid: r._rid, value: v });
    }
  }
  return out;
}

export function maxAbs(values: number[]): number {
  let m = 0;
  for (const v of values) {
    const a = Math.abs(v);
    if (a > m) m = a;
  }
  return m || 1;
}
