import type { JsonValue } from "../../api/types";

/** Rows per page (was a hard cut at 40 rows before MAT-235). */
export const TABLE_PAGE_SIZE = 50;

export type SortState = { col: string; dir: 1 | -1 } | null;

const isEmpty = (v: JsonValue | undefined) =>
  v === null || v === undefined || v === "";

function compareCells(a: JsonValue, b: JsonValue): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

/** Sort rows by one column; empty cells always last; stable. */
export function sortRecords(
  records: Record<string, JsonValue>[],
  sort: SortState,
): Record<string, JsonValue>[] {
  if (!sort) return records;
  return records
    .map((r, i) => ({ r, i }))
    .sort((x, y) => {
      const a = x.r[sort.col];
      const b = y.r[sort.col];
      if (isEmpty(a) || isEmpty(b)) {
        return isEmpty(a) === isEmpty(b) ? x.i - y.i : isEmpty(a) ? 1 : -1;
      }
      return sort.dir * compareCells(a!, b!) || x.i - y.i;
    })
    .map((x) => x.r);
}
