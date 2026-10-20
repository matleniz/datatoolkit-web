import { afterEach, describe, expect, it, vi } from "vitest";

import { apiClient, serializeWorkspace } from "../src/api/client";
import type { Workspace } from "../src/api/types";
import {
  abandonPendingWorkspaceSave,
  allowWorkspaceSave,
  commitWorkspaceSave,
  ensureWorkspaceSaved,
  flushWorkspaceOnPageHide,
  flushWorkspaceSave,
  KEEPALIVE_MAX_BYTES,
  getLastSavedWorkspaceJson,
  getWorkspaceSaveFailure,
  getLiveSaveFailure,
  getOrphanedSaveFailures,
  renameWorkspaceSaveFailure,
  retryWorkspaceSave,
  dismissWorkspaceSaveFailure,
  setCommittedWorkspace,
  subscribeWorkspaceSaveFailure,
  getWorkspaceSaveEpoch,
  isWorkspaceSaveSuppressed,
  markWorkspaceLoaded,
  markWorkspaceSaved,
  queueWorkspaceSave,
  resetWorkspaceSaveGateForTests,
} from "../src/state/workspaceSaveGate";

function ws(name: string, path = "/tmp/train.csv"): Workspace {
  return {
    name,
    datasets: {
      train: { x: { kind: "csv", path } },
    },
    label: { mode: "order" },
    merges: [],
    variables: [],
    groups: [],
    steps: [],
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  resetWorkspaceSaveGateForTests();
});

