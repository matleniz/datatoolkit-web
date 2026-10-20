import { describe, expect, it } from "vitest";

import type { Group, Step } from "../src/api/types";
import {
  groupCountLabel,
  groupEndVersion,
  groupRows,
  originLabel,
  pruneExpanded,
  toggleExpanded,
} from "../src/bench/pipeline/groupRows";
import { appReducer, emptyWorkspace, initialState, type AppAction, type AppState } from "../src/state/reducer";
import { removeGroup, validateGroups } from "../src/state/stepGroups";

const step = (id: string): Step => ({ id, op: "impute", target: "both", params: {} });
const grp = (id: string, ids: string[], extra: Partial<Group> = {}): Group => ({
  id,
  name: `name ${id}`,
  intent: "",
  step_ids: ids,
  origin: "auto",
  produced_by: null,
  ...extra,
});

const steps = ["s1", "s2", "s3", "s4", "s5", "s6"].map(step);
const groups = [grp("g1", ["s1"]), grp("gimp", ["s2", "s3", "s4", "s5"]), grp("g6", ["s6"])];

describe("groupRows", () => {
  it("one row per group, with its first step index and size", () => {
    const rows = groupRows(steps, groups, 6);
    expect(rows.map((r) => [r.group.id, r.start, r.count, r.singleton])).toEqual([
      ["g1", 0, 1, true],
      ["gimp", 1, 4, false],
      ["g6", 5, 1, true],
    ]);
  });

  it("a workspace of singletons is all singleton rows (no group chrome)", () => {
    const singles = steps.map((s) => grp(`g${s.id!.slice(1)}`, [s.id!]));
    expect(groupRows(steps, singles, 6).every((r) => r.singleton && !r.partial)).toBe(true);
  });

  it("steps in no group get a singleton row", () => {
    const rows = groupRows(steps, [grp("gimp", ["s1", "s2"])], 6);
    expect(rows.map((r) => [r.start, r.count, r.singleton])).toEqual([
      [0, 2, false],
      [2, 1, true],
      [3, 1, true],
      [4, 1, true],
      [5, 1, true],
    ]);
  });

  it("detects a group cut by the viewed version", () => {
    const at = (v: number) => groupRows(steps, groups, v)[1]!;
    expect([at(1).applied, at(1).partial]).toEqual([0, false]);
    expect([at(3).applied, at(3).partial]).toEqual([2, true]);
    expect([at(5).applied, at(5).partial]).toEqual([4, false]);
    expect([at(6).applied, at(6).partial]).toEqual([4, false]);
    expect(groupCountLabel(at(3))).toBe("2 of 4 steps applied");
    expect(groupCountLabel(at(6))).toBe("4 steps");
  });

  it("selecting a group lands after its last step", () => {
    expect(groupEndVersion(groupRows(steps, groups, 6)[1]!)).toBe(5);
  });

  it("origin marker only for manual groups or a named producer", () => {
    expect(originLabel(grp("g1", ["s1"]))).toBeNull();
    expect(originLabel(grp("g1", ["s1"], { origin: "manual" }))).toBe("manual");
    expect(originLabel(grp("g1", ["s1"], { produced_by: "agent" }))).toBe("agent");
    expect(originLabel(grp("g1", ["s1"], { origin: "manual", produced_by: "ui:add_column" }))).toBe("ui:add_column");
  });
});

describe("expanded state", () => {
  it("toggles per group id without mutating", () => {
    const a = new Set<string>();
    const b = toggleExpanded(a, "gimp");
    expect([...a]).toEqual([]);
    expect([...b]).toEqual(["gimp"]);
    expect([...toggleExpanded(b, "gimp")]).toEqual([]);
  });

  it("forgets ids that are no longer groups, keeps the same set otherwise", () => {
    const e = new Set(["gimp", "gold"]);
    expect([...pruneExpanded(e, groups)]).toEqual(["gimp"]);
    const kept = new Set(["gimp"]);
    expect(pruneExpanded(kept, groups)).toBe(kept);
  });
});

describe("REMOVE_GROUP", () => {
  const open = (): AppState =>
    appReducer(
      { ...initialState, screen: "bench" },
      { type: "SET_WORKSPACE", workspace: { ...emptyWorkspace("demo"), steps, groups } },
    );
  const run = (s: AppState, a: AppAction) => appReducer(s, a);

  it("removes the steps and the group in one change", () => {
    const out = removeGroup({ steps, groups }, "gimp");
    expect(out.steps.map((s) => s.id)).toEqual(["s1", "s6"]);
    expect(out.groups.map((g) => g.id)).toEqual(["g1", "g6"]);
    expect(validateGroups(out.steps, out.groups)).toBeNull();
  });

  it("an unknown group id changes nothing", () => {
    const list = { steps, groups };
    expect(removeGroup(list, "nope")).toBe(list);
  });

  it("is one undo level: undo gives the whole group back, redo removes it again", () => {
    const s1 = run(open(), { type: "REMOVE_GROUP", id: "gimp" });
    expect(s1.workspace!.steps.map((s) => s.id)).toEqual(["s1", "s6"]);
    expect(s1.stepHistory.past).toHaveLength(1);
    const undone = run(s1, { type: "UNDO_STEPS" });
    expect(undone.workspace!.steps).toEqual(steps);
    expect(undone.workspace!.groups).toEqual(groups);
    const redone = run(undone, { type: "REDO_STEPS" });
    expect(redone.workspace!.steps.map((s) => s.id)).toEqual(["s1", "s6"]);
  });

  it("ignores an unknown group id", () => {
    const s0 = open();
    expect(run(s0, { type: "REMOVE_GROUP", id: "nope" })).toBe(s0);
  });
});
