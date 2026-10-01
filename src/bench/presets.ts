/**
 * Editor presets → engine params, driven by the transform JSON schema.
 *
 * Openers (context menu, inspector, step picker, suggestions) speak in terms of
 * one selected `column`; the op's schema says where it goes (`x-dtk-widget`
 * column / columns, or a column-keyed object). Only UX choices the schema
 * cannot express are listed per op here.
 */
import type { ColumnKind, ColumnProfile, JsonSchema } from "../api/types";
import { isNumericKind } from "./kinds";
import {
  defaultParams,
  fieldValuePresent,
  filterColumnsByDtype,
  resolveSchemaProp,
} from "./schemaFields";

type Params = Record<string, unknown>;
type Column = { name: string; kind: ColumnKind };

/** UI alias ops → engine op (map_value is a one-value standardize_text). */
const OP_ALIAS: Record<string, string> = { map_value: "standardize_text" };

/** Resolve UI alias ops to real engine op names. */
export function resolveOp(op: string): string {
  return OP_ALIAS[op] ?? op;
}

const toList = (v: unknown): unknown[] => (Array.isArray(v) ? v : [v]);

/**
 * Per-column value of ops whose params are an object keyed by column
 * (sentinels, mapping, dtypes, categories), read from the opener's preset.
 */
const KEYED_VALUE: Record<string, (p: Params) => unknown> = {
  replace_sentinels: (p) => (p.values === undefined ? undefined : toList(p.values)),
  rename: (p) => String(p.to ?? ""),
  cast: (p) => String(p.dtype ?? "float"),
  ordinal: (p) => (Array.isArray(p.order) ? p.order : []),
};

/**
 * Schema-free rewrites, idempotent so callers may re-apply them to params that
 * are already in engine shape.
 */
function normalize(op: string, p: Params): Params {
  const mapsValue =
    p.from !== undefined || (op === "map_value" && typeof p.column === "string");
  if (resolveOp(op) === "standardize_text" && mapsValue) {
    const col = String(p.column ?? "");
    const from = String(p.from ?? "");
    return {
      columns: col ? [col] : [],
      strip: false,
      lower: false,
      mapping: from ? { [from]: String(p.to ?? "") } : {},
    };
  }
  // The number_list input keeps the raw text while it does not parse.
  if (op === "bin" && typeof p.edges === "string") {
    const edges = p.edges.split(",").map((s) => Number(s.trim()));
    return { ...p, edges: edges.filter((n) => !Number.isNaN(n)) };
  }
  return p;
}

function columnHint(prop: JsonSchema): string | undefined {
  const hint = prop["x-dtk-widget"];
  if (hint === "column" || hint === "columns") return hint;
  return prop.type === "object" ? "object" : undefined;
}

/** Where an opener's single `column` goes: the first required column param. */
function columnSlot(
  schema: JsonSchema,
): { key: string; shape: string } | null {
  const props = schema.properties ?? {};
  for (const key of schema.required ?? []) {
    const shape = columnHint(resolveSchemaProp(props[key] as JsonSchema, schema));
    if (shape) return { key, shape };
  }
  return null;
}

function placeColumn(op: string, p: Params, schema: JsonSchema): Params {
  const { column, ...rest } = p;
  if (typeof column !== "string") return p;
  const slot = columnSlot(schema);
  if (!slot || fieldValuePresent(rest[slot.key])) return rest;
  if (slot.shape === "columns") return { ...rest, [slot.key]: [column] };
  if (slot.shape === "column") return { ...rest, [slot.key]: column };
  const value = KEYED_VALUE[op]?.(p);
  return value === undefined ? rest : { ...rest, [slot.key]: { [column]: value } };
}

/** Keep only the params the engine declares. */
function schemaKeys(p: Params, schema: JsonSchema): Params {
  const props = schema.properties ?? {};
  return Object.fromEntries(Object.entries(p).filter(([k]) => k in props));
}

/**
 * Convert an editor preset into the engine param shape. Without `schema` only
 * the schema-free rewrites run; the editor re-applies this with the schema
 * once it has loaded (see `seedEditorParams`).
 */
export function toEngineParams(
  op: string,
  preset: Params,
  schema?: JsonSchema,
): Params {
  const p = normalize(op, preset);
  if (!schema) return p;
  if (schema.properties?.column) return schemaKeys(p, schema);
  return schemaKeys(placeColumn(resolveOp(op), p, schema), schema);
}

/**
 * keep first/last needs an order: sort by the identifier column when there is
 * one, else fall back to keep none.
 */
function withDuplicateOrder(p: Params, columns: Column[]): Params {
  const keepsOne = p.keep === "first" || p.keep === "last";
  if (!keepsOne || fieldValuePresent(p.sort_by)) return p;
  const id = columns.find((c) => c.kind === "identifier");
  return id ? { ...p, sort_by: [id.name] } : { ...p, keep: "none", sort_by: null };
}

/** Editor params once the op's schema has loaded: defaults, then the preset. */
export function seedEditorParams(
  schema: JsonSchema,
  op: string,
  preset: Params,
  columns: Column[],
): Params {
  const params = {
    ...defaultParams(schema, op),
    ...toEngineParams(op, preset, schema),
  };
  return op === "drop_duplicates" ? withDuplicateOrder(params, columns) : params;
}

/** Step-picker presets the schema cannot express. */
const PICKER_EXTRA: Record<string, (col: string, pr?: ColumnProfile) => Params> = {
  replace_sentinels: () => ({ values: [-999] }),
  formula: (col) => ({ expr: col }),
  filter_rows: (col, pr) => {
    const numeric = pr ? isNumericKind(pr.kind) : false;
    return {
      conditions: [
        { column: col, op: numeric ? "gt" : "notna", value: numeric ? 0 : null },
      ],
    };
  },
  to_numeric: (_col, pr) => {
    const fmt = pr?.currency_as_text;
    return fmt
      ? { decimal: fmt.decimal, thousands: fmt.thousands, percent: fmt.percent }
      : {};
  },
};

/**
 * Step-picker preset from the grid selection: `target` gets the dataset
 * target, each required column param gets the selected columns its dtype
 * accepts (one per single-column param, in order), and a column-keyed object
 * gets the first selected column.
 */
export function pickerPreset(
  schema: JsonSchema,
  op: string,
  selection: Column[],
  datasetTarget: string | null,
  profiles: Map<string, ColumnProfile>,
): Params {
  const props = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const free = selection.slice();
  const out: Params = {};
  for (const [key, raw] of Object.entries(props)) {
    const prop = resolveSchemaProp(raw as JsonSchema, schema);
    const hint = columnHint(prop);
    if (key === "target" && datasetTarget) {
      out.target = datasetTarget;
    } else if (required.has(key) && (hint === "column" || hint === "columns")) {
      const filter = prop["x-dtk-dtype"] === "numeric" ? "numeric" : "any";
      const fits = filterColumnsByDtype(free, filter);
      if (hint === "columns" && fits.length) out[key] = fits;
      if (hint === "column" && fits[0]) {
        out[key] = fits[0];
        free.splice(free.findIndex((c) => c.name === fits[0]), 1);
      }
    }
  }
  const first = selection[0]?.name;
  if (!first) return out;
  if (columnSlot(schema)?.shape === "object") out.column = first;
  return { ...out, ...PICKER_EXTRA[op]?.(first, profiles.get(first)) };
}
