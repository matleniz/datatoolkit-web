import { useEffect, useMemo, useState } from "react";

import { apiClient } from "../../api/client";
import { useKeyedAsync } from "../../hooks";
import {
  ensureWorkspaceSaved,
  useAppDispatch,
  useAppState,
} from "../../state/AppStore";
import { identitySource } from "../dataIdentity";
import { targetColumnOf } from "../left/datasetSource";
import { keyParamsFromSchema } from "../left/keyParams";
import { useWorkbenchData } from "../WorkbenchData";
import {
  CHART_AGGS,
  chartDraftToParams,
  chartParamsToDraft,
  chartPrefillFromSelection,
  DEFAULT_CHART_DRAFT,
  defaultChartName,
  type ChartDraft,
} from "./chartPrefill";
import {
  applyTile,
  CHART_TILES,
  pickerPool,
  recommendedTile,
  tileBlocker,
  tileOf,
  type ChartTileId,
  type PickerCol,
} from "./chartPicker";
import { ChartTypePicker } from "./ChartTypePicker";
import { IdentityStrip } from "./IdentityStrip";
import { ResultView } from "./ResultView";
import "./ChartDock.css";

function ColSelect({
  id,
  label,
  value,
  columns,
  onChange,
  target = null,
  allowEmpty = true,
}: {
  id: string;
  label: string;
  value: string | null;
  columns: string[];
  onChange: (v: string | null) => void;
  /** Listed first and tagged, so "colour by target" is one pick away. */
  target?: string | null;
  allowEmpty?: boolean;
}) {
  const ordered =
    target && columns.includes(target)
      ? [target, ...columns.filter((c) => c !== target)]
      : columns;
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
        {ordered.map((name) => (
          <option key={name} value={name}>
            {name === target ? `${name} · target` : name}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Chart builder dock body (MAT-172, reworked MAT-240): chart type as icon
 * tiles, x / y / colour in one compact row, the rest under "More", and the
 * figure filling the window (MAT-235 shell) → run_key("chart").
 * Prefill from selection / chartDraft; saved specs live on workspace.charts.
 */
export function ChartDockBody() {
  const { workspace, selection, chartDraft } = useAppState();
  const dispatch = useAppDispatch();
  const bench = useWorkbenchData();
  const [saveName, setSaveName] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);

  const identity = bench.identity;
  const colNames = useMemo(() => {
    if (bench.columns.length > 0) return bench.columns.map((c) => c.name);
    return [...bench.profiles.keys()];
  }, [bench.columns, bench.profiles]);

  const allCols: PickerCol[] = useMemo(
    () =>
      colNames.map((name) => {
        const meta = bench.columns.find((c) => c.name === name);
        const profile = bench.profiles.get(name);
        return {
          name,
          kind: meta?.kind ?? profile?.kind ?? "text",
          distinct: profile?.distinct,
        };
      }),
    [colNames, bench.columns, bench.profiles],
  );

  const draft: ChartDraft = chartDraft ?? DEFAULT_CHART_DRAFT;
  const target = workspace ? targetColumnOf(workspace) : null;
  const targetCol = target && colNames.includes(target) ? target : null;

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

  // identity.key covers role, version and the steps hash (MAT-175); the draft
  // counts by content, so unrelated workspace edits never re-run the chart.
  const run = useKeyedAsync(
    workspace?.datasets.train.x.path
      ? `${identity.key}\0${JSON.stringify(chartDraft)}`
      : null,
    async (alive) => {
      await ensureWorkspaceSaved(workspace);
      const schema = await apiClient.keySchema("chart");
      if (!alive() || !chartDraft) return undefined;
      const params = keyParamsFromSchema(schema, {
        source: identitySource(identity),
        ...chartDraftToParams(chartDraft),
      });
      const result = await apiClient.runKey("chart", params);
      return { result, runParams: JSON.stringify(params) };
    },
    !!chartDraft,
  );
  const { ready, error } = run;
  const shown = ready ? run.value : undefined;
  const result = shown?.result ?? null;
  const runParams = shown?.runParams ?? null;
  const shownIdentity = ready ? identity.key : null;

  const saved = workspace?.charts ?? [];
  const patch = (p: Partial<ChartDraft>) =>
    dispatch({ type: "PATCH_CHART_DRAFT", patch: p });

  const activeTile = tileOf(draft.chart);
  const pool = useMemo(
    () => pickerPool(draft, selection.columns, allCols),
    [draft, selection.columns, allCols],
  );
  const selectedCols = useMemo(
    () =>
      selection.columns.flatMap((n) => allCols.filter((c) => c.name === n)),
    [selection.columns, allCols],
  );
  const blockers = useMemo(() => {
    const out: Partial<Record<ChartTileId, string>> = {};
    for (const t of CHART_TILES) {
      if (t.id === activeTile) continue;
      const why = tileBlocker(t.id, pool);
      if (why) out[t.id] = why;
    }
    return out;
  }, [pool, activeTile]);
  const recommended =
    selection.columns.length > 0 ? recommendedTile(selectedCols) : null;

  const isMatrix = draft.chart === "scatter_matrix";
  const showAgg =
    draft.chart === "bar" ||
    draft.chart === "count" ||
    draft.chart === "line" ||
    draft.chart === "histogram" ||
    draft.chart === "pie";
  const showTrend = draft.chart === "scatter";
  const showBins =
    draft.chart === "histogram" ||
    draft.chart === "density_heatmap" ||
    draft.chart === "heatmap";
  const showSize = draft.chart === "scatter";
  const colorByTarget = targetCol != null && draft.color === targetCol;
  const moreCount = [
    draft.facet_row,
    draft.facet_col,
    showSize ? draft.size : null,
    showAgg ? draft.agg : null,
    showTrend && draft.trendline ? "t" : null,
    draft.log_x ? "lx" : null,
    draft.log_y ? "ly" : null,
  ].filter(Boolean).length;

  return (
    <div
      className="chart-dock"
      data-engine-key="chart"
      data-chart-type={draft.chart}
      data-chart-x={draft.x ?? ""}
      data-chart-y={draft.y ?? ""}
      data-chart-color={draft.color ?? ""}
      data-chart-trendline={draft.trendline ? "1" : "0"}
      data-identity={shownIdentity ?? ""}
      data-identity-current={identity.key}
      data-run-params={runParams ?? undefined}
    >
      <IdentityStrip
        identity={identity}
        shownIdentity={shownIdentity}
        editing={!!bench.pendingStep}
      />
      <ChartTypePicker
        active={activeTile}
        recommended={recommended}
        blockers={blockers}
        onPick={(tile) =>
          dispatch({ type: "SET_CHART_DRAFT", draft: applyTile(draft, tile, pool) })
        }
      />

      <div className="chart-encode" role="group" aria-label="Encoding">
        {isMatrix ? (
          <div className="chart-matrix-cols muted" title={draft.columns.join(", ")}>
            {draft.columns.length > 0
              ? `${draft.columns.length} columns: ${draft.columns.join(", ")}`
              : "First numeric columns"}
          </div>
        ) : (
          <>
            <ColSelect
              id="chart-x"
              label="X"
              value={draft.x}
              columns={colNames}
              target={targetCol}
              onChange={(x) => patch({ x })}
            />
            <ColSelect
              id="chart-y"
              label="Y"
              value={draft.y}
              columns={colNames}
              target={targetCol}
              onChange={(y) => patch({ y })}
            />
          </>
        )}
        <ColSelect
          id="chart-color"
          label="Color"
          value={draft.color}
          columns={colNames}
          target={targetCol}
          onChange={(color) => patch({ color })}
        />
        {targetCol ? (
          <button
            type="button"
            className={colorByTarget ? "chart-pill on" : "chart-pill"}
            aria-pressed={colorByTarget}
            title={
              colorByTarget
                ? "Remove the colour"
                : `Colour by the target (${targetCol})`
            }
            data-chart-color-target
            onClick={() => patch({ color: colorByTarget ? null : targetCol })}
          >
            <span className="chart-pill-swatch" aria-hidden="true" />
            by target
          </button>
        ) : null}
        <button
          type="button"
          className={moreOpen ? "chart-more-toggle open" : "chart-more-toggle"}
          aria-expanded={moreOpen}
          aria-controls="chart-more"
          data-chart-more
          onClick={() => setMoreOpen((o) => !o)}
        >
          More{moreCount > 0 ? ` · ${moreCount}` : ""}
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.4" />
          </svg>
        </button>
      </div>

      {moreOpen ? (
        <div id="chart-more" className="chart-form chart-more">
          <ColSelect
            id="chart-facet-row"
            label="Facet row"
            value={draft.facet_row}
            columns={colNames}
            target={targetCol}
            onChange={(facet_row) => patch({ facet_row })}
          />
          <ColSelect
            id="chart-facet-col"
            label="Facet col"
            value={draft.facet_col}
            columns={colNames}
            target={targetCol}
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
        </div>
      ) : null}

      {error ? (
        <div className="engine-error" role="alert">
          {error}
        </div>
      ) : null}
      {!ready ? <div className="dock-msg muted">Loading…</div> : null}
      {ready && result ? <ResultView result={result} /> : null}
      {ready && !result && !error ? (
        <div className="dock-msg muted">Pick columns and a chart type.</div>
      ) : null}

      <div className="chart-saved-bar">
        <input
          id="chart-save-name"
          className="chart-save-name"
          aria-label="Chart name"
          value={saveName}
          placeholder={defaultChartName(draft)}
          onChange={(e) => setSaveName(e.target.value)}
        />
        <button
          type="button"
          className="chart-pill on"
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
          <select
            id="chart-open-saved"
            className="chart-open-saved"
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
            <option value="">Saved charts ({saved.length})…</option>
            {saved.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        ) : null}
      </div>
    </div>
  );
}
