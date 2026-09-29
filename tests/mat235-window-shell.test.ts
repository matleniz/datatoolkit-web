import { describe, expect, it } from "vitest";

import { MockApiClient } from "../src/api/mockClient";
import type { Result } from "../src/api/types";
import { chartPrefillForWindow } from "../src/bench/dock/chartPrefill";
import {
  applyDisplay,
  clickedColumns,
  decodeArray,
  DEFAULT_FIGURE_DISPLAY,
  figureCaps,
  figureHasColumnAxis,
} from "../src/bench/dock/figureDisplay";
import { sortRecords } from "../src/bench/dock/resultTable";
import {
  defaultFigureIndex,
  resolveView,
  storedViewFor,
} from "../src/bench/dock/windowView";
import { appReducer, initialState } from "../src/state/reducer";

/** plotly.py ≥ 6 typed-array encoding of a float64 array. */
function f8(values: number[], shape?: string) {
  const buf = new Float64Array(values).buffer;
  const bdata = Buffer.from(buf).toString("base64");
  return shape ? { dtype: "f8", bdata, shape } : { dtype: "f8", bdata };
}

const COLUMNS = ["Age", "Cabin", "Embarked", "Fare"];

/** Missing-values style figure: % per column, values base64-encoded. */
function perColumnBars() {
  return {
    data: [
      {
        type: "bar",
        orientation: "v",
        x: ["Age", "Cabin", "Embarked"],
        y: f8([19.9, 77.1, 0.2]),
        text: ["19.9", "77.1", "0.2"],
      },
    ],
    layout: { xaxis: { title: { text: "column" } } },
  };
}

describe("decodeArray", () => {
  it("passes plain arrays through and decodes base64 typed arrays", () => {
    expect(decodeArray([1, "a"])).toEqual([1, "a"]);
    expect(decodeArray(f8([1.5, 20, 0.25]))).toEqual([1.5, 20, 0.25]);
    expect(decodeArray({ dtype: "i1", bdata: Buffer.from([1, 255]).toString("base64") })).toEqual([1, -1]);
  });

  it("reshapes 2-D arrays into rows", () => {
    expect(decodeArray(f8([1, 0, 0, 1], "2, 2"))).toEqual([
      [1, 0],
      [0, 1],
    ]);
  });

  it("returns null for anything else", () => {
    expect(decodeArray("x")).toBeNull();
    expect(decodeArray({ dtype: "zz", bdata: "AA==" })).toBeNull();
  });
});

describe("figureCaps", () => {
  it("per-column rate bars: sortable, log, labels, no count/%", () => {
    expect(figureCaps(perColumnBars())).toEqual({
      sortable: true,
      percent: false,
      log: true,
      annotations: true,
    });
  });

  it("count bars on a numeric axis: % yes, sort no", () => {
    const caps = figureCaps({
      data: [{ type: "bar", x: [0, 1, 2], y: [500, 300, 91] }],
      layout: {},
    });
    expect(caps.sortable).toBe(false);
    expect(caps.percent).toBe(true);
  });

  it("histograms get count vs % and log; heatmaps only labels", () => {
    expect(
      figureCaps({ data: [{ type: "histogram", x: [1, 2] }], layout: {} }),
    ).toMatchObject({ percent: true, log: true, sortable: false });
    expect(
      figureCaps({
        data: [{ type: "heatmap", z: f8([1, 0, 0, 1], "2, 2"), texttemplate: "%{z:.2f}" }],
        layout: {},
      }),
    ).toEqual({ sortable: false, percent: false, log: false, annotations: true });
  });
});

