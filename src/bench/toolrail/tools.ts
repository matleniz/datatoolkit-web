import type { ToolId } from "../../state/reducer";

export interface ToolDef {
  id: ToolId;
  label: string;
  key: string;
  ariaLabel: string;
  title: string;
}

export const TOOLS: ToolDef[] = [
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
];

export const DOCK_SIZES = {
  S: { bottom: 190, right: 340 },
  M: { bottom: 270, right: 440 },
  L: { bottom: 400, right: 600 },
} as const;

export function toolDef(id: ToolId): ToolDef {
  return TOOLS.find((t) => t.id === id)!;
}
