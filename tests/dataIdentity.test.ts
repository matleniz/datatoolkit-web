import { describe, expect, it } from "vitest";

import type { Workspace } from "../src/api/types";
import {
  dataIdentity,
  identityLabel,
  identitySource,
  withRole,
} from "../src/bench/dataIdentity";

function ws(steps: Workspace["steps"]): Workspace {
  return {
    name: "w",
    datasets: { train: { x: { kind: "csv", path: "/tmp/x.csv" } } },
    label: { mode: "order" },
    merges: [],
    variables: [],
    steps,
  };
}

const impute = {
  op: "impute",
  target: "both" as const,
  params: { column: "age", strategy: "median" },
};
const scale = {
  op: "scale",
  target: "both" as const,
  params: { columns: ["age"] },
};

describe("dataIdentity (MAT-175)", () => {
  it("resolves null to the latest version and clamps", () => {
    const w = ws([impute, scale]);
    expect(dataIdentity(w, "train", null).version).toBe(2);
    expect(dataIdentity(w, "train", 9).version).toBe(2);
    expect(dataIdentity(w, "train", -1).version).toBe(0);
    expect(dataIdentity(w, "train", 1).version).toBe(1);
  });

  it("changes when a step's params change, not only the step count", () => {
    const a = dataIdentity(ws([impute]), "train", null);
    const b = dataIdentity(
      ws([{ ...impute, params: { column: "age", strategy: "mean" } }]),
      "train",
      null,
    );
    expect(a.version).toBe(b.version);
    expect(a.key).not.toBe(b.key);
  });

  it("ignores steps after the viewed version", () => {
    const v1 = dataIdentity(ws([impute, scale]), "train", 1);
    const v1b = dataIdentity(
      ws([impute, { ...scale, params: { columns: ["spend"] } }]),
      "train",
      1,
    );
    const v1c = dataIdentity(ws([impute]), "train", 1);
    expect(v1.key).toBe(v1b.key);
    expect(v1.key).toBe(v1c.key);
  });

  it("differs by role and by version", () => {
    const w = ws([impute]);
    const train = dataIdentity(w, "train", null);
    expect(withRole(w, train, "test").key).not.toBe(train.key);
    expect(withRole(w, train, "train")).toBe(train);
    expect(dataIdentity(w, "train", 0).key).not.toBe(train.key);
  });

  it("ignores front-only / unrelated fields (charts, variables)", () => {
    const w = ws([impute]);
    const a = dataIdentity(w, "train", null);
    const b = dataIdentity(
      { ...w, variables: [{ name: "m", stat: "median", column: "age" }] },
      "train",
      null,
    );
    expect(a.key).toBe(b.key);
  });

  it("changes with the sources", () => {
    const w = ws([]);
    const other: Workspace = {
      ...w,
      datasets: { train: { x: { kind: "csv", path: "/tmp/other.csv" } } },
    };
    expect(dataIdentity(w, "train", null).key).not.toBe(
      dataIdentity(other, "train", null).key,
    );
  });

  it("builds a dataset source pinned to the explicit version", () => {
    const w = ws([impute, scale]);
    const id = dataIdentity(w, "train", 1);
    expect(identitySource(id)).toEqual({
      kind: "dataset",
      workspace: "w",
      role: "train",
      labeled: true,
      version: 1,
    });
    const latest = dataIdentity(w, "test", null);
    expect(identitySource(latest)).toMatchObject({
      role: "test",
      labeled: false,
      version: 2,
    });
  });

  it("labels the frame", () => {
    const w = ws([impute]);
    expect(identityLabel(dataIdentity(w, "train", 0))).toBe("train · sources");
    expect(identityLabel(dataIdentity(w, "test", null))).toBe("test · v1");
  });

  it("empty workspace yields a stable empty identity", () => {
    expect(dataIdentity(null, "train", null).key).toBe(
      dataIdentity(null, "train", 3).key,
    );
  });
});
