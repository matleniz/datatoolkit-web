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
const CATEGORY_TO_STAGE: Record<string, Exclude<CourseStage, "all">> = {
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

function cardsFromStepsTable(
  keyId: string,
  table: ResultTable,
): SuggestionCard[] {
  return table.records.map((rec, i) => {
    const step = stepFromRecord(rec);
    const column = asString(rec.column) || null;
    const advice = asString(rec.advice) || asString(rec.detail) || asString(rec.why);
    const category = asString(rec.category) || (keyId === "feature_selection" ? "select" : keyId);
    const title =
      asString(rec.title) ||
      (column && column !== "(rows)"
        ? `${column}: ${asString(rec.op) || "step"}`
        : advice.slice(0, 80) || `${keyId} · ${table.title}`);

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
 * Ops (including standardize_text / parse_dates from the advisor) are rendered
 * as-is — analysis logic lives in the engine (MAT-165 / datatoolkit#40).
 */
export function mapSuggestionCards(
  results: { keyId: string; result: Result }[],
): SuggestionCard[] {
  const out: SuggestionCard[] = [];
  for (const { keyId, result } of results) {
    const stepTables = result.tables.filter((t) => t.kind === "steps");
    if (stepTables.length) {
      for (const table of stepTables) {
        out.push(...cardsFromStepsTable(keyId, table));
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

/** JSON with object keys sorted, so equal values serialize identically. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    const body = Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(",");
    return `{${body}}`;
  }
  return JSON.stringify(value ?? null);
}

/** cyrb53: small, well-spread 53-bit string hash (not cryptographic). */
function hash53(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * Stable id used to dismiss a suggestion (datatoolkit-issues#15): derived from
 * the key, the suggested step (op / target / params) and the finding itself
 * (column, title, detail) — never from the card's position or the analysed
 * version. The same finding keeps its id after an unrelated step; a finding
 * whose content changes is a new instance and shows again. Generic: no
 * knowledge of any particular key.
 */
export function suggestionDismissId(card: SuggestionCard): string {
  return hash53(
    canonicalJson({
      key: card.sourceKey,
      step: card.step,
      finding: { column: card.column, title: card.title, detail: card.detail },
    }),
  );
}

export interface ListedSuggestion {
  card: SuggestionCard;
  dismissId: string;
  dismissed: boolean;
}

/**
 * Cards to list for a stage: dismissed ones only when `showDismissed`.
 * `active` counts the stage's non-dismissed cards, `dismissed` the others.
 */
export function listSuggestions(
  cards: SuggestionCard[],
  stage: CourseStage,
  dismissedIds: ReadonlySet<string>,
  showDismissed: boolean,
): { shown: ListedSuggestion[]; active: number; dismissed: number } {
  const listed = filterCardsByStage(cards, stage).map((card) => {
    const dismissId = suggestionDismissId(card);
    return { card, dismissId, dismissed: dismissedIds.has(dismissId) };
  });
  const dismissed = listed.filter((s) => s.dismissed).length;
  return {
    shown: showDismissed ? listed : listed.filter((s) => !s.dismissed),
    active: listed.length - dismissed,
    dismissed,
  };
}
