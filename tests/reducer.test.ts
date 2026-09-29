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

  it("SET_DOCK_POS / SIZE / SET_MAXIMIZED", () => {
    let s = withDock(["compare", "corr"]);
    s = appReducer(s, { type: "SET_DOCK_POS", pos: "right" });
    expect(s.dock.pos).toBe("right");
    s = appReducer(s, { type: "SET_DOCK_SIZE", size: "L" });
    expect(s.dock.size).toBe("L");
    s = appReducer(s, { type: "SET_MAXIMIZED", id: "corr" });
    expect(s.dock.maximized).toBe("corr");
  });
});

describe("W3 variables / formula insert / export", () => {
  it("ADD_VARIABLE and REMOVE_VARIABLE update workspace.variables", () => {
    let s: AppState = {
      ...initialState,
      workspace: {
        name: "churn",
        datasets: { train: { x: { kind: "csv", path: "/tmp/t.csv" } } },
        label: { mode: "order" },
        merges: [],
        variables: [],
        steps: [],
      },
    };
    s = appReducer(s, {
      type: "ADD_VARIABLE",
      variable: { name: "spend_med", stat: "median", column: "monthly_spend" },
    });
    expect(s.workspace?.variables).toEqual([
      { name: "spend_med", stat: "median", column: "monthly_spend" },
    ]);
    s = appReducer(s, { type: "REMOVE_VARIABLE", name: "spend_med" });
    expect(s.workspace?.variables).toEqual([]);
  });

  it("INSERT_FORMULA_TOKEN opens formula editor or appends", () => {
    let s = appReducer(initialState, {
      type: "INSERT_FORMULA_TOKEN",
      token: "@spend_med",
    });
    expect(s.editor?.op).toBe("formula");
    expect(s.editor?.params.expr).toBe("@spend_med");
    s = appReducer(s, {
      type: "INSERT_FORMULA_TOKEN",
      token: "+ age",
    });
    expect(s.editor?.params.expr).toBe("@spend_med + age");
  });

  it("SET_SHOW_EXPORT toggles the panel", () => {
    let s = appReducer(initialState, { type: "SET_SHOW_EXPORT", show: true });
    expect(s.showExport).toBe(true);
    s = appReducer(s, { type: "SET_SHOW_EXPORT", show: false });
    expect(s.showExport).toBe(false);
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

describe("Stream W1 reducer actions", () => {
  it("ADD_ALIGN_STEP inserts step after existing align steps and before normal steps", () => {
    const ws = {
      name: "churn",
      datasets: { train: { x: { kind: "csv" as const, path: "" } } },
      label: { mode: "order" as const },
      merges: [],
      variables: [],
      steps: [
        { op: "rename", target: "test" as const, params: {}, align: true },
        { op: "scale", target: "both" as const, params: {} },
      ],
    };

    let s: AppState = { ...initialState, workspace: ws };
    s = appReducer(s, {
      type: "ADD_ALIGN_STEP",
      step: { op: "cast", target: "test", params: {} },
    });

    expect(s.workspace?.steps.map((st) => st.op)).toEqual([
      "rename",
      "cast",
      "scale",
    ]);
    expect(s.workspace?.steps[1]!.align).toBe(true);
  });

  it("REMOVE_STEP_BY_INDEX removes step", () => {
    const ws = {
      name: "churn",
      datasets: { train: { x: { kind: "csv" as const, path: "" } } },
      label: { mode: "order" as const },
      merges: [],
      variables: [],
      steps: [
        { op: "rename", target: "test" as const, params: {}, align: true },
        { op: "scale", target: "both" as const, params: {} },
      ],
    };

    let s: AppState = { ...initialState, workspace: ws };
    s = appReducer(s, { type: "REMOVE_STEP_BY_INDEX", index: 0 });
    expect(s.workspace?.steps.map((st) => st.op)).toEqual(["scale"]);
  });

  it("SET_TEST_DECIMAL updates test csv source decimal", () => {
    const ws = {
      name: "churn",
      datasets: {
        train: { x: { kind: "csv" as const, path: "" } },
        test: { x: { kind: "csv" as const, path: "test.csv" } },
      },
      label: { mode: "order" as const },
      merges: [],
      variables: [],
      steps: [],
    };

    let s: AppState = { ...initialState, workspace: ws };
    s = appReducer(s, { type: "SET_TEST_DECIMAL", decimal: "," });
    expect((s.workspace?.datasets.test?.x as { decimal?: string }).decimal).toBe(",");

    s = appReducer(s, { type: "SET_TEST_DECIMAL", decimal: null });
    expect((s.workspace?.datasets.test?.x as { decimal?: string }).decimal).toBeUndefined();
  });

  it("SET_ALIGN_TO_DECIDE_COUNT updates count", () => {
    let s = initialState;
    s = appReducer(s, { type: "SET_ALIGN_TO_DECIDE_COUNT", count: 3 });
    expect(s.alignToDecideCount).toBe(3);
  });
});

