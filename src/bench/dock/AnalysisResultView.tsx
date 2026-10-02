import { useLayoutEffect, useMemo, useRef, useState } from "react";

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
import { shouldFoldTabs } from "./viewbarFold";
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
}: {
  caps: ReturnType<typeof figureCaps>;
  display: FigureDisplay;
  onChange: (patch: Partial<FigureDisplay>) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!caps.sortable && !caps.percent && !caps.log && !caps.annotations) {
    return null;
  }
  return (
    <>
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
    <button
      type="button"
      className="chip result-display-toggle"
      data-display-toggle=""
      aria-label="Display options"
      aria-expanded={open}
      title="Display options"
      onClick={() => setOpen((o) => !o)}
    >
      ⋯
    </button>
    </>
  );
}

type Figure = Result["figures"][number];

/** The figure filling the window; marks naming columns can select them. */
function FigureMain({
  figure,
  shown,
  columns,
  onColumnsClick,
}: {
  figure: Figure;
  shown: Figure["plotly"];
  columns: readonly string[];
  onColumnsClick?: (cols: string[], add: boolean) => void;
}) {
  const clickable =
    !!onColumnsClick && figureHasColumnAxis(figure.plotly, columns);
  return (
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
                  onColumnsClick(
                    cols,
                    !!ev && (ev.shiftKey || ev.metaKey || ev.ctrlKey),
                  );
                }
              }
            : undefined
        }
      />
    </div>
  );
}

/** Figure tabs + select: one entry per figure, plus Table when present. */
function ViewSwitcher({
  result,
  viewId,
  select,
}: {
  result: Result;
  viewId: string;
  select: (v: WindowView) => void;
}) {
  const hasTables = result.tables.length > 0;
  const tabs: { id: string; label: string; view: WindowView }[] = [
    ...result.figures.map((f, i) => ({
      id: `figure:${i}`,
      label: f.title,
      view: { kind: "figure", index: i } as WindowView,
    })),
    ...(hasTables
      ? [{ id: "table", label: "Table", view: { kind: "table" } as WindowView }]
      : []),
  ];
  return (
    <>
      <div className="result-tabs" role="tablist" aria-label="Views">
        {tabs.map((t) => {
          const on = t.id === viewId;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={on}
              className={on ? "result-tab on" : "result-tab"}
              data-view-tab={t.id}
              title={t.id === "table" ? undefined : t.label}
              onClick={() => select(t.view)}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <select
        className="result-view-select"
        aria-label="View"
        data-view-select=""
        value={viewId}
        onChange={(e) =>
          select(tabs.find((t) => t.id === e.target.value)!.view)
        }
      >
        {tabs.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
      </select>
    </>
  );
}

/** Collapsed drawer: metric tiles, tables not already shown, text. */
function Details({
  result,
  open,
  bits,
  showTables,
  onToggle,
}: {
  result: Result;
  open: boolean;
  bits: unknown[];
  showTables: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="result-details" data-details-open={open ? "1" : "0"}>
      <button
        type="button"
        className="result-details-toggle"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className="result-details-caret" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
        Details
        {bits.length ? <span className="muted"> · {bits.join(" · ")}</span> : null}
      </button>
      {open ? (
        <div className="result-details-body">
          <MetricTiles metrics={result.metrics} />
          {showTables
            ? result.tables.map((t) => <ResultTableView key={t.title} table={t} />)
            : null}
          {result.text ? <pre className="result-text">{result.text}</pre> : null}
        </div>
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
  const storedDisplay = state?.display;
  const display = useMemo(
    () => displayOf({ display: storedDisplay }),
    [storedDisplay],
  );
  const detailsOpen = state?.details === true;
  const patch = (p: ToolViewState) =>
    dispatch({ type: "PATCH_TOOL_VIEW", key: viewKey, patch: p });
  const select = (v: WindowView) => patch({ view: storedViewFor(result, v) });

  const figure = view.kind === "figure" ? result.figures[view.index] : undefined;
  const caps = useMemo(
    () => (figure ? figureCaps(figure.plotly) : null),
    [figure],
  );
  const shown = useMemo(
    () => (figure && caps ? applyDisplay(figure.plotly, display, caps) : null),
    [figure, caps, display],
  );

  const headline = result.headline?.trim();
  const nMetrics = Object.keys(result.metrics).length;
  const nTables = result.tables.length;
  const showTables = nTables > 0 && view.kind !== "table";
  const viewId = view.kind === "figure" ? `figure:${view.index}` : view.kind;
  const detailBits = [
    nMetrics ? `${nMetrics} metrics` : null,
    showTables ? `${nTables} table${nTables > 1 ? "s" : ""}` : null,
  ].filter(Boolean);
  const hasDetails =
    view.kind !== "metrics" && (detailBits.length > 0 || !!result.text);

  const barRef = useRef<HTMLDivElement>(null);
  const [foldTabs, setFoldTabs] = useState(false);
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const measure = () => {
      const tabs = bar.querySelector<HTMLElement>(".result-tabs");
      if (!tabs) return setFoldTabs(false);
      const others = Array.from(bar.children)
        .filter(
          (c) =>
            c !== tabs &&
            !c.matches(".result-view-select, .result-viewbar-spacer"),
        )
        .map((c) => (c as HTMLElement).offsetWidth);
      setFoldTabs(shouldFoldTabs(bar.clientWidth, tabs.scrollWidth, others));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(bar);
    return () => ro.disconnect();
  }, [result.figures.length, nTables, !!caps, !!onOpenChart]);

  return (
    <div className="result-view result-shell" data-view={viewId}>
      {headline ? (
        <p className="result-headline" data-result-headline="" title={headline}>
          {headline}
        </p>
      ) : null}

      <div className="result-main" data-main-view={view.kind}>
        {figure && shown ? (
          <FigureMain
            figure={figure}
            shown={shown}
            columns={columns}
            onColumnsClick={onColumnsClick}
          />
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
        <div
          className="result-viewbar"
          ref={barRef}
          data-fold={foldTabs ? "1" : undefined}
        >
          {result.figures.length > 0 ? (
            <ViewSwitcher result={result} viewId={viewId} select={select} />
          ) : null}
          {caps ? (
            <DisplayControls
              caps={caps}
              display={display}
              onChange={(d) => patch({ display: d })}
            />
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
        <Details
          result={result}
          open={detailsOpen}
          bits={detailBits}
          showTables={showTables}
          onToggle={() => patch({ details: !detailsOpen })}
        />
      ) : null}
    </div>
  );
}
