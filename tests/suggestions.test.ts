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
