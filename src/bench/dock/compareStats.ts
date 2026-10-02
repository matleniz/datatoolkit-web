import { useMemo } from "react";

import { apiClient } from "../../api/client";
import type { Result } from "../../api/types";
import { useKeyedAsync } from "../../hooks";
import { isNumericKind } from "./columnScope";

/** Full-frame numeric stats per column, straight from the engine (#75). */
export type CompareStats = Record<string, Record<string, number | null>>;

export interface CompareStatsData {
  /** column → stat name → value (null = undefined, e.g. no present value). */
  stats: CompareStats;
  /** column → Pearson r with the target (null = undefined); absent = not asked. */
  corr: Record<string, number | null>;
}

const SUMMARY_TABLE = "numeric_summary";
const MATRIX_TABLE = "matrix";

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** `numeric_summary` of column_distribution → stats per column. */
export function summaryStats(result: Result): CompareStats {
  const out: CompareStats = {};
  const table = result.tables.find((t) => t.title === SUMMARY_TABLE);
  for (const rec of table?.records ?? []) {
    const col = rec.column;
    if (typeof col !== "string") continue;
    const stats: Record<string, number | null> = {};
    for (const [k, v] of Object.entries(rec)) {
      if (k !== "column") stats[k] = num(v);
    }
    out[col] = stats;
  }
  return out;
}

/** The target's row of the correlations `matrix` → signed r per column. */
export function targetCorrelations(
  result: Result,
  target: string,
): Record<string, number | null> {
  const table = result.tables.find((t) => t.title === MATRIX_TABLE);
  const row = table?.records.find((r) => r.column === target);
  const out: Record<string, number | null> = {};
  if (!row) return out;
  for (const [k, v] of Object.entries(row)) {
    if (k !== "column" && k !== target) out[k] = num(v);
  }
  out[target] = 1;
  return out;
}

export interface CompareStatsPlan {
  /** Numeric picked columns (summary key `columns`). */
  numeric: string[];
  /** Columns of the correlations run (numeric picks + target), else null. */
  corrColumns: string[] | null;
}

/** What to ask the engine for the picked columns. */
export function compareStatsPlan(
  cols: string[],
  kinds: Map<string, string>,
  target: string | null,
): CompareStatsPlan {
  const numeric = cols.filter((c) => isNumericKind(kinds.get(c) ?? ""));
  const targetKind = target ? kinds.get(target) : undefined;
  const others = numeric.filter((c) => c !== target);
  const corrColumns =
    target && targetKind && isNumericKind(targetKind) && others.length > 0
      ? [...others, target]
      : null;
  return { numeric, corrColumns };
}

/**
 * Engine run of the compare statistics on the whole frame: the source is the
 * grid's dataset identity, so grid and block describe the same rows.
 * `key` null = idle.
 */
export function useCompareStats(
  key: string | null,
  source: unknown,
  plan: CompareStatsPlan,
  target: string | null,
) {
  const planKey = useMemo(() => JSON.stringify(plan), [plan]);
  const full = key === null || plan.numeric.length === 0 ? null : `${key}|${planKey}|${target}`;
  return useKeyedAsync<CompareStatsData>(full, async () => {
    const [summary, corr] = await Promise.all([
      apiClient.runKey("column_distribution", {
        source,
        columns: plan.numeric,
      }),
      plan.corrColumns
        ? apiClient.runKey("correlations", {
            source,
            columns: plan.corrColumns,
          })
        : Promise.resolve(null),
    ]);
    return {
      stats: summaryStats(summary),
      corr: corr && target ? targetCorrelations(corr, target) : {},
    };
  });
}
