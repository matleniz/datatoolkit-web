import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { BusyIndicator } from "../../BusyIndicator";
import { apiClient } from "../../api/client";
import {
  CANCELLED_MESSAGE,
  type ColumnProfile,
  type Step,
  type WorkspaceRow,
} from "../../api/types";
import { useAppDispatch, useAppState } from "../../state/AppStore";
import { gridViewKey } from "../../state/gridView";
import {
  colAlerts,
  isOutlierValue,
  missPct,
  profileBars,
  qualityShares,
  qualityTip,
} from "../alerts";
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
import { rowNumWidth, viewport } from "./rowWindow";
import { useRowPages } from "./useRowPages";
import { dropOrder, planReorder, type ReorderParams } from "./reorderDrag";
import { NoteIcon } from "../notes/NotePopover";
import { GridViewBar } from "./GridViewBar";
import { PendingRegion, Skeleton, SkeletonRow } from "../../placeholder/Skeleton";

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

/** Column widths of the placeholders: the real ones, else a plausible set. */
function placeholderWidths(cols: DisplayCol[]): number[] {
  return cols.length > 0
    ? cols.map((c) => colWidth(c.kind))
    : Array.from({ length: SKELETON_FALLBACK_COLS }, () => colWidth("number"));
}

/**
 * Header cells while the column list itself is awaited: keeps the 100px header
 * band in place, so the rows do not drop by that much when the columns arrive.
 */
function GridSkeletonHeader() {
  return (
    <>
      {placeholderWidths([]).map((w, i) => (
        <span key={i} className="sk-grid-th" style={{ width: w }} aria-hidden="true">
          <Skeleton width="60%" height={12} />
          <Skeleton width={36} height={12} />
          <Skeleton height={22} />
        </span>
      ))}
    </>
  );
}

/** Placeholder rows: the box of a real row, so nothing moves when rows arrive. */
function GridSkeletonRows({ cols, leftPad }: { cols: DisplayCol[]; leftPad: number }) {
  const widths = placeholderWidths(cols);
  return (
    <PendingRegion label="Loading rows">
      {Array.from({ length: SKELETON_ROWS }, (_, r) => (
        <SkeletonRow
          key={r}
          className="sk-grid-row"
          cellClassName="sk-grid-td"
          height="var(--dtk-grid-row-h)"
          seed={r}
          lead={
            <>
              <span className="sk-grid-rn" />
              <ColSpacer width={leftPad} />
            </>
          }
          widths={widths}
        />
      ))}
    </PendingRegion>
  );
}

function GridFooter({
  skeleton,
  shown,
  total,
  hasMore,
}: {
  skeleton: boolean;
  shown: number;
  total: number;
  hasMore: boolean;
}) {
  if (skeleton) {
    return (
      <div className="grid-more" aria-hidden="true">
        <Skeleton width={96} height={10} />
      </div>
    );
  }
  if (total > shown) {
    return (
      <div className="grid-more">
        Showing {shown} of {total} rows
        {hasMore ? " · scroll for more" : ""}
      </div>
    );
  }
  if (total > 0) {
    return (
      <div className="grid-more">
        {total} row{total === 1 ? "" : "s"}
      </div>
    );
  }
  return null;
}

