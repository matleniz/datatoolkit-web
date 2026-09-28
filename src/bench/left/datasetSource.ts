import type { Workspace } from "../../api/types";

// Analysis-key sources are built from a DataIdentity (`identitySource` in
// ../dataIdentity) so they always carry the viewed version (MAT-175).

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
