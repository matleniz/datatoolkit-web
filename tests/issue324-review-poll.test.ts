// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseAgentEvent, type AgentEvent } from "../src/bench/agent/panel/protocol";
import {
  EMPTY_TRANSCRIPT,
  REVIEW_POLL_MAX_FAILURES,
  reviewCommands,
  statusUnavailable,
  transcriptReducer,
  type Transcript,
  type TranscriptAction,
  type TranscriptItem,
} from "../src/bench/agent/panel/transcript";

/**
 * datatoolkit-issues#324: a chip under review polls the command status; failed
 * polls used to be swallowed, so with the engine gone it said "waiting for
 * your review" forever. Now REVIEW_POLL_MAX_FAILURES failures in a row mark
 * it "status unavailable", a good poll resets it, and the failures are logged.
 */

const getCommandStatus = vi.fn();
vi.mock("../src/bench/agent/panel/agentClient", () => ({
  cancelAgent: vi.fn(),
  getAgentOptions: vi.fn(() => Promise.resolve(null)),
  getAgentStatus: vi.fn(() => Promise.resolve({ pack: "stub", packs: [] })),
  getCommandStatus: (...args: unknown[]) => getCommandStatus(...args) as unknown,
  replyPermission: vi.fn(),
  sendAgentMessage: vi.fn(),
  setAgentConfig: vi.fn(),
}));
vi.mock("../src/bench/agent/attachments/attachmentContract", () => ({
  detachAttachment: vi.fn(),
  listAttachments: vi.fn(() => Promise.resolve([])),
}));

const { useAgentChat } = await import("../src/bench/agent/panel/useAgentChat");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const run = (actions: TranscriptAction[], from: Transcript = EMPTY_TRANSCRIPT) =>
  actions.reduce(transcriptReducer, from);
const ev = (raw: Record<string, unknown>): TranscriptAction => ({
  type: "event",
  event: parseAgentEvent(raw) as AgentEvent,
});
const tool = (t: Transcript) => t.items[0] as Extract<TranscriptItem, { kind: "tool" }>;
const poll = (ok: boolean): TranscriptAction => ({ type: "command_poll", command: "c1", ok });

const UNDER_REVIEW = [
  ev({ type: "tool_call", id: "a", name: "propose_steps", input: {} }),
  ev({ type: "tool_result", id: "a", ok: true, pending: "review", command: "c1" }),
  ev({ type: "done", stop_reason: "end_turn" }),
];

describe("review chip poll failures (#324): reducer", () => {
  it("is unavailable after REVIEW_POLL_MAX_FAILURES failures in a row, not before", () => {
    expect(REVIEW_POLL_MAX_FAILURES).toBe(3);
    let t = run(UNDER_REVIEW);
    for (let i = 1; i < REVIEW_POLL_MAX_FAILURES; i++) {
      t = run([poll(false)], t);
      expect(statusUnavailable(tool(t))).toBe(false);
    }
    t = run([poll(false)], t);
    expect(statusUnavailable(tool(t))).toBe(true);
    // Still under review: it keeps being polled.
    expect(tool(t).status).toBe("review");
    expect(reviewCommands(t)).toEqual(["c1"]);
  });

  it("a good poll resets the count and the state", () => {
    let t = run([poll(false), poll(false), poll(false)], run(UNDER_REVIEW));
    t = run([poll(true)], t);
    expect(statusUnavailable(tool(t))).toBe(false);
    expect(tool(t).pollFailures).toBe(0);
    // Consecutive only: two failures after the reset are not enough.
    t = run([poll(false), poll(false)], t);
    expect(statusUnavailable(tool(t))).toBe(false);
  });

  it("the final status still lands after failures", () => {
    const t = run(
      [poll(false), poll(false), poll(false), poll(true), { type: "command_status", command: "c1", ok: true }],
      run(UNDER_REVIEW),
    );
    expect(tool(t).status).toBe("applied");
    expect(statusUnavailable(tool(t))).toBe(false);
  });

  it("a good poll on a healthy chip returns the same transcript (no re-render)", () => {
    const t = run(UNDER_REVIEW);
    expect(transcriptReducer(t, poll(true))).toBe(t);
  });

  it("only touches the polled command's chip under review", () => {
    const t = run(
      [
        ...UNDER_REVIEW,
        ev({ type: "tool_call", id: "b", name: "propose_steps", input: {} }),
        ev({ type: "tool_result", id: "b", ok: true, summary: "done" }),
        poll(false), poll(false), poll(false),
        { type: "command_poll", command: "other", ok: false },
      ],
    );
    const [a, b] = t.items as Extract<TranscriptItem, { kind: "tool" }>[];
    expect(statusUnavailable(a!)).toBe(true);
    expect(b!.pollFailures).toBeUndefined();
  });
});

// -- hook ---------------------------------------------------------------------

class FakeEventSource {
  static last: FakeEventSource | null = null;
  private listeners = new Map<string, (ev: MessageEvent<string>) => void>();
  constructor() {
    FakeEventSource.last = this;
  }
  addEventListener(type: string, fn: (ev: MessageEvent<string>) => void) {
    this.listeners.set(type, fn);
  }
  close() {}
  emit(raw: Record<string, unknown>) {
    this.listeners.get("agent")?.({ data: JSON.stringify(raw) } as MessageEvent<string>);
  }
}

let latest: Transcript = EMPTY_TRANSCRIPT;
function Probe() {
  latest = useAgentChat("tok").transcript;
  return null;
}

let host: HTMLElement;
let root: Root;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("EventSource", FakeEventSource);
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  getCommandStatus.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** One poll interval, and the promises it started. */
async function tick() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_500);
  });
}

describe("review chip poll failures (#324): useAgentChat", () => {
  it("logs failed polls, shows unavailable after 3, recovers on success", async () => {
    await act(async () => {
      root.render(createElement(Probe));
      await vi.advanceTimersByTimeAsync(0);
    });
    act(() => {
      FakeEventSource.last!.emit({ type: "tool_call", id: "a", name: "propose_steps", input: {} });
      FakeEventSource.last!.emit({ type: "tool_result", id: "a", ok: true, pending: "review", command: "c1" });
      FakeEventSource.last!.emit({ type: "done", stop_reason: "end_turn" });
    });

    getCommandStatus.mockRejectedValue(new TypeError("Failed to fetch"));
    await tick();
    await tick();
    expect(statusUnavailable(tool(latest))).toBe(false);
    await tick();
    expect(statusUnavailable(tool(latest))).toBe(true);
    expect(warn).toHaveBeenCalledTimes(3);
    expect(String(warn.mock.calls[2]![0])).toContain("showing status unavailable");
    expect(warn.mock.calls[0]![1]).toBe("Failed to fetch");

    // Still polling while unavailable, but no more log spam.
    await tick();
    expect(getCommandStatus).toHaveBeenCalledTimes(4);
    expect(warn).toHaveBeenCalledTimes(3);

    // The engine is back: still pending (null), the chip waits again.
    getCommandStatus.mockResolvedValue(null);
    await tick();
    expect(statusUnavailable(tool(latest))).toBe(false);
    expect(tool(latest).status).toBe("review");

    // And then decided.
    getCommandStatus.mockResolvedValue({ ok: true });
    await tick();
    expect(tool(latest).status).toBe("applied");
  });
});
