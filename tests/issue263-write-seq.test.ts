import { afterEach, describe, expect, it, vi } from "vitest";

import { serializeWorkspace } from "../src/api/client";
import type { Workspace } from "../src/api/types";
import { nextWriteSeq, resetWriteSeqForTests } from "../src/api/writeSeq";
import {
  ensureWorkspaceSaved,
  flushWorkspaceOnPageHide,
  flushWorkspaceSave,
  getLastSavedWorkspaceJson,
  getWorkspaceSaveFailure,
  markWorkspaceLoaded,
  queueWorkspaceSave,
  resetWorkspaceSaveGateForTests,
  retryWorkspaceSave,
  setCommittedWorkspace,
} from "../src/state/workspaceSaveGate";

function ws(name: string, path = "/tmp/train.csv"): Workspace {
  return {
    name,
    datasets: { train: { x: { kind: "csv", path } } },
    label: { mode: "order" },
    merges: [],
    variables: [],
    groups: [],
    steps: [],
  };
}

const STALE = {
  type: "StaleWriteError",
  message: "stale",
  detail: { rule: "stale_write", last_seq: 5 },
};

function seqOf(call: unknown[]): number {
  const init = call[1] as RequestInit;
  return Number((init.headers as Record<string, string>)["X-Dtk-Write-Seq"]);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  resetWorkspaceSaveGateForTests();
  resetWriteSeqForTests();
});

describe("nextWriteSeq (#263)", () => {
  it("is strictly increasing within the same millisecond", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
    const a = nextWriteSeq();
    const b = nextWriteSeq();
    const c = nextWriteSeq();
    expect(a).toBe(1_800_000_000_000_000);
    expect(b).toBe(a + 1);
    expect(c).toBe(b + 1);
  });

  it("keeps increasing when the clock goes backwards", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
    const a = nextWriteSeq();
    now.mockReturnValue(1_700_000_000_000);
    expect(nextWriteSeq()).toBe(a + 1);
  });

  it("is a safe integer", () => {
    const s = nextWriteSeq();
    expect(Number.isSafeInteger(s)).toBe(true);
    expect(s).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });
});

describe("X-Dtk-Write-Seq on every workspace PUT (#263)", () => {
  it("is sent by the autosave, ensure, flush, retry and keepalive paths, increasing", async () => {
    const f = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("nope", { status: 503 }))
      .mockImplementation(async () => new Response("{}", { status: 200 }));
    const w = ws("seq_a");
    markWorkspaceLoaded(w);

    const e1 = { ...w, steps: [{ op: "x" }] } as unknown as Workspace;
    setCommittedWorkspace(e1);
    await expect(ensureWorkspaceSaved(e1)).rejects.toThrow();
    await retryWorkspaceSave(); // retry after failure
    const e2 = { ...w, steps: [{ op: "y" }] } as unknown as Workspace;
    setCommittedWorkspace(e2);
    await queueWorkspaceSave(e2); // autosave
    const e3 = { ...w, steps: [{ op: "z" }] } as unknown as Workspace;
    setCommittedWorkspace(e3);
    await flushWorkspaceSave("seq_a"); // flush before duplicate / rename
    const e4 = { ...w, steps: [{ op: "k" }] } as unknown as Workspace;
    setCommittedWorkspace(e4);
    expect(flushWorkspaceOnPageHide()).toBe(true); // keepalive

    const puts = f.mock.calls.filter((c) => (c[1] as RequestInit).method === "PUT");
    expect(puts).toHaveLength(5);
    const seqs = puts.map(seqOf);
    expect(seqs.every((s) => Number.isSafeInteger(s) && s > 0)).toBe(true);
    for (let i = 1; i < seqs.length; i++) expect(seqs[i]!).toBeGreaterThan(seqs[i - 1]!);
    expect((puts[4]![1] as RequestInit).keepalive).toBe(true);
  });
});

