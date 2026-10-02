import { describe, expect, it } from "vitest";
import {
  EMPTY_PREVIEW,
  EMPTY_TRAIN_MESSAGE,
  clearedByOptionsEdit,
  keyJoinReport,
  keyJoinText,
  trainParseErrorDisplay,
  trainStatus,
  visibleEngineErrors,
} from "../src/screens/sources/sourcesScreenLogic";
import type { Result } from "../src/api/types";
import {
  defaultJoinKey,
  effectiveJoinKey,
  type SourceFileItem,
} from "../src/screens/sources/sourcesLogic";

const trainX = (over: Partial<SourceFileItem> = {}): SourceFileItem => ({
  id: "f1",
  name: "train.csv",
  path: "/d/train.csv",
  cols: ["a", "b"],
  detected: "",
  spec: { kind: "csv", path: "/d/train.csv" },
  ...over,
});

describe("trainParseErrorDisplay", () => {
  it("wraps kind mismatches and unnamed errors, keeps engine errors verbatim", () => {
    expect(trainParseErrorDisplay("saved as csv but …")).toMatch(/^Stored train source/);
    expect(trainParseErrorDisplay("SourceError: bad")).toBe("SourceError: bad");
    expect(trainParseErrorDisplay("boom")).toBe("Stored train source failed to parse: boom");
  });
});

describe("trainStatus", () => {
  it("is ready with columns and a path", () => {
    const s = trainStatus(trainX(), EMPTY_PREVIEW, false);
    expect(s.canNavigate).toBe(true);
    expect(s.navigateBlockReason).toBeUndefined();
  });

  it("blocks and hints while loading", () => {
    const s = trainStatus(trainX(), EMPTY_PREVIEW, true);
    expect(s.canNavigate).toBe(false);
    expect(s.emptyTrainHint).toBe("Loading workspace sources…");
  });

  it("flags a 0-column train as empty", () => {
    const s = trainStatus(trainX({ cols: [] }), EMPTY_PREVIEW, false);
    expect(s.emptyTrainHint).toBe(EMPTY_TRAIN_MESSAGE);
    expect(s.navigateBlockReason).toBe(EMPTY_TRAIN_MESSAGE);
  });

  it("surfaces a parse error as the block reason", () => {
    const s = trainStatus(trainX({ parseError: "boom" }), EMPTY_PREVIEW, false);
    expect(s.parseErrorHint).toBe("Stored train source failed to parse: boom");
    expect(s.navigateBlockReason).toBe(s.parseErrorHint);
  });
});

describe("visibleEngineErrors", () => {
  it("hides errors already shown by the banners", () => {
    const status = { emptyTrainHint: "e", parseErrorHint: "p", parseError: "raw" };
    expect(visibleEngineErrors(["e", "p", "raw", "other"], status)).toEqual(["other"]);
  });
});

describe("clearedByOptionsEdit", () => {
  it("clears nothing when the edit still has no columns and no error", () => {
    expect(clearedByOptionsEdit(null, null, false)).toBeNull();
  });
  it("clears the previous parse error after a clean re-parse", () => {
    const pred = clearedByOptionsEdit("old", null, true)!;
    expect(pred("old")).toBe(true);
    expect(pred("Stored train source failed to parse: x")).toBe(true);
    expect(pred("unrelated")).toBe(false);
  });
});

describe("key join helpers", () => {
  it("defaults to the first id-like common column", () => {
    expect(defaultJoinKey(["age", "Index", "patient_id"])).toBe("Index");
    expect(defaultJoinKey(["age", "patient_id"])).toBe("patient_id");
    expect(defaultJoinKey(["age", "city"])).toBe("age");
    expect(defaultJoinKey([])).toBeNull();
  });

  it("keeps a picked key only while it is still common", () => {
    expect(effectiveJoinKey(["a", "id"], "a")).toBe("a");
    expect(effectiveJoinKey(["a", "id"], "gone")).toBe("id");
  });

  it("reads matched counts from label_join_preview", () => {
    const result: Result = {
      metrics: { x_rows: 10, y_rows: 8 },
      tables: [
        {
          title: "candidates",
          records: [
            { mode: "order", key: null, result_rows: 10 },
            {
              mode: "key",
              key: "id",
              match_x_to_y: 0.8,
              match_y_to_x: 1,
              result_rows: 10,
            },
          ],
        },
      ],
      figures: [],
      text: "",
    };
    const report = keyJoinReport(result, "id");
    expect(report).toMatchObject({ matched: 8, xUnmatched: 2, yRows: 8 });
    expect(keyJoinText(report!)).toBe(
      "8 / 8 labels matched on id · 0 lost · 2 train rows without a label",
    );
    expect(keyJoinReport(result, "other")).toBeNull();
  });
});
