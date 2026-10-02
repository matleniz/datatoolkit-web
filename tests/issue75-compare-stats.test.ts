import { describe, expect, it } from "vitest";

import type { Result } from "../src/api/types";
import {
  compareStatsPlan,
  summaryStats,
  targetCorrelations,
} from "../src/bench/dock/compareStats";

const result = (tables: Result["tables"]): Result => ({
  metrics: {},
  tables,
  figures: [],
  text: "",
});

describe("summaryStats (#75)", () => {
  it("maps numeric_summary rows to per-column stats from the full frame", () => {
    const stats = summaryStats(
      result([
        {
          title: "numeric_summary",
          records: [
            { column: "off", group: "all", count: 32196, n_missing: 23407, mean: 31.2, std: 16.53, min: 0, q1: 20, median: 30, q3: 41, max: 106 },
            { column: "age", group: "all", count: 55603, n_missing: 0, mean: 62.52, std: 9.1, min: 30, q1: 56, median: 63, q3: 69, max: 91 },
          ],
        },
      ]),
    );
    expect(stats.off?.max).toBe(106);
    expect(stats.off?.std).toBe(16.53);
    expect(stats.age?.mean).toBe(62.52);
  });

  it("turns missing / non-finite values into null and tolerates no table", () => {
    const stats = summaryStats(
      result([
        {
          title: "numeric_summary",
          records: [{ column: "c", mean: null, std: null, max: "x" }],
        },
      ]),
    );
    expect(stats.c).toMatchObject({ mean: null, std: null, max: null });
    expect(summaryStats(result([]))).toEqual({});
  });
});

describe("targetCorrelations (#75)", () => {
  const matrix = result([
    {
      title: "matrix",
      records: [
        { column: "age", age: 1, off: 0.1, target: -0.2 },
        { column: "off", age: 0.1, off: 1, target: 0.87 },
        { column: "target", age: -0.2, off: 0.87, target: 1 },
      ],
    },
  ]);

  it("reads the signed r of each column from the target row", () => {
    expect(targetCorrelations(matrix, "target")).toEqual({
      age: -0.2,
      off: 0.87,
      target: 1,
    });
  });

  it("keeps undefined correlations as null, empty without a target row", () => {
    const m = result([
      {
        title: "matrix",
        records: [{ column: "t", c: null, t: 1 }],
      },
    ]);
    expect(targetCorrelations(m, "t").c).toBeNull();
    expect(targetCorrelations(matrix, "nope")).toEqual({});
  });
});

describe("compareStatsPlan (#75)", () => {
  const kinds = new Map([
    ["a", "number"],
    ["b", "number"],
    ["s", "text"],
    ["y", "binary"],
    ["t", "text"],
  ]);

  it("asks the summary for numeric picks only", () => {
    expect(compareStatsPlan(["a", "s", "b"], kinds, null)).toEqual({
      numeric: ["a", "b"],
      corrColumns: null,
    });
  });

  it("adds the target to the correlation columns when it is numeric", () => {
    expect(compareStatsPlan(["a", "s", "y"], kinds, "y")).toEqual({
      numeric: ["a", "y"],
      corrColumns: ["a", "y"],
    });
  });

  it("skips the correlation for a non-numeric target or no numeric pick", () => {
    expect(compareStatsPlan(["a", "b"], kinds, "t").corrColumns).toBeNull();
    expect(compareStatsPlan(["s"], kinds, "y").corrColumns).toBeNull();
  });
});
