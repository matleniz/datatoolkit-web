import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import fileInspectParkinson from "./fixtures/file_inspect_parkinson.json";
import type { Result } from "../src/api/types";
import { E2E_FIXTURES_DIR } from "../src/e2eFixtures";
import {
  buildWorkspaceJson,
  defaultChurnSources,
  getCommonColumns,
  guessFileRole,
  mapFileInspect,
  resultSchemaColumns,
  targetFromPreviewColumns,
  yLabelValueColumn,
  type SourceFileItem,
} from "../src/screens/sources/sourcesLogic";

describe("e2e fixtures path (MAT-190)", () => {
  it("resolves to this checkout's e2e/fixtures, not a deleted worktree", () => {
    expect(E2E_FIXTURES_DIR).toMatch(/e2e[/\\]fixtures$/);
    expect(E2E_FIXTURES_DIR).not.toMatch(/fxa-sources/);
    expect(E2E_FIXTURES_DIR).not.toMatch(/w1-sources-align/);
    expect(existsSync(join(E2E_FIXTURES_DIR, "churn_train.csv"))).toBe(true);

    const churn = defaultChurnSources(E2E_FIXTURES_DIR);
    expect(churn.files[0]?.path).toBe(`${E2E_FIXTURES_DIR}/churn_train.csv`);
    expect(churn.files[0]?.spec.path).toBe(
      `${E2E_FIXTURES_DIR}/churn_train.csv`,
    );
    expect(churn.files[0]?.spec.path).not.toContain("fxa-sources");
  });
});

