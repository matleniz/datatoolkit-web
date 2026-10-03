import { describe, expect, it } from "vitest";

import type { Step } from "../src/api/types";
import type { Ack, BridgeDeps, PendingAck, Proposal } from "../src/state/agentCommands";
import { commandRunner } from "../src/state/agentQueue";
import { appReducer, emptyWorkspace, initialState, type AppState } from "../src/state/reducer";
import { currentIdentityKey } from "../src/state/uiContext";

const impute: Step = { op: "impute", target: "both", params: { columns: ["age"] } };
const drop: Step = { op: "drop_columns", target: "both", params: { columns: ["id"] } };

/** The reducer behind getState / dispatch; reviews answered through `decide`. */
function harness() {
  const h = {
    state: {
      ...initialState,
      screen: "bench",
      workspace: { ...emptyWorkspace("demo"), steps: [impute] },
    } as AppState,
    posted: [] as (Ack | PendingAck)[],
    answers: new Map<string, (apply: boolean) => void>(),
    /** When set, the save gate waits for it (a slow command). */
    gate: null as Promise<void> | null,
  };
  const deps: Omit<BridgeDeps, "review"> = {
    getState: () => h.state,
    dispatch: (a) => {
      h.state = appReducer(h.state, a);
    },
    settle: async () => {
      await h.gate;
    },
    gridSettled: async () => undefined,
    announce: () => undefined,
    touch: () => undefined,
    reviewPending: () => h.answers.size > 0,
    opSchema: async () => ({ type: "object" }),
    frameColumns: async () => ["age", "id"],
    keySchema: async () => ({ type: "object" }),
  };
  const show = (p: Proposal) =>
    new Promise<boolean>((resolve) => h.answers.set(p.id, resolve));
  const run = commandRunner(deps, show, async (ack) => {
    h.posted.push(ack);
  });
  const decide = (id: string, apply: boolean) => {
    h.answers.get(id)?.(apply);
    h.answers.delete(id);
  };
  return { h, run, decide };
}

const propose = (state: AppState, id: string, step: Step) => ({
  id,
  type: "propose_steps",
  workspace: "demo",
  base_identity: currentIdentityKey(state),
  ops: [{ add: { step } }],
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("commandRunner (datatoolkit-issues#97)", () => {
  it("acks a review pending at once, runs later commands, then sends the final ack on Apply", async () => {
    const { h, run, decide } = harness();
    const reviewed = run(propose(h.state, "c1", drop));
    await flush();
    expect(h.posted).toEqual([{ id: "c1", pending: "review" }]);

    // The open banner does not block view commands; a second proposal is busy.
    await run({ id: "c2", type: "select_columns", columns: ["age"] });
    await run(propose(h.state, "c3", impute));
    expect(h.posted.slice(1)).toEqual([
      expect.objectContaining({ id: "c2", ok: true }),
      { id: "c3", ok: false, error: "busy" },
    ]);
    expect(h.state.workspace?.steps).toEqual([impute]);

    decide("c1", true);
    await reviewed;
    expect(h.state.workspace?.steps).toEqual([impute, drop]);
    expect(h.posted[3]).toEqual({ id: "c1", ok: true, identity: currentIdentityKey(h.state) });
  });

  it("sends rejected on Dismiss and frees the queue for the next proposal", async () => {
    const { h, run, decide } = harness();
    const reviewed = run(propose(h.state, "c1", drop));
    await flush();
    decide("c1", false);
    await reviewed;
    await run(propose(h.state, "c2", impute));
    expect(h.posted).toEqual([
      { id: "c1", pending: "review" },
      { id: "c1", ok: false, error: "rejected" },
      expect.objectContaining({ id: "c2", ok: true }),
    ]);
  });

  it("applies an answered review only after the command running meanwhile", async () => {
    const { h, run, decide } = harness();
    const reviewed = run(propose(h.state, "c1", drop));
    await flush();
    let release!: () => void;
    h.gate = new Promise<void>((r) => (release = r));
    const slow = run({ id: "c2", type: "add_variable", name: "m", stat: "mean", column: "age" });
    await flush();
    decide("c1", true);
    await flush();
    expect(h.state.workspace?.steps).toEqual([impute]);
    h.gate = null;
    release();
    await Promise.all([slow, reviewed]);
    expect(h.posted.map((a) => a.id)).toEqual(["c1", "c2", "c1"]);
    expect(h.state.workspace?.steps).toEqual([impute, drop]);
  });
});
