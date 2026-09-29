import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Workspace } from "../src/api/types";
import {
  DOCK_GRID,
  applyGridLayout,
  dockRowHeight,
  emptyDockLayouts,
  findSpot,
  sanitizeDockLayouts,
  syncDockLayouts,
  toGridItems,
} from "../src/bench/dock/dockLayout";
import {
  appReducer,
  emptyWorkspace,
  initialState,
  MAX_DOCK_TOOLS,
  type AppState,
  type ToolId,
} from "../src/state/reducer";

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, String(v)),
  };
}

function open(s: AppState, ...ids: ToolId[]): AppState {
  return ids.reduce((acc, id) => appReducer(acc, { type: "OPEN_TOOL", id }), s);
}

function loaded(ws: Workspace): AppState {
  return appReducer(initialState, { type: "SET_WORKSPACE", workspace: ws });
}

describe("dockLayout helpers (MAT-234)", () => {
  it("findSpot fills the first row left to right, then wraps below", () => {
    const { cols, w, h } = DOCK_GRID.bottom;
    expect(findSpot({}, cols, w, h)).toEqual({ x: 0, y: 0 });
    const two = { compare: { x: 0, y: 0, w, h }, corr: { x: 4, y: 0, w, h } };
    expect(findSpot(two, cols, w, h)).toEqual({ x: 8, y: 0 });
    const full = { ...two, dist: { x: 8, y: 0, w, h } };
    expect(findSpot(full, cols, w, h)).toEqual({ x: 0, y: h });
  });

  it("findSpot reuses a gap left by a closed window", () => {
    const layout = {
      compare: { x: 0, y: 0, w: 4, h: 4 },
      dist: { x: 8, y: 0, w: 4, h: 4 },
    };
    expect(findSpot(layout, 12, 4, 4)).toEqual({ x: 4, y: 0 });
  });

  it("syncDockLayouts keeps open tools only and places new ones", () => {
    const start = syncDockLayouts(emptyDockLayouts(), ["compare", "corr"]);
    expect(start.bottom.compare).toEqual({ x: 0, y: 0, w: 4, h: 8 });
    expect(start.bottom.corr).toEqual({ x: 4, y: 0, w: 4, h: 8 });
    // Right dock stacks full-width windows.
    expect(start.right.compare).toEqual({ x: 0, y: 0, w: 2, h: 6 });
    expect(start.right.corr).toEqual({ x: 0, y: 6, w: 2, h: 6 });

    const next = syncDockLayouts(start, ["corr", "dist"]);
    expect(next.bottom.compare).toBeUndefined();
    expect(next.bottom.corr).toEqual(start.bottom.corr);
    expect(next.bottom.dist).toEqual({ x: 0, y: 0, w: 4, h: 8 });
  });

  it("applyGridLayout stores moved / resized rects, clamped to the grid", () => {
    const tools: ToolId[] = ["compare", "corr"];
    const base = syncDockLayouts(emptyDockLayouts(), tools);
    const next = applyGridLayout(
      base,
      "bottom",
      [
        { i: "compare", x: 6, y: 0, w: 6, h: 6 },
        { i: "corr", x: 11, y: 2, w: 40, h: 0 },
        { i: "chart", x: 0, y: 0, w: 4, h: 4 },
      ],
      tools,
    );
    expect(next.bottom.compare).toEqual({ x: 6, y: 0, w: 6, h: 6 });
    // Too wide → full width at x=0; too short → min height.
    expect(next.bottom.corr).toEqual({ x: 0, y: 2, w: 12, h: 3 });
    // Unknown / closed windows are ignored.
    expect(next.bottom.chart).toBeUndefined();
    // The other position is untouched.
    expect(next.right).toEqual(base.right);
  });

  it("toGridItems follows tools order and carries min sizes", () => {
    const items = toGridItems(emptyDockLayouts(), "right", ["dist", "chart"]);
    expect(items.map((i) => i.i)).toEqual(["dist", "chart"]);
    expect(items[0]).toMatchObject({ x: 0, y: 0, w: 2, h: 6, minW: 1 });
  });

  it("sanitizeDockLayouts drops malformed rects and unknown tools", () => {
    const out = sanitizeDockLayouts(
      {
        bottom: {
          compare: { x: 1, y: 2, w: 5, h: 3 },
          corr: { x: "1", y: 0, w: 4, h: 4 },
          nope: { x: 0, y: 0, w: 4, h: 4 },
        },
        right: null,
      },
      ["compare", "corr"],
    );
    expect(out.bottom).toEqual({ compare: { x: 1, y: 2, w: 5, h: 3 } });
    expect(out.right).toEqual({});
    expect(sanitizeDockLayouts("garbage", ["compare"])).toEqual(
      emptyDockLayouts(),
    );
  });

  it("dockRowHeight fits the visible rows in the dock height", () => {
    // bottom: 8 rows, 7 gaps of 10 px.
    expect(dockRowHeight(470, "bottom", 10)).toBe(50);
    expect(dockRowHeight(10, "bottom", 10)).toBe(24);
  });
});