describe("workspaceSaveGate (MAT-217)", () => {
  it("skips PUT when the workspace name was abandoned (tombstone)", async () => {
    const body = ws("mat171_a");
    const serialized = serializeWorkspace(body);
    const epoch = getWorkspaceSaveEpoch();
    const save = vi.fn(async () => body);
    const remove = vi.fn(async () => undefined);

    abandonPendingWorkspaceSave(["mat171_a"]);

    const outcome = await commitWorkspaceSave({
      ws: body,
      serialized,
      epochAtStart: epoch,
      isCurrent: (e) => e === getWorkspaceSaveEpoch(),
      save,
      remove,
    });

    expect(outcome).toBe("skipped");
    expect(save).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(isWorkspaceSaveSuppressed("mat171_a")).toBe(true);
  });

  it("skips PUT when save epoch was bumped (pending debounce cancelled)", async () => {
    const body = ws("mat171_a");
    const serialized = serializeWorkspace(body);
    const epoch = getWorkspaceSaveEpoch();
    const save = vi.fn(async () => body);

    abandonPendingWorkspaceSave();

    const outcome = await commitWorkspaceSave({
      ws: body,
      serialized,
      epochAtStart: epoch,
      isCurrent: (e) => e === getWorkspaceSaveEpoch(),
      save,
      remove: async () => undefined,
    });

    expect(outcome).toBe("skipped");
    expect(save).not.toHaveBeenCalled();
  });

  it("abandon(names) waits for the PUT on the wire, then undoes it (#13)", async () => {
    const body = ws("mat171_a");
    const disk = new Map<string, Workspace>();
    let started!: () => void;
    const onWire = new Promise<void>((r) => {
      started = r;
    });
    let releaseSave!: () => void;
    const hold = new Promise<void>((r) => {
      releaseSave = r;
    });
    // A request already on the wire: the engine applies it whatever the
    // client does, so the gate must not delete before its answer.
    const slowSave = vi.fn(async (w: Workspace) => {
      started();
      await hold;
      disk.set(w.name, structuredClone(w));
      return w;
    });
    vi.spyOn(apiClient, "saveWorkspace").mockImplementation(slowSave);
    vi.spyOn(apiClient, "deleteWorkspace").mockImplementation(async (name) => {
      disk.delete(name);
    });

    const queued = ensureWorkspaceSaved(body);
    await onWire;
    let settled = false;
    const gate = abandonPendingWorkspaceSave(["mat171_a"]).then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    releaseSave();
    await gate;
    await queued;
    // Once abandon resolves the PUT has landed and been undone, so the
    // caller's DELETE can no longer be overtaken by it.
    expect(disk.has("mat171_a")).toBe(false);
    expect(apiClient.deleteWorkspace).toHaveBeenCalledWith("mat171_a");
  });

  it("abandon(names) leaves other workspaces' pending saves alone", async () => {
    const epoch = getWorkspaceSaveEpoch();
    abandonPendingWorkspaceSave(["mat171_a"]);
    expect(getWorkspaceSaveEpoch()).toBe(epoch);

    const other = ws("mat171_b");
    const save = vi.fn(async () => other);
    const outcome = await commitWorkspaceSave({
      ws: other,
      serialized: serializeWorkspace(other),
      epochAtStart: epoch,
      isCurrent: (e) => e === getWorkspaceSaveEpoch(),
      save,
      remove: async () => undefined,
    });
    expect(outcome).toBe("saved");
  });

  it("undoes a PUT that lands after the name was tombstoned (delete wins)", async () => {
    const body = ws("mat171_a");
    const serialized = serializeWorkspace(body);
    const epoch = getWorkspaceSaveEpoch();
    const disk = new Map<string, Workspace>();

    let afterStarted!: () => void;
    const started = new Promise<void>((r) => {
      afterStarted = r;
    });
    let releaseSave!: () => void;
    const hold = new Promise<void>((r) => {
      releaseSave = r;
    });

    const slowSave = vi.fn(async (w: Workspace) => {
      afterStarted();
      await hold;
      disk.set(w.name, structuredClone(w));
      return w;
    });
    const remove = vi.fn(async (name: string) => {
      disk.delete(name);
    });

    const pending = commitWorkspaceSave({
      ws: body,
      serialized,
      epochAtStart: epoch,
      isCurrent: () => true,
      save: slowSave,
      remove,
    });

    await started;
    void abandonPendingWorkspaceSave(["mat171_a"]);
    releaseSave();

    await expect(pending).resolves.toBe("undone");
    expect(disk.has("mat171_a")).toBe(false);
    expect(remove).toHaveBeenCalledWith("mat171_a");
  });

  it("markWorkspaceLoaded skips the echo PUT but keeps a tombstone", async () => {
    const body = ws("mat171_a");
    const save = vi.fn(async () => body);
    markWorkspaceLoaded(body);
    const echo = await commitWorkspaceSave({
      ws: body,
      serialized: serializeWorkspace(body),
      epochAtStart: getWorkspaceSaveEpoch(),
      isCurrent: (e) => e === getWorkspaceSaveEpoch(),
      save,
      remove: async () => undefined,
    });
    expect(echo).toBe("skipped");
    expect(save).not.toHaveBeenCalled();

    void abandonPendingWorkspaceSave(["mat171_a"]);
    markWorkspaceLoaded(body);
    expect(isWorkspaceSaveSuppressed("mat171_a")).toBe(true);
  });

  it("saves when current and not suppressed", async () => {
    const body = ws("mat171_a");
    const serialized = serializeWorkspace(body);
    const epoch = getWorkspaceSaveEpoch();
    const save = vi.fn(async () => body);
    const remove = vi.fn(async () => undefined);

    const outcome = await commitWorkspaceSave({
      ws: body,
      serialized,
      epochAtStart: epoch,
      isCurrent: (e) => e === getWorkspaceSaveEpoch(),
      save,
      remove,
    });

    expect(outcome).toBe("saved");
    expect(save).toHaveBeenCalledOnce();
    expect(getLastSavedWorkspaceJson()).toBe(serialized);
    expect(remove).not.toHaveBeenCalled();
  });

  it("allowWorkspaceSave clears a tombstone so recreate can persist", async () => {
    abandonPendingWorkspaceSave(["ghost"]);
    expect(isWorkspaceSaveSuppressed("ghost")).toBe(true);
    allowWorkspaceSave("ghost");
    expect(isWorkspaceSaveSuppressed("ghost")).toBe(false);

    const body = ws("ghost");
    const serialized = serializeWorkspace(body);
    const epoch = getWorkspaceSaveEpoch();
    const save = vi.fn(async () => body);

    const outcome = await commitWorkspaceSave({
      ws: body,
      serialized,
      epochAtStart: epoch,
      isCurrent: (e) => e === getWorkspaceSaveEpoch(),
      save,
      remove: async () => undefined,
    });
    expect(outcome).toBe("saved");
  });

  it("markWorkspaceSaved clears tombstone and skips identical PUT", async () => {
    const body = ws("mat171_a");
    abandonPendingWorkspaceSave(["mat171_a"]);
    markWorkspaceSaved(body);
    expect(isWorkspaceSaveSuppressed("mat171_a")).toBe(false);
    expect(getLastSavedWorkspaceJson()).toBe(serializeWorkspace(body));

    const save = vi.fn(async () => body);
    const outcome = await commitWorkspaceSave({
      ws: body,
      serialized: serializeWorkspace(body),
      epochAtStart: getWorkspaceSaveEpoch(),
      isCurrent: (e) => e === getWorkspaceSaveEpoch(),
      save,
      remove: async () => undefined,
    });
    expect(outcome).toBe("skipped");
    expect(save).not.toHaveBeenCalled();
  });
});

