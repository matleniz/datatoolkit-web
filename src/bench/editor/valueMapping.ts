import type { ColumnKind, JsonValue } from "../../api/types";
import { isNumericKind } from "../kinds";

/** `replace_values.mapping`: column -> { old value (as text) -> new value | null }. */
export type ValueMapping = Record<string, Record<string, JsonValue>>;

/** One editable `old -> new` pair; `nw` empty = the value becomes missing. */
export interface PairRow {
  old: string;
  nw: string;
}

/** The new value typed in the editor, as the engine wants it for that column. */
export function parseNewValue(text: string, kind: ColumnKind | undefined): JsonValue {
  const t = text.trim();
  if (t === "") return null;
  if (kind === "bool" || kind === "binary") {
    const l = t.toLowerCase();
    if (l === "true") return true;
    if (l === "false") return false;
  }
  if (isNumericKind(kind)) {
    const n = Number(t);
    if (!Number.isNaN(n)) return n;
  }
  return text;
}

/** Display form of a stored new value (null / undefined -> empty = missing). */
export function newValueText(v: JsonValue | undefined): string {
  return v === null || v === undefined ? "" : String(v);
}

export function rowsOf(pairs: Record<string, JsonValue> | undefined): PairRow[] {
  return Object.entries(pairs ?? {}).map(([old, nw]) => ({ old, nw: newValueText(nw) }));
}

/** Columns with at least one pair that names an old value; the last duplicate wins. */
export function buildMapping(
  columns: string[],
  rows: Record<string, PairRow[]>,
  kindOf: (column: string) => ColumnKind | undefined,
): ValueMapping {
  const out: ValueMapping = {};
  for (const col of columns) {
    const pairs: Record<string, JsonValue> = {};
    for (const r of rows[col] ?? []) {
      if (r.old.trim() === "") continue;
      pairs[r.old] = parseNewValue(r.nw, kindOf(col));
    }
    if (Object.keys(pairs).length > 0) out[col] = pairs;
  }
  return out;
}
