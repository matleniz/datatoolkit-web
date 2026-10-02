import { describe, expect, it } from "vitest";

import type { JsonSchema, Step } from "../src/api/types";
import {
  describeOps,
  handleCommand,
  isDestructive,
  parseCommand,
  type BridgeDeps,
  type Proposal,
  type Touched,
} from "../src/state/agentCommands";
import { appReducer, emptyWorkspace, initialState, type AppAction, type AppState } from "../src/state/reducer";
import { applyStepOps } from "../src/state/stepOps";
import { currentIdentityKey } from "../src/state/uiContext";

const impute: Step = { op: "impute", target: "both", params: { columns: ["age"] } };
const scale: Step = { op: "scale", target: "both", params: { columns: ["age"] } };
const drop: Step = { op: "drop_columns", target: "both", params: { columns: ["id"] } };

const start = (steps: Step[] = []): AppState => ({
  ...initialState,
  screen: "bench",
  workspace: { ...emptyWorkspace("demo"), steps },
});

/** A fake store: the reducer behind getState / dispatch, review answered by `answer`. */
const COLS = ["age", "income", "churn"];
const distSchema: JsonSchema = {
  type: "object",
  properties: {
    columns: { type: "array", items: { type: "string" }, "x-dtk-widget": "columns" },
    bins: { type: "integer" },
    normalize: { type: "boolean" },
    kind: { type: "string", enum: ["hist", "kde"] },
  },
};

function harness(init: AppState, answer: (p: Proposal) => boolean | Promise<boolean> = () => true) {
  const h = {
    state: init,
    reviews: [] as Proposal[],
    toasts: [] as string[],
    undos: [] as (AppAction[] | undefined)[],
    touches: [] as Touched[],
    settled: 0,
    deps: {} as BridgeDeps,
  };
  h.deps = {
    getState: () => h.state,
    dispatch: (a: AppAction) => {
      h.state = appReducer(h.state, a);
    },
    settle: async () => {
      h.settled += 1;
    },
    review: async (p) => {
      h.reviews.push(p);
      return answer(p);
    },
    announce: (t, undo) => {
      h.toasts.push(t);
      h.undos.push(undo);
    },
    touch: (t) => {
      h.touches.push(t);
    },
    frameColumns: async () => COLS,
    keySchema: async () => distSchema,
  };
  return h;
}

const propose = (s: AppState, ops: unknown[], extra: Record<string, unknown> = {}) => ({
  id: "c1",
  type: "propose_steps",
  workspace: "demo",
  base_identity: currentIdentityKey(s),
  ops,
  ...extra,
});

describe("applyStepOps", () => {
  it("adds, replaces (keeping align) and removes in order", () => {
    const aligned: Step = { ...impute, align: true };
    const out = applyStepOps([aligned, scale], [
      { replace: { index: 0, step: { ...scale, op: "x" } } },
      { add: { step: drop } },
      { remove: { index: 1 } },
    ]);
    expect(out).toEqual({
      steps: [{ ...scale, op: "x", align: true }, drop],
    });
  });

  it("reports an out-of-range index", () => {
    expect(applyStepOps([impute], [{ remove: { index: 3 } }])).toEqual({
      error: "op 0: no step at index 3",
    });
    expect(applyStepOps([], [{ replace: { index: 0, step: impute } }])).toHaveProperty("error");
  });
});

describe("parseCommand", () => {
  it("rejects unknown types and bad payloads", () => {
    expect(parseCommand({ type: "nope" })).toHaveProperty("error");
    expect(parseCommand({ type: "propose_steps", workspace: "w", base_identity: "i", ops: [] })).toHaveProperty("error");
    expect(parseCommand({ type: "propose_steps", workspace: "w", base_identity: "i", ops: [{ add: {} }] })).toHaveProperty("error");
    expect(parseCommand({ type: "propose_steps", workspace: "w", base_identity: "i", ops: [{ add: { step: impute }, remove: { index: 0 } }] })).toHaveProperty("error");
    expect(parseCommand({ type: "open_window", tool: "bogus" })).toHaveProperty("error");
    expect(parseCommand({ type: "select_columns", columns: [1] })).toHaveProperty("error");
    expect(parseCommand({ type: "set_view" })).toHaveProperty("error");
    expect(parseCommand({ type: "set_view", role: "dev" })).toHaveProperty("error");
    expect(parseCommand({ type: "set_view", version: -1 })).toHaveProperty("error");
  });

  it("defaults step target / params and dedupes columns", () => {
    const cmd = parseCommand({
      type: "propose_steps", workspace: "w", base_identity: "i",
      ops: [{ add: { step: { op: "scale" } } }],
    });
    expect(cmd).toMatchObject({ ops: [{ add: { step: { op: "scale", target: "both", params: {} } } }] });
    expect(parseCommand({ type: "select_columns", columns: ["a", "a", "b"] })).toEqual({
      type: "select_columns", columns: ["a", "b"],
    });
  });
});

