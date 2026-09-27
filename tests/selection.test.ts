import { describe, expect, it } from "vitest";

import { pickCol, initialState } from "../src/state/reducer";

describe("selection (W2 grid)", () => {
  it("header click selects / clears a column", () => {
    const a = pickCol(initialState.selection, "age");
    expect(a.columns).toEqual(["age"]);
    const b = pickCol(a, "age");
    expect(b.columns).toEqual([]);
  });

  it("shift/add toggles multi-column selection", () => {
    const a = pickCol(initialState.selection, "age");
    const b = pickCol(a, "city", true);
    expect(b.columns).toEqual(["age", "city"]);
    const c = pickCol(b, "age", true);
    expect(c.columns).toEqual(["city"]);
  });
});
