import { describe, expect, it } from "vitest";

import {
  applyTile,
  CHART_TILES,
  pickerPool,
  recommendedTile,
  tileBlocker,
  tileOf,
  type PickerCol,
} from "../src/bench/dock/chartPicker";
import { DEFAULT_CHART_DRAFT } from "../src/bench/dock/chartPrefill";

const age: PickerCol = { name: "Age", kind: "number", distinct: 88 };
const fare: PickerCol = { name: "Fare", kind: "number", distinct: 248 };
const pclass: PickerCol = { name: "Pclass", kind: "number", distinct: 3 };
const sex: PickerCol = { name: "Sex", kind: "text", distinct: 2 };
const survived: PickerCol = { name: "Survived", kind: "binary", distinct: 2 };
const all = [age, fare, pclass, sex, survived];

describe("chart tiles (MAT-240)", () => {
  it("covers every engine chart type exactly once", () => {
    const types = CHART_TILES.flatMap((t) => t.types);
    expect(new Set(types).size).toBe(types.length);
    expect(types).toHaveLength(11);
    expect(tileOf("count")).toBe("bar");
    expect(tileOf("density_heatmap")).toBe("heatmap");
  });

  it("greys out types the columns cannot feed, with a reason", () => {
    expect(tileBlocker("scatter", [age])).toBe("needs 2 numeric columns");
    expect(tileBlocker("heatmap", [sex, age])).toBe("needs 2 numeric columns");
    expect(tileBlocker("histogram", [sex])).toBe("needs 1 numeric column");
    expect(tileBlocker("scatter_matrix", [age, fare])).toBe(
      "needs 3 numeric columns",
    );
    expect(tileBlocker("pie", [age, fare])).toMatch(/at most 20 values/);
    expect(tileBlocker("bar", [])).toBe("needs 1 column");
  });

  it("lets a few-valued numeric column feed a pie", () => {
    expect(tileBlocker("pie", [pclass])).toBeNull();
    expect(tileBlocker("scatter", [age, fare])).toBeNull();
  });

  it("recommends like the prefill, matrix for 3+ numeric", () => {
    expect(recommendedTile([age, fare])).toBe("scatter");
    expect(recommendedTile([sex, fare])).toBe("box");
    expect(recommendedTile([sex])).toBe("bar");
    expect(recommendedTile([age])).toBe("histogram");
    expect(recommendedTile([age, fare, pclass])).toBe("scatter_matrix");
    expect(recommendedTile([])).toBeNull();
  });

  it("judges tiles on the selection plus the draft, else on every column", () => {
    const draft = { ...DEFAULT_CHART_DRAFT, x: "Fare" };
    expect(pickerPool(draft, ["Age"], all).map((c) => c.name)).toEqual([
      "Age",
      "Fare",
    ]);
    expect(pickerPool(draft, [], all)).toHaveLength(all.length);
  });

  it("re-maps x / y when switching type, keeping colour", () => {
    const hist = { ...DEFAULT_CHART_DRAFT, x: "Age", color: "Survived" };
    expect(applyTile(hist, "scatter", [age, fare, survived])).toMatchObject({
      chart: "scatter",
      x: "Age",
      y: "Fare",
      color: "Survived",
    });
    expect(applyTile(hist, "box", [age, sex])).toMatchObject({
      chart: "box",
      x: "Sex",
      y: "Age",
    });
    expect(applyTile(hist, "violin", [age])).toMatchObject({
      chart: "violin",
      x: "Age",
      y: null,
    });
    expect(applyTile(hist, "bar", [age, sex])).toMatchObject({
      chart: "bar",
      x: "Sex",
      y: "Age",
    });
    expect(applyTile({ ...hist, x: "Sex" }, "bar", [sex])).toMatchObject({
      chart: "count",
      x: "Sex",
      y: null,
    });
    expect(applyTile(hist, "pie", [age, sex])).toMatchObject({
      chart: "pie",
      x: "Sex",
    });
    expect(applyTile(hist, "heatmap", [age, fare])).toMatchObject({
      chart: "density_heatmap",
      x: "Age",
      y: "Fare",
    });
    expect(
      applyTile(hist, "scatter_matrix", [age, fare, pclass, sex]),
    ).toMatchObject({
      chart: "scatter_matrix",
      x: null,
      y: null,
      columns: ["Age", "Fare", "Pclass"],
    });
    const back = applyTile(
      { ...hist, chart: "scatter_matrix", x: null, columns: ["Age", "Fare"] },
      "histogram",
      [age, fare],
    );
    expect(back).toMatchObject({ chart: "histogram", x: "Age", columns: [] });
  });
});
