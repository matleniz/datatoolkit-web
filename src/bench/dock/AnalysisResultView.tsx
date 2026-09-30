import { useMemo, useState } from "react";

import type { Result } from "../../api/types";
import { useAppDispatch, useAppState } from "../../state/AppStore";
import {
  applyDisplay,
  clickedColumns,
  figureCaps,
  figureHasColumnAxis,
  type BarSort,
  type FigureDisplay,
} from "./figureDisplay";
import { PlotlyFigure } from "./PlotlyFigure";
import { ResultTableView } from "./ResultTableView";
import {
  displayOf,
  resolveView,
  storedViewFor,
  type ToolViewState,
  type WindowView,
} from "./windowView";

const TOP_N_CHOICES = [5, 10, 20, 50] as const;

function MetricTiles({ metrics }: { metrics: Result["metrics"] }) {
  const entries = Object.entries(metrics);
  if (entries.length === 0) return null;
  return (
    <div className="result-metrics">
      {entries.map(([k, v]) => (
        <div key={k} className="result-metric" title={`${k}: ${String(v)}`}>
          <span className="muted">{k}</span>
          <span className="mono">{String(v)}</span>
        </div>
      ))}
    </div>
  );
}

function DisplayControls({
  caps,
  display,
  onChange,
  open,
}: {
  open: boolean;
  caps: ReturnType<typeof figureCaps>;
  display: FigureDisplay;
  onChange: (patch: Partial<FigureDisplay>) => void;
}) {
  if (!caps.sortable && !caps.percent && !caps.log && !caps.annotations) {
    return null;
  }
  return (
    <div
      className="result-display"
      role="group"
      aria-label="Display"
      data-open={open ? "1" : "0"}
    >
      {caps.sortable ? (
        <>
          <select
            aria-label="Sort bars"
            value={display.sort}
            onChange={(e) => onChange({ sort: e.target.value as BarSort })}
          >
            <option value="none">Key order</option>
            <option value="desc">Largest first</option>
            <option value="asc">Smallest first</option>
          </select>
          <select
            aria-label="Show top"
            value={display.topN ?? ""}
            onChange={(e) =>
              onChange({ topN: e.target.value ? Number(e.target.value) : null })
            }
          >
            <option value="">All</option>
            {TOP_N_CHOICES.map((n) => (
              <option key={n} value={n}>
                Top {n}
              </option>
            ))}
          </select>
        </>
      ) : null}
      {caps.percent ? (
        <div className="seg" role="group" aria-label="Values">
          <button
            type="button"
            className={display.percent ? undefined : "on"}
            onClick={() => onChange({ percent: false })}
          >
            Count
          </button>
          <button
            type="button"
            className={display.percent ? "on" : undefined}
            onClick={() => onChange({ percent: true })}
          >
            %
          </button>
        </div>
      ) : null}
      {caps.log ? (
        <label className="chart-check">
          <input
            type="checkbox"
            checked={display.log}
            onChange={(e) => onChange({ log: e.target.checked })}
          />
          Log
        </label>
      ) : null}
      {caps.annotations ? (
        <label className="chart-check">
          <input
            type="checkbox"
            checked={display.annotations}
            onChange={(e) => onChange({ annotations: e.target.checked })}
          />
          Labels
        </label>
      ) : null}
    </div>
  );
}

/**
 * Shared analysis-window frame (MAT-235), generic over any key's Result:
 * headline → the selected figure filling the window → view switcher and
 * display controls → collapsed Details (metric tiles, sortable tables).
 * View, display settings and drawer state are remembered per window.
 */
