// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiClient } from "../src/api/client";
import { InFlightDedupe } from "../src/api/requestDedupe";
import { cancelInFlight, inFlightCount } from "../src/api/inflight";
import {
  CANCELLED_MESSAGE,
  EngineError,
  errorText,
  type Workspace,
  type WorkspaceRows,
} from "../src/api/types";
import { useBenchFrame } from "../src/bench/useBenchFrame";
import { EMPTY_GRID_VIEW } from "../src/state/gridView";
import { engineMessage, type SourceFileItem } from "../src/screens/sources/sourcesLogic";
import {
  EMPTY_PREVIEW,
  enrichFileItem,
  fileWarning,
  trainStatus,
} from "../src/screens/sources/sourcesScreenLogic";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const ws = (name: string): Workspace => ({
  name,
  datasets: { train: { x: { kind: "csv", path: "/tmp/a.csv" } } },
  label: { mode: "order" },
  merges: [],
  variables: [],
  groups: [],
  steps: [],
});

/** A fetch that never answers until aborted; records every call. */
function hangingFetch() {
  const calls: { signal: AbortSignal | undefined }[] = [];
  vi.stubGlobal(
    "fetch",
    (_url: string, init?: RequestInit) =>
      new Promise((_res, rej) => {
        calls.push({ signal: init?.signal ?? undefined });
        init?.signal?.addEventListener("abort", () =>
          rej(new DOMException("aborted", "AbortError")),
        );
      }),
  );
  return calls;
}

describe("shared GET is reference-counted (#250)", () => {
  it("one subscriber leaving does not abort the others; the last one does", async () => {
    const d = new InFlightDedupe();
    let signal!: AbortSignal;
    let resolve!: (v: string) => void;
    let starts = 0;
    const start = (s: AbortSignal) => {
      starts += 1;
      signal = s;
      return new Promise<string>((res) => (resolve = res));
    };
    const a = d.join("k", start);
    const b = d.join("k", start);
    expect(starts).toBe(1);
    expect(a.promise).toBe(b.promise);
    a.leave();
    expect(signal.aborted).toBe(false);
    resolve("data");
    await expect(b.promise).resolves.toBe("data");

    const c = d.join("k2", start);
    const e = d.join("k2", start);
    c.leave();
    c.leave(); // idempotent: must not count twice
    expect(signal.aborted).toBe(false);
    e.leave();
    expect(signal.aborted).toBe(true);
  });

  it("after everyone left, a new caller starts a fresh request", () => {
    const d = new InFlightDedupe();
    let starts = 0;
    const start = () => {
      starts += 1;
      return new Promise<string>(() => undefined);
    };
    d.join("k", start).leave();
    d.join("k", start);
    expect(starts).toBe(2);
  });

  it("client: two sharers both cancelled abort the fetch once; a later caller is unaffected", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const calls = hangingFetch();
    const p1 = apiClient.getWorkspace("w250a").catch((e: unknown) => e);
    const p2 = apiClient.getWorkspace("w250a").catch((e: unknown) => e);
    expect(calls).toHaveLength(1);
    expect(inFlightCount("source")).toBe(2);
    cancelInFlight("source");
    const [e1, e2] = await Promise.all([p1, p2]);
    expect((e1 as EngineError).type).toBe("Cancelled");
    expect((e2 as EngineError).type).toBe("Cancelled");
    expect(calls[0]?.signal?.aborted).toBe(true);
    expect(inFlightCount("source")).toBe(0);

    // The aborted request is gone: a new caller gets a request of its own.
    vi.stubGlobal(
      "fetch",
      async () => new Response(JSON.stringify(ws("w250a")), { status: 200 }),
    );
    await expect(apiClient.getWorkspace("w250a")).resolves.toMatchObject({ name: "w250a" });
  });
});