describe("409 stale_write (#263)", () => {
  function staleThenOk() {
    return vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(STALE), { status: 409 }))
      .mockImplementation(async () => new Response("{}", { status: 200 }));
  }

  it("is dropped silently: no banner, no retry, not marked saved, chain continues", async () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const f = staleThenOk();
    const w = ws("stale_a");
    markWorkspaceLoaded(w);
    const before = getLastSavedWorkspaceJson();
    const e1 = { ...w, steps: [{ op: "x" }] } as unknown as Workspace;
    setCommittedWorkspace(e1);
    await expect(ensureWorkspaceSaved(e1)).resolves.toBeUndefined();
    expect(f).toHaveBeenCalledTimes(1);
    expect(getWorkspaceSaveFailure()).toBeNull();
    expect(getLastSavedWorkspaceJson()).toBe(before);
    expect(debug).toHaveBeenCalled();

    const e2 = { ...w, steps: [{ op: "y" }] } as unknown as Workspace;
    setCommittedWorkspace(e2);
    await queueWorkspaceSave(e2);
    expect(f).toHaveBeenCalledTimes(2);
    expect(seqOf(f.mock.calls[1]!)).toBeGreaterThan(seqOf(f.mock.calls[0]!));
    expect(getLastSavedWorkspaceJson()).toBe(serializeWorkspace(e2));
  });

  it("re-sends once above the engine's last_seq when it is higher than anything this tab sent", async () => {
    vi.spyOn(console, "debug").mockImplementation(() => undefined);
    vi.spyOn(Date, "now").mockReturnValue(1_000_000_000_000);
    const ahead = 9_000_000_000_000_000;
    const f = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (_u, init) => {
        const seq = Number((init!.headers as Record<string, string>)["X-Dtk-Write-Seq"]);
        return seq < ahead
          ? new Response(
              JSON.stringify({ ...STALE, detail: { rule: "stale_write", last_seq: ahead } }),
              { status: 409 },
            )
          : new Response("{}", { status: 200 });
      });
    const w = ws("stale_d");
    markWorkspaceLoaded(w);
    const e1 = { ...w, steps: [{ op: "x" }] } as unknown as Workspace;
    setCommittedWorkspace(e1);
    await ensureWorkspaceSaved(e1);
    expect(f).toHaveBeenCalledTimes(2);
    expect(seqOf(f.mock.calls[1]!)).toBeGreaterThan(ahead);
    expect(getLastSavedWorkspaceJson()).toBe(serializeWorkspace(e1));
    expect(getWorkspaceSaveFailure()).toBeNull();
  });

  it("re-sends only once when the engine keeps refusing", async () => {
    vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const f = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(
          JSON.stringify({ ...STALE, detail: { rule: "stale_write", last_seq: 9e15 } }),
          { status: 409 },
        ),
    );
    const w = ws("stale_e");
    markWorkspaceLoaded(w);
    const e1 = { ...w, steps: [{ op: "x" }] } as unknown as Workspace;
    setCommittedWorkspace(e1);
    await ensureWorkspaceSaved(e1);
    expect(f).toHaveBeenCalledTimes(2);
    expect(getWorkspaceSaveFailure()).toBeNull();
  });

  it("does not clear a genuine earlier failure", async () => {
    vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const f = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("down", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(STALE), { status: 409 }));
    const w = ws("stale_b");
    markWorkspaceLoaded(w);
    const e1 = { ...w, steps: [{ op: "x" }] } as unknown as Workspace;
    setCommittedWorkspace(e1);
    await expect(ensureWorkspaceSaved(e1)).rejects.toThrow();
    const failure = getWorkspaceSaveFailure();
    expect(failure).not.toBeNull();
    await expect(retryWorkspaceSave()).resolves.toBeUndefined();
    expect(f).toHaveBeenCalledTimes(2);
    expect(getWorkspaceSaveFailure()).toBe(failure);
  });

  it("a stale keepalive flush records nothing", async () => {
    vi.spyOn(console, "debug").mockImplementation(() => undefined);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(STALE), { status: 409 }),
    );
    const w = ws("stale_c");
    markWorkspaceLoaded(w);
    const before = getLastSavedWorkspaceJson();
    setCommittedWorkspace({ ...w, steps: [{ op: "x" }] } as unknown as Workspace);
    expect(flushWorkspaceOnPageHide()).toBe(true);
    await flushWorkspaceSave("other");
    expect(getLastSavedWorkspaceJson()).toBe(before);
    expect(getWorkspaceSaveFailure()).toBeNull();
  });

  it.each([
    [409, { type: "Conflict", message: "other conflict", detail: { rule: "x" } }],
    [409, { type: "StaleWriteError", message: "m", detail: { rule: "other" } }],
    [422, { type: "KeyParamsError", message: "bad header" }],
  ])("any other %i keeps the failure banner", async (status, body) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(body), { status }),
    );
    const w = ws(`other_${status}_${body.type}`);
    markWorkspaceLoaded(w);
    const e1 = { ...w, steps: [{ op: "x" }] } as unknown as Workspace;
    setCommittedWorkspace(e1);
    await expect(ensureWorkspaceSaved(e1)).rejects.toThrow(body.message);
    expect(getWorkspaceSaveFailure()?.message).toBe(body.message);
  });
});
