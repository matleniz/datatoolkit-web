import type { ColumnProfile, SuggestedParams } from "../../api/types";

/**
 * Map engine `column_profiles.suggested_params` onto key run params.
 * Profile uses `log_scale`; `column_distribution` exposes `log_x`.
 */
export function suggestedParamsToKeyParams(
  suggested: SuggestedParams | null | undefined,
): Record<string, unknown> {
  if (!suggested) return {};
  const out: Record<string, unknown> = {};
  if (typeof suggested.bins === "number") out.bins = suggested.bins;
  if (typeof suggested.top_k === "number") out.top_k = suggested.top_k;
  if (typeof suggested.log_scale === "boolean") out.log_x = suggested.log_scale;
  return out;
}

/** Defaults for Reset: schema defaults overlaid with per-column suggestions. */
export function defaultsWithSuggested(
  schemaDefaults: Record<string, unknown>,
  profile: ColumnProfile | undefined,
): Record<string, unknown> {
  return {
    ...schemaDefaults,
    ...suggestedParamsToKeyParams(profile?.suggested_params),
  };
}
