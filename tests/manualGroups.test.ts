import { describe, expect, it } from "vitest";

import type { Group, Step, Workspace } from "../src/api/types";
import { handleCommand, parseCommand, proposalGroup, type BridgeDeps } from "../src/state/agentCommands";
import { appReducer, emptyWorkspace, initialState, type AppAction, type AppState } from "../src/state/reducer";
import {
  assertValidGroups,
  contiguousRowSteps,
  groupSteps,
  renameGroup,
  ungroup,
  validateGroups,
  type StepList,
} from "../src/state/stepGroups";
import { applyStepOps } from "../src/state/stepOps";
import { currentIdentityKey } from "../src/state/uiContext";

const step = (id: string, op = "impute", extra: Partial<Step> = {}): Step => ({
  id,
  op,
  target: "both",
  params: {},
  ...extra,
});
const grp = (id: string, name: string, ...step_ids: string[]): Group => ({
  id,
  name,
  intent: "",
  step_ids,
  origin: "auto",
  produced_by: null,
});
const shape = (list: StepList) => list.groups.map((g) => g.step_ids.join("+"));

/** s1, s2+s3 (group "Pair"), s4, s5. */
const five = (): StepList => ({
  steps: ["s1", "s2", "s3", "s4", "s5"].map((id) => step(id)),
  groups: [grp("g1", "one", "s1"), grp("gab", "Pair", "s2", "s3"), grp("g4", "four", "s4"), grp("g5", "five", "s5")],
});
const ok = (r: StepList | { error: string }): StepList => {
  if ("error" in r) throw new Error(r.error);
  return r;
};

describe("contiguousRowSteps: the union of the selected rows", () => {
  it("is the steps of the rows, whole groups included, in step order", () => {
    expect(contiguousRowSteps(five().groups, new Set(["g1", "gab"]))).toEqual(["s1", "s2", "s3"]);
    expect(contiguousRowSteps(five().groups, new Set(["g4", "gab"]))).toEqual(["s2", "s3", "s4"]);
  });
  it("is null for one row, a gap, or an unknown id", () => {
    expect(contiguousRowSteps(five().groups, new Set(["g1"]))).toBeNull();
    expect(contiguousRowSteps(five().groups, new Set(["g1", "g4"]))).toBeNull();
    expect(contiguousRowSteps(five().groups, new Set(["g1", "nope"]))).toBeNull();
  });
});

describe("groupSteps (manual group)", () => {
  it("merges two singleton rows into one manual group of the union", () => {
    const out = ok(groupSteps(five(), ["s4", "s5"], { name: " Tail ", intent: "why", origin: "manual" }));
    expect(shape(out)).toEqual(["s1", "s2+s3", "s4+s5"]);
    expect(out.groups[2]).toMatchObject({ name: "Tail", intent: "why", origin: "manual", produced_by: null });
    expect(validateGroups(out.steps, out.groups)).toBeNull();
  });
  it("absorbs a whole group with its neighbour", () => {
    const out = ok(groupSteps(five(), ["s1", "s2", "s3"], { name: "Head", origin: "manual" }));
    expect(shape(out)).toEqual(["s1+s2+s3", "s4", "s5"]);
    expect(out.groups.map((g) => g.id)).not.toContain("gab");
  });
  it("refuses a bad name or a gap, and changes nothing", () => {
    const list = five();
    for (const name of ["", "  ", "x".repeat(81), "a\nb", "a\u0000b", "a\u2028b"]) {
      expect(groupSteps(list, ["s4", "s5"], { name, origin: "manual" })).toHaveProperty("error");
    }
    expect(groupSteps(list, ["s1", "s4"], { name: "Gap", origin: "manual" })).toHaveProperty("error");
    expect(groupSteps(list, ["s4", "s4"], { name: "Dup", origin: "manual" })).toHaveProperty("error");
    expect(groupSteps(list, ["s4", "s5"], { name: "Long", intent: "x".repeat(401), origin: "manual" })).toHaveProperty(
      "error",
    );
  });
});

describe("ungroup", () => {
  it("turns the steps into singleton groups with the engine's ids and names", () => {
    const out = ungroup(five(), "gab");
    expect(shape(out)).toEqual(["s1", "s2", "s3", "s4", "s5"]);
    expect(out.groups.map((g) => g.id)).toEqual(["g1", "g2", "g3", "g4", "g5"]);
    expect(out.groups[1]).toMatchObject({ name: "impute both", intent: "", origin: "auto", produced_by: null });
    expect(validateGroups(out.steps, out.groups)).toBeNull();
  });
  it("suffixes an id the other groups already hold, and ignores an unknown group", () => {
    const list = five();
    list.groups[0] = grp("g2", "taken", "s1");
    const out = ungroup(list, "gab");
    expect(out.groups.map((g) => g.id)).toEqual(["g2", "g2-2", "g3", "g4", "g5"]);
    const same = five();
    expect(ungroup(same, "nope")).toBe(same);
  });
});

