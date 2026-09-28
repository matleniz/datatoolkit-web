import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type { JsonSchema } from "../src/api/types";
import { suggestedParamsToKeyParams } from "../src/bench/dock/suggestedParams";
import {
  keySchemaDefaults,
  keyTunableFields,
} from "../src/bench/left/keyTunable";
import { toEngineParams } from "../src/bench/presets";
import {
  defaultParams,
  featureOpColumnsNeedingImpute,
  resolveSchemaProp,
  schemaFieldsGap,
  schemaToFields,
  stepEditorBlockers,
  stepsAreIdentical,
  stepParamsValid,
  stripNullParams,
} from "../src/bench/schemaFields";

const fixturesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures/schemas",
);

function loadSchema(op: string): JsonSchema {
  return JSON.parse(
    readFileSync(join(fixturesDir, `${op}.json`), "utf8"),
  ) as JsonSchema;
}

const imputeSchema: JsonSchema = {
  type: "object",
  properties: {
    columns: {
      type: "array",
      items: { type: "string" },
      "x-dtk-widget": "columns",
      "x-dtk-dtype": "any",
      title: "Columns",
    },
    strategy: {
      type: "string",
      enum: ["median", "mean", "most_frequent", "constant"],
      default: "median",
      title: "Strategy",
    },
    fill_value: { type: "string", title: "Constant value" },
  },
  required: ["columns"],
};

const sentinelsSchema: JsonSchema = {
  type: "object",
  properties: {
    sentinels: {
      type: "object",
      title: "Sentinels",
    },
  },
  required: ["sentinels"],
};

describe("schema → editor fields", () => {
  it("maps column widgets and enums", () => {
    const fields = schemaToFields(imputeSchema, "impute");
    expect(fields.map((f) => f.key)).toEqual([
      "columns",
      "strategy",
      "fill_value",
    ]);
    expect(fields[0]?.widget).toBe("columns");
    expect(fields[1]?.widget).toBe("enum");
    expect(fields[1]?.enumValues).toContain("most_frequent");
    expect(fields[2]?.whenStrategyConstant).toBe(true);
  });

  it("maps sentinels to the special widget", () => {
    const fields = schemaToFields(sentinelsSchema, "replace_sentinels");
    expect(fields).toHaveLength(1);
    expect(fields[0]?.widget).toBe("sentinels");
  });

  it("validates required columns and drop_duplicates sort_by", () => {
    const fields = schemaToFields(imputeSchema, "impute");
    expect(stepParamsValid("impute", { strategy: "median" }, fields).ok).toBe(
      false,
    );
    expect(
      stepParamsValid("impute", { columns: ["age"], strategy: "median" }, fields)
        .ok,
    ).toBe(true);

    expect(
      stepParamsValid(
        "drop_duplicates",
        { keep: "first", sort_by: null },
        [],
      ).ok,
    ).toBe(false);
    expect(
      stepParamsValid(
        "drop_duplicates",
        { keep: "first", sort_by: ["customer_id"] },
        [],
      ).ok,
    ).toBe(true);
    expect(
      stepParamsValid("drop_duplicates", { keep: "none" }, []).ok,
    ).toBe(true);
  });

  it("defaultParams fills engine defaults", () => {
    const d = defaultParams(imputeSchema, "impute");
    expect(d.strategy).toBe("median");
  });

  it("maps bins anyOf integer|auto to auto_number", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        bins: {
          anyOf: [
            { type: "integer" },
            { const: "auto", type: "string" },
          ],
          default: "auto",
          title: "Bins",
        },
        source: { type: "object", title: "Source" },
      },
    };
    const fields = schemaToFields(schema, "column_distribution");
    expect(fields.find((f) => f.key === "bins")?.widget).toBe("auto_number");
  });

  it("resolveSchemaProp still unwraps plain number|null", () => {
    const resolved = resolveSchemaProp({
      anyOf: [{ type: "number" }, { type: "null" }],
      default: null,
      title: "Min Frequency",
    });
    expect(resolved.type).toBe("number");
    expect(resolved.title).toBe("Min Frequency");
  });

  it("stripNullParams drops null entries", () => {
    expect(
      stripNullParams({ columns: ["age"], fill_value: null, strategy: "median" }),
    ).toEqual({ columns: ["age"], strategy: "median" });
  });
});

