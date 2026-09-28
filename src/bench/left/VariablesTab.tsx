import { useEffect, useMemo, useState } from "react";

import { apiClient } from "../../api/client";
import type { JsonValue, VariableSpec } from "../../api/types";
import { EngineError } from "../../api/types";
import { useAppDispatch, useAppState } from "../../state/AppStore";
import { dataIdentity } from "../dataIdentity";
import { useWorkbenchData } from "../WorkbenchData";
import {
  VARIABLE_STATS,
  fmtStat,
  type VariableStat,
} from "./stats";

function chipClass(on: boolean): string {
  return on ? "chip on" : "chip";
}

const PENDING_NAME = "__dtk_pending";

function isValidVarName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

/** Extract name → number|null from preview_step.state.variables. */
function parseVariableValues(
  state: Record<string, JsonValue>,
): Record<string, number | null> {
  const raw = state.variables;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, number | null> = {};
  for (const [k, v] of Object.entries(raw as Record<string, JsonValue>)) {
    out[k] = typeof v === "number" && !Number.isNaN(v) ? v : null;
  }
  return out;
}

function displayValue(
  name: string,
  values: Record<string, number | null>,
  loading: boolean,
): string {
  if (loading) return "…";
  if (!(name in values)) return "…";
  return fmtStat(values[name] ?? null);
}

/**
 * Variables tab — values come from the engine (train, latest version) via a
 * throwaway formula preview_step, not from the grid's loaded page / view role.
 */
