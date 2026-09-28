import { describe, expect, it } from "vitest";

import { preferKnownColumns } from "../src/bench/profileColumns";

describe("preferKnownColumns", () => {
  it("keeps preferred order and drops unknown names", () => {
    expect(
      preferKnownColumns(["b", "gone", "a", "b"], ["a", "b", "c"]),
    ).toEqual(["b", "a"]);
  });

  it("returns empty when nothing overlaps", () => {
    expect(preferKnownColumns(["x", "y"], ["a", "b"])).toEqual([]);
  });

  it("returns empty for empty preferred", () => {
    expect(preferKnownColumns([], ["a", "b"])).toEqual([]);
  });
});
