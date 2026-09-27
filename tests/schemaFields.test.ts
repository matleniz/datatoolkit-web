import { describe, expect, it } from "vitest";

import type { JsonSchema } from "../src/api/types";
import {
  defaultParams,
  schemaToFields,
  stepParamsValid,
} from "../src/bench/schemaFields";
import { toEngineParams } from "../src/bench/presets";

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
});

describe("toEngineParams", () => {
  it("converts prototype column/values to sentinels map", () => {
    expect(
      toEngineParams("replace_sentinels", { column: "age", values: [-999] }),
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
