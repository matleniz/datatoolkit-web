import { AgentRailButton } from "../agent/panel/AgentRailButton";
import { useAppDispatch, useAppState } from "../../state/AppStore";
import type { ToolId } from "../../state/reducer";
import { TOOLS, openStepPicker, type RailToolId } from "./tools";
import "./ToolRail.css";

function ToolIcon({ id }: { id: RailToolId }) {
  switch (id) {
    case "transform":
      return (
        <svg
          width="20"
          height="20"
          viewBox="0 0 20 20"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 17l9-9" />
          <path d="M14 4l2 2" />
          <path
            d="M12 2.5l.8 1.7 1.7.8-1.7.8-.8 1.7-.8-1.7-1.7-.8 1.7-.8.8-1.7z"
            fill="currentColor"
            stroke="none"
          />
          <circle cx="16.5" cy="9.5" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="7.5" cy="3.5" r="1.2" fill="currentColor" stroke="none" />
        </svg>
      );
    case "compare":
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <rect x="2.5" y="3" width="6" height="14" rx="1" />
          <rect x="11.5" y="3" width="6" height="14" rx="1" />
          <path d="M4.5 13v2M6.5 9v6M13.5 11v4M15.5 7v8" />
        </svg>
      );
    case "corr":
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="2.5" y="2.5" width="6" height="6" rx="1" />
          <rect x="11.5" y="2.5" width="6" height="6" rx="1" fill="currentColor" fillOpacity="0.35" />
          <rect x="2.5" y="11.5" width="6" height="6" rx="1" fill="currentColor" fillOpacity="0.35" />
          <rect x="11.5" y="11.5" width="6" height="6" rx="1" />
        </svg>
      );
    case "dist":
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M3 17V11M7 17V6M11 17V3M15 17V9M2 17.5h16" />
        </svg>
      );
    case "missing":
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="2.5" y="3" width="15" height="14" rx="1.5" />
          <path d="M2.5 7.7h15M2.5 12.3h15M7.5 3v14M12.5 3v14" />
          <rect x="7.5" y="7.7" width="5" height="4.6" fill="currentColor" fillOpacity="0.45" stroke="none" />
        </svg>
      );
    case "outliers":
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M3 10h3M11 10h3" />
          <rect x="6" y="6.5" width="5" height="7" rx="1" />
          <circle cx="17" cy="10" r="1.4" fill="currentColor" />
        </svg>
      );
    case "target":
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="10" cy="10" r="7" />
          <circle cx="10" cy="10" r="3.5" />
          <circle cx="10" cy="10" r="0.8" fill="currentColor" />
        </svg>
      );
    case "drift":
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 7h12l-3-3M17 13H5l3 3" />
        </svg>
      );
    case "feature_selection":
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 4h14l-5.5 6.5v5l-3 1.5v-6.5L3 4z" />
        </svg>
      );
    case "dataset_overview":
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3.5" width="14" height="13" rx="1.5" />
          <path d="M3 8h14M8 8v8.5" />
        </svg>
      );
    case "duplicates":
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
          <rect x="3" y="3" width="9" height="9" rx="1.5" />
          <rect x="8" y="8" width="9" height="9" rx="1.5" />
        </svg>
      );
    case "inconsistencies":
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 3.5l7 12.5H3L10 3.5z" />
          <path d="M10 8.5v3.5" />
          <circle cx="10" cy="14" r="0.6" fill="currentColor" />
        </svg>
      );
    case "preprocessing_advisor":
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 5h10M5 10h10M5 15h6" />
          <path d="M14 14l1.5 1.5L18 12.5" />
        </svg>
      );
    case "chart":
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 16.5V4.5M3 16.5h14" />
          <path d="M6 12l3-3 2.5 2.5L15 6" />
          <circle cx="6" cy="12" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="9" cy="9" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="11.5" cy="11.5" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="15" cy="6" r="1.2" fill="currentColor" stroke="none" />
        </svg>
      );
  }
}

/** W3 — analysis tool rail (56px). */
export function ToolRail() {
  const { dock, editor } = useAppState();
  const dispatch = useAppDispatch();

  return (
    <nav className="tool-rail" aria-label="Analysis tools" data-owner="W3">
      <span className="tool-rail-label">Tools</span>
      {TOOLS.map((t) => {
        if (t.id === "transform") {
          const on = Boolean(editor);
          return (
            <button
              key={t.id}
              type="button"
              className={on ? "tool-btn on" : "tool-btn"}
              aria-label={t.ariaLabel}
              aria-pressed={on}
              title={t.title}
              onClick={() => {
                if (editor?.op === null) {
                  dispatch({ type: "CLOSE_EDITOR" });
                } else {
                  openStepPicker(dispatch);
                }
              }}
            >
              <ToolIcon id={t.id} />
            </button>
          );
        }
        const toolId = t.id as ToolId;
        const on = dock.tools.includes(toolId);
        return (
          <button
            key={toolId}
            type="button"
            className={on ? "tool-btn on" : "tool-btn"}
            aria-label={t.ariaLabel}
            aria-pressed={on}
            title={t.title}
            onClick={() => dispatch({ type: "TOGGLE_TOOL", id: toolId })}
          >
            <ToolIcon id={toolId} />
          </button>
        );
      })}
      <span className="tool-rail-sep" aria-hidden="true" />
      <AgentRailButton />
    </nav>
  );
}
