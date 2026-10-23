import { describe, expect, it } from "vitest";
import { csvEngineChoices, type JsonSchema } from "../src/api/types";
import {
  isLargeExtraMissing,
  usesNonDefaultEngine,
  withDefaultEngine,
} from "../src/screens/sources/sourcesScreenLogic";

const schema = (engine: JsonSchema): JsonSchema => ({
  type: "object",
  $defs: { CsvSource: { type: "object", properties: { engine } } },
});

describe("csvEngineChoices", () => {
  it("reads the enum from the CsvSource definition, not a hard-coded list", () => {
    expect(
      csvEngineChoices(schema({ enum: ["pandas", "duckdb", "polars"] })),
    ).toEqual(["pandas", "duckdb", "polars"]);
  });

  it("is empty when the schema does not describe an engine", () => {
    expect(csvEngineChoices({ type: "object" })).toEqual([]);
    expect(csvEngineChoices(schema({ type: "string" }))).toEqual([]);
  });
});

describe("engine fallback helpers", () => {
  it("detects a non-default CSV engine only", () => {
    expect(usesNonDefaultEngine({ kind: "csv", path: "a", engine: "duckdb" })).toBe(true);
    expect(usesNonDefaultEngine({ kind: "csv", path: "a", engine: "pandas" })).toBe(false);
    expect(usesNonDefaultEngine({ kind: "csv", path: "a" })).toBe(false);
    expect(usesNonDefaultEngine({ kind: "parquet", path: "a" })).toBe(false);
  });

  it("resets the engine and keeps every other option", () => {
    expect(
      withDefaultEngine({
        kind: "csv",
        path: "a",
        sep: ";",
        na_values: ["-"],
        engine: "duckdb",
      }),
    ).toEqual({ kind: "csv", path: "a", sep: ";", na_values: ["-"] });
  });

  it("recognises the SourceError naming the large extra", () => {
    expect(
      isLargeExtraMissing(
        "SourceError: engine='duckdb' needs the optional extra 'large'",
      ),
    ).toBe(true);
    expect(isLargeExtraMissing("SourceError: file not found")).toBe(false);
    expect(isLargeExtraMissing("ParserError: large"))
      .toBe(false);
    expect(isLargeExtraMissing(null)).toBe(false);
  });
});