describe("destructive ops", () => {
  it("flags remove and the dropping ops, not the others", () => {
    expect(isDestructive([{ remove: { index: 0 } }])).toBe(true);
    for (const op of ["drop_columns", "filter_rows", "drop_low_variance", "drop_correlated"]) {
      expect(isDestructive([{ add: { step: { ...impute, op } } }])).toBe(true);
      expect(isDestructive([{ replace: { index: 0, step: { ...impute, op } } }])).toBe(true);
    }
    expect(isDestructive([{ add: { step: impute } }, { add: { step: scale } }])).toBe(false);
  });

  it("describes each op", () => {
    expect(describeOps([{ add: { step: impute } }, { remove: { index: 0 } }], [scale])).toEqual([
      "add impute (age)",
      "remove step 1 (scale)",
    ]);
  });
});

describe("propose_steps", () => {
  it("applies at once, acks the new identity and announces (Undo toast)", async () => {
    const h = harness(start([impute]));
    const before = currentIdentityKey(h.state);
    const ack = await handleCommand(propose(h.state, [{ add: { step: scale } }]), h.deps);
    expect(ack).toEqual({ id: "c1", ok: true, identity: currentIdentityKey(h.state) });
    expect(ack?.identity).not.toBe(before);
    expect(h.state.workspace?.steps.map((s) => s.op)).toEqual(["impute", "scale"]);
    expect(h.settled).toBe(1);
    expect(h.toasts).toEqual(["add scale (age)"]);
    expect(h.reviews).toEqual([]);
  });

  it("is ONE undo entry for the whole batch, and Undo restores the identity", async () => {
    const h = harness(start([impute]));
    const before = currentIdentityKey(h.state);
    await handleCommand(
      propose(h.state, [
        { add: { step: scale } },
        { replace: { index: 0, step: { ...impute, params: { columns: ["fare"] } } } },
      ]),
      h.deps,
    );
    expect(h.state.stepHistory.past).toHaveLength(1);
    h.deps.dispatch({ type: "UNDO_STEPS" });
    expect(h.state.workspace?.steps).toEqual([impute]);
    expect(currentIdentityKey(h.state)).toBe(before);
  });

  it("acks stale for another identity or workspace and changes nothing", async () => {
    const h = harness(start([impute]));
    const steps = h.state.workspace?.steps;
    const old = propose(h.state, [{ add: { step: scale } }]);
    h.deps.dispatch({ type: "ADD_STEP", step: scale });
    expect(await handleCommand(old, h.deps)).toEqual({ id: "c1", ok: false, error: "stale" });
    const other = propose(h.state, [{ add: { step: scale } }], { workspace: "elsewhere" });
    expect(await handleCommand(other, h.deps)).toMatchObject({ error: "stale" });
    expect(h.state.workspace?.steps).toEqual([...(steps ?? []), scale]);
    expect(h.toasts).toEqual([]);
  });

  it("acks bad_command for an invalid index without applying", async () => {
    const h = harness(start([impute]));
    const ack = await handleCommand(propose(h.state, [{ add: { step: scale } }, { remove: { index: 9 } }]), h.deps);
    expect(ack).toMatchObject({ ok: false, error: expect.stringMatching(/^bad_command: /) });
    expect(h.state.workspace?.steps).toEqual([impute]);
    expect(h.reviews).toEqual([]);
  });

  it("shows a destructive proposal for review first; Apply then applies it", async () => {
    const h = harness(start([impute, scale]), () => true);
    const ack = await handleCommand(propose(h.state, [{ remove: { index: 1 } }]), h.deps);
    expect(h.reviews).toEqual([
      { id: "c1", summary: "remove step 2 (scale)", lines: ["remove step 2 (scale)"] },
    ]);
    expect(ack).toMatchObject({ ok: true, identity: currentIdentityKey(h.state) });
    expect(h.state.workspace?.steps).toEqual([impute]);
    expect(h.toasts).toHaveLength(1);
  });

  it("does not touch the pipeline while a destructive proposal is pending, Dismiss acks rejected", async () => {
    let release!: (apply: boolean) => void;
    const h = harness(start([impute]), () => new Promise<boolean>((r) => (release = r)));
    const pending = handleCommand(propose(h.state, [{ add: { step: drop } }]), h.deps);
    await Promise.resolve();
    expect(h.state.workspace?.steps).toEqual([impute]);
    release(false);
    expect(await pending).toEqual({ id: "c1", ok: false, error: "rejected" });
    expect(h.state.workspace?.steps).toEqual([impute]);
    expect(h.toasts).toEqual([]);
  });

  it("re-checks the frame after the review (the user edited meanwhile)", async () => {
    const h = harness(start([impute]), () => {
      h.deps.dispatch({ type: "ADD_STEP", step: scale });
      return true;
    });
    const ack = await handleCommand(propose(h.state, [{ add: { step: drop } }]), h.deps);
    expect(ack).toMatchObject({ ok: false, error: "stale" });
    expect(h.state.workspace?.steps.map((s) => s.op)).toEqual(["impute", "scale"]);
  });

  it("acks save_failed when the save gate rejects (change stays, undoable)", async () => {
    const h = harness(start([impute]));
    h.deps.settle = async () => {
      throw new Error("boom");
    };
    const ack = await handleCommand(propose(h.state, [{ add: { step: scale } }]), h.deps);
    expect(ack).toEqual({ id: "c1", ok: false, error: "save_failed: boom" });
    expect(h.state.stepHistory.past).toHaveLength(1);
  });
});

