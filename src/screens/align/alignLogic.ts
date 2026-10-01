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

/** "a → b" for the first entry of a mapping-like param, or null if absent / empty. */
function firstPairSummary(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const first = Object.entries(value as Record<string, string>)[0];
  return first ? `${first[0]} → ${first[1]}` : null;
}

function standardizeTextSummary(p: Record<string, unknown>): string {
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
  const bits = [p.strip ? "strip" : "", p.lower ? "lower" : ""].filter(Boolean);
  return `${cols} · ${bits.join(" + ") || "no change"}`;
}

/**
 * Format step subtitle / parameter summary in the style of the prototype.
 */
export function formatStepSummary(step: Step): string {
  const p = step.params as Record<string, unknown>;
  switch (step.op) {
    case "rename":
      return firstPairSummary(p.mapping) ?? JSON.stringify(p);
    case "cast":
      return firstPairSummary(p.dtypes) ?? JSON.stringify(p);
    case "drop_columns":
      return Array.isArray(p.columns)
        ? (p.columns as string[]).join(", ")
        : JSON.stringify(p);
    case "standardize_text":
      return standardizeTextSummary(p);
    default:
      return JSON.stringify(p);
  }
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

const alignStep = (
  op: string,
  target: Step["target"],
  params: Record<string, unknown>,
): Step => ({ op, target, params, align: true });

const castTestAction = (
  id: string,
  label: string,
  colName: string,
  dtype: string,
  extra: Partial<AlignFixAction> = {},
): AlignFixAction => ({
  id,
  label,
  type: "add_step",
  ...extra,
  step: alignStep("cast", "test", { dtypes: { [colName]: dtype } }),
});

const dropAction = (
  target: "train" | "test",
  colName: string,
): AlignFixAction => ({
  id: `drop_${target}_${colName}`,
  label: `Drop from ${target}`,
  type: "add_step",
  step: alignStep("drop_columns", target, { columns: [colName] }),
});

function typeMismatchFixes(row: AlignReportRow, castError?: string | null): RowFixes {
  const colName = row.train?.name ?? row.test?.name ?? "";
  if (row.numbers_as_text) {
    return {
      note: "Test stores numbers as text with a comma decimal.",
      actions: [
        {
          id: "re_read_decimal",
          label: 'Re-read test with decimal ","',
          type: "set_decimal",
          decimal: ",",
          primary: true,
          tip: 'Source option: csv decimal=","',
        },
        castTestAction("cast_test_float", "Cast test to float", colName, "float", {
          disabled: Boolean(castError),
          tip: castError || "",
        }),
      ],
    };
  }
  const trainKind = row.train?.kind ?? "unknown";
  const testKind = row.test?.kind ?? "unknown";
  const targetType = trainKind === "text" || trainKind === "cat" ? "str" : "float";
  return {
    note: `Types differ: ${trainKind} vs ${testKind}.`,
    actions: [
      castTestAction(
        "cast_test_train_type",
        "Cast test to train type",
        colName,
        targetType,
      ),
    ],
  };
}

function missingInTestFixes(row: AlignReportRow, testOnlyCols: string[]): RowFixes {
  const colName = row.train?.name ?? "";
  const note =
    testOnlyCols.length > 0
      ? "Match it with a test-only column (renames it in test), or drop it from train."
      : "No test column left to match: drop it from train.";
  // Similar candidate names first
  const similar = new Map(
    testOnlyCols.map((t) => [t, isSimilarCandidate(colName, t)] as const),
  );
  const sorted = [...testOnlyCols].sort((a, b) => {
    if (similar.get(a) !== similar.get(b)) return similar.get(a) ? -1 : 1;
    return a.localeCompare(b);
  });
  const actions: AlignFixAction[] = sorted.map((t) => ({
    id: `rename_${t}_to_${colName}`,
    label: `↔ ${t}${similar.get(t) ? " (similar name)" : ""}`,
    type: "add_step",
    tip: `rename ${t} → ${colName} in test`,
    step: alignStep("rename", "test", { mapping: { [t]: colName } }),
  }));
  actions.push(dropAction("train", colName));
  return { note, actions };
}

function valueMismatchFixes(row: AlignReportRow): RowFixes {
  const colName = row.train?.name ?? row.test?.name ?? "";
  const actions: AlignFixAction[] = [];
  const nearMatches = row.near_matches ?? [];
  if (nearMatches.length > 0) {
    const mapping: Record<string, string> = {};
    for (const pair of nearMatches) mapping[pair.test] = pair.train;
    actions.push({
      id: `map_test_${colName}`,
      label: "Map on test",
      type: "add_step",
      primary: true,
      tip: "standardize_text mapping: test value → train value",
      step: alignStep("standardize_text", "test", {
        columns: [colName],
        strip: false,
        lower: false,
        mapping,
      }),
    });
  }
  actions.push({
    id: `standardize_text_test_${colName}`,
    label: "Standardize text on test",
    type: "add_step",
    tip: "strip whitespace on test",
    step: alignStep("standardize_text", "test", {
      columns: [colName],
      strip: true,
      lower: false,
    }),
  });
  // Details (only_in_test, pct, hint) are rendered by AlignScreen; keep note empty.
  return { note: "", actions };
}

/**
 * Compute the note and fix actions for an alignment report row.
 */
export function computeRowFixes(
  row: AlignReportRow,
  testOnlyCols: string[],
  castError?: string | null,
): RowFixes {
  switch (row.status) {
    case "type_mismatch":
      return typeMismatchFixes(row, castError);
    case "missing_in_test":
      return missingInTestFixes(row, testOnlyCols);
    case "extra_in_test":
      return {
        note: "Only in test: a model fitted on train cannot use it.",
        actions: [dropAction("test", row.test?.name ?? "")],
      };
    case "value_mismatch":
      return valueMismatchFixes(row);
    case "label":
      return { note: "Expected: test has no label.", actions: [] };
    case "match":
      return { note: "", actions: [] };
    default:
      // Unknown / future statuses: never break the screen; show a generic note.
      return { note: `Status “${row.status}”: no guided fix yet.`, actions: [] };
  }
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
const VALUE_MISMATCH_BLOCKING_PCT = 50;

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