describe("renameGroup", () => {
  it("renames, re-describes and marks the group manual", () => {
    const out = ok(renameGroup(five(), "gab", "  New name ", " because "));
    expect(out.groups[1]).toMatchObject({ id: "gab", name: "New name", intent: "because", origin: "manual" });
  });
  it("is a no-op (same list, so no undo level and no PUT) when nothing changes", () => {
    const list = five();
    expect(renameGroup(list, "gab", "Pair", "")).toBe(list);
  });
  it.each([
    ["empty", ""],
    ["blank", "   "],
    ["over 80", "x".repeat(81)],
    ["newline", "a\nb"],
    ["carriage return", "a\rb"],
    ["control char", "a\u0007b"],
    ["U+2028", "a\u2028b"],
    ["U+2029", "a\u2029b"],
  ])("refuses a name that is %s", (_, name) => {
    expect(renameGroup(five(), "gab", name, "")).toHaveProperty("error");
  });
  it("refuses an intent over 400 characters", () => {
    expect(renameGroup(five(), "gab", "ok", "x".repeat(401))).toHaveProperty("error");
  });
});

describe("applyStepOps with a group: one proposal = one group", () => {
  const meta = { name: "Impute ledd", intent: "why", origin: "auto" as const, produced_by: "agent" };
  const add = (id: string) => ({ add: { step: step(id, "scale") } });

  it("puts every added step in ONE group", () => {
    const out = ok(applyStepOps(five(), [add("sa"), add("sb"), add("sc")], meta));
    expect(shape(out)).toEqual(["s1", "s2+s3", "s4", "s5", "sa+sb+sc"]);
    expect(out.groups.at(-1)).toMatchObject({ name: "Impute ledd", intent: "why", origin: "auto", produced_by: "agent" });
    assertValidGroups(out.steps, out.groups);
  });
  it("without a group the added steps stay singletons (the fix is what groups them)", () => {
    expect(shape(ok(applyStepOps(five(), [add("sa"), add("sb")])))).toEqual(["s1", "s2+s3", "s4", "s5", "sa", "sb"]);
  });
  it("a one-step proposal still gets its group", () => {
    const out = ok(applyStepOps(five(), [add("sa")], meta));
    expect(out.groups.at(-1)).toMatchObject({ step_ids: ["sa"], name: "Impute ledd", produced_by: "agent" });
  });
  it("a replace keeps the step id and its group; only the added steps are regrouped", () => {
    const out = ok(
      applyStepOps(five(), [{ replace: { id: "s2", step: step("zzz", "scale") } }, add("sa"), add("sb")], meta),
    );
    expect(shape(out)).toEqual(["s1", "s2+s3", "s4", "s5", "sa+sb"]);
    expect(out.groups[1]!.id).toBe("gab");
    expect(out.steps[1]!.op).toBe("scale");
  });
  it("a replace-only or remove-only batch makes no group", () => {
    const out = ok(applyStepOps(five(), [{ remove: { id: "s4" } }], meta));
    expect(shape(out)).toEqual(["s1", "s2+s3", "s5"]);
    expect(out.groups.every((g) => g.produced_by === null)).toBe(true);
  });
  it("a step added then removed by the same batch is not grouped", () => {
    const out = ok(applyStepOps(five(), [add("sa"), add("sb"), { remove: { id: "sa" } }], meta));
    expect(out.groups.at(-1)).toMatchObject({ step_ids: ["sb"], name: "Impute ledd" });
  });
  it("a UI action that adds several steps sends one group with produced_by ui:<action>", () => {
    const out = ok(
      applyStepOps(five(), [add("sa"), add("sb")], {
        name: "Add column and reorder",
        origin: "auto",
        produced_by: "ui:add_column",
      }),
    );
    expect(out.groups.at(-1)).toMatchObject({ step_ids: ["sa", "sb"], produced_by: "ui:add_column" });
  });
});

describe("proposalGroup: name and intent of an agent group", () => {
  const cmd = (extra: Record<string, unknown>, ops: unknown[]) => {
    const parsed = parseCommand({ type: "propose_steps", workspace: "w", base_identity: "i", ops, ...extra });
    if ("error" in parsed || parsed.type !== "propose_steps") throw new Error("parse");
    return parsed;
  };
  const addOp = (extra: Partial<Step> = {}) => ({ add: { step: { op: "impute", target: "train", params: {}, ...extra } } });

  it("uses the agent's group name and intent", () => {
    const g = proposalGroup(cmd({ group: { name: "Impute ledd", intent: "median" } }, [addOp({ note: "other" })]));
    expect(g).toEqual({ name: "Impute ledd", intent: "median", origin: "auto", produced_by: "agent" });
  });
  it("derives the name from the first line of the note, and the intent from the whole note", () => {
    const g = proposalGroup(cmd({}, [addOp({ note: "  Fill ledd gaps \nmedian, 12 rows" })]));
    expect(g.name).toBe("Fill ledd gaps");
    expect(g.intent).toBe("Fill ledd gaps \nmedian, 12 rows");
  });
  it("cuts a long note line to 80 characters and the intent to 400", () => {
    const g = proposalGroup(cmd({}, [addOp({ note: "y".repeat(500) })]));
    expect(g.name).toHaveLength(80);
    expect(g.intent).toHaveLength(400);
  });
  it("falls back on '<op> <target>' without a usable note or name", () => {
    expect(proposalGroup(cmd({}, [addOp()])).name).toBe("impute train");
    expect(proposalGroup(cmd({ group: { name: "a\nb" } }, [addOp()])).name).toBe("impute train");
    expect(proposalGroup(cmd({}, [addOp({ note: "ba\u2028d" })])).name).toBe("impute train");
  });
});

