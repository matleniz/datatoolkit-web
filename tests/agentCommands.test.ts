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
import { fillStepIds, withNewId } from "../src/state/stepIds";
import { currentIdentityKey } from "../src/state/uiContext";

const impute: Step = { op: "impute", target: "both", params: { columns: ["age"] } };
const scale: Step = { op: "scale", target: "both", params: { columns: ["age"] } };
const drop: Step = { op: "drop_columns", target: "both", params: { columns: ["id"] } };

/** Steps without their stable ids (minted at random on create, #153). */
const withoutIds = (steps: Step[]) => steps.map(({ id: _id, ...s }) => s);
const MINTED = /^s[0-9a-f]{8}$/;

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
    gridSettled: 0,
    pending: false,
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
    gridSettled: async () => {
      h.gridSettled += 1;
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
    reviewPending: () => h.pending,
    opSchema: async (op) => {
      if (op !== "impute" && op !== "scale") throw new Error("404");
      return { type: "object", properties: { columns: {}, strategy: {}, value: {} } };
    },
    frameColumns: async () => COLS,
    keySchema: async () => distSchema,
    // `fare` was renamed from `fare_raw` by a step (#152 origin keys).
    latestColumns: async () => ({ names: [...COLS, "fare"], keys: { fare: "fare_raw" } }),
    attachmentFile: async (attId) =>
      attId === "a1" ? { name: "dictionary.md", path: "/up/abc/dictionary.md" } : null,
    describeDocument: async (path, name) => ({
      name: name ?? "x", path, mime: "text/markdown", size: 12, kind: "text", added_at: "2026-10-06T12:00:00Z",
    }),
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
    if ("error" in out) throw new Error(out.error);
    expect(withoutIds(out.steps)).toEqual([{ ...scale, op: "x", align: true }, drop]);
    expect(out.steps[1]!.id).toMatch(MINTED);
  });

  it("targets steps by id: a replace keeps the id, a remove drops it (#153)", () => {
    const steps = [
      { ...impute, id: "s1", align: true },
      { ...scale, id: "s2" },
    ];
    const out = applyStepOps(steps, [
      { replace: { id: "s1", step: { ...drop, id: "sother" } } },
      { remove: { id: "s2" } },
    ]);
    expect(out).toEqual({ steps: [{ ...drop, id: "s1", align: true }] });
    expect(applyStepOps(steps, [{ remove: { id: "s9" } }])).toEqual({
      error: "op 0: no step s9",
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
    const added = h.state.workspace?.steps[1]?.id;
    expect(added).toMatch(MINTED);
    expect(ack).toEqual({
      id: "c1",
      ok: true,
      identity: currentIdentityKey(h.state),
      added_ids: [added],
    });
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
    expect(withoutIds(h.state.workspace?.steps ?? [])).toEqual([impute]);
    expect(currentIdentityKey(h.state)).toBe(before);
  });

  it("index ops: acks stale for another identity; any op: for another workspace", async () => {
    const h = harness(start([impute]));
    const steps = h.state.workspace?.steps;
    const old = propose(h.state, [{ replace: { index: 0, step: scale } }]);
    h.deps.dispatch({ type: "ADD_STEP", step: scale });
    expect(await handleCommand(old, h.deps)).toEqual({ id: "c1", ok: false, error: "stale" });
    const other = propose(h.state, [{ add: { step: scale } }], { workspace: "elsewhere" });
    expect(await handleCommand(other, h.deps)).toMatchObject({
      error: 'stale: workspace "elsewhere" is not open in Studio (open: "demo")',
    });
    expect(withoutIds(h.state.workspace?.steps ?? [])).toEqual([...(steps ?? []), scale]);
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
    const ack = await handleCommand(propose(h.state, [{ replace: { index: 0, step: drop } }]), h.deps);
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

describe("stable step ids (datatoolkit-issues#153)", () => {
  const ided = (steps: Step[]) => steps.map((s, i) => ({ ...s, id: `s${i + 1}` }));
  const base = (steps: Step[]) =>
    Object.fromEntries(steps.map(({ id, op, target, params }) => [id!, { op, target, params }]));

  it("fills missing ids with the engine's migration rule", () => {
    expect(fillStepIds([impute, { ...scale, id: "s1" }, drop]).map((s) => s.id)).toEqual([
      "s1-2",
      "s1",
      "s3",
    ]);
    const done = ided([impute]);
    expect(fillStepIds(done)).toBe(done);
  });

  it("mints a fresh id for a new step, also for a copy of an existing one", () => {
    expect(withNewId(impute, []).id).toMatch(MINTED);
    expect(withNewId({ ...scale, id: "sfree" }, ided([impute])).id).toBe("sfree");
    expect(withNewId({ ...impute, id: "s1" }, ided([impute])).id).toMatch(MINTED);
  });

  it("the reducer fills ids on load, mints on ADD_STEP, keeps them on edit and undo", () => {
    let s = appReducer(initialState, {
      type: "SET_WORKSPACE",
      workspace: { ...emptyWorkspace("demo"), steps: [impute, scale] },
    });
    expect(s.workspace?.steps.map((x) => x.id)).toEqual(["s1", "s2"]);
    s = appReducer(s, { type: "ADD_STEP", step: drop });
    expect(s.workspace?.steps[2]?.id).toMatch(MINTED);
    s = appReducer(s, { type: "REPLACE_STEP", index: 0, step: { ...scale, id: "zz" } });
    expect(s.workspace?.steps[0]).toEqual({ ...scale, id: "s1" });
    s = appReducer(s, { type: "UNDO_STEPS" });
    expect(s.workspace?.steps[0]).toEqual({ ...impute, id: "s1" });
  });

  it("parses id forms and base_steps; refuses id + index together", () => {
    const ok = parseCommand({
      type: "propose_steps",
      workspace: "demo",
      base_identity: "x",
      ops: [{ remove: { id: "s1" } }, { replace: { id: "s2", step: { op: "scale" } } }],
      base_steps: { s1: { op: "impute", params: { columns: ["age"] } } },
    });
    expect(ok).toMatchObject({
      ops: [{ remove: { id: "s1" } }, { replace: { id: "s2", step: { op: "scale", target: "both" } } }],
      base_steps: { s1: { op: "impute", target: "both", params: { columns: ["age"] } } },
    });
    const bad = (ops: unknown[], extra = {}) =>
      parseCommand({ type: "propose_steps", workspace: "d", base_identity: "x", ops, ...extra });
    expect(bad([{ remove: { id: "s1", index: 0 } }])).toEqual({
      error: "ops[0]: remove needs exactly one of id / index",
    });
    expect(bad([{ remove: { id: "" } }])).toHaveProperty("error");
    expect(bad([{ remove: { id: "s1" } }], { base_steps: { s1: 3 } })).toHaveProperty("error");
  });

  it("rebases: applies while the targeted ids are unchanged, whatever else the user did", async () => {
    const steps = ided([impute, scale]);
    const h = harness(start(steps));
    const cmd = propose(
      h.state,
      [{ replace: { id: "s2", step: { ...scale, params: { columns: ["fare"] } } } }, { add: { step: drop } }],
      { base_steps: base(steps) },
    );
    // The user edits s1 and adds a step: the frame moved, s2 did not.
    h.deps.dispatch({ type: "REPLACE_STEP", index: 0, step: { ...impute, params: { columns: ["x"] } } });
    h.deps.dispatch({ type: "ADD_STEP", step: impute });
    const ack = await handleCommand(cmd, h.deps);
    const now = h.state.workspace?.steps ?? [];
    expect(ack).toMatchObject({ ok: true, added_ids: [now[3]!.id] });
    expect(now.map((s) => s.id).slice(0, 2)).toEqual(["s1", "s2"]);
    expect(now[1]!.params).toEqual({ columns: ["fare"] });
    expect(now.map((s) => s.op)).toEqual(["impute", "scale", "impute", "drop_columns"]);
  });

  it("acks stale with which ids were removed or changed, and applies nothing", async () => {
    const steps = ided([impute, scale, drop]);
    const h = harness(start(steps));
    const cmd = propose(
      h.state,
      [
        { replace: { id: "s1", step: scale } },
        { replace: { id: "s2", step: impute } },
        { remove: { id: "s9" } },
      ],
      { base_steps: base(steps) },
    );
    h.deps.dispatch({ type: "REPLACE_STEP", index: 0, step: { ...impute, params: { columns: ["x"] } } });
    h.deps.dispatch({ type: "REMOVE_STEP", index: 1 });
    const before = h.state.workspace?.steps;
    expect(await handleCommand(cmd, h.deps)).toEqual({
      id: "c1",
      ok: false,
      error:
        "stale: step s1 (impute) changed by the user; step s2 (scale) removed; step s9 removed",
      stale: [
        { id: "s1", reason: "changed", step: { ...impute, id: "s1", params: { columns: ["x"] } } },
        { id: "s2", reason: "removed" },
        { id: "s9", reason: "removed" },
      ],
    });
    expect(h.state.workspace?.steps).toBe(before);
    expect(h.reviews).toEqual([]);
  });

  it("a step equal to its base (JSON value, key order aside) is unchanged", async () => {
    const steps = ided([{ op: "impute", target: "both", params: { columns: ["age"], value: 1 } }]);
    const h = harness(start(steps));
    const ack = await handleCommand(
      propose(h.state, [{ replace: { id: "s1", step: scale } }], {
        base_identity: "elsewhere",
        base_steps: { s1: { params: { value: 1.0, columns: ["age"] }, target: "both", op: "impute" } },
      }),
      h.deps,
    );
    expect(ack).toMatchObject({ ok: true });
  });

  it("re-checks ids after the review; describes ops by position", async () => {
    const steps = ided([impute, scale]);
    const h = harness(start(steps), () => {
      h.deps.dispatch({ type: "REPLACE_STEP", index: 1, step: { ...scale, target: "train" } });
      return true;
    });
    const ack = await handleCommand(
      propose(h.state, [{ remove: { id: "s2" } }], { base_steps: base(steps) }),
      h.deps,
    );
    expect(h.reviews[0]?.lines).toEqual(["remove step 2 (scale)"]);
    expect(ack).toMatchObject({ ok: false, error: "stale: step s2 (scale) changed by the user" });
    expect(h.state.workspace?.steps).toHaveLength(2);
  });

  it("a command mixing id and index ops keeps the index rule", async () => {
    const h = harness(start(ided([impute, scale])));
    const cmd = propose(h.state, [{ remove: { id: "s2" } }, { remove: { index: 0 } }]);
    h.deps.dispatch({ type: "ADD_STEP", step: drop });
    expect(await handleCommand(cmd, h.deps)).toEqual({ id: "c1", ok: false, error: "stale" });
  });
});

describe("notes (datatoolkit-issues#152)", () => {
  const ided = (steps: Step[]) => steps.map((s, i) => ({ ...s, id: `s${i + 1}` }));
  const setNote = (extra: Record<string, unknown>) => ({
    id: "n1", type: "set_note", workspace: "demo", ...extra,
  });

  it("note actions are one undo entry each; notes never change the data identity", () => {
    let s = start(ided([impute, scale]));
    const identity = currentIdentityKey(s);
    s = appReducer(s, { type: "SET_STEP_NOTE", id: "s2", text: "why we scale" });
    s = appReducer(s, { type: "SET_COLUMN_NOTE", key: "age", text: "years" });
    s = appReducer(s, { type: "SET_WORKSPACE_NOTE", text: "parkison dogfood" });
    expect(s.workspace?.steps[1]?.note).toBe("why we scale");
    expect(s.workspace?.notes).toEqual({ workspace: "parkison dogfood", columns: { age: "years" } });
    expect(s.stepHistory.past).toHaveLength(3);
    expect(currentIdentityKey(s)).toBe(identity);
    s = appReducer(s, { type: "UNDO_STEPS" });
    expect(s.workspace?.notes).toEqual({ workspace: null, columns: { age: "years" } });
    s = appReducer(s, { type: "UNDO_STEPS" });
    s = appReducer(s, { type: "UNDO_STEPS" });
    expect(s.workspace?.steps[1]?.note).toBeUndefined();
    s = appReducer(s, { type: "REDO_STEPS" });
    expect(s.workspace?.steps[1]?.note).toBe("why we scale");
    // A blank text removes the note.
    s = appReducer(s, { type: "SET_STEP_NOTE", id: "s2", text: "  " });
    expect(s.workspace?.steps[1]).not.toHaveProperty("note");
  });

  it("a replace keeps the note unless the new step sets one", () => {
    const steps = [{ ...impute, id: "s1", note: "keep me" }];
    const kept = applyStepOps(steps, [{ replace: { id: "s1", step: scale } }]);
    expect(kept).toEqual({ steps: [{ ...scale, id: "s1", note: "keep me" }] });
    const cleared = applyStepOps(steps, [{ replace: { id: "s1", step: { ...scale, note: "" } } }]);
    expect(cleared).toEqual({ steps: [{ ...scale, id: "s1" }] });
    let s = start(steps);
    s = appReducer(s, { type: "REPLACE_STEP", index: 0, step: scale });
    expect(s.workspace?.steps[0]?.note).toBe("keep me");
  });

  it("parses set_note and refuses bad payloads", () => {
    expect(parseCommand(setNote({ kind: "column", column: "age", text: "x" }))).toEqual({
      type: "set_note", workspace: "demo", kind: "column", column: "age", text: "x",
    });
    expect(parseCommand(setNote({ kind: "step", text: "x" }))).toHaveProperty("error");
    expect(parseCommand(setNote({ kind: "column", text: "x" }))).toHaveProperty("error");
    expect(parseCommand(setNote({ kind: "row", text: "x" }))).toHaveProperty("error");
    expect(parseCommand(setNote({ kind: "workspace", text: "x".repeat(4001) }))).toEqual({
      error: "note longer than 4000 characters",
    });
  });

  it("set_note writes step / column (origin key) / workspace notes, acks, Undo reverts", async () => {
    const h = harness(start(ided([impute, scale])));
    const identity = currentIdentityKey(h.state);
    expect(await handleCommand(setNote({ kind: "step", step_id: "s2", text: "scaled for knn" }), h.deps))
      .toEqual({ id: "n1", ok: true, identity });
    expect(h.state.workspace?.steps[1]?.note).toBe("scaled for knn");
    expect(h.touches.at(-1)).toEqual({ steps: [1] });
    await handleCommand(setNote({ kind: "column", column: "fare", text: "in euros" }), h.deps);
    expect(h.state.workspace?.notes?.columns).toEqual({ fare_raw: "in euros" });
    await handleCommand(setNote({ kind: "workspace", text: "train only" }), h.deps);
    expect(h.state.workspace?.notes?.workspace).toBe("train only");
    expect(h.toasts).toEqual([
      "note on step 2 (scale)", "note on column fare", "note on the workspace",
    ]);
    expect(h.settled).toBe(3);
    h.undos.at(-1)!.forEach(h.deps.dispatch);
    expect(h.state.workspace?.notes?.workspace).toBeNull();
    await handleCommand(setNote({ kind: "step", step_id: "s2", text: "" }), h.deps);
    expect(h.toasts.at(-1)).toBe("removed the note on step 2 (scale)");
  });

  it("set_note refuses an unknown step / column and another workspace", async () => {
    const h = harness(start(ided([impute])));
    expect(await handleCommand(setNote({ kind: "step", step_id: "s9", text: "x" }), h.deps))
      .toEqual({ id: "n1", ok: false, error: "bad_command: no step s9" });
    expect(await handleCommand(setNote({ kind: "column", column: "nope", text: "x" }), h.deps))
      .toEqual({ id: "n1", ok: false, error: "bad_command: no column nope" });
    expect(await handleCommand(setNote({ kind: "workspace", text: "x", workspace: "other" }), h.deps))
      .toMatchObject({ ok: false, error: expect.stringMatching(/^stale: workspace "other"/) });
    expect(h.state.stepHistory.past).toHaveLength(0);
    expect(h.toasts).toEqual([]);
  });
});

describe("agent memory (datatoolkit-issues#179)", () => {
  const remember = (extra: Record<string, unknown>) => ({
    id: "r1", type: "remember", workspace: "demo", ...extra,
  });
  const forget = (extra: Record<string, unknown>) => ({
    id: "f1", type: "forget", workspace: "demo", ...extra,
  });

  it("parses remember / forget and refuses bad payloads", () => {
    expect(parseCommand(remember({ text: "ledd in mg/day", kind: "fact" }))).toEqual({
      type: "remember", workspace: "demo", text: "ledd in mg/day", kind: "fact",
    });
    expect(parseCommand(remember({ text: "x", memory_id: "m2" }))).toEqual({
      type: "remember", workspace: "demo", text: "x", memory_id: "m2",
    });
    expect(parseCommand(remember({ text: "  " }))).toHaveProperty("error");
    expect(parseCommand(remember({ text: "x", kind: "rumour" }))).toHaveProperty("error");
    expect(parseCommand(remember({ text: "x".repeat(501) }))).toEqual({
      error: "text longer than 500 characters",
    });
    expect(parseCommand(forget({}))).toHaveProperty("error");
    expect(parseCommand(forget({ memory_id: "m1" }))).toEqual({ type: "forget", workspace: "demo", memory_id: "m1" });
  });

  it("remember adds (next m<n>), replaces by id; forget removes; each one Undo", async () => {
    const h = harness(start([impute]));
    const identity = currentIdentityKey(h.state);
    expect(await handleCommand(remember({ text: "ledd is in mg/day" }), h.deps))
      .toEqual({ id: "r1", ok: true, identity, memory_id: "m1" });
    expect(await handleCommand(remember({ text: "use the median", kind: "decision" }), h.deps))
      .toMatchObject({ ok: true, memory_id: "m2" });
    expect(h.state.workspace?.memory).toMatchObject([
      { id: "m1", text: "ledd is in mg/day", kind: "fact" },
      { id: "m2", text: "use the median", kind: "decision" },
    ]);
    expect(h.state.workspace?.memory?.[0]?.updated_at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    // Replace keeps the kind unless given.
    await handleCommand(remember({ text: "ledd in mg/day, 0 = untreated", memory_id: "m1" }), h.deps);
    expect(h.state.workspace?.memory?.[0]).toMatchObject({ id: "m1", text: "ledd in mg/day, 0 = untreated", kind: "fact" });
    expect(await handleCommand(forget({ memory_id: "m2" }), h.deps)).toEqual({ id: "f1", ok: true, identity });
    expect(h.state.workspace?.memory?.map((e) => e.id)).toEqual(["m1"]);
    expect(h.toasts).toEqual([
      "remembered “ledd is in mg/day”",
      "remembered “use the median”",
      "updated m1: “ledd in mg/day, 0 = untreated”",
      "forgot “use the median”",
    ]);
    expect(h.settled).toBe(4);
    // The toast's Undo restores the forgotten entry; memory never changes the data identity.
    h.undos.at(-1)!.forEach(h.deps.dispatch);
    expect(h.state.workspace?.memory?.map((e) => e.id)).toEqual(["m1", "m2"]);
    expect(currentIdentityKey(h.state)).toBe(identity);
    // A new id is above every existing one, even after a gap.
    h.deps.dispatch({ type: "REMOVE_MEMORY_ENTRY", id: "m1" });
    expect(await handleCommand(remember({ text: "z" }), h.deps)).toMatchObject({ memory_id: "m3" });
  });

  it("refuses unknown ids, a full memory and another workspace", async () => {
    const big = Array.from({ length: 16 }, (_, i) => ({ id: `m${i + 1}`, text: "x".repeat(500), kind: "fact" as const }));
    const h = harness({ ...start(), workspace: { ...emptyWorkspace("demo"), memory: big } });
    expect(await handleCommand(remember({ text: "y", memory_id: "m99" }), h.deps))
      .toEqual({ id: "r1", ok: false, error: "bad_command: unknown memory id m99" });
    expect(await handleCommand(forget({ memory_id: "m99" }), h.deps))
      .toEqual({ id: "f1", ok: false, error: "bad_command: unknown memory id m99" });
    expect(await handleCommand(remember({ text: "y" }), h.deps)).toEqual({
      id: "r1", ok: false, error: "bad_command: memory full (8001 characters, the cap is 8000)",
    });
    expect(await handleCommand(remember({ text: "y", workspace: "other" }), h.deps))
      .toMatchObject({ ok: false, error: expect.stringMatching(/^stale: workspace "other"/) });
    expect(h.state.stepHistory.past).toHaveLength(0);
    expect(h.toasts).toEqual([]);
  });

  it("never reuses a forgotten id: the counter survives forget and is restored by Undo (#180)", async () => {
    const h = harness(start([impute]));
    await handleCommand(remember({ text: "a" }), h.deps);
    expect(h.state.workspace?.id_counters).toEqual({ m: 1 });
    await handleCommand(forget({ memory_id: "m1" }), h.deps);
    expect(await handleCommand(remember({ text: "b" }), h.deps)).toMatchObject({ ok: true, memory_id: "m2" });
    // A counter above every entry (older ids forgotten elsewhere) is honoured.
    const ahead = harness({ ...start(), workspace: { ...emptyWorkspace("demo"), id_counters: { m: 7 } } });
    expect(await handleCommand(remember({ text: "c" }), ahead.deps)).toMatchObject({ memory_id: "m8" });
    ahead.undos[0]!.forEach(ahead.deps.dispatch);
    expect(ahead.state.workspace?.id_counters).toEqual({ m: 7 });
  });

  it("CLEAR_MEMORY is one undo entry; a no-op on an empty memory", () => {
    let s = start();
    s = appReducer(s, { type: "CLEAR_MEMORY" });
    expect(s.stepHistory.past).toHaveLength(0);
    s = appReducer(s, { type: "SET_MEMORY_ENTRY", entry: { id: "m1", text: "a", kind: "todo" } });
    s = appReducer(s, { type: "SET_MEMORY_ENTRY", entry: { id: "m2", text: "b", kind: "fact" } });
    s = appReducer(s, { type: "CLEAR_MEMORY" });
    expect(s.workspace?.memory).toEqual([]);
    s = appReducer(s, { type: "UNDO_STEPS" });
    expect(s.workspace?.memory?.map((e) => e.id)).toEqual(["m1", "m2"]);
  });
});

describe("workspace documents (datatoolkit-issues#178)", () => {
  const keep = (extra: Record<string, unknown>) => ({
    id: "k1", type: "keep_attachment", workspace: "demo", ...extra,
  });
  const doc = (id: string, extra: Record<string, unknown> = {}) => ({
    id, name: `${id}.md`, path: `/up/${id}.md`, mime: "text/markdown", size: 1,
    kind: "text" as const, added_at: "2026-10-06T12:00:00Z", ...extra,
  });

  it("parses keep_attachment and refuses bad payloads", () => {
    expect(parseCommand(keep({ attachment_id: "a1", note: "the codebook" }))).toEqual({
      type: "keep_attachment", workspace: "demo", attachment_id: "a1", note: "the codebook",
    });
    expect(parseCommand(keep({}))).toHaveProperty("error");
    expect(parseCommand(keep({ attachment_id: "a1", note: 3 }))).toHaveProperty("error");
    expect(parseCommand(keep({ attachment_id: "a1", note: "x".repeat(4001) }))).toHaveProperty("error");
  });

  it("keep_attachment adds a document (next d<n>, note), acks its id, Undo removes it", async () => {
    const h = harness({ ...start([impute]), workspace: { ...emptyWorkspace("demo"), steps: [impute], documents: [doc("d2")] } });
    const identity = currentIdentityKey(h.state);
    expect(await handleCommand(keep({ attachment_id: "a1", note: "codebook" }), h.deps))
      .toEqual({ id: "k1", ok: true, identity, document_id: "d3" });
    expect(h.state.workspace?.documents?.[1]).toEqual({
      id: "d3", name: "dictionary.md", path: "/up/abc/dictionary.md", mime: "text/markdown", size: 12,
      kind: "text", added_at: "2026-10-06T12:00:00Z", note: "codebook",
    });
    expect(h.toasts).toEqual(["kept dictionary.md in the workspace documents"]);
    expect(h.settled).toBe(1);
    // The same upload again: acked with the existing id, nothing added.
    expect(await handleCommand(keep({ attachment_id: "a1" }), h.deps)).toMatchObject({ ok: true, document_id: "d3" });
    expect(h.state.workspace?.documents).toHaveLength(2);
    h.undos[0]!.forEach(h.deps.dispatch);
    expect(h.state.workspace?.documents?.map((d) => d.id)).toEqual(["d2"]);
  });

  it("keep_attachment refuses an unknown attachment, a full list and another workspace", async () => {
    const full = Array.from({ length: 50 }, (_, i) => doc(`d${i + 1}`));
    const h = harness({ ...start(), workspace: { ...emptyWorkspace("demo"), documents: full } });
    expect(await handleCommand(keep({ attachment_id: "nope" }), h.deps))
      .toEqual({ id: "k1", ok: false, error: "bad_command: unknown attachment" });
    expect(await handleCommand(keep({ attachment_id: "a1" }), h.deps))
      .toEqual({ id: "k1", ok: false, error: "bad_command: documents full (at most 50 per workspace)" });
    expect(await handleCommand(keep({ attachment_id: "a1", workspace: "other" }), h.deps))
      .toMatchObject({ ok: false, error: expect.stringMatching(/^stale: workspace "other"/) });
    expect(h.state.stepHistory.past).toHaveLength(0);
  });

  it("keep_attachment never reuses a removed document id (#180)", async () => {
    const h = harness({ ...start(), workspace: { ...emptyWorkspace("demo"), documents: [doc("d1")], id_counters: { d: 3 } } });
    expect(await handleCommand(keep({ attachment_id: "a1" }), h.deps)).toMatchObject({ ok: true, document_id: "d4" });
    expect(h.state.workspace?.id_counters).toEqual({ d: 4 });
    h.undos[0]!.forEach(h.deps.dispatch);
    expect(h.state.workspace?.id_counters).toEqual({ d: 3 });
  });

  it("document actions are one undo entry each and never change the data identity", () => {
    let s = start([impute]);
    const identity = currentIdentityKey(s);
    s = appReducer(s, { type: "ADD_DOCUMENT", document: doc("d1") });
    s = appReducer(s, { type: "SET_DOCUMENT_NOTE", id: "d1", text: "variables and units" });
    expect(s.workspace?.documents?.[0]?.note).toBe("variables and units");
    s = appReducer(s, { type: "SET_DOCUMENT_NOTE", id: "d1", text: " " });
    expect(s.workspace?.documents?.[0]).not.toHaveProperty("note");
    s = appReducer(s, { type: "REMOVE_DOCUMENT", id: "d1" });
    expect(s.workspace?.documents).toEqual([]);
    expect(s.stepHistory.past).toHaveLength(4);
    expect(currentIdentityKey(s)).toBe(identity);
    s = appReducer(s, { type: "UNDO_STEPS" });
    expect(s.workspace?.documents?.map((d) => d.id)).toEqual(["d1"]);
    // Unknown ids are no-ops, not history entries.
    const past = s.stepHistory.past.length;
    s = appReducer(s, { type: "REMOVE_DOCUMENT", id: "d9" });
    expect(s.stepHistory.past).toHaveLength(past);
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
    await handleCommand(
      propose(h.state, [{ remove: { index: 0 } }], { base_identity: "nope" }),
      h.deps,
    );
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

describe("pick_row / pick_cell / clear_selection (#90)", () => {
  const send = (h: ReturnType<typeof harness>, cmd: Record<string, unknown>) =>
    handleCommand({ id: "p", ...cmd }, h.deps);

  it("validates the payload", () => {
    const bad = (c: Record<string, unknown>) => (parseCommand(c) as { error: string }).error;
    expect(bad({ type: "pick_row" })).toMatch(/rid must be/);
    expect(bad({ type: "pick_row", rid: -1 })).toMatch(/rid must be/);
    expect(bad({ type: "pick_row", rid: 1.5 })).toMatch(/rid must be/);
    expect(bad({ type: "pick_cell", rid: 1 })).toMatch(/column must be/);
    expect(bad({ type: "pick_cell", rid: "1", column: "age" })).toMatch(/rid must be/);
    expect(parseCommand({ type: "clear_selection" })).toEqual({ type: "clear_selection" });
  });

  it("pick_row selects the row, highlights it, Undo restores the column selection", async () => {
    const h = harness(start());
    h.deps.dispatch({ type: "PICK_COL", name: "age", add: false });
    expect(await send(h, { type: "pick_row", rid: 7 })).toMatchObject({ ok: true });
    expect(h.state.selection).toMatchObject({ row: 7, cell: null, columns: [] });
    expect(h.touches).toEqual([{ rows: [7] }]);
    h.undos[0]!.forEach(h.deps.dispatch);
    expect(h.state.selection).toMatchObject({ row: null, cell: null, columns: ["age"] });
  });

  it("picking what is already picked keeps it (no toggle) and offers no Undo", async () => {
    const h = harness(start());
    await send(h, { type: "pick_row", rid: 7 });
    await send(h, { type: "pick_row", rid: 7 });
    expect(h.state.selection.row).toBe(7);
    expect(h.undos[1]).toBeUndefined();
    await send(h, { type: "pick_cell", rid: 3, column: "age" });
    await send(h, { type: "pick_cell", rid: 3, column: "age" });
    expect(h.state.selection.cell).toEqual({ rid: 3, col: "age" });
    expect(h.undos[3]).toBeUndefined();
  });

  it("pick_cell selects the cell and its column; Undo restores the previous row", async () => {
    const h = harness(start());
    await send(h, { type: "pick_row", rid: 2 });
    expect(await send(h, { type: "pick_cell", rid: 3, column: "income" })).toMatchObject({ ok: true });
    expect(h.state.selection).toMatchObject({ cell: { rid: 3, col: "income" }, row: null, columns: ["income"] });
    expect(h.touches[1]).toEqual({ cells: [{ rid: 3, column: "income" }], columns: ["income"] });
    h.undos[1]!.forEach(h.deps.dispatch);
    expect(h.state.selection).toMatchObject({ row: 2, cell: null, columns: [] });
  });

  it("pick_cell refuses a column not in the frame; an unknown rid is applied", async () => {
    const h = harness(start());
    const ack = await send(h, { type: "pick_cell", rid: 3, column: "ghost" });
    expect(ack).toMatchObject({ ok: false, error: 'bad_command: unknown column "ghost"' });
    expect(h.state.selection.cell).toBeNull();
    expect(await send(h, { type: "pick_row", rid: 999999 })).toMatchObject({ ok: true });
    expect(h.state.selection.row).toBe(999999);
  });

  it("clear_selection clears; Undo brings back the cell", async () => {
    const h = harness(start());
    await send(h, { type: "pick_cell", rid: 3, column: "age" });
    expect(await send(h, { type: "clear_selection" })).toMatchObject({ ok: true });
    expect(h.state.selection).toMatchObject({ row: null, cell: null, columns: [] });
    h.undos[1]!.forEach(h.deps.dispatch);
    expect(h.state.selection).toMatchObject({ cell: { rid: 3, col: "age" }, columns: ["age"] });
    const empty = harness(start());
    await send(empty, { type: "clear_selection" });
    expect(empty.undos[0]).toBeUndefined();
  });
});

describe("add_variable", () => {
  const cmd = { type: "add_variable", name: "mu", stat: "mean", column: "age" };
  const send = (h: ReturnType<typeof harness>, c: Record<string, unknown>) =>
    handleCommand({ id: "c1", ...c }, h.deps);

  it("adds the variable, saves before the ack, highlights the column; Undo removes it", async () => {
    const h = harness(start());
    const ack = await send(h, cmd);
    expect(ack).toMatchObject({ ok: true });
    expect(h.state.workspace?.variables).toEqual([{ name: "mu", stat: "mean", column: "age" }]);
    expect(h.settled).toBe(1);
    expect(h.toasts).toEqual(["variable @mu = mean(age)"]);
    expect(h.touches).toEqual([{ columns: ["age"] }]);
    h.undos[0]!.forEach(h.deps.dispatch);
    expect(h.state.workspace?.variables).toEqual([]);
  });

  it("refuses a bad name, stat, column, a duplicate", async () => {
    const h = harness(start());
    const bad = (c: Record<string, unknown>) => send(h, { ...cmd, ...c });
    expect((await bad({ name: "1x" }))?.error).toMatch(/^bad_command: name must be an identifier/);
    expect((await bad({ stat: "mode" }))?.error).toMatch(/^bad_command: stat must be one of mean,/);
    expect((await bad({ column: "" }))?.error).toBe("bad_command: column must be a non-empty string");
    expect((await bad({ column: "ghost" }))?.error).toBe('bad_command: unknown column "ghost"');
    await send(h, cmd);
    expect((await bad({ stat: "max" }))?.error).toBe('bad_command: variable "mu" already exists');
    expect(h.state.workspace?.variables).toHaveLength(1);
  });

  it("rolls back and acks save_failed when the save gate rejects", async () => {
    const h = harness(start());
    h.deps.settle = async () => {
      throw new Error("disk full");
    };
    expect(await send(h, cmd)).toMatchObject({ ok: false, error: "save_failed: disk full" });
    expect(h.state.workspace?.variables).toEqual([]);
    expect(h.toasts).toEqual([]);
  });
});

describe("draft_chart / add_chart", () => {
  const send = (h: ReturnType<typeof harness>, c: Record<string, unknown>) =>
    handleCommand({ id: "c1", ...c }, h.deps);
  const hist = { chart: "histogram", x: "age" };

  it("draft_chart opens the window and fills the draft, saving nothing; Undo restores", async () => {
    const h = harness(start());
    const ack = await send(h, { type: "draft_chart", params: hist });
    expect(ack).toMatchObject({ ok: true });
    expect(h.state.dock.tools).toContain("chart");
    expect(h.state.chartDraft).toMatchObject(hist);
    expect(h.state.workspace?.charts).toEqual([]);
    expect(h.settled).toBe(0);
    expect(h.toasts).toEqual(["chart draft: chart=histogram, x=age"]);
    expect(h.touches).toEqual([{ tools: ["chart"], columns: ["age"] }]);
    h.undos[0]!.forEach(h.deps.dispatch);
    expect(h.state.chartDraft).toBeNull();
    expect(h.state.dock.tools).not.toContain("chart");
  });

  it("draft_chart merges over the open draft and has no Undo when nothing changes", async () => {
    const h = harness(start());
    await send(h, { type: "draft_chart", params: hist });
    await send(h, { type: "draft_chart", params: { bins: 10 } });
    expect(h.state.chartDraft).toMatchObject({ x: "age", bins: 10 });
    await send(h, { type: "draft_chart", params: { bins: 10 } });
    expect(h.undos[2]).toBeUndefined();
  });

  it("refuses bad drafts", async () => {
    const h = harness(start());
    const bad = async (params: unknown) => (await send(h, { type: "draft_chart", params }))?.error;
    expect(await bad({})).toBe("bad_command: params must be a non-empty object");
    expect(await bad({ chart: "pizza" })).toMatch(/^bad_command: params.chart must be one of histogram,/);
    expect(await bad({ bins: 1 })).toBe("bad_command: params.bins must be an integer from 2 to 200");
    expect(await bad({ nope: 1 })).toMatch(/^bad_command: unknown param "nope"/);
    expect(await bad({ x: "ghost" })).toBe('bad_command: unknown column "ghost"');
    expect(await bad({ columns: ["age", "ghost"] })).toBe('bad_command: unknown column "ghost"');
    expect(h.state.chartDraft).toBeNull();
    expect(h.state.dock.tools).not.toContain("chart");
  });

  it("add_chart saves before the ack with defaults filled in; Undo removes it", async () => {
    const h = harness(start());
    const ack = await send(h, { type: "add_chart", name: "ages", params: hist });
    expect(ack).toMatchObject({ ok: true });
    expect(h.state.workspace?.charts).toEqual([
      { name: "ages", params: expect.objectContaining({ chart: "histogram", x: "age", bins: 30 }) },
    ]);
    expect(h.settled).toBe(1);
    expect(h.toasts).toEqual(["saved chart ages"]);
    expect(h.touches).toEqual([{ tools: ["chart"], columns: ["age"] }]);
    h.undos[0]!.forEach(h.deps.dispatch);
    expect(h.state.workspace?.charts).toEqual([]);
  });

  it("add_chart refuses a duplicate name, a bad name, an undrawable chart", async () => {
    const h = harness(start());
    const bad = async (c: Record<string, unknown>) =>
      (await send(h, { type: "add_chart", name: "ages", params: hist, ...c }))?.error;
    await send(h, { type: "add_chart", name: "ages", params: hist });
    expect(await bad({})).toBe('bad_command: duplicate chart name "ages"');
    expect(await bad({ name: " " })).toMatch(/^bad_command: name must be a non-empty string/);
    expect(await bad({ name: "x".repeat(65) })).toMatch(/^bad_command: name must be/);
    expect(await bad({ name: "s", params: { chart: "scatter", x: "age" } })).toBe(
      "bad_command: chart scatter is not drawable (Pick Y)",
    );
    expect(await bad({ name: "g", params: { x: "ghost" } })).toBe('bad_command: unknown column "ghost"');
    expect(h.state.workspace?.charts).toHaveLength(1);
  });

  it("add_chart rolls back on a failed save and maps the engine's duplicate 422", async () => {
    const h = harness(start());
    h.deps.settle = async () => {
      throw new Error("disk full");
    };
    expect(await send(h, { type: "add_chart", name: "a", params: hist })).toMatchObject({
      ok: false, error: "save_failed: disk full",
    });
    h.deps.settle = async () => {
      throw new Error("422: duplicate chart name");
    };
    expect((await send(h, { type: "add_chart", name: "a", params: hist }))?.error).toBe(
      'bad_command: duplicate chart name "a"',
    );
    expect(h.state.workspace?.charts).toEqual([]);
    expect(h.toasts).toEqual([]);
  });
});

describe("edit_step / fill_editor", () => {
  const send = (h: ReturnType<typeof harness>, c: Record<string, unknown>) =>
    handleCommand({ id: "c1", ...c }, h.deps);

  it("edit_step opens the step pinned to its input version; Undo closes it", async () => {
    const h = harness(start([impute, scale]));
    const ack = await send(h, { type: "edit_step", index: 1 });
    expect(ack).toMatchObject({ ok: true, identity: currentIdentityKey(h.state) });
    expect(h.state.editor).toMatchObject({ op: "scale", editIndex: 1 });
    expect(h.state.workspace?.steps).toEqual([impute, scale]);
    expect(h.touches).toEqual([{ steps: [1], columns: ["age"] }]);
    h.undos[0]!.forEach(h.deps.dispatch);
    expect(h.state.editor).toBeNull();
    expect(h.state.viewVersion).toBeNull();
  });

  it("edit_step refuses a bad index, answers busy on another editor or a review, no-ops on the same step", async () => {
    const h = harness(start([impute, scale]));
    expect(await send(h, { type: "edit_step", index: 2 })).toMatchObject({ ok: false, error: "bad_command: no step at index 2" });
    expect(await send(h, { type: "edit_step", index: -1 })).toMatchObject({ ok: false });
    h.state = appReducer(h.state, { type: "EDIT_STEP", index: 0 });
    expect(await send(h, { type: "edit_step", index: 1 })).toMatchObject({ ok: false, error: "busy" });
    expect(h.state.editor?.editIndex).toBe(0);
    expect(await send(h, { type: "edit_step", index: 0 })).toMatchObject({ ok: true });
    expect(h.undos.at(-1)).toBeUndefined();
    h.state = appReducer(h.state, { type: "CLOSE_EDITOR" });
    h.pending = true;
    expect(await send(h, { type: "edit_step", index: 0 })).toMatchObject({ ok: false, error: "busy" });
    h.state = appReducer(h.state, { type: "OPEN_EDITOR", op: "scale" });
    h.pending = false;
    expect(await send(h, { type: "edit_step", index: 0 })).toMatchObject({ ok: false, error: "busy" });
  });

  it("fill_editor opens a new-step editor, applying nothing; Undo closes it", async () => {
    const h = harness(start());
    const params = { columns: ["age"], strategy: "median" };
    const ack = await send(h, { type: "fill_editor", op: "impute", params, target: "train" });
    expect(ack).toMatchObject({ ok: true, identity: currentIdentityKey(h.state) });
    expect(h.state.editor).toEqual({ op: "impute", params, target: "train" });
    expect(h.state.workspace?.steps).toEqual([]);
    expect(h.settled).toBe(0);
    expect(h.touches).toEqual([{ columns: ["age"] }]);
    h.undos[0]!.forEach(h.deps.dispatch);
    expect(h.state.editor).toBeNull();
  });

  it("fill_editor patches the open editor: params merged, target set; Undo restores", async () => {
    const h = harness(start([impute]));
    await send(h, { type: "edit_step", index: 0 });
    const ack = await send(h, { type: "fill_editor", params: { strategy: "mean" }, target: "train" });
    expect(ack).toMatchObject({ ok: true });
    expect(h.state.editor).toMatchObject({
      op: "impute", editIndex: 0, target: "train", params: { columns: ["age"], strategy: "mean" },
    });
    expect(h.state.workspace?.steps).toEqual([impute]);
    h.undos.at(-1)!.forEach(h.deps.dispatch);
    expect(h.state.editor).toMatchObject({ target: "both", params: { columns: ["age"] } });
    expect(h.state.editor?.params.strategy).toBeUndefined();
    // Same op named again is fine; nothing to undo when nothing changes.
    await send(h, { type: "fill_editor", op: "impute", params: { columns: ["age"] } });
    expect(h.undos.at(-1)).toBeUndefined();
  });

  it("fill_editor refuses: no op to open, op change on an edited step, unknown op / param, empty command", async () => {
    const h = harness(start([impute]));
    const bad = async (c: Record<string, unknown>) => (await send(h, { type: "fill_editor", ...c }))?.error;
    expect(await bad({ params: { value: 1 } })).toBe("bad_command: op is required to open the editor");
    expect(await bad({ op: "nope" })).toBe('bad_command: unknown op "nope"');
    expect(await bad({ op: "impute", params: { ghost: 1 } })).toMatch(/^bad_command: unknown param "ghost" for impute/);
    expect(await bad({})).toBe("bad_command: fill_editor needs op, params and / or target");
    expect(await bad({ target: "all" })).toBe("bad_command: target must be train, test or both");
    expect(h.state.editor).toBeNull();
    await send(h, { type: "edit_step", index: 0 });
    expect(await bad({ op: "scale" })).toMatch(/^bad_command: cannot change the op of the step being edited/);
    expect(h.state.editor?.op).toBe("impute");
  });

  it("fill_editor answers busy while a review is pending", async () => {
    const h = harness(start());
    h.pending = true;
    expect(await send(h, { type: "fill_editor", op: "impute" })).toMatchObject({ ok: false, error: "busy" });
    expect(h.state.editor).toBeNull();
  });

  it("fill_editor on a new-step editor may switch op; Undo brings the previous editor back", async () => {
    const h = harness(start());
    await send(h, { type: "fill_editor", op: "impute", params: { columns: ["age"] } });
    await send(h, { type: "fill_editor", op: "scale", params: { columns: ["income"] } });
    expect(h.state.editor).toMatchObject({ op: "scale", params: { columns: ["income"] } });
    h.undos.at(-1)!.forEach(h.deps.dispatch);
    expect(h.state.editor).toMatchObject({ op: "impute", params: { columns: ["age"] } });
  });
});

describe("agentTouch slice", () => {
  const touch = { columns: ["age"], tools: [], steps: [], rows: [], cells: [], at: 5 };
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

  it("acks after the new view's row count is known, not with the old total (#110)", async () => {
    const h = harness({ ...start(), gridTotal: 41 });
    let release!: () => void;
    h.deps.gridSettled = () => new Promise<void>((r) => (release = r));
    let acked = false;
    const pending = send(h, { filter }).then((a) => {
      acked = true;
      return a;
    });
    await new Promise((r) => setTimeout(r, 0));
    // The view is set, its total unknown (never the unfiltered 41), no ack yet.
    expect(h.state.gridView.filter).toEqual(filter);
    expect(h.state.gridTotal).toBeNull();
    expect(acked).toBe(false);
    release();
    expect(await pending).toMatchObject({ ok: true });
    // Same view again: nothing to reload, acked at once.
    h.deps.gridSettled = async () => {
      throw new Error("not awaited");
    };
    expect(await send(h, { filter })).toMatchObject({ ok: true });
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
