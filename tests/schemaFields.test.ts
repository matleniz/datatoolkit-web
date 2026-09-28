import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type { JsonSchema } from "../src/api/types";
import {
  defaultParams,
  resolveSchemaProp,
  schemaToFields,
  stepParamsValid,
  stripNullParams,
} from "../src/bench/schemaFields";
import { toEngineParams } from "../src/bench/presets";

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

  it("resolveSchemaProp unwraps anyOf null unions", () => {
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
