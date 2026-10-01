import { describe, expect, it } from "vitest";
import {
  EMPTY_PREVIEW,
  EMPTY_TRAIN_MESSAGE,
  clearedByOptionsEdit,
  trainParseErrorDisplay,
  trainStatus,
  visibleEngineErrors,
} from "../src/screens/sources/sourcesScreenLogic";
import type { SourceFileItem } from "../src/screens/sources/sourcesLogic";

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
