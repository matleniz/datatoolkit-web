import type {
  AlignReportRow,
  AlignStatus,
  Step,
} from "../../api/types";

export type FixActionType = "set_decimal" | "add_step";

export interface AlignFixAction {
  id: string;
  label: string;
  type: FixActionType;
  decimal?: string;
  step?: Step;
  primary?: boolean;
  disabled?: boolean;
  tip?: string;
}

export interface RowFixes {
  note: string;
  actions: AlignFixAction[];
}

/**
 * Format step subtitle / parameter summary in the style of the prototype.
 */
export function formatStepSummary(step: Step): string {
  const op = step.op;
  const p = step.params as Record<string, unknown>;

  if (op === "rename" && p.mapping && typeof p.mapping === "object") {
    const entries = Object.entries(p.mapping as Record<string, string>);
    const first = entries[0];
    if (first) {
      return `${first[0]} → ${first[1]}`;
    }
  }

  if (op === "drop_columns" && Array.isArray(p.columns)) {
    return (p.columns as string[]).join(", ");
  }

  if (op === "cast" && p.dtypes && typeof p.dtypes === "object") {
    const entries = Object.entries(p.dtypes as Record<string, string>);
    const first = entries[0];
    if (first) {
      return `${first[0]} → ${first[1]}`;
    }
  }

  if (op === "standardize_text") {
    const cols = Array.isArray(p.columns) ? (p.columns as string[]).join(", ") : "";
    const mapping =
      p.mapping && typeof p.mapping === "object"
        ? (p.mapping as Record<string, string>)
        : null;
    if (mapping && Object.keys(mapping).length > 0) {
      const pairs = Object.entries(mapping)
        .slice(0, 3)
        .map(([from, to]) => `${from} → ${to}`)
        .join(", ");
      const extra = Object.keys(mapping).length > 3 ? "…" : "";
      return cols ? `${cols} · map ${pairs}${extra}` : `map ${pairs}${extra}`;
    }
    const bits = [p.strip ? "strip" : "", p.lower ? "lower" : ""].filter(
      Boolean,
    );
    return `${cols} · ${bits.join(" + ") || "no change"}`;
  }

  return JSON.stringify(p);
}

/**
 * Format a full alignment step line for the aside list.
 */
export function formatAlignmentStep(step: Step): string {
  const summary = formatStepSummary(step);
  return `${step.op} · ${summary} · ${step.target}`;
}

export function formatSample(samples: unknown[]): string {
  if (!samples || samples.length === 0) return "";
  return samples
    .slice(0, 3)
    .map((v) => {
      if (v === null || v === undefined) return "∅";
      if (typeof v === "string") return `"${v}"`;
      if (typeof v === "number") {
        return Number.isInteger(v) ? String(v) : (Math.round(v * 1000) / 1000).toString();
      }
      return String(v);
    })
    .join(", ");
}

export function formatMean(val: number | null): string {
  if (val === null || val === undefined || isNaN(val)) return "—";
  return (Math.round(val * 1000) / 1000).toString();
}

/**
 * Compute the difflib-style similarity ratio between two strings.
 * Formula: 2 * M / (len(s1) + len(s2)) where M is the number of matching
 * characters in matching blocks (Ratcliff/Obershelp / SequenceMatcher).
 */
export function stringSimilarityRatio(a: string, b: string): number {
  const s1 = a.toLowerCase();
  const s2 = b.toLowerCase();
  if (s1 === s2) return 1;
  const len1 = s1.length;
  const len2 = s2.length;
  if (len1 + len2 === 0) return 1;

  function countMatches(
    aStart: number,
    aEnd: number,
    bStart: number,
    bEnd: number,
  ): number {
    if (aStart >= aEnd || bStart >= bEnd) return 0;

    let bestLen = 0;
    let bestA = aStart;
    let bestB = bStart;

    for (let i = aStart; i < aEnd; i++) {
      for (let j = bStart; j < bEnd; j++) {
        let k = 0;
        while (
          i + k < aEnd &&
          j + k < bEnd &&
          s1[i + k] === s2[j + k]
        ) {
          k++;
        }
        if (k > bestLen) {
          bestLen = k;
          bestA = i;
          bestB = j;
        }
      }
    }

    if (bestLen === 0) return 0;

    return (
      bestLen +
      countMatches(aStart, bestA, bStart, bestB) +
      countMatches(bestA + bestLen, aEnd, bestB + bestLen, bEnd)
    );
  }

  const matches = countMatches(0, len1, 0, len2);
  return (2 * matches) / (len1 + len2);
}

