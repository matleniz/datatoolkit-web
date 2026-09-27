import { useEffect, useMemo, useState } from "react";

import { apiClient } from "../../api/client";
import type { ColumnProfile, WorkspaceRow } from "../../api/types";
import { EngineError } from "../../api/types";
import { useAppDispatch, useAppState } from "../../state/AppStore";
import {
  VARIABLE_STATS,
  computeStat,
  fmtStat,
  type VariableStat,
} from "./stats";

function chipClass(on: boolean): string {
  return on ? "chip on" : "chip";
}

export function VariablesTab() {
  const { workspace, editor, viewVersion } = useAppState();
  const dispatch = useAppDispatch();
  const [profiles, setProfiles] = useState<ColumnProfile[]>([]);
  const [rows, setRows] = useState<WorkspaceRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [nvName, setNvName] = useState("");
  const [nvStat, setNvStat] = useState<VariableStat>("median");
  const [nvColumn, setNvColumn] = useState<string | null>(null);

  const vars = workspace?.variables ?? [];
  const edFormula = editor?.op === "formula";

  useEffect(() => {
    if (!workspace?.datasets.train.x.path) {
      setProfiles([]);
      setRows([]);
      return;
    }
    let cancelled = false;
    const version = viewVersion ?? null;
    (async () => {
      try {
        const [prof, wr] = await Promise.all([
          apiClient.columnProfiles(workspace, "train", version),
          apiClient.workspaceRows(workspace, "train", version, 0, 5000),
        ]);
        if (cancelled) return;
        setProfiles(prof.columns);
        setRows(wr.rows);
        setError(null);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof EngineError ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspace, viewVersion]);

  const numericCols = useMemo(
    () =>
      profiles
        .filter((c) => c.kind === "number" || c.kind === "binary")
        .map((c) => c.name),
    [profiles],
  );

  const nvOk =
    !!nvName &&
    !!nvColumn &&
    numericCols.includes(nvColumn) &&
    !vars.some((v) => v.name === nvName);

  const preview = nvColumn
    ? `@${nvName || "?"} = ${nvStat}(${nvColumn}) = ${fmtStat(computeStat(rows, nvStat, nvColumn))} on train`
    : "Pick a statistic and a column.";

  return (
    <div className="left-tab-body">
      <p className="left-help">
        Named statistics, computed on <strong>train</strong> at the latest
        version. Use them as{" "}
        <span className="mono">@name</span> in a formula: the step freezes
        their train value, so test reuses the same number.
      </p>
      {error ? <div className="engine-error" role="alert">{error}</div> : null}

      <div className="var-list">
        {vars.map((v) => {
          const value = fmtStat(computeStat(rows, v.stat, v.column));
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
