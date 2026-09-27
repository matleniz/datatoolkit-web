import type { ColumnKind, JsonSchema, JsonValue } from "../api/types";
import { isNumericKind } from "./kinds";

export type FieldWidget =
  | "columns"
  | "column"
  | "enum"
  | "bool"
  | "number"
  | "text"
  | "sentinels"
  | "categories"
  | "mapping"
  | "dtypes"
  | "formula"
  | "variables"
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
 * Map GET /transforms/{op}/schema → editor field descriptors.
 * Special-cases engine object params (sentinels, categories, mapping, dtypes).
 */
export function schemaToFields(schema: JsonSchema, op: string): EditorField[] {
  const props = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const fields: EditorField[] = [];

  for (const [key, raw] of Object.entries(props)) {
    const prop = raw as JsonSchema;
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

    const widgetHint = prop["x-dtk-widget"];
    const dtypeHint = prop["x-dtk-dtype"];
    const dtypeFilter =
      dtypeHint === "numeric"
        ? "numeric"
        : dtypeHint === "any"
          ? "any"
          : undefined;

    if (widgetHint === "columns") {
      fields.push({
        key,
        label: prop.title ?? key,
        widget: "columns",
        required: required.has(key),
        dtypeFilter,
        description: prop.description,
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
      fields.push({
        key,
        label: prop.title ?? key,
        widget: "enum",
        required: required.has(key),
        enumValues: prop.enum.map(String),
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

/** Default params from schema defaults + common op defaults. */
export function defaultParams(
  schema: JsonSchema,
  op: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const props = schema.properties ?? {};
  for (const [key, raw] of Object.entries(props)) {
    const prop = raw as JsonSchema;
    if (prop.default !== undefined) out[key] = prop.default;
  }
  if (op === "impute" && out.strategy === undefined) out.strategy = "median";
  if (op === "clip") {
    if (out.lower === undefined) out.lower = 5;
    if (out.upper === undefined) out.upper = 95;
  }
  if (op === "scale" && out.method === undefined) out.method = "standard";
  if (op === "standardize_text") {
    if (out.strip === undefined) out.strip = true;
    if (out.lower === undefined) out.lower = true;
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
    const v = params[f.key];
    if (v === undefined || v === null || v === "") {
      return { ok: false, missing: `Missing ${f.label}` };
    }
    if (Array.isArray(v) && v.length === 0) {
      return { ok: false, missing: `Pick at least one for ${f.label}` };
    }
    if (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0) {
      return { ok: false, missing: `Configure ${f.label}` };
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
  return { ok: true };
}

export function applySchemaDefault(
  schema: JsonSchema,
  key: string,
): JsonValue | undefined {
  const prop = schema.properties?.[key] as JsonSchema | undefined;
  return prop?.default as JsonValue | undefined;
}