describe("view commands", () => {
  it("open_window opens the tool, selects the column, sets by and params", async () => {
    const h = harness(start([impute]));
    const ack = await handleCommand(
      { id: "c2", type: "open_window", tool: "dist", params: { column: "age", by: "status", bins: 12 } },
      h.deps,
    );
    expect(ack).toEqual({ id: "c2", ok: true, identity: currentIdentityKey(h.state) });
    expect(h.state.dock.tools).toEqual(["dist"]);
    expect(h.state.selection.columns).toEqual(["age"]);
    expect(h.state.distBy).toBe("status");
    expect(h.state.toolParams["dist::age"]).toEqual({ bins: 12 });
  });

  it("open_window without params just opens it", async () => {
    const h = harness(start());
    await handleCommand({ id: "c", type: "open_window", tool: "corr" }, h.deps);
    expect(h.state.dock.tools).toEqual(["corr"]);
    expect(h.state.toolParams).toEqual({});
  });

  it("select_columns replaces the selection", async () => {
    const h = harness(start());
    h.deps.dispatch({ type: "PICK_COL", name: "old" });
    const ack = await handleCommand({ id: "c", type: "select_columns", columns: ["a", "b"] }, h.deps);
    expect(ack?.ok).toBe(true);
    expect(h.state.selection.columns).toEqual(["a", "b"]);
  });

  it("set_view sets role / version and acks the identity of the new view", async () => {
    const h = harness(start([impute, scale]));
    const ack = await handleCommand({ id: "c", type: "set_view", role: "test", version: 1 }, h.deps);
    expect(h.state.role).toBe("test");
    expect(h.state.viewVersion).toBe(1);
    expect(ack?.identity).toBe(currentIdentityKey(h.state));
    expect(ack?.identity).toContain("|test|v1|");
    const back = await handleCommand({ id: "d", type: "set_view", version: null }, h.deps);
    expect(back?.identity).toContain("|test|v2|");
  });

  it("acks bad_command for an unknown type or invalid payload; no id = no ack", async () => {
    const h = harness(start());
    expect(await handleCommand({ id: "c", type: "explode" }, h.deps)).toMatchObject({
      ok: false, error: expect.stringMatching(/^bad_command: unknown type/),
    });
    expect(await handleCommand({ id: "c", type: "open_window", tool: "zzz" }, h.deps)).toMatchObject({
      ok: false, error: expect.stringMatching(/^bad_command: /),
    });
    expect(await handleCommand({ type: "set_view", role: "train" }, h.deps)).toBeNull();
    expect(await handleCommand("junk", h.deps)).toBeNull();
  });
});

