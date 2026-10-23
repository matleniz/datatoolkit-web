import type { ColumnKind } from "../../api/types";

/** `expected_schema.columns` item (engine `ColumnRule`); absent keys keep the engine default. */
export interface ColumnRule {
  name: string;
  required?: boolean;
  dtype?: RuleDtype;
  nullable?: boolean;
  max_missing_pct?: number;
  min?: number | string;
  max?: number | string;
  allowed?: (boolean | number | string)[];
  unique?: boolean;
}

export const RULE_DTYPES = ["numeric", "string", "bool", "datetime", "category"] as const;
export type RuleDtype = (typeof RULE_DTYPES)[number];

/** Engine cap on `expected_schema.columns` (schema `maxItems`). */
export const MAX_COLUMN_RULES = 500;

/** The rule dtype matching a profiled column kind (undefined when unsure). */
export function dtypeOfKind(kind: ColumnKind | undefined): RuleDtype | undefined {
  switch (kind) {
    case "number":
    case "num":
      return "numeric";
    case "bool":
      return "bool";
    case "date":
      return "datetime";
    case "text":
      return "string";
    case "cat":
      return "category";
    default:
      return undefined;
  }
}

/** A numeric text → number; any other text stays text (dates, bounds typed too early). */
export function parseBound(text: string, dtype: RuleDtype | undefined): number | string | undefined {
  const t = text.trim();
  if (t === "") return undefined;
  const n = Number(t);
  if (dtype !== "datetime" && dtype !== "string" && dtype !== "category" && Number.isFinite(n)) {
    return n;
  }
  return t;
}

/** Comma list → typed values: numbers for numeric, booleans for bool, else text. */
export function parseAllowed(
  text: string,
  dtype: RuleDtype | undefined,
): (boolean | number | string)[] | undefined {
  const items = text.split(",").map((s) => s.trim()).filter((s) => s !== "");
  if (!items.length) return undefined;
  if (dtype === "numeric") {
    return items.map((s) => (Number.isFinite(Number(s)) ? Number(s) : s));
  }
  if (dtype === "bool") {
    return items.map((s) => (s.toLowerCase() === "true" ? true : s.toLowerCase() === "false" ? false : s));
  }
  return items;
}

export const formatAllowed = (v: ColumnRule["allowed"]): string => (v ?? []).join(", ");

/** The rule with `patch` applied; `undefined` values drop the key. */
export function patchRule(rule: ColumnRule, patch: Partial<ColumnRule>): ColumnRule {
  const out: Record<string, unknown> = { ...rule, ...patch };
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out as unknown as ColumnRule;
}

/** Stored `columns` param as a list of rules (anything else = no rule). */
export function rulesOf(value: unknown): ColumnRule[] {
  return Array.isArray(value)
    ? value.filter((r): r is ColumnRule => typeof r === "object" && r !== null)
    : [];
}

/** Why the rules cannot be sent yet, else null (the engine rejects both cases). */
export function columnRulesProblem(params: Record<string, unknown>): string | null {
  const rules = rulesOf(params.columns);
  if (rules.some((r) => !String(r.name ?? "").trim())) return "Name every column rule";
  const names = rules.map((r) => r.name);
  const dupe = names.find((n, i) => names.indexOf(n) !== i);
  return dupe === undefined ? null : `Two rules for column ${dupe}`;
}
