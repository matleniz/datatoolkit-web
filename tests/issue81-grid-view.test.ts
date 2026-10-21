import { describe, expect, it } from "vitest";

import { dataIdentity } from "../src/bench/dataIdentity";
import {
  addCondition,
  buildCondition,
  buildFacetCondition,
  EMPTY_GRID_VIEW,
  gridViewBody,
  gridViewKey,
  removeCondition,
  toggleSort,
  valueFacets,
} from "../src/state/gridView";
import { appReducer, emptyWorkspace, initialState } from "../src/state/reducer";

describe("#81 grid view state", () => {
  it("builds typed conditions", () => {
    expect(buildCondition("age", "gt", "50", true)).toEqual({
      column: "age",
      op: "gt",
      value: 50,
    });
    expect(buildCondition("age", "gt", "x", true)).toBeNull();
    expect(buildCondition("id", "isin", "a, b", false)).toEqual({
      column: "id",
      op: "isin",
      value: ["a", "b"],
    });
    expect(buildCondition("id", "isna", "", false)).toEqual({
      column: "id",
      op: "isna",
    });
    expect(buildCondition("id", "eq", " ", false)).toBeNull();
  });

  it("adds / removes conditions and toggles sort", () => {
    const c = { column: "a", op: "eq" as const, value: 1 };
    let v = addCondition(EMPTY_GRID_VIEW, c);
    expect(v.filter).toEqual({ conditions: [c], combine: "and" });
    expect(gridViewBody(v)).toEqual({ filter: v.filter });
    v = toggleSort(v, "a", true);
    expect(gridViewBody(v).sort).toEqual([{ column: "a", desc: true }]);
    expect(toggleSort(v, "a", true).sort).toEqual([]);
    expect(removeCondition(v, 0).filter).toBeNull();
    expect(gridViewKey(EMPTY_GRID_VIEW)).toBe("");
  });

  it("SET_GRID_VIEW never changes the workspace or its identity", () => {
    const ws = emptyWorkspace("w");
    const s0 = appReducer({ ...initialState, workspace: ws }, {
      type: "SET_WORKSPACE",
      workspace: ws,
    });
    const view = addCondition(EMPTY_GRID_VIEW, {
      column: "a",
      op: "eq",
      value: 1,
    });
    const s1 = appReducer({ ...s0, gridTotal: 12 }, { type: "SET_GRID_VIEW", view });
    expect(s1.gridView).toBe(view);
    // A new view's row count is unknown until its rows load (#110); same view keeps it.
    expect(s1.gridTotal).toBeNull();
    expect(appReducer({ ...s1, gridTotal: 3 }, { type: "SET_GRID_VIEW", view: { ...view } }).gridTotal).toBe(3);
    expect(s1.workspace).toBe(s0.workspace);
    expect(dataIdentity(s1.workspace, "train", 0).key).toBe(
      dataIdentity(s0.workspace, "train", 0).key,
    );
    // Same workspace re-set keeps the view; another one resets it.
    expect(
      appReducer(s1, { type: "SET_WORKSPACE", workspace: { ...ws } }).gridView,
    ).toBe(view);
    expect(
      appReducer(s1, { type: "SET_WORKSPACE", workspace: emptyWorkspace("o") })
        .gridView,
    ).toEqual(EMPTY_GRID_VIEW);
  });
});

describe("#276 value facets", () => {
  it("builds an isin / notin condition from ticks, null when none", () => {
    expect(buildFacetCondition("Sex", "isin", ["male", "female"])).toEqual({
      column: "Sex",
      op: "isin",
      value: ["male", "female"],
    });
    expect(buildFacetCondition("Pclass", "notin", [1])).toEqual({
      column: "Pclass",
      op: "notin",
      value: [1],
    });
    expect(buildFacetCondition("Sex", "isin", [])).toBeNull();
  });

  it("ticks only touch the view, never the steps or data identity", () => {
    const c = buildFacetCondition("Sex", "isin", ["male"])!;
    const view = addCondition(EMPTY_GRID_VIEW, c);
    expect(view.filter?.conditions).toEqual([c]);
    expect(gridViewBody(view).filter?.conditions[0]?.value).toEqual(["male"]);
  });

  it("says how many distinct values the capped list hides", () => {
    const top = [
      { value: "a", count: 5 },
      { value: null, count: 2 },
      { value: "b", count: 1 },
    ];
    expect(valueFacets(top, 2)).toEqual({
      items: [top[0], top[2]],
      hidden: 0,
    });
    expect(valueFacets(top, 40).hidden).toBe(38);
    expect(valueFacets(null, 3)).toEqual({ items: [], hidden: 3 });
  });
});
