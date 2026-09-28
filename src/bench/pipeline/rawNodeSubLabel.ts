import type { MergeSpec, Workspace } from "../../api/types";

function sourceBasename(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

/** Whether a merge applies to the pipeline role shown in the bar. */
export function mergeAppliesToRole(
  merge: MergeSpec,
  role: "train" | "test",
): boolean {
  if (role === "train") {
    // train | both (any merge that touches train)
    return merge.apply_to === "train" || merge.apply_to === "both";
  }
  // test: apply_to "both" (or "test" if ever used)
  return merge.apply_to === "both" || merge.apply_to === "test";
}

/**
 * Raw (sources) pipeline node sub-label built from the workspace.
 * e.g. `train X + y + customers_extra.csv`,
 *      `train X · target churn`,
 *      `test X + customers_extra.csv · dec ","`
 */
export function rawNodeSubLabel(
  workspace: Workspace,
  role: "train" | "test",
): string {
  const parts: string[] = [role === "train" ? "train X" : "test X"];

  if (role === "train") {
    if (workspace.datasets.train.y?.path) {
      parts.push(" + y");
    } else if (workspace.datasets.train.target_column) {
      parts.push(` · target ${workspace.datasets.train.target_column}`);
    }
  }

  for (const merge of workspace.merges ?? []) {
    if (!mergeAppliesToRole(merge, role)) continue;
    const name = sourceBasename(merge.source.path);
    parts.push(` + ${name}`);
  }

  if (
    role === "test" &&
    workspace.datasets.test?.x?.kind === "csv" &&
    workspace.datasets.test.x.decimal === ","
  ) {
    parts.push(' · dec ","');
  }

  return parts.join("");
}
