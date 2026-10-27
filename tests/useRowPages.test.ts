// @vitest-environment jsdom
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiClient } from "../src/api/client";
import type { Workspace, WorkspaceRow } from "../src/api/types";
import { MAX_PAGES, PAGE_ROWS } from "../src/bench/grid/rowWindow";
import {
  useRowPages,
  type RowPagesApi,
  type RowPagesOptions,
} from "../src/bench/grid/useRowPages";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const WS = { name: "w" } as unknown as Workspace;
const TOTAL = 100_000;
const seed: WorkspaceRow[] = Array.from({ length: PAGE_ROWS }, (_, i) => ({ _rid: i }));

type Deferred = { offset: number; signal?: AbortSignal; ok: () => void; ko: () => void };
let calls: Deferred[];
let api: RowPagesApi;
let host: HTMLElement;
let root: Root;
const onError = vi.fn();
const onRecover = vi.fn();

function page(offset: number): WorkspaceRow[] {
  return Array.from({ length: PAGE_ROWS }, (_, i) => ({ _rid: offset + i }));
}

function Probe({ opts }: { opts: RowPagesOptions }): ReactElement | null {
  api = useRowPages(opts);
  return null;
}

function opts(over: Partial<RowPagesOptions> = {}): RowPagesOptions {
  return {
    workspace: WS,
    role: "train",
    version: 0,
    view: {} as RowPagesOptions["view"],
    total: TOTAL,
    enabled: true,
    seed,
    resetKey: "a",
    onError,
    onRecover,
    ...over,
  };
}

async function mount(o: RowPagesOptions) {
  await act(async () => {
    root.render(createElement(Probe, { opts: o }));
  });
}

async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  calls = [];
  onError.mockClear();
  onRecover.mockClear();
  vi.spyOn(apiClient, "workspaceRows").mockImplementation(
    (_w, _r, _v, offset, _l, signal) =>
      new Promise((resolve, reject) => {
        calls.push({
          offset,
          signal,
          ok: () => resolve({ rows: page(offset) } as never),
          ko: () => reject(new Error("boom")),
        });
      }),
  );
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useRowPages", () => {
  it("retries a failed page without a new scroll, one error per burst", async () => {
    await mount(opts());
    await act(async () => api.want(0, 30, 1));
    await tick(100);
    expect(calls.length).toBeGreaterThan(0);
    const first = calls.length;
    await act(async () => {
      for (const c of [...calls]) c.ko();
    });
    await tick(100);
    expect(onError).toHaveBeenCalledTimes(1);
    await tick(3100);
    expect(calls.length).toBeGreaterThan(first);
    expect(onError).toHaveBeenCalledTimes(1);
    // The retry succeeds: the error is cleared once.
    await act(async () => {
      for (const c of calls.slice(first)) c.ok();
    });
    await tick(100);
    expect(onRecover).toHaveBeenCalledTimes(1);
    expect(api.row(PAGE_ROWS)).toBeDefined();
  });

  it("drops a response that arrives after the store was reset", async () => {
    await mount(opts());
    await act(async () => api.want(0, 30, 1));
    await tick(100);
    const stale = calls[0]!;
    await mount(opts({ resetKey: "b" }));
    expect(stale.signal?.aborted).toBe(true);
    await act(async () => stale.ok());
    expect(api.loadedPages()).not.toContain(stale.offset / PAGE_ROWS);
    expect(onError).not.toHaveBeenCalled();
  });

  it("keeps at most MAX_PAGES pages while scrolling far", async () => {
    await mount(opts());
    for (let p = 1; p < MAX_PAGES + 20; p += 3) {
      await act(async () => api.want(p * PAGE_ROWS, p * PAGE_ROWS + 30, 1));
      await tick(100);
      await act(async () => {
        for (const c of calls.splice(0)) c.ok();
      });
      await tick(100);
    }
    expect(api.loadedPages().length).toBeLessThanOrEqual(MAX_PAGES);
    expect(api.loadedPages().length).toBeGreaterThan(0);
  });

  it("reports a burst of failures once", async () => {
    await mount(opts());
    await act(async () => api.want(0, 30, 1));
    await tick(100);
    await act(async () => {
      for (const c of calls.splice(0)) c.ko();
    });
    await tick(100);
    expect(calls.length).toBe(0);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
