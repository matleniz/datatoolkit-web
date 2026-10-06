import { describe, expect, it } from "vitest";

import type { Step } from "../src/api/types";
import { chipJump, chipLabel, chipTarget, stepIndices } from "../src/bench/agent/panel/chips";
import {
  parseAgentEvent,
  parseAgentStatus,
  toolName,
  type AgentEvent,
} from "../src/bench/agent/panel/protocol";
import {
  EMPTY_TRANSCRIPT,
  formatTurnUsage,
  formatUsage,
  reviewCommands,
  transcriptReducer,
  type Transcript,
  type TranscriptAction,
} from "../src/bench/agent/panel/transcript";

const run = (actions: TranscriptAction[], from: Transcript = EMPTY_TRANSCRIPT) =>
  actions.reduce(transcriptReducer, from);
const ev = (raw: Record<string, unknown>): TranscriptAction => ({
  type: "event",
  event: parseAgentEvent(raw) as AgentEvent,
});

describe("agent panel protocol (#67)", () => {
  it("parses every event type and strips the MCP prefix", () => {
    expect(toolName("mcp__dtk__propose_steps")).toBe("propose_steps");
    expect(toolName("open_window")).toBe("open_window");
    expect(parseAgentEvent({ type: "tool_call", id: "t1", name: "mcp__dtk__open_window", input: { tool: "dist" } }))
      .toEqual({ type: "tool_call", id: "t1", name: "open_window", input: { tool: "dist" } });
    expect(parseAgentEvent({ type: "tool_result", id: "t1", ok: true, pending: "review", command: "c3" }))
      .toMatchObject({ ok: true, pending: "review", command: "c3" });
    expect(parseAgentEvent({ type: "usage", input_tokens: 10, output_tokens: 2, total_input_tokens: 30, total_output_tokens: 5 }))
      .toEqual({
        type: "usage",
        turn: { input: 10, output: 2, cacheWrite: 0, cacheRead: 0, context: 0 },
        total: { input: 30, output: 5, cacheWrite: 0, cacheRead: 0 },
      });
    // #151: the cache split and the context size, per turn and cumulative.
    expect(
      parseAgentEvent({
        type: "usage", input_tokens: 1300, output_tokens: 40, uncached_input_tokens: 100,
        cache_creation_input_tokens: 200, cache_read_input_tokens: 1000, context_tokens: 900,
        total_input_tokens: 5000, total_output_tokens: 90, total_uncached_input_tokens: 300,
        total_cache_creation_input_tokens: 700, total_cache_read_input_tokens: 4000,
      }),
    ).toEqual({
      type: "usage",
      turn: { input: 1300, output: 40, cacheWrite: 200, cacheRead: 1000, context: 900 },
      total: { input: 5000, output: 90, cacheWrite: 700, cacheRead: 4000 },
    });
    expect(parseAgentEvent({ type: "permission_request", id: "p1", tool: "propose_steps", input: {}, summary: "remove step 2" }))
      .toMatchObject({ lines: [], summary: "remove step 2" });
    expect(parseAgentEvent({ type: "done", stop_reason: "cancelled" })).toEqual({ type: "done", stopReason: "cancelled" });
  });

  it("drops malformed and unknown events", () => {
    expect(parseAgentEvent(null)).toBeNull();
    expect(parseAgentEvent({ type: "assistant_delta" })).toBeNull();
    expect(parseAgentEvent({ type: "tool_call", name: "x" })).toBeNull();
    expect(parseAgentEvent({ type: "future_thing" })).toBeNull();
  });

  it("reads the status; anything odd means no agent", () => {
    expect(parseAgentStatus("nope")).toEqual({ available: false, pack: null, running: false });
    expect(
      parseAgentStatus({
        available: true, pack: "stub", running: false, max_tokens: null,
        usage: { input_tokens: 9, output_tokens: 4, cache_creation_input_tokens: 2, cache_read_input_tokens: 5 },
      }),
    ).toMatchObject({
      available: true,
      pack: "stub",
      usage: { input: 9, output: 4, cacheWrite: 2, cacheRead: 5 },
      maxTokens: undefined,
    });
  });
});

