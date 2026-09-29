import {
  useLayoutEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import GridLayout, {
  type Layout,
  type ResizeHandleAxis,
} from "react-grid-layout";

import { useAppDispatch, useAppState } from "../../state/AppStore";
import type { DockPos, DockSize, ToolId } from "../../state/reducer";
import { DOCK_SIZES, toolDef } from "../toolrail/tools";
import { ChartDockBody } from "./ChartDockBody";
import { DOCK_GRID, dockRowHeight, toGridItems } from "./dockLayout";
import { DockWindowBody } from "./DockWindowBody";
import "./Dock.css";

function GripIcon() {
  return (
    <svg width="10" height="14" viewBox="0 0 10 14" aria-hidden="true">
      <g fill="#a8a499">
        <circle cx="3" cy="3" r="1.2" />
        <circle cx="7" cy="3" r="1.2" />
        <circle cx="3" cy="7" r="1.2" />
        <circle cx="7" cy="7" r="1.2" />
        <circle cx="3" cy="11" r="1.2" />
        <circle cx="7" cy="11" r="1.2" />
      </g>
    </svg>
  );
}

/** Client size of an element (callback ref), tracked with a ResizeObserver. */
function useElementSize<T extends HTMLElement>(): [
  (el: T | null) => void,
  { width: number; height: number },
] {
  const [el, setEl] = useState<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    if (!el) return;
    const measure = () =>
      setSize((prev) =>
        prev.width === el.clientWidth && prev.height === el.clientHeight
          ? prev
          : { width: el.clientWidth, height: el.clientHeight },
      );
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, size];
}

function DockWindow({ id }: { id: ToolId }) {
  const { dock } = useAppState();
  const dispatch = useAppDispatch();
  const def = toolDef(id);
  const maximized = dock.maximized === id;
  const [ref, size] = useElementSize<HTMLElement>();
  // MAT-246: headline is 1 line when window height is < 300px, 2 lines otherwise.
  const isCompactHeight =
    size.height > 0 ? size.height < 300 : !maximized && dock.size !== "L";

  return (
    <section
      ref={ref}
      className={`dock-window${isCompactHeight ? " compact-h" : ""}`}
      data-compact-h={isCompactHeight ? "1" : "0"}
      aria-label={def.label}
      data-tool={id}
    >
      <div className="dock-titlebar" data-drag="1" title="Drag to move">
        <GripIcon />
        <span className="dock-win-title">{def.label}</span>
        <span className="dock-key mono">{def.key}</span>
        <span className="dock-title-spacer" />
        <button
          type="button"
          aria-label="Maximize or restore"
          title={maximized ? "Restore" : "Maximize"}
          className="dock-icon-btn"
          onClick={() =>
            dispatch({
              type: "SET_MAXIMIZED",
              id: maximized ? null : id,
            })
          }
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <rect
              x="1.5"
              y="1.5"
              width="9"
              height="9"
              rx="1"
              fill="none"
              stroke="#5b5850"
              strokeWidth="1.4"
            />
          </svg>
        </button>
        <button
          type="button"
          aria-label="Close window"
          className="dock-icon-btn"
          onClick={() => dispatch({ type: "TOGGLE_TOOL", id })}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path
              d="M2 2l6 6M8 2l-6 6"
              stroke="#5b5850"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
      <div className="dock-body">
        {id === "chart" ? <ChartDockBody /> : <DockWindowBody id={id} />}
      </div>
    </section>
  );
}

const GRID_MARGIN = 10;
const DRAG_CONFIG = { handle: ".dock-titlebar", cancel: "button" };
const RESIZE_CONFIG = { handles: ["se", "e", "s"] as ResizeHandleAxis[] };

/**
 * W3 — analysis tool dock. Windows live on a snap-to-grid layout
 * (react-grid-layout, MAT-234): drag the title bar to move, the corner or
 * right / bottom edge to resize; windows never overlap and float up.
 */
export function Dock() {
  const { dock } = useAppState();
  const dispatch = useAppDispatch();
  const [winsRef, winsSize] = useElementSize<HTMLDivElement>();

  const maximizedId =
    dock.maximized && dock.tools.includes(dock.maximized)
      ? dock.maximized
      : null;
  const pos = dock.pos;
  const items = useMemo(
    () => toGridItems(dock.layouts, pos, dock.tools),
    [dock.layouts, pos, dock.tools],
  );
  const children = useMemo(
    () =>
      dock.tools.map((id) => (
        <div key={id} className="dock-cell">
          <DockWindow id={id} />
        </div>
      )),
    [dock.tools],
  );

  if (!dock.tools.length) return null;

  const right = pos === "right";
  const sizes = DOCK_SIZES[dock.size];

  const style: CSSProperties = maximizedId
    ? { flexGrow: 1, minHeight: 0 }
    : right
      ? {
          width: sizes.right,
          // Prototype widths (S/M/L) but never steal more than half the
          // centre area — at M the grid must stay ≈≥50%.
          maxWidth: "50%",
          flexShrink: 0,
          minHeight: 0,
          minWidth: 0,
        }
      : { height: sizes.bottom, flexShrink: 0 };

  const onLayoutDone = (layout: Layout) =>
    dispatch({
      type: "SET_DOCK_LAYOUT",
      pos,
      items: layout.map(({ i, x, y, w, h }) => ({ i, x, y, w, h })),
    });

  return (
    <section
      className={
        right
          ? "dock dock-right"
          : maximizedId
            ? "dock dock-max"
            : "dock dock-bottom"
      }
      style={style}
      aria-label="Tool dock"
      data-owner="W3"
    >
      <div className="dock-chrome">
        <span className="dock-chrome-label">Windows</span>
        <div role="group" aria-label="Dock position" className="seg">
          {(["bottom", "right"] as DockPos[]).map((p) => (
            <button
              key={p}
              type="button"
              className={dock.pos === p ? "on" : undefined}
              onClick={() => dispatch({ type: "SET_DOCK_POS", pos: p })}
            >
              {p === "bottom" ? "Bottom" : "Right"}
            </button>
          ))}
        </div>
        <div role="group" aria-label="Dock size" className="seg">
          {(["S", "M", "L"] as DockSize[]).map((s) => (
            <button
              key={s}
              type="button"
              className={dock.size === s ? "on" : undefined}
              onClick={() => dispatch({ type: "SET_DOCK_SIZE", size: s })}
            >
              {s}
            </button>
          ))}
        </div>
        <span className="muted dock-hint">
          Drag a title bar to move, a corner or edge to resize
        </span>
      </div>
      <div
        ref={winsRef}
        className={maximizedId ? "dock-wins dock-wins-max" : "dock-wins"}
      >
        {maximizedId ? (
          <DockWindow id={maximizedId} />
        ) : winsSize.width > 0 ? (
          <GridLayout
            className="dock-grid"
            width={winsSize.width}
            layout={items}
            gridConfig={{
              cols: DOCK_GRID[pos].cols,
              rowHeight: dockRowHeight(winsSize.height, pos, GRID_MARGIN),
              margin: [GRID_MARGIN, GRID_MARGIN],
              containerPadding: [0, 0],
            }}
            dragConfig={DRAG_CONFIG}
            resizeConfig={RESIZE_CONFIG}
            onDragStop={onLayoutDone}
            onResizeStop={onLayoutDone}
          >
            {children}
          </GridLayout>
        ) : null}
      </div>
    </section>
  );
}
