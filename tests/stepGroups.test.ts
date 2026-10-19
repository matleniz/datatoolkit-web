import { afterEach, describe, expect, it, vi } from "vitest";

import { apiClient, serializeWorkspace } from "../src/api/client";
import { EngineError, GroupInvariantError } from "../src/api/types";
import type { Group, Step, Workspace } from "../src/api/types";
import { appReducer, emptyWorkspace, initialState, type AppAction, type AppState } from "../src/state/reducer";
import {
  assertValidGroups,
  fillSingletons,
  groupInvariantError,
  insertStep,
  moveGroup,
  newGroupId,
  orderList,
  removeStepAt,
  replaceStepAt,
  sameGroups,
  setSteps,
  validateGroupName,
  validateGroups,
  type StepList,
} from "../src/state/stepGroups";
import { fillStepIds } from "../src/state/stepIds";
import { applyStepOps } from "../src/state/stepOps";
import {
  commitWorkspaceSave,
  getLastSavedWorkspaceJson,
  resetWorkspaceSaveGateForTests,
  setGroupsAdopter,
} from "../src/state/workspaceSaveGate";

const step = (id: string, op = "impute", extra: Partial<Step> = {}): Step => ({
  id,
  op,
  target: "both",
  params: {},
  ...extra,
});
const grp = (id: string, ...step_ids: string[]): Group => ({
  id,
  name: `group ${id}`,
  intent: "",
  step_ids,
  origin: "manual",
});
const ids = (list: StepList) => list.steps.map((s) => s.id);
const shape = (list: StepList) => list.groups.map((g) => g.step_ids.join("+"));

/** s1..s5, with g-ab = s2+s3 and the others singletons. */
const five = (): StepList => ({
  steps: ["s1", "s2", "s3", "s4", "s5"].map((id) => step(id)),
  groups: [grp("g1", "s1"), grp("gab", "s2", "s3"), grp("g4", "s4"), grp("g5", "s5")],
});

describe("validateGroupName", () => {
  it("trims and accepts 1 to 80 characters", () => {
    expect(validateGroupName("  Impute ledd ")).toEqual({ name: "Impute ledd" });
    expect(validateGroupName("x".repeat(80))).toEqual({ name: "x".repeat(80) });
  });
  it.each([
    ["empty", "   "],
    ["too long", "x".repeat(81)],
    ["newline", "a\nb"],
    ["carriage return", "a\rb"],
    ["tab", "a\tb"],
    ["NUL", "a\u0000b"],
    ["U+2028", "a b"],
    ["U+2029", "a b"],
  ])("refuses %s", (_, name) => {
    expect(validateGroupName(name)).toHaveProperty("error");
  });
});

describe("validateGroups", () => {
  it("accepts a full partition in step order", () => {
    const l = five();
    expect(validateGroups(l.steps, l.groups)).toBeNull();
    expect(validateGroups([], [])).toBeNull();
  });
  it.each([
    ["duplicate_group_id", [grp("g1", "s1"), grp("g1", "s2")], ["s1", "s2"]],
    ["step_shared", [grp("g1", "s1", "s2"), grp("g2", "s2")], ["s1", "s2"]],
    ["unknown_step", [grp("g1", "s1", "s9")], ["s1"]],
    ["not_contiguous", [grp("g1", "s1", "s3"), grp("g2", "s2")], ["s1", "s2", "s3"]],
    ["out_of_order", [grp("g2", "s2"), grp("g1", "s1")], ["s1", "s2"]],
    ["uncovered_step", [grp("g1", "s1")], ["s1", "s2"]],
  ])("names the rule %s", (rule, groups, stepIds) => {
    const v = validateGroups(stepIds.map((i) => step(i)), groups as Group[]);
    expect(v?.rule).toBe(rule);
  });
  it("refuses an invalid name, an invalid id and an empty group", () => {
    const s = [step("s1")];
    expect(validateGroups(s, [{ ...grp("g1", "s1"), name: "a\nb" }])?.rule).toBe("invalid_name");
    expect(validateGroups(s, [grp("G1", "s1")])?.rule).toBe("invalid_group");
    expect(validateGroups(s, [grp("g1")])?.rule).toBe("invalid_group");
  });
  it("assertValidGroups throws with the rule", () => {
    expect(() => assertValidGroups([step("s1")], [], "test")).toThrow(/uncovered_step/);
  });
});

describe("newGroupId", () => {
  it("is g + 8 base36 chars, never g<digits>, never taken", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const id = newGroupId(seen);
      expect(id).toMatch(/^g[0-9a-z]{8}$/);
      expect(id).not.toMatch(/^g\d+$/);
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
  });
});

