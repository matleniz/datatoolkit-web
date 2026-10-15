import { describe, expect, it } from "vitest";
import type { Workspace } from "../src/api/types";
import {
  sourcesSpecKey,
  sourcesWorkspaceToSync,
} from "../src/screens/sources/sourcesScreenLogic";
import { appReducer, initialState } from "../src/state/reducer";

const ws = (name: string, path: string, target?: string): Workspace => ({
  name,
  datasets: {
    train: {
      x: { kind: "csv", path },
      ...(target ? { target_column: target } : {}),
    },
  },
  label: { mode: "order" },
  merges: [],
  variables: [],
  steps: [],
  charts: [],
});

describe("sourcesWorkspaceToSync (#234)", () => {
  const base = { canNavigate: true, buildErrors: [] as string[] };

  it("returns only the Sources-owned fields when they changed", () => {
    const built = ws("a", "/u/a.csv", "plan");
    expect(
      sourcesWorkspaceToSync({ ...base, built, current: ws("a", "") }),
    ).toEqual({
      datasets: built.datasets,
      label: built.label,
      merges: built.merges,
    });
  });

  it("returns null when already in sync (other fields do not matter)", () => {
    const built = ws("a", "/u/a.csv");
    const current = { ...ws("a", "/u/a.csv"), memory: [] };
    expect(sourcesWorkspaceToSync({ ...base, built, current })).toBeNull();
  });

  it("does not write back what loading a stored workspace built", () => {
    const built = ws("a", "/u/a.csv", "plan");
    const current = ws("a", "/u/a.csv");
    const baseline = {
      loaded: sourcesSpecKey(built),
      stored: sourcesSpecKey(current),
    };
    expect(
      sourcesWorkspaceToSync({ ...base, built, current, baseline }),
    ).toBeNull();
    const edited = ws("a", "/u/a.csv", "age");
    expect(
      sourcesWorkspaceToSync({ ...base, built: edited, current, baseline }),
    ).not.toBeNull();
  });

  it("syncs an edit reverted to the loaded value once the edit was stored", () => {
    const loaded = ws("a", "/u/a.csv", "plan");
    const stored = ws("a", "/u/a.csv");
    const baseline = {
      loaded: sourcesSpecKey(loaded),
      stored: sourcesSpecKey(stored),
    };
    // plan -> churn was synced (store holds churn), then plan is picked again.
    const storeNow = ws("a", "/u/a.csv", "churn");
    expect(
      sourcesWorkspaceToSync({ ...base, built: loaded, current: storeNow, baseline }),
    ).not.toBeNull();
  });

  it("never syncs while loading, with build errors, no path, or across names", () => {
    const built = ws("a", "/u/a.csv");
    const current = ws("a", "");
    expect(
      sourcesWorkspaceToSync({ ...base, canNavigate: false, built, current }),
    ).toBeNull();
    expect(
      sourcesWorkspaceToSync({ ...base, buildErrors: ["two train X"], built, current }),
    ).toBeNull();
    expect(
      sourcesWorkspaceToSync({ ...base, built: ws("a", ""), current: ws("a", "/x") }),
    ).toBeNull();
    expect(
      sourcesWorkspaceToSync({ ...base, built, current: ws("b", "") }),
    ).toBeNull();
    expect(sourcesWorkspaceToSync({ ...base, built, current: null })).toBeNull();
  });
});

describe("SET_SOURCES_SPEC (#234)", () => {
  it("replaces datasets/label/merges only; variables, memory and counters stay", () => {
    const open: Workspace = {
      ...ws("a", ""),
      variables: [{ name: "v", stat: "mean", column: "age" }],
      memory: [{ id: "m1", text: "x", kind: "note" } as never],
      id_counters: { m: 1, d: 0 } as never,
    };
    const state = { ...initialState, workspace: open, sugCount: 7 };
    const built = ws("a", "/u/a.csv", "plan");
    const next = appReducer(state, {
      type: "SET_SOURCES_SPEC",
      name: "a",
      datasets: built.datasets,
      label: built.label,
      merges: built.merges,
    });
    expect(next.workspace?.datasets.train.x.path).toBe("/u/a.csv");
    expect(next.workspace?.variables).toBe(open.variables);
    expect(next.workspace?.memory).toBe(open.memory);
    expect(next.workspace?.id_counters).toBe(open.id_counters);
    expect(next.sugCount).toBe(7);
    expect(next.stepHistory).toBe(state.stepHistory);
  });

  it("ignores a spec for another workspace", () => {
    const state = { ...initialState, workspace: ws("a", "") };
    const built = ws("b", "/u/b.csv");
    expect(
      appReducer(state, {
        type: "SET_SOURCES_SPEC",
        name: "b",
        datasets: built.datasets,
        label: built.label,
        merges: built.merges,
      }),
    ).toBe(state);
  });
});
