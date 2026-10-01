import type { ColumnKind, JsonSchema } from "../api/types";
import { isNumericKind } from "./kinds";

export type FieldWidget =
  | "columns"
  | "column"
  | "enum"
  | "enum_list"
  | "number_list"
  | "string_list"
  | "bool"
  | "number"
  | "text"
  /** Integer/number or the literal `"auto"` (e.g. column_distribution.bins). */
  | "auto_number"
  | "sentinels"
  | "categories"
  | "mapping"
  | "dtypes"
  | "formula"
  | "variables"
  | "conditions"
  | "object";

export interface EditorField {
  key: string;
  label: string;
  widget: FieldWidget;
  required: boolean;
  enumValues?: string[];
  dtypeFilter?: "any" | "numeric" | "text" | "date";
  description?: string;
  /** Show only when params.strategy === 'constant' (impute fill_value). */
  whenStrategyConstant?: boolean;
  /** Schema `minItems` of an array param. */
  minItems?: number;
}

/** Studio hints carried by a schema prop (kept when a $ref / union is unwrapped). */
const HINT_KEYS = [
  "title",
  "description",
  "enum",
  "x-dtk-widget",
  "x-dtk-dtype",
  "x-dtk-source",
] as const;

/** The outer prop's hints and default, falling back to `inner`'s. */
function hintsOf(outer: JsonSchema, inner: JsonSchema = {}): JsonSchema {
  const hints: JsonSchema = Object.fromEntries(
    HINT_KEYS.map((k) => [k, outer[k] ?? inner[k]]),
  );
  hints.default = outer.default !== undefined ? outer.default : inner.default;
  return hints;
}

/**
 * Resolve a local `#/$defs/...` or `#/definitions/...` ref inside `root`.
 * Returns the original prop when the ref is missing or non-local.
 */
