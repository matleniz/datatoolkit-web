import type { ColumnKind, JsonSchema, JsonValue } from "../api/types";
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
}

/**
 * Resolve a local `#/$defs/...` or `#/definitions/...` ref inside `root`.
 * Returns the original prop when the ref is missing or non-local.
 */
export function resolveLocalRef(
  prop: JsonSchema,
  root: JsonSchema,
): JsonSchema {
  const ref = prop.$ref;
  if (!ref || typeof ref !== "string") return prop;
  const defsMatch = ref.match(/^#\/(\$defs|definitions)\/(.+)$/);
  if (!defsMatch) return prop;
  const bag =
    defsMatch[1] === "$defs" ? root.$defs : root.definitions;
  const target = bag?.[defsMatch[2]!];
  if (!target) return prop;
  return {
    ...target,
    title: prop.title ?? target.title,
    description: prop.description ?? target.description,
    default: prop.default !== undefined ? prop.default : target.default,
    enum: prop.enum ?? target.enum,
    "x-dtk-widget": prop["x-dtk-widget"] ?? target["x-dtk-widget"],
    "x-dtk-dtype": prop["x-dtk-dtype"] ?? target["x-dtk-dtype"],
    "x-dtk-source": prop["x-dtk-source"] ?? target["x-dtk-source"],
  };
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
  const variants = withRef.anyOf ?? withRef.oneOf;
  if (variants && variants.length > 0) {
    const nonNull = variants.filter((v) => !isNullOnlySchema(v));
    if (nonNull.length === 1) {
      const inner = resolveSchemaProp(nonNull[0]!, root);
      return resolveSchemaProp(
        {
          ...inner,
          title: withRef.title ?? inner.title,
          description: withRef.description ?? inner.description,
          default:
            withRef.default !== undefined ? withRef.default : inner.default,
          enum: withRef.enum ?? inner.enum,
          "x-dtk-widget": withRef["x-dtk-widget"] ?? inner["x-dtk-widget"],
          "x-dtk-dtype": withRef["x-dtk-dtype"] ?? inner["x-dtk-dtype"],
          "x-dtk-source": withRef["x-dtk-source"] ?? inner["x-dtk-source"],
        },
        root,
      );
    }
    if (nonNull.length > 1) {
      const resolved = nonNull.map((v) => resolveSchemaProp(v, root));
      const types = new Set<string>();
      for (const r of resolved) {
        if (!r.type) continue;
        if (Array.isArray(r.type)) r.type.forEach((t) => types.add(t));
        else types.add(r.type);
      }
      const base: JsonSchema = {
        title: withRef.title,
        description: withRef.description,
        default: withRef.default,
        enum: withRef.enum,
        "x-dtk-widget": withRef["x-dtk-widget"],
        "x-dtk-dtype": withRef["x-dtk-dtype"],
        "x-dtk-source": withRef["x-dtk-source"],
      };
      if (types.has("array")) {
        const arr = resolved.find((r) => r.type === "array");
        return { ...base, type: "array", items: arr?.items ?? { type: "string" } };
      }
      if (types.has("number") || types.has("integer")) {
        return { ...base, type: "number" };
      }
      if (types.has("boolean") && types.size === 1) {
        return { ...base, type: "boolean" };
      }
      if (types.has("string")) {
        return { ...base, type: "string" };
      }
      if (types.has("object")) {
        return { ...base, type: "object" };
      }
    }
  }

  if (Array.isArray(withRef.type)) {
    const nonNull = withRef.type.filter((t) => t !== "null");
    if (nonNull.length === 1) {
      return { ...withRef, type: nonNull[0] };
    }
  }

  return withRef;
}

function isNullOnlySchema(prop: JsonSchema): boolean {
  if (prop.type === "null") return true;
  if (Array.isArray(prop.type) && prop.type.length === 1 && prop.type[0] === "null") {
    return true;
  }
  return false;
}

/** True when the unresolved schema accepts null (Optional / anyOf null). */
function schemaPropAllowsNull(prop: JsonSchema): boolean {
  if (isNullOnlySchema(prop)) return true;
  if (Array.isArray(prop.type) && prop.type.includes("null")) return true;
  const variants = prop.anyOf ?? prop.oneOf;
  if (variants?.some((v) => isNullOnlySchema(v))) return true;
  return false;
}

/**
 * Map GET /transforms/{op}/schema → editor field descriptors.
 * Special-cases engine object params (sentinels, categories, mapping, dtypes).
 */
export function schemaToFields(schema: JsonSchema, op: string): EditorField[] {
  const props = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const fields: EditorField[] = [];

  for (const [key, raw] of Object.entries(props)) {
    const prop = resolveSchemaProp(raw as JsonSchema, schema);
    if (key === "fill_value") {
      fields.push({
        key,
        label: prop.title ?? "Constant value",
        widget: "text",
        required: false,
        description: prop.description,
        whenStrategyConstant: true,
      });
      continue;
    }
    if (key === "sentinels") {
      fields.push({
        key,
        label: prop.title ?? "Sentinels",
        widget: "sentinels",
        required: required.has(key),
        description: prop.description,
      });
      continue;
    }
    if (key === "categories") {
      fields.push({
        key,
        label: prop.title ?? "Categories",
        widget: "categories",
        required: required.has(key),
        description: prop.description,
      });
      continue;
    }
    if (key === "mapping" && op === "rename") {
      fields.push({
        key,
        label: "Rename",
        widget: "mapping",
        required: required.has(key),
        description: prop.description,
      });
      continue;
    }
    if (key === "mapping" && op === "standardize_text") {
      fields.push({
        key,
        label: prop.title ?? "Mapping",
        widget: "object",
        required: false,
        description: prop.description,
      });
      continue;
    }
    if (key === "dtypes") {
      fields.push({
        key,
        label: prop.title ?? "Types",
        widget: "dtypes",
        required: required.has(key),
        description: prop.description,
      });
      continue;
    }
    if (key === "expr") {
      fields.push({
        key,
        label: prop.title ?? "Expression",
        widget: "formula",
        required: required.has(key),
        description: prop.description,
      });
      continue;
    }
    if (key === "variables" && op === "formula") {
      fields.push({
        key,
        label: prop.title ?? "Variables",
        widget: "variables",
        required: false,
        description: prop.description,
      });
      continue;
    }
    if (key === "conditions") {
      const condSchema =
        (schema.$defs?.Condition as JsonSchema | undefined) ??
        (prop.items as JsonSchema | undefined);
      const opEnum =
        ((condSchema?.properties?.op as JsonSchema | undefined)?.enum as
          | string[]
          | undefined) ?? [
          "eq",
          "ne",
          "gt",
          "ge",
          "lt",
          "le",
          "isin",
          "notin",
          "isna",
          "notna",
        ];
      fields.push({
        key,
        label: prop.title ?? "Conditions",
        widget: "conditions",
        required: required.has(key),
        enumValues: opEnum,
        description: prop.description,
      });
      continue;
    }

    const widgetHint = prop["x-dtk-widget"];
    const dtypeHint = prop["x-dtk-dtype"];
    const dtypeFilter =
      dtypeHint === "numeric"
        ? "numeric"
        : dtypeHint === "any"
          ? "any"
          : undefined;

    if (widgetHint === "columns") {
      // Drop duplicates: make Subset vs Sort by visually distinct (MAT-155).
      let label = prop.title ?? key;
      let description = prop.description;
      if (op === "drop_duplicates" && key === "subset") {
        label = "Subset (identity columns)";
        description =
          "Columns that define a duplicate row. Leave empty to match on all columns.";
      } else if (op === "drop_duplicates" && key === "sort_by") {
        label = "Sort by (keep first/last)";
        description =
          "Order rows before keeping first/last — not the same group as Subset. Required when keep is first or last.";
      }
      fields.push({
        key,
        label,
        widget: "columns",
        required: required.has(key),
        dtypeFilter,
        description,
      });
      continue;
    }
    if (widgetHint === "column") {
      fields.push({
        key,
        label: prop.title ?? key,
        widget: "column",
        required: required.has(key),
        dtypeFilter,
        description: prop.description,
      });
      continue;
    }
    if (prop.enum && Array.isArray(prop.enum)) {
      const rawHadNull = schemaPropAllowsNull(raw as JsonSchema);
      const enumValues = prop.enum.map(String);
      if (rawHadNull && !enumValues.includes("__null__")) {
        enumValues.push("__null__");
      }
      fields.push({
        key,
        label: prop.title ?? key,
        widget: "enum",
        required: required.has(key),
        enumValues,
        description: prop.description,
      });
      continue;
    }
    if (prop.type === "boolean") {
      fields.push({
        key,
        label: prop.title ?? key,
        widget: "bool",
        required: required.has(key),
        description: prop.description,
      });
      continue;
    }
    if (prop.type === "number" || prop.type === "integer") {
      fields.push({
        key,
        label: prop.title ?? key,
        widget: "number",
        required: required.has(key),
        description: prop.description,
      });
      continue;
    }
    if (prop.type === "string") {
      fields.push({
        key,
        label: prop.title ?? key,
        widget: "text",
        required: required.has(key),
        description: prop.description,
      });
      continue;
    }
    if (prop.type === "array") {
      const items = prop.items as JsonSchema | undefined;
      const resolvedItems = items ? resolveSchemaProp(items, schema) : undefined;
      if (resolvedItems?.enum && Array.isArray(resolvedItems.enum)) {
        fields.push({
          key,
          label: prop.title ?? key,
          widget: "enum_list",
          required: required.has(key),
          enumValues: resolvedItems.enum.map(String),
          description: prop.description,
        });
        continue;
      }
      if (resolvedItems?.type === "number" || resolvedItems?.type === "integer") {
        fields.push({
          key,
          label: prop.title ?? key,
          widget: "number_list",
          required: required.has(key),
          description: prop.description,
        });
        continue;
      }
      // Column-selector keys (and old engines without x-dtk-widget) → chips, not free text.
      const columnKey =
        key === "columns" ||
        key === "subset" ||
        key === "sort_by" ||
        widgetHint === "columns";
      if (resolvedItems?.type === "string" && !widgetHint && !columnKey) {
        fields.push({
          key,
          label: prop.title ?? key,
          widget: "string_list",
          required: required.has(key),
          description: prop.description,
        });
        continue;
      }
      fields.push({
        key,
        label: prop.title ?? key,
        widget: "columns",
        required: required.has(key),
        dtypeFilter: dtypeFilter ?? "any",
        description: prop.description,
      });
      continue;
    }
  }

  return fields;
}

/** Default params from schema defaults + common op defaults. Skip null defaults. */
export function defaultParams(
  schema: JsonSchema,
  op: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const props = schema.properties ?? {};
  for (const [key, raw] of Object.entries(props)) {
    const prop = resolveSchemaProp(raw as JsonSchema, schema);
    if (prop.default !== undefined && prop.default !== null) {
      out[key] = prop.default;
    }
  }
  if (op === "impute" && out.strategy === undefined) out.strategy = "median";
  if (op === "clip") {
    if (out.lower === undefined) out.lower = 5;
    if (out.upper === undefined) out.upper = 95;
  }
  if (op === "scale" && out.method === undefined) out.method = "standard";
  if (op === "standardize_text") {
    if (out.strip === undefined) out.strip = true;
    // Studio defaults to collapsing case (engine schema default is false).
    out.lower = true;
  }
  if (op === "drop_duplicates") {
    if (out.keep === undefined) out.keep = "none";
  }
  if (op === "replace_sentinels" && out.sentinels === undefined) {
    out.sentinels = {};
  }
  if (op === "ordinal" && out.categories === undefined) out.categories = {};
  if (op === "rename" && out.mapping === undefined) out.mapping = {};
  if (op === "cast" && out.dtypes === undefined) out.dtypes = {};
  if (op === "formula") {
    if (out.variables === undefined) out.variables = [];
  }
  if (op === "bin") {
    if (out.mode === undefined) out.mode = "qcut";
    if (out.q === undefined) out.q = 5;
  }
  if (op === "cyclical" && out.period === undefined) out.period = 24;
  if (op === "datetime_parts" && out.parts === undefined) {
    out.parts = ["hour", "dayofweek", "month"];
  }
  // Required enum_list fields: preselect mean when available, else the first value.
  // Covers group_agg.aggs and any future required multi-enum (MAT-167).
  for (const field of schemaToFields(schema, op)) {
    if (field.widget !== "enum_list" || !field.required) continue;
    if (out[field.key] !== undefined) continue;
    const vals = field.enumValues ?? [];
    if (vals.length === 0) continue;
    out[field.key] = vals.includes("mean") ? ["mean"] : [vals[0]!];
  }
  if (op === "impute_knn") {
    if (out.n_neighbors === undefined) out.n_neighbors = 5;
    if (out.weights === undefined) out.weights = "uniform";
  }
  if (op === "impute_iterative") {
    if (out.max_iter === undefined) out.max_iter = 10;
    if (out.random_state === undefined) out.random_state = 0;
  }
  if (op === "select_k_best") {
    if (out.score === undefined) out.score = "mutual_info";
    if (out.k === undefined && out.percentile === undefined) out.k = 5;
  }
  if (op === "select_from_model") {
    if (out.model === undefined) out.model = "tree";
  }
  if (op === "pca") {
    if (out.n_components === undefined) out.n_components = 0.95;
    if (out.standardize === undefined) out.standardize = true;
  }
  if (op === "drop_low_variance" && out.threshold === undefined) {
    out.threshold = 0.0;
  }
  if (op === "drop_correlated" && out.threshold === undefined) {
    out.threshold = 0.95;
  }
  if (op === "filter_rows") {
    if (out.conditions === undefined) out.conditions = [];
    if (out.combine === undefined) out.combine = "and";
  }
  if (op === "to_numeric") {
    if (out.decimal === undefined) out.decimal = ".";
    if (out.percent === undefined) out.percent = false;
    if (out.errors === undefined) out.errors = "raise";
  }
  if (op === "drop_high_missing" && out.threshold === undefined) {
    out.threshold = 0.5;
  }
  return out;
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

/**
 * Basic validity: required fields present; drop_duplicates keep first/last needs sort_by.
 */
export function stepParamsValid(
  op: string,
  params: Record<string, unknown>,
  fields: EditorField[],
): { ok: boolean; missing?: string } {
  for (const f of fields) {
    if (f.whenStrategyConstant && params.strategy !== "constant") continue;
    if (!f.required) continue;
    if (!fieldValuePresent(params[f.key])) {
      if (Array.isArray(params[f.key]) && (params[f.key] as unknown[]).length === 0) {
        return { ok: false, missing: `Pick at least one for ${f.label}` };
      }
      if (
        typeof params[f.key] === "object" &&
        params[f.key] !== null &&
        !Array.isArray(params[f.key]) &&
        Object.keys(params[f.key] as object).length === 0
      ) {
        return { ok: false, missing: `Configure ${f.label}` };
      }
      return { ok: false, missing: `Missing ${f.label}` };
    }
  }
  if (op === "drop_duplicates") {
    const keep = params.keep;
    if (keep === "first" || keep === "last") {
      const sortBy = params.sort_by as unknown[] | null | undefined;
      if (!sortBy || !Array.isArray(sortBy) || sortBy.length === 0) {
        return {
          ok: false,
          missing:
            "keep first/last requires sort_by (pick an identifier column, or use keep none)",
        };
      }
    }
  }
  if (op === "formula") {
    if (!String(params.name ?? "").trim() || !String(params.expr ?? "").trim()) {
      return { ok: false, missing: "Name and expression are required" };
    }
  }
  if (op === "interactions") {
    const cols = params.columns as unknown[] | null | undefined;
    if (!cols || !Array.isArray(cols) || cols.length < 2) {
      return { ok: false, missing: "Pick at least 2 columns to combine" };
    }
  }
  if (op === "filter_rows") {
    const conds = params.conditions as
      | Array<{ column?: string; op?: string; value?: unknown }>
      | undefined;
    if (!conds || !Array.isArray(conds) || conds.length === 0) {
      return { ok: false, missing: "Add at least one condition" };
    }
    for (const c of conds) {
      if (!c.column) {
        return { ok: false, missing: "Select a column for each condition" };
      }
      if (!c.op) {
        return { ok: false, missing: "Select an operator for each condition" };
      }
      if (c.op !== "isna" && c.op !== "notna") {
        if (c.value === undefined || c.value === null || c.value === "") {
          return { ok: false, missing: `Value required for condition on ${c.column}` };
        }
      }
    }
  }
  return { ok: true };
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
}

/**
 * Front-side blockers shown before Apply (do not wait on slow preview_step).
 * Covers identical consecutive steps and drop_columns of already-gone names.
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

export function applySchemaDefault(
  schema: JsonSchema,
  key: string,
): JsonValue | undefined {
  const prop = schema.properties?.[key] as JsonSchema | undefined;
  if (!prop) return undefined;
  const resolved = resolveSchemaProp(prop);
  return resolved.default as JsonValue | undefined;
}