describe("autosave failure surfacing (#218)", () => {
  it("records a failed autosave, rejects ensureWorkspaceSaved, clears on retry", async () => {
    const body = ws("fail218");
    const save = vi
      .spyOn(apiClient, "saveWorkspace")
      .mockRejectedValueOnce(new Error("engine down: 503"))
      .mockResolvedValue(body);
    const seen: Array<string | null> = [];
    const unsub = subscribeWorkspaceSaveFailure(() =>
      seen.push(getWorkspaceSaveFailure()?.message ?? null),
    );

    await expect(ensureWorkspaceSaved(body)).rejects.toThrow("engine down: 503");
    expect(getWorkspaceSaveFailure()?.message).toBe("engine down: 503");
    expect(getLastSavedWorkspaceJson()).not.toBe(serializeWorkspace(body));

    await retryWorkspaceSave();
    expect(save).toHaveBeenCalledTimes(2);
    expect(getWorkspaceSaveFailure()).toBeNull();
    expect(getLastSavedWorkspaceJson()).toBe(serializeWorkspace(body));
    expect(seen).toEqual(["engine down: 503", null]);
    unsub();
  });

  it("keeps the chain alive and the failure recorded when retry fails again", async () => {
    const body = ws("fail218b");
    vi.spyOn(apiClient, "saveWorkspace").mockRejectedValue(new Error("422 bad"));
    await expect(ensureWorkspaceSaved(body)).rejects.toThrow("422 bad");
    await expect(retryWorkspaceSave()).rejects.toThrow("422 bad");
    expect(getWorkspaceSaveFailure()?.message).toBe("422 bad");
    vi.spyOn(apiClient, "saveWorkspace").mockResolvedValue(body);
    await ensureWorkspaceSaved(body);
    expect(getWorkspaceSaveFailure()).toBeNull();
  });
});

