import { useState } from "react";

import { useAppDispatch, useAppState } from "../../state/AppStore";
import {
  addCondition,
  buildCondition,
  buildFacetCondition,
  conditionText,
  EMPTY_GRID_VIEW,
  FILTER_OPS,
  isGridViewActive,
  opIsList,
  opNeedsValue,
  removeCondition,
  valueFacets,
  type FilterOp,
} from "../../state/gridView";
import { isNumericKind } from "../kinds";
import { useWorkbenchData } from "../WorkbenchData";

function FilterDialog({ initial }: { initial: string }) {
  const { gridView, workspace } = useAppState();
  const dispatch = useAppDispatch();
  const { columns, profiles } = useWorkbenchData();
  const [column, setColumn] = useState(initial);
  const [op, setOp] = useState<FilterOp>("eq");
  const [raw, setRaw] = useState("");
  const kind =
    columns.find((c) => c.name === column)?.kind ?? profiles.get(column)?.kind;
  const profile = profiles.get(column);
  const facets = valueFacets(profile?.top_values, profile?.distinct ?? 0);
  const [ticked, setTicked] = useState<{ column: string; at: number[] }>({
    column,
    at: [],
  });
  const tickedAt = ticked.column === column ? ticked.at : [];
  const useFacets = opIsList(op) && tickedAt.length > 0;
  const cond = useFacets
    ? buildFacetCondition(
        column,
        op as "isin" | "notin",
        tickedAt.map((i) => facets.items[i]!.value),
      )
    : buildCondition(column, op, raw, isNumericKind(kind));
  const toggle = (i: number) => {
    const at = tickedAt.includes(i)
      ? tickedAt.filter((j) => j !== i)
      : [...tickedAt, i].sort((a, b) => a - b);
    setTicked({ column, at });
    if (at.length > 0 && !opIsList(op)) setOp("isin");
  };
  const close = () => dispatch({ type: "CLOSE_GRID_FILTER" });
  const apply = () => {
    if (!cond || !workspace) return;
    dispatch({ type: "SET_GRID_VIEW", view: addCondition(gridView, cond) });
    close();
  };
  return (
    <form
      className="grid-filter-form"
      aria-label="Filter rows (view only)"
      onSubmit={(e) => {
        e.preventDefault();
        apply();
      }}
    >
      <select
        aria-label="Filter column"
        value={column}
        onChange={(e) => setColumn(e.target.value)}
      >
        {columns.map((c) => (
          <option key={c.name} value={c.name}>
            {c.name}
          </option>
        ))}
      </select>
      <select
        aria-label="Filter operator"
        value={op}
        onChange={(e) => setOp(e.target.value as FilterOp)}
      >
        {FILTER_OPS.map((o) => (
          <option key={o.op} value={o.op}>
            {o.label}
          </option>
        ))}
      </select>
      {opNeedsValue(op) && !useFacets ? (
        <input
          aria-label="Filter value"
          autoFocus
          value={raw}
          placeholder={opIsList(op) ? "a, b, c" : "value"}
          onChange={(e) => setRaw(e.target.value)}
        />
      ) : null}
      {facets.items.length > 0 ? (
        <fieldset className="grid-facets">
          <legend>Values of {column}</legend>
          {facets.items.map((t, i) => (
            <label key={`${String(t.value)}-${i}`} className="grid-facet">
              <input
                type="checkbox"
                checked={tickedAt.includes(i)}
                onChange={() => toggle(i)}
              />
              <span className="grid-facet-value">{String(t.value)}</span>
              <span className="grid-facet-count">{t.count}</span>
            </label>
          ))}
          {facets.hidden > 0 ? (
            <p className="grid-facets-note" data-facets-truncated="">
              Showing the {facets.items.length} most frequent of{" "}
              {facets.items.length + facets.hidden} distinct values.
            </p>
          ) : null}
        </fieldset>
      ) : null}
      <button type="submit" className="btn-primary" disabled={!cond}>
        Apply to view
      </button>
      <button type="button" className="btn-secondary" onClick={close}>
        Cancel
      </button>
    </form>
  );
}

/**
 * View-only filter / sort strip above the grid (datatoolkit-issues#81).
 * Nothing here is a pipeline step; "Make it a step" copies the filter into a
 * `filter_rows` step with the same params.
 */
export function GridViewBar() {
  const { gridView, gridFilterColumn, editor, role } = useAppState();
  const dispatch = useAppDispatch();
  const { total, totalUnfiltered, isLatest } = useWorkbenchData();
  const active = isGridViewActive(gridView);
  if (!active && gridFilterColumn === null) return null;

  const filter = gridView.filter;
  const canStep = !!filter && isLatest && !editor;
  const makeStep = () => {
    if (!filter) return;
    dispatch({
      type: "ADD_STEP",
      step: {
        op: "filter_rows",
        target: role,
        params: { conditions: filter.conditions, combine: filter.combine },
      },
    });
    dispatch({ type: "SET_GRID_VIEW", view: { ...gridView, filter: null } });
  };

  return (
    <div className="banner view-banner" role="status" data-grid-view="">
      <span className="banner-kicker view">View only</span>
      <span className="view-note">not a step</span>
      {filter?.conditions.map((c, i) => (
        <span key={`${conditionText(c)}-${i}`} className="chip on view-chip">
          {conditionText(c)}
          <button
            type="button"
            aria-label={`Remove filter ${conditionText(c)}`}
            onClick={() =>
              dispatch({
                type: "SET_GRID_VIEW",
                view: removeCondition(gridView, i),
              })
            }
          >
            ×
          </button>
        </span>
      ))}
      {filter && filter.conditions.length > 1 ? (
        <button
          type="button"
          className="chip"
          aria-label="Combine conditions"
          onClick={() =>
            dispatch({
              type: "SET_GRID_VIEW",
              view: {
                ...gridView,
                filter: {
                  ...filter,
                  combine: filter.combine === "and" ? "or" : "and",
                },
              },
            })
          }
        >
          {filter.combine.toUpperCase()}
        </button>
      ) : null}
      {gridView.sort.map((s) => (
        <span key={s.column} className="chip on view-chip">
          sort {s.column} {s.desc ? "↓" : "↑"}
          <button
            type="button"
            aria-label={`Remove sort ${s.column}`}
            onClick={() =>
              dispatch({
                type: "SET_GRID_VIEW",
                view: { ...gridView, sort: [] },
              })
            }
          >
            ×
          </button>
        </span>
      ))}
      {filter ? (
        <span className="banner-delta" data-view-count="">
          {total} of {totalUnfiltered} rows
        </span>
      ) : null}
      {gridFilterColumn !== null ? <FilterDialog initial={gridFilterColumn} /> : null}
      <div className="banner-spacer" />
      {canStep ? (
        <button
          type="button"
          className="btn-secondary"
          title="Add this filter to the pipeline as a filter_rows step"
          onClick={makeStep}
        >
          Make it a step
        </button>
      ) : null}
      {active ? (
        <button
          type="button"
          className="btn-secondary"
          onClick={() =>
            dispatch({ type: "SET_GRID_VIEW", view: EMPTY_GRID_VIEW })
          }
        >
          Clear view
        </button>
      ) : null}
    </div>
  );
}
