import type { AppAction, ToolId } from "../../state/reducer";

export type RailToolId = ToolId | "transform";

/** Opens the step picker in the workbench right panel. */
export function openStepPicker(dispatch: (action: AppAction) => void) {
  dispatch({ type: "OPEN_EDITOR", op: null });
}

export interface ToolDef {
  id: RailToolId;
  label: string;
  key: string;
  ariaLabel: string;
  title: string;
}

export const TOOLS: ToolDef[] = [
  {
    id: "transform",
    label: "Transform",
    key: "transform",
    ariaLabel: "Transform",
    title: "Transform · add step",
  },
  {
    id: "compare",
    label: "Compare columns",
    key: "column_distribution",
    ariaLabel: "Compare columns",
    title: "Compare selected columns",
  },
  {
    id: "corr",
    label: "Correlation matrix",
    key: "correlations",
    ariaLabel: "Correlation matrix",
    title: "Correlation matrix · correlations",
  },
  {
    id: "dist",
    label: "Distribution",
    key: "column_distribution",
    ariaLabel: "Distribution",
    title: "Distribution · column_distribution",
  },
  {
    id: "missing",
    label: "Missing values",
    key: "missing_values",
    ariaLabel: "Missing values",
    title: "Missing values · missing_values",
  },
  {
    id: "outliers",
    label: "Outliers",
    key: "outliers",
    ariaLabel: "Outliers",
    title: "Outliers · outliers",
  },
  {
    id: "target",
    label: "Target analysis",
    key: "target_analysis",
    ariaLabel: "Target analysis",
    title: "Target analysis · target_analysis",
  },
  {
    id: "drift",
    label: "Train vs test",
    key: "train_test_check",
    ariaLabel: "Train versus test",
    title: "Train vs test · train_test_check",
  },
  {
    id: "feature_selection",
    label: "Feature selection",
    key: "feature_selection",
    ariaLabel: "Feature selection",
    title: "Feature selection · feature_selection",
  },
  {
    id: "chart",
    label: "Chart",
    key: "chart",
    ariaLabel: "Chart",
    title: "Chart · chart",
  },
];

export const DOCK_SIZES = {
  S: { bottom: 220, right: 340 },
  M: { bottom: 340, right: 440 },
  L: { bottom: 440, right: 600 },
} as const;

export function toolDef(id: RailToolId): ToolDef {
  return TOOLS.find((t) => t.id === id)!;
}