describe("fillSingletons (the engine's rule)", () => {
  it("wraps every step: s12 -> g12, named '<op> <target>', auto, no intent", () => {
    const steps = [step("s12", "impute"), step("sab12cd34", "scale")];
    expect(fillSingletons(steps, [])).toEqual([
      { id: "g12", name: "impute both", intent: "", step_ids: ["s12"], origin: "auto" },
      { id: "gab12cd34", name: "scale both", intent: "", step_ids: ["sab12cd34"], origin: "auto" },
    ]);
  });
  it("keeps existing groups and wraps the uncovered steps around them", () => {
    const steps = ["s1", "s2", "s3", "s4"].map((i) => step(i));
    const kept = grp("gx", "s2", "s3");
    const out = fillSingletons(steps, [kept]);
    expect(out.map((g) => g.id)).toEqual(["g1", "gx", "g4"]);
    expect(out[1]).toBe(kept);
  });
  it("suffixes -2, -3 on a clash", () => {
    const steps = [step("s1"), step("s2")];
    const out = fillSingletons(steps, [grp("g1", "s2")].map((g) => g)).map((g) => g.id);
    // s1 is first, so its group would be g1: taken by the manual group of s2 -> g1-2
    expect(out).toEqual(["g1-2", "g1"]);
  });
  it("is idempotent and keeps the same array when nothing is missing", () => {
    const steps = ["s1", "s2"].map((i) => step(i));
    const once = fillSingletons(steps, []);
    expect(fillSingletons(steps, once)).toBe(once);
  });
  it("truncates the name to 80 characters", () => {
    const out = fillSingletons([step("s1", "x".repeat(100))], []);
    expect(out[0]!.name).toHaveLength(80);
  });
});

describe("step helpers keep a valid partition", () => {
  const ok = (l: StepList) => {
    assertValidGroups(l.steps, l.groups);
    return l;
  };

  it("insertStep at the end adds a singleton", () => {
    const out = ok(insertStep(five(), step("s6")));
    expect(shape(out)).toEqual(["s1", "s2+s3", "s4", "s5", "s6"]);
    expect(out.groups.at(-1)!.id).toBe("g6");
  });
  it("insertStep between groups adds a singleton and leaves the others alone", () => {
    const l = five();
    const out = ok(insertStep(l, step("s6"), 1));
    expect(shape(out)).toEqual(["s1", "s6", "s2+s3", "s4", "s5"]);
    expect(out.groups[2]).toBe(l.groups[1]);
  });
  it("insertStep inside a group splits it: head keeps the id, tail gets a new one", () => {
    const out = ok(insertStep(five(), step("s6"), 2));
    expect(shape(out)).toEqual(["s1", "s2", "s6", "s3", "s4", "s5"]);
    expect(out.groups[1]!.id).toBe("gab");
    expect(out.groups[3]!.id).not.toBe("gab");
    expect(out.groups[3]!.name).toBe(out.groups[1]!.name);
  });
  it("removeStepAt drops an emptied group and shrinks a bigger one", () => {
    expect(shape(ok(removeStepAt(five(), 0)))).toEqual(["s2+s3", "s4", "s5"]);
    const out = ok(removeStepAt(five(), 1));
    expect(shape(out)).toEqual(["s1", "s3", "s4", "s5"]);
    expect(out.groups[1]!.id).toBe("gab");
  });
  it("removeStepAt out of range changes nothing", () => {
    const l = five();
    expect(removeStepAt(l, 9)).toBe(l);
    expect(removeStepAt(l, -1)).toBe(l);
  });
  it("replaceStepAt keeps the id and the groups array", () => {
    const l = five();
    const out = ok(replaceStepAt(l, 2, step("snew", "scale")));
    expect(out.steps[2]).toMatchObject({ id: "s3", op: "scale" });
    expect(out.groups).toBe(l.groups);
  });
  it("setSteps keeps the groups of the steps that remain", () => {
    const l = five();
    const out = ok(setSteps(l, [l.steps[1]!, l.steps[2]!, step("s9")]));
    expect(shape(out)).toEqual(["s2+s3", "s9"]);
    expect(out.groups[0]!.id).toBe("gab");
  });
  it("orderList puts align steps first and cuts a group that straddles", () => {
    const l = five();
    const steps = l.steps.map((s) => (s.id === "s3" ? { ...s, align: true } : s));
    const out = ok(orderList({ steps, groups: l.groups }));
    expect(ids(out)).toEqual(["s3", "s1", "s2", "s4", "s5"]);
    expect(shape(out)).toEqual(["s3", "s1", "s2", "s4", "s5"]);
    expect(new Set(out.groups.map((g) => g.id)).size).toBe(5);
  });
  it("orderList is a no-op (same arrays) when already ordered", () => {
    const l = five();
    const out = orderList(l);
    expect(out.steps).toBe(l.steps);
    expect(out.groups).toBe(l.groups);
  });
  it("moveGroup moves the steps with the group, both ways", () => {
    const l = five();
    const down = ok(moveGroup(l, "gab", 3));
    expect(ids(down)).toEqual(["s1", "s4", "s5", "s2", "s3"]);
    expect(shape(down)).toEqual(["s1", "s4", "s5", "s2+s3"]);
    const up = ok(moveGroup(l, "g5", 0));
    expect(ids(up)).toEqual(["s5", "s1", "s2", "s3", "s4"]);
    expect(moveGroup(l, "nope", 0)).toBe(l);
  });
  it("applyStepOps threads the groups through add / replace / remove", () => {
    const out = applyStepOps(five(), [
      { add: { step: { op: "scale", target: "both", params: {} } } },
      { remove: { id: "s2" } },
      { replace: { id: "s3", step: step("sx", "drop") } },
      { remove: { id: "s1" } },
    ]);
    if ("error" in out) throw new Error(out.error);
    ok(out);
    expect(shape({ steps: out.steps, groups: out.groups }).slice(0, 3)).toEqual(["s3", "s4", "s5"]);
    expect(out.groups[0]!.id).toBe("gab");
    expect(out.groups).toHaveLength(4);
  });
});

