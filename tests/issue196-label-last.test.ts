import { describe, expect, it } from "vitest";

import type { Workspace } from "../src/api/types";
import { serializeWorkspace } from "../src/api/client";
import { dataIdentity } from "../src/bench/dataIdentity";
import { appReducer, initialState, type AppAction, type AppState } from "../src/state/reducer";

/** datatoolkit-issues#196 — the `label_last` workspace toggle. */
function ws(extra: Partial<Workspace> = {}): Workspace {
  return {
    name: "w",
    datasets: { train: { x: { kind: "csv", path: "/tmp/x.csv" }, target_column: "y" } },
    label: { mode: "order" },
    merges: [],
    variables: [],
    steps: [],
    ...extra,
  };
}

function run(state: AppState, ...actions: AppAction[]): AppState {
  return actions.reduce(appReducer, state);
}

const open = run(initialState, { type: "SET_WORKSPACE", workspace: ws() });

describe("label_last (#196)", () => {
  it("changes the data identity, and false equals absent", () => {
    const off = dataIdentity(ws(), "train", null);
    expect(dataIdentity(ws({ label_last: false }), "train", null).key).toBe(off.key);
    expect(dataIdentity(ws({ label_last: true }), "train", null).key).not.toBe(off.key);
  });

  it("round-trips on the PUT body", () => {
    expect(JSON.parse(serializeWorkspace(ws({ label_last: true }))).label_last).toBe(true);
  });

  it("is one undoable change", () => {
    const on = run(open, { type: "SET_LABEL_LAST", value: true });
    expect(on.workspace?.label_last).toBe(true);
    expect(on.stepHistory.past).toHaveLength(1);
    const undone = run(on, { type: "UNDO_STEPS" });
    expect(undone.workspace?.label_last).toBeFalsy();
    const redone = run(undone, { type: "REDO_STEPS" });
    expect(redone.workspace?.label_last).toBe(true);
  });

  it("setting the current value records nothing", () => {
    const same = run(open, { type: "SET_LABEL_LAST", value: false });
    expect(same.stepHistory.past).toHaveLength(0);
  });
});