describe("agent proposal through the bridge: one group, one undo", () => {
  const open = (steps: Step[]): AppState => {
    const workspace: Workspace = { ...emptyWorkspace("demo"), steps, groups: [] };
    return appReducer({ ...initialState, screen: "bench" }, { type: "SET_WORKSPACE", workspace });
  };
  function bridge(init: AppState) {
    const h = { state: init, deps: {} as BridgeDeps };
    h.deps = {
      getState: () => h.state,
      dispatch: (a: AppAction) => {
        h.state = appReducer(h.state, a);
      },
      settle: async () => {},
      review: async () => true,
      announce: () => {},
      touch: () => {},
      reviewPending: () => false,
    } as unknown as BridgeDeps;
    return h;
  }

  it("lands all steps in one auto/agent group and undoes with the existing undo", async () => {
    const h = bridge(open([step("s1")]));
    const cmd = {
      id: "c1",
      type: "propose_steps",
      workspace: "demo",
      base_identity: currentIdentityKey(h.state),
      group: { name: "Scale ages", intent: "same range" },
      ops: [
        { add: { step: { op: "scale", target: "both", params: { columns: ["age"] } } } },
        { add: { step: { op: "scale", target: "both", params: { columns: ["fare"] } } } },
      ],
    };
    const ack = await handleCommand(cmd, h.deps);
    expect(ack).toMatchObject({ ok: true });
    const ws = h.state.workspace!;
    assertValidGroups(ws.steps, ws.groups);
    expect(ws.groups).toHaveLength(2);
    expect(ws.groups[1]).toMatchObject({ name: "Scale ages", origin: "auto", produced_by: "agent", intent: "same range" });
    expect(ws.groups[1]!.step_ids).toHaveLength(2);
    h.state = appReducer(h.state, { type: "UNDO_STEPS" });
    expect(h.state.workspace!.groups.map((g) => g.step_ids)).toEqual([["s1"]]);
  });
});

describe("GROUP_ROWS / UNGROUP / RENAME_GROUP actions", () => {
  const open = (): AppState =>
    appReducer(
      { ...initialState, screen: "bench" },
      { type: "SET_WORKSPACE", workspace: { ...emptyWorkspace("demo"), steps: five().steps, groups: five().groups } },
    );
  const ws = (s: AppState) => s.workspace!;

  it("each is one undoable change that leaves a valid partition", () => {
    let s = open();
    s = appReducer(s, { type: "GROUP_ROWS", groupIds: ["g4", "g5"], name: "Tail", intent: "" });
    expect(shape(ws(s))).toEqual(["s1", "s2+s3", "s4+s5"]);
    assertValidGroups(ws(s).steps, ws(s).groups);
    expect(s.stepHistory.past).toHaveLength(1);
    const id = ws(s).groups[2]!.id;
    s = appReducer(s, { type: "RENAME_GROUP", id, name: "Last two", intent: "x" });
    expect(ws(s).groups[2]).toMatchObject({ name: "Last two", origin: "manual" });
    s = appReducer(s, { type: "UNGROUP", id });
    expect(shape(ws(s))).toEqual(["s1", "s2+s3", "s4", "s5"]);
    expect(s.stepHistory.past).toHaveLength(3);
    s = appReducer(s, { type: "UNDO_STEPS" });
    expect(ws(s).groups[2]!.name).toBe("Last two");
    s = appReducer(s, { type: "UNDO_STEPS" });
    expect(ws(s).groups[2]!.name).toBe("Tail");
    s = appReducer(s, { type: "UNDO_STEPS" });
    expect(shape(ws(s))).toEqual(["s1", "s2+s3", "s4", "s5"]);
    assertValidGroups(ws(s).steps, ws(s).groups);
  });
  it("invalid input changes nothing and records no undo level", () => {
    const s = open();
    for (const a of [
      { type: "GROUP_ROWS", groupIds: ["g1", "g4"], name: "gap", intent: "" },
      { type: "GROUP_ROWS", groupIds: ["g4", "g5"], name: "bad\nname", intent: "" },
      { type: "RENAME_GROUP", id: "gab", name: "", intent: "" },
      { type: "RENAME_GROUP", id: "gab", name: "Pair", intent: "" },
      { type: "UNGROUP", id: "nope" },
    ] as AppAction[]) {
      expect(appReducer(s, a)).toBe(s);
    }
  });
});
