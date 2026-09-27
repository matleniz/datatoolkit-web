import { useAppDispatch, useAppState } from "../../state/AppStore";
import type { LeftTab } from "../../state/reducer";
import { RecipeTab } from "./RecipeTab";
import { SuggestionsTab } from "./SuggestionsTab";
import { VariablesTab } from "./VariablesTab";
import "./LeftPanel.css";

const TABS: { id: LeftTab; label: (nSug: number, nSteps: number) => string }[] =
  [
    { id: "vars", label: () => "Variables" },
    {
      id: "suggestions",
      label: (n) => `Suggestions · ${n}`,
    },
    { id: "recipe", label: (_s, n) => `Recipe · ${n}` },
  ];

/** W3 — left tabs (Variables / Suggestions / Recipe), 280px. */
export function LeftPanel() {
  const { leftTab, workspace, sugCount } = useAppState();
  const dispatch = useAppDispatch();
  const nSteps = workspace?.steps.length ?? 0;

  return (
    <aside
      className="left-panel"
      aria-label="Variables, suggestions and recipe"
      data-owner="W3"
    >
      <div className="left-tabs" role="tablist">
        {TABS.map((t) => {
          const on = leftTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={on}
              className={on ? "left-tab on" : "left-tab"}
              data-sug-count={t.id === "suggestions" ? sugCount : undefined}
              onClick={() => dispatch({ type: "SET_LEFT_TAB", tab: t.id })}
            >
              {t.label(sugCount, nSteps)}
            </button>
          );
        })}
      </div>
      <div className="left-scroll">
        {leftTab === "vars" ? <VariablesTab /> : null}
        {/* Keep mounted so analysis keys run and the badge stays current. */}
        <div
          hidden={leftTab !== "suggestions"}
          aria-hidden={leftTab !== "suggestions"}
        >
          <SuggestionsTab />
        </div>
        {leftTab === "recipe" ? <RecipeTab /> : null}
      </div>
    </aside>
  );
}
