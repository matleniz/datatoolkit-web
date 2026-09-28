import type { CSSProperties, DragEvent } from "react";

import { useAppDispatch, useAppState } from "../../state/AppStore";
import type { DockPos, DockSize, ToolId } from "../../state/reducer";
import { DOCK_SIZES, toolDef } from "../toolrail/tools";
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

function DockWindow({ id }: { id: ToolId }) {
  const { dock } = useAppState();
  const dispatch = useAppDispatch();
  const def = toolDef(id);
  const wide = !!dock.wide[id] && dock.pos === "bottom" && !dock.maximized;
  const maximized = dock.maximized === id;

  const onDragStart = (e: DragEvent) => {
    dispatch({ type: "DRAG_TOOL", id });
    try {
      e.dataTransfer.setData("text/plain", id);
      e.dataTransfer.effectAllowed = "move";
    } catch {
      /* ignore */
    }
  };

  return (
    <section
      className={wide ? "dock-window wide" : "dock-window"}
      aria-label={def.label}
      data-tool={id}
    >
      <div
        className="dock-titlebar"
        data-drag="1"
        draggable
        onDragStart={onDragStart}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          dispatch({ type: "DROP_TOOL", id });
        }}
      >
        <GripIcon />
        <span className="dock-win-title">{def.label}</span>
        <span className="dock-key mono">{def.key}</span>
        <span className="dock-title-spacer" />
        <button
          type="button"
          aria-label="Move window earlier"
          title="Move earlier"
          className="dock-icon-btn"
          onClick={() => dispatch({ type: "MOVE_TOOL", id, delta: -1 })}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path
              d="M7.5 2.5 4 6l3.5 3.5"
              fill="none"
              stroke="#5b5850"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <button
          type="button"
          aria-label="Move window later"
          title="Move later"
          className="dock-icon-btn"
          onClick={() => dispatch({ type: "MOVE_TOOL", id, delta: 1 })}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path
              d="M4.5 2.5 8 6 4.5 9.5"
              fill="none"
              stroke="#5b5850"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <button
          type="button"
          aria-label="Toggle wide"
          title={wide ? "Normal width" : "Span two columns"}
          className="dock-icon-btn"
          onClick={() => dispatch({ type: "TOGGLE_WIDE", id })}
        >
          <svg width="14" height="12" viewBox="0 0 14 12" aria-hidden="true">
            <path
              d="M1 6h12M4 3 1 6l3 3M10 3l3 3-3 3"
              fill="none"
              stroke="#5b5850"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
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
        <DockWindowBody id={id} />
      </div>
    </section>
  );
}

/** W3 — analysis tool dock. */
export function Dock() {
  const { dock } = useAppState();
  const dispatch = useAppDispatch();

  if (!dock.tools.length) return null;

  const visible =
    dock.maximized && dock.tools.includes(dock.maximized)
      ? [dock.maximized]
      : dock.tools;

  const right = dock.pos === "right";
  const sizes = DOCK_SIZES[dock.size];
  const maximized = !!dock.maximized && visible.length > 0;
  const span = visible.reduce(
    (a, id) => a + (dock.wide[id] && dock.pos === "bottom" && !maximized ? 2 : 1),
    0,
  );

  const style: CSSProperties = maximized
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

  const winsStyle: CSSProperties =
    right || maximized
      ? {
          gridTemplateColumns: "minmax(0, 1fr)",
          gridAutoRows: "minmax(0, 1fr)",
        }
      : {
          gridTemplateColumns: `repeat(${Math.max(1, span)}, minmax(0, 1fr))`,
        };

  return (
    <section
      className={
        right
          ? "dock dock-right"
          : maximized
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
        <span className="muted">Drag a title bar to reorder</span>
      </div>
      <div className="dock-wins" style={winsStyle}>
        {visible.map((id) => (
          <DockWindow key={id} id={id} />
        ))}
      </div>
    </section>
  );
}
