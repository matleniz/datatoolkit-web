import { useAppDispatch, useAppState } from "../../state/AppStore";
import { STAGE_COLOR } from "./suggestions";

const OP_STAGE: Record<string, keyof typeof STAGE_COLOR> = {
  parse_dates: "import",
  cast: "import",
  rename: "import",
  drop_duplicates: "clean",
  replace_sentinels: "clean",
  standardize_text: "clean",
  impute: "clean",
  clip: "clean",
  drop_columns: "select",
  onehot: "transform",
  ordinal: "transform",
  scale: "transform",
  log1p: "transform",
  formula: "custom",
};

const OP_TITLE: Record<string, string> = {
  parse_dates: "Parse dates",
  cast: "Cast",
  rename: "Rename",
  drop_duplicates: "Drop duplicates",
  replace_sentinels: "Replace sentinels",
  standardize_text: "Standardize text",
  impute: "Impute",
  clip: "Clip",
  drop_columns: "Drop columns",
  onehot: "One-hot",
  ordinal: "Ordinal",
  scale: "Scale",
  log1p: "Log1p",
  formula: "Formula",
};

const FIT_OPS = new Set([
  "impute",
  "scale",
  "onehot",
  "ordinal",
  "clip",
  "formula",
  "log1p",
]);

function subLabel(op: string, params: Record<string, unknown>): string {
  if (op === "formula") return String(params.name ?? params.expr ?? "");
  if (op === "drop_columns" && Array.isArray(params.columns)) {
    return (params.columns as string[]).join(", ");
  }
  if (typeof params.column === "string") return params.column;
  if (Array.isArray(params.columns)) {
    return (params.columns as string[]).slice(0, 3).join(", ");
  }
  return JSON.stringify(params).slice(0, 40);
}

export function RecipeTab() {
  const { workspace, viewVersion } = useAppState();
  const dispatch = useAppDispatch();
  const steps = workspace?.steps ?? [];
  const last = steps.length;
  const nFit = steps.filter(
    (st) => FIT_OPS.has(st.op) && st.target !== "test",
  ).length;
  const leakText = steps.length
    ? `${nFit} fitted step${nFit !== 1 ? "s" : ""} learned on train and replayed on test. Nothing is refitted on test.`
    : "No step yet.";

  return (
    <div className="left-tab-body">
      <p className="left-help">
        The recipe, in replay order. Click a step to see the data after it.
      </p>
      <div className="recipe-list">
        {steps.map((st, i) => {
          const ver = i + 1;
          const on = viewVersion === ver;
          const stage = OP_STAGE[st.op] ?? "transform";
          const badge =
            st.target +
            (FIT_OPS.has(st.op) ? " · fit" : "") +
            (st.align ? " · align" : "");
          return (
            <button
              key={`${st.op}-${i}`}
              type="button"
              className={on ? "recipe-item on" : "recipe-item"}
              style={{ borderLeftColor: STAGE_COLOR[stage] }}
              onClick={() =>
                dispatch({
                  type: "SET_VIEW_VERSION",
                  version: ver === last ? null : ver,
                })
              }
            >
              <span className="recipe-row">
                <span className="mono muted">v{ver}</span>
                <span className="recipe-title">
                  {OP_TITLE[st.op] ?? st.op}
                </span>
                <span className="recipe-badge muted">{badge}</span>
              </span>
              <span className="muted recipe-sub">{subLabel(st.op, st.params)}</span>
            </button>
          );
        })}
      </div>
      <div className="leak-line">{leakText}</div>
    </div>
  );
}