describe("touch and undo plumbing (#88)", () => {
  it("propose_steps touches the new step cards + their columns; Undo is UNDO_STEPS", async () => {
    const h = harness(start([impute]));
    await handleCommand(propose(h.state, [{ add: { step: scale } }]), h.deps);
    expect(h.touches).toEqual([{ steps: [1], columns: ["age"] }]);
    expect(h.undos).toEqual([[{ type: "UNDO_STEPS" }]]);
    h.undos[0]!.forEach(h.deps.dispatch);
    expect(h.state.workspace?.steps).toEqual([impute]);
  });

  it("touches a replaced step but not the untouched ones", async () => {
    const h = harness(start([impute, scale]));
    await handleCommand(
      propose(h.state, [{ replace: { index: 1, step: { ...scale, params: { columns: ["fare"] } } } }]),
      h.deps,
    );
    expect(h.touches).toEqual([{ steps: [1], columns: ["fare"] }]);
  });

  it("a refused command touches and announces nothing", async () => {
    const h = harness(start([impute]));
    await handleCommand(propose(h.state, [{ add: { step: scale } }], { base_identity: "nope" }), h.deps);
    await handleCommand({ id: "x", type: "open_window", tool: "bogus" }, h.deps);
    expect(h.touches).toEqual([]);
    expect(h.toasts).toEqual([]);
  });

  it("select_columns touches the columns; Undo restores the previous selection", async () => {
    const h = harness({
      ...start(),
      selection: { columns: ["fare"], row: null, cell: null, multi: false },
    });
    await handleCommand({ id: "s", type: "select_columns", columns: ["age", "sessions"] }, h.deps);
    expect(h.touches).toEqual([{ columns: ["age", "sessions"] }]);
    expect(h.toasts).toEqual(["selected age, sessions"]);
    expect(h.state.selection.columns).toEqual(["age", "sessions"]);
    h.undos[0]!.forEach(h.deps.dispatch);
    expect(h.state.selection.columns).toEqual(["fare"]);
  });

  it("select_columns of the current selection offers no Undo", async () => {
    const h = harness({
      ...start(),
      selection: { columns: ["age"], row: null, cell: null, multi: false },
    });
    await handleCommand({ id: "s", type: "select_columns", columns: ["age"] }, h.deps);
    expect(h.undos).toEqual([undefined]);
  });

  it("open_window touches the window + column; Undo closes it and restores the selection", async () => {
    const h = harness(start());
    await handleCommand({ id: "w", type: "open_window", tool: "dist", params: { column: "age" } }, h.deps);
    expect(h.touches).toEqual([{ tools: ["dist"], columns: ["age"] }]);
    expect(h.toasts).toEqual(["opened Distribution (age)"]);
    expect(h.state.dock.tools).toEqual(["dist"]);
    h.undos[0]!.forEach(h.deps.dispatch);
    expect(h.state.dock.tools).toEqual([]);
    expect(h.state.selection.columns).toEqual([]);
  });

  it("open_window on an already open window has nothing to undo", async () => {
    const h = harness(start());
    await handleCommand({ id: "w", type: "open_window", tool: "corr" }, h.deps);
    await handleCommand({ id: "w2", type: "open_window", tool: "corr" }, h.deps);
    expect(h.undos[1]).toBeUndefined();
    expect(h.touches[1]).toEqual({ tools: ["corr"] });
  });

  it("set_view announces the view; Undo restores role and version", async () => {
    const h = harness(start([impute]));
    await handleCommand({ id: "v", type: "set_view", role: "test", version: 0 }, h.deps);
    expect(h.toasts).toEqual(["showing test v0"]);
    expect(h.touches).toEqual([{}]);
    h.undos[0]!.forEach(h.deps.dispatch);
    expect(h.state.role).toBe("train");
    expect(h.state.viewVersion).toBeNull();
  });
});

