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

/**
 * Target column name as it appears on the labeled frame.
 * - `target_column` on train X (column-of-X mode)
 * - y-file join: the label value column (churn fixture → `churn`; most
 *   contest CSVs → `target`). Keys that split by the label (`by`, or
 *   `by_label`+`target`) must use this name — the front does not rename.
 */
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
