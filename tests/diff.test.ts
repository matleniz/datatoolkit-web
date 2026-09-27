import { describe, expect, it } from "vitest";

import { buildDisplay, cellTone, diffText } from "../src/bench/diff";
import type {
  PreviewStep,
  WorkspaceRow,
  WorkspaceRowsColumn,
} from "../src/api/types";

const cols: WorkspaceRowsColumn[] = [
  { name: "age", dtype: "float64", kind: "number" },
  { name: "city", dtype: "object", kind: "text" },
];

const rows: WorkspaceRow[] = [
  { _rid: 0, age: 34, city: "Paris" },
  { _rid: 1, age: -999, city: "Lyon" },
  { _rid: 2, age: 40, city: "Paris" },
];

describe("buildDisplay / diff colouring", () => {
  it("returns base frame when preview is null", () => {
    const d = buildDisplay(cols, rows, null);
    expect(d.diff).toBeNull();
    expect(d.cols.map((c) => c.name)).toEqual(["age", "city"]);
    expect(d.rows).toHaveLength(3);
    expect(d.rows[0]?.changed).toEqual({});
  });

  it("marks changed cells and preserves was-value in prev", () => {
    const preview: PreviewStep = {
      shape: [3, 2],
      columns: ["age", "city"],
      added_columns: [],
      removed_columns: [],
      removed_rids: [],
      changed: [
        { _rid: 1, column: "age", before: -999, after: null },
      ],
      changed_total: 1,
      state: {},
      fitted_on: "train",
    };
    const d = buildDisplay(cols, rows, preview);
    expect(d.diff?.changed).toBe(1);
    const row = d.rows.find((r) => r.rid === 1)!;
    expect(row.changed.age).toBe(true);
    expect(row.prev.age).toBe(-999);
    expect(row.vals.age).toBeNull();
  });

  it("marks added and removed columns", () => {
    const preview: PreviewStep = {
      shape: [3, 3],
      columns: ["age", "city_Paris", "city_Lyon"],
      added_columns: ["city_Paris", "city_Lyon"],
      removed_columns: ["city"],
      removed_rids: [],
      changed: [],
      changed_total: 0,
      state: {},
      fitted_on: "train",
    };
    const nextCols: WorkspaceRowsColumn[] = [
      { name: "age", dtype: "float64", kind: "number" },
      { name: "city_Paris", dtype: "int64", kind: "binary" },
      { name: "city_Lyon", dtype: "int64", kind: "binary" },
    ];
    const nextRows: WorkspaceRow[] = [
      { _rid: 0, age: 34, city_Paris: 1, city_Lyon: 0 },
      { _rid: 1, age: -999, city_Paris: 0, city_Lyon: 1 },
      { _rid: 2, age: 40, city_Paris: 1, city_Lyon: 0 },
    ];
    const d = buildDisplay(cols, rows, preview, nextRows, nextCols);
    expect(d.cols.filter((c) => c.status === "added").map((c) => c.name)).toEqual([
      "city_Paris",
      "city_Lyon",
    ]);
    expect(d.cols.some((c) => c.name === "city" && c.status === "removed")).toBe(
      true,
    );
    expect(d.rows[0]?.vals.city_Paris).toBe(1);
    expect(d.rows[0]?.vals.city_Lyon).toBe(0);
    expect(diffText(d.diff)).toContain("+2 col");
    expect(diffText(d.diff)).toContain("−1 col");
  });

  it("cellTone priority: removed > changed > missing > sentinel > outlier", () => {
    expect(
      cellTone({
        rowRemoved: true,
        colRemoved: false,
        colAdded: false,
        changed: true,
        value: 1,
        kind: "number",
        isOutlier: true,
        rowSelected: false,
        colSelected: false,
      }),
    ).toBe("removed");
    expect(
      cellTone({
        rowRemoved: false,
        colRemoved: false,
        colAdded: false,
        changed: true,
        value: null,
        kind: "number",
        isOutlier: false,
        rowSelected: false,
        colSelected: false,
      }),
    ).toBe("changed");
    expect(
      cellTone({
        rowRemoved: false,
        colRemoved: false,
        colAdded: false,
        changed: false,
        value: null,
        kind: "number",
        isOutlier: false,
        rowSelected: false,
        colSelected: false,
      }),
    ).toBe("missing");
    expect(
      cellTone({
        rowRemoved: false,
        colRemoved: false,
        colAdded: false,
        changed: false,
        value: -999,
        kind: "number",
        isOutlier: false,
        rowSelected: false,
        colSelected: false,
      }),
    ).toBe("sentinel");
  });
});
