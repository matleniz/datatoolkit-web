import { describe, expect, it } from "vitest";
import { resolvePreviewTarget } from "../src/screens/sources/useSourcesPreview";
import type {
  SourceFileItem,
  WorkspaceBuildResult,
} from "../src/screens/sources/sourcesLogic";

/** datatoolkit-issues#199 — the label column with steps already in the pipeline. */
const file = (id: string, cols: string[]): SourceFileItem => ({
  id,
  name: `${id}.csv`,
  path: `/x/${id}.csv`,
  cols,
  spec: { kind: "csv", path: `/x/${id}.csv` },
  rowCount: 10,
});

const files = [file("x", ["Index", "cohort", "age"]), file("y", ["Index", "target"])];
const roles = { x: "trainX", y: "trainY" } as const;

function build(steps: unknown[]): WorkspaceBuildResult {
  return {
    workspace: { steps },
    errors: [],
    info: {},
    targetLabel: "target",
    originMap: {},
  } as unknown as WorkspaceBuildResult;
}

describe("resolvePreviewTarget (#199)", () => {
  const src = { files, roles: { ...roles }, labelMode: "yfile", targetCol: null } as const;

  it("without steps the engine columns still name the label", () => {
    const res = { columns: ["Index", "cohort", "age", "target"] };
    expect(resolvePreviewTarget(res, src, build([]))).toBe("target");
  });

  it("with steps a column created or renamed by a step is not the label", () => {
    // After a one-hot + rename the first column absent from train X is a dummy.
    const res = { columns: ["Index", "cohort_B", "age", "target"] };
    expect(resolvePreviewTarget(res, src, build([{ op: "onehot" }]))).toBe("target");
  });

  it("with steps and column mode the picked column wins", () => {
    const res = { columns: ["Index", "cohort_B", "age", "income"] };
    const colMode = { ...src, labelMode: "column", targetCol: "income" } as const;
    expect(resolvePreviewTarget(res, colMode, build([{ op: "onehot" }]))).toBe("income");
  });
});