describe("applyDisplay", () => {
  it("sorts largest first and keeps the top N, with per-point arrays", () => {
    const src = perColumnBars();
    const out = applyDisplay(src, { ...DEFAULT_FIGURE_DISPLAY, sort: "desc", topN: 2 });
    const t = (out.data as Record<string, unknown>[])[0]!;
    expect(t.x).toEqual(["Cabin", "Age"]);
    expect(t.y).toEqual([77.1, 19.9]);
    expect(t.text).toEqual(["77.1", "19.9"]);
    expect((out.layout as Record<string, Record<string, unknown>>).xaxis).toMatchObject({
      categoryorder: "array",
      categoryarray: ["Cabin", "Age"],
      title: { text: "column" },
    });
    // The cached Result is never mutated.
    expect(src.data[0]!.x).toEqual(["Age", "Cabin", "Embarked"]);
  });

  it("horizontal bars put the largest on top", () => {
    const out = applyDisplay(
      {
        data: [{ type: "bar", orientation: "h", y: ["a", "b"], x: [1, 5] }],
        layout: {},
      },
      { ...DEFAULT_FIGURE_DISPLAY, sort: "desc" },
    );
    expect((out.layout as Record<string, Record<string, unknown>>).yaxis!.categoryarray).toEqual([
      "a",
      "b",
    ]);
    expect((out.data as Record<string, unknown>[])[0]!.y).toEqual(["b", "a"]);
  });

  it("sorts grouped bars by category total across traces", () => {
    const out = applyDisplay(
      {
        data: [
          { type: "bar", x: ["a", "b", "c"], y: [1, 1, 9] },
          { type: "bar", x: ["a", "b"], y: [1, 5] },
        ],
        layout: {},
      },
      { ...DEFAULT_FIGURE_DISPLAY, sort: "desc", topN: 2 },
    );
    const ts = out.data as Record<string, unknown>[];
    expect(ts[0]!.x).toEqual(["c", "b"]);
    expect(ts[1]!.x).toEqual(["b"]);
  });

  it("count → % of total, histograms via histnorm", () => {
    const out = applyDisplay(
      { data: [{ type: "bar", x: [0, 1], y: [3, 1] }], layout: {} },
      { ...DEFAULT_FIGURE_DISPLAY, percent: true },
    );
    expect((out.data as Record<string, unknown>[])[0]!.y).toEqual([75, 25]);
    const hist = applyDisplay(
      { data: [{ type: "histogram", x: [1, 2] }], layout: {} },
      { ...DEFAULT_FIGURE_DISPLAY, percent: true },
    );
    expect((hist.data as Record<string, unknown>[])[0]!.histnorm).toBe("percent");
  });

  it("log scale on the value axis, every subplot", () => {
    const out = applyDisplay(
      {
        data: [{ type: "histogram", x: [1, 2] }],
        layout: { yaxis2: { anchor: "x2" } },
      },
      { ...DEFAULT_FIGURE_DISPLAY, log: true },
    );
    const layout = out.layout as Record<string, Record<string, unknown>>;
    expect(layout.yaxis!.type).toBe("log");
    expect(layout.yaxis2).toEqual({ anchor: "x2", type: "log" });
  });

  it("hides labels and annotations", () => {
    const out = applyDisplay(
      {
        data: [{ type: "heatmap", z: [[1]], texttemplate: "%{z:.2f}" }],
        layout: { annotations: [{ text: "facet" }] },
      },
      { ...DEFAULT_FIGURE_DISPLAY, annotations: false },
    );
    expect((out.data as Record<string, unknown>[])[0]!.texttemplate).toBeUndefined();
    expect((out.layout as Record<string, unknown>).annotations).toEqual([]);
  });

  it("ignores settings the figure does not support", () => {
    const src = { data: [{ type: "heatmap", z: [[1]] }], layout: {} };
    expect(
      applyDisplay(src, { ...DEFAULT_FIGURE_DISPLAY, sort: "desc", percent: true, log: true }),
    ).toEqual(src);
  });
});

describe("click-through", () => {
  it("maps a bar's category or a heatmap cell to dataset columns", () => {
    expect(clickedColumns({ x: "Cabin", y: 77, data: { type: "bar" } }, COLUMNS)).toEqual([
      "Cabin",
    ]);
    expect(
      clickedColumns({ x: 3, y: "Fare", data: { type: "bar", orientation: "h" } }, COLUMNS),
    ).toEqual(["Fare"]);
    expect(clickedColumns({ x: "Age", y: "Fare", data: { type: "heatmap" } }, COLUMNS)).toEqual([
      "Age",
      "Fare",
    ]);
    expect(clickedColumns({ x: "Age", y: "Age", data: { type: "heatmap" } }, COLUMNS)).toEqual([
      "Age",
    ]);
  });

  it("ignores marks that are not columns", () => {
    expect(clickedColumns({ x: 2, y: 10, data: { type: "bar" } }, COLUMNS)).toEqual([]);
    expect(clickedColumns({ x: "male", data: { type: "bar" } }, COLUMNS)).toEqual([]);
    expect(clickedColumns({ x: "Age", data: { type: "histogram" } }, COLUMNS)).toEqual([]);
  });

  it("flags figures whose axes name columns", () => {
    expect(figureHasColumnAxis(perColumnBars(), COLUMNS)).toBe(true);
    expect(
      figureHasColumnAxis({ data: [{ type: "bar", x: [0, 1], y: [1, 2] }] }, COLUMNS),
    ).toBe(false);
  });
});