describe("sourcesLogic pure mapping", () => {
  it("guesses roles correctly from filenames", () => {
    expect(guessFileRole("churn_train.csv")).toBe("trainX");
    expect(guessFileRole("churn_labels.csv")).toBe("trainY");
    expect(guessFileRole("churn_test.csv")).toBe("testX");
    expect(guessFileRole("customers_extra.csv")).toBe("merge");
    expect(guessFileRole("unrelated.csv", { f1: "trainX", f2: "testX" })).toBe(
      "ignore",
    );
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
    expect(res.targetLabel).toBe("churn");
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

  it("picks y value column, not Index, for Parkinson-style y files", () => {
    expect(yLabelValueColumn(["Index", "target"])).toBe("target");
    expect(yLabelValueColumn(["churn"])).toBe("churn");
    expect(yLabelValueColumn(["idx", "label"])).toBe("label");

    const files: SourceFileItem[] = [
      {
        id: "x",
        name: "X_train.csv",
        path: "/X_train.csv",
        cols: ["Index", "age", "ledd"],
        spec: { kind: "csv", path: "/X_train.csv" },
        rowCount: 55603,
      },
      {
        id: "y",
        name: "y_train.csv",
        path: "/y_train.csv",
        cols: ["Index", "target"],
        spec: { kind: "csv", path: "/y_train.csv" },
        rowCount: 55603,
      },
    ];
    const res = buildWorkspaceJson({
      name: "parkinson",
      files,
      roles: { x: "trainX", y: "trainY" },
      labelMode: "yfile",
      yJoin: "order",
    });
    expect(res.targetLabel).toBe("target");
    expect(res.originMap["target"]).toBe("y");
    expect(res.originMap["Index"]).toBe("x");
  });

  it("resolves target from engine preview columns without duplicating Index", () => {
    const trainX = [
      "Index",
      "patient_id",
      "cohort",
      "sexM",
      "gene",
      "age_at_diagnosis",
      "age",
      "ledd",
      "time_since_intake_on",
      "time_since_intake_off",
      "on",
      "off",
    ];
    const preview = [...trainX, "target"];
    expect(targetFromPreviewColumns(preview, trainX)).toBe("target");
  });
});

describe("mapFileInspect (Parkinson real Result fixture)", () => {
  it("uses load_spec.header (0), not header_line (1), and formats shape", () => {
    const result = fileInspectParkinson as Result;
    // Real engine metrics: header_line is 1-based; load_spec.header is 0.
    expect(result.metrics.header_line).toBe(1);

    const mapped = mapFileInspect(result, [55603, 12]);
    expect(mapped.error).toBeUndefined();
    expect(mapped.header).toBe(0);
    expect(mapped.spec?.kind).toBe("csv");
    if (mapped.spec?.kind === "csv") {
      expect(mapped.spec.header).toBe(0);
      expect(mapped.spec.sep).toBe(",");
      expect(mapped.spec.encoding).toBe("utf-8");
    }
    expect(mapped.detected).toContain("header 0");
    expect(mapped.detected).toContain("55,603 × 12");
    expect(mapped.detected).not.toContain("header 1");
    expect(mapped.detected).not.toMatch(/\b0 × 12\b/);
  });
});

describe("mapFileInspect non-csv load_spec", () => {
  it("maps parquet load_spec without falling back to csv", () => {
    const mapped = mapFileInspect(
      {
        metrics: {
          load_spec: JSON.stringify({
            kind: "parquet",
            path: "/uploads/events.parquet",
          }),
        },
        tables: [],
        figures: [],
        text: "",
      },
      [3, 4],
    );
    expect(mapped.error).toBeUndefined();
    expect(mapped.spec?.kind).toBe("parquet");
    expect(mapped.detected).toContain("parquet");
    expect(mapped.detected).toContain("3 × 4");
    expect(mapped.detected).not.toContain("csv");
  });

  it("maps excel load_spec and exposes sheets for the picker", () => {
    const mapped = mapFileInspect(
      {
        metrics: {
          load_spec: JSON.stringify({
            kind: "excel",
            path: "/uploads/store_c.xlsx",
            sheet: "2024",
            header: 0,
          }),
        },
        tables: [
          {
            title: "sheets",
            records: [
              { sheet: "2024", rows: 3, cols: 3, suggested_header: 0 },
              { sheet: "2025", rows: 6, cols: 3, suggested_header: 2 },
            ],
          },
        ],
        figures: [],
        text: "",
      },
      [2, 3],
    );
    expect(mapped.spec?.kind).toBe("excel");
    if (mapped.spec?.kind === "excel") {
      expect(mapped.spec.sheet).toBe("2024");
      expect(mapped.spec.header).toBe(0);
    }
    expect(mapped.sheets).toHaveLength(2);
    expect(mapped.sheets?.[1]?.sheet).toBe("2025");
    expect(mapped.detected).toContain("excel");
    expect(mapped.detected).toContain('sheet "2024"');
  });

  it("maps json load_spec with lines and record_paths", () => {
    const mapped = mapFileInspect(
      {
        metrics: {
          load_spec: JSON.stringify({
            kind: "json",
            path: "/uploads/employees.json",
            lines: false,
            record_path: "employees",
          }),
        },
        tables: [
          {
            title: "record_paths",
            records: [{ record_path: "employees", records: 2 }],
          },
        ],
        figures: [],
        text: "",
      },
      [2, 3],
    );
    expect(mapped.spec?.kind).toBe("json");
    if (mapped.spec?.kind === "json") {
      expect(mapped.spec.record_path).toBe("employees");
      expect(mapped.spec.lines).toBe(false);
    }
    expect(mapped.recordPaths?.[0]?.record_path).toBe("employees");
    expect(mapped.detected).toContain("record_path");
  });

  it("errors instead of silently falling back to csv when load_spec is missing", () => {
    const mapped = mapFileInspect({
      metrics: { delimiter: "','", encoding_guess: "utf-8" },
      tables: [],
      figures: [],
      text: "",
    });
    expect(mapped.spec).toBeNull();
    expect(mapped.error).toMatch(/load_spec/);
    expect(mapped.detected).toBe("");
  });
});

describe("resultSchemaColumns (MAT-155 #5)", () => {
  it("unions merge extras onto preview when a merge key is chosen", () => {
    const cols = resultSchemaColumns({
      previewColumns: ["user_id", "amount"],
      trainXCols: ["user_id", "amount"],
      yCols: [],
      labelMode: "column",
      mergeCols: ["user_id", "signup_country", "loyalty_tier"],
      mergeKey: "user_id",
    });
    expect(cols).toEqual([
      "user_id",
      "amount",
      "signup_country",
      "loyalty_tier",
    ]);
  });

  it("falls back to train+y+merge when preview is null", () => {
    const cols = resultSchemaColumns({
      previewColumns: null,
      trainXCols: ["a", "b"],
      yCols: ["label"],
      labelMode: "yfile",
      mergeCols: ["a", "extra"],
      mergeKey: "a",
    });
    expect(cols).toEqual(["a", "b", "label", "extra"]);
  });
});
