import { describe, expect, it } from "vitest";
import type { Workspace } from "../src/api/types";
import { formatLearnedState } from "../src/bench/format";
import { opTitle, stepSummary } from "../src/bench/stages";
import { shapesStructureKey } from "../src/bench/version";

function baseWs(over: Partial<Workspace> = {}): Workspace {
  return {
    name: "demo",
    datasets: {
      train: { x: { kind: "csv", path: "/data/train.csv" } },
      test: { x: { kind: "csv", path: "/data/test.csv" } },
    },
    label: { mode: "order" },
    merges: [],
    variables: [],
    steps: [],
    ...over,
  };
}

describe("shapesStructureKey", () => {
  it("ignores variables so adding a variable does not invalidate shapes", () => {
    const a = baseWs({
      variables: [],
      steps: [
        {
          op: "impute",
          target: "both",
          params: { columns: ["age"], strategy: "median" },
        },
      ],
    });
    const b = baseWs({
      variables: [{ name: "spend_med", stat: "median", column: "monthly_spend" }],
      steps: a.steps,
    });
    expect(shapesStructureKey(a, "train")).toBe(shapesStructureKey(b, "train"));
  });

  it("changes when steps change", () => {
    const a = baseWs({ steps: [] });
    const b = baseWs({
      steps: [
        {
          op: "replace_sentinels",
          target: "both",
          params: { sentinels: { age: [-999] } },
        },
      ],
    });
    expect(shapesStructureKey(a, "train")).not.toBe(
      shapesStructureKey(b, "train"),
    );
  });

  it("changes when role changes", () => {
    const ws = baseWs();
    expect(shapesStructureKey(ws, "train")).not.toBe(
      shapesStructureKey(ws, "test"),
    );
  });
});

describe("stepSummary", () => {
  it("builds op label + sub-label like the pipeline node", () => {
    expect(
      stepSummary("impute", { columns: ["age"], strategy: "median" }),
    ).toBe("Impute · age · median");
    expect(
      stepSummary("replace_sentinels", { sentinels: { age: [-999] } }),
    ).toBe("Replace sentinels · age · -999 → NaN");
  });

  it("opTitle covers common ops", () => {
    expect(opTitle("replace_sentinels")).toBe("Replace sentinels");
    expect(opTitle("unknown_op")).toBe("unknown_op");
  });
});

describe("formatLearnedState", () => {
  it("marks empty fitted state as not fitted", () => {
    expect(formatLearnedState({})).toBe(
      "Not fitted: nothing is learned on train",
    );
  });
});