export function VariablesTab() {
  const { workspace, editor } = useAppState();
  const dispatch = useAppDispatch();
  const { profiles, loading: profilesLoading } = useWorkbenchData();
  const [nvName, setNvName] = useState("");
  const [nvStat, setNvStat] = useState<VariableStat>("median");
  const [nvColumn, setNvColumn] = useState<string | null>(null);

  const [values, setValues] = useState<Record<string, number | null>>({});
  const [valuesLoading, setValuesLoading] = useState(false);
  const [valuesError, setValuesError] = useState<string | null>(null);

  const vars = workspace?.variables;
  /**
   * Values are what a formula appended now would freeze: train, latest
   * version. Keyed on that identity (steps + params hash), not the object.
   */
  const trainLatestKey = useMemo(
    () => dataIdentity(workspace, "train", null).key,
    [workspace],
  );
  const [shownKey, setShownKey] = useState<string | null>(null);
  const edFormula = editor?.op === "formula";

  const profileList = useMemo(() => [...profiles.values()], [profiles]);

  const numericCols = useMemo(
    () =>
      profileList
        .filter((c) => c.kind === "number" || c.kind === "binary")
        .map((c) => c.name),
    [profileList],
  );

  const pendingVar = useMemo((): VariableSpec | null => {
    if (!nvColumn) return null;
    const name = isValidVarName(nvName) ? nvName : PENDING_NAME;
    return { name, stat: nvStat, column: nvColumn };
  }, [nvColumn, nvName, nvStat]);

  const varsForFit = useMemo(() => {
    const list = [...(vars ?? [])];
    if (pendingVar && !list.some((v) => v.name === pendingVar.name)) {
      list.push(pendingVar);
    }
    return list;
  }, [vars, pendingVar]);

  // Re-run when variables or the train-latest identity change — never when
  // only the view role / version changes.
  useEffect(() => {
    if (!workspace?.datasets.train.x.path || varsForFit.length === 0) {
      setValues({});
      setValuesError(null);
      setValuesLoading(false);
      return;
    }

    let cancelled = false;
    setValuesLoading(true);
    setValuesError(null);

    (async () => {
      try {
        const prev = await apiClient.previewStep(
          workspace,
          {
            op: "formula",
            target: "train",
            params: {
              name: "__dtk_vars",
              expr: "0",
              variables: varsForFit,
            },
          },
          "train",
        );
        if (cancelled) return;
        setValues(parseVariableValues(prev.state));
        setValuesError(null);
        setShownKey(trainLatestKey);
      } catch (e) {
        if (cancelled) return;
        setValues({});
        setValuesError(e instanceof EngineError ? e.message : String(e));
      } finally {
        if (!cancelled) setValuesLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [trainLatestKey, varsForFit]); // eslint-disable-line react-hooks/exhaustive-deps

  const nvOk =
    !!nvName &&
    isValidVarName(nvName) &&
    !!nvColumn &&
    numericCols.includes(nvColumn) &&
    !(vars ?? []).some((v) => v.name === nvName);

  const pendingKey = pendingVar?.name ?? PENDING_NAME;
  const previewValue = nvColumn
    ? displayValue(pendingKey, values, valuesLoading)
    : null;
  const preview = nvColumn
    ? `@${nvName || "?"} = ${nvStat}(${nvColumn}) = ${previewValue} on train`
    : "Pick a statistic and a column.";

  return (
    <div
      className="left-tab-body"
      data-identity={shownKey ?? ""}
      data-identity-current={trainLatestKey}
    >
      <p className="left-help">
        Named statistics, computed on <strong>train</strong> at the latest
        version. Use them as{" "}
        <span className="mono">@name</span> in a formula: the step freezes
        their train value, so test reuses the same number.
      </p>
      {profilesLoading && !profileList.length ? (
        <div className="muted">Loading…</div>
      ) : null}
      {valuesError ? (
        <div className="engine-error" role="alert">
          {valuesError}
        </div>
      ) : null}

      <div className="var-list">
        {(vars ?? []).map((v) => {
          const value = displayValue(v.name, values, valuesLoading);
          return (
            <div key={v.name} className="var-card">
              <div className="var-card-top">
                <span className="var-name">@{v.name}</span>
                <span className="var-value mono">{value}</span>
              </div>
              <div className="var-card-bottom">
                <span className="mono muted">
                  {v.stat}({v.column})
                </span>
                <button
                  type="button"
                  className="link-btn"
                  onClick={() =>
                    dispatch({
                      type: "INSERT_FORMULA_TOKEN",
                      token: `@${v.name}`,
                    })
                  }
                >
                  {edFormula ? "Insert" : "Use in formula"}
                </button>
                <button
                  type="button"
                  className="link-btn danger"
                  aria-label={`Delete variable ${v.name}`}
                  onClick={() =>
                    dispatch({ type: "REMOVE_VARIABLE", name: v.name })
                  }
                >
                  Delete
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="var-form">
        <div className="var-form-title">New variable</div>
        <label htmlFor="nv-name">Name</label>
        <input
          id="nv-name"
          className="mono"
          value={nvName}
          placeholder="e.g. spend_p90"
          onChange={(e) =>
            setNvName(e.target.value.replace(/[^A-Za-z0-9_]/g, "_"))
          }
        />
        <span className="field-label">Statistic</span>
        <div className="chip-row" role="group" aria-label="Statistic">
          {VARIABLE_STATS.map((s) => (
            <button
              key={s}
              type="button"
              className={chipClass(nvStat === s)}
              onClick={() => setNvStat(s)}
            >
              {s}
            </button>
          ))}
        </div>
        <span className="field-label">Column</span>
        <div className="chip-row" role="group" aria-label="Numeric column">
          {numericCols.map((c) => (
            <button
              key={c}
              type="button"
              className={chipClass(nvColumn === c)}
              onClick={() => {
                setNvColumn(c);
                setNvName((n) => n || `${nvStat}_${c}`);
              }}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="mono muted preview">{preview}</div>
        <button
          type="button"
          className="primary-btn"
          disabled={!nvOk}
          onClick={() => {
            if (!nvOk || !nvColumn) return;
            dispatch({
              type: "ADD_VARIABLE",
              variable: { name: nvName, stat: nvStat, column: nvColumn },
            });
            setNvName("");
            setNvColumn(null);
          }}
        >
          Add variable
        </button>
      </div>

      <button
        type="button"
        className="formula-btn"
        onClick={() =>
          dispatch({ type: "OPEN_EDITOR", op: "formula", params: {} })
        }
      >
        ƒ New formula step
      </button>
    </div>
  );
}
