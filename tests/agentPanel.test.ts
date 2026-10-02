import { describe, expect, it } from "vitest";

import type { Step } from "../src/api/types";
import { inlineCode, splitBlocks } from "../src/bench/agent/panel/blocks";
import { chipJump, chipLabel, chipTarget, stepIndices } from "../src/bench/agent/panel/chips";
import {
  parseAgentEvent,
  parseAgentStatus,
  toolName,
  type AgentEvent,
} from "../src/bench/agent/panel/protocol";
import {
  EMPTY_TRANSCRIPT,
  formatUsage,
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
      .toEqual({ type: "usage", inputTokens: 10, outputTokens: 2, total: { input: 30, output: 5 } });
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
        usage: { input_tokens: 3, output_tokens: 4 },
      }),
    ).toMatchObject({ available: true, pack: "stub", usage: { input: 3, output: 4 }, maxTokens: undefined });
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
    expect(t.usage).toEqual({ input: 150, output: 25 });
    expect(t.running).toBe(false);
    expect(formatUsage({ input: 1234, output: 25_600 })).toBe("1.2k in · 26k out");
  });

  it("prefers the engine's cumulative totals", () => {
    const t = run([
      { type: "usage_seed", usage: { input: 500, output: 50 } },
      ev({ type: "usage", input_tokens: 1, output_tokens: 1, total_input_tokens: 600, total_output_tokens: 70 }),
    ]);
    expect(t.usage).toEqual({ input: 600, output: 70 });
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

  it("records a permission reply", () => {
    const t = run([
      ev({ type: "permission_request", id: "p", tool: "x", summary: "s", input: {} }),
      { type: "reply", id: "p", allow: true },
    ]);
    expect(t.items[0]).toMatchObject({ status: "allowed" });
  });
});

describe("agent panel message blocks (#67)", () => {
  it("splits fenced code blocks, an open fence runs to the end", () => {
    expect(splitBlocks("Try:\n```python\ndf.age.median()\n```\nthen apply.")).toEqual([
      { kind: "text", text: "Try:" },
      { kind: "code", lang: "python", code: "df.age.median()" },
      { kind: "text", text: "then apply." },
    ]);
    expect(splitBlocks("```\na\nb")).toEqual([{ kind: "code", lang: "", code: "a\nb" }]);
    expect(splitBlocks("")).toEqual([]);
  });

  it("splits inline code", () => {
    expect(inlineCode("use `median` by `status`")).toEqual([
      "use ", { code: "median" }, " by ", { code: "status" },
    ]);
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