/**
 * Check if candidate column name is similar to train column name.
 * Only similar when its name contains the train name or vice versa,
 * or difflib-style ratio >= 0.6.
 */
export function isSimilarCandidate(
  trainName: string,
  candidateName: string,
): boolean {
  if (!trainName || !candidateName) return false;
  const t = trainName.toLowerCase();
  const c = candidateName.toLowerCase();
  if (t === c) return true;
  if (t.includes(c) || c.includes(t)) return true;
  return stringSimilarityRatio(t, c) >= 0.6;
}

/**
 * Compute the note and fix actions for an alignment report row.
 */
export function computeRowFixes(
  row: AlignReportRow,
  testOnlyCols: string[],
  castError?: string | null,
): RowFixes {
  const actions: AlignFixAction[] = [];
  let note = "";

  if (row.status === "type_mismatch") {
    if (row.numbers_as_text) {
      note = "Test stores numbers as text with a comma decimal.";
      actions.push({
        id: "re_read_decimal",
        label: 'Re-read test with decimal ","',
        type: "set_decimal",
        decimal: ",",
        primary: true,
        tip: 'Source option: csv decimal=","',
      });

      const colName = row.train?.name ?? row.test?.name ?? "";
      actions.push({
        id: "cast_test_float",
        label: "Cast test to float",
        type: "add_step",
        disabled: Boolean(castError),
        tip: castError || "",
        step: {
          op: "cast",
          target: "test",
          params: { dtypes: { [colName]: "float" } },
          align: true,
        },
      });
    } else {
      const trainKind = row.train?.kind ?? "unknown";
      const testKind = row.test?.kind ?? "unknown";
      note = `Types differ: ${trainKind} vs ${testKind}.`;

      const colName = row.train?.name ?? row.test?.name ?? "";
      const targetType =
        trainKind === "text" || trainKind === "cat" ? "str" : "float";
      actions.push({
        id: "cast_test_train_type",
        label: "Cast test to train type",
        type: "add_step",
        step: {
          op: "cast",
          target: "test",
          params: { dtypes: { [colName]: targetType } },
          align: true,
        },
      });
    }
  } else if (row.status === "missing_in_test") {
    const colName = row.train?.name ?? "";
    if (testOnlyCols.length > 0) {
      note =
        "Match it with a test-only column (renames it in test), or drop it from train.";
    } else {
      note = "No test column left to match: drop it from train.";
    }
    // Sort similar candidate names first
    const sortedTestCols = [...testOnlyCols].sort((a, b) => {
      const aSim = isSimilarCandidate(colName, a);
      const bSim = isSimilarCandidate(colName, b);
      if (aSim && !bSim) return -1;
      if (!aSim && bSim) return 1;
      return a.localeCompare(b);
    });

    for (const t of sortedTestCols) {
      const isSimilar = isSimilarCandidate(colName, t);
      actions.push({
        id: `rename_${t}_to_${colName}`,
        label: `↔ ${t}${isSimilar ? " (similar name)" : ""}`,
        type: "add_step",
        tip: `rename ${t} → ${colName} in test`,
        step: {
          op: "rename",
          target: "test",
          params: { mapping: { [t]: colName } },
          align: true,
        },
      });
    }

    actions.push({
      id: `drop_train_${colName}`,
      label: "Drop from train",
      type: "add_step",
      step: {
        op: "drop_columns",
        target: "train",
        params: { columns: [colName] },
        align: true,
      },
    });
  } else if (row.status === "extra_in_test") {
    const colName = row.test?.name ?? "";
    note = "Only in test: a model fitted on train cannot use it.";
    actions.push({
      id: `drop_test_${colName}`,
      label: "Drop from test",
      type: "add_step",
      step: {
        op: "drop_columns",
        target: "test",
        params: { columns: [colName] },
        align: true,
      },
    });
  } else if (row.status === "value_mismatch") {
    const colName = row.train?.name ?? row.test?.name ?? "";
    // Details (only_in_test, pct, hint) are rendered by AlignScreen; keep note empty.
    note = "";

    const nearMatches = row.near_matches ?? [];
    if (nearMatches.length > 0) {
      const mapping: Record<string, string> = {};
      for (const pair of nearMatches) {
        mapping[pair.test] = pair.train;
      }
      actions.push({
        id: `map_test_${colName}`,
        label: "Map on test",
        type: "add_step",
        primary: true,
        tip: "standardize_text mapping: test value → train value",
        step: {
          op: "standardize_text",
          target: "test",
          params: {
            columns: [colName],
            strip: false,
            lower: false,
            mapping,
          },
          align: true,
        },
      });
    }

    actions.push({
      id: `standardize_text_test_${colName}`,
      label: "Standardize text on test",
      type: "add_step",
      tip: "strip whitespace on test",
      step: {
        op: "standardize_text",
        target: "test",
        params: {
          columns: [colName],
          strip: true,
          lower: false,
        },
        align: true,
      },
    });
  } else if (row.status === "label") {
    note = "Expected: test has no label.";
  } else if (row.status !== "match") {
    // Unknown / future statuses: never break the screen; show a generic note.
    note = `Status “${row.status}”: no guided fix yet.`;
  }

  return { note, actions };
}

