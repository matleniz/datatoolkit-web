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
import {
  pickerPreset,
  seedEditorParams,
  toEngineParams,
} from "../src/bench/presets";
import {
  coerceImputeFillValue,
  defaultParams,
  dropInactiveParams,
  fieldActive,
  prefillSemanticParams,
  featureOpColumnsNeedingImpute,
  imputeConstantNeedsNumber,
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
    fill_value: {
      type: "string",
      title: "Constant value",
      "x-dtk-when": { strategy: "constant" },
    },
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
    expect(fields[2]?.when).toEqual({ strategy: ["constant"] });
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

  it("coerceImputeFillValue sends a number for numeric columns (MAT-205)", () => {
    const cols = [
      { name: "age", kind: "number" as const },
      { name: "city", kind: "text" as const },
    ];
    expect(
      imputeConstantNeedsNumber(
        { columns: ["age"], strategy: "constant", fill_value: "0" },
        cols,
      ),
    ).toBe(true);
    expect(
      coerceImputeFillValue(
        { columns: ["age"], strategy: "constant", fill_value: "0" },
        cols,
      ),
    ).toEqual({ columns: ["age"], strategy: "constant", fill_value: 0 });
    expect(
      coerceImputeFillValue(
        { columns: ["age"], strategy: "constant", fill_value: 42 },
        cols,
      ).fill_value,
    ).toBe(42);
    // Categorical: keep string.
    expect(
      imputeConstantNeedsNumber(
        { columns: ["city"], strategy: "constant", fill_value: "MISSING" },
        cols,
      ),
    ).toBe(false);
    expect(
      coerceImputeFillValue(
        { columns: ["city"], strategy: "constant", fill_value: "MISSING" },
        cols,
      ).fill_value,
    ).toBe("MISSING");
    // Non-constant strategy: no-op.
    expect(
      coerceImputeFillValue(
        { columns: ["age"], strategy: "median", fill_value: "0" },
        cols,
      ).fill_value,
    ).toBe("0");
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
  it("impute: x-dtk-when / x-dtk-semantic hints of the group strategies", () => {
    const fields = schemaToFields(loadSchema("impute"), "impute");
    expect(fields.map((f) => f.key)).toEqual([
      "columns",
      "strategy",
      "fill_value",
      "expr",
      "by",
      "order",
      "fallback",
      "add_indicator",
    ]);
    const byKey = Object.fromEntries(fields.map((f) => [f.key, f]));
    expect(byKey.strategy?.enumValues).toEqual([
      "median",
      "mean",
      "most_frequent",
      "constant",
      "formula",
      "group_mean",
      "group_prev",
      "group_interp",
    ]);
    expect(byKey.fill_value?.when).toEqual({ strategy: ["constant"] });
    expect(byKey.expr?.widget).toBe("formula");
    expect(byKey.expr?.when).toEqual({ strategy: ["formula"] });
    expect(byKey.by?.widget).toBe("column");
    expect(byKey.by?.semantic).toBe("group_id");
    expect(byKey.by?.when).toEqual({
      strategy: ["group_mean", "group_prev", "group_interp"],
    });
    expect(byKey.order?.when).toEqual({ strategy: ["group_prev", "group_interp"] });
    expect(byKey.order?.semantic).toBeUndefined();
    expect(byKey.fallback?.enumValues).toEqual([
      "median",
      "mean",
      "most_frequent",
      "__null__",
    ]);
    expect(byKey.add_indicator?.widget).toBe("bool");
    expect(byKey.add_indicator?.when).toBeUndefined();
  });

  it("ffill: by carries x-dtk-semantic and no x-dtk-when", () => {
    const by = schemaToFields(loadSchema("ffill"), "ffill").find((f) => f.key === "by");
    expect(by?.semantic).toBe("group_id");
    expect(by?.when).toBeUndefined();
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

describe("toEngineParams (schema-driven)", () => {
  const sentinels = loadSchema("replace_sentinels");

  it("places column/values into the sentinels map", () => {
    expect(
      toEngineParams("replace_sentinels", { column: "age", values: [-999] }, sentinels),
    ).toEqual({ sentinels: { age: [-999] } });
  });

  it("places column/values even when empty sentinels {} is present", () => {
    expect(
      toEngineParams(
        "replace_sentinels",
        { sentinels: {}, column: "age", values: [-999] },
        sentinels,
      ),
    ).toEqual({ sentinels: { age: [-999] } });
  });

  it("keeps a non-empty sentinels map", () => {
    expect(
      toEngineParams(
        "replace_sentinels",
        { sentinels: { age: [-999] }, column: "other", values: [0] },
        sentinels,
      ),
    ).toEqual({ sentinels: { age: [-999] } });
  });

  it("wraps a single column into the schema's columns param", () => {
    expect(
      toEngineParams("impute", { column: "age", strategy: "median" }, loadSchema("impute")),
    ).toEqual({ columns: ["age"], strategy: "median" });
  });

  it("puts a single column into a required single-column param", () => {
    expect(
      toEngineParams("ffill", { column: "ts" }, loadSchema("ffill")),
    ).toEqual({ sort_by: "ts" });
    expect(
      toEngineParams("drop_missing_target", { column: "y" }, loadSchema("drop_missing_target")),
    ).toEqual({ target: "y" });
  });

  it("keys rename / cast by the column", () => {
    expect(
      toEngineParams("rename", { column: "a", to: "b" }, loadSchema("rename")),
    ).toEqual({ mapping: { a: "b" } });
    expect(toEngineParams("cast", { column: "a" }, loadSchema("cast"))).toEqual({
      dtypes: { a: "float" },
    });
  });

  it("keeps column for ops that take one", () => {
    expect(
      toEngineParams("bin", { column: "age", mode: "cut", edges: "0, 10, x" }, loadSchema("bin")),
    ).toEqual({ column: "age", mode: "cut", edges: [0, 10] });
  });

  it("maps map_value onto standardize_text params, idempotently", () => {
    const once = toEngineParams("map_value", {
      column: "city",
      from: "PARIS",
      to: "paris",
    });
    expect(once).toEqual({
      columns: ["city"],
      strip: false,
      lower: false,
      mapping: { PARIS: "paris" },
    });
    expect(toEngineParams("map_value", once)).toEqual(once);
    expect(toEngineParams("map_value", { column: "city" })).toEqual({
      columns: ["city"],
      strip: false,
      lower: false,
      mapping: {},
    });
  });

  it("an op unknown to the front needs no entry: schema slot, defaults, picker", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        columns: {
          type: "array",
          items: { type: "string" },
          "x-dtk-widget": "columns",
          "x-dtk-dtype": "numeric",
        },
        factor: { type: "number", default: 2 },
      },
      required: ["columns"],
    };
    expect(seedEditorParams(schema, "new_op", { column: "x" }, [])).toEqual({
      columns: ["x"],
      factor: 2,
    });
    const selection = [
      { name: "x", kind: "number" as const },
      { name: "city", kind: "text" as const },
    ];
    expect(pickerPreset(schema, "new_op", selection, null, new Map())).toEqual({
      columns: ["x"],
    });
  });
});

describe("seedEditorParams / pickerPreset", () => {
  it("drop_duplicates keep first/last falls back to the identifier, else keep none", () => {
    const schema = loadSchema("drop_duplicates");
    expect(seedEditorParams(schema, "drop_duplicates", {}, []).keep).toBe("none");
    const first = { keep: "first" };
    expect(
      seedEditorParams(schema, "drop_duplicates", first, [
        { name: "id", kind: "identifier" },
      ]).sort_by,
    ).toEqual(["id"]);
    expect(seedEditorParams(schema, "drop_duplicates", first, [])).toMatchObject({
      keep: "none",
      sort_by: null,
    });
  });

  it("seeds single-column params in selection order, honouring dtype", () => {
    const selection = [
      { name: "city", kind: "text" as const },
      { name: "spend", kind: "number" as const },
    ];
    expect(
      pickerPreset(loadSchema("group_agg"), "group_agg", selection, "churn", new Map()),
    ).toEqual({ group: "city", value: "spend", target: "churn" });
  });

  it("seeds the dataset target, else the selection for a required target", () => {
    const sel = [{ name: "y", kind: "number" as const }];
    const schema = loadSchema("drop_missing_target");
    expect(pickerPreset(schema, "drop_missing_target", sel, "churn", new Map())).toEqual({
      target: "churn",
    });
    expect(pickerPreset(schema, "drop_missing_target", sel, null, new Map())).toEqual({
      target: "y",
    });
  });

  it("seeds a column-keyed op from the first selected column", () => {
    const sel = [{ name: "age", kind: "number" as const }];
    const schema = loadSchema("replace_sentinels");
    const preset = pickerPreset(schema, "replace_sentinels", sel, null, new Map());
    expect(toEngineParams("replace_sentinels", preset, schema)).toEqual({
      sentinels: { age: [-999] },
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

describe("x-dtk-when (datatoolkit-issues#48)", () => {
  const schema: JsonSchema = {
    type: "object",
    properties: {
      mode: { type: "string", enum: ["a", "b", "c"], default: "a" },
      scalar: { type: "string", "x-dtk-when": { mode: "b" } },
      listed: { type: "string", "x-dtk-when": { mode: ["b", "c"] } },
      both: { type: "string", "x-dtk-when": { mode: "c", flag: true } },
      flag: { type: "boolean" },
    },
    required: ["scalar", "listed"],
  };
  const fields = schemaToFields(schema, "anything");
  const field = (k: string) => fields.find((f) => f.key === k)!;

  it("normalises a scalar value to a one-item list", () => {
    expect(field("scalar").when).toEqual({ mode: ["b"] });
    expect(field("listed").when).toEqual({ mode: ["b", "c"] });
    expect(field("mode").when).toBeUndefined();
  });

  it("applies a field only when every sibling matches one of its values", () => {
    expect(fieldActive(field("scalar"), { mode: "a" })).toBe(false);
    expect(fieldActive(field("scalar"), { mode: "b" })).toBe(true);
    expect(fieldActive(field("listed"), { mode: "a" })).toBe(false);
    expect(fieldActive(field("listed"), { mode: "b" })).toBe(true);
    expect(fieldActive(field("listed"), { mode: "c" })).toBe(true);
    expect(fieldActive(field("both"), { mode: "c" })).toBe(false);
    expect(fieldActive(field("both"), { mode: "c", flag: true })).toBe(true);
    expect(fieldActive(field("mode"), {})).toBe(true);
  });

  it("skips inactive required fields in validation", () => {
    expect(stepParamsValid("anything", { mode: "a" }, fields).ok).toBe(true);
    expect(stepParamsValid("anything", { mode: "c" }, fields)).toEqual({
      ok: false,
      missing: "Missing listed",
    });
    expect(
      stepParamsValid("anything", { mode: "b", scalar: "x", listed: "y" }, fields).ok,
    ).toBe(true);
  });

  it("drops the params of inactive fields only", () => {
    expect(
      dropInactiveParams({ mode: "a", scalar: "x", listed: "y", flag: true }, fields),
    ).toEqual({ mode: "a", flag: true });
    expect(
      dropInactiveParams({ mode: "c", scalar: "x", listed: "y" }, fields),
    ).toEqual({ mode: "c", listed: "y" });
  });
});

describe("x-dtk-semantic prefill (datatoolkit-issues#48)", () => {
  const fields = schemaToFields(loadSchema("impute"), "impute");
  const col = (name: string, semantic: string) => ({ name, semantic });

  it("prefills the only column of the matching semantic", () => {
    const out = prefillSemanticParams(
      { columns: ["bmi"] },
      fields,
      [col("patient_id", "group_id"), col("bmi", "numeric")],
    );
    expect(out).toEqual({ columns: ["bmi"], by: "patient_id" });
  });

  it("leaves the param empty with no or several matching columns", () => {
    expect(
      prefillSemanticParams({ columns: ["bmi"] }, fields, [col("bmi", "numeric")]),
    ).toEqual({ columns: ["bmi"] });
    expect(
      prefillSemanticParams({ columns: ["bmi"] }, fields, [
        col("patient_id", "group_id"),
        col("site_id", "group_id"),
        col("bmi", "numeric"),
      ]),
    ).toEqual({ columns: ["bmi"] });
  });

  it("never overrides a value already set; columns without semantic are ignored", () => {
    expect(
      prefillSemanticParams({ by: "site_id" }, fields, [col("patient_id", "group_id")]),
    ).toEqual({ by: "site_id" });
    expect(
      prefillSemanticParams({}, fields, [{ name: "patient_id" }]),
    ).toEqual({});
  });

  it("seeds the editor: by prefilled, hidden until a group strategy", () => {
    const schema = loadSchema("impute");
    const params = seedEditorParams(schema, "impute", { column: "bmi" }, [
      { name: "patient_id", kind: "identifier", semantic: "group_id" },
      { name: "bmi", kind: "numeric", semantic: "numeric" },
    ]);
    expect(params).toMatchObject({ columns: ["bmi"], strategy: "median", by: "patient_id" });
    const by = fields.find((f) => f.key === "by")!;
    expect(fieldActive(by, params)).toBe(false);
    expect(fieldActive(by, { ...params, strategy: "group_interp" })).toBe(true);
    expect(dropInactiveParams(params, fields)).not.toHaveProperty("by");
  });
});
