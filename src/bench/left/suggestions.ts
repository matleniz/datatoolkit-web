import type { JsonValue, Result, ResultTable, Step } from "../../api/types";
import type { CourseStage } from "../../state/reducer";

/** Analysis keys run for the Suggestions tab (MAT-135). */
export const SUGGESTION_KEYS = [
  "preprocessing_advisor",
  "duplicates",
  "missing_values",
  "outliers",
  "inconsistencies",
  "feature_selection",
] as const;

export type SuggestionKeyId = (typeof SUGGESTION_KEYS)[number];

/** Map advisor / finding categories onto prototype course stages. */
export const CATEGORY_TO_STAGE: Record<string, Exclude<CourseStage, "all">> = {
  rows: "clean",
  leak: "select",
  drop: "select",
  select: "select",
  feature_selection: "select",
  sentinels: "clean",
  consistency: "clean",
  type: "import",
  missing: "clean",
  skew: "transform",
  scaling: "transform",
  encoding: "transform",
  duplicates: "clean",
  outliers: "clean",
  inconsistencies: "clean",
};

export const STAGE_LABEL: Record<Exclude<CourseStage, "all">, string> = {
  import: "Import & align",
  clean: "Clean",
  transform: "Encode & transform",
  select: "Select",
  custom: "Custom formula",
};

export const STAGE_COLOR: Record<Exclude<CourseStage, "all">, string> = {
  import: "#6b5ea8",
  clean: "#b4460f",
  transform: "#1d5b86",
  select: "#2f6b3a",
  custom: "#8a5a9e",
};

export interface SuggestionCard {
  id: string;
  title: string;
  detail: string;
  stage: Exclude<CourseStage, "all">;
  /** Present only when the finding came from a kind:"steps" table. */
  step: Step | null;
  column: string | null;
  sourceKey: string;
  /**
   * When true, the Suggestions UI shows a column-subset picker and opens
   * Drop duplicates with the chosen subset (duplicates key had no identity cols).
   */
  pickSubset?: boolean;
}

function asString(v: JsonValue | undefined): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

function asParams(v: JsonValue | undefined): Record<string, unknown> {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return {};
}

function stageOf(category: string | null | undefined): Exclude<CourseStage, "all"> {
  if (!category) return "clean";
  return CATEGORY_TO_STAGE[category] ?? "clean";
}

function stepFromRecord(rec: Record<string, JsonValue>): Step | null {
  const op = asString(rec.op);
  if (!op) return null;
  const targetRaw = asString(rec.target);
  const target =
    targetRaw === "train" || targetRaw === "test" || targetRaw === "both"
      ? targetRaw
      : "both";
  return { op, target, params: asParams(rec.params) };
}

/** Columns the inconsistencies key flagged for variants / date formats. */
export function inconsistencySignals(result: Result): {
  variantCols: Set<string>;
  dateCols: Set<string>;
  mappings: Map<string, Record<string, string>>;
} {
  const variantCols = new Set<string>();
  const dateCols = new Set<string>();
  const mappings = new Map<string, Record<string, string>>();
  for (const table of result.tables) {
    const title = table.title.toLowerCase();
    if (title === "variants") {
      for (const rec of table.records) {
        const col = asString(rec.column);
        if (col) variantCols.add(col);
      }
    } else if (title === "suggested mapping") {
      for (const rec of table.records) {
        const col = asString(rec.column);
        const variant = asString(rec.variant).trim();
        const canonical = asString(rec.canonical).trim();
        if (!col || !variant || variant === canonical) continue;
        const cur = mappings.get(col) ?? {};
        cur[variant] = canonical;
        mappings.set(col, cur);
      }
    } else if (
      title === "ambiguous dates" ||
      title === "mixed date formats"
    ) {
      for (const rec of table.records) {
        const col = asString(rec.column);
        if (col) dateCols.add(col);
      }
    }
  }
  return { variantCols, dateCols, mappings };
}

function isFreeTextDrop(advice: string, op: string | null): boolean {
  return op === "drop_columns" && /free text/i.test(advice);
}

/**
 * Prefer standardize_text / parse_dates over free-text drop_columns when the
 * inconsistencies key already found variants or date formats for that column.
 */
