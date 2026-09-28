import { describe, expect, it } from "vitest";

import type { TopValue, WorkspaceRow } from "../src/api/types";
import {
  buildValueGroups,
  valueGroupsFromRows,
  valueGroupsFromTopValues,
} from "../src/bench/inspector/valueGroups";
import {
  effectiveVersion,
  latestVersion,
  normalizeProfiles,
} from "../src/bench/version";
import type { Workspace } from "../src/api/types";

function ws(steps: number): Workspace {
  return {
    name: "t",
    datasets: { train: { x: { kind: "csv", path: "/x.csv" } } },
    label: { mode: "order" },
    merges: [],
    variables: [],
    steps: Array.from({ length: steps }, (_, i) => ({
      op: "impute",
      target: "both" as const,
      params: { columns: ["age"], strategy: "median" },
      ...(i === 0 ? {} : {}),
    })),
  };
}

describe("effectiveVersion", () => {
  it("maps null to latest step index", () => {
    expect(latestVersion(ws(3))).toBe(3);
    expect(effectiveVersion(ws(3), null)).toBe(3);
    expect(effectiveVersion(ws(0), null)).toBe(0);
  });

  it("clamps past-the-end and negative", () => {
    expect(effectiveVersion(ws(2), 1)).toBe(1);
    expect(effectiveVersion(ws(2), 99)).toBe(2);
    expect(effectiveVersion(ws(2), -1)).toBe(0);
  });
});

describe("normalizeProfiles", () => {
  it("accepts {columns, version}", () => {
    const r = normalizeProfiles({
      columns: [{ name: "a" }],
      version: 2,
    });
    expect(r.version).toBe(2);
    expect(r.columns).toHaveLength(1);
  });

  it("accepts a bare array", () => {
    const r = normalizeProfiles([{ name: "a" }]);
    expect(r.columns[0]?.name).toBe("a");
  });

  it("rejects garbage", () => {
    expect(() => normalizeProfiles({})).toThrow(/columns/);
  });
});

describe("valueGroups", () => {
  const tops: TopValue[] = [
    { value: "Paris", count: 5 },
    { value: "paris", count: 2 },
    { value: "PARIS ", count: 1 },
    { value: "Lyon", count: 3 },
    { value: "lyon", count: 1 },
    { value: "already", count: 1 },
  ];

  it("groups strip+lower collisions from top_values", () => {
    const g = valueGroupsFromTopValues(tops);
    const paris = g.find((x) => x.to === "paris");
    expect(paris).toBeDefined();
    expect(paris!.from).toContain('"Paris"');
    expect(paris!.from).toContain('"paris"');
    expect(paris!.from).toContain('"PARIS "');
    const lyon = g.find((x) => x.to === "lyon");
    expect(lyon).toBeDefined();
    // "already" is already canonical and alone — omitted
    expect(g.find((x) => x.to === "already")).toBeUndefined();
  });

  it("builds from rows the same way", () => {
    const rows = tops.map((t, i) => ({
      _rid: i,
      city: t.value,
    })) as WorkspaceRow[];
    const g = valueGroupsFromRows(rows, "city");
    expect(g.some((x) => x.to === "paris")).toBe(true);
  });

  it("merges rows when distinct exceeds top_values coverage", () => {
    const g = buildValueGroups({
      topValues: tops.slice(0, 2),
      distinct: 8,
      rows: [
        { _rid: 0, city: "Paris" },
        { _rid: 1, city: "  paris" },
      ] as WorkspaceRow[],
      column: "city",
    });
    expect(g.some((x) => x.to === "paris")).toBe(true);
  });
});