describe("agent panel transcript (#67)", () => {
  it("adopts the echoed user message and merges deltas", () => {
    const t = run([
      { type: "sent", text: "hi" },
      ev({ type: "user_message", text: "hi" }),
      ev({ type: "assistant_delta", text: "Hel" }),
      ev({ type: "assistant_delta", text: "lo" }),
    ]);
    expect(t.items.map((i) => i.kind)).toEqual(["user", "assistant"]);
    expect(t.items[0]).toMatchObject({ local: false });
    expect(t.items[1]).toMatchObject({ text: "Hello" });
    expect(t.running).toBe(true);
  });

  it("tracks tool calls, review, usage and done", () => {
    const t = run([
      { type: "sent", text: "add a step" },
      ev({ type: "tool_call", id: "a", name: "propose_steps", input: {} }),
      ev({ type: "tool_call", id: "b", name: "propose_steps", input: {} }),
      ev({ type: "tool_result", id: "a", ok: true, summary: "add scale (age)" }),
      ev({ type: "tool_result", id: "b", ok: true, pending: "review" }),
      ev({ type: "assistant_delta", text: "Added." }),
      ev({ type: "usage", input_tokens: 100, output_tokens: 20 }),
      ev({ type: "usage", input_tokens: 50, output_tokens: 5 }),
      ev({ type: "done", stop_reason: "end_turn" }),
    ]);
    const tools = t.items.filter((i) => i.kind === "tool");
    expect(tools.map((i) => i.kind === "tool" && i.status)).toEqual(["ok", "review"]);
    expect(t.usage).toEqual({ input: 150, output: 25, cacheWrite: 0, cacheRead: 0 });
    expect(t.lastTurn).toEqual({ input: 50, output: 5, cacheWrite: 0, cacheRead: 0, context: 0 });
    expect(t.running).toBe(false);
  });

  it("formats the cache split: cache reads are never counted as 'in' (#151)", () => {
    // The parkison session: 108 uncached, 98.8k cache writes, 3,015k cache reads.
    const u = { input: 108 + 98_800 + 3_015_000, output: 37_700, cacheWrite: 98_800, cacheRead: 3_015_000 };
    expect(formatUsage(u)).toBe("108 in · cache 99k write / 3.0M read · 38k out");
    expect(formatUsage({ input: 1234, output: 25_600, cacheWrite: 0, cacheRead: 0 }))
      .toBe("1.2k in · cache 0 write / 0 read · 26k out");
    expect(formatTurnUsage({ input: 13_810, output: 5, cacheWrite: 0, cacheRead: 13_800, context: 13_810 }))
      .toBe("last turn: 10 in · cache 0 write / 14k read · 5 out · context 14k");
    expect(formatTurnUsage({ input: 10, output: 5, cacheWrite: 0, cacheRead: 0, context: 0 }))
      .toBe("last turn: 10 in · cache 0 write / 0 read · 5 out");
  });

  it("prefers the engine's cumulative totals", () => {
    const t = run([
      { type: "usage_seed", usage: { input: 500, output: 50, cacheWrite: 0, cacheRead: 400 } },
      ev({
        type: "usage", input_tokens: 1, output_tokens: 1, total_input_tokens: 600,
        total_output_tokens: 70, total_cache_read_input_tokens: 450,
      }),
    ]);
    expect(t.usage).toEqual({ input: 600, output: 70, cacheWrite: 0, cacheRead: 450 });
  });

  it("an error or a stop settles what is still pending", () => {
    const t = run([
      { type: "sent", text: "permission" },
      ev({ type: "permission_request", id: "p", tool: "propose_steps", summary: "remove", input: {} }),
      ev({ type: "tool_call", id: "a", name: "get_rows", input: {} }),
      ev({ type: "error", message: "token cap reached", code: "max_tokens" }),
    ]);
    expect(t.items.map((i) => ("status" in i ? i.status : i.kind))).toEqual([
      "user", "denied", "error", "error",
    ]);
    expect(t.running).toBe(false);
  });

  it("a reviewed chip follows the command's final status after the turn (#104)", () => {
    const t = run([
      ev({ type: "tool_call", id: "a", name: "propose_steps", input: {} }),
      ev({ type: "tool_result", id: "a", ok: true, pending: "review", command: "c1" }),
      ev({ type: "tool_call", id: "b", name: "propose_steps", input: {} }),
      ev({ type: "tool_result", id: "b", ok: true, pending: "review", command: "c2" }),
      ev({ type: "tool_call", id: "c", name: "propose_steps", input: {} }),
      ev({ type: "tool_result", id: "c", ok: true, pending: "review", command: "c3" }),
      ev({ type: "done", stop_reason: "end_turn" }),
    ]);
    expect(reviewCommands(t)).toEqual(["c1", "c2", "c3"]);
    const after = run([
      { type: "command_status", command: "c1", ok: true },
      { type: "command_status", command: "c2", ok: false, error: "rejected" },
      { type: "command_status", command: "c3", ok: false, error: "stale" },
      { type: "command_status", command: "c1", ok: false, error: "late" }, // decided once
    ], t);
    expect(after.items.map((i) => i.kind === "tool" && [i.status, i.error])).toEqual([
      ["applied", undefined], ["rejected", undefined], ["error", "stale"],
    ]);
    expect(reviewCommands(after)).toEqual([]);
  });

  it("records a permission reply", () => {
    const t = run([
      ev({ type: "permission_request", id: "p", tool: "x", summary: "s", input: {} }),
      { type: "reply", id: "p", allow: true },
    ]);
    expect(t.items[0]).toMatchObject({ status: "allowed" });
  });
});