describe("parse set_target / set_dist_by / set_tool_params", () => {
  it("accepts a column or null, refuses a missing / empty / non-string value", () => {
    expect(parseCommand({ type: "set_target", column: "age" })).toEqual({ type: "set_target", column: "age" });
    expect(parseCommand({ type: "set_target", column: null })).toEqual({ type: "set_target", column: null });
    for (const column of [undefined, "", 3]) {
      expect(parseCommand({ type: "set_target", column })).toHaveProperty("error");
    }
    expect(parseCommand({ type: "set_dist_by", by: null })).toEqual({ type: "set_dist_by", by: null });
    expect(parseCommand({ type: "set_dist_by", by: "" })).toHaveProperty("error");
    expect(parseCommand({ type: "set_dist_by" })).toHaveProperty("error");
  });

  it("set_tool_params needs a known tool and non-empty params", () => {
    expect(parseCommand({ type: "set_tool_params", tool: "dist", params: { bins: 5 }, column: "age" })).toEqual({
      type: "set_tool_params", tool: "dist", params: { bins: 5 }, column: "age",
    });
    expect(parseCommand({ type: "set_tool_params", tool: "nope", params: { bins: 5 } })).toHaveProperty("error");
    expect(parseCommand({ type: "set_tool_params", tool: "dist", params: {} })).toHaveProperty("error");
    expect(parseCommand({ type: "set_tool_params", tool: "dist", params: [1] })).toHaveProperty("error");
    expect(parseCommand({ type: "set_tool_params", tool: "dist", params: { bins: 5 }, column: 2 })).toHaveProperty("error");
  });
});

describe("set_target / set_dist_by", () => {
  it("set_target sets the column, highlights it; Undo restores the previous target", async () => {
    const h = harness(start());
    const was = h.state.targetColumn;
    const ack = await handleCommand({ id: "t", type: "set_target", column: "age" }, h.deps);
    expect(ack).toMatchObject({ id: "t", ok: true });
    expect(h.state.targetColumn).toBe("age");
    expect(h.touches).toEqual([{ columns: ["age"] }]);
    expect(h.toasts).toEqual(["target set to age"]);
    h.undos[0]!.forEach(h.deps.dispatch);
    expect(h.state.targetColumn).toBe(was);
  });

  it("set_target null clears the target; same value offers no Undo", async () => {
    const h = harness(start());
    await handleCommand({ id: "t", type: "set_target", column: null }, h.deps);
    expect(h.state.targetColumn).toBeNull();
    expect(h.toasts).toEqual(["target cleared"]);
    await handleCommand({ id: "t2", type: "set_target", column: null }, h.deps);
    expect(h.undos[1]).toBeUndefined();
  });

  it("refuses a column the frame does not have, changing nothing", async () => {
    const h = harness(start());
    const was = h.state.targetColumn;
    const ack = await handleCommand({ id: "t", type: "set_target", column: "ghost" }, h.deps);
    expect(ack).toEqual({ id: "t", ok: false, error: 'bad_command: unknown column "ghost"' });
    expect(h.state.targetColumn).toBe(was);
    expect(h.toasts).toEqual([]);
    expect(h.touches).toEqual([]);
  });

  it("acks frame_unavailable when the columns cannot be read", async () => {
    const h = harness(start());
    h.deps.frameColumns = async () => {
      throw new Error("engine down");
    };
    const ack = await handleCommand({ id: "t", type: "set_target", column: "age" }, h.deps);
    expect(ack).toEqual({ id: "t", ok: false, error: "frame_unavailable: engine down" });
  });

  it("set_dist_by sets the split and highlights the Distribution window; Undo restores it", async () => {
    const h = harness({ ...start(), distBy: "income" });
    await handleCommand({ id: "d", type: "set_dist_by", by: "churn" }, h.deps);
    expect(h.state.distBy).toBe("churn");
    expect(h.touches).toEqual([{ tools: ["dist"], columns: ["churn"] }]);
    h.undos[0]!.forEach(h.deps.dispatch);
    expect(h.state.distBy).toBe("income");
    expect(await handleCommand({ id: "d2", type: "set_dist_by", by: "ghost" }, h.deps)).toMatchObject({
      ok: false, error: expect.stringContaining("bad_command"),
    });
    await handleCommand({ id: "d3", type: "set_dist_by", by: null }, h.deps);
    expect(h.state.distBy).toBeNull();
  });
});

