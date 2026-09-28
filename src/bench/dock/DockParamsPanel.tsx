import { useEffect, useState } from "react";

import { apiClient } from "../../api/client";
import type { ColumnKind, ColumnProfile, JsonSchema } from "../../api/types";
import { EngineError } from "../../api/types";
import { useAppDispatch } from "../../state/AppStore";
import type { EditorField } from "../schemaFields";
import { keySchemaDefaults, keyTunableFields } from "../left/keyTunable";
import { DockParamField } from "./DockParamField";
import { defaultsWithSuggested } from "./suggestedParams";

/**
 * Compact Parameters panel driven by GET /keys/{id}/schema (MAT-174).
 * Mapping reuses `schemaToFields` via `keyTunableFields`. Parent owns
 * persistence (`toolParams`) and debounced key re-runs.
 */
export function DockParamsPanel({
  keyId,
  storageKey,
  params,
  columns,
  profile,
}: {
  keyId: string;
  storageKey: string;
  params: Record<string, unknown>;
  columns: { name: string; kind: ColumnKind }[];
  profile?: ColumnProfile;
}) {
  const dispatch = useAppDispatch();
  const [fields, setFields] = useState<EditorField[]>([]);
  const [schemaDefaults, setSchemaDefaults] = useState<Record<string, unknown>>(
    {},
  );
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setReady(false);
      setError(null);
      try {
        const schema: JsonSchema = await apiClient.keySchema(keyId);
        if (cancelled) return;
        const nextFields = keyTunableFields(schema, keyId);
        const defaults = keySchemaDefaults(schema, keyId);
        setFields(nextFields);
        setSchemaDefaults(defaults);
        // Seed once when this window/column has no persisted params.
        if (Object.keys(params).length === 0 && nextFields.length > 0) {
          dispatch({
            type: "SET_TOOL_PARAMS",
            key: storageKey,
            params: defaultsWithSuggested(defaults, profile),
          });
        }
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof EngineError ? e.message : String(e));
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Seed when key/column/profile suggestions change; ignore params edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [keyId, storageKey, profile?.name, profile?.suggested_params?.bins]);

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
        <div className="dock-params-head muted">Parameters…</div>
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
      params: defaultsWithSuggested(schemaDefaults, profile),
    });
  };

  return (
    <div className="dock-params" data-dock-params={keyId}>
      <div className="dock-params-head">
        <span className="dock-params-title">Parameters</span>
        <button
          type="button"
          className="link-btn"
          data-dock-params-reset=""
          onClick={reset}
        >
          Reset to defaults
        </button>
      </div>
      <div className="dock-params-fields">
        {fields.map((field) => (
          <DockParamField
            key={field.key}
            field={field}
            params={params}
            columns={columns}
            onChange={setField}
          />
        ))}
      </div>
    </div>
  );
}
