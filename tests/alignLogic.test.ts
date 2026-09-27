import { describe, expect, it } from "vitest";
import type { AlignReportRow } from "../src/api/types";
import {
  computeRowFixes,
  countAlignStatuses,
  formatAlignmentStep,
  isSimilarCandidate,
  stringSimilarityRatio,
} from "../src/screens/align/alignLogic";

describe("alignLogic pure mapping", () => {
  it("formats alignment steps correctly", () => {
    expect(
      formatAlignmentStep({
        op: "rename",
        target: "test",
        params: { mapping: { nb_support_calls: "support_calls" } },
        align: true,
      }),
    ).toBe("rename · nb_support_calls → support_calls · test");

    expect(
      formatAlignmentStep({
        op: "drop_columns",
        target: "test",
        params: { columns: ["promo_code"] },
        align: true,
      }),
    ).toBe("drop_columns · promo_code · test");

    expect(
      formatAlignmentStep({
        op: "cast",
        target: "test",
        params: { dtypes: { monthly_spend: "float" } },
        align: true,
      }),
    ).toBe("cast · monthly_spend → float · test");
  });

  it("handles type mismatch with numbers_as_text", () => {
    const row: AlignReportRow = {
      train: { name: "monthly_spend", kind: "number", samples: [42.5] },
      test: { name: "monthly_spend", kind: "text", samples: ["41,0"] },
      status: "type_mismatch",
      numbers_as_text: true,
      train_mean: 42.5,
      test_mean: null,
      similar: [],
    };

    const fixes = computeRowFixes(
      row,
      [],
      "SourceError: could not convert string to float: '41,0'",
    );

    expect(fixes.note).toBe(
      "Test stores numbers as text with a comma decimal.",
    );
    expect(fixes.actions).toHaveLength(2);
    expect(fixes.actions[0]!.label).toBe('Re-read test with decimal ","');
    expect(fixes.actions[0]!.type).toBe("set_decimal");
    expect(fixes.actions[0]!.decimal).toBe(",");
    expect(fixes.actions[0]!.primary).toBe(true);

    expect(fixes.actions[1]!.label).toBe("Cast test to float");
    expect(fixes.actions[1]!.disabled).toBe(true);
    expect(fixes.actions[1]!.tip).toContain("could not convert");
  });

  it("handles missing in test with similar names", () => {
    const row: AlignReportRow = {
      train: { name: "support_calls", kind: "number", samples: [0, 2] },
      test: null,
      status: "missing_in_test",
      numbers_as_text: false,
      train_mean: 1.0,
      test_mean: null,
      similar: ["nb_support_calls"],
    };

    const testOnly = ["promo_code", "nb_support_calls"];
    const fixes = computeRowFixes(row, testOnly);

    expect(fixes.note).toBe(
      "Match it with a test-only column (renames it in test), or drop it from train.",
    );
    // nb_support_calls should be prioritized because it's similar
    expect(fixes.actions[0]!.label).toBe("↔ nb_support_calls (similar name)");
    expect(fixes.actions[0]!.step).toEqual({
      op: "rename",
      target: "test",
      params: { mapping: { nb_support_calls: "support_calls" } },
      align: true,
    });

    // promo_code is not similar to support_calls, so no "(similar name)" label
    expect(fixes.actions[1]!.label).toBe("↔ promo_code");
    expect(fixes.actions[1]!.step).toEqual({
      op: "rename",
      target: "test",
      params: { mapping: { promo_code: "support_calls" } },
      align: true,
    });

    const dropTrain = fixes.actions.find((a) => a.label === "Drop from train");
    expect(dropTrain).toBeDefined();
    expect(dropTrain?.step).toEqual({
      op: "drop_columns",
      target: "train",
      params: { columns: ["support_calls"] },
      align: true,
    });
  });

  it("handles extra in test", () => {
    const row: AlignReportRow = {
      train: null,
      test: { name: "promo_code", kind: "text", samples: ["SPRING"] },
      status: "extra_in_test",
      numbers_as_text: false,
      train_mean: null,
      test_mean: null,
      similar: [],
    };

    const fixes = computeRowFixes(row, ["promo_code"]);
    expect(fixes.note).toBe(
      "Only in test: a model fitted on train cannot use it.",
    );
    expect(fixes.actions).toHaveLength(1);
    expect(fixes.actions[0]!.label).toBe("Drop from test");
    expect(fixes.actions[0]!.step).toEqual({
      op: "drop_columns",
      target: "test",
      params: { columns: ["promo_code"] },
      align: true,
    });
  });

  it("counts statuses correctly", () => {
    const rows: AlignReportRow[] = [
      {
        train: { name: "c1", kind: "number", samples: [] },
        test: { name: "c1", kind: "number", samples: [] },
        status: "match",
        numbers_as_text: false,
        train_mean: 1,
        test_mean: 1,
        similar: [],
      },
      {
        train: { name: "c2", kind: "number", samples: [] },
        test: { name: "c2", kind: "text", samples: [] },
        status: "type_mismatch",
        numbers_as_text: true,
        train_mean: 1,
        test_mean: null,
        similar: [],
      },
      {
        train: { name: "churn", kind: "bool", samples: [] },
        test: null,
        status: "label",
        numbers_as_text: false,
        train_mean: 0.5,
        test_mean: null,
        similar: [],
      },
    ];

    expect(countAlignStatuses(rows)).toEqual({ ok: 1, fix: 1, info: 1 });
  });
});

describe("stringSimilarityRatio and isSimilarCandidate", () => {
  it("computes difflib-style SequenceMatcher ratio correctly", () => {
    expect(stringSimilarityRatio("support_calls", "promo_code")).toBeLessThan(0.4);
    expect(stringSimilarityRatio("support_calls", "nb_support_calls")).toBeGreaterThan(0.85);
    expect(stringSimilarityRatio("user_id", "userid")).toBeGreaterThan(0.9);
    expect(stringSimilarityRatio("same", "same")).toBe(1);
    expect(stringSimilarityRatio("", "")).toBe(1);
  });

  it("identifies similar candidates via substring inclusion or ratio >= 0.6", () => {
    // Substring inclusion
    expect(isSimilarCandidate("support_calls", "nb_support_calls")).toBe(true);
    expect(isSimilarCandidate("phone", "phone_num")).toBe(true);
    expect(isSimilarCandidate("total_amount", "amount")).toBe(true);

    // High ratio without substring
    expect(isSimilarCandidate("user_id", "userid")).toBe(true);

    // Completely dissimilar
    expect(isSimilarCandidate("support_calls", "promo_code")).toBe(false);
    expect(isSimilarCandidate("age", "city")).toBe(false);
  });
});

