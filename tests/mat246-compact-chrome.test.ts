import { describe, expect, it } from "vitest";

import { DTK_COLORWAY } from "../src/bench/dock/PlotlyFigure";
import { DOCK_SIZES } from "../src/bench/toolrail/tools";

describe("MAT-246 compact chrome & theme tokens", () => {
  it("DTK_COLORWAY aligns with tokens.css palette", () => {
    // Primary accent is --dtk-accent (#1d5b86), clean is #b4460f, select is #2f6b3a
    expect(DTK_COLORWAY[0]).toBe("#1d5b86");
    expect(DTK_COLORWAY[1]).toBe("#b4460f");
    expect(DTK_COLORWAY[2]).toBe("#2f6b3a");
    expect(DTK_COLORWAY[3]).toBe("#6b5ea8");
    // Does not start with Plotly default blue
    expect(DTK_COLORWAY[0]?.toLowerCase()).not.toBe("#636efa");
  });

  it("DOCK_SIZES gives readable window height at default size M", () => {
    expect(DOCK_SIZES.M.bottom).toBe(340);
    expect(DOCK_SIZES.S.bottom).toBe(220);
    expect(DOCK_SIZES.L.bottom).toBe(440);
  });
});
