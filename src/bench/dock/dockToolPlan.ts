import type { ColumnProfile, Role } from "../../api/types";
import type { ToolId } from "../../state/reducer";
import {
  engineColumnsParam,
  isNumericKind,
  outliersBoundLabel,
  selectedNumericColumns,
} from "./columnScope";

/** Everything a tool's guard / column selection / bound label reads. */
export interface PlanCtx {
  id: ToolId;
  /** Engine key of the tool (`toolDef(id).key`). */
  key: string;
  role: Role;
  selCols: string[];
  scopeAll: boolean;
  target: string | null;
  focus: string | null;
  splitBy: string | null;
  profiles: ColumnProfile[];
}

/** What the engine run actually received, for the post-run bound label. */
interface Ran {
  hasCols: boolean;
  /** The `columns` param sent (undefined when none was). */
  sent: string[] | undefined;
}

interface ToolPlan {
  /** Runs a key through run_key (false: rendered from the frame alone). */
  engine: boolean;
  /** Message replacing the result when the tool cannot run, else null. */
  guard?: (c: PlanCtx) => string | null;
  /** Columns for the key's `columns` param; null / empty = engine default. */
  columns?: (c: PlanCtx) => string[] | null;
  bound: (c: PlanCtx, ran: Ran) => string;
}

const MAX_CORR_COLUMNS = 7;

function corrScope(c: PlanCtx) {
  const nums = c.profiles
    .filter((p) => isNumericKind(p.kind) && p.name !== c.target)
    .map((p) => p.name);
  const selNum = c.selCols.filter((n) =>
    c.profiles.some(
      (p) => p.name === n && isNumericKind(p.kind) && n !== c.target,
    ),
  );
  return { nums, selNum, useSelection: !c.scopeAll && selNum.length >= 2 };
}

/** Columns the Correlation matrix runs on (also what widens-on-click tests). */
export function corrSelectedCount(c: PlanCtx): number {
  return corrScope(c).selNum.length;
}

function corrColumns(c: PlanCtx): string[] {
  const s = corrScope(c);
  return (s.useSelection ? s.selNum : s.nums).slice(0, MAX_CORR_COLUMNS);
}

function selectionBound(cols: string[] | null, key: string, all: string) {
  if (!cols) return all;
  return cols.length === 1
    ? `bound to ${cols[0]} · key ${key}`
    : `bound to selection · ${cols.length} columns · key ${key}`;
}

function outliersSelected(c: PlanCtx): string[] {
  return c.scopeAll ? [] : selectedNumericColumns(c.selCols, c.profiles);
}

const needsLabeledTrain = (c: PlanCtx): string | null => {
  if (!c.target) {
    return "No target yet: set it on the Sources screen, or right-click a column → Set as target.";
  }
  return c.role === "test"
    ? "The test set has no label. Switch to Train."
    : null;
};

const selectionColumns = (c: PlanCtx) =>
  engineColumnsParam(c.selCols, c.scopeAll);

