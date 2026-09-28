import type { JsonSchema } from "../../api/types";

/**
 * Build run_key params from a key's JSON schema properties.
 * Only passes keys that the schema declares (e.g. outliers has no `test`).
 */
export function keyParamsFromSchema(
  schema: JsonSchema,
  available: Record<string, unknown>,
): Record<string, unknown> {
  const props = schema.properties ?? {};
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(props)) {
    if (
      Object.prototype.hasOwnProperty.call(available, key) &&
      available[key] !== undefined
    ) {
      out[key] = available[key];
    }
  }
  return out;
}