describe("dock layout reducer (MAT-234)", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("OPEN_TOOL / TOGGLE_TOOL keep one rect per open window", () => {
    let s = open(initialState, "compare", "corr");
    expect(Object.keys(s.dock.layouts.bottom)).toEqual(["compare", "corr"]);
    s = appReducer(s, { type: "TOGGLE_TOOL", id: "compare" });
    expect(Object.keys(s.dock.layouts.bottom)).toEqual(["corr"]);
    expect(Object.keys(s.dock.layouts.right)).toEqual(["corr"]);
  });

  it("evicting the oldest window beyond MAX_DOCK_TOOLS drops its rect", () => {
    const ids: ToolId[] = ["compare", "corr", "dist", "missing", "outliers"];
    expect(ids.length).toBe(MAX_DOCK_TOOLS + 1);
    const s = open(initialState, ...ids);
    expect(s.dock.tools).toEqual(ids.slice(1));
    expect(s.dock.layouts.bottom.compare).toBeUndefined();
  });

  it("SET_DOCK_LAYOUT stores the grid for the given position only", () => {
    let s = open(initialState, "compare", "corr");
    const right = s.dock.layouts.right;
    s = appReducer(s, {
      type: "SET_DOCK_LAYOUT",
      pos: "bottom",
      items: [
        { i: "corr", x: 0, y: 0, w: 8, h: 5 },
        { i: "compare", x: 8, y: 0, w: 4, h: 3 },
      ],
    });
    expect(s.dock.layouts.bottom.corr).toEqual({ x: 0, y: 0, w: 8, h: 5 });
    expect(s.dock.layouts.bottom.compare).toEqual({ x: 8, y: 0, w: 4, h: 3 });
    expect(s.dock.layouts.right).toEqual(right);
  });

  it("layout survives a reload of the same workspace", () => {
    let s = loaded(emptyWorkspace("demo"));
    s = open(s, "dist", "chart", "corr");
    s = appReducer(s, { type: "SET_DOCK_POS", pos: "bottom" });
    s = appReducer(s, { type: "SET_DOCK_SIZE", size: "L" });
    s = appReducer(s, {
      type: "SET_DOCK_LAYOUT",
      pos: "bottom",
      items: [
        { i: "chart", x: 0, y: 0, w: 8, h: 6 },
        { i: "dist", x: 8, y: 0, w: 4, h: 3 },
        { i: "corr", x: 8, y: 3, w: 4, h: 3 },
      ],
    });
    s = appReducer(s, { type: "SET_MAXIMIZED", id: "chart" });

    // "Reload": fresh state, same storage.
    const r = loaded(emptyWorkspace("demo"));
    expect(r.dock.tools).toEqual(["dist", "chart", "corr"]);
    expect(r.dock.size).toBe("L");
    expect(r.dock.layouts.bottom).toEqual(s.dock.layouts.bottom);
    // Maximize is transient.
    expect(r.dock.maximized).toBeNull();
  });

  it("layouts are per workspace; unknown workspaces keep the current dock", () => {
    let a = loaded(emptyWorkspace("a"));
    a = open(a, "compare");
    let b = appReducer(a, {
      type: "SET_WORKSPACE",
      workspace: emptyWorkspace("b"),
    });
    // No stored layout for b yet: the dock carries over (and is saved for b).
    expect(b.dock.tools).toEqual(["compare"]);
    b = open(b, "corr");
    const backToA = appReducer(b, {
      type: "SET_WORKSPACE",
      workspace: emptyWorkspace("a"),
    });
    expect(backToA.dock.tools).toEqual(["compare"]);
  });

  it("re-dispatching the same workspace does not reload the dock", () => {
    let s = loaded(emptyWorkspace("demo"));
    s = open(s, "compare");
    localStorage.clear();
    const again = appReducer(s, {
      type: "SET_WORKSPACE",
      workspace: { ...emptyWorkspace("demo"), steps: [] },
    });
    expect(again.dock).toBe(s.dock);
  });

  it("ignores a corrupt stored entry", () => {
    localStorage.setItem("dtk.dock.demo", "{not json");
    const s = loaded(emptyWorkspace("demo"));
    expect(s.dock.tools).toEqual([]);
    localStorage.setItem(
      "dtk.dock.demo",
      JSON.stringify({ tools: ["compare", "bogus", "compare"], pos: "diag" }),
    );
    const t = loaded(emptyWorkspace("demo"));
    expect(t.dock.tools).toEqual(["compare"]);
    expect(t.dock.pos).toBe("bottom");
    expect(t.dock.layouts.bottom.compare).toEqual({ x: 0, y: 0, w: 4, h: 8 });
  });
});
