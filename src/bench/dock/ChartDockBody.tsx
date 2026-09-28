import { useEffect, useMemo, useState } from "react";

import { apiClient } from "../../api/client";
import type { Result } from "../../api/types";
import { EngineError } from "../../api/types";
import { useAppDispatch, useAppState } from "../../state/AppStore";
import { keyParamsFromSchema } from "../left/keyParams";
import { useWorkbenchData } from "../WorkbenchData";
import { effectiveVersion } from "../version";
import {
  CHART_AGGS,
  CHART_TYPES,
  chartDraftToParams,
  chartParamsToDraft,
  chartPrefillFromSelection,
  DEFAULT_CHART_DRAFT,
  defaultChartName,
  type ChartDraft,
} from "./chartPrefill";
import { ResultView } from "./ResultView";

function ColSelect({
  id,
  label,
  value,
  columns,
  onChange,
  allowEmpty = true,
}: {
  id: string;
  label: string;
  value: string | null;
  columns: string[];
  onChange: (v: string | null) => void;
  allowEmpty?: boolean;
}) {
  return (
    <label className="chart-field" htmlFor={id}>
      <span>{label}</span>
      <select
        id={id}
        aria-label={label}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
      >
        {allowEmpty ? <option value="">(none)</option> : null}
        {columns.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Chart builder dock body (MAT-172): form → run_key("chart") → ResultView.
 * Prefill from selection / chartDraft; saved specs live on workspace.charts.
 */
export function ChartDockBody() {
  const { workspace, selection, role, viewVersion, chartDraft } = useAppState();
  const dispatch = useAppDispatch();
  const bench = useWorkbenchData();
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [saveName, setSaveName] = useState("");

  const version = workspace ? effectiveVersion(workspace, viewVersion) : 0;
  const colNames = useMemo(() => {
    if (bench.columns.length > 0) return bench.columns.map((c) => c.name);
    return [...bench.profiles.keys()];
  }, [bench.columns, bench.profiles]);

  const draft: ChartDraft = chartDraft ?? DEFAULT_CHART_DRAFT;

  // Prefill once when the tool opens without a draft.
  useEffect(() => {
    if (chartDraft) return;
    const cols = selection.columns.map((name) => {
      const meta = bench.columns.find((c) => c.name === name);
      const kind = meta?.kind ?? bench.profiles.get(name)?.kind ?? "text";
      return { name, kind };
    });
    dispatch({
      type: "SET_CHART_DRAFT",
      draft: chartPrefillFromSelection(cols),
    });
  }, [
    chartDraft,
    selection.columns,
    bench.columns,
    bench.profiles,
    dispatch,
  ]);

  useEffect(() => {
    if (!workspace?.datasets.train.x.path) {
      setError(null);
      setResult(null);
      setReady(true);
      return;
    }
    if (!chartDraft) {
      setReady(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setReady(false);
      setError(null);
      setResult(null);
      try {
        if (window.__DTK_WORKSPACE_SAVED__) {
          await window.__DTK_WORKSPACE_SAVED__;
        }
        const source = {
          kind: "dataset" as const,
          workspace: workspace.name,
          role,
          labeled: role === "train",
          version: viewVersion,
        };
        const available: Record<string, unknown> = {
          source,
          ...chartDraftToParams(chartDraft),
        };
        const schema = await apiClient.keySchema("chart");
        if (cancelled) return;
        const params = keyParamsFromSchema(schema, available);
        const r = await apiClient.runKey("chart", params);
        if (cancelled) return;
        setResult(r);
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
  }, [
    workspace,
    role,
    viewVersion,
    version,
    chartDraft,
    workspace?.steps.length,
  ]);

  const saved = workspace?.charts ?? [];
  const patch = (p: Partial<ChartDraft>) =>
    dispatch({ type: "PATCH_CHART_DRAFT", patch: p });

  const showAgg =
    draft.chart === "bar" ||
    draft.chart === "count" ||
    draft.chart === "line" ||
    draft.chart === "histogram";
  const showTrend = draft.chart === "scatter";
  const showBins =
    draft.chart === "histogram" || draft.chart === "density_heatmap";
  const showSize = draft.chart === "scatter";
  const showMatrix = draft.chart === "scatter_matrix";

  return (
    <div
      className="chart-dock"
      data-engine-key="chart"
      data-chart-type={draft.chart}
      data-chart-x={draft.x ?? ""}
      data-chart-y={draft.y ?? ""}
      data-chart-color={draft.color ?? ""}
      data-chart-trendline={draft.trendline ? "1" : "0"}
    >
      <div className="chart-form">
        <label className="chart-field" htmlFor="chart-type">
          <span>Type</span>
          <select
            id="chart-type"
            aria-label="Chart type"
            value={draft.chart}
            onChange={(e) =>
              patch({ chart: e.target.value as ChartDraft["chart"] })
            }
          >
            {CHART_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        {!showMatrix ? (
          <>
            <ColSelect
              id="chart-x"
              label="X"
              value={draft.x}
              columns={colNames}
              onChange={(x) => patch({ x })}
            />
            <ColSelect
              id="chart-y"
              label="Y"
              value={draft.y}
              columns={colNames}
              onChange={(y) => patch({ y })}
            />
          </>
        ) : null}
        <ColSelect
          id="chart-color"
          label="Color"
          value={draft.color}
          columns={colNames}
          onChange={(color) => patch({ color })}
        />
        <ColSelect
          id="chart-facet-row"
          label="Facet row"
          value={draft.facet_row}
          columns={colNames}
          onChange={(facet_row) => patch({ facet_row })}
        />
        <ColSelect
          id="chart-facet-col"
          label="Facet col"
          value={draft.facet_col}
          columns={colNames}
          onChange={(facet_col) => patch({ facet_col })}
        />
        {showSize ? (
          <ColSelect
            id="chart-size"
            label="Size"
            value={draft.size}
            columns={colNames}
            onChange={(size) => patch({ size })}
          />
        ) : null}
        {showAgg ? (
          <label className="chart-field" htmlFor="chart-agg">
            <span>Agg</span>
            <select
              id="chart-agg"
              aria-label="Aggregation"
              value={draft.agg ?? ""}
              onChange={(e) =>
                patch({
                  agg: e.target.value
                    ? (e.target.value as ChartDraft["agg"])
                    : null,
                })
              }
            >
              <option value="">(auto)</option>
              {CHART_AGGS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {showTrend ? (
          <label className="chart-check" htmlFor="chart-trendline">
            <input
              id="chart-trendline"
              type="checkbox"
              checked={draft.trendline}
              onChange={(e) => patch({ trendline: e.target.checked })}
            />
            Trendline
          </label>
        ) : null}
        <label className="chart-check" htmlFor="chart-log-x">
          <input
            id="chart-log-x"
            type="checkbox"
            checked={draft.log_x}
            onChange={(e) => patch({ log_x: e.target.checked })}
          />
          Log X
        </label>
        <label className="chart-check" htmlFor="chart-log-y">
          <input
            id="chart-log-y"
            type="checkbox"
            checked={draft.log_y}
            onChange={(e) => patch({ log_y: e.target.checked })}
          />
          Log Y
        </label>
        {showBins ? (
          <label className="chart-field" htmlFor="chart-bins">
            <span>Bins</span>
            <input
              id="chart-bins"
              type="number"
              min={2}
              max={200}
              aria-label="Bins"
              value={draft.bins}
              onChange={(e) =>
                patch({ bins: Math.max(2, Math.min(200, Number(e.target.value) || 30)) })
              }
            />
          </label>
        ) : null}
        <label className="chart-field" htmlFor="chart-sample">
          <span>Sample</span>
          <input
            id="chart-sample"
            type="number"
            min={1}
            aria-label="Sample size"
            placeholder="all"
            value={draft.sample_size ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              patch({
                sample_size: v === "" ? null : Math.max(1, Number(v) || 1),
              });
            }}
          />
        </label>
      </div>

      <div className="chart-saved-bar">
        <label className="chart-field chart-save-name" htmlFor="chart-save-name">
          <span>Save as</span>
          <input
            id="chart-save-name"
            aria-label="Chart name"
            value={saveName}
            placeholder={defaultChartName(draft)}
            onChange={(e) => setSaveName(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="chip on"
          data-chart-save
          onClick={() => {
            const name = (saveName.trim() || defaultChartName(draft)).slice(0, 64);
            dispatch({
              type: "ADD_CHART",
              chart: { name, params: chartDraftToParams(draft) },
            });
            setSaveName(name);
          }}
        >
          Save chart
        </button>
        {saved.length > 0 ? (
          <label className="chart-field" htmlFor="chart-open-saved">
            <span>Open</span>
            <select
              id="chart-open-saved"
              aria-label="Open saved chart"
              value=""
              onChange={(e) => {
                const name = e.target.value;
                const found = saved.find((c) => c.name === name);
                if (!found) return;
                dispatch({
                  type: "SET_CHART_DRAFT",
                  draft: chartParamsToDraft(found.params),
                });
                setSaveName(found.name);
              }}
            >
              <option value="">Saved charts…</option>
              {saved.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {error ? (
        <div className="engine-error" role="alert">
          {error}
        </div>
      ) : null}
      {!ready ? <div className="dock-msg muted">Loading…</div> : null}
      {ready && result ? (
        <ResultView result={result} showModeBar />
      ) : null}
      {ready && !result && !error ? (
        <div className="dock-msg muted">Pick columns and a chart type.</div>
      ) : null}
    </div>
  );
}