describe("set_tool_params", () => {
  const send = (h: ReturnType<typeof harness>, extra: Record<string, unknown>) =>
    handleCommand({ id: "p", type: "set_tool_params", tool: "dist", ...extra }, h.deps);

  it("stores the params under the window key; Undo clears them when there were none", async () => {
    const h = harness(start());
    const ack = await send(h, { params: { bins: 12, kind: "kde" } });
    expect(ack).toMatchObject({ ok: true });
    expect(h.state.toolParams.dist).toEqual({ bins: 12, kind: "kde" });
    expect(h.touches).toEqual([{ tools: ["dist"] }]);
    h.undos[0]!.forEach(h.deps.dispatch);
    expect(h.state.toolParams).not.toHaveProperty("dist");
  });

  it("per-column tools key by the given column; params merge; Undo restores the previous ones", async () => {
    const h = harness(start());
    await send(h, { params: { bins: 5 }, column: "age" });
    await send(h, { params: { normalize: true }, column: "age" });
    expect(h.state.toolParams["dist::age"]).toEqual({ bins: 5, normalize: true });
    expect(h.touches[1]).toEqual({ tools: ["dist"], columns: ["age"] });
    h.undos[1]!.forEach(h.deps.dispatch);
    expect(h.state.toolParams["dist::age"]).toEqual({ bins: 5 });
  });

  it("without a column a per-column tool follows the focused column, like the dock", async () => {
    const h = harness(start());
    h.deps.dispatch({ type: "PICK_COL", name: "income", add: false });
    await send(h, { params: { bins: 7 } });
    expect(h.state.toolParams["dist::income"]).toEqual({ bins: 7 });
  });

  it("refuses unknown keys, bad values, unknown columns, structural keys", async () => {
    const h = harness(start());
    const cases: [Record<string, unknown>, string][] = [
      [{ params: { nope: 1 } }, 'unknown param "nope"'],
      [{ params: { by: "age" } }, 'unknown param "by"'],
      [{ params: { bins: "many" } }, "params.bins must be"],
      [{ params: { kind: "pie" } }, "params.kind must be one of hist, kde"],
      [{ params: { normalize: "yes" } }, "params.normalize must be a boolean"],
      [{ params: { bins: 5 }, column: "ghost" }, 'unknown column "ghost"'],
    ];
    for (const [extra, why] of cases) {
      const ack = await send(h, extra);
      expect(ack).toMatchObject({ ok: false });
      expect(ack?.error).toContain(`bad_command: `);
      expect(ack?.error).toContain(why);
    }
    expect(h.state.toolParams).toEqual({});
    expect(h.toasts).toEqual([]);
  });

  it("refuses a column on a tool without per-column params", async () => {
    const h = harness(start());
    h.deps.keySchema = async () => ({ type: "object", properties: { top: { type: "integer" } } });
    const ack = await handleCommand(
      { id: "p", type: "set_tool_params", tool: "corr", params: { top: 3 }, column: "age" },
      h.deps,
    );
    expect(ack?.error).toBe("bad_command: corr has no per-column params");
  });

  it("refuses a tool whose schema has no tunable params", async () => {
    const h = harness(start());
    h.deps.keySchema = async () => ({ type: "object", properties: { columns: { type: "array", "x-dtk-widget": "columns" } } });
    expect((await send(h, { params: { bins: 5 } }))?.error).toBe("bad_command: dist has no tunable params");
  });
});

