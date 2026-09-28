import { describe, expect, it } from "vitest";

import type { Result } from "../src/api/types";
import {
  filterCardsByStage,
  mapSuggestionCards,
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

/** Engine-shaped advisor rows after datatoolkit#40 / MAT-165. */
function advisorConsistencySteps(): Result {
  return {
    metrics: {},
    tables: [
      {
        title: "recommendations",
        kind: "steps",
        records: [
          {
            column: "city",
            category: "consistency",
            severity: "info",
            advice:
              "free text, but 1 spelling variants of the same values " +
              "(the inconsistencies key found them): standardize text instead of dropping",
            op: "standardize_text",
            target: "both",
            params: {
              columns: ["city"],
              strip: true,
              lower: true,
              mapping: { paris: "Paris" },
            },
          },
          {
            column: "site",
            category: "consistency",
            severity: "info",
            advice:
              "free text, but 3 spelling variants of the same values " +
              "(the inconsistencies key found them): standardize text instead of dropping",
            op: "standardize_text",
            target: "both",
            params: {
              columns: ["site"],
              strip: true,
              lower: true,
              unify_separators: true,
              mapping: {
                "site-a": "site_a",
                "Site A": "site_a",
                "SITE A": "site_a",
              },
            },
          },
          {
            column: "date",
            category: "consistency",
            severity: "info",
            advice:
              "free text, but it holds dates with mixed / ambiguous formats (the " +
              "inconsistencies key found them): bring them to one format, then " +
              "parse dates instead of dropping",
            op: "parse_dates",
            target: "both",
            params: { columns: ["date"] },
          },
          {
            column: "signup",
            category: "consistency",
            severity: "info",
            advice:
              "free text, but it holds dates in one format (%Y-%m-%d, the " +
              "inconsistencies key found them): parse dates instead of dropping",
            op: "parse_dates",
            target: "both",
            params: { columns: ["signup"], format: "%Y-%m-%d" },
          },
          {
            column: "notes",
            category: "drop",
            severity: "info",
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

  it("renders engine standardize_text / parse_dates cards as-is (MAT-165)", () => {
    const cards = mapSuggestionCards([
      { keyId: "preprocessing_advisor", result: advisorConsistencySteps() },
    ]);
    const city = cards.find((c) => c.column === "city");
    const site = cards.find((c) => c.column === "site");
    const date = cards.find((c) => c.column === "date");
    const signup = cards.find((c) => c.column === "signup");
    const notes = cards.find((c) => c.column === "notes");

    expect(city!.step?.op).toBe("standardize_text");
    expect(city!.step?.params).toMatchObject({
      columns: ["city"],
      strip: true,
      lower: true,
      mapping: { paris: "Paris" },
    });
    expect(city!.stage).toBe("clean");
    expect(city!.title).toBe("city: standardize_text");

    expect(site!.step?.params).toMatchObject({
      unify_separators: true,
      mapping: {
        "site-a": "site_a",
        "Site A": "site_a",
        "SITE A": "site_a",
      },
    });

    expect(date!.step?.op).toBe("parse_dates");
    expect(date!.step?.params).toEqual({ columns: ["date"] });
    expect(date!.stage).toBe("clean");

    expect(signup!.step?.params).toEqual({
      columns: ["signup"],
      format: "%Y-%m-%d",
    });

    // Genuine free text still comes through as drop_columns.
    expect(notes!.step?.op).toBe("drop_columns");
    expect(notes!.stage).toBe("select");
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