/**
 * Severity for engine `value_mismatch` (MAT-179 / MAT-178).
 *
 * Prefer the engine's `blocking` flag when present. Otherwise: blocking when
 * there is fixable spelling drift (`near_matches`) or a large share of test
 * rows carry unseen values. Pure new categories with empty near_matches and
 * low `pct_test_rows_unseen` stay visible but do not count as "to decide"
 * (one-hot `handle_unknown` absorbs them).
 */
export const VALUE_MISMATCH_BLOCKING_PCT = 50;

export function isBlockingValueMismatch(row: AlignReportRow): boolean {
  if (row.status !== "value_mismatch") return false;
  if (typeof row.blocking === "boolean") return row.blocking;
  const near = row.near_matches ?? [];
  if (near.length > 0) return true;
  const pct = row.pct_test_rows_unseen;
  if (pct === null || pct === undefined) return true;
  return pct > VALUE_MISMATCH_BLOCKING_PCT;
}

/** True when the row should count toward "to decide" / needs-fix styling. */
export function alignRowNeedsDecision(row: AlignReportRow): boolean {
  if (row.status === "match" || row.status === "label") return false;
  if (row.status === "value_mismatch") return isBlockingValueMismatch(row);
  return true;
}

/**
 * Counts of columns by status category.
 */
export function countAlignStatuses(rows: AlignReportRow[]): {
  ok: number;
  fix: number;
  info: number;
} {
  let ok = 0;
  let fix = 0;
  let info = 0;

  for (const r of rows) {
    if (r.status === "match") {
      ok++;
    } else if (r.status === "label") {
      info++;
    } else if (r.status === "value_mismatch" && !isBlockingValueMismatch(r)) {
      // Informational unseen categories: still shown in the table, not "to decide".
      info++;
    } else {
      // type_mismatch, blocking value_mismatch, missing/extra, unknown status
      fix++;
    }
  }

  return { ok, fix, info };
}

export function getStatusBadgeInfo(status: AlignStatus): {
  text: string;
  color: string;
  bg: string;
} {
  switch (status) {
    case "match":
      return { text: "match", color: "#1f5a2b", bg: "#e2f0e3" };
    case "type_mismatch":
      return { text: "type mismatch", color: "#8f3809", bg: "#fbe9dc" };
    case "value_mismatch":
      return { text: "value mismatch", color: "#8f3809", bg: "#fbe9dc" };
    case "missing_in_test":
      return { text: "missing in test", color: "#8f3809", bg: "#fbe9dc" };
    case "extra_in_test":
      return { text: "extra in test", color: "#8f3809", bg: "#fbe9dc" };
    case "label":
      return { text: "label · train only", color: "#4f4390", bg: "#ece8f7" };
    default:
      // Unknown engine statuses: render generically, never throw.
      return { text: String(status), color: "#5b5850", bg: "#eeede8" };
  }
}
