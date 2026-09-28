import { describe, expect, it } from "vitest";

import {
  FORMULA_FUNCS,
  applyFormulaAutocomplete,
  formulaAutocomplete,
  formulaTokenAt,
} from "../src/bench/editor/formulaFuncs";
import { OP_STAGE, FITTING_OPS, stepSubLabel } from "../src/bench/stages";
import {
  defaultParams,
  schemaToFields,
} from "../src/bench/schemaFields";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { JsonSchema } from "../src/api/types";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function loadSchema(op: string): JsonSchema {
  return JSON.parse(
    readFileSync(join(fixturesDir, "schemas", `${op}.json`), "utf8"),
  );
}

describe("MAT-173 formula autocomplete helpers", () => {
  it("extracts the token under the caret", () => {
    expect(formulaTokenAt("where(Ag", 8)).toEqual({
      start: 6,
      end: 8,
      token: "Ag",
    });
    expect(formulaTokenAt("x + @spe", 8)?.token).toBe("@spe");
  });

  it("ranks column and @variable suggestions", () => {
    const cols = formulaAutocomplete("ag", ["age", "sessions", "agency"], []);
    expect(cols[0]).toBe("age");
    expect(cols).toContain("agency");
    expect(
      formulaAutocomplete("@sp", ["age"], ["spend_median", "age_mean"]),
    ).toEqual(["@spend_median"]);
  });

  it("applies a suggestion by replacing the current token", () => {
    const { expr, caret } = applyFormulaAutocomplete("where(Ag", 8, "Age");
    expect(expr).toBe("where(Age");
    expect(caret).toBe("where(Age".length);
  });

  it("palette documents where/clip/isnull", () => {
    const labels = FORMULA_FUNCS.map((f) => f.label);
    expect(labels).toEqual(
      expect.arrayContaining(["where", "clip", "isnull", "log2", "tanh"]),
    );
    expect(FORMULA_FUNCS.every((f) => f.help.length > 0)).toBe(true);
  });
});

describe("MAT-173 feature ops stage + schema fields", () => {
  const ops = [
    "polynomial",
    "power_transform",
    "quantile_transform",
    "spline",
  ] as const;

  it("maps new ops to transform stage and fitting set", () => {
    for (const op of ops) {
      expect(OP_STAGE[op]).toBe("transform");
      expect(FITTING_OPS.has(op)).toBe(true);
    }
  });

  it("schema → editor fields for each new op", () => {
    for (const op of ops) {
      const schema = loadSchema(op);
      const fields = schemaToFields(schema, op);
      expect(fields.length).toBeGreaterThan(0);
      expect(fields.some((f) => f.key === "columns")).toBe(true);
      const defaults = defaultParams(schema, op);
      expect(defaults.columns).toBeUndefined(); // required, no default
    }
  });

  it("stepSubLabel summarises poly / power / quantile", () => {
    expect(
      stepSubLabel("polynomial", { columns: ["a", "b"], degree: 2 }),
    ).toBe("a, b · deg 2");
    expect(
      stepSubLabel("power_transform", {
        columns: ["age"],
        method: "yeo-johnson",
      }),
    ).toBe("age · yeo-johnson");
    expect(
      stepSubLabel("quantile_transform", {
        columns: ["age"],
        output_distribution: "normal",
      }),
    ).toBe("age · normal");
  });
});