describe("autosave failure scoping (#218 review)", () => {
  it("clears the failure when the workspace is reverted to the saved one", async () => {
    const saved = ws("rev218", "/tmp/a.csv");
    markWorkspaceSaved(saved);
    const edited = { ...saved, label: { mode: "order" as const }, variables: [{ name: "v", expr: "1" } as never] };
    vi.spyOn(apiClient, "saveWorkspace").mockRejectedValue(new Error("503"));
    setCommittedWorkspace(edited);
    await expect(ensureWorkspaceSaved(edited)).rejects.toThrow("503");
    expect(getWorkspaceSaveFailure()?.orphaned).toBe(false);
    setCommittedWorkspace(saved);
    expect(getWorkspaceSaveFailure()).toBeNull();
  });

  it("ignores a failure that lands after the edit was reverted (#244)", async () => {
    const saved = ws("race244", "/tmp/a.csv");
    markWorkspaceSaved(saved);
    const edited = { ...saved, variables: [{ name: "v", expr: "1" } as never] };
    let fail: (e: Error) => void = () => undefined;
    vi.spyOn(apiClient, "saveWorkspace").mockImplementation(
      () => new Promise((_, reject) => (fail = reject)),
    );
    setCommittedWorkspace(edited);
    const inFlight = ensureWorkspaceSaved(edited).catch(() => undefined);
    await vi.waitFor(() => expect(apiClient.saveWorkspace).toHaveBeenCalled());
    // The user reverts while that PUT is on the wire, then it is refused.
    setCommittedWorkspace(saved);
    fail(new Error("422"));
    await inFlight;
    expect(getWorkspaceSaveFailure()).toBeNull();
  });

  it("re-sends the saved copy when the edit was undone while its PUT was on the wire (#244)", async () => {
    const base = ws("undo244", "/tmp/a.csv");
    const edited = { ...base, variables: [{ name: "v", expr: "1" } as never] };
    markWorkspaceSaved(base);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const bodies: string[] = [];
    vi.spyOn(apiClient, "saveWorkspace").mockImplementation(async (body) => {
      bodies.push(serializeWorkspace(body));
      if (bodies.length === 1) await gate;
      return body;
    });
    setCommittedWorkspace(edited);
    const first = queueWorkspaceSave(edited);
    await vi.waitFor(() => expect(bodies).toHaveLength(1));
    // Undo: the committed workspace is the last saved one again, so the
    // autosave effect has nothing to queue.
    setCommittedWorkspace(base);
    release();
    await first;
    await vi.waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]).toBe(serializeWorkspace(base));
    await ensureWorkspaceSaved(base);
    expect(getLastSavedWorkspaceJson()).toBe(serializeWorkspace(base));
  });

  it("never re-sends or silently drops another workspace's failure", async () => {
    const a = ws("a218");
    const b = ws("b218", "/tmp/b.csv");
    const save = vi
      .spyOn(apiClient, "saveWorkspace")
      .mockRejectedValue(new Error("503"));
    setCommittedWorkspace(a);
    await expect(ensureWorkspaceSaved(a)).rejects.toThrow("503");
    setCommittedWorkspace(b);
    expect(getWorkspaceSaveFailure()).toMatchObject({ orphaned: true });
    markWorkspaceLoaded(b);
    expect(getWorkspaceSaveFailure()?.ws.name).toBe("a218");
    save.mockClear();
    await retryWorkspaceSave();
    expect(save).not.toHaveBeenCalled();
    dismissWorkspaceSaveFailure();
    expect(getWorkspaceSaveFailure()).toBeNull();
  });

  it("flags a PUT of A that fails after switching to B as orphaned", async () => {
    const a = ws("a218");
    const b = ws("b218", "/tmp/b.csv");
    vi.spyOn(apiClient, "saveWorkspace").mockRejectedValue(new Error("503"));
    setCommittedWorkspace(b);
    await expect(ensureWorkspaceSaved(a)).rejects.toThrow("503");
    expect(getWorkspaceSaveFailure()).toMatchObject({ orphaned: true });
  });
});

