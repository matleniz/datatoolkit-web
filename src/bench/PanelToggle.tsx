import { useAppDispatch } from "../state/AppStore";
import type { PanelSide } from "../state/panelStorage";

/** Chevron pointing where the panel goes when toggled. */
function glyph(side: PanelSide, collapsed: boolean): string {
  const towardsEdge = side === "left" ? "‹" : "›";
  const awayFromEdge = side === "left" ? "›" : "‹";
  return collapsed ? awayFromEdge : towardsEdge;
}

/** Collapse / expand button for a side panel (MAT-232). */
export function PanelToggle({
  side,
  collapsed,
  label,
  disabledReason,
  badge,
}: {
  side: PanelSide;
  collapsed: boolean;
  /** Tooltip name, e.g. "suggestions". Not in the aria-label: e2e locate panels by label. */
  label: string;
  /** Set when collapsing is blocked (unapplied step edit). */
  disabledReason?: string;
  badge?: number;
}) {
  const dispatch = useAppDispatch();
  const blocked = !collapsed && !!disabledReason;
  const verb = collapsed ? "Expand" : "Collapse";
  const text = `${verb} ${label}`;
  return (
    <button
      type="button"
      className={`panel-toggle ${side}${collapsed ? " strip" : ""}`}
      aria-label={`${verb} ${side} panel`}
      aria-expanded={!collapsed}
      title={blocked ? disabledReason : text}
      disabled={blocked}
      onClick={() =>
        dispatch({ type: "SET_PANEL_COLLAPSED", side, collapsed: !collapsed })
      }
    >
      <span aria-hidden="true">{glyph(side, collapsed)}</span>
      {collapsed && badge ? (
        <span className="panel-toggle-badge">{badge}</span>
      ) : null}
    </button>
  );
}