export function remapFreeTextDrop(
  step: Step,
  column: string | null,
  advice: string,
  signals: {
    variantCols: Set<string>;
    dateCols: Set<string>;
    mappings: Map<string, Record<string, string>>;
  },
): { step: Step; detail: string; title?: string } | null {
  if (!column || !isFreeTextDrop(advice, step.op)) return null;
  if (signals.dateCols.has(column)) {
    return {
      step: {
        op: "parse_dates",
        target: step.target,
        params: { columns: [column] },
      },
      detail: `${column}: inconsistencies found mixed/ambiguous date formats — parse dates instead of dropping`,
      title: `${column}: parse_dates`,
    };
  }
  if (signals.variantCols.has(column) || signals.mappings.has(column)) {
    const mapping = signals.mappings.get(column) ?? {};
    return {
      step: {
        op: "standardize_text",
        target: step.target,
        params: {
          columns: [column],
          strip: true,
          lower: true,
          ...(Object.keys(mapping).length ? { mapping } : {}),
        },
      },
      detail: `${column}: inconsistencies found spelling variants — standardize text instead of dropping`,
      title: `${column}: standardize_text`,
    };
  }
  return null;
}

function cardsFromStepsTable(
  keyId: string,
  table: ResultTable,
  signals: {
    variantCols: Set<string>;
    dateCols: Set<string>;
    mappings: Map<string, Record<string, string>>;
  },
): SuggestionCard[] {
  return table.records.map((rec, i) => {
    let step = stepFromRecord(rec);
    const column = asString(rec.column) || null;
    let advice = asString(rec.advice) || asString(rec.detail) || asString(rec.why);
    const category = asString(rec.category) || (keyId === "feature_selection" ? "select" : keyId);
    let title =
      asString(rec.title) ||
      (column && column !== "(rows)"
        ? `${column}: ${asString(rec.op) || "step"}`
        : advice.slice(0, 80) || `${keyId} · ${table.title}`);

    if (step) {
      const remapped = remapFreeTextDrop(step, column === "(rows)" ? null : column, advice, signals);
      if (remapped) {
        step = remapped.step;
        advice = remapped.detail;
        if (remapped.title) title = remapped.title;
      }
    }

    return {
      id: `${keyId}:${table.title}:${i}`,
      title,
      detail: advice || `${step?.op ?? "finding"} from ${keyId}`,
      stage: stageOf(category),
      step,
      column: column === "(rows)" ? null : column,
      sourceKey: keyId,
    };
  });
}

/** Non-steps findings: one card per notable metric / text line (no apply). */
function cardsFromFinding(
  keyId: string,
  result: Result,
): SuggestionCard[] {
  const cards: SuggestionCard[] = [];
  const stage = stageOf(keyId);
  if (result.text?.trim()) {
    const detail = result.text.trim();
    const needsSubset =
      keyId === "duplicates" &&
      /no identity columns|pass `subset`|pass subset/i.test(detail);
    cards.push({
      id: `${keyId}:text`,
      title: keyId.replace(/_/g, " "),
      detail,
      stage,
      step: needsSubset
        ? {
            op: "drop_duplicates",
            target: "train",
            params: { keep: "none", subset: null, sort_by: null },
          }
        : null,
      column: null,
      sourceKey: keyId,
      pickSubset: needsSubset || undefined,
    });
  }
  for (const [k, v] of Object.entries(result.metrics)) {
    if (typeof v === "number" && v > 0 && /n_|pct_|count/.test(k)) {
      cards.push({
        id: `${keyId}:metric:${k}`,
        title: `${keyId.replace(/_/g, " ")} · ${k}`,
        detail: String(v),
        stage,
        step: null,
        column: null,
        sourceKey: keyId,
      });
    }
  }
  return cards;
}

/**
 * Map engine Result payloads from the suggestion keys into UI cards.
 * Tables with `kind: "steps"` become cards whose only action is open-in-editor.
 */
export function mapSuggestionCards(
  results: { keyId: string; result: Result }[],
): SuggestionCard[] {
  const signals = {
    variantCols: new Set<string>(),
    dateCols: new Set<string>(),
    mappings: new Map<string, Record<string, string>>(),
  };
  for (const { keyId, result } of results) {
    if (keyId !== "inconsistencies") continue;
    const s = inconsistencySignals(result);
    for (const c of s.variantCols) signals.variantCols.add(c);
    for (const c of s.dateCols) signals.dateCols.add(c);
    for (const [col, map] of s.mappings) signals.mappings.set(col, map);
  }

  const out: SuggestionCard[] = [];
  for (const { keyId, result } of results) {
    const stepTables = result.tables.filter((t) => t.kind === "steps");
    if (stepTables.length) {
      for (const table of stepTables) {
        out.push(...cardsFromStepsTable(keyId, table, signals));
      }
    } else {
      out.push(...cardsFromFinding(keyId, result));
    }
  }
  return out;
}

export function filterCardsByStage(
  cards: SuggestionCard[],
  stage: CourseStage,
): SuggestionCard[] {
  if (stage === "all") return cards;
  return cards.filter((c) => c.stage === stage);
}