function resolveLocalRef(prop: JsonSchema, root: JsonSchema): JsonSchema {
  const m = typeof prop.$ref === "string"
    ? prop.$ref.match(/^#\/(\$defs|definitions)\/(.+)$/)
    : null;
  const bag = m?.[1] === "$defs" ? root.$defs : root.definitions;
  const target = m ? bag?.[m[2]!] : undefined;
  return target ? { ...target, ...hintsOf(prop, target) } : prop;
}

/** Collapse a multi-branch union to the widest type the editor can render. */
function collapseUnion(outer: JsonSchema, resolved: JsonSchema[]): JsonSchema {
  const types = new Set(resolved.flatMap((r) => (r.type ? [r.type].flat() : [])));
  const base = hintsOf(outer);
  if (types.has("array")) {
    const arr = resolved.find((r) => r.type === "array");
    return { ...base, type: "array", items: arr?.items ?? { type: "string" } };
  }
  if (types.has("number") || types.has("integer")) return { ...base, type: "number" };
  if (types.has("boolean") && types.size === 1) return { ...base, type: "boolean" };
  if (types.has("string")) return { ...base, type: "string" };
  if (types.has("object")) return { ...base, type: "object" };
  return outer;
}

/**
 * Unwrap `anyOf` / `oneOf` / `type: [T, "null"]` unions so mapping sees the
 * non-null branch (engine schemas often use Optional[...] → anyOf + null).
 * Pass `root` to follow local `$ref`s (MAT-177).
 */
export function resolveSchemaProp(
  prop: JsonSchema,
  root?: JsonSchema,
): JsonSchema {
  const withRef = root ? resolveLocalRef(prop, root) : prop;
  const nonNull = (withRef.anyOf ?? withRef.oneOf ?? []).filter(
    (v) => !isNullOnlySchema(v),
  );
  if (nonNull.length === 1) {
    const inner = resolveSchemaProp(nonNull[0]!, root);
    return resolveSchemaProp({ ...inner, ...hintsOf(withRef, inner) }, root);
  }
  if (nonNull.length > 1) {
    return collapseUnion(withRef, nonNull.map((v) => resolveSchemaProp(v, root)));
  }
  if (Array.isArray(withRef.type)) {
    const types = withRef.type.filter((t) => t !== "null");
    if (types.length === 1) return { ...withRef, type: types[0] };
  }
  return withRef;
}

function isNullOnlySchema(prop: JsonSchema): boolean {
  if (prop.type === "null") return true;
  return Array.isArray(prop.type) && prop.type.length === 1 && prop.type[0] === "null";
}

/** True when the unresolved schema accepts null (Optional / anyOf null). */
function schemaPropAllowsNull(prop: JsonSchema): boolean {
  if (isNullOnlySchema(prop)) return true;
  if (Array.isArray(prop.type) && prop.type.includes("null")) return true;
  return (prop.anyOf ?? prop.oneOf ?? []).some((v) => isNullOnlySchema(v));
}

/**
 * True when a prop is `integer|number | "auto"` (Pydantic BinsSpec-style anyOf).
 * Detected before resolveSchemaProp collapses the union to number-only.
 */
function isAutoOrNumberUnion(prop: JsonSchema, root?: JsonSchema): boolean {
  const variants = (prop.anyOf ?? prop.oneOf ?? [])
    .filter((v) => !isNullOnlySchema(v))
    .map((v) => resolveSchemaProp(v, root));
  const hasNum = variants.some((r) => r.type === "integer" || r.type === "number");
  const hasAuto = variants.some(
    (r) => r.const === "auto" || (r.type === "string" && !!r.enum?.includes("auto")),
  );
  return hasNum && hasAuto;
}

type WidgetSpec = Pick<EditorField, "widget" | "enumValues" | "dtypeFilter">;

/**
 * Params with a dedicated editor control, keyed `op.key` or `key`; the label is
 * the fallback when the schema has no title (`fixedLabel` ignores the title).
 */
const SPECIAL_FIELDS: Record<
  string,
  Partial<EditorField> & { widget: FieldWidget; fixedLabel?: boolean }
> = {
  fill_value: { widget: "text", label: "Constant value", required: false, whenStrategyConstant: true },
  sentinels: { widget: "sentinels", label: "Sentinels" },
  categories: { widget: "categories", label: "Categories" },
  "rename.mapping": { widget: "mapping", label: "Rename", fixedLabel: true },
  "standardize_text.mapping": { widget: "object", label: "Mapping", required: false },
  dtypes: { widget: "dtypes", label: "Types" },
  expr: { widget: "formula", label: "Expression" },
  "formula.variables": { widget: "variables", label: "Variables", required: false },
  conditions: { widget: "conditions", label: "Conditions" },
};

/** Studio copy for generic fields (drop_duplicates: Subset vs Sort by, MAT-155). */
const FIELD_COPY: Record<string, Pick<EditorField, "label" | "description">> = {
  "drop_duplicates.subset": {
    label: "Subset (identity columns)",
    description:
      "Columns that define a duplicate row. Leave empty to match on all columns.",
  },
  "drop_duplicates.sort_by": {
    label: "Sort by (keep first/last)",
    description:
      "Order rows before keeping first/last — not the same group as Subset. Required when keep is first or last.",
  },
};

const CONDITION_OPS = ["eq", "ne", "gt", "ge", "lt", "le", "isin", "notin", "isna", "notna"];

function conditionOps(schema: JsonSchema, prop: JsonSchema): string[] {
  const cond =
    (schema.$defs?.Condition as JsonSchema | undefined) ??
    (prop.items as JsonSchema | undefined);
  const ops = (cond?.properties?.op as JsonSchema | undefined)?.enum;
  return (ops as string[] | undefined) ?? CONDITION_OPS;
}

function arrayWidget(
  key: string,
  prop: JsonSchema,
  schema: JsonSchema,
  dtypeFilter: EditorField["dtypeFilter"],
): WidgetSpec {
  const items = prop.items
    ? resolveSchemaProp(prop.items as JsonSchema, schema)
    : undefined;
  if (Array.isArray(items?.enum)) {
    return { widget: "enum_list", enumValues: items.enum.map(String) };
  }
  if (items?.type === "number" || items?.type === "integer") {
    return { widget: "number_list" };
  }
  // Column-selector keys (and old engines without x-dtk-widget) → chips, not free text.
  const columnKey = key === "columns" || key === "subset" || key === "sort_by";
  if (items?.type === "string" && !prop["x-dtk-widget"] && !columnKey) {
    return { widget: "string_list" };
  }
  return { widget: "columns", dtypeFilter: dtypeFilter ?? "any" };
}

const SCALAR_WIDGET: Record<string, FieldWidget> = {
  boolean: "bool",
  number: "number",
  integer: "number",
  string: "text",
};

/** Generic widget from the schema type and the x-dtk hints; null = no control. */
function genericWidget(
  key: string,
  raw: JsonSchema,
  prop: JsonSchema,
  schema: JsonSchema,
): WidgetSpec | null {
  if (isAutoOrNumberUnion(raw, schema)) return { widget: "auto_number" };
  const hint = prop["x-dtk-widget"];
  const dtype = prop["x-dtk-dtype"];
  const dtypeFilter = dtype === "numeric" || dtype === "any" ? dtype : undefined;
  if (hint === "columns" || hint === "column") return { widget: hint, dtypeFilter };
  if (Array.isArray(prop.enum)) {
    const enumValues = prop.enum.map(String);
    if (schemaPropAllowsNull(raw) && !enumValues.includes("__null__")) {
      enumValues.push("__null__");
    }
    return { widget: "enum", enumValues };
  }
  if (prop.type === "array") return arrayWidget(key, prop, schema, dtypeFilter);
  const scalar = SCALAR_WIDGET[String(prop.type)];
  return scalar ? { widget: scalar } : null;
}

/**
 * Map GET /transforms/{op}/schema → editor field descriptors: dedicated
 * controls for the engine's structured params, otherwise a widget derived from
 * the schema type and x-dtk hints.
 */
export function schemaToFields(schema: JsonSchema, op: string): EditorField[] {
  const required = new Set(schema.required ?? []);
  const fields: EditorField[] = [];
  for (const [key, raw] of Object.entries(schema.properties ?? {})) {
    const prop = resolveSchemaProp(raw as JsonSchema, schema);
    const base = {
      key,
      label: prop.title ?? key,
      required: required.has(key),
      description: prop.description,
      ...(typeof prop.minItems === "number" ? { minItems: prop.minItems } : {}),
    };
    const special = SPECIAL_FIELDS[`${op}.${key}`] ?? SPECIAL_FIELDS[key];
    if (special) {
      const { fixedLabel, label, ...rest } = special;
      fields.push({
        ...base,
        label: fixedLabel ? label! : (prop.title ?? label!),
        ...rest,
        ...(key === "conditions" ? { enumValues: conditionOps(schema, prop) } : {}),
      });
      continue;
    }
    const widget = genericWidget(key, raw as JsonSchema, prop, schema);
    if (widget) fields.push({ ...base, ...widget, ...FIELD_COPY[`${op}.${key}`] });
  }
  return fields;
}

/** Studio defaults that differ from (or are missing in) the engine schema. */
const UX_DEFAULTS: Record<string, Record<string, unknown>> = {
  // Collapse case variants by default (engine default is false).
  standardize_text: { lower: true },
  // keep first/last needs a sort_by the user has not picked yet.
  drop_duplicates: { keep: "none" },
  bin: { mode: "qcut", q: 5 },
  cyclical: { period: 24 },
  datetime_parts: { parts: ["hour", "dayofweek", "month"] },
  select_k_best: { k: 5 },
};

/** Structured editors start from an empty container. */
const EMPTY_VALUE: Partial<Record<FieldWidget, () => unknown>> = {
  sentinels: () => ({}),
  categories: () => ({}),
  mapping: () => ({}),
  dtypes: () => ({}),
  variables: () => [],
  conditions: () => [],
};

/** A required multi-enum preselects mean when offered, else its first value (MAT-167). */
function enumListDefault(field: EditorField): unknown {
  const vals = field.enumValues ?? [];
  if (field.widget !== "enum_list" || !field.required || !vals.length) return undefined;
  return vals.includes("mean") ? ["mean"] : [vals[0]!];
}

/** Default params: schema defaults (nulls skipped), then the Studio choices. */
export function defaultParams(
  schema: JsonSchema,
  op: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(schema.properties ?? {})) {
    const d = resolveSchemaProp(raw as JsonSchema, schema).default;
    if (d !== undefined && d !== null) out[key] = d;
  }
  for (const field of schemaToFields(schema, op)) {
    if (out[field.key] !== undefined) continue;
    const value = EMPTY_VALUE[field.widget]?.() ?? enumListDefault(field);
    if (value !== undefined) out[field.key] = value;
  }
  return { ...out, ...UX_DEFAULTS[op] };
}