describe("orphaned notices and rename (#243)", () => {
  it("keeps one orphaned notice per workspace until each is dismissed", async () => {
    const a = ws("a243");
    const b = ws("b243", "/tmp/b.csv");
    const c = ws("c243", "/tmp/c.csv");
    vi.spyOn(apiClient, "saveWorkspace").mockRejectedValue(new Error("503"));
    setCommittedWorkspace(a);
    await expect(ensureWorkspaceSaved(a)).rejects.toThrow("503");
    setCommittedWorkspace(b);
    // A new failure for B must not erase the notice for A.
    await expect(ensureWorkspaceSaved(b)).rejects.toThrow("503");
    expect(getLiveSaveFailure()?.ws.name).toBe("b243");
    expect(getOrphanedSaveFailures().map((f) => f.ws.name)).toEqual(["a243"]);
    setCommittedWorkspace(c);
    expect(getOrphanedSaveFailures().map((f) => f.ws.name)).toEqual(["a243", "b243"]);
    expect(getLiveSaveFailure()).toBeNull();

    dismissWorkspaceSaveFailure("a243");
    expect(getOrphanedSaveFailures().map((f) => f.ws.name)).toEqual(["b243"]);
    dismissWorkspaceSaveFailure("b243");
    expect(getOrphanedSaveFailures()).toEqual([]);
  });

  it("a saved copy of a workspace supersedes only its own orphaned notice", async () => {
    const a = ws("a243");
    const b = ws("b243", "/tmp/b.csv");
    const c = ws("c243", "/tmp/c.csv");
    vi.spyOn(apiClient, "saveWorkspace").mockRejectedValue(new Error("503"));
    setCommittedWorkspace(a);
    await expect(ensureWorkspaceSaved(a)).rejects.toThrow("503");
    setCommittedWorkspace(b);
    await expect(ensureWorkspaceSaved(b)).rejects.toThrow("503");
    setCommittedWorkspace(c);
    markWorkspaceSaved(a);
    expect(getOrphanedSaveFailures().map((f) => f.ws.name)).toEqual(["b243"]);
  });

  it("deleting a workspace drops its own orphaned notice only", async () => {
    const a = ws("a243");
    const b = ws("b243", "/tmp/b.csv");
    const c = ws("c243", "/tmp/c.csv");
    vi.spyOn(apiClient, "saveWorkspace").mockRejectedValue(new Error("503"));
    setCommittedWorkspace(a);
    await expect(ensureWorkspaceSaved(a)).rejects.toThrow("503");
    setCommittedWorkspace(b);
    await expect(ensureWorkspaceSaved(b)).rejects.toThrow("503");
    setCommittedWorkspace(c);
    await abandonPendingWorkspaceSave(["a243"]);
    expect(getOrphanedSaveFailures().map((f) => f.ws.name)).toEqual(["b243"]);
  });

  it("carries a pending failure to the new name of a renamed workspace", async () => {
    const a = ws("a243");
    vi.spyOn(apiClient, "saveWorkspace").mockRejectedValue(new Error("503"));
    setCommittedWorkspace(a);
    await expect(ensureWorkspaceSaved(a)).rejects.toThrow("503");

    renameWorkspaceSaveFailure("a243", "a243-2");
    expect(getLiveSaveFailure()?.ws.name).toBe("a243-2");
    // The renamed workspace comes on screen: never reported as lost.
    setCommittedWorkspace({ ...a, name: "a243-2" });
    expect(getOrphanedSaveFailures()).toEqual([]);
    expect(getLiveSaveFailure()).toMatchObject({ orphaned: false });
  });

  it("rename without a pending failure for that name changes nothing", () => {
    renameWorkspaceSaveFailure("a243", "a243-2");
    expect(getWorkspaceSaveFailure()).toBeNull();
  });
});

describe("flushWorkspaceSave (#248)", () => {
  it("PUTs the on-screen edit before a duplicate / rename / export reads the file", async () => {
    const saved = ws("dup248");
    markWorkspaceSaved(saved);
    const edited: Workspace = {
      ...saved,
      steps: [{ id: "s1", op: "drop_columns", target: "train", params: { columns: ["a"] } }],
    };
    setCommittedWorkspace(edited);
    const save = vi.spyOn(apiClient, "saveWorkspace").mockResolvedValue(edited);

    await flushWorkspaceSave("dup248");

    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]?.[0].steps).toHaveLength(1);
  });

  it("sends nothing when the file is already current", async () => {
    const body = ws("dup248");
    markWorkspaceSaved(body);
    setCommittedWorkspace(body);
    const save = vi.spyOn(apiClient, "saveWorkspace").mockResolvedValue(body);

    await flushWorkspaceSave("dup248");

    expect(save).not.toHaveBeenCalled();
  });

  it("rejects, and shows the save-failure notice, when the PUT fails", async () => {
    const saved = ws("dup248");
    markWorkspaceSaved(saved);
    const edited: Workspace = { ...saved, variables: [{ name: "v", value: 1 } as never] };
    setCommittedWorkspace(edited);
    vi.spyOn(apiClient, "saveWorkspace").mockRejectedValue(new Error("engine down: 503"));

    await expect(flushWorkspaceSave("dup248")).rejects.toThrow("engine down: 503");
    expect(getWorkspaceSaveFailure()?.message).toBe("engine down: 503");
  });
});

