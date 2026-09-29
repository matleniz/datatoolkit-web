import { describe, expect, it, vi } from "vitest";

import { TOOLS, openStepPicker, toolDef } from "../src/bench/toolrail/tools";

describe("toolrail tools", () => {
  it("includes transform with correct metadata", () => {
    const t = toolDef("transform");
    expect(t).toBeDefined();
    expect(t.id).toBe("transform");
    expect(t.label).toBe("Transform");
    expect(t.ariaLabel).toBe("Transform");
    expect(t.title).toMatch(/Transform/i);
  });

  it("lists transform as the first rail tool", () => {
    expect(TOOLS[0]?.id).toBe("transform");
  });

  it("still resolves standard dock tools by id", () => {
    expect(toolDef("compare").key).toBe("column_distribution");
    expect(toolDef("corr").key).toBe("correlations");
    expect(toolDef("dist").key).toBe("column_distribution");
    expect(toolDef("missing").key).toBe("missing_values");
    expect(toolDef("outliers").key).toBe("outliers");
    expect(toolDef("target").key).toBe("target_analysis");
    expect(toolDef("drift").key).toBe("train_test_check");
    expect(toolDef("feature_selection").key).toBe("feature_selection");
    expect(toolDef("chart").key).toBe("chart");
  });

  it("openStepPicker dispatches OPEN_EDITOR with op: null", () => {
    const dispatch = vi.fn();
    openStepPicker(dispatch);
    expect(dispatch).toHaveBeenCalledWith({ type: "OPEN_EDITOR", op: null });
  });
});
