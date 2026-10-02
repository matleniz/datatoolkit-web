import { useState } from "react";

import { errorText, type ChartSpec, type Workspace } from "../../api/types";
import { useAppDispatch, useAppState } from "../../state/AppStore";
import { saveWorkspaceNow } from "../../state/workspaceSaveGate";
import { ResultView } from "./ResultView";
import {
  CHART_AGGS,
  chartDraftToParams,
  chartParamsToDraft,
  defaultChartName,
  type ChartDraft,
} from "./chartPrefill";
import type { ChartVisibility } from "./chartDockModel";

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

type Patch = (p: Partial<ChartDraft>) => void;

export function ChartEncodeRow({
  draft,
  vis,
  colNames,
  targetCol,
  moreOpen,
  moreCount,
  patch,
  onToggleMore,
}: {
  draft: ChartDraft;
  vis: ChartVisibility;
  colNames: string[];
  targetCol: string | null;
  moreOpen: boolean;
  moreCount: number;
  patch: Patch;
  onToggleMore: () => void;
}) {
  const colorByTarget = targetCol != null && draft.color === targetCol;
  return (
    <div className="chart-encode" role="group" aria-label="Encoding">
      {vis.isMatrix ? (
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
        onClick={onToggleMore}
      >
        More{moreCount > 0 ? ` · ${moreCount}` : ""}
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      </button>
    </div>
  );
}

function CheckField({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="chart-check" htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

function AggField({ draft, patch }: { draft: ChartDraft; patch: Patch }) {
  return (
    <label className="chart-field" htmlFor="chart-agg">
      <span>Agg</span>
      <select
        id="chart-agg"
        aria-label="Aggregation"
        value={draft.agg ?? ""}
        onChange={(e) =>
          patch({
            agg: e.target.value ? (e.target.value as ChartDraft["agg"]) : null,
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
  );
}

function BinsField({ draft, patch }: { draft: ChartDraft; patch: Patch }) {
  return (
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
  );
}

function SampleField({ draft, patch }: { draft: ChartDraft; patch: Patch }) {
  return (
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
  );
}

export function ChartMoreForm({
  draft,
  vis,
  colNames,
  targetCol,
  patch,
}: {
  draft: ChartDraft;
  vis: ChartVisibility;
  colNames: string[];
  targetCol: string | null;
  patch: Patch;
}) {
  return (
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
      {vis.showSize ? (
        <ColSelect
          id="chart-size"
          label="Size"
          value={draft.size}
          columns={colNames}
          onChange={(size) => patch({ size })}
        />
      ) : null}
      {vis.showAgg ? <AggField draft={draft} patch={patch} /> : null}
      {vis.showBins ? <BinsField draft={draft} patch={patch} /> : null}
      <SampleField draft={draft} patch={patch} />
      {vis.showTrend ? (
        <CheckField
          id="chart-trendline"
          label="Trendline"
          checked={draft.trendline}
          onChange={(trendline) => patch({ trendline })}
        />
      ) : null}
      <CheckField
        id="chart-log-x"
        label="Log X"
        checked={draft.log_x}
        onChange={(log_x) => patch({ log_x })}
      />
      <CheckField
        id="chart-log-y"
        label="Log Y"
        checked={draft.log_y}
        onChange={(log_y) => patch({ log_y })}
      />
    </div>
  );
}

export function ChartRunStatus({
  hint,
  ready,
  error,
  result,
}: {
  hint: string | null;
  ready: boolean;
  error: string | null | undefined;
  result: Parameters<typeof ResultView>[0]["result"] | null;
}) {
  if (hint) {
    return (
      <div className="dock-msg muted" data-chart-hint>
        {hint}
      </div>
    );
  }
  return (
    <>
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
    </>
  );
}

/** Save the chart list on the engine workspace; resolves to an error text. */
async function storeCharts(
  workspace: Workspace,
  charts: ChartSpec[],
): Promise<string | null> {
  try {
    await saveWorkspaceNow({ ...workspace, charts });
    return null;
  } catch (e) {
    return errorText(e);
  }
}

export function ChartSavedBar({
  draft,
  saved,
}: {
  draft: ChartDraft;
  saved: ChartSpec[];
}) {
  const { workspace } = useAppState();
  const dispatch = useAppDispatch();
  const [saveName, setSaveName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** Name the engine refused as a duplicate: offer to replace that chart. */
  const [duplicate, setDuplicate] = useState<string | null>(null);

  // Appended as-is: the engine owns name uniqueness and its 422 is shown.
  const store = async (name: string, replace: boolean) => {
    if (!workspace) return;
    const chart = { name, params: chartDraftToParams(draft) };
    const kept = replace ? saved.filter((c) => c.name !== name) : saved;
    const charts = [...kept, chart];
    setSaving(true);
    const err = await storeCharts(workspace, charts);
    setSaving(false);
    setSaveError(err);
    setDuplicate(err && /duplicate chart name/i.test(err) ? name : null);
    if (!err) dispatch({ type: "SET_CHARTS", charts });
  };
  const save = () => {
    const name = (saveName.trim() || defaultChartName(draft)).slice(0, 64);
    setSaveName(name);
    void store(name, false);
  };
  const open = (name: string) => {
    const found = saved.find((c) => c.name === name);
    if (!found) return;
    dispatch({ type: "SET_CHART_DRAFT", draft: chartParamsToDraft(found.params) });
    setSaveName(found.name);
    setSaveError(null);
    setDuplicate(null);
  };
  return (
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
        disabled={saving || !workspace}
        onClick={save}
      >
        Save chart
      </button>
      {saved.length > 0 ? (
        <select
          id="chart-open-saved"
          className="chart-open-saved"
          aria-label="Open saved chart"
          value=""
          onChange={(e) => open(e.target.value)}
        >
          <option value="">Saved charts ({saved.length})…</option>
          {saved.map((c) => (
            <option key={c.name} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
      ) : null}
      {saveError ? (
        <div className="engine-error chart-save-error" role="alert" data-chart-save-error>
          {saveError}
          {duplicate ? (
            <button
              type="button"
              className="chart-pill"
              data-chart-replace
              disabled={saving}
              onClick={() => void store(duplicate, true)}
            >
              Replace “{duplicate}”
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