/** The header histograms shimmer from the rows' arrival until the profiles land. */
function profilesPending(o: {
  loading: boolean;
  benchError: string | null | undefined;
  profilesIdentity: string | null;
  identityKey: string;
}): boolean {
  return !o.loading && !o.benchError && o.profilesIdentity !== o.identityKey;
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

export function ColumnHeader({
  c,
  sel,
  isTarget,
  touched,
  profile: pr,
  note,
  profilePending,
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
  /** The profile is awaited: the histogram and quality bar shimmer in place. */
  profilePending: boolean;
  dispatch: Dispatch;
  reorder: ReorderDrag;
}) {
  const bars = pr ? profileBars(pr, 22) : [];
  const alerts = headerAlerts(c, pr);
  const miss = missPct(pr);
  const quality = qualityShares(pr);
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
      title={`${c.name} · ${KIND_LABEL[c.kind]} · ${pr?.approximate?.includes("distinct") ? "≈" : ""}${pr?.distinct ?? "?"} distinct · ${pr?.missing ?? "?"} missing · right-click for actions · drag to reorder`}
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
        <span
          className="kind-chip"
          title={
            c.approximate?.includes("kind")
              ? "Kind computed on the whole table, not on the rows shown (approximate)"
              : undefined
          }
        >
          {KIND_LABEL[c.kind] ?? c.kind}
          {c.approximate?.includes("kind") ? <span className="approx-mark"> ≈</span> : null}
        </span>
        <span className="miss-label">{miss ? `${miss}% ∅` : ""}</span>
      </span>
      <span className="th-bars">
        {profilePending ? (
          <Skeleton height={14} />
        ) : (
          bars.map((b, i) => (
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
          ))
        )}
      </span>
      <span className="miss-bar" title={profilePending ? undefined : qualityTip(quality)}>
        {profilePending ? (
          <Skeleton height={4} radius={2} />
        ) : (
          <>
            <span className="q-valid" style={{ width: `${quality.validPct}%` }} />
            <span
              className="q-mismatched"
              style={{ width: `${quality.mismatchedPct}%` }}
            />
            <span
              className="q-missing"
              style={{ width: `${quality.missingPct}%` }}
            />
          </>
        )}
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

/** `missing_ok`: a drag orders what exists in each split (the target or a train-only column is absent from the test frame). */
function reorderStep(p: ReorderParams): Step {
  return {
    op: "reorder_columns",
    target: "both",
    params: { ...p, missing_ok: true },
  };
}

function rowNumClass(selected: boolean, removed: boolean): string {
  if (selected) return "grid-rn on";
  return removed ? "grid-rn removed" : "grid-rn";
}

/** Height reserved under the windowed rows for the position line. */
const WINDOW_FOOTER_PX = 28;

/** A row whose page is still on its way: the box of a real row. */
function WindowRowPlaceholder({
  index,
  widths,
  leftPad,
}: {
  index: number;
  widths: number[];
  leftPad: number;
}) {
  return (
    <SkeletonRow
      className="sk-grid-row"
      cellClassName="sk-grid-td"
      height="var(--dtk-grid-row-h)"
      seed={index}
      lead={
        <>
          <span className="sk-grid-rn" />
          <ColSpacer width={leftPad} />
        </>
      }
      widths={widths}
    />
  );
}

/**
 * Continuous-scroll rows of a very large CSV (#329): only the rows under the
 * viewport are mounted, their pages are fetched with a look-ahead and a
 * bounded set stays in memory. A row whose page is missing is a placeholder
 * with the box of a real row, so the scrollbar and the layout never move.
 */
function WindowedBody({
  scrollRef,
  cols,
  leftPad,
  rightPad,
  total,
  seed,
  resetKey,
  enabled,
  profiles,
  selection,
  agentTouch,
  dispatch,
}: {
  scrollRef: React.RefObject<HTMLDivElement>;
  cols: DisplayCol[];
  leftPad: number;
  rightPad: number;
  total: number;
  seed: WorkspaceRow[];
  resetKey: string;
  enabled: boolean;
  profiles: Map<string, ColumnProfile>;
  selection: Selection;
  agentTouch: ReturnType<typeof useAppState>["agentTouch"];
  dispatch: Dispatch;
}) {
  const { workspace, role, gridView } = useAppState();
  const { version } = useWorkbenchData();
  const [geo, setGeo] = useState({ scrollTop: 0, clientH: 0, headerPx: 101 });
  const lastFirst = useRef(0);
  const dir = useRef<1 | -1>(1);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const read = () => {
      const headerPx =
        el.querySelector<HTMLElement>(".grid-header-row")?.offsetHeight ?? 101;
      setGeo((g) =>
        g.scrollTop === el.scrollTop &&
        g.clientH === el.clientHeight &&
        g.headerPx === headerPx
          ? g
          : { scrollTop: el.scrollTop, clientH: el.clientHeight, headerPx },
      );
    };
    read();
    el.addEventListener("scroll", read, { passive: true });
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(read);
    ro?.observe(el);
    return () => {
      el.removeEventListener("scroll", read);
      ro?.disconnect();
    };
  }, [scrollRef]);

  // A new sort / filter is a new list: back to its first row.
  const prevReset = useRef(resetKey);
  useEffect(() => {
    if (prevReset.current === resetKey) return;
    prevReset.current = resetKey;
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [resetKey, scrollRef]);

  const pages = useRowPages({
    workspace: workspace!,
    role,
    version,
    view: gridView,
    total,
    enabled,
    seed,
    resetKey,
    onError: (message) => dispatch({ type: "SET_BENCH_ERROR", message }),
  });

  const windowPx = Math.max(0, geo.clientH - geo.headerPx - WINDOW_FOOTER_PX);
  const vp = viewport(geo.scrollTop, windowPx, total);
  if (vp.first !== lastFirst.current) {
    dir.current = vp.first > lastFirst.current ? 1 : -1;
    lastFirst.current = vp.first;
  }
  const { want } = pages;
  const { first, end } = vp;
  useEffect(() => {
    want(first, end, dir.current);
  }, [want, first, end]);

  const widths = placeholderWidths(cols);
  const out: React.ReactNode[] = [];
  let missing = false;
  for (let i = first; i < end; i++) {
    const r = pages.row(i);
    if (!r) {
      missing = true;
      out.push(
        <WindowRowPlaceholder key={i} index={i} widths={widths} leftPad={leftPad} />,
      );
      continue;
    }
    const row: DisplayRow = {
      rid: r._rid,
      vals: r,
      prev: r,
      status: "",
      changed: {},
    };
    out.push(
      <div
        key={i}
        className="grid-row"
        data-rid={row.rid}
        data-row-index={i}
        data-agent-touched={agentTouch?.rows.includes(row.rid) ? "1" : undefined}
      >
        <button
          type="button"
          className={rowNumClass(selection.row === row.rid, false)}
          aria-label={`Select row ${i + 1}`}
          onClick={() => dispatch({ type: "PICK_ROW", rid: row.rid })}
        >
          {i + 1}
        </button>
        <ColSpacer width={leftPad} />
        {cols.map((c) => (
          <DataCell
            key={c.name}
            row={row}
            c={c}
            profile={profiles.get(c.name)}
            selection={selection}
            touched={
              !!agentTouch?.cells.some((t) => t.rid === row.rid && t.column === c.name)
            }
            dispatch={dispatch}
          />
        ))}
        <ColSpacer width={rightPad} />
      </div>,
    );
  }

  return (
    <>
      <div
        className="grid-vbody"
        data-window={`${first}:${end}/${total}`}
        data-pages={pages.loadedPages().length}
        style={{ height: vp.bodyPx }}
      >
        <div
          className="grid-vwindow"
          style={{ top: geo.headerPx, height: windowPx }}
        >
          <div
            className="grid-vrows"
            style={{ transform: `translateY(${-vp.offsetPx}px)` }}
          >
            {out}
          </div>
        </div>
      </div>
      <div className="grid-vfooter" style={{ height: WINDOW_FOOTER_PX }}>
        <span className="grid-vfooter-text">
          Rows {(first + 1).toLocaleString("en-US")}–{end.toLocaleString("en-US")} of{" "}
          {total.toLocaleString("en-US")}
        </span>
        <span className="sr-only" role="status" aria-live="polite">
          {missing ? "Loading rows" : ""}
        </span>
      </div>
    </>
  );
}

/** Placeholder rows shown while the first page of rows is awaited. */
const SKELETON_ROWS = 14;
/** Placeholder columns when the column list itself is not known yet. */
const SKELETON_FALLBACK_COLS = 6;

/** W2 — data grid with horizontally windowed columns (MAT-152). */
/** The bench load error; a user Cancel reads as a neutral notice (#250). */
function BenchErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  if (message === CANCELLED_MESSAGE) {
    return (
      <div className="banner" role="status">
        {message}
      </div>
    );
  }
  return (
    <div className="banner error-banner" role="alert">
      {message}
    </div>
  );
}

