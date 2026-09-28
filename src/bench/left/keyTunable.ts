import type { JsonSchema } from "../../api/types";
import {
  defaultParams,
  resolveSchemaProp,
  schemaToFields,
  type EditorField,
} from "../schemaFields";

/**
 * Params injected by the dock (workspace source / selection / split-by),
 * not edited in the Parameters panel.
 */
const KEY_STRUCTURAL_PARAMS = new Set([
  "source",
  "test",
  "columns",
  "by",
  "by_label",
  "compare",
  "target",
]);

/**
 * Tunable key fields for a dock Parameters panel — same mapping as the step
 * editor (`schemaToFields`), minus structural params the dock already owns.
 */
export function keyTunableFields(
  schema: JsonSchema,
  keyId: string,
): EditorField[] {
  return schemaToFields(schema, keyId).filter(
    (f) => !KEY_STRUCTURAL_PARAMS.has(f.key),
  );
}

/**
 * Schema-only defaults for a key (no transform-op special cases).
 * Skips null defaults and structural params.
 */
export function keySchemaDefaults(
  schema: JsonSchema,
  keyId: string,
): Record<string, unknown> {
  const fromSchema = defaultParams(schema, keyId);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fromSchema)) {
    if (KEY_STRUCTURAL_PARAMS.has(key)) continue;
    if (value === null || value === undefined) continue;
    out[key] = value;
  }
  // defaultParams may miss defaults that are only on unresolved anyOf props.
  const props = schema.properties ?? {};
  for (const [key, raw] of Object.entries(props)) {
    if (KEY_STRUCTURAL_PARAMS.has(key)) continue;
    if (out[key] !== undefined) continue;
    const prop = resolveSchemaProp(raw as JsonSchema, schema);
    if (prop.default !== undefined && prop.default !== null) {
      out[key] = prop.default;
    } else if ((raw as JsonSchema).default !== undefined && (raw as JsonSchema).default !== null) {
      out[key] = (raw as JsonSchema).default;
    }
  }
  return out;
}

/** Storage key for persisted dock params (window-level or per-column). */
export function toolParamsKey(
  toolId: string,
  column: string | null | undefined,
): string {
  return column ? `${toolId}::${column}` : toolId;
}
