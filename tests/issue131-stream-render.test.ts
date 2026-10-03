// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderMarkdown } from "../src/bench/agent/panel/markdown";
import { createThrottle } from "../src/bench/agent/panel/throttle";
import { EMPTY_TRANSCRIPT, transcriptReducer, type Transcript } from "../src/bench/agent/panel/transcript";

const DELTAS = 2_000;
const DELTA_GAP_MS = 5;
const STREAM_RENDER_MS = 100;

/** A synthetic reply: a table, prose and a code block, cut into `DELTAS` pieces. */
function syntheticDeltas(): string[] {
  const pieces: string[] = ["| col | value |\n|---|---|\n"];
  for (let i = 0; pieces.length < DELTAS; i++) {
    pieces.push(i % 50 === 0 ? `\n\`\`\`py\nx = ${i}\n\`\`\`\n\n` : `word${i} **b** `);
  }
  return pieces;
}

describe("streaming Markdown render (#131)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("a 2 000-delta reply renders its Markdown at most once per 100 ms, and the final text lands", () => {
    // What the Markdown component would parse + sanitise, one entry per render.
    const renders: string[] = [];
    const throttle = createThrottle<string>(STREAM_RENDER_MS, (text) => renders.push(text));
    let text = "";
    for (const piece of syntheticDeltas()) {
      text += piece;
      throttle.push(text);
      vi.advanceTimersByTime(DELTA_GAP_MS);
    }
    vi.runAllTimers();
    // Unthrottled: one full parse + sanitise per delta (2 000).
    const streamMs = DELTAS * DELTA_GAP_MS;
    expect(renders.length).toBeLessThanOrEqual(streamMs / STREAM_RENDER_MS + 1);
    expect(renders.at(-1)).toBe(text);
    expect(renderMarkdown(text)).toContain("<table>");
  });

  it("the first value shows at once, a burst collapses into one trailing render", () => {
    const seen: number[] = [];
    const throttle = createThrottle<number>(STREAM_RENDER_MS, (v) => seen.push(v));
    throttle.push(1);
    expect(seen).toEqual([1]);
    for (let v = 2; v <= 10; v++) throttle.push(v);
    expect(seen).toEqual([1]);
    vi.advanceTimersByTime(STREAM_RENDER_MS);
    expect(seen).toEqual([1, 10]);
  });

  it("cancel drops the pending trailing render", () => {
    const seen: number[] = [];
    const throttle = createThrottle<number>(STREAM_RENDER_MS, (v) => seen.push(v));
    throttle.push(1);
    throttle.push(2);
    throttle.cancel();
    vi.runAllTimers();
    expect(seen).toEqual([1]);
  });
});

describe("transcript deltas keep the other items (#131)", () => {
  it("a delta replaces only the streaming item, so memoised finished messages do not re-render", () => {
    let t: Transcript = transcriptReducer(EMPTY_TRANSCRIPT, { type: "sent", text: "hi" });
    t = transcriptReducer(t, { type: "event", event: { type: "assistant_delta", text: "a" } });
    const before = t.items;
    t = transcriptReducer(t, { type: "event", event: { type: "assistant_delta", text: "b" } });
    expect(t.items).toHaveLength(before.length);
    expect(t.items[0]).toBe(before[0]);
    expect(t.items.at(-1)).not.toBe(before.at(-1));
    expect(t.items.at(-1)).toMatchObject({ kind: "assistant", text: "ab" });
  });
});
