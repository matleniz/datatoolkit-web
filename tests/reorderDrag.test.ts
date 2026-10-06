import { describe, expect, it } from "vitest";

import {
  applyReorder,
  dropOrder,
  moveColumn,
  planReorder,
} from "../src/bench/grid/reorderDrag";

const abcde = ["a", "b", "c", "d", "e"];

describe("dropOrder", () => {
  it("places before / after the target", () => {
    expect(dropOrder(abcde, "e", "b", "before")).toEqual([
      "a",
      "e",
      "b",
      "c",
      "d",
    ]);
    expect(dropOrder(abcde, "a", "c", "after")).toEqual([
      "b",
      "c",
      "a",
      "d",
      "e",
    ]);
  });
  it("ignores a drop on itself or an unknown column", () => {
    expect(dropOrder(abcde, "a", "a", "after")).toBeNull();
    expect(dropOrder(abcde, "a", "zz", "after")).toBeNull();
  });
  it("moveColumn clamps", () => {
    expect(moveColumn(abcde, "a", 99)).toEqual(["b", "c", "d", "e", "a"]);
  });
});

describe("planReorder", () => {
  it("identity when the order is unchanged", () => {
    expect(planReorder(abcde, abcde)).toBe("identity");
  });
  it("first / last / after", () => {
    expect(planReorder(abcde, ["c", "a", "b", "d", "e"])).toEqual({
      columns: ["c"],
      position: "first",
    });
    expect(planReorder(abcde, ["a", "b", "d", "e", "c"])).toEqual({
      columns: ["c"],
      position: "last",
    });
    expect(planReorder(abcde, ["a", "d", "b", "c", "e"])).toEqual({
      columns: ["d"],
      position: "after",
      anchor: "a",
    });
  });
  it("folds two drags into one contiguous block", () => {
    const wanted = ["a", "d", "e", "b", "c"]; // d,e moved (or b,c)
    const p = planReorder(abcde, wanted);
    expect(p).not.toBeNull();
    expect(p).not.toBe("identity");
    expect(applyReorder(abcde, p as never)).toEqual(wanted);
  });
  it("returns null when moved columns are not contiguous", () => {
    expect(planReorder(abcde, ["b", "a", "c", "e", "d"])).toBeNull();
  });
  it("round-trips applyReorder for every single move", () => {
    for (const name of abcde)
      for (let to = 0; to < 5; to++) {
        const wanted = moveColumn(abcde, name, to);
        const p = planReorder(abcde, wanted);
        if (p === "identity") continue;
        expect(applyReorder(abcde, p as never)).toEqual(wanted);
      }
  });
});
