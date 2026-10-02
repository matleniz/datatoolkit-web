import { describe, expect, it } from "vitest";

import { shouldFoldTabs } from "../src/bench/dock/viewbarFold";

describe("shouldFoldTabs (#73)", () => {
  it("keeps tabs when they fit", () => {
    expect(shouldFoldTabs(744, 500, [100], 6)).toBe(false);
  });
  it("folds when 8 tabs (~950px) exceed a 744px bar wider than 560", () => {
    expect(shouldFoldTabs(744, 950, [110], 6)).toBe(true);
  });
  it("counts the gaps and sibling widths", () => {
    expect(shouldFoldTabs(600, 500, [90, 0, 10], 6)).toBe(true);
    expect(shouldFoldTabs(620, 500, [90, 0, 10], 6)).toBe(false);
  });
  it("does not fold on an unmeasured bar", () => {
    expect(shouldFoldTabs(0, 950, [])).toBe(false);
    expect(shouldFoldTabs(744, 0, [100])).toBe(false);
  });
});
