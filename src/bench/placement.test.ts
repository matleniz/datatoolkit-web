import { describe, expect, it } from "vitest";

import { placePopup } from "./placement";

const vp = { width: 1000, height: 600 };
const size = { width: 240, height: 300 };

describe("placePopup", () => {
  it("keeps the anchor when it fits", () => {
    expect(placePopup({ x: 100, y: 100 }, size, vp)).toEqual({ left: 100, top: 100, maxHeight: 584 });
  });
  it("flips left when it overflows right", () => {
    expect(placePopup({ x: 900, y: 100 }, size, vp).left).toBe(660);
  });
  it("flips up when it overflows the bottom", () => {
    expect(placePopup({ x: 100, y: 500 }, size, vp).top).toBe(200);
  });
  it("flips both at the bottom-right corner", () => {
    const p = placePopup({ x: 990, y: 590 }, size, vp);
    expect(p.left + size.width).toBeLessThanOrEqual(992);
    expect(p.top + size.height).toBeLessThanOrEqual(592);
  });
  it("caps a popup taller than the viewport", () => {
    expect(placePopup({ x: 10, y: 300 }, { width: 240, height: 900 }, vp)).toEqual({
      left: 10,
      top: 8,
      maxHeight: 584,
    });
  });
  it("never goes past the top / left margin", () => {
    const p = placePopup({ x: 3, y: 2 }, size, vp);
    expect(p.left).toBe(8);
    expect(p.top).toBe(8);
  });
});