describe("flushWorkspaceOnPageHide (#221)", () => {
  function okFetch() {
    return vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
  }

  it("sends exactly one keepalive PUT with the gate payload, none when nothing is pending", () => {
    const f = okFetch();
    const w = ws("flush_a");
    markWorkspaceLoaded(w);
    setCommittedWorkspace(w);
    expect(flushWorkspaceOnPageHide()).toBe(false);
    expect(f).not.toHaveBeenCalled();

    const edited = { ...w, groups: [{ id: "g1", name: "G", step_ids: [] }] } as unknown as Workspace;
    setCommittedWorkspace(edited);
    expect(flushWorkspaceOnPageHide()).toBe(true);
    // visibilitychange then pagehide: the same payload goes out once.
    expect(flushWorkspaceOnPageHide()).toBe(false);
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0]!;
    expect(String(url)).toMatch(/\/workspaces\/flush_a$/);
    expect(init?.method).toBe("PUT");
    expect(init?.keepalive).toBe(true);
    expect(init?.body).toBe(serializeWorkspace(edited));
    expect(String(init?.body)).toContain('"g1"');
  });

  it("falls back to a plain fetch above the keepalive limit and never throws", () => {
    const f = okFetch();
    const w = ws("flush_big");
    markWorkspaceLoaded(w);
    setCommittedWorkspace({ ...w, label: { mode: "order" }, notes: "x".repeat(KEEPALIVE_MAX_BYTES + 1) } as unknown as Workspace);
    expect(flushWorkspaceOnPageHide()).toBe(true);
    expect(f.mock.calls[0]![1]?.keepalive).toBe(false);

    vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("sync boom");
    });
    setCommittedWorkspace(ws("flush_big", "/tmp/other.csv"));
    expect(() => flushWorkspaceOnPageHide()).not.toThrow();
  });

  it("does not fire for a payload already failed and awaiting Retry, but does for a newer one", async () => {
    const w = ws("flush_fail");
    markWorkspaceLoaded(w);
    const edited = { ...w, steps: [{ op: "drop_columns", target: "both", params: { columns: ["a"] } }] } as unknown as Workspace;
    vi.spyOn(apiClient, "saveWorkspace").mockRejectedValue(new Error("engine down"));
    setCommittedWorkspace(edited);
    await queueWorkspaceSave(edited).catch(() => undefined);
    expect(getWorkspaceSaveFailure()?.message).toBe("engine down");

    const f = okFetch();
    expect(flushWorkspaceOnPageHide()).toBe(false);
    expect(f).not.toHaveBeenCalled();

    setCommittedWorkspace({ ...edited, steps: [] , groups: [{ id: "g", name: "G", step_ids: [] }] } as unknown as Workspace);
    expect(flushWorkspaceOnPageHide()).toBe(true);
    // The failure stays: a keepalive answer cannot be observed on unload.
    expect(getWorkspaceSaveFailure()).not.toBeNull();
  });

  it("a later autosave PUT waits for the flush in flight (P1 lands before P2)", async () => {
    const order: string[] = [];
    let release!: () => void;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      await new Promise<void>((r) => (release = r));
      order.push("P1");
      return new Response("{}", { status: 200 });
    });
    vi.spyOn(apiClient, "saveWorkspace").mockImplementation(async (w) => {
      order.push("P2");
      return w;
    });
    const w = ws("flush_order");
    markWorkspaceLoaded(w);
    const p1 = { ...w, groups: [{ id: "g", name: "G", step_ids: [] }] } as unknown as Workspace;
    setCommittedWorkspace(p1);
    expect(flushWorkspaceOnPageHide()).toBe(true);
    const p2 = { ...w, steps: [{ op: "drop_columns", target: "both", params: { columns: ["a"] } }] } as unknown as Workspace;
    setCommittedWorkspace(p2);
    const saved = queueWorkspaceSave(p2);
    await Promise.resolve();
    expect(order).toEqual([]);
    release();
    await saved;
    expect(order).toEqual(["P1", "P2"]);
  });

  it("abandon (delete / rename) waits for the flush in flight", async () => {
    let release!: () => void;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      await new Promise<void>((r) => (release = r));
      return new Response("{}", { status: 200 });
    });
    const w = ws("flush_del");
    markWorkspaceLoaded(w);
    setCommittedWorkspace({ ...w, groups: [{ id: "g", name: "G", step_ids: [] }] } as unknown as Workspace);
    expect(flushWorkspaceOnPageHide()).toBe(true);
    let done = false;
    const abandoned = abandonPendingWorkspaceSave([w.name]).then(() => (done = true));
    await Promise.resolve();
    await Promise.resolve();
    expect(done).toBe(false);
    release();
    await abandoned;
    expect(done).toBe(true);
  });
});
