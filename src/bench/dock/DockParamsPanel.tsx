import { apiClient } from "../../api/client";
import type { ColumnKind, ColumnProfile } from "../../api/types";
import { useKeyedAsync } from "../../hooks";
import { useAppDispatch } from "../../state/AppStore";
import { keySchemaDefaults, keyTunableFields } from "../left/keyTunable";
import { fieldControl } from "../fieldControl";
import { fieldActive } from "../schemaFields";
import { defaultsWithSuggested } from "./suggestedParams";

/** One-line `key=value` summary of the current params (collapsed panel). */
function paramsSummary(params: Record<string, unknown>): string {
  return Object.entries(params)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(",") : String(v)}`)
    .join(" · ");
}

/**
 * Compact Parameters panel driven by GET /keys/{id}/schema (MAT-174).
 * Mapping reuses `schemaToFields` via `keyTunableFields`. Parent owns
 * persistence (`toolParams`) and debounced key re-runs. Collapsed to a
 * one-line summary unless `open` (MAT-235: the figure comes first).
 */
export function DockParamsPanel({
  keyId,
  storageKey,
  params,
  columns,
  profile,
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
  keyId: string;
  storageKey: string;
  params: Record<string, unknown>;
  columns: { name: string; kind: ColumnKind }[];
  profile?: ColumnProfile;
}) {
  const dispatch = useAppDispatch();
  // Re-seed when key/column/profile suggestions change; ignore params edits.
  const { value, error, ready } = useKeyedAsync(
    [keyId, storageKey, profile?.name, profile?.suggested_params?.bins].join("\0"),
    async (alive) => {
      const schema = await apiClient.keySchema(keyId);
      const fields = keyTunableFields(schema, keyId);
      const defaults = keySchemaDefaults(schema, keyId);
      // Seed once when this window/column has no persisted params.
      if (alive() && Object.keys(params).length === 0 && fields.length > 0) {
        dispatch({
          type: "SET_TOOL_PARAMS",
          key: storageKey,
          params: defaultsWithSuggested(defaults, profile),
        });
      }
      return { fields, defaults };
    },
  );
  const fields = value?.fields ?? [];

  if (error) {
    return (
      <div className="dock-params" data-dock-params={keyId}>
        <div className="engine-error" role="alert">
          {error}
        </div>
      </div>
    );
  }
  if (!ready && fields.length === 0) {
    return (
      <div className="dock-params" data-dock-params={keyId}>
        <button
          type="button"
          className="chip dock-params-chip"
          disabled
        >
          <span className="dock-params-title muted">Parameters…</span>
        </button>
      </div>
    );
  }
  if (fields.length === 0) return null;

  const setField = (key: string, value: unknown) => {
    dispatch({
      type: "SET_TOOL_PARAMS",
      key: storageKey,
      params: { ...params, [key]: value },
    });
  };

  const reset = () => {
    dispatch({
      type: "SET_TOOL_PARAMS",
      key: storageKey,
      params: defaultsWithSuggested(value?.defaults ?? {}, profile),
    });
  };

  const summary = paramsSummary(params);
  return (
    <div
      className={open ? "dock-params open" : "dock-params"}
      data-dock-params={keyId}
      data-dock-params-open={open ? "1" : "0"}
    >
      <div className="dock-params-head">
        <button
          type="button"
          className={open ? "chip dock-params-chip on" : "chip dock-params-chip"}
          data-dock-params-toggle=""
          aria-expanded={open}
          onClick={onToggle}
          title={summary ? `Parameters · ${summary}` : "Parameters"}
        >
          <span className="result-details-caret" aria-hidden="true">
            {open ? "▾" : "▸"}
          </span>
          <span className="dock-params-title">Parameters</span>
        </button>
        {open ? (
          <button
            type="button"
            className="link-btn"
            data-dock-params-reset=""
            onClick={reset}
          >
            Reset to defaults
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="dock-params-fields">
          {fields.filter((f) => fieldActive(f, params)).map((field) => {
            const control = fieldControl(
              field,
              params[field.key],
              (v) => setField(field.key, v),
              columns,
              { dock: true },
            );
            return control ? (
              <label key={field.key} className="dock-param" data-dock-param={field.key}>
                <span className="dock-param-label">{field.label}</span>
                {control}
              </label>
            ) : null;
          })}
        </div>
      ) : null}
    </div>
  );
}
