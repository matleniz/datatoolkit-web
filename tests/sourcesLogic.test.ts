import { describe, expect, it } from "vitest";
import {
  buildWorkspaceJson,
  getCommonColumns,
  guessFileRole,
  type SourceFileItem,
} from "../src/screens/sources/sourcesLogic";

describe("sourcesLogic pure mapping", () => {
  it("guesses roles correctly from filenames", () => {
    expect(guessFileRole("churn_train.csv")).toBe("trainX");
    expect(guessFileRole("churn_labels.csv")).toBe("trainY");
    expect(guessFileRole("churn_test.csv")).toBe("testX");
    expect(guessFileRole("customers_extra.csv")).toBe("merge");
    expect(guessFileRole("unrelated.csv", { f1: "trainX", f2: "testX" })).toBe("ignore");
  });

  it("finds common columns", () => {
    const a = ["customer_id", "name", "age"];
    const b = ["customer_id", "region"];
    expect(getCommonColumns(a, b)).toEqual(["customer_id"]);
  });

  it("builds workspace JSON from valid files and options", () => {
    const files: SourceFileItem[] = [
      {
        id: "train",
        name: "churn_train.csv",
        path: "/path/to/churn_train.csv",
        cols: ["customer_id", "age", "monthly_spend"],
        spec: { kind: "csv", path: "/path/to/churn_train.csv" },
        rowCount: 20,
      },
      {
        id: "labels",
        name: "churn_labels.csv",
        path: "/path/to/churn_labels.csv",
        cols: ["churn"],
        spec: { kind: "csv", path: "/path/to/churn_labels.csv" },
        rowCount: 20,
      },
      {
        id: "test",
        name: "churn_test.csv",
        path: "/path/to/churn_test.csv",
        cols: ["customer_id", "age", "monthly_spend"],
        spec: { kind: "csv", path: "/path/to/churn_test.csv" },
        rowCount: 6,
      },
      {
        id: "extra",
        name: "customers_extra.csv",
        path: "/path/to/customers_extra.csv",
        cols: ["customer_id", "region"],
        spec: { kind: "csv", path: "/path/to/customers_extra.csv" },
        rowCount: 26,
      },
    ];

    const roles = {
      train: "trainX" as const,
      labels: "trainY" as const,
      test: "testX" as const,
      extra: "merge" as const,
    };

    const res = buildWorkspaceJson({
      name: "churn",
      files,
      roles,
      labelMode: "yfile",
      yJoin: "order",
      mergeKey: "customer_id",
      mergeInTest: true,
      testDecimal: ",",
    });

    expect(res.errors).toHaveLength(0);
    expect(res.workspace.name).toBe("churn");
    expect(res.workspace.datasets.train.x).toEqual({
      kind: "csv",
      path: "/path/to/churn_train.csv",
    });
    expect(res.workspace.datasets.train.y).toEqual({
      kind: "csv",
      path: "/path/to/churn_labels.csv",
    });
    expect(res.workspace.datasets.test?.x).toEqual({
      kind: "csv",
      path: "/path/to/churn_test.csv",
      decimal: ",",
    });
    expect(res.workspace.merges).toHaveLength(1);
    expect(res.workspace.merges[0]!.key).toBe("customer_id");
    expect(res.workspace.merges[0]!.apply_to).toBe("both");
    expect(res.originMap["customer_id"]).toBe("x");
    expect(res.originMap["churn"]).toBe("y");
    expect(res.originMap["region"]).toBe("merge");
  });

  it("reports error when no trainX is selected", () => {
    const res = buildWorkspaceJson({
      name: "test",
      files: [],
      roles: {},
      labelMode: "yfile",
      yJoin: "order",
    });
    expect(res.errors).toContain("Pick a Train X file.");
  });

  it("supports column mode for target", () => {
    const files: SourceFileItem[] = [
      {
        id: "train",
        name: "data.csv",
        path: "/data.csv",
        cols: ["id", "feature", "target_col"],
        spec: { kind: "csv", path: "/data.csv" },
        rowCount: 10,
      },
    ];

    const res = buildWorkspaceJson({
      name: "col_mode",
      files,
      roles: { train: "trainX" },
      labelMode: "column",
      yJoin: "order",
      targetCol: "target_col",
    });

    expect(res.errors).toHaveLength(0);
    expect(res.workspace.datasets.train.target_column).toBe("target_col");
    expect(res.targetLabel).toBe("target_col");
  });
});
