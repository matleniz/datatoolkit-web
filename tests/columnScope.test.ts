import { describe, expect, it } from "vitest";

import type { ColumnProfile, WorkspaceRow } from "../src/api/types";
import {
  defaultSplitBy,
  engineColumnsParam,
  listOutlierRows,
  maxAbs,
  outliersBoundLabel,
  schemaHasBy,
  schemaHasColumns,
  selectedNumericColumns,
} from "../src/bench/dock/columnScope";

describe("columnScope helpers (MAT-146 / MAT-147 / MAT-159)", () => {
  it("detects columns on a key schema", () => {
    expect(
      schemaHasColumns({
        type: "object",
        properties: { source: { type: "object" }, columns: { type: "array" } },
      }),
    ).toBe(true);
    expect(
      schemaHasColumns({
        type: "object",
        properties: { source: { type: "object" }, iqr_k: { type: "number" } },
      }),
    ).toBe(false);
  });

  it("detects by on column_distribution schema", () => {
    expect(
      schemaHasBy({
        type: "object",
        properties: { by: { type: "string" }, columns: { type: "array" } },
      }),
    ).toBe(true);
    expect(
      schemaHasBy({
        type: "object",
        properties: { columns: { type: "array" } },
      }),
    ).toBe(false);
  });

  it("engineColumnsParam is null when widened or empty", () => {
    expect(engineColumnsParam(["age"], true)).toBeNull();
    expect(engineColumnsParam([], false)).toBeNull();
    expect(engineColumnsParam(["age", "sessions"], false)).toEqual([
      "age",
      "sessions",
    ]);
  });

  it("selectedNumericColumns keeps number kind only", () => {
    const profiles = [
      { name: "age", kind: "number" },
      { name: "city", kind: "text" },
      { name: "flag", kind: "binary" },
    ] as ColumnProfile[];
    expect(
      selectedNumericColumns(["age", "city", "flag", "missing"], profiles),
    ).toEqual(["age"]);
  });

  it("defaultSplitBy prefers target then first other column", () => {
    expect(
      defaultSplitBy("Survived", "Age", ["Age", "Sex", "Survived"]),
    ).toBe("Survived");
    expect(defaultSplitBy("Age", "Age", ["Age", "Sex", "Fare"])).toBe("Sex");
    expect(defaultSplitBy(null, "Age", ["Age", "Fare"])).toBe("Fare");
    expect(defaultSplitBy(null, "Age", ["Age"])).toBeNull();
  });

  it("listOutlierRows uses IQR fences and skips sentinels", () => {
    const profile = {
      name: "spend",
      kind: "number",
      iqr_bounds: { lo: 10, hi: 100 },
      outliers: 2,
    } as ColumnProfile;
    const rows = [
      { _rid: 0, spend: 50 },
      { _rid: 1, spend: -999 },
      { _rid: 2, spend: 250 },
      { _rid: 3, spend: 5 },
    ] as WorkspaceRow[];
    expect(listOutlierRows(rows, "spend", profile)).toEqual([
      { rid: 2, value: 250 },
      { rid: 3, value: 5 },
    ]);
  });

  it("outliersBoundLabel and maxAbs", () => {
    expect(
      outliersBoundLabel("age", {
        name: "age",
        kind: "number",
        iqr_bounds: { lo: 1.2345, hi: 9.876 },
      } as ColumnProfile),
    ).toMatch(/^bound to age · fences/);
    expect(maxAbs([-3, 10, 2])).toBe(10);
  });
});
