// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import type { Group, Step, Workspace } from "../src/api/types";
import { useGroupEditing } from "../src/bench/pipeline/useGroupEditing";
import { appReducer, emptyWorkspace, initialState, type AppAction, type AppState } from "../src/state/reducer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const step = (id: string): Step => ({ id, op: "impute", target: "both", params: {} });
const grp = (id: string, ...step_ids: string[]): Group => ({
  id,
  name: `group ${id}`,
  intent: "",
  step_ids,
  origin: "auto",
  produced_by: null,
});
const groups = [grp("g1", "s1"), grp("g2", "s2"), grp("g3", "s3")];

type Editing = ReturnType<typeof useGroupEditing>;

function mount(editorOpen: boolean) {
  const host = document.createElement("div");
  const root = createRoot(host);
  let editing!: Editing;
  const Probe = ({ open }: { open: boolean }) => {
    editing = useGroupEditing(groups, () => undefined, open);
    return null;
  };
  const render = (open: boolean) => act(() => root.render(createElement(Probe, { open })));
  render(editorOpen);
  return { render, editing: () => editing, unmount: () => act(() => root.unmount()) };
}

describe("select mode when a step editor opens (#275, point 1)", () => {
  it("leaves select mode and drops the picks, so no 'Group N rows' stays live", () => {
    const m = mount(false);
    act(() => m.editing().setSelecting(true));
    act(() => m.editing().setPicked(new Set(["g1", "g2"])));
    expect(m.editing().selecting).toBe(true);
    expect(m.editing().pickedSteps).toEqual(["s1", "s2"]);

    m.render(true);
    expect(m.editing().selecting).toBe(false);
    expect(m.editing().picked.size).toBe(0);
    expect(m.editing().pickedSteps).toBeNull();

    // Closing the editor does not bring the old picks back.
    m.render(false);
    expect(m.editing().selecting).toBe(false);
    expect(m.editing().picked.size).toBe(0);
    m.unmount();
  });
});

const run = (state: AppState, ...actions: AppAction[]) => actions.reduce(appReducer, state);
const withSteps = (): AppState => {
  const workspace: Workspace = { ...emptyWorkspace("w275"), steps: ["s1", "s2", "s3"].map(step), groups };
  return run(initialState, { type: "SET_WORKSPACE", workspace });
};

describe("ungroup never hands a former group id out again (#275, point 2)", () => {
  it("group then ungroup: the singletons take the clash form, not g1 / g2", () => {
    const grouped = run(withSteps(), { type: "GROUP_ROWS", groupIds: ["g1", "g2"], name: "Pair", intent: "" });
    const pair = grouped.workspace!.groups[0]!;
    expect(grouped.workspace!.groups.map((g) => g.step_ids.join("+"))).toEqual(["s1+s2", "s3"]);
    const back = run(grouped, { type: "UNGROUP", id: pair.id });
    expect(back.workspace!.groups.map((g) => g.id)).toEqual(["g1-2", "g2-2", "g3"]);
    expect(back.workspace!.groups.map((g) => g.step_ids.join("+"))).toEqual(["s1", "s2", "s3"]);
    // Group again and ungroup again: still no id of the session is reused.
    const again = run(back, { type: "GROUP_ROWS", groupIds: ["g1-2", "g2-2"], name: "Pair", intent: "" });
    const out = run(again, { type: "UNGROUP", id: again.workspace!.groups[0]!.id });
    const ids = out.workspace!.groups.map((g) => g.id);
    expect(ids).toEqual(["g1-3", "g2-3", "g3"]);
  });

  it("starts over with another workspace", () => {
    const grouped = run(withSteps(), { type: "GROUP_ROWS", groupIds: ["g1", "g2"], name: "Pair", intent: "" });
    const other = run(grouped, {
      type: "SET_WORKSPACE",
      workspace: { ...emptyWorkspace("other"), steps: ["s1", "s2"].map(step), groups: [grp("g1", "s1"), grp("g2", "s2")] },
    });
    expect(other.usedGroupIds).toEqual(["g1", "g2"]);
  });
});
