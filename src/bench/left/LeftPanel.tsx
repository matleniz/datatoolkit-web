import { useAppState } from "../../state/AppStore";
import { PanelToggle } from "../PanelToggle";
import { SuggestionsTab } from "./SuggestionsTab";
import "./LeftPanel.css";

/** W3 — left panel: Suggestions only, collapsible (MAT-231 / MAT-232). */
export function LeftPanel() {
  const { sugCount, panels } = useAppState();
  const collapsed = panels.left;

  return (
    <aside
      className={collapsed ? "left-panel collapsed" : "left-panel"}
      aria-label="Suggestions"
      data-owner="W3"
    >
      {collapsed ? (
        <PanelToggle
          side="left"
          collapsed
          label="suggestions"
          badge={sugCount}
        />
      ) : null}
      {/* Keep mounted so analysis keys run and the badge stays current. */}
      <div className="left-body" hidden={collapsed}>
        <div className="left-head">
          <span className="left-title" data-sug-count={sugCount}>
            {`Suggestions · ${sugCount}`}
          </span>
          <PanelToggle side="left" collapsed={false} label="suggestions" />
        </div>
        <div className="left-scroll">
          <SuggestionsTab />
        </div>
      </div>
    </aside>
  );
}
