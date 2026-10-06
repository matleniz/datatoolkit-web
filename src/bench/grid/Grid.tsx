import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { apiClient } from "../../api/client";
import type { ColumnProfile, Step } from "../../api/types";
import { useAppDispatch, useAppState } from "../../state/AppStore";
import { colAlerts, isOutlierValue, missPct, profileBars } from "../alerts";
import { cellTone, type DisplayCol, type DisplayRow } from "../diff";
import {
  cellDisplay,
  EMPTY_DATA_ROWS_MSG,
  fmtPreview,
  nameDisplay,
} from "../format";
import { colWidth, isNumericKind, KIND_BAR, KIND_LABEL } from "../kinds";
import { stepSummary } from "../stages";
import { useWorkbenchData } from "../WorkbenchData";
import { columnWindow } from "./columnWindow";
import { dropOrder, planReorder, type ReorderParams } from "./reorderDrag";
import { NoteIcon } from "../notes/NotePopover";
import { GridViewBar } from "./GridViewBar";

type Dispatch = ReturnType<typeof useAppDispatch>;
type Selection = ReturnType<typeof useAppState>["selection"];

function selectionText(selection: Selection): string {
  const n = selection.columns.length;
  if (n > 0) return n === 1 ? "1 column selected" : `${n} columns selected`;
  return selection.row !== null ? "1 row selected" : "Nothing selected";
}

/** Last horizontal scroll with data on screen; survives a grid remount. */
let savedScrollLeft = 0;

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return (
    t.isContentEditable ||
    t.tagName === "INPUT" ||
    t.tagName === "TEXTAREA" ||
    t.tagName === "SELECT"
  );
}

function ColSpacer({ width }: { width: number }) {
  if (width <= 0) return null;
  return <div className="grid-col-spacer" aria-hidden="true" style={{ width }} />;
}

function headerAlerts(c: DisplayCol, pr: ColumnProfile | undefined) {
  if (c.status === "added") return [{ text: "new", tone: "ok" as const }];
  if (c.status === "removed") return [{ text: "removed", tone: "bad" as const }];
  return colAlerts(pr);
}

function cellTip(
  row: DisplayRow,
  c: DisplayCol,
  v: DisplayRow["vals"][string] | undefined,
  outlier: boolean,
): string {
  const tip = `${c.name} = ${fmtPreview(v as never)}`;
  if (row.status === "removed" || c.status === "removed") {
    return `${tip} (removed by this step)`;
  }
  if (row.changed[c.name]) return `${tip} (was ${fmtPreview(row.prev[c.name] as never)})`;
  return outlier ? `${tip} (IQR outlier)` : tip;
}

type DropSide = "before" | "after";
interface ReorderDrag {
  enabled: boolean;
  hint: { col: string; side: DropSide } | null;
  start: (name: string) => void;
  over: (name: string, side: DropSide) => void;
  end: () => void;
  drop: (target: string, side: DropSide) => void;
}

function dropSide(e: React.DragEvent<HTMLElement>): DropSide {
  const r = e.currentTarget.getBoundingClientRect();
  return e.clientX < r.left + r.width / 2 ? "before" : "after";
}

