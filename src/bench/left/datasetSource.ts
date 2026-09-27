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
  return workspace.datasets.train.target_column ?? null;
}