describe("reducer: every path that changes the steps keeps the groups valid", () => {
  const open = (list: StepList = five()): AppState => {
    const workspace: Workspace = { ...emptyWorkspace("demo"), steps: list.steps, groups: list.groups };
    return appReducer({ ...initialState, screen: "bench" }, { type: "SET_WORKSPACE", workspace });
  };
  const run = (s: AppState, ...actions: AppAction[]) => actions.reduce(appReducer, s);
  const valid = (s: AppState) => {
    assertValidGroups(s.workspace!.steps, s.workspace!.groups, "state");
    return s.workspace!;
  };
  const added: Step = { op: "scale", target: "both", params: { columns: ["age"] } };

  it("SET_WORKSPACE fills the singletons of a workspace without groups (older engine)", () => {
    const s = open({ steps: [step("s1"), step("s2")], groups: [] });
    expect(valid(s).groups.map((g) => g.id)).toEqual(["g1", "g2"]);
  });
  it("ADD_STEP appends a singleton", () => {
    const w = valid(run(open(), { type: "ADD_STEP", step: added }));
    expect(w.groups).toHaveLength(5);
    expect(w.groups.at(-1)!.step_ids).toEqual([w.steps.at(-1)!.id]);
  });
  it("REPLACE_STEP keeps the group of the slot", () => {
    const w = valid(run(open(), { type: "REPLACE_STEP", index: 2, step: added }));
    expect(w.groups.map((g) => g.step_ids.join("+"))).toEqual(["s1", "s2+s3", "s4", "s5"]);
  });
  it("REMOVE_STEP in the middle of a group shrinks it; the last step of a group drops it", () => {
    const w = valid(run(open(), { type: "REMOVE_STEP", index: 1 }));
    expect(w.groups.map((g) => g.step_ids.join("+"))).toEqual(["s1", "s3", "s4", "s5"]);
    const w2 = valid(run(open(), { type: "REMOVE_STEP", index: 3 }));
    expect(w2.groups.map((g) => g.id)).toEqual(["g1", "gab", "g5"]);
  });
  it("REMOVE_STEP_BY_INDEX behaves the same", () => {
    const w = valid(run(open(), { type: "REMOVE_STEP_BY_INDEX", index: 0 }));
    expect(w.groups.map((g) => g.id)).toEqual(["gab", "g4", "g5"]);
  });
  it("APPLY_STEP_BATCH (agent proposal): added steps are singletons, removed ones leave", () => {
    const w = valid(
      run(open(), {
        type: "APPLY_STEP_BATCH",
        ops: [{ add: { step: { ...added, id: "sagent001" } } }, { remove: { id: "s4" } }],
      }),
    );
    expect(w.groups.map((g) => g.step_ids.join("+"))).toEqual(["s1", "s2+s3", "s5", "sagent001"]);
    expect(w.groups.at(-1)!.id).toBe("gagent001");
  });
  it("ADD_ALIGN_STEP inside a group splits it", () => {
    const w = valid(run(open(), { type: "ADD_ALIGN_STEP", step: added }));
    expect(w.steps[0]!.align).toBe(true);
    expect(w.groups[0]!.step_ids).toEqual([w.steps[0]!.id]);
    expect(w.groups).toHaveLength(5);
  });
  it("SET_STEPS (ids filled, align first) keeps surviving groups", () => {
    const l = five();
    const w = valid(run(open(), { type: "SET_STEPS", steps: [l.steps[2]!, l.steps[1]!, step("snew")] }));
    expect(new Set(w.groups.flatMap((g) => g.step_ids))).toEqual(new Set(["s3", "s2", "snew"]));
  });
  it("SET_STEP_NOTE changes no group", () => {
    const s = open();
    const w = valid(run(s, { type: "SET_STEP_NOTE", id: "s2", text: "hi" }));
    expect(w.groups).toBe(s.workspace!.groups);
  });
  it("undo and redo give the steps AND the groups back", () => {
    const s0 = open();
    const s1 = run(s0, { type: "REMOVE_STEP", index: 1 });
    const undone = run(s1, { type: "UNDO_STEPS" });
    expect(valid(undone).groups).toEqual(s0.workspace!.groups);
    expect(shape(valid(undone))).toEqual(["s1", "s2+s3", "s4", "s5"]);
    const redone = run(undone, { type: "REDO_STEPS" });
    expect(shape(valid(redone))).toEqual(["s1", "s3", "s4", "s5"]);
  });
  it("a long random sequence of edits, undos and redos never breaks the partition", () => {
    let s = open();
    let seed = 7;
    const rnd = (n: number) => (seed = (seed * 1103515245 + 12345) % 2147483648) % n;
    for (let i = 0; i < 300; i++) {
      const n = s.workspace!.steps.length;
      const actions: AppAction[] = [
        { type: "ADD_STEP", step: added },
        { type: "REMOVE_STEP", index: rnd(n + 1) },
        { type: "REPLACE_STEP", index: rnd(n + 1), step: added },
        { type: "ADD_ALIGN_STEP", step: added },
        { type: "UNDO_STEPS" },
        { type: "REDO_STEPS" },
        { type: "APPLY_STEP_BATCH", ops: [{ add: { step: added } }, { remove: { index: rnd(n + 1) } }] },
      ];
      const action = actions[rnd(actions.length)]!;
      s = appReducer(s, action);
      valid(s);
    }
  });
  it("ADOPT_GROUPS replaces the groups of an unchanged workspace, off the undo stack", () => {
    const s = open();
    const w = s.workspace!;
    const adopted = fillSingletons(w.steps, [grp("gnew", "s1", "s2"), grp("g3", "s3")]);
    const out = appReducer(s, { type: "ADOPT_GROUPS", base: w, groups: adopted });
    expect(valid(out).groups).toBe(adopted);
    expect(out.stepHistory).toBe(s.stepHistory);
  });
  it("ADOPT_GROUPS is ignored when the user edited meanwhile or the groups are invalid", () => {
    const s = open();
    const base = s.workspace!;
    const edited = run(s, { type: "REMOVE_STEP", index: 0 });
    const groups = fillSingletons(base.steps, [grp("gnew", "s1", "s2")]);
    expect(appReducer(edited, { type: "ADOPT_GROUPS", base, groups })).toBe(edited);
    expect(appReducer(s, { type: "ADOPT_GROUPS", base, groups: [grp("gbad", "s2", "s1")] })).toBe(s);
  });
});

