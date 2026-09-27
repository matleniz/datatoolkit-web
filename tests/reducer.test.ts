import { describe, expect, it } from "vitest";

import {
  appReducer,
  initialState,
  orderSteps,
  pickCol,
  type AppState,
  type ToolId,
} from "../src/state/reducer";
import type { Step } from "../src/api/types";

function withDock(tools: ToolId[], extra?: Partial<AppState>): AppState {
  return {
    ...initialState,
    ...extra,
    dock: { ...initialState.dock, tools, ...extra?.dock },
  };
}

describe("pickCol (prototype rules)", () => {
  it("selects a single column and clears on second click", () => {
    const a = pickCol(initialState.selection, "age");
    expect(a.columns).toEqual(["age"]);
    expect(a.row).toBeNull();
    expect(a.cell).toBeNull();
    const b = pickCol(a, "age");
    expect(b.columns).toEqual([]);
  });

  it("replaces selection when not in add mode", () => {
    const a = pickCol(initialState.selection, "age");
    const b = pickCol(a, "city");
    expect(b.columns).toEqual(["city"]);
  });

  it("toggles in multi / add mode", () => {
    const multi = { ...initialState.selection, multi: true };
    const a = pickCol(multi, "age");
    const b = pickCol(a, "city");
    expect(b.columns).toEqual(["age", "city"]);
    const c = pickCol(b, "age");
    expect(c.columns).toEqual(["city"]);
  });

  it("honours add=true without multi flag", () => {
    const a = pickCol(initialState.selection, "age");
    const b = pickCol(a, "city", true);
    expect(b.columns).toEqual(["age", "city"]);
  });
});

describe("dock tools (open / toggle / move / drop)", () => {
  it("openTool appends and caps at 4", () => {
    let s = withDock([]);
    for (const id of [
      "compare",
      "corr",
      "dist",
      "missing",
      "outliers",
    ] as ToolId[]) {
      s = appReducer(s, { type: "OPEN_TOOL", id });
    }
    expect(s.dock.tools).toEqual([
      "corr",
      "dist",
      "missing",
      "outliers",
    ]);
  });

  it("toggleTool removes when open and clears maximized", () => {
    let s = withDock(["compare", "corr"], {
      dock: {
        ...initialState.dock,
        tools: ["compare", "corr"],
        maximized: "compare",
      },
    });
    s = appReducer(s, { type: "TOGGLE_TOOL", id: "compare" });
    expect(s.dock.tools).toEqual(["corr"]);
    expect(s.dock.maximized).toBeNull();
  });

  it("toggleTool opens when closed", () => {
    let s = withDock(["compare"]);
    s = appReducer(s, { type: "TOGGLE_TOOL", id: "dist" });
    expect(s.dock.tools).toEqual(["compare", "dist"]);
  });

  it("moveTool swaps with neighbour", () => {
    let s = withDock(["compare", "corr", "dist"]);
    s = appReducer(s, { type: "MOVE_TOOL", id: "corr", delta: -1 });
    expect(s.dock.tools).toEqual(["corr", "compare", "dist"]);
    s = appReducer(s, { type: "MOVE_TOOL", id: "corr", delta: -1 });
    expect(s.dock.tools).toEqual(["corr", "compare", "dist"]);
  });

  it("dropTool reorders like the prototype", () => {
    let s = withDock(["compare", "corr", "dist"]);
    s = appReducer(s, { type: "DRAG_TOOL", id: "dist" });
    s = appReducer(s, { type: "DROP_TOOL", id: "compare" });
    expect(s.dock.tools).toEqual(["dist", "compare", "corr"]);
    expect(s.dockDragFrom).toBeNull();
  });
});

describe("orderSteps", () => {
  it("keeps align steps first", () => {
    const steps: Step[] = [
      { op: "scale", target: "both", params: {} },
      { op: "rename", target: "test", params: {}, align: true },
      { op: "cast", target: "test", params: {}, align: true },
    ];
    expect(orderSteps(steps).map((s) => s.op)).toEqual([
      "rename",
      "cast",
      "scale",
    ]);
  });
});

describe("selection row / cell", () => {
  it("pick row clears columns", () => {
    let s: AppState = {
      ...initialState,
      selection: { columns: ["age"], row: null, cell: null, multi: false },
    };
    s = appReducer(s, { type: "PICK_ROW", rid: 3 });
    expect(s.selection.row).toBe(3);
    expect(s.selection.columns).toEqual([]);
    s = appReducer(s, { type: "PICK_ROW", rid: 3 });
    expect(s.selection.row).toBeNull();
  });

  it("pick cell selects its column", () => {
    let s = initialState;
    s = appReducer(s, { type: "PICK_CELL", rid: 1, col: "city" });
    expect(s.selection.cell).toEqual({ rid: 1, col: "city" });
    expect(s.selection.columns).toEqual(["city"]);
  });
});
