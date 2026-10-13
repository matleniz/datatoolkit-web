import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type { JsonSchema } from "../src/api/types";
import { buildMapping, parseNewValue, rowsOf } from "../src/bench/editor/valueMapping";
import {
  defaultParams,
  schemaFieldsGap,
  schemaToFields,
  stepParamsValid,
} from "../src/bench/schemaFields";
import { stepSubLabel } from "../src/bench/stages";

const here = dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(
  readFileSync(join(here, "fixtures/schemas/replace_values.json"), "utf8"),
) as JsonSchema;

describe("replace_values editor (#198)", () => {
  it("the required mapping param gets its own widget, starting empty", () => {
    const fields = schemaToFields(schema, "replace_values");
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({ key: "mapping", widget: "value_mapping", required: true });
    expect(schemaFieldsGap(schema, fields)).toBeNull();
    expect(defaultParams(schema, "replace_values")).toEqual({ mapping: {} });
  });

  it("is not applicable until one pair is filled", () => {
    const fields = schemaToFields(schema, "replace_values");
    const valid = (mapping: unknown) =>
      stepParamsValid("replace_values", { mapping: mapping as Record<string, unknown> }, fields).ok;
    expect(valid({})).toBe(false);
    expect(valid({ age: { "0": 1 } })).toBe(true);
  });

  it("types the new value from the column kind; empty means missing", () => {
    expect(parseNewValue("", "number")).toBeNull();
    expect(parseNewValue(" 12.5 ", "number")).toBe(12.5);
    expect(parseNewValue("abc", "number")).toBe("abc");
    expect(parseNewValue("true", "bool")).toBe(true);
    expect(parseNewValue("1", "text")).toBe("1");
  });

  it("builds the engine mapping, skipping blank old values and empty columns", () => {
    const kind = (c: string) => (c === "age" ? ("number" as const) : ("text" as const));
    const mapping = buildMapping(
      ["age", "city", "unused"],
      {
        age: [
          { old: "-1", nw: "" },
          { old: "", nw: "9" },
          { old: "N/A", nw: "0" },
        ],
        city: [{ old: "Paris", nw: "FR" }],
        unused: [{ old: "", nw: "" }],
      },
      kind,
    );
    expect(mapping).toEqual({ age: { "-1": null, "N/A": 0 }, city: { Paris: "FR" } });
    expect(rowsOf(mapping.age)).toEqual([
      { old: "-1", nw: "" },
      { old: "N/A", nw: "0" },
    ]);
  });

  it("the pipeline card names the replacements", () => {
    expect(stepSubLabel("replace_values", { mapping: { age: { "-1": null, "N/A": 0 } } })).toBe(
      "age · -1 → NaN, N/A → 0",
    );
  });
});
