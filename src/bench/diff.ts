import type {
  ColumnKind,
  JsonValue,
  PreviewStep,
  PreviewStepChange,
  WorkspaceRow,
  WorkspaceRowsColumn,
} from "../api/types";
import { same } from "./format";

export type ColStatus = "" | "added" | "removed";
export type RowStatus = "" | "removed";

export interface DisplayCol {
  name: string;
  kind: ColumnKind;
  status: ColStatus;
}

export interface DisplayRow {
  rid: number;
  vals: Record<string, JsonValue>;
  prev: Record<string, JsonValue>;
  status: RowStatus;
  changed: Record<string, boolean>;
}

export interface DiffCounts {
  added: number;
  removed: number;
  rowsRemoved: number;
  changed: number;
}

export interface DisplayFrame {
  cols: DisplayCol[];
  rows: DisplayRow[];
  diff: DiffCounts | null;
}

/**
 * Build a coloured display frame from base rows + optional preview_step.
 * Mirrors prototype buildDisplay, driven by engine preview instead of local apply.
 */
export function buildDisplay(
  baseColumns: WorkspaceRowsColumn[],
  baseRows: WorkspaceRow[],
  preview: PreviewStep | null,
  /** After-frame rows when pending step is included in the workspace. */
  nextRows: WorkspaceRow[] | null = null,
  nextColumns: WorkspaceRowsColumn[] | null = null,
): DisplayFrame {
  if (!preview) {
    return {
      cols: baseColumns.map((c) => ({
        name: c.name,
        kind: c.kind,
        status: "" as const,
      })),
      rows: baseRows.map((r) => ({
        rid: r._rid,
        vals: r,
        prev: r,
        status: "" as const,
        changed: {},
      })),
      diff: null,
    };
  }

  const added = new Set(preview.added_columns);
  const removed = new Set(preview.removed_columns);
  const removedRids = new Set(preview.removed_rids);

  const kindByName = new Map<string, ColumnKind>();
  for (const c of baseColumns) kindByName.set(c.name, c.kind);
  if (nextColumns) {
    for (const c of nextColumns) kindByName.set(c.name, c.kind);
  }

  const nextNames =
    nextColumns?.map((c) => c.name) ??
    preview.columns.filter((n) => !removed.has(n));

  const cols: DisplayCol[] = nextNames.map((name) => ({
    name,
    kind: kindByName.get(name) ?? "text",
    status: added.has(name) ? ("added" as const) : ("" as const),
  }));

  // Insert removed columns at their approximate base position.
  baseColumns.forEach((c, i) => {
    if (!removed.has(c.name)) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const prevName = baseColumns[j]?.name;
      if (!prevName) continue;
      const k = cols.findIndex((x) => x.name === prevName);
      if (k >= 0) {
        at = k + 1;
        break;
      }
    }
    cols.splice(at, 0, {
      name: c.name,
      kind: c.kind,
      status: "removed",
    });
  });

  const changeMap = new Map<string, PreviewStepChange>();
  for (const ch of preview.changed) {
    changeMap.set(`${ch._rid}\0${ch.column}`, ch);
  }

  const nextByRid = new Map<number, WorkspaceRow>();
  if (nextRows) {
    for (const r of nextRows) nextByRid.set(r._rid, r);
  }

  const rows: DisplayRow[] = baseRows.map((r) => {
    if (removedRids.has(r._rid)) {
      return {
        rid: r._rid,
        vals: r,
        prev: r,
        status: "removed" as const,
        changed: {},
      };
    }
    const n = nextByRid.get(r._rid);
    const vals: Record<string, JsonValue> = n
      ? { ...r, ...n }
      : { ...r };
    // Apply changed after-values when next frame is absent.
    if (!n) {
      for (const ch of preview.changed) {
        if (ch._rid === r._rid) vals[ch.column] = ch.after;
      }
    }
    const changed: Record<string, boolean> = {};
    for (const c of cols) {
      if (c.status) continue;
      const key = `${r._rid}\0${c.name}`;
      const ch = changeMap.get(key);
      if (ch) {
        changed[c.name] = true;
      } else if (n && !same(r[c.name], n[c.name])) {
        changed[c.name] = true;
      }
    }
    return {
      rid: r._rid,
      vals,
      prev: r,
      status: "" as const,
      changed,
    };
  });

  const changedCount =
    preview.changed_total ||
    rows.reduce((n, row) => n + Object.keys(row.changed).length, 0);

  return {
    cols,
    rows,
    diff: {
      added: cols.filter((c) => c.status === "added").length,
      removed: cols.filter((c) => c.status === "removed").length,
      rowsRemoved: rows.filter((r) => r.status === "removed").length,
      changed: changedCount,
    },
  };
}

export function diffText(d: DiffCounts | null): string {
  if (!d) return "";
  const p: string[] = [];
  if (d.added) p.push(`+${d.added} col${d.added > 1 ? "s" : ""}`);
  if (d.removed) p.push(`−${d.removed} col${d.removed > 1 ? "s" : ""}`);
  if (d.rowsRemoved)
    p.push(`−${d.rowsRemoved} row${d.rowsRemoved > 1 ? "s" : ""}`);
  if (d.changed)
    p.push(`${d.changed} cell${d.changed > 1 ? "s" : ""} changed`);
  return p.length ? p.join(" · ") : "no change on this view";
}

/** Cell colouring class for the grid. */
export type CellTone =
  | "normal"
  | "missing"
  | "sentinel"
  | "outlier"
  | "changed"
  | "added"
  | "removed"
  | "selected";

export function cellTone(opts: {
  rowRemoved: boolean;
  colRemoved: boolean;
  colAdded: boolean;
  changed: boolean;
  value: JsonValue | undefined;
  kind: ColumnKind;
  isOutlier: boolean;
  rowSelected: boolean;
  colSelected: boolean;
}): CellTone {
  if (opts.rowRemoved || opts.colRemoved) return "removed";
  if (opts.colAdded) return "added";
  if (opts.changed) return "changed";
  if (opts.value === null || opts.value === undefined) return "missing";
  if (opts.kind === "number" && opts.value === -999) return "sentinel";
  if (opts.isOutlier) return "outlier";
  if (opts.rowSelected || opts.colSelected) return "selected";
  return "normal";
}