export function AnalysisResultView({
  result,
  viewKey,
  columns,
  onColumnsClick,
  onOpenChart,
}: {
  result: Result;
  /** Storage key of this window's view state (tool id). */
  viewKey: string;
  /** Dataset column names: click-through targets. */
  columns: readonly string[];
  /** A figure mark naming columns was clicked (`add`: shift / meta). */
  onColumnsClick?: (cols: string[], add: boolean) => void;
  onOpenChart?: () => void;
}) {
  const { toolViews } = useAppState();
  const dispatch = useAppDispatch();
  const state: ToolViewState | undefined = toolViews[viewKey];
  const view = resolveView(result, state?.view);
  const display = displayOf(state);
  const detailsOpen = state?.details === true;
  const patch = (p: ToolViewState) =>
    dispatch({ type: "PATCH_TOOL_VIEW", key: viewKey, patch: p });
  const [displayOpen, setDisplayOpen] = useState(false);
  const select = (v: WindowView) => patch({ view: storedViewFor(result, v) });

  const figure = view.kind === "figure" ? result.figures[view.index] : undefined;
  const caps = useMemo(
    () => (figure ? figureCaps(figure.plotly) : null),
    [figure],
  );
  const shown = useMemo(
    () => (figure && caps ? applyDisplay(figure.plotly, display, caps) : null),
    // `display` is rebuilt each render; its fields are the real inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [figure, caps, display.sort, display.topN, display.percent, display.log, display.annotations],
  );
  const clickable = useMemo(
    () =>
      !!figure && !!onColumnsClick && figureHasColumnAxis(figure.plotly, columns),
    [figure, onColumnsClick, columns],
  );

  const headline = result.headline?.trim();
  const hasTables = result.tables.length > 0;
  const viewId =
    view.kind === "figure" ? `figure:${view.index}` : view.kind;
  const detailBits = [
    Object.keys(result.metrics).length
      ? `${Object.keys(result.metrics).length} metrics`
      : null,
    hasTables && view.kind !== "table"
      ? `${result.tables.length} table${result.tables.length > 1 ? "s" : ""}`
      : null,
  ].filter(Boolean);
  const hasDetails =
    view.kind !== "metrics" &&
    (detailBits.length > 0 || !!result.text);

  return (
    <div className="result-view result-shell" data-view={viewId}>
      {headline ? (
        <p className="result-headline" data-result-headline="" title={headline}>
          {headline}
        </p>
      ) : null}

      <div className="result-main" data-main-view={view.kind}>
        {view.kind === "figure" && figure && shown ? (
          <div
            className={clickable ? "result-figure clickable" : "result-figure"}
            data-figure-title={figure.title}
            title={clickable ? "Click a column to select it in the grid" : undefined}
          >
            <PlotlyFigure
              title={figure.title}
              plotly={shown}
              onPointClick={
                clickable
                  ? (pt, ev) => {
                      const cols = clickedColumns(pt, columns);
                      if (cols.length > 0) {
                        onColumnsClick!(
                          cols,
                          !!ev && (ev.shiftKey || ev.metaKey || ev.ctrlKey),
                        );
                      }
                    }
                  : undefined
              }
            />
          </div>
        ) : null}
        {view.kind === "table" ? (
          <div className="result-tables">
            {result.tables.map((t) => (
              <ResultTableView key={t.title} table={t} />
            ))}
          </div>
        ) : null}
        {view.kind === "metrics" ? (
          <>
            <MetricTiles metrics={result.metrics} />
            {result.text ? <pre className="result-text">{result.text}</pre> : null}
          </>
        ) : null}
      </div>

      {result.figures.length > 0 || onOpenChart ? (
        <div className="result-viewbar">
          {result.figures.length > 0 ? (
            <div className="result-tabs" role="tablist" aria-label="Views">
              {result.figures.map((f, i) => {
                const on = view.kind === "figure" && view.index === i;
                return (
                  <button
                    key={`${f.title}-${i}`}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    className={on ? "result-tab on" : "result-tab"}
                    data-view-tab={`figure:${i}`}
                    title={f.title}
                    onClick={() => select({ kind: "figure", index: i })}
                  >
                    {f.title}
                  </button>
                );
              })}
              {hasTables ? (
                <button
                  type="button"
                  role="tab"
                  aria-selected={view.kind === "table"}
                  className={view.kind === "table" ? "result-tab on" : "result-tab"}
                  data-view-tab="table"
                  onClick={() => select({ kind: "table" })}
                >
                  Table
                </button>
              ) : null}
            </div>
          ) : null}
          {result.figures.length > 0 ? (
            <select
              className="result-view-select"
              aria-label="View"
              data-view-select=""
              value={viewId}
              onChange={(e) => {
                const v = e.target.value;
                select(
                  v === "table"
                    ? { kind: "table" }
                    : { kind: "figure", index: Number(v.split(":")[1]) },
                );
              }}
            >
              {result.figures.map((f, i) => (
                <option key={`${f.title}-${i}`} value={`figure:${i}`}>
                  {f.title}
                </option>
              ))}
              {hasTables ? <option value="table">Table</option> : null}
            </select>
          ) : null}
          {caps ? (
            <>
              <DisplayControls
                caps={caps}
                display={display}
                onChange={(d) => patch({ display: d })}
                open={displayOpen}
              />
              {caps.sortable || caps.percent || caps.log || caps.annotations ? (
                <button
                  type="button"
                  className="chip result-display-toggle"
                  data-display-toggle=""
                  aria-label="Display options"
                  aria-expanded={displayOpen}
                  title="Display options"
                  onClick={() => setDisplayOpen((o) => !o)}
                >
                  ⋯
                </button>
              ) : null}
            </>
          ) : null}
          <span className="result-viewbar-spacer" />
          {onOpenChart ? (
            <button
              type="button"
              className="chip"
              data-open-in-chart=""
              onClick={onOpenChart}
            >
              Open in Chart
            </button>
          ) : null}
        </div>
      ) : null}

      {hasDetails ? (
        <div className="result-details" data-details-open={detailsOpen ? "1" : "0"}>
          <button
            type="button"
            className="result-details-toggle"
            aria-expanded={detailsOpen}
            onClick={() => patch({ details: !detailsOpen })}
          >
            <span className="result-details-caret" aria-hidden="true">
              {detailsOpen ? "▾" : "▸"}
            </span>
            Details
            {detailBits.length ? (
              <span className="muted"> · {detailBits.join(" · ")}</span>
            ) : null}
          </button>
          {detailsOpen ? (
            <div className="result-details-body">
              <MetricTiles metrics={result.metrics} />
              {view.kind !== "table"
                ? result.tables.map((t) => <ResultTableView key={t.title} table={t} />)
                : null}
              {result.text ? <pre className="result-text">{result.text}</pre> : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