describe("key tunable fields (MAT-174)", () => {
  it("hides structural params and keeps knobs", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        source: { type: "object" },
        columns: {
          type: "array",
          items: { type: "string" },
          "x-dtk-widget": "columns",
        },
        bins: {
          anyOf: [{ type: "integer" }, { const: "auto", type: "string" }],
          default: "auto",
          title: "Bins",
        },
        log_x: { type: "boolean", default: false, title: "Log X" },
        method: {
          type: "string",
          enum: ["pearson", "spearman"],
          default: "pearson",
        },
      },
    };
    const fields = keyTunableFields(schema, "column_distribution");
    expect(fields.map((f) => f.key).sort()).toEqual([
      "bins",
      "log_x",
      "method",
    ]);
    const defaults = keySchemaDefaults(schema, "column_distribution");
    expect(defaults.bins).toBe("auto");
    expect(defaults.log_x).toBe(false);
    expect(defaults).not.toHaveProperty("source");
  });

  it("maps suggested_params log_scale → log_x", () => {
    expect(
      suggestedParamsToKeyParams({
        top_k: 10,
        bins: 8,
        log_scale: true,
      }),
    ).toEqual({ bins: 8, top_k: 10, log_x: true });
  });
});

describe("real dtk-api schema fixtures", () => {
  it("impute: columns, strategy, fill_value, add_indicator", () => {
    const fields = schemaToFields(loadSchema("impute"), "impute");
    expect(fields.map((f) => f.key)).toEqual([
      "columns",
      "strategy",
      "fill_value",
      "add_indicator",
    ]);
    expect(fields.find((f) => f.key === "strategy")?.enumValues).toEqual([
      "median",
      "mean",
      "most_frequent",
      "constant",
    ]);
    expect(fields.find((f) => f.key === "fill_value")?.whenStrategyConstant).toBe(
      true,
    );
    expect(fields.find((f) => f.key === "add_indicator")?.widget).toBe("bool");
  });

  it("onehot: columns, min_frequency, drop_first, handle_unknown", () => {
    const fields = schemaToFields(loadSchema("onehot"), "onehot");
    expect(fields.map((f) => f.key)).toEqual([
      "columns",
      "min_frequency",
      "drop_first",
      "handle_unknown",
    ]);
    expect(fields.find((f) => f.key === "min_frequency")?.widget).toBe("number");
    expect(fields.find((f) => f.key === "drop_first")?.widget).toBe("bool");
    expect(fields.find((f) => f.key === "handle_unknown")?.enumValues).toEqual([
      "ignore",
      "error",
    ]);
  });

  it("clip: columns, lower, upper", () => {
    const fields = schemaToFields(loadSchema("clip"), "clip");
    expect(fields.map((f) => f.key)).toEqual(["columns", "lower", "upper"]);
    expect(fields.every((f) => f.key === "columns" || f.widget === "number")).toBe(
      true,
    );
  });

  it("scale: columns, method", () => {
    const fields = schemaToFields(loadSchema("scale"), "scale");
    expect(fields.map((f) => f.key)).toEqual(["columns", "method"]);
    expect(fields.find((f) => f.key === "method")?.enumValues).toContain(
      "standard",
    );
  });

  it("drop_duplicates: subset, keep, sort_by", () => {
    const fields = schemaToFields(loadSchema("drop_duplicates"), "drop_duplicates");
    expect(fields.map((f) => f.key)).toEqual(["subset", "keep", "sort_by"]);
    expect(fields.find((f) => f.key === "subset")?.widget).toBe("columns");
    expect(fields.find((f) => f.key === "sort_by")?.widget).toBe("columns");
  });

  it("formula: name, expr, variables", () => {
    const fields = schemaToFields(loadSchema("formula"), "formula");
    expect(fields.map((f) => f.key)).toEqual(["name", "expr", "variables"]);
    expect(fields.find((f) => f.key === "expr")?.widget).toBe("formula");
    expect(fields.find((f) => f.key === "variables")?.widget).toBe("variables");
  });
});

describe("toEngineParams", () => {
  it("converts prototype column/values to sentinels map", () => {
    expect(
      toEngineParams("replace_sentinels", { column: "age", values: [-999] }),
    ).toEqual({ sentinels: { age: [-999] } });
  });

  it("converts column/values even when empty sentinels {} is present", () => {
    expect(
      toEngineParams("replace_sentinels", {
        sentinels: {},
        column: "age",
        values: [-999],
      }),
    ).toEqual({ sentinels: { age: [-999] } });
  });

  it("keeps a non-empty sentinels map", () => {
    expect(
      toEngineParams("replace_sentinels", {
        sentinels: { age: [-999] },
        column: "other",
        values: [0],
      }),
    ).toEqual({ sentinels: { age: [-999] } });
  });

  it("converts single column to columns array", () => {
    expect(toEngineParams("impute", { column: "age", strategy: "median" })).toEqual({
      columns: ["age"],
      strategy: "median",
    });
  });

  it("maps map_value onto standardize_text params", () => {
    expect(
      toEngineParams("map_value", {
        column: "city",
        from: "PARIS",
        to: "paris",
      }),
    ).toEqual({
      columns: ["city"],
      strip: false,
      lower: false,
      mapping: { PARIS: "paris" },
    });
  });
});


