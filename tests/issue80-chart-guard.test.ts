import { describe, expect, it } from "vitest";

import { missingChartField } from "../src/bench/dock/chartDockModel";
import {
  DEFAULT_CHART_DRAFT,
  type ChartDraft,
  type ChartType,
} from "../src/bench/dock/chartPrefill";

const d = (p: Partial<ChartDraft>): ChartDraft => ({
  ...DEFAULT_CHART_DRAFT,
  ...p,
});

describe("chart run guard (#80)", () => {
  it("blocks the empty default draft with a Pick X hint", () => {
    expect(missingChartField(DEFAULT_CHART_DRAFT)).toBe("Pick X");
  });

  it("needs only x for single-axis types", () => {
    const types: ChartType[] = ["histogram", "box", "violin", "bar", "count", "line", "pie"];
    for (const chart of types) {
      expect(missingChartField(d({ chart }))).toBe("Pick X");
      expect(missingChartField(d({ chart, x: "Age" }))).toBeNull();
    }
  });

  it("needs x and y for scatter and heatmaps", () => {
    for (const chart of ["scatter", "heatmap", "density_heatmap"] as ChartType[]) {
      expect(missingChartField(d({ chart }))).toBe("Pick X");
      expect(missingChartField(d({ chart, x: "Age" }))).toBe("Pick Y");
      expect(missingChartField(d({ chart, x: "Age", y: "Fare" }))).toBeNull();
    }
  });

  it("never blocks a scatter matrix (empty = first numeric columns)", () => {
    expect(missingChartField(d({ chart: "scatter_matrix" }))).toBeNull();
  });
});