describe("the save gate adopts what the engine normalised, without a new PUT", () => {
  afterEach(() => {
    resetWorkspaceSaveGateForTests();
    vi.restoreAllMocks();
  });
  const sent = (): Workspace => {
    const steps = [step("s1"), step("s2")];
    return { ...emptyWorkspace("demo"), steps, groups: [grp("ga", "s1"), grp("gb", "s2")] };
  };
  const commit = (ws: Workspace, answer: Workspace) =>
    commitWorkspaceSave({
      ws,
      serialized: serializeWorkspace(ws),
      epochAtStart: 0,
      isCurrent: () => true,
      save: async () => answer,
      remove: async () => undefined,
    });

  it("nothing to adopt when the answer has the groups that were sent", async () => {
    const adopt = vi.fn();
    setGroupsAdopter(adopt);
    const ws = sent();
    expect(await commit(ws, structuredClone(ws))).toBe("saved");
    expect(adopt).not.toHaveBeenCalled();
    expect(getLastSavedWorkspaceJson()).toBe(serializeWorkspace(ws));
  });
  it("a missing produced_by is the same as a null one", async () => {
    const adopt = vi.fn();
    setGroupsAdopter(adopt);
    const ws = sent();
    const answer = { ...ws, groups: ws.groups.map((g) => ({ ...g, produced_by: null })) };
    await commit(ws, answer);
    expect(adopt).not.toHaveBeenCalled();
  });
  it("different groups are handed to the adopter, and count as the saved copy", async () => {
    const adopt = vi.fn();
    setGroupsAdopter(adopt);
    const ws = sent();
    const answer = { ...ws, groups: [grp("gz", "s1", "s2")] };
    await commit(ws, answer);
    expect(adopt).toHaveBeenCalledWith(ws, answer.groups);
    expect(getLastSavedWorkspaceJson()).toBe(serializeWorkspace({ ...ws, groups: answer.groups }));
  });
  it("sameGroups compares content, not identity", () => {
    expect(sameGroups([grp("g1", "s1")], [grp("g1", "s1")])).toBe(true);
    expect(sameGroups([grp("g1", "s1")], [grp("g2", "s1")])).toBe(false);
  });
});