describe("MAT-177 schema robustness + drop blockers", () => {
  it("maps drop_columns without x-dtk-widget to columns chips", () => {
    const oldEngine: JsonSchema = {
      type: "object",
      properties: {
        columns: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          title: "Columns",
        },
        missing_ok: { type: "boolean", default: false, title: "Missing Ok" },
      },
      required: ["columns"],
    };
    const fields = schemaToFields(oldEngine, "drop_columns");
    expect(fields.find((f) => f.key === "columns")?.widget).toBe("columns");
    expect(schemaFieldsGap(oldEngine, fields)).toBeNull();
  });

  it("resolves local $ref so required columns is not silently dropped", () => {
    const refSchema: JsonSchema = {
      type: "object",
      properties: {
        columns: { $ref: "#/$defs/ColumnsList" },
      },
      required: ["columns"],
      $defs: {
        ColumnsList: {
          type: "array",
          items: { type: "string" },
          title: "Columns",
          minItems: 1,
          "x-dtk-widget": "columns",
        },
      },
    };
    const fields = schemaToFields(refSchema, "drop_columns");
    expect(fields.map((f) => f.key)).toContain("columns");
    expect(fields[0]?.widget).toBe("columns");
    expect(schemaFieldsGap(refSchema, fields)).toBeNull();
  });

  it("reports a schema gap when required params yield no fields", () => {
    const broken: JsonSchema = {
      type: "object",
      properties: {
        columns: { $ref: "#/$defs/Missing" },
      },
      required: ["columns"],
    };
    const fields = schemaToFields(broken, "drop_columns");
    expect(fields).toEqual([]);
    expect(schemaFieldsGap(broken, fields)).toMatch(/required params: columns/);
  });

  it("flags identical consecutive steps and already-gone columns", () => {
    const prev = {
      op: "drop_columns",
      target: "both",
      params: { columns: ["time_since_diagnosis"] },
    };
    expect(
      stepsAreIdentical(prev, {
        op: "drop_columns",
        target: "both",
        params: { columns: ["time_since_diagnosis"] },
      }),
    ).toBe(true);

    // Already-gone wins even when the previous step is the identical drop.
    expect(
      stepEditorBlockers(
        "drop_columns",
        { columns: ["time_since_diagnosis"] },
        "both",
        {
          availableColumns: ["Index", "age"],
          previousStep: prev,
        },
      ),
    ).toMatch(/already gone/);

    expect(
      stepEditorBlockers(
        "drop_columns",
        { columns: ["Index"] },
        "both",
        {
          availableColumns: ["Index", "age"],
          previousStep: {
            op: "drop_columns",
            target: "both",
            params: { columns: ["Index"] },
          },
        },
      ),
    ).toMatch(/identical to the previous/);

    expect(
      stepEditorBlockers(
        "drop_columns",
        { columns: ["Index"] },
        "both",
        {
          availableColumns: ["Index", "age"],
          previousStep: prev,
        },
      ),
    ).toBeNull();
  });

  it("blocks polynomial / power / quantile when columns have missing (MAT-191)", () => {
    const missingByColumn = { age: 1, sessions: 0, monthly_spend: 0 };

    expect(
      featureOpColumnsNeedingImpute(
        "polynomial",
        { columns: ["age", "sessions"] },
        missingByColumn,
      ),
    ).toEqual(["age"]);

    expect(
      stepEditorBlockers(
        "polynomial",
        { columns: ["age", "sessions"], degree: 2 },
        "both",
        {
          availableColumns: ["age", "sessions", "monthly_spend"],
          previousStep: null,
          missingByColumn,
        },
      ),
    ).toMatch(/Impute missing values first.*age/);

    expect(
      stepEditorBlockers(
        "power_transform",
        { columns: ["age", "sessions"] },
        "both",
        {
          availableColumns: ["age", "sessions"],
          previousStep: null,
          missingByColumn,
        },
      ),
    ).toMatch(/Impute missing values first/);

    expect(
      stepEditorBlockers(
        "quantile_transform",
        { columns: ["monthly_spend", "sessions"] },
        "both",
        {
          availableColumns: ["age", "sessions", "monthly_spend"],
          previousStep: null,
          missingByColumn,
        },
      ),
    ).toBeNull();

    expect(
      featureOpColumnsNeedingImpute(
        "scale",
        { columns: ["age"] },
        missingByColumn,
      ),
    ).toEqual([]);
  });
});
