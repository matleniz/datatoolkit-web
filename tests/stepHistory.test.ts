import { describe, expect, it } from "vitest";

import type { Step } from "../src/api/types";
import {
  appReducer,
  emptyWorkspace,
  initialState,
  type AppAction,
  type AppState,
} from "../src/state/reducer";
import {
  EMPTY_STEP_HISTORY,
  MAX_STEP_HISTORY,
  recordSteps,
  redoSteps,
  sameSteps,
  undoSteps,
} from "../src/state/stepHistory";

const impute: Step = {
  op: "impute",
  target: "both",
  params: { columns: ["age"], strategy: "median" },
};
const scale: Step = { op: "scale", target: "both", params: { columns: ["age"] } };

describe("step history (datatoolkit-issues#16)", () => {
  it("undo then redo walks the snapshots", () => {
    let h = recordSteps(EMPTY_STEP_HISTORY, []);
    h = recordSteps(h, [impute]);
    const current = [impute, scale];

    const u = undoSteps(h, current)!;
    expect(u.steps).toEqual([impute]);
    expect(u.history.future).toEqual([current]);

    const r = redoSteps(u.history, u.steps)!;
    expect(r.steps).toBe(current);
    expect(r.history).toEqual(h);
  });

  it("returns null when there is nothing to undo / redo", () => {
    expect(undoSteps(EMPTY_STEP_HISTORY, [])).toBeNull();
    expect(redoSteps(EMPTY_STEP_HISTORY, [])).toBeNull();
  });

  it("a new change drops the redo branch", () => {
    const h = recordSteps(EMPTY_STEP_HISTORY, []);
    const u = undoSteps(h, [impute])!;
    expect(u.history.future).toHaveLength(1);
    expect(recordSteps(u.history, []).future).toEqual([]);
  });

  it(`keeps at most ${MAX_STEP_HISTORY} undo levels`, () => {
    let h = EMPTY_STEP_HISTORY;
    for (let i = 0; i < MAX_STEP_HISTORY + 5; i++) {
      h = recordSteps(h, Array.from({ length: i }, () => impute));
    }
    expect(h.past).toHaveLength(MAX_STEP_HISTORY);
    expect(h.past[0]).toHaveLength(5);
  });

  it("sameSteps compares the Step objects in order", () => {
    expect(sameSteps([impute, scale], [impute, scale])).toBe(true);
    expect(sameSteps([impute, scale], [scale, impute])).toBe(false);
    expect(sameSteps([impute], [{ ...impute }])).toBe(false);
  });
});

describe("UNDO_STEPS / REDO_STEPS reducer", () => {
  const run = (s: AppState, ...actions: AppAction[]) => actions.reduce(appReducer, s);
  const ops = (s: AppState) => s.workspace?.steps.map((x) => x.op);
  const loaded = run(initialState, {
    type: "SET_WORKSPACE",
    workspace: emptyWorkspace("demo"),
  });

  it("undo after a remove restores the step at its place", () => {
    let s = run(
      loaded,
      { type: "ADD_STEP", step: impute },
      { type: "ADD_STEP", step: scale },
      { type: "REMOVE_STEP", index: 0 },
    );
    expect(ops(s)).toEqual(["scale"]);
    s = run(s, { type: "SET_VIEW_VERSION", version: 0 }, { type: "UNDO_STEPS" });
    expect(ops(s)).toEqual(["impute", "scale"]);
    expect(s.viewVersion).toBeNull();
    s = run(s, { type: "REDO_STEPS" });
    expect(ops(s)).toEqual(["scale"]);
    s = run(s, { type: "UNDO_STEPS" }, { type: "UNDO_STEPS" }, { type: "UNDO_STEPS" });
    expect(ops(s)).toEqual([]);
    expect(run(s, { type: "UNDO_STEPS" })).toBe(s);
  });

  it("is a no-op while a step is being edited", () => {
    const s = run(
      loaded,
      { type: "ADD_STEP", step: impute },
      { type: "OPEN_EDITOR", op: "scale" },
    );
    expect(run(s, { type: "UNDO_STEPS" })).toBe(s);
  });

  it("non-step actions are not recorded", () => {
    const s = run(loaded, { type: "SET_DIST_BY", by: "age" }, { type: "PICK_COL", name: "age" });
    expect(s.stepHistory).toEqual(EMPTY_STEP_HISTORY);
  });

  it("loading another workspace resets the history; the same one keeps it", () => {
    const s = run(loaded, { type: "ADD_STEP", step: impute });
    expect(s.stepHistory.past).toHaveLength(1);
    const same = run(s, { type: "SET_WORKSPACE", workspace: { ...s.workspace! } });
    expect(same.stepHistory.past).toHaveLength(1);
    const other = run(s, {
      type: "SET_WORKSPACE",
      workspace: emptyWorkspace("other"),
    });
    expect(other.stepHistory).toEqual(EMPTY_STEP_HISTORY);
  });
});