/** Drop null/undefined entries before sending params to the engine. */
export function stripNullParams(
  params: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * True when impute strategy=constant should send a numeric fill_value.
 * Engine rejects string constants on numeric columns
 * (`impute: string fill … on numeric column`).
 */
export function imputeConstantNeedsNumber(
  params: Record<string, unknown>,
  columns: { name: string; kind: ColumnKind }[],
): boolean {
  if (params.strategy !== "constant") return false;
  const selected = params.columns;
  if (!Array.isArray(selected) || selected.length === 0) return false;
  const byName = new Map(columns.map((c) => [c.name, c.kind]));
  const kinds: ColumnKind[] = [];
  for (const name of selected) {
    if (typeof name !== "string") return false;
    const kind = byName.get(name);
    if (kind === undefined) return false;
    kinds.push(kind);
  }
  return kinds.every((k) => isNumericKind(k));
}

/**
 * Coerce impute `fill_value` to a real number when the target columns are
 * numeric; leave string constants alone for text/categorical columns (MAT-205).
 */
export function coerceImputeFillValue(
  params: Record<string, unknown>,
  columns: { name: string; kind: ColumnKind }[],
): Record<string, unknown> {
  if (!imputeConstantNeedsNumber(params, columns)) return params;
  const fv = params.fill_value;
  if (fv === null || fv === undefined || fv === "") return params;
  if (typeof fv === "number" && !Number.isNaN(fv)) return params;
  if (typeof fv === "string") {
    const trimmed = fv.trim();
    if (trimmed === "") return params;
    const n = Number(trimmed);
    if (!Number.isNaN(n)) return { ...params, fill_value: n };
  }
  return params;
}

export function filterColumnsByDtype(
  columns: { name: string; kind: ColumnKind }[],
  filter: EditorField["dtypeFilter"],
): string[] {
  if (!filter || filter === "any") return columns.map((c) => c.name);
  if (filter === "numeric") {
    return columns.filter((c) => isNumericKind(c.kind)).map((c) => c.name);
  }
  if (filter === "text") {
    return columns.filter((c) => c.kind === "text").map((c) => c.name);
  }
  if (filter === "date") {
    return columns.filter((c) => c.kind === "date").map((c) => c.name);
  }
  return columns.map((c) => c.name);
}

/** True when a required editor field has a usable value. */
export function fieldValuePresent(v: unknown): boolean {
  if (v === undefined || v === null || v === "") return false;
  if (Array.isArray(v) && v.length === 0) return false;
  if (
    typeof v === "object" &&
    !Array.isArray(v) &&
    Object.keys(v as object).length === 0
  ) {
    return false;
  }
  return true;
}

function conditionsProblem(params: Record<string, unknown>): string | null {
  const conds = params.conditions as
    | Array<{ column?: string; op?: string; value?: unknown }>
    | undefined;
  if (!conds?.length) return "Add at least one condition";
  for (const c of conds) {
    if (!c.column) return "Select a column for each condition";
    if (!c.op) return "Select an operator for each condition";
    const needsValue = c.op !== "isna" && c.op !== "notna";
    if (needsValue && (c.value === undefined || c.value === null || c.value === "")) {
      return `Value required for condition on ${c.column}`;
    }
  }
  return null;
}

/** Cross-field rules the schema cannot express. */
const OP_CHECKS: Record<string, (p: Record<string, unknown>) => string | null> = {
  drop_duplicates: (p) =>
    (p.keep === "first" || p.keep === "last") && !fieldValuePresent(p.sort_by)
      ? "keep first/last requires sort_by (pick an identifier column, or use keep none)"
      : null,
  formula: (p) =>
    String(p.name ?? "").trim() && String(p.expr ?? "").trim()
      ? null
      : "Name and expression are required",
  filter_rows: conditionsProblem,
};

function fieldProblem(f: EditorField, v: unknown): string | null {
  if (f.required && !fieldValuePresent(v)) {
    if (Array.isArray(v)) return `Pick at least one for ${f.label}`;
    if (typeof v === "object" && v !== null) return `Configure ${f.label}`;
    return `Missing ${f.label}`;
  }
  if (Array.isArray(v) && v.length < (f.minItems ?? 0)) {
    return `Pick at least ${f.minItems} for ${f.label}`;
  }
  return null;
}

/** Basic validity: schema-required fields and minItems, then the op's own rules. */
export function stepParamsValid(
  op: string,
  params: Record<string, unknown>,
  fields: EditorField[],
): { ok: boolean; missing?: string } {
  for (const f of fields) {
    if (f.whenStrategyConstant && params.strategy !== "constant") continue;
    const problem = fieldProblem(f, params[f.key]);
    if (problem) return { ok: false, missing: problem };
  }
  const problem = OP_CHECKS[op]?.(params);
  return problem ? { ok: false, missing: problem } : { ok: true };
}

/**
 * After mapping a transform schema, ensure required params produced fields.
 * Returns an error message when the editor would silently render with no
 * required controls (stale engine schema / unmapped $ref — MAT-177).
 */
export function schemaFieldsGap(
  schema: JsonSchema,
  fields: EditorField[],
): string | null {
  const required = schema.required ?? [];
  if (required.length === 0) return null;
  const keys = new Set(fields.map((f) => f.key));
  const missing = required.filter((k) => !keys.has(k));
  if (missing.length === 0) return null;
  return (
    `Transform schema did not yield editor fields for required params: ${missing.join(", ")}. ` +
    "Is the engine API up to date with this Studio build?"
  );
}

function stableParamJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableParamJson(v)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableParamJson(obj[k])}`).join(",")}}`;
}

