import { describe, expect, it } from "vitest";

import { dataIdentity } from "../src/bench/dataIdentity";
import { appReducer, emptyWorkspace, initialState, type AppState } from "../src/state/reducer";
import { buildUiContext, currentIdentityKey } from "../src/state/uiContext";
import type { Step } from "../src/api/types";

const impute: Step = { op: "impute", target: "both", params: { columns: ["age"] } };
const scale: Step = { op: "scale", target: "both", params: { columns: ["age"] } };

function stateWith(steps: Step[], extra: Partial<AppState> = {}): AppState {
  return {
    ...initialState,
    screen: "bench",
    workspace: { ...emptyWorkspace("demo"), steps },
    ...extra,
  };
}

describe("buildUiContext", () => {
  it("publishes workspace, role, effective version, latest and identity", () => {
    const s = stateWith([impute, scale], { viewVersion: 1, role: "test" });
    const ctx = buildUiContext(s, "sess");
    expect(ctx).toMatchObject({
      session: "sess",
      screen: "bench",
      workspace: "demo",
      role: "test",
      version: 1,
      latest: 2,
      editor: null,
    });
    expect(ctx.identity).toBe(dataIdentity(s.workspace, "test", 1).key);
    expect(currentIdentityKey(s)).toBe(ctx.identity);
  });

  it("resolves a null / out-of-range viewVersion to the latest", () => {
    expect(buildUiContext(stateWith([impute, scale]), "s").version).toBe(2);
    expect(buildUiContext(stateWith([impute], { viewVersion: 9 }), "s").version).toBe(1);
  });

  it("changes identity with the steps up to the viewed version only", () => {
    const at1 = (steps: Step[]) =>
      buildUiContext(stateWith(steps, { viewVersion: 1 }), "s").identity;
    expect(at1([impute, scale])).toBe(at1([impute]));
    expect(at1([scale])).not.toBe(at1([impute]));
  });

  it("has an empty context without a workspace", () => {
    const ctx = buildUiContext({ ...initialState }, "s");
    expect(ctx).toMatchObject({ workspace: null, version: 0, latest: 0 });
  });

  it("lists open windows with their params, column and split-by", () => {
    let s = stateWith([]);
    s = appReducer(s, { type: "OPEN_TOOL", id: "dist" });
    s = appReducer(s, { type: "OPEN_TOOL", id: "corr" });
    s = appReducer(s, { type: "PICK_COL", name: "age" });
    s = appReducer(s, { type: "SET_DIST_BY", by: "status" });
    s = appReducer(s, { type: "SET_TOOL_PARAMS", key: "dist::age", params: { bins: 20 } });
    s = appReducer(s, { type: "SET_TOOL_PARAMS", key: "corr", params: { method: "spearman" } });
    expect(buildUiContext(s, "s").windows).toEqual([
      { tool: "dist", params: { bins: 20, column: "age", by: "status" } },
      { tool: "corr", params: { method: "spearman" } },
    ]);
  });

  it("publishes the chart draft as the chart window's params", () => {
    let s = stateWith([]);
    s = appReducer(s, { type: "OPEN_TOOL", id: "chart" });
    expect(buildUiContext(s, "s").windows).toEqual([{ tool: "chart", params: {} }]);
    s = appReducer(s, { type: "PATCH_CHART_DRAFT", patch: { chart: "box", x: "cohort", y: "age" } });
    expect(buildUiContext(s, "s").windows[0]?.params).toMatchObject({
      chart: "box", x: "cohort", y: "age",
    });
  });

  it("reports selection and the open editor", () => {
    let s = stateWith([impute]);
    s = appReducer(s, { type: "PICK_COL", name: "age" });
    s = appReducer(s, { type: "PICK_CELL", rid: 12, col: "age" });
    expect(buildUiContext(s, "s").selection.cell).toEqual({ rid: 12, col: "age" });
    s = appReducer(s, { type: "EDIT_STEP", index: 0 });
    expect(buildUiContext(s, "s").editor).toMatchObject({ op: "impute", index: 0 });
  });

  it("publishes the grid view and the rows it shows", () => {
    let s = stateWith([impute]);
    expect(buildUiContext(s, "s").grid).toEqual({ filter: null, sort: [], total: null });
    const filter = { conditions: [{ column: "age", op: "isna" as const }], combine: "and" as const };
    s = appReducer(s, { type: "SET_GRID_VIEW", view: { filter, sort: [{ column: "age", desc: true }] } });
    s = appReducer(s, { type: "SET_GRID_TOTAL", total: 7 });
    expect(buildUiContext(s, "s").grid).toEqual({
      filter,
      sort: [{ column: "age", desc: true }],
      total: 7,
    });
  });

  it("lists the proposals waiting in the review banner (#104)", () => {
    const s = stateWith([impute]);
    expect(buildUiContext(s, "s").reviews).toEqual([]);
    const reviews = [{ command: "c1", summary: "add drop_columns (id)" }];
    expect(buildUiContext(s, "s", reviews).reviews).toEqual(reviews);
  });
});
