import { describe, expect, it } from "vitest";

import type { Result } from "../src/api/types";
import {
  filterCardsByStage,
  inconsistencySignals,
  mapSuggestionCards,
  remapFreeTextDrop,
} from "../src/bench/left/suggestions";

function stepsResult(): Result {
  return {
    metrics: { n_recommendations: 2 },
    tables: [
      {
        title: "recommendations",
        kind: "steps",
        records: [
          {
            order: 1,
            column: "(rows)",
            category: "rows",
            severity: "warning",
            advice: "2 exact duplicate train rows",
            op: "drop_duplicates",
            target: "train",
            params: { keep: "first", sort_by: ["customer_id"] },
          },
          {
            order: 2,
            column: "age",
            category: "missing",
            severity: "info",
            advice: "impute with median",
            op: "impute",
            target: "both",
            params: { columns: ["age"], strategy: "median" },
          },
        ],
      },
    ],
    figures: [],
    text: "",
  };
}

function findingResult(): Result {
  return {
    metrics: { n_exact_duplicates: 2, rows: 20 },
    tables: [{ title: "exact duplicates", records: [{ a: 1 }] }],
    figures: [],
    text: "Exact duplicates found.",
  };
}

function duplicatesNoSubsetResult(): Result {
  return {
    metrics: { rows: 10, n_exact_duplicates: 0, subset: "" },
    tables: [{ title: "exact duplicates", records: [] }],
    figures: [],
    text:
      "No identity columns detected: pass `subset` to look for partial " +
      "duplicates and conflicts. Exact duplicates carry no information.",
  };
}

function inconsistenciesResult(): Result {
  return {
    metrics: {
      n_columns_with_variants: 1,
      n_mixed_date_format_columns: 1,
    },
    tables: [
      {
        title: "variants",
        records: [
          {
            column: "city",
            distinct_before: 5,
            distinct_after: 2,
            n_merged: 3,
          },
        ],
      },
      {
        title: "suggested mapping",
        records: [
          { column: "city", canonical: "Paris", variant: "paris", count: 1 },
          { column: "city", canonical: "Paris", variant: "Paris", count: 1 },
        ],
      },
      {
        title: "mixed date formats",
        records: [
          {
            column: "date",
            n_formats: 2,
            formats: "yyyy-mm-dd, nn/nn/yyyy",
          },
        ],
      },
    ],
    figures: [],
    text: "Apply the suggested mapping.",
  };
}

function freeTextDropSteps(): Result {
  return {
    metrics: {},
    tables: [
      {
        title: "recommendations",
        kind: "steps",
        records: [
          {
            column: "city",
            category: "drop",
            advice:
              "free text: no text-feature op yet; drop it or engineer features first",
            op: "drop_columns",
            target: "both",
            params: { columns: ["city"], missing_ok: true },
          },
          {
            column: "date",
            category: "drop",
            advice:
              "free text: no text-feature op yet; drop it or engineer features first",
            op: "drop_columns",
            target: "both",
            params: { columns: ["date"], missing_ok: true },
          },
          {
            column: "notes",
            category: "drop",
            advice:
              "free text: no text-feature op yet; drop it or engineer features first",
            op: "drop_columns",
            target: "both",
            params: { columns: ["notes"], missing_ok: true },
          },
        ],
      },
    ],
    figures: [],
    text: "",
  };
}

describe("mapSuggestionCards", () => {
  it("maps kind:steps rows to open-in-editor cards with Step payloads", () => {
    const cards = mapSuggestionCards([
      { keyId: "preprocessing_advisor", result: stepsResult() },
    ]);
    expect(cards).toHaveLength(2);
    expect(cards[0]!.step).toEqual({
      op: "drop_duplicates",
      target: "train",
      params: { keep: "first", sort_by: ["customer_id"] },
    });
    expect(cards[0]!.stage).toBe("clean");
    expect(cards[0]!.column).toBeNull();
    expect(cards[1]!.step?.op).toBe("impute");
    expect(cards[1]!.column).toBe("age");
    expect(cards[1]!.stage).toBe("clean");
  });

  it("maps non-steps findings to cards without a step", () => {
    const cards = mapSuggestionCards([
      { keyId: "duplicates", result: findingResult() },
    ]);
    expect(cards.some((c) => c.step === null)).toBe(true);
    expect(cards.some((c) => c.detail.includes("Exact duplicates"))).toBe(
      true,
    );
    expect(cards.every((c) => c.stage === "clean")).toBe(true);
  });

  it("exposes a subset picker for duplicates with no identity columns (MAT-155 #1)", () => {
    const cards = mapSuggestionCards([
      { keyId: "duplicates", result: duplicatesNoSubsetResult() },
    ]);
    const subsetCard = cards.find((c) => c.pickSubset);
    expect(subsetCard).toBeTruthy();
    expect(subsetCard!.step?.op).toBe("drop_duplicates");
    expect(subsetCard!.detail).toMatch(/pass `subset`/i);
  });

  it("remaps free-text drop_columns to standardize_text / parse_dates (MAT-155 #2)", () => {
    const cards = mapSuggestionCards([
      { keyId: "preprocessing_advisor", result: freeTextDropSteps() },
      { keyId: "inconsistencies", result: inconsistenciesResult() },
    ]);
    const city = cards.find((c) => c.column === "city");
    const date = cards.find((c) => c.column === "date");
    const notes = cards.find((c) => c.column === "notes");
    expect(city!.step?.op).toBe("standardize_text");
    expect(city!.step?.params).toMatchObject({
      columns: ["city"],
      strip: true,
      lower: true,
      mapping: { paris: "Paris" },
    });
    expect(date!.step?.op).toBe("parse_dates");
    expect(date!.step?.params).toEqual({ columns: ["date"] });
    // No inconsistency signal → keep drop_columns
    expect(notes!.step?.op).toBe("drop_columns");
  });

  it("filters by course stage", () => {
    const cards = mapSuggestionCards([
      {
        keyId: "preprocessing_advisor",
        result: {
          metrics: {},
          tables: [
            {
              title: "recommendations",
              kind: "steps",
              records: [
                {
                  column: "city",
                  category: "encoding",
                  advice: "one-hot",
                  op: "onehot",
                  target: "both",
                  params: { columns: ["city"] },
                },
                {
                  column: "customer_id",
                  category: "drop",
                  advice: "identifier",
                  op: "drop_columns",
                  target: "both",
                  params: { columns: ["customer_id"] },
                },
              ],
            },
          ],
          figures: [],
          text: "",
        },
      },
    ]);
    expect(filterCardsByStage(cards, "all")).toHaveLength(2);
    expect(filterCardsByStage(cards, "transform").map((c) => c.column)).toEqual(
      ["city"],
    );
    expect(filterCardsByStage(cards, "select").map((c) => c.column)).toEqual([
      "customer_id",
    ]);
  });
});

describe("inconsistencySignals / remapFreeTextDrop", () => {
  it("reads variants and date-format columns from inconsistencies tables", () => {
    const s = inconsistencySignals(inconsistenciesResult());
    expect([...s.variantCols]).toEqual(["city"]);
    expect([...s.dateCols]).toEqual(["date"]);
    expect(s.mappings.get("city")).toEqual({ paris: "Paris" });
  });

  it("returns null when advice is not a free-text drop", () => {
    expect(
      remapFreeTextDrop(
        { op: "impute", target: "both", params: {} },
        "city",
        "impute with median",
        {
          variantCols: new Set(["city"]),
          dateCols: new Set(),
          mappings: new Map(),
        },
      ),
    ).toBeNull();
  });
});
