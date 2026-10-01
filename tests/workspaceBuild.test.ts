import { describe, expect, it } from "vitest";
import {
  buildWorkspaceJson,
  type SourceFileItem,
} from "../src/screens/sources/sourcesLogic";

const file = (
  id: string,
  cols: string[],
  rowCount?: number,
): SourceFileItem =>
  ({
    id,
    name: `${id}.csv`,
    path: `${id}.csv`,
    cols,
    rowCount,
    spec: { kind: "csv", path: `${id}.csv` },
  }) as SourceFileItem;

const build = (
  files: SourceFileItem[],
  roles: Record<string, "trainX" | "trainY" | "testX" | "merge">,
  extra: Partial<Parameters<typeof buildWorkspaceJson>[0]> = {},
) =>
  buildWorkspaceJson({
    name: "w",
    files,
    roles,
    labelMode: "yfile",
    yJoin: "order",
    ...extra,
  });

describe("buildWorkspaceJson error and info branches", () => {
  it("rejects several Train X / Test X files", () => {
    const r = build(
      [file("a", ["k"]), file("b", ["k"]), file("c", ["k"]), file("d", ["k"])],
      { a: "trainX", b: "trainX", c: "testX", d: "testX" },
      { labelMode: "column" },
    );
    expect(r.errors).toEqual([
      "Only one file can be Train X.",
      "Only one file can be Test X.",
    ]);
  });

  it("refuses an order join with mismatched row counts", () => {
    const r = build(
      [file("a", ["k"], 5), file("y", ["t"], 6)],
      { a: "trainX", y: "trainY" },
    );
    expect(r.errors).toEqual([
      "Label join by order refuses: y.csv has 6 rows, train X has 5.",
    ]);
    expect(r.info.y).toBeUndefined();
  });

  it("reports labels joined by order and the key-join fallbacks", () => {
    const order = build(
      [file("a", ["k"], 5), file("y", ["t"], 5)],
      { a: "trainX", y: "trainY" },
    );
    expect(order.info.y).toBe("5 labels joined row by row · 0 rows lost");

    const noCommon = build(
      [file("a", ["k"]), file("y", ["t"])],
      { a: "trainX", y: "trainY" },
      { yJoin: "key" },
    );
    expect(noCommon.errors).toEqual([
      "y.csv has no column in common with train X for key join.",
    ]);

    const fallback = build(
      [file("a", ["k", "v"]), file("y", ["k", "t"])],
      { a: "trainX", y: "trainY" },
      { yJoin: "key", targetCol: "zz" },
    );
    expect(fallback.workspace.label).toEqual({ mode: "key", key: "k" });
  });

  it("errors without a Train y file in yfile mode", () => {
    const r = build([file("a", ["k"])], { a: "trainX" });
    expect(r.errors).toEqual([
      "Give a file the role “Train y”, or pick a column of train X as the target.",
    ]);
  });

  it("asks for the target column in column mode when none is valid", () => {
    const r = build([file("a", ["k"])], { a: "trainX" }, {
      labelMode: "column",
      targetCol: "nope",
    });
    expect(r.info.y).toBe("Pick the target column.");
    expect(r.targetLabel).toBeNull();
  });

  it("handles merge errors, info text and test decimal", () => {
    const noTrain = build([file("m", ["k"])], { m: "merge" }, {
      labelMode: "column",
    });
    expect(noTrain.errors).toContain("Train X required to configure merge.");

    const badKey = build(
      [file("a", ["k"]), file("m", ["q"])],
      { a: "trainX", m: "merge" },
      { labelMode: "column" },
    );
    expect(badKey.errors).toContain(
      "Merge key must exist in train X and m.csv.",
    );
    expect(badKey.workspace.merges).toEqual([]);

    const ok = build(
      [file("a", ["k"], 5), file("t", ["k"], 3), file("m", ["k", "w"])],
      { a: "trainX", t: "testX", m: "merge" },
      { labelMode: "column", mergeInTest: true, testDecimal: "," },
    );
    expect(ok.info.merge).toBe(
      "train: 5 / 5 rows matched · test: 3 / 3 · 0 rows lost (left join)",
    );
    expect(ok.originMap).toEqual({ k: "x", w: "merge" });
    expect(ok.workspace.merges[0]?.apply_to).toBe("both");
    expect(ok.workspace.datasets.test?.x).toMatchObject({ decimal: "," });
  });
});