describe("window view", () => {
  const figs = (titles: string[], main?: number) =>
    titles.map((title, i) => ({ title, plotly: {}, ...(i === main ? { main: true } : {}) }));
  const table = { title: "t", records: [] };

  it("opens the main figure, else the first", () => {
    expect(defaultFigureIndex(figs(["a", "b"], 1))).toBe(1);
    expect(defaultFigureIndex(figs(["a", "b"]))).toBe(0);
    expect(resolveView({ figures: figs(["a", "b"], 1), tables: [] }, undefined)).toEqual({
      kind: "figure",
      index: 1,
    });
  });

  it("finds the stored figure by title, by position when titles follow the data", () => {
    const r1 = { figures: figs(["Age", "Age by Sex"]), tables: [] };
    const stored = storedViewFor(r1, { kind: "figure", index: 1 });
    expect(resolveView({ figures: figs(["x", "Age by Sex"]), tables: [] }, stored)).toEqual({
      kind: "figure",
      index: 1,
    });
    expect(resolveView({ figures: figs(["Fare", "Fare by Sex"]), tables: [] }, stored)).toEqual({
      kind: "figure",
      index: 1,
    });
    // Different figure list: back to the default.
    expect(resolveView({ figures: figs(["Fare"]), tables: [] }, stored)).toEqual({
      kind: "figure",
      index: 0,
    });
  });

  it("Table view, and fallbacks without figures", () => {
    expect(resolveView({ figures: figs(["a"]), tables: [table] }, { kind: "table" })).toEqual({
      kind: "table",
    });
    expect(resolveView({ figures: figs(["a"]), tables: [] }, { kind: "table" })).toEqual({
      kind: "figure",
      index: 0,
    });
    expect(resolveView({ figures: [], tables: [table] }, undefined)).toEqual({ kind: "table" });
    expect(resolveView({ figures: [], tables: [] }, undefined)).toEqual({ kind: "metrics" });
  });

  it("PATCH_TOOL_VIEW keeps the rest of the window state", () => {
    let s = appReducer(initialState, {
      type: "PATCH_TOOL_VIEW",
      key: "missing",
      patch: { view: { kind: "table" }, display: { sort: "desc" } },
    });
    s = appReducer(s, {
      type: "PATCH_TOOL_VIEW",
      key: "missing",
      patch: { display: { topN: 10 }, details: true },
    });
    expect(s.toolViews.missing).toEqual({
      view: { kind: "table" },
      display: { sort: "desc", topN: 10 },
      details: true,
    });
  });
});

describe("sortRecords", () => {
  const rows = [
    { c: "b", n: 2 },
    { c: "a", n: null },
    { c: "c10", n: 10 },
    { c: "c9", n: 1 },
  ];
  it("sorts numbers and strings, empties last in both directions", () => {
    expect(sortRecords(rows, { col: "n", dir: 1 }).map((r) => r.n)).toEqual([1, 2, 10, null]);
    expect(sortRecords(rows, { col: "n", dir: -1 }).map((r) => r.n)).toEqual([10, 2, 1, null]);
    expect(sortRecords(rows, { col: "c", dir: 1 }).map((r) => r.c)).toEqual([
      "a",
      "b",
      "c9",
      "c10",
    ]);
    expect(sortRecords(rows, null)).toBe(rows);
  });
});

describe("chartPrefillForWindow", () => {
  it("split becomes the colour of the single-column chart", () => {
    expect(
      chartPrefillForWindow(
        [{ name: "Age", kind: "number" }],
        "Sex",
      ),
    ).toMatchObject({ chart: "histogram", x: "Age", color: "Sex" });
  });

  it("3+ numeric columns open a scatter matrix", () => {
    const cols = ["a", "b", "c", "d", "e", "f", "g"].map((name) => ({ name, kind: "number" }));
    const d = chartPrefillForWindow(cols, null);
    expect(d.chart).toBe("scatter_matrix");
    expect(d.columns).toHaveLength(6);
  });

  it("otherwise the selection heuristics", () => {
    expect(
      chartPrefillForWindow(
        [
          { name: "Pclass", kind: "category" },
          { name: "Fare", kind: "number" },
        ],
        null,
      ),
    ).toMatchObject({ chart: "box", x: "Pclass", y: "Fare" });
    expect(chartPrefillForWindow([], null).x).toBeNull();
  });
});

describe("MockApiClient result contract (MAT-244)", () => {
  it("returns a headline and a main figure that is not the first", async () => {
    const r: Result = await new MockApiClient().runKey("missing_values", {});
    expect(r.headline).toMatch(/columns/);
    expect(resolveView(r, undefined)).toEqual({ kind: "figure", index: 1 });
    expect(figureCaps(r.figures[1]!.plotly).sortable).toBe(true);
  });
});