/** True when two steps would do the same work (op + target + params). */
export function stepsAreIdentical(
  a: { op: string; target: string; params: Record<string, unknown> },
  b: { op: string; target: string; params: Record<string, unknown> },
): boolean {
  if (a.op !== b.op || a.target !== b.target) return false;
  return stableParamJson(a.params) === stableParamJson(b.params);
}

export interface StepEditorContext {
  /** Column names on the frame the grid is showing (current role/version). */
  availableColumns: string[];
  /** Last step already in the workspace pipeline, if any. */
  previousStep: {
    op: string;
    target: string;
    params: Record<string, unknown>;
  } | null;
  /**
   * Missing-value counts by column name (from column profiles). Used to block
   * feature ops that refuse NaNs before preview_step (MAT-191).
   */
  missingByColumn?: Map<string, number> | Record<string, number>;
}

/** Feature ops that refuse columns with missing values (engine requires impute first). */
const FEATURE_OPS_NEED_IMPUTE = new Set([
  "polynomial",
  "power_transform",
  "quantile_transform",
]);

function missingCountOf(
  name: string,
  missingByColumn: Map<string, number> | Record<string, number>,
): number {
  if (missingByColumn instanceof Map) {
    return missingByColumn.get(name) ?? 0;
  }
  return missingByColumn[name] ?? 0;
}

