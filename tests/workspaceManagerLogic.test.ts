import { describe, expect, it } from "vitest";

import type { WorkspaceSummary } from "../src/api/types";
import {
  deleteConfirmMessage,
  filterWorkspaceSummaries,
  formatMtime,
  formatShape,
  multiDeleteConfirmMessage,
  pickFallbackWorkspace,
  roleLine,
  sortWorkspaceSummaries,
  suggestDuplicateName,
} from "../src/screens/sources/workspaceManagerLogic";

function summary(
  over: Partial<WorkspaceSummary> & Pick<WorkspaceSummary, "name">,
): WorkspaceSummary {
  return {
    mtime: "2026-09-28T12:00:00.000Z",
    step_count: 0,
    target: null,
    train: {
      kind: "csv",
      path: "/tmp/train.csv",
      file: "train.csv",
      shape: [10, 3],
    },
    test: null,
    ...over,
  };
}

describe("workspaceManagerLogic", () => {
  it("formats shape and role lines", () => {
    expect(formatShape([20, 11])).toBe("20 × 11");
    expect(formatShape(null)).toBe("—");
    expect(roleLine(null)).toBe("no test");
    expect(
      roleLine({
        kind: "csv",
        path: "/a/b.csv",
        file: "b.csv",
        shape: [2, 2],
      }),
    ).toBe("b.csv · 2 × 2");
  });

  it("formats relative mtimes", () => {
    const now = Date.parse("2026-09-28T12:30:00.000Z");
    expect(formatMtime("2026-09-28T12:29:30.000Z", now)).toBe("just now");
    expect(formatMtime("2026-09-28T12:00:00.000Z", now)).toBe("30m ago");
  });

  it("filters and sorts summaries", () => {
    const list = [
      summary({
        name: "beta",
        mtime: "2026-09-28T10:00:00.000Z",
        target: "y",
      }),
      summary({
        name: "alpha",
        mtime: "2026-09-28T14:00:00.000Z",
        train: {
          kind: "csv",
          path: "/x/churn_train.csv",
          file: "churn_train.csv",
          shape: [20, 10],
        },
      }),
    ];
    expect(filterWorkspaceSummaries(list, "alp").map((s) => s.name)).toEqual([
      "alpha",
    ]);
    expect(filterWorkspaceSummaries(list, "churn").map((s) => s.name)).toEqual([
      "alpha",
    ]);
    expect(
      sortWorkspaceSummaries(list, "name", "asc").map((s) => s.name),
    ).toEqual(["alpha", "beta"]);
    expect(
      sortWorkspaceSummaries(list, "mtime", "desc").map((s) => s.name),
    ).toEqual(["alpha", "beta"]);
  });

  it("suggests free duplicate names", () => {
    expect(suggestDuplicateName("a", ["a"])).toBe("a-copy");
    expect(suggestDuplicateName("a", ["a", "a-copy"])).toBe("a-copy-2");
  });

  it("builds delete confirm copy naming what is lost", () => {
    const msg = deleteConfirmMessage(
      summary({ name: "qa-1", step_count: 3, target: "churn" }),
    );
    expect(msg).toContain("“qa-1”");
    expect(msg).toContain("3 steps");
    expect(msg).toContain("Target “churn”");
    expect(msg).toContain("Uploaded files stay");
    expect(multiDeleteConfirmMessage(["a", "b"])).toContain("2 workspaces");
  });

  it("picks a fallback after deleting the active workspace", () => {
    expect(pickFallbackWorkspace([])).toBeNull();
    expect(pickFallbackWorkspace(["z", "churn", "a"])).toBe("churn");
    expect(pickFallbackWorkspace(["z", "a"], "z")).toBe("z");
    expect(pickFallbackWorkspace(["z", "a"])).toBe("a");
  });
});