describe("agent panel tool chips (#67)", () => {
  const scale: Step = { op: "scale", target: "both", params: { columns: ["age"] } };
  const impute: Step = { op: "impute", target: "both", params: { columns: ["age"] } };

  it("targets a window, steps or columns", () => {
    expect(chipTarget("open_window", { tool: "dist" })).toEqual({ kind: "window", tool: "dist" });
    expect(chipTarget("set_dist_by", { by: "status" })).toEqual({ kind: "window", tool: "dist" });
    expect(chipTarget("select_columns", { columns: ["age"] })).toEqual({ kind: "columns", columns: ["age"] });
    expect(chipTarget("get_rows", {})).toBeNull();
    const t = chipTarget("propose_steps", { ops: [{ add: { step: scale } }, { remove: { index: 0 } }] });
    expect(t?.kind).toBe("steps");
    expect(chipLabel("propose_steps", t)).toBe("propose_steps · add scale, remove step 1");
    expect(chipLabel("open_window", { kind: "window", tool: "dist" })).toBe("open_window · Distribution");
  });

  it("finds the added / replaced steps in the current list", () => {
    const steps = [impute, scale, { ...scale, params: { columns: ["x"] } }];
    expect(stepIndices([{ add: { step: scale } }], steps)).toEqual([1]);
    expect(stepIndices([{ add: { step: { ...scale, params: { columns: ["zz"] } } } }], steps)).toEqual([2]);
    expect(stepIndices([{ replace: { index: 0, step: impute } }], steps)).toEqual([0]);
    expect(stepIndices([{ remove: { index: 0 } }], steps)).toEqual([]);
  });

  it("jumps: window opens, steps pin the view after the step", () => {
    expect(chipJump({ kind: "window", tool: "dist" }, [])).toEqual({
      actions: [{ type: "OPEN_TOOL", id: "dist" }],
      touch: { tools: ["dist"] },
    });
    expect(chipJump({ kind: "steps", ops: [{ add: { step: impute } }] }, [impute, scale])).toEqual({
      actions: [{ type: "SET_VIEW_VERSION", version: 1 }],
      touch: { steps: [0] },
    });
    expect(chipJump({ kind: "steps", ops: [{ add: { step: scale } }] }, [impute, scale])).toEqual({
      actions: [{ type: "SET_VIEW_VERSION", version: null }],
      touch: { steps: [1] },
    });
    expect(chipJump({ kind: "steps", ops: [{ remove: { index: 0 } }] }, [])).toBeNull();
  });
});

describe("session attachments (#129)", () => {
  const added = (id: string, name: string) =>
    ev({ type: "attachment_added", turn: null, attachment: { id, name, kind: "table", path: "/x", columns: ["a"] } });

  it("parses attachment events and the user_message echo, drops malformed ones", () => {
    expect(parseAgentEvent({ type: "attachment_added", attachment: { id: "a1", name: "x.csv", kind: "table" } }))
      .toEqual({ type: "attachment_added", attachment: { id: "a1", name: "x.csv", kind: "table" } });
    expect(parseAgentEvent({ type: "attachment_added", attachment: { name: "x.csv" } })).toBeNull();
    expect(parseAgentEvent({ type: "attachment_removed", id: "a1" })).toEqual({ type: "attachment_removed", id: "a1" });
    expect(parseAgentEvent({ type: "attachment_removed" })).toBeNull();
    expect(
      parseAgentEvent({ type: "user_message", text: "hi", attachments: [{ id: "a1", name: "x.csv", kind: "table" }, 3] }),
    ).toEqual({ type: "user_message", text: "hi", attachments: [{ id: "a1", name: "x.csv", kind: "table" }] });
    expect(parseAgentEvent({ type: "user_message", text: "hi" })).toEqual({ type: "user_message", text: "hi" });
  });

  it("folds the session list: add, re-add, remove, seed", () => {
    let t = run([added("a1", "x.csv"), added("a2", "y.txt"), added("a1", "x2.csv")]);
    expect(t.attached.map((a) => [a.id, a.name])).toEqual([["a1", "x2.csv"], ["a2", "y.txt"]]);
    t = run([ev({ type: "attachment_removed", id: "a1" })], t);
    expect(t.attached.map((a) => a.id)).toEqual(["a2"]);
    t = run([{ type: "attachments_seed", attached: [{ id: "a7", name: "z.csv" }] }], t);
    expect(t.attached).toEqual([{ id: "a7", name: "z.csv" }]);
  });

  it("keeps the session list across Clear and a pack reset", () => {
    const t = run([
      added("a1", "x.csv"),
      { type: "clear" },
      ev({ type: "config", pack: "stub", model: null, reset: true }),
    ]);
    expect(t.items).toEqual([]);
    expect(t.attached.map((a) => a.id)).toEqual(["a1"]);
  });

  it("records which files went with a message (local copy adopted)", () => {
    const t = run([
      { type: "sent", text: "look" },
      ev({ type: "user_message", text: "look", attachments: [{ id: "a1", name: "x.csv", kind: "table" }] }),
      ev({ type: "user_message", text: "again" }),
    ]);
    expect(t.items).toHaveLength(2);
    expect(t.items[0]).toMatchObject({ kind: "user", local: false, files: ["x.csv"] });
    expect(t.items[1]).toMatchObject({ kind: "user", text: "again" });
    expect((t.items[1] as { files?: string[] }).files).toBeUndefined();
  });
});