/**
 * Columns selected for a feature op that still have missing values (MAT-191).
 * Empty when the op does not require complete columns or nothing is missing.
 */
export function featureOpColumnsNeedingImpute(
  op: string,
  params: Record<string, unknown>,
  missingByColumn?: Map<string, number> | Record<string, number>,
): string[] {
  if (!FEATURE_OPS_NEED_IMPUTE.has(op) || !missingByColumn) return [];
  const cols = params.columns;
  if (!Array.isArray(cols) || cols.length === 0) return [];
  return cols.filter(
    (c): c is string =>
      typeof c === "string" && missingCountOf(c, missingByColumn) > 0,
  );
}

/**
 * Front-side blockers shown before Apply (do not wait on slow preview_step).
 * Covers identical consecutive steps, drop_columns of already-gone names,
 * and feature ops on columns that still have missing values (MAT-191).
 */
export function stepEditorBlockers(
  op: string,
  params: Record<string, unknown>,
  target: string,
  ctx: StepEditorContext,
): string | null {
  // Prefer "already gone" over "identical" when re-dropping a removed column
  // (the previous step is often the drop that removed it — MAT-177).
  if (op === "drop_columns" && params.missing_ok !== true) {
    const cols = params.columns;
    if (Array.isArray(cols) && cols.length > 0) {
      const available = new Set(ctx.availableColumns);
      const gone = cols.filter((c) => typeof c === "string" && !available.has(c));
      if (gone.length === 1) {
        return `Column ${gone[0]} is already gone from this frame.`;
      }
      if (gone.length > 1) {
        return `Columns already gone from this frame: ${gone.join(", ")}.`;
      }
    }
  }

  const needImpute = featureOpColumnsNeedingImpute(
    op,
    params,
    ctx.missingByColumn,
  );
  if (needImpute.length === 1) {
    return `Impute missing values first (${needImpute[0]} has missing).`;
  }
  if (needImpute.length > 1) {
    return `Impute missing values first (${needImpute.join(", ")} have missing).`;
  }

  if (ctx.previousStep && stepsAreIdentical(
    { op, target, params },
    {
      op: ctx.previousStep.op,
      target: ctx.previousStep.target,
      params: ctx.previousStep.params,
    },
  )) {
    return "This step is identical to the previous one — change the parameters or discard.";
  }

  return null;
}