describe("agentTouch slice", () => {
  const touch = { columns: ["age"], tools: [], steps: [], at: 5 };
  it("is set by AGENT_TOUCH and cleared only by the matching timestamp", () => {
    let s = appReducer(initialState, { type: "AGENT_TOUCH", touch });
    expect(s.agentTouch).toEqual(touch);
    s = appReducer(s, { type: "AGENT_TOUCH_CLEAR", at: 4 });
    expect(s.agentTouch).toEqual(touch);
    s = appReducer(s, { type: "AGENT_TOUCH_CLEAR", at: 5 });
    expect(s.agentTouch).toBeNull();
  });
});

describe("set_grid_view", () => {
  const cond = { column: "age", op: "gt", value: 30 };
  const filter = { conditions: [cond], combine: "and" };
  const send = (h: ReturnType<typeof harness>, extra: Record<string, unknown>) =>
    handleCommand({ id: "g", type: "set_grid_view", ...extra }, h.deps);

  it("parses filter / sort, null clears, omitted stays undefined", () => {
    expect(parseCommand({ type: "set_grid_view", filter, sort: [{ column: "age", desc: false }] })).toEqual({
      type: "set_grid_view", filter, sort: [{ column: "age", desc: false }],
    });
    expect(parseCommand({ type: "set_grid_view", filter: null })).toEqual({ type: "set_grid_view", filter: null });
    expect(parseCommand({ type: "set_grid_view", sort: null })).toEqual({ type: "set_grid_view", sort: null });
  });

  it("refuses malformed views", () => {
    const bad = [
      {},
      { filter: "x" },
      { filter: { conditions: [], combine: "and" } },
      { filter: { conditions: [cond], combine: "xor" } },
      { filter: { conditions: [{ column: "age", op: "like", value: 1 }], combine: "and" } },
      { filter: { conditions: [{ column: "age", op: "gt" }], combine: "and" } },
      { filter: { conditions: [{ column: "age", op: "isna", value: 1 }], combine: "and" } },
      { filter: { conditions: [{ column: "age", op: "isin", value: 3 }], combine: "and" } },
      { sort: [] },
      { sort: [{ column: "age" }] },
    ];
    for (const extra of bad) expect(parseCommand({ type: "set_grid_view", ...extra })).toHaveProperty("error");
  });

  it("sets the view without touching the pipeline; Undo restores the previous view", async () => {
    const h = harness(start());
    const steps = h.state.workspace?.steps;
    const ack = await send(h, { filter, sort: [{ column: "income", desc: true }] });
    expect(ack).toMatchObject({ id: "g", ok: true, identity: currentIdentityKey(h.state) });
    expect(h.state.gridView).toEqual({ filter, sort: [{ column: "income", desc: true }] });
    expect(h.state.workspace?.steps).toBe(steps);
    expect(h.touches).toEqual([{ columns: ["age", "income"] }]);
    h.undos[0]!.forEach(h.deps.dispatch);
    expect(h.state.gridView).toEqual({ filter: null, sort: [] });
  });

  it("omitted keeps, null clears", async () => {
    const h = harness(start());
    await send(h, { filter, sort: [{ column: "income", desc: false }] });
    await send(h, { sort: null });
    expect(h.state.gridView).toEqual({ filter, sort: [] });
    await send(h, { sort: [{ column: "churn", desc: true }] });
    expect(h.state.gridView.filter).toEqual(filter);
    await send(h, { filter: null });
    expect(h.state.gridView).toEqual({ filter: null, sort: [{ column: "churn", desc: true }] });
    expect(h.toasts.at(-1)).toBe("Grid view: sort by churn");
    await send(h, { sort: null });
    expect(h.toasts.at(-1)).toBe("Grid view cleared");
  });

  it("an unchanged view offers no Undo", async () => {
    const h = harness(start());
    await send(h, { filter: null });
    expect(h.undos[0]).toBeUndefined();
  });

  it("refuses unknown columns and acks frame_unavailable, changing nothing", async () => {
    const h = harness(start());
    expect(await send(h, { sort: [{ column: "ghost", desc: false }] })).toEqual({
      id: "g", ok: false, error: 'bad_command: unknown column "ghost"',
    });
    expect(h.state.gridView).toEqual({ filter: null, sort: [] });
    h.deps.frameColumns = async () => {
      throw new Error("engine down");
    };
    expect(await send(h, { filter })).toEqual({ id: "g", ok: false, error: "frame_unavailable: engine down" });
  });
});
