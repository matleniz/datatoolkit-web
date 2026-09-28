import { describe, expect, it } from "vitest";
import type { Workspace } from "../src/api/types";
import {
  mergeAppliesToRole,
  rawNodeSubLabel,
} from "../src/bench/pipeline/rawNodeSubLabel";

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

describe("mergeAppliesToRole", () => {
  const mk = (apply_to: "train" | "test" | "both") => ({
    source: { kind: "csv" as const, path: "/m.csv" },
    key: "id",
    apply_to,
  });

  it("train includes train and both", () => {
    expect(mergeAppliesToRole(mk("train"), "train")).toBe(true);
    expect(mergeAppliesToRole(mk("both"), "train")).toBe(true);
    expect(mergeAppliesToRole(mk("test"), "train")).toBe(false);
  });

  it("test includes both and test", () => {
    expect(mergeAppliesToRole(mk("both"), "test")).toBe(true);
    expect(mergeAppliesToRole(mk("test"), "test")).toBe(true);
    expect(mergeAppliesToRole(mk("train"), "test")).toBe(false);
  });
});

describe("rawNodeSubLabel", () => {
  it("train with y file and merge basename", () => {
    const ws = baseWs({
      datasets: {
        train: {
          x: { kind: "csv", path: "/data/churn_train.csv" },
          y: { kind: "csv", path: "/data/churn_labels.csv" },
        },
        test: {
          x: {
            kind: "csv",
            path: "/data/churn_test.csv",
            decimal: ",",
          },
        },
      },
      merges: [
        {
          source: { kind: "csv", path: "/uploads/customers_extra.csv" },
          key: "customer_id",
          apply_to: "both",
        },
      ],
    });
    expect(rawNodeSubLabel(ws, "train")).toBe(
      "train X + y + customers_extra.csv",
    );
    expect(rawNodeSubLabel(ws, "test")).toBe(
      'test X + customers_extra.csv · dec ","',
    );
  });

  it("train with target column (no y file)", () => {
    const ws = baseWs({
      datasets: {
        train: {
          x: { kind: "csv", path: "/data/train.csv" },
          target_column: "churn",
        },
      },
    });
    expect(rawNodeSubLabel(ws, "train")).toBe("train X · target churn");
  });

  it("omits train-only merge on test role", () => {
    const ws = baseWs({
      merges: [
        {
          source: { kind: "csv", path: "/data/extra.csv" },
          key: "id",
          apply_to: "train",
        },
      ],
    });
    expect(rawNodeSubLabel(ws, "train")).toBe("train X + extra.csv");
    expect(rawNodeSubLabel(ws, "test")).toBe("test X");
  });

  it("test without decimal has no dec suffix", () => {
    const ws = baseWs({
      datasets: {
        train: { x: { kind: "csv", path: "/t.csv" } },
        test: { x: { kind: "csv", path: "/te.csv" } },
      },
    });
    expect(rawNodeSubLabel(ws, "test")).toBe("test X");
  });

  it("lists multiple merges that apply", () => {
    const ws = baseWs({
      datasets: {
        train: {
          x: { kind: "csv", path: "/t.csv" },
          y: { kind: "csv", path: "/y.csv" },
        },
      },
      merges: [
        {
          source: { kind: "csv", path: "/a/one.csv" },
          key: "id",
          apply_to: "train",
        },
        {
          source: { kind: "csv", path: "/b/two.csv" },
          key: "id",
          apply_to: "both",
        },
      ],
    });
    expect(rawNodeSubLabel(ws, "train")).toBe("train X + y + one.csv + two.csv");
  });
});
