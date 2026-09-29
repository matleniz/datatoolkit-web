import type { JsonValue, WorkspaceRow } from "../../api/types";

function isNull(v: JsonValue | undefined): boolean {
  return v === null || v === undefined;
}

function nums(rows: WorkspaceRow[], column: string): number[] {
  const out: number[] = [];
  for (const r of rows) {
    const v = r[column];
    if (typeof v === "number" && !Number.isNaN(v) && v !== -999) out.push(v);
  }
  return out;
}

function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  const p = (sorted.length - 1) * q;
  const lo = Math.floor(p);
  const hi = Math.ceil(p);
  const a = sorted[lo]!;
  const b = sorted[hi]!;
  return a + (b - a) * (p - lo);
}

export function round3(v: number | null): number | null {
  if (v === null || Number.isNaN(v)) return null;
  return Math.round(v * 1000) / 1000;
}

export function fmtStat(v: number | null): string {
  if (v === null) return "∅";
  return String(Number.isInteger(v) ? v : round3(v));
}

/** Compute a named train statistic from workspace rows (latest train). */
export function computeStat(
  rows: WorkspaceRow[],
  stat: string,
  column: string,
): number | null {
  if (stat === "count") {
    return rows.filter((r) => !isNull(r[column])).length;
  }
  const a = nums(rows, column);
  if (!a.length) return null;
  const sorted = [...a].sort((x, y) => x - y);
  const mean = a.reduce((s, x) => s + x, 0) / a.length;
  switch (stat) {
    case "mean":
      return round3(mean);
    case "median":
      return round3(quantile(sorted, 0.5));
    case "std": {
      const v = a.reduce((s, x) => s + (x - mean) * (x - mean), 0) / a.length;
      return round3(Math.sqrt(v));
    }
    case "min":
      return round3(sorted[0] ?? null);
    case "max":
      return round3(sorted[sorted.length - 1] ?? null);
    case "q25":
      return round3(quantile(sorted, 0.25));
    case "q75":
      return round3(quantile(sorted, 0.75));
    default:
      return null;
  }
}
