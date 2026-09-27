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
  const { leftTab, workspace } = useAppState();
  const dispatch = useAppDispatch();
  const nSteps = workspace?.steps.length ?? 0;
  // Badge count is refreshed inside SuggestionsTab; show step count for recipe.
  const nSug = 0;

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
              onClick={() => dispatch({ type: "SET_LEFT_TAB", tab: t.id })}
            >
              {t.label(nSug, nSteps)}
            </button>
          );
        })}
      </div>
      <div className="left-scroll">
        {leftTab === "vars" ? <VariablesTab /> : null}
        {leftTab === "suggestions" ? <SuggestionsTab /> : null}
        {leftTab === "recipe" ? <RecipeTab /> : null}
      </div>
    </aside>
  );
}