describe("cancel is neutral (#250)", () => {
  const cancelled = new EngineError("Cancelled", "Request cancelled.");

  it("reads as a notice, not an engine error", () => {
    expect(errorText(cancelled)).toBe(CANCELLED_MESSAGE);
    expect(engineMessage(cancelled)).toBe("Load cancelled");
    expect(engineMessage(new EngineError("SourceError", "boom"))).toBe("SourceError: boom");
  });

  it("a cancelled inspect is not recorded as the file's parse error", async () => {
    vi.spyOn(apiClient, "sourceColumns").mockRejectedValue(cancelled);
    vi.spyOn(apiClient, "runKey").mockResolvedValue({} as never);
    const item: SourceFileItem = {
      id: "f1",
      name: "a.csv",
      path: "/tmp/a.csv",
      cols: ["a"],
      spec: { kind: "csv", path: "/tmp/a.csv" },
    };
    await expect(enrichFileItem(item)).rejects.toBe(cancelled);
  });

  it("a real engine error still becomes the parse error", async () => {
    vi.spyOn(apiClient, "sourceColumns").mockRejectedValue(
      new EngineError("SourceError", "cannot read csv: file is empty"),
    );
    vi.spyOn(apiClient, "previewWorkspace").mockRejectedValue(
      new EngineError("SourceError", "cannot read csv: file is empty"),
    );
    vi.spyOn(apiClient, "runKey").mockResolvedValue({} as never);
    const out = await enrichFileItem({
      id: "f1",
      name: "a.csv",
      path: "/tmp/a.csv",
      cols: [],
      spec: { kind: "csv", path: "/tmp/a.csv" },
    });
    expect(out.parseError).toBe("SourceError: cannot read csv: file is empty");
  });
});

describe("empty and unreadable files warn and block (#239)", () => {
  const base: SourceFileItem = {
    id: "f1",
    name: "x.csv",
    path: "/tmp/x.csv",
    cols: [],
    spec: { kind: "csv", path: "/tmp/x.csv" },
  };

  it("a 0-byte upload: 'Empty file' with the engine reason, never ready", () => {
    const f = { ...base, emptyReason: "SourceError: cannot read csv: file is empty" };
    expect(fileWarning(f)).toEqual({
      title: "Empty file",
      reason: "SourceError: cannot read csv: file is empty",
    });
    const s = trainStatus(f, EMPTY_PREVIEW, false);
    expect(s.ready).toBe(false);
    expect(s.canNavigate).toBe(false);
  });

  it("a binary upload: 'Not a readable table' with the engine message verbatim", () => {
    const reason = "SourceError: cannot read csv: new-line character seen in unquoted field";
    const f = { ...base, cols: ["a", "b"], parseError: reason };
    expect(fileWarning(f)).toEqual({ title: "Not a readable table", reason });
    const s = trainStatus(f, { ...EMPTY_PREVIEW, trainShape: [6, 422] }, false);
    expect(s.ready).toBe(false);
    expect(s.canNavigate).toBe(false);
  });

  it("a healthy file has no warning and is ready", () => {
    const f = { ...base, cols: ["a"], rowCount: 3 };
    expect(fileWarning(f)).toBeNull();
    expect(trainStatus(f, EMPTY_PREVIEW, false).canNavigate).toBe(true);
  });
});

describe("loadMore lock is owned by its generation (#250)", () => {
  let host: HTMLElement;
  let root: Root;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const page = (n: number): WorkspaceRows => ({
    columns: [{ name: "a" } as never],
    rows: Array.from({ length: n }, () => ({ cells: [1] }) as never),
    total: 100,
    version: 0,
  });

  it("a stale page finishing cannot reopen the lock of the new generation", async () => {
    const pending: Array<(r: WorkspaceRows) => void> = [];
    const spy = vi
      .spyOn(apiClient, "workspaceRows")
      .mockImplementation((_w, _r, _v, offset) =>
        offset && offset > 0
          ? new Promise<WorkspaceRows>((res) => pending.push(res))
          : Promise.resolve(page(5)),
      );
    vi.spyOn(apiClient, "columnProfiles").mockResolvedValue({ columns: [], version: 0 });
    const w = ws("w250-lock");
    const noDispatch = () => undefined; // stable: the frame effect depends on it
    let api!: ReturnType<typeof useBenchFrame>;
    const Probe = () => {
      api = useBenchFrame(w, "train", null, noDispatch, EMPTY_GRID_VIEW);
      return null;
    };
    const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));
    const moreCalls = () => spy.mock.calls.filter((c) => (c[3] ?? 0) > 0).length;

    act(() => root.render(createElement(Probe)));
    await flush();
    expect(api.rows).toHaveLength(5);

    act(() => api.loadMore()); // page A, generation 1
    expect(moreCalls()).toBe(1);
    act(() => api.reload()); // generation 2 supersedes it
    await flush();
    act(() => api.loadMore()); // page B, generation 2
    expect(moreCalls()).toBe(2);

    pending[0]?.(page(5)); // the stale page A finishes
    await flush();
    act(() => api.loadMore()); // must still be locked by B
    expect(moreCalls()).toBe(2);

    pending[1]?.(page(5)); // B finishes: the lock opens
    await flush();
    act(() => api.loadMore());
    expect(moreCalls()).toBe(3);
  });
});
