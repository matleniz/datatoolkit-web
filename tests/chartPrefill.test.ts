import { describe, expect, it } from "vitest";

import {
  chartDraftToParams,
  chartParamsToDraft,
  chartPrefillFromSelection,
  defaultChartName,
} from "../src/bench/dock/chartPrefill";

describe("chartPrefillFromSelection (MAT-172)", () => {
  it("maps one numeric column to histogram", () => {
    expect(chartPrefillFromSelection([{ name: "Age", kind: "number" }])).toMatchObject({
      chart: "histogram",
      x: "Age",
      y: null,
    });
  });

  it("maps one categorical column to count", () => {
    expect(chartPrefillFromSelection([{ name: "Sex", kind: "text" }])).toMatchObject({
      chart: "count",
      x: "Sex",
    });
  });

  it("maps two numeric columns to scatter", () => {
    expect(
      chartPrefillFromSelection([
        { name: "Age", kind: "number" },
        { name: "Fare", kind: "number" },
      ]),
    ).toMatchObject({ chart: "scatter", x: "Age", y: "Fare" });
  });

  it("maps categorical + numeric to box (with optional color)", () => {
    expect(
      chartPrefillFromSelection([
        { name: "Pclass", kind: "text" },
        { name: "Fare", kind: "number" },
        { name: "Survived", kind: "binary" },
      ]),
    ).toMatchObject({
      chart: "box",
      x: "Pclass",
      y: "Fare",
      color: "Survived",
    });
  });

  it("round-trips draft ↔ params", () => {
    const draft = chartPrefillFromSelection([
      { name: "Age", kind: "number" },
      { name: "Fare", kind: "number" },
    ]);
    draft.trendline = true;
    const params = chartDraftToParams(draft);
    expect(params.trendline).toBe(true);
    expect(chartParamsToDraft(params)).toMatchObject({
      chart: "scatter",
      x: "Age",
      y: "Fare",
      trendline: true,
    });
    expect(defaultChartName(draft)).toBe("scatter: Fare vs Age");
  });
});
