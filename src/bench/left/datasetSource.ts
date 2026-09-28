import type { DatasetSource, Workspace } from "../../api/types";

/** SourceSpec pointing at a saved workspace dataset (for analysis keys). */
export function datasetSource(
  workspace: Workspace,
  role: "train" | "test" = "train",
  labeled = true,
): DatasetSource {
  return {
    kind: "dataset",
    workspace: workspace.name,
    role,
    labeled,
  };
}

export function targetColumnOf(workspace: Workspace): string | null {
  if (workspace.datasets.train.target_column) {
    return workspace.datasets.train.target_column;
  }
  // y-file workspaces: engine joins the label column(s); "target" is the
  // conventional name on the Parkinson fixture and many contest CSVs.
  if (workspace.datasets.train.y) {
    return workspace.name === "churn" ? "churn" : "target";
  }
  return null;
}