const TOOL_PLANS: Partial<Record<ToolId, ToolPlan>> = {
  compare: {
    engine: false,
    guard: (c) =>
      c.selCols.filter((n) => c.profiles.some((p) => p.name === n)).length < 2
        ? "Select two or more columns (shift-click headers, or right-click → Add to selection)."
        : null,
    bound: (c) =>
      `${c.selCols.filter((n) => c.profiles.some((p) => p.name === n)).length} columns · ${c.role}`,
  },
  corr: {
    engine: true,
    guard: (c) =>
      corrColumns(c).length < 2 ? "Need at least two numeric columns." : null,
    columns: corrColumns,
    bound: (_c, ran) => `key correlations · ${ran.sent?.length ?? 0} columns`,
  },
  dist: {
    engine: true,
    guard: (c) =>
      !c.focus || !c.profiles.some((p) => p.name === c.focus)
        ? "Select a column to see its distribution."
        : null,
    columns: (c) => (c.focus ? [c.focus] : null),
    bound: (c) =>
      c.splitBy
        ? `bound to ${c.focus} · split by ${c.splitBy} · key column_distribution`
        : `bound to ${c.focus} · key column_distribution`,
  },
  missing: {
    engine: true,
    columns: selectionColumns,
    bound: (c) =>
      selectionBound(
        selectionColumns(c),
        "missing_values",
        "all columns · key missing_values",
      ),
  },
  outliers: {
    engine: true,
    guard: (c) =>
      !c.scopeAll && outliersSelected(c).length === 0
        ? "Select a numeric column. Fences: Q1 − 1.5·IQR and Q3 + 1.5·IQR, sentinels excluded."
        : null,
    columns: (c) => (c.scopeAll ? null : outliersSelected(c)),
    bound: (c) => {
      const sel = outliersSelected(c);
      if (c.scopeAll) return "all numeric columns · key outliers";
      return sel.length === 1
        ? `${outliersBoundLabel(
            sel[0]!,
            c.profiles.find((p) => p.name === sel[0]),
          )} · key outliers`
        : `bound to selection · ${sel.length} columns · key outliers`;
    },
  },
  target: {
    engine: true,
    guard: needsLabeledTrain,
    columns: selectionColumns,
    bound: (c, ran) =>
      ran.hasCols
        ? selectionBound(
            selectionColumns(c),
            c.key,
            `all features · key ${c.key}`,
          )
        : `key ${c.key}`,
  },
  feature_selection: {
    engine: true,
    guard: needsLabeledTrain,
    columns: (c) =>
      selectionColumns(c)?.filter((n) => {
        const p = c.profiles.find((pc) => pc.name === n);
        return p && isNumericKind(p.kind) && n !== c.target;
      }) ?? null,
    bound: (c, ran) =>
      ran.hasCols
        ? selectionBound(
            selectionColumns(c),
            c.key,
            `all features · key ${c.key}`,
          )
        : `key ${c.key}`,
  },
  drift: {
    engine: true,
    columns: selectionColumns,
    bound: (c) => `key ${c.key}`,
  },
};

/** Plan of a tool; tools outside the table render the frame only. */
export function toolPlan(id: ToolId): ToolPlan {
  return TOOL_PLANS[id] ?? { engine: false, bound: () => "" };
}

/**
 * Per-tool `data-*` attributes of the window body (e2e / debug hooks).
 * `full` adds the ones only a rendered result carries.
 */
export function toolDataAttrs(
  c: PlanCtx,
  extra: { full: boolean; params: Record<string, unknown>; corrCols: string[] },
): Record<string, string | undefined> {
  const { id, scopeAll, focus, splitBy } = c;
  const { full, params, corrCols } = extra;
  const attrs: Record<string, string | undefined> = {};
  if (id === "outliers") {
    const sel = scopeAll ? [] : selectedNumericColumns(c.selCols, c.profiles);
    if (sel.length === 1) {
      attrs["data-outliers-col"] = sel[0];
      attrs["data-outliers-cols"] = sel[0];
    } else if (full && sel.length > 1) {
      attrs["data-outliers-cols"] = sel.join(",");
    }
    if (full && params.contamination !== undefined) {
      attrs["data-outliers-contamination"] = String(params.contamination);
    }
  }
  if (id === "dist") {
    attrs["data-dist-col"] = focus ?? undefined;
    attrs["data-dist-by"] = splitBy ?? "";
    if (full && params.bins !== undefined) {
      attrs["data-dist-bins"] = String(params.bins);
    }
  }
  if (full && id === "missing") {
    const cols = !scopeAll && c.selCols.length > 0 ? c.selCols : null;
    attrs["data-missing-cols"] = (cols ?? c.profiles.map((p) => p.name)).join(
      ",",
    );
  }
  if (full && id === "corr") {
    attrs["data-corr-size"] = String(
      corrCols.length ||
        ((params.columns as string[] | undefined)?.length ?? 0),
    );
  }
  return attrs;
}

/** Columns / split a window's last run actually used, for "Open in Chart". */
export function chartColumnsOf(
  id: ToolId,
  runParams: string | null,
  scopeAll: boolean,
  selCols: string[],
): { names: string[]; by: string | null } {
  let params: Record<string, unknown> = {};
  try {
    params = runParams
      ? (JSON.parse(runParams) as Record<string, unknown>)
      : {};
  } catch {
    /* no run params: fall back to the selection */
  }
  let names = Array.isArray(params.columns)
    ? params.columns.filter((c): c is string => typeof c === "string")
    : scopeAll
      ? []
      : [...selCols];
  if (id === "target" && typeof params.target === "string") {
    const feature = names.find((n) => n !== params.target);
    names = feature ? [feature, params.target] : [params.target];
  }
  return { names, by: typeof params.by === "string" ? params.by : null };
}