export function Grid() {
  const { selection, targetColumn, benchError, editor, agentTouch, role, gridView } =
    useAppState();
  const dispatch = useAppDispatch();
  const {
    display,
    profiles,
    total,
    isLatest,
    pendingStep,
    pendingDiffText,
    preview,
    previewLoading,
    applyPending,
    version,
    loading,
    hasMore,
    loadMore,
    windowed: isWindowed,
    rows: seedRows,
    rowsGridKey,
    reportVisibleColumns,
    identity,
    rowsIdentity,
    columnNotes,
    profileSample,
    profilesIdentity,
  } = useWorkbenchData();
  // Rows are in but the profiles of this view are still on their way.
  const profilesAwaited = profilesPending({ loading, benchError, profilesIdentity, identityKey: identity.key });

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

  // A 7-digit row number needs more than the usual 44px column.
  const rnW = isWindowed ? rowNumWidth(total) : 44;
  const totalW =
    rnW + display.cols.reduce((w, c) => w + colWidth(c.kind), 0);

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
    () => columnWindow(display.cols, scrollLeft, Math.max(0, viewportW - rnW)),
    [display.cols, scrollLeft, viewportW, rnW],
  );

  // Rows not loaded yet: placeholder rows with the real row height and column
  // widths, so the header and the scroll width do not move when rows arrive.
  const showSkeleton = loading && display.rows.length === 0;

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
        if (left < el.scrollLeft || left + w > el.scrollLeft + el.clientWidth - rnW) {
          el.scrollLeft = Math.max(0, left - rnW);
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
        <BusyIndicator scope="frame" label="Loading rows…" />
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

      {profileSample ? (
        <div className="banner sample-banner" role="status" data-profile-sample="">
          <span className="banner-kicker">Sampled profile</span>
          <span>
            Quality bars and column stats cover{" "}
            {(profileSample.nRowsSource - profileSample.nSampledOut).toLocaleString("en-US")} of{" "}
            {profileSample.nRowsSource.toLocaleString("en-US")} rows (
            {profileSample.nSampledOut.toLocaleString("en-US")} not profiled). The grid
            still pages through every row.
          </span>
        </div>
      ) : null}

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
            disabled={previewLoading}
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

      <BenchErrorBanner message={benchError} />

      <div
        className="grid"
        aria-label="Data grid"
        aria-busy={loading}
        // Placeholder rows hold nothing focusable: keep the scroll area reachable by keyboard.
        tabIndex={showSkeleton || isWindowed ? 0 : undefined}
        data-identity={rowsIdentity ?? ""}
        data-identity-current={identity.key}
        data-col-window={`${windowed.start}:${windowed.end}/${display.cols.length}`}
        ref={scrollRef}
        onScroll={onScroll}
        style={isWindowed ? ({ "--dtk-grid-rn-w": `${rnW}px` } as React.CSSProperties) : undefined}
      >
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
                profilePending={profilesAwaited && !profiles.has(c.name)}
                dispatch={dispatch}
                reorder={reorder}
              />
            ))}
            <ColSpacer width={windowed.rightPad} />
            {showSkeleton && display.cols.length === 0 ? <GridSkeletonHeader /> : null}
          </div>

          {isWindowed ? (
            <WindowedBody
              scrollRef={scrollRef}
              cols={windowed.visible}
              leftPad={windowed.leftPad}
              rightPad={windowed.rightPad}
              total={total}
              seed={seedRows}
              resetKey={`${rowsIdentity ?? ""}|${rowsGridKey ?? ""}`}
              enabled={
                rowsIdentity === identity.key && rowsGridKey === gridViewKey(gridView)
              }
              profiles={profiles}
              selection={selection}
              agentTouch={agentTouch}
              dispatch={dispatch}
            />
          ) : null}
          {(isWindowed ? [] : display.rows).map((row) => {
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
          {showSkeleton ? (
            <GridSkeletonRows cols={windowed.visible} leftPad={windowed.leftPad} />
          ) : null}
        </div>
        {isWindowed ? null : <GridFooter skeleton={showSkeleton} shown={display.rows.length} total={total} hasMore={hasMore} />}
      </div>
    </div>
  );
}
