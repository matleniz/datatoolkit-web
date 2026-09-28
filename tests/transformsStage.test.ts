import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import { OP_STAGE, EXCLUDED_OPS, FITTING_OPS } from "../src/bench/stages";
import { schemaToFields } from "../src/bench/schemaFields";
import type { JsonSchema } from "../src/api/types";

const fixturesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
);

function loadTransformsList(): { op: string; title: string }[] {
  const py = "/home/matleniz/datatoolkit/.venv/bin/python";
  if (existsSync(py)) {
    try {
      const out = execSync(
        `${py} -c "from dtk_engine import contract; import json; print(json.dumps(contract.list_transforms()))"`,
        { encoding: "utf8" },
      );
      const parsed = JSON.parse(out);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    } catch {
      // fallback to fixture
    }
  }
  const fixturePath = join(fixturesDir, "transforms.json");
  return JSON.parse(readFileSync(fixturePath, "utf8"));
}

function loadSchema(op: string): JsonSchema {
  const fixturePath = join(fixturesDir, "schemas", `${op}.json`);
  return JSON.parse(readFileSync(fixturePath, "utf8"));
}

describe("transforms stage mapping and exclusion", () => {
  const transforms = loadTransformsList();

  it("loads a complete list of transforms (at least 30)", () => {
    expect(transforms.length).toBeGreaterThanOrEqual(30);
  });

  it("every op from the transforms list is either mapped to a stage or in an explicit exclusion list with a reason", () => {
    for (const t of transforms) {
      const isMapped = OP_STAGE[t.op] !== undefined;
      const exclusionReason = EXCLUDED_OPS[t.op];
      const isExcludedWithReason =
        typeof exclusionReason === "string" && exclusionReason.trim().length > 0;

      expect(
        isMapped || isExcludedWithReason,
        `Expected transform '${t.op}' to be either mapped in OP_STAGE or listed in EXCLUDED_OPS with a reason`,
      ).toBe(true);
    }
  });

  it("drop_missing_target is declared as a fitting op", () => {
    expect(FITTING_OPS.has("drop_missing_target")).toBe(true);
  });

  it("every new op from MAT-150 / MAT-160 has usable editor fields", () => {
    const newOps = [
      "ffill",
      "impute_knn",
      "impute_iterative",
      "drop_missing_target",
      "bin",
      "interactions",
      "group_agg",
      "cyclical",
      "drop_low_variance",
      "drop_correlated",
      "select_k_best",
      "select_from_model",
      "pca",
      "filter_rows",
      "to_numeric",
      "drop_high_missing",
    ];

    for (const op of newOps) {
      const schema = loadSchema(op);
      const fields = schemaToFields(schema, op);
      expect(fields.length).toBeGreaterThan(0);
      for (const f of fields) {
        expect(
          [
            "columns",
            "column",
            "enum",
            "enum_list",
            "number_list",
            "string_list",
            "bool",
            "number",
            "text",
            "sentinels",
            "categories",
            "mapping",
            "dtypes",
            "formula",
            "variables",
            "conditions",
            "object",
          ],
        ).toContain(f.widget);
      }
    }
  });

  it("to_numeric maps decimal/errors enums and nullable thousands", () => {
    const schema = loadSchema("to_numeric");
    const fields = schemaToFields(schema, "to_numeric");
    expect(fields.find((f) => f.key === "columns")?.widget).toBe("columns");
    expect(fields.find((f) => f.key === "decimal")?.enumValues).toEqual([
      ".",
      ",",
    ]);
    const thousands = fields.find((f) => f.key === "thousands");
    expect(thousands?.widget).toBe("enum");
    expect(thousands?.enumValues).toContain(",");
    expect(thousands?.enumValues).toContain("__null__");
    expect(fields.find((f) => f.key === "percent")?.widget).toBe("bool");
  });

  it("drop_high_missing is a fitting clean-stage op with threshold + target", () => {
    expect(OP_STAGE.drop_high_missing).toBe("clean");
    expect(OP_STAGE.to_numeric).toBe("clean");
    expect(FITTING_OPS.has("drop_high_missing")).toBe(true);
    const schema = loadSchema("drop_high_missing");
    const fields = schemaToFields(schema, "drop_high_missing");
    expect(fields.find((f) => f.key === "threshold")?.widget).toBe("number");
    expect(fields.find((f) => f.key === "target")?.widget).toBe("column");
    expect(fields.find((f) => f.key === "exclude")?.widget).toBe("columns");
  });

  it("standardize_text schema exposes unify_separators", () => {
    const schema = loadSchema("standardize_text");
    const fields = schemaToFields(schema, "standardize_text");
    expect(fields.find((f) => f.key === "unify_separators")?.widget).toBe(
      "bool",
    );
  });

  it("filter_rows maps conditions to conditions widget and combine to enum", () => {
    const schema = loadSchema("filter_rows");
    const fields = schemaToFields(schema, "filter_rows");
    const condField = fields.find((f) => f.key === "conditions");
    const combineField = fields.find((f) => f.key === "combine");
    expect(condField?.widget).toBe("conditions");
    expect(condField?.enumValues).toContain("gt");
    expect(condField?.enumValues).toContain("notna");
    expect(combineField?.widget).toBe("enum");
    expect(combineField?.enumValues).toEqual(["and", "or"]);
  });

  it("bin maps edges to number_list and labels to string_list", () => {
    const schema = loadSchema("bin");
    const fields = schemaToFields(schema, "bin");
    const edgesField = fields.find((f) => f.key === "edges");
    const labelsField = fields.find((f) => f.key === "labels");
    expect(edgesField?.widget).toBe("number_list");
    expect(labelsField?.widget).toBe("string_list");
  });

  it("group_agg maps aggs to enum_list", () => {
    const schema = loadSchema("group_agg");
    const fields = schemaToFields(schema, "group_agg");
    const aggsField = fields.find((f) => f.key === "aggs");
    expect(aggsField?.widget).toBe("enum_list");
    expect(aggsField?.enumValues).toContain("mean");
  });

  it("ffill has sort_by column picker and columns picker", () => {
    const schema = loadSchema("ffill");
    const fields = schemaToFields(schema, "ffill");
    const sortField = fields.find((f) => f.key === "sort_by");
    const colsField = fields.find((f) => f.key === "columns");
    expect(sortField?.widget).toBe("column");
    expect(colsField?.widget).toBe("columns");
  });
});
