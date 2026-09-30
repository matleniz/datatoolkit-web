import { describe, expect, it } from "vitest";

import {
  FORMULA_FUNCS,
  FORMULA_PY_EXAMPLES,
  NUMPY_FUNCS,
  formulaColumnRef,
  applyFormulaAutocomplete,
  formulaAutocomplete,
  formulaTokenAt,
} from "../src/bench/editor/formulaFuncs";
import { OP_STAGE, FITTING_OPS, stepSubLabel } from "../src/bench/stages";
import { defaultParams, schemaToFields } from "../src/bench/schemaFields";
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
    expect(stepSubLabel("polynomial", { columns: ["a", "b"], degree: 2 })).toBe(
      "a, b · deg 2",
    );
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

describe("MAT-241 python-style formulas", () => {
  it("palette shows the numpy form next to each function", () => {
    const by = Object.fromEntries(FORMULA_FUNCS.map((f) => [f.label, f]));
    expect(by.log1p!.help).toContain("log1p(x) · np.log1p(x)");
    expect(by.where!.help).toContain("np.where(cond, a, b)");
    expect(by.min!.help).toContain("np.minimum(a, b");
    expect(by.isnull!.help).toContain("np.isnan(x)");
    // Every numpy form is accepted by the engine whitelist.
    for (const f of FORMULA_FUNCS) {
      expect(NUMPY_FUNCS).toContain(f.numpy!.slice(3));
    }
  });

  it("offers insertable Python examples", () => {
    const ins = FORMULA_PY_EXAMPLES.map((e) => e.insert);
    expect(ins).toEqual(
      expect.arrayContaining([
        "1 if Age < 18 else 0",
        "np.where(Age > 60, 1, 0)",
        "18 <= Age < 65",
        "np.log1p(Fare)",
        'df["Nom col"] * 2',
      ]),
    );
  });

  it("completes np. / numpy. functions", () => {
    expect(formulaTokenAt("1 + np.lo", 9)?.token).toBe("np.lo");
    expect(formulaTokenAt("xnp.lo", 6)?.token).toBe("lo");
    const lo = formulaAutocomplete("np.lo", ["Age"], []);
    expect(lo).toEqual(["np.log(", "np.log1p(", "np.log2(", "np.log10("]);
    expect(formulaAutocomplete("numpy.where", [], [])).toEqual([
      "numpy.where(",
    ]);
    expect(formulaAutocomplete("np.", [], []).length).toBeGreaterThan(5);
    expect(formulaAutocomplete("np.p", [], [])).toEqual(["np.pi"]);
    const { expr } = applyFormulaAutocomplete("1 + np.lo", 9, "np.log1p(");
    expect(expr).toBe("1 + np.log1p(");
  });

  it('writes non-identifier columns as df["…"]', () => {
    expect(formulaColumnRef("Age")).toBe("Age");
    expect(formulaColumnRef("Nom col")).toBe('df["Nom col"]');
    expect(formulaColumnRef("and")).toBe('df["and"]');
    expect(formulaAutocomplete("no", ["Nom col", "note"], [])).toEqual([
      'df["Nom col"]',
      "note",
    ]);
    const t = formulaTokenAt('df["No', 6);
    expect(t?.token).toBe('df["No');
    expect(formulaAutocomplete('df["No', ["Nom col", "Age"], [])).toEqual([
      'df["Nom col"]',
    ]);
    expect(formulaAutocomplete("@sp", [], ["spend"])).toEqual(["@spend"]);
  });
});