function ColumnHeader({
  c,
  sel,
  isTarget,
  touched,
  profile: pr,
  note,
  dispatch,
  reorder,
}: {
  c: DisplayCol;
  sel: boolean;
  isTarget: boolean;
  touched: boolean;
  profile: ColumnProfile | undefined;
  /** Column note (#152), shown on hover; edited from the column menu. */
  note: string | undefined;
  dispatch: Dispatch;
  reorder: ReorderDrag;
}) {
  const bars = pr ? profileBars(pr, 22) : [];
  const alerts = headerAlerts(c, pr);
  const miss = missPct(pr);
  const barColor = sel ? "#1d5b86" : KIND_BAR[c.kind] ?? "#c9c5ba";
  const hint = reorder.hint?.col === c.name ? reorder.hint.side : null;
  return (
    <button
      type="button"
      className={[
        "grid-th",
        sel ? "selected" : "",
        c.status === "added" ? "added" : "",
        c.status === "removed" ? "removed" : "",
        isTarget || sel ? "accent-top" : "",
        hint ? `drop-${hint}` : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ width: colWidth(c.kind) }}
      aria-label={`${c.name}, ${KIND_LABEL[c.kind] ?? c.kind}`}
      data-agent-touched={touched ? "1" : undefined}
      draggable={reorder.enabled && c.status !== "removed"}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", c.name);
        reorder.start(c.name);
      }}
      onDragOver={(e) => {
        if (!reorder.enabled || c.status === "removed") return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        reorder.over(c.name, dropSide(e));
      }}
      onDrop={(e) => {
        if (!reorder.enabled || c.status === "removed") return;
        e.preventDefault();
        reorder.drop(c.name, dropSide(e));
      }}
      onDragEnd={reorder.end}
      title={`${c.name} · ${KIND_LABEL[c.kind]} · ${pr?.distinct ?? "?"} distinct · ${pr?.missing ?? "?"} missing · right-click for actions · drag to reorder`}
      onClick={(e) =>
        dispatch({
          type: "PICK_COL",
          name: c.name,
          add: e.shiftKey || e.metaKey || e.ctrlKey,
        })
      }
      onContextMenu={(e) => {
        e.preventDefault();
        if (c.status === "removed") return;
        const root = (e.currentTarget as HTMLElement).closest("[data-root]");
        const rc = root?.getBoundingClientRect();
        dispatch({
          type: "OPEN_CTX",
          col: c.name,
          x: rc ? e.clientX - rc.left : e.clientX,
          y: rc ? e.clientY - rc.top : e.clientY,
        });
      }}
    >
      <span className="th-name-row">
        <span className={c.status === "removed" ? "th-name struck" : "th-name"}>
          {nameDisplay(c.name)}
        </span>
        {isTarget ? (
          <svg width="13" height="13" viewBox="0 0 14 14" aria-label="target">
            <circle
              cx="7"
              cy="7"
              r="5.5"
              fill="none"
              stroke="#1d5b86"
              strokeWidth="1.4"
            />
            <circle cx="7" cy="7" r="2" fill="#1d5b86" />
          </svg>
        ) : null}
        {note ? (
          <span className="th-note" role="img" aria-label="Column note" title={note}>
            <NoteIcon filled />
          </span>
        ) : null}
      </span>
      <span className="th-meta">
        <span className="kind-chip">{KIND_LABEL[c.kind] ?? c.kind}</span>
        <span className="miss-label">{miss ? `${miss}% ∅` : ""}</span>
      </span>
      <span className="th-bars">
        {bars.map((b, i) => (
          <span
            key={i}
            title={b.tip}
            style={{
              flex: "1 1 0",
              minWidth: 2,
              height: b.heightPx,
              background: barColor,
              borderRadius: "1px 1px 0 0",
            }}
          />
        ))}
      </span>
      <span className="miss-bar">
        <span style={{ width: `${miss}%` }} />
      </span>
      <span className="th-alerts" aria-hidden="true">
        {alerts.map((a) => (
          <span key={a.text} className={`alert alert-${a.tone}`}>
            {a.text}
          </span>
        ))}
      </span>
    </button>
  );
}

function DataCell({
  row,
  c,
  profile,
  selection,
  touched,
  dispatch,
}: {
  row: DisplayRow;
  c: DisplayCol;
  profile: ColumnProfile | undefined;
  selection: Selection;
  touched: boolean;
  dispatch: Dispatch;
}) {
  const v = row.vals[c.name];
  const csel = selection.cell?.rid === row.rid && selection.cell.col === c.name;
  const outlier = isOutlierValue(profile, v, c.kind);
  const tone = cellTone({
    rowRemoved: row.status === "removed",
    colRemoved: c.status === "removed",
    colAdded: c.status === "added",
    changed: !!row.changed[c.name],
    value: v,
    kind: c.kind,
    isOutlier: outlier,
    rowSelected: selection.row === row.rid,
    colSelected: selection.columns.includes(c.name),
  });
  return (
    <button
      type="button"
      className={[
        "grid-td",
        `tone-${tone}`,
        csel ? "cell-sel" : "",
        isNumericKind(c.kind) ? "num" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ width: colWidth(c.kind) }}
      title={cellTip(row, c, v, outlier)}
      data-agent-touched={touched ? "1" : undefined}
      onClick={() => dispatch({ type: "PICK_CELL", rid: row.rid, col: c.name })}
    >
      {cellDisplay(v as never)}
    </button>
  );
}