describe("PUT body and group 422", () => {
  afterEach(() => vi.restoreAllMocks());

  it("always sends groups on a workspace PUT, and none on frame calls", async () => {
    const bodies: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        bodies.push({ url, body: JSON.parse(String(init.body)) });
        return new Response("{}", { status: 200 });
      }),
    );
    const ws: Workspace = { ...emptyWorkspace("demo"), steps: [step("s1")], groups: [grp("g1", "s1")] };
    await apiClient.saveWorkspace(ws);
    await apiClient.workspaceRows(ws, "train", null, 0, 5).catch(() => undefined);
    vi.unstubAllGlobals();
    expect(bodies[0]!.body.groups).toEqual(ws.groups);
    expect(bodies[0]!.body.steps).toEqual(ws.steps);
    for (const b of bodies.slice(1)) {
      expect((b.body.workspace as Record<string, unknown>)?.groups).toBeUndefined();
    }
  });

  it("422 with detail: a typed error naming the group and the step", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              type: "KeyParamsError",
              message: "group 'g3' names unknown step id 's9'",
              details: [{ loc: [], msg: "x", type: "value_error" }],
              detail: { rule: "unknown_step", group_id: "g3", step_id: "s9" },
            }),
            { status: 422 },
          ),
      ),
    );
    const err = await apiClient.saveWorkspace(emptyWorkspace("demo")).catch((e: unknown) => e);
    vi.unstubAllGlobals();
    expect(err).toBeInstanceOf(GroupInvariantError);
    expect(err).toBeInstanceOf(EngineError);
    const e = err as GroupInvariantError;
    expect(e.status).toBe(422);
    expect(e.detail).toEqual({ rule: "unknown_step", groupId: "g3", stepId: "s9" });
    expect(e.message).toMatch(/group g3, step s9/);
    expect(e.message).toMatch(/names a step that does not exist/);
  });

  it("without detail it falls back on the message; other 422s stay plain", () => {
    const fallback = groupInvariantError(422, {
      type: "KeyParamsError",
      message: "group 'g1' is not a contiguous slice in step order",
    });
    expect(fallback).toBeInstanceOf(GroupInvariantError);
    expect(fallback!.detail.rule).toBeNull();
    expect(groupInvariantError(422, { type: "KeyParamsError", message: "duplicate chart name 'a'" })).toBeNull();
    expect(groupInvariantError(422, { type: "KeyParamsError", message: "bad", details: [{ msg: "group_by needs columns" }] })).toBeNull();
    expect(groupInvariantError(500, { type: "X", message: "group g1" })).toBeNull();
    expect(groupInvariantError(422, null)).toBeNull();
    const field = groupInvariantError(422, {
      type: "KeyParamsError",
      message: "validation failed",
      details: [{ loc: ["groups", 0, "name"], msg: "String should have at most 80 characters" }],
    });
    expect(field).toBeNull();
  });
});

describe("fillStepIds + fillSingletons agree with the engine on an old workspace", () => {
  it("steps without ids get s<position> then g<position>", () => {
    const steps = fillStepIds([
      { op: "impute", target: "both", params: {} },
      { op: "scale", target: "train", params: {} },
    ]);
    expect(steps.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(fillSingletons(steps, []).map((g) => [g.id, g.name])).toEqual([
      ["g1", "impute both"],
      ["g2", "scale train"],
    ]);
  });
});
