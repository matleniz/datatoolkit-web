import { afterEach, describe, expect, it, vi } from "vitest";

import { apiClient, serializeWorkspace } from "../src/api/client";
import type { Workspace } from "../src/api/types";
import {
  abandonPendingWorkspaceSave,
  allowWorkspaceSave,
  commitWorkspaceSave,
  ensureWorkspaceSaved,
  getLastSavedWorkspaceJson,
  getWorkspaceSaveEpoch,
  isWorkspaceSaveSuppressed,
  markWorkspaceLoaded,
  markWorkspaceSaved,
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