function reorderStep(p: ReorderParams): Step {
  return { op: "reorder_columns", target: "both", params: { ...p } };
}

function rowNumClass(selected: boolean, removed: boolean): string {
  if (selected) return "grid-rn on";
  return removed ? "grid-rn removed" : "grid-rn";
}

/** W2 — data grid with horizontally windowed columns (MAT-152). */
export function Grid() {
  const { selection, targetColumn, benchError, editor, agentTouch, role } = useAppState();
  const dispatch = useAppDispatch();
  const {
    display,
    profiles,
    total,
    isLatest,
    pendingStep,
    pendingDiffText,
    preview,
    applyPending,
    version,
    loading,
    hasMore,
    loadMore,
    reportVisibleColumns,
    identity,
    rowsIdentity,
    columnNotes,
  } = useWorkbenchData();

  const { workspace } = useAppState();
  const steps = workspace?.steps ?? [];
  const viewLabel = (() => {
    if (isLatest) return "";
    if (version === 0) return "sources";
    const step = steps[version - 1];
    if (!step) return `v${version}`;
    return `v${version} · ${step.op}`;
  })();

  const editIndex = editor?.editIndex;
  const editLabel =
    editIndex === undefined ? "" : `v${editIndex + 1} · ${steps[editIndex]?.op ?? ""}`;

  const totalW =
    44 + display.cols.reduce((w, c) => w + colWidth(c.kind), 0);

  const selText = selectionText(selection);

  const dragRef = useRef<string | null>(null);
  const [hint, setHint] = useState<ReorderDrag["hint"]>(null);
  const busyRef = useRef(false);
  const latest = useRef({ workspace, role, display, dispatch });
  latest.current = { workspace, role, display, dispatch };
  const reorderOn =
    isLatest &&
    editIndex === undefined &&
    !pendingStep &&
    !loading &&
    !!workspace;

  const commitReorder = useCallback(
    async (name: string, target: string, side: DropSide) => {
      if (busyRef.current) return;
      busyRef.current = true;
      try {
        const {
          workspace: ws,
          role: r,
          display: d,
          dispatch: dp,
        } = latest.current;
        if (!ws) return;
        // A "removed" column (diff of the last step) is not in the frame.
        const order = d.cols.filter((c) => c.status !== "removed").map((c) => c.name);
        const wanted = dropOrder(order, name, target, side);
        if (!wanted) return;
        const n = ws.steps.length;
        const last = ws.steps[n - 1];
        if (
          last?.op === "reorder_columns" &&
          last.target === "both" &&
          !last.align
        ) {
          // Fold into the last step: plan from the frame that step received.
          const before = await apiClient.workspaceRows(ws, r, n - 1, 0, 1);
          if (latest.current.workspace !== ws) return;
          const plan = planReorder(
            before.columns.map((c) => c.name),
            wanted,
          );
          if (plan === "identity") {
            dp({ type: "REMOVE_STEP", index: n - 1 });
            return;
          }
          if (plan) {
            dp({ type: "REPLACE_STEP", index: n - 1, step: reorderStep(plan) });
            return;
          }
        }
        const plan = planReorder(order, wanted);
        if (plan && plan !== "identity") {
          dp({ type: "ADD_STEP", step: reorderStep(plan) });
        }
      } catch (e) {
        latest.current.dispatch({
          type: "SET_BENCH_ERROR",
          message: e instanceof Error ? e.message : String(e),
        });
      } finally {
        busyRef.current = false;
      }
    },
    [],
  );

  const reorder: ReorderDrag = {
    enabled: reorderOn,
    hint,
    start: (name) => {
      dragRef.current = name;
    },
    over: (col, side) => {
      if (!dragRef.current || dragRef.current === col) {
        if (hint) setHint(null);
        return;
      }
      if (hint?.col !== col || hint.side !== side) setHint({ col, side });
    },
    end: () => {
      dragRef.current = null;
      setHint(null);
    },
    drop: (col, side) => {
      const name = dragRef.current;
      dragRef.current = null;
      setHint(null);
      if (name) void commitReorder(name, col, side);
    },
  };

  const rowNum = new Map<number, number>();
  display.rows.forEach((r, i) => rowNum.set(r.rid, i + 1));

  const scrollRef = useRef<HTMLDivElement>(null);
  const stateTouchRef = useRef(agentTouch);
  stateTouchRef.current = agentTouch;
  const [scrollLeft, setScrollLeft] = useState(0);
  const [viewportW, setViewportW] = useState(0);

  const measureViewport = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setScrollLeft(el.scrollLeft);
    setViewportW(el.clientWidth);
  }, []);

  useEffect(() => {
    measureViewport();
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measureViewport());
    ro.observe(el);
    return () => ro.disconnect();
  }, [measureViewport, display.cols.length]);

  const windowed = useMemo(
    () => columnWindow(display.cols, scrollLeft, Math.max(0, viewportW - 44)),
    [display.cols, scrollLeft, viewportW],
  );

  useEffect(() => {
    reportVisibleColumns(windowed.visible.map((c) => c.name));
  }, [windowed.visible, reportVisibleColumns]);

  // Undo / redo re-renders the frame; the browser clamps scrollLeft to 0 while
  // the content is momentarily narrower. Put the user's position back.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || display.cols.length === 0) return;
    if (el.scrollLeft !== savedScrollLeft && savedScrollLeft > 0) {
      el.scrollLeft = savedScrollLeft;
      setScrollLeft(el.scrollLeft);
    }
  }, [display.cols]);

  const hasSelection =
    selection.columns.length > 0 ||
    selection.row !== null ||
    selection.cell !== null;
  const ctxOpen = useAppState().ctx !== null;
  useEffect(() => {
    if (!hasSelection || ctxOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (isTypingTarget(e.target)) return;
      dispatch({ type: "CLEAR_SELECTION" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hasSelection, ctxOpen, dispatch]);

  // Bring what the agent picked into view (a rid on a page not loaded stays out).
  const touchAt = agentTouch?.at;
  useEffect(() => {
    const el = scrollRef.current;
    const touch = stateTouchRef.current;
    if (!el || !touch) return;
    const rid = touch.cells[0]?.rid ?? touch.rows[0];
    if (rid === undefined) return;
    el.querySelector(`[data-rid="${rid}"]`)?.scrollIntoView?.({ block: "nearest" });
    const col = touch.cells[0]?.column;
    if (col === undefined) return;
    let left = 0;
    for (const c of display.cols) {
      if (c.name === col) {
        const w = colWidth(c.kind);
        if (left < el.scrollLeft || left + w > el.scrollLeft + el.clientWidth - 44) {
          el.scrollLeft = Math.max(0, left - 44);
        }
        break;
      }
      left += colWidth(c.kind);
    }
    // Only a new touch scrolls, not later data changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [touchAt]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollWidth > el.clientWidth) savedScrollLeft = el.scrollLeft;
    setScrollLeft(el.scrollLeft);
    if (!hasMore) return;
    const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (remaining < 240) loadMore();
  }, [hasMore, loadMore]);

  return (
    <div className="grid-shell" data-owner="W2">
      <div className="grid-toolbar">
        <span className="grid-sel-text">{selText}</span>
        {hasSelection ? (
          <button
            type="button"
            className="chip"
            title="Clear the selection (Esc)"
            onClick={() => dispatch({ type: "CLEAR_SELECTION" })}
          >
            Clear
          </button>
        ) : null}
        {loading && display.rows.length > 0 ? (
          <span className="grid-inline-loading" aria-live="polite">
            Updating…
          </span>
        ) : null}
        <button
          type="button"
          className={selection.multi ? "chip on" : "chip"}
          aria-pressed={selection.multi}
          onClick={() => dispatch({ type: "TOGGLE_MULTI" })}
        >
          Multi-select {selection.multi ? "on" : "off"}
        </button>
        <span className="grid-hint">
          Right-click a header for its menu · shift-click adds columns
        </span>
        <div className="grid-spacer" />
        <span className="grid-legend">
          <span>
            <i className="swatch missing" /> missing / -999
          </span>
          <span>
            <i className="swatch outlier" /> outlier
          </span>
          <span>
            <i className="swatch changed" /> changed
          </span>
          <span>
            <i className="swatch new" /> new
          </span>
          <span>
            <i className="swatch removed" /> removed
          </span>
        </span>
      </div>

      <GridViewBar />

      {pendingStep && preview ? (
        <div className="banner preview-banner" role="status">
          <span className="banner-kicker">Live preview</span>
          <span className="banner-code">
            {stepSummary(pendingStep.op, pendingStep.params)}
          </span>
          <span className="banner-delta">{pendingDiffText}</span>
          <div className="banner-spacer" />
          <button
            type="button"
            className="btn-secondary"
            onClick={() => dispatch({ type: "CLOSE_EDITOR" })}
          >
            Discard
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={applyPending}
          >
            Apply step
          </button>
        </div>
      ) : null}

      {editIndex !== undefined ? (
        <div className="banner travel-banner" role="status" data-edit-banner="">
          <span className="banner-kicker travel">Editing step</span>
          <span>
            <strong>{editLabel}</strong> · the grid shows the step&apos;s input
            frame. Apply replaces the step and replays the later ones.
          </span>
        </div>
      ) : null}

      {!isLatest && editIndex === undefined ? (
        <div className="banner travel-banner" role="status">
          <span className="banner-kicker travel">Time travel</span>
          <span>
            Viewing <strong>{viewLabel}</strong> · read-only. Later steps are
            kept.
          </span>
          <div className="banner-spacer" />
          <button
            type="button"
            className="btn-secondary"
            onClick={() =>
              dispatch({ type: "SET_VIEW_VERSION", version: null })
            }
          >
            Back to latest
          </button>
        </div>
      ) : null}

      {benchError ? (
        <div className="banner error-banner" role="alert">
          {benchError}
        </div>
      ) : null}

      <div
        className="grid"
        aria-label="Data grid"
        data-identity={rowsIdentity ?? ""}
        data-identity-current={identity.key}
        data-col-window={`${windowed.start}:${windowed.end}/${display.cols.length}`}
        ref={scrollRef}
        onScroll={onScroll}
      >
        {loading && display.rows.length === 0 ? (
          <div className="grid-more">Loading rows…</div>
        ) : null}
        {!loading && total === 0 && display.cols.length > 0 ? (
          <div
            className="grid-empty-state"
            role="status"
            data-empty-rows="1"
            aria-label={EMPTY_DATA_ROWS_MSG}
          >
            {EMPTY_DATA_ROWS_MSG}
          </div>
        ) : null}
        <div className="grid-inner" style={{ width: totalW, minWidth: "100%" }}>
          <div className="grid-header-row">
            <div className="grid-corner" />
            <ColSpacer width={windowed.leftPad} />
            {windowed.visible.map((c) => (
              <ColumnHeader
                key={c.name}
                c={c}
                sel={selection.columns.includes(c.name)}
                isTarget={c.name === targetColumn}
                touched={!!agentTouch?.columns.includes(c.name)}
                profile={profiles.get(c.name)}
                note={columnNotes.notes[c.name]}
                dispatch={dispatch}
                reorder={reorder}
              />
            ))}
            <ColSpacer width={windowed.rightPad} />
          </div>

          {display.rows.map((row) => {
            const num = rowNum.get(row.rid) ?? 0;
            return (
              <div
                key={row.rid}
                className="grid-row"
                data-rid={row.rid}
                data-agent-touched={
                  agentTouch?.rows.includes(row.rid) ? "1" : undefined
                }
              >
                <button
                  type="button"
                  className={rowNumClass(
                    selection.row === row.rid,
                    row.status === "removed",
                  )}
                  aria-label={`Select row ${num}`}
                  onClick={() => dispatch({ type: "PICK_ROW", rid: row.rid })}
                >
                  {num}
                </button>
                <ColSpacer width={windowed.leftPad} />
                {windowed.visible.map((c) => (
                  <DataCell
                    key={c.name}
                    row={row}
                    c={c}
                    profile={profiles.get(c.name)}
                    selection={selection}
                    touched={
                      !!agentTouch?.cells.some(
                        (t) => t.rid === row.rid && t.column === c.name,
                      )
                    }
                    dispatch={dispatch}
                  />
                ))}
                <ColSpacer width={windowed.rightPad} />
              </div>
            );
          })}
        </div>
        {total > display.rows.length ? (
          <div className="grid-more">
            Showing {display.rows.length} of {total} rows
            {hasMore ? " · scroll for more" : ""}
          </div>
        ) : total > 0 ? (
          <div className="grid-more">
            {total} row{total === 1 ? "" : "s"}
          </div>
        ) : null}
      </div>
    </div>
  );
}
